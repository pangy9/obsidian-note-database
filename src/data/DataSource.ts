import { TFile, Vault, MetadataCache, App, normalizePath, stringifyYaml, EventRef } from "obsidian";
import { DatabaseConfig, SourceRule, ViewConfig } from "./types";
import { generateId } from "./types";
import { normalizeStatusPresets } from "./ColumnTypes";
import { t } from "../i18n";

export interface NoteRecord {
  file: TFile;
  frontmatter: Record<string, unknown>;
}

export type DataChangeCallback = () => void;

export interface ViewConfigMutation {
  dbId?: string;
  dbPath?: string | null;
  viewId?: string;
  sourceInstanceId: string;
  database?: DatabaseConfig;
}

export type ViewConfigMutationCallback = (mutation: ViewConfigMutation) => void;

export class DataSource {
  private app: App;
  private vault: Vault;
  private metadataCache: MetadataCache;
  private listeners: DataChangeCallback[] = [];
  private viewConfigListeners: ViewConfigMutationCallback[] = [];
  private eventRefs: { offref: () => void }[] = [];
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.metadataCache = app.metadataCache;
  }

  onDataChanged(cb: DataChangeCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== cb);
    };
  }

  onViewConfigChanged(cb: ViewConfigMutationCallback): () => void {
    this.viewConfigListeners.push(cb);
    return () => {
      this.viewConfigListeners = this.viewConfigListeners.filter((listener) => listener !== cb);
    };
  }

  notifyViewConfigChanged(mutation: ViewConfigMutation): void {
    for (const cb of this.viewConfigListeners) {
      cb(mutation);
    }
  }

  /** Register metadata cache and vault events */
  startListening(registerEvent?: (eventRef: EventRef) => void): void {
    const track = (eventRef: EventRef) => {
      if (registerEvent) registerEvent(eventRef);
      else this.trackEvent(eventRef);
    };
    track(this.metadataCache.on("resolved", () => this.scheduleNotify()));
    track(this.metadataCache.on("changed", () => this.scheduleNotify()));
    track(this.vault.on("create", () => this.scheduleNotify()));
    track(this.vault.on("delete", () => this.scheduleNotify()));
    track(this.vault.on("rename", () => this.scheduleNotify()));
  }

  /** Unregister all events — call from plugin onunload() */
  destroy(): void {
    for (const ref of this.eventRefs) {
      ref.offref();
    }
    this.eventRefs = [];
    this.listeners = [];
    this.viewConfigListeners = [];
  }

  private trackEvent(ref: any): void {
    if (ref && typeof ref.offref === "function") {
      this.eventRefs.push(ref);
    }
  }

  /** Get all notes in a folder */
  getNotesInFolder(folderPath: string, typeFilter?: string): NoteRecord[] {
    const allFiles = this.vault.getMarkdownFiles();
    const normalizedFolder = normalizePath(folderPath || "");
    const prefix = normalizedFolder ? (normalizedFolder.endsWith("/") ? normalizedFolder : normalizedFolder + "/") : "";

    const files = allFiles.filter(
      (f) => (!prefix || f.path.startsWith(prefix)) && f.extension === "md"
    );

    return files
      .map((f) => {
        const cache = this.metadataCache.getFileCache(f);
        const frontmatter = cache?.frontmatter
          ? (cache.frontmatter as Record<string, unknown>)
          : {};
        return { file: f, frontmatter };
      })
      .filter((r) => {
        if (r.frontmatter["db_view"] === true) return false;
        if (!typeFilter) return true;
        return r.frontmatter["type"] === typeFilter;
      });
  }

  /** Query records using database-level config (sourceFolder, sourceRules, typeFilter) */
  getRecordsForDatabase(db: DatabaseConfig): NoteRecord[] {
    const effectiveRules = this.getEffectiveSourceRules(db);
    if (effectiveRules.length === 0) {
      return this.getNotesInFolder(db.sourceFolder, db.typeFilter);
    }
    const records = this.vault.getMarkdownFiles()
      .map((file) => this.toRecord(file))
      .filter((record): record is NoteRecord => record != null)
      .filter((record) => record.frontmatter["db_view"] !== true);
    const logic = db.sourceLogic || "and";
    return records.filter((record) => {
      if (db.sourceFolder && !this.isInFolder(record.file, db.sourceFolder)) return false;
      const results = effectiveRules.map((rule) => this.matchesSourceRule(record, rule));
      const sourceMatch = logic === "or" ? results.some(Boolean) : results.every(Boolean);
      if (!sourceMatch) return false;
      if (!db.typeFilter) return true;
      return record.frontmatter["type"] === db.typeFilter;
    });
  }

  private getEffectiveSourceRules(db: DatabaseConfig): SourceRule[] {
    const rules = db.sourceRules || [];
    if (!db.sourceFolder) return rules;
    return rules.filter((rule) => rule.op !== "inFolder");
  }

  /** Backward-compatible alias */
  getRecordsForConfig(db: DatabaseConfig): NoteRecord[] {
    return this.getRecordsForDatabase(db);
  }

  /** Modify a note's frontmatter fields using the official API */
  async updateFrontmatter(
    file: TFile,
    updates: Record<string, unknown>
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) delete (fm as Record<string, unknown>)[key];
        else (fm as Record<string, unknown>)[key] = value;
      }
    });
  }

  /** Create a new note in a folder with the given frontmatter */
  async createNote(
    folderPath: string,
    filename: string,
    frontmatter: Record<string, unknown>
  ): Promise<TFile> {
    const yaml = stringifyYaml(frontmatter).trim();
    const content = "---\n" + yaml + "\n---\n\n";
    const safeFilename = filename.replace(/[\\/]/g, "-").trim() || "Untitled";
    const folder = normalizePath(folderPath || "");
    await this.ensureFolder(folder);
    const basePath = normalizePath(folder ? `${folder}/${safeFilename}.md` : `${safeFilename}.md`);
    const path = this.getAvailablePath(basePath);
    return await this.app.vault.create(path, content);
  }

  /** Open a note in the workspace */
  openNote(file: TFile): void {
    this.app.workspace.getLeaf("tab")?.openFile(file);
  }

  /** Move a note to trash instead of deleting permanently. */
  async trashNote(file: TFile): Promise<void> {
    await this.vault.trash(file, true);
  }

  fileExists(path: string): boolean {
    return this.vault.getAbstractFileByPath(path) != null;
  }

  async renameNote(file: TFile, newPath: string): Promise<void> {
    await this.app.fileManager.renameFile(file, newPath);
  }

  /** Scan all markdown files for view definitions (files with db_view: true in frontmatter) */
  getViewDefFiles(): { file: TFile; config: DatabaseConfig }[] {
    const results: { file: TFile; config: DatabaseConfig }[] = [];
    const allFiles = this.vault.getMarkdownFiles();

    for (const f of allFiles) {
      const cache = this.metadataCache.getFileCache(f);
      const fm = cache?.frontmatter as Record<string, unknown> | undefined;
      if (!fm || fm["db_view"] !== true) continue;

      const config = this.parseDatabaseConfig(fm);
      if (config) {
        results.push({ file: f, config });
      }
    }
    return results;
  }

  /** Parse DatabaseConfig from a view definition file's frontmatter */
  private parseDatabaseConfig(fm: Record<string, unknown>): DatabaseConfig | null {
    try {
      const database = fm["database"] && typeof fm["database"] === "object"
        ? fm["database"] as Record<string, unknown>
        : {};
      const source = { ...fm, ...database };
      const sharedSchema = {
        columns: Array.isArray(source["columns"]) ? source["columns"] as any : [],
        computedFields: Array.isArray(source["computedFields"]) ? source["computedFields"] as any : [],
      };

      // Parse views: new format has database.views array, old format has flat view props
      const viewsArray = database["views"];
      let views: ViewConfig[];

      if (Array.isArray(viewsArray) && viewsArray.length > 0) {
        // New format: views array
        views = viewsArray.map((v: any) => this.parseViewConfig(v, sharedSchema));
      } else {
        // Old format: flat view properties at top level
        const viewType = this.parseViewType(source["viewType"]);
        views = [{
          id: generateId(),
          name: viewType === "board" ? t("common.boardView") : viewType === "gallery" ? t("common.galleryView") : viewType === "list" ? t("common.listView") : t("common.tableView"),
          viewType,
          sourceFolder: String(source["sourceFolder"] || ""),
          sourceRules: Array.isArray(source["sourceRules"]) ? source["sourceRules"] as any : undefined,
          sourceLogic: source["sourceLogic"] === "or" ? "or" : "and",
          newRecordFolder: source["newRecordFolder"] != null ? String(source["newRecordFolder"]) : undefined,
          typeFilter: source["typeFilter"] != null ? String(source["typeFilter"]) : undefined,
          schema: sharedSchema,
          syncComputedToFrontmatter: source["syncComputedToFrontmatter"] !== false,
          statusPresets: normalizeStatusPresets(source["viewStatusPresets"] || [], []),
          defaultStatusPresetId: source["viewDefaultStatusPresetId"] != null ? String(source["viewDefaultStatusPresetId"]) : undefined,
          displayWidth: source["displayWidth"] === "wide" ? "wide" : "default",
          boardGroupField: source["boardGroupField"] != null ? String(source["boardGroupField"]) : undefined,
          boardSubgroupField: source["boardSubgroupField"] != null ? String(source["boardSubgroupField"]) : undefined,
          boardColumnWidth: typeof source["boardColumnWidth"] === "number" ? source["boardColumnWidth"] : undefined,
          defaultColumnWidth: typeof source["defaultColumnWidth"] === "number" ? source["defaultColumnWidth"] : undefined,
          titleField: source["titleField"] != null ? String(source["titleField"]) : undefined,
          galleryImageField: source["galleryImageField"] != null ? String(source["galleryImageField"]) : undefined,
          galleryImageAspectRatio: typeof source["galleryImageAspectRatio"] === "number" ? source["galleryImageAspectRatio"] : undefined,
          galleryCardSize: typeof source["galleryCardSize"] === "number" ? source["galleryCardSize"] : undefined,
          galleryImageFit: source["galleryImageFit"] === "contain" ? "contain" : source["galleryImageFit"] === "cover" ? "cover" : undefined,
          showEmptyFields: source["showEmptyFields"] === true || (Array.isArray(source["alwaysShowEmptyFields"]) && (source["alwaysShowEmptyFields"] as unknown[]).length > 0),
          columnOrder: Array.isArray(source["columnOrder"]) ? source["columnOrder"] as string[] : undefined,
          hiddenColumns: Array.isArray(source["hiddenColumns"]) ? source["hiddenColumns"] as string[] : undefined,
          sortColumnOrder: source["sortColumnOrder"] != null ? String(source["sortColumnOrder"]) : undefined,
          statusFilter: source["statusFilter"] != null ? String(source["statusFilter"]) : undefined,
          searchText: source["searchText"] != null ? String(source["searchText"]) : undefined,
          groupByField: source["groupByField"] != null ? String(source["groupByField"]) : undefined,
          groupOrders: source["groupOrders"] && typeof source["groupOrders"] === "object"
            ? source["groupOrders"] as Record<string, string[]>
            : undefined,
          collapsedGroups: source["collapsedGroups"] && typeof source["collapsedGroups"] === "object"
            ? source["collapsedGroups"] as Record<string, string[]>
            : undefined,
          boardCardOrders: source["boardCardOrders"] && typeof source["boardCardOrders"] === "object"
            ? source["boardCardOrders"] as Record<string, Record<string, string[]>>
            : undefined,
          filterLogic: source["filterLogic"] === "or" ? "or" : "and",
          filters: Array.isArray(source["filters"]) ? source["filters"] as any : undefined,
          sortColumn: source["sortColumn"] != null ? String(source["sortColumn"]) : undefined,
          sortDirection: source["sortDirection"] === "desc" ? "desc" : "asc" as const,
          sortRules: Array.isArray(source["sortRules"]) ? source["sortRules"] as any : undefined,
          viewStates: source["viewStates"] && typeof source["viewStates"] === "object"
            ? source["viewStates"] as any
            : undefined,
        }];
      }

      return {
        id: database["id"] != null ? String(database["id"]) : generateId(),
        name: String(source["name"] || fm["name"] || ""),
        description: source["description"] != null ? String(source["description"]) : undefined,
        sourceFolder: String(source["sourceFolder"] || ""),
        sourceRules: Array.isArray(source["sourceRules"]) ? source["sourceRules"] as any : undefined,
        sourceLogic: source["sourceLogic"] === "or" ? "or" : "and",
        newRecordFolder: source["newRecordFolder"] != null ? String(source["newRecordFolder"]) : undefined,
        typeFilter: source["typeFilter"] != null ? String(source["typeFilter"]) : undefined,
        schema: sharedSchema,
        syncComputedToFrontmatter: source["syncComputedToFrontmatter"] !== false,
        statusPresets: normalizeStatusPresets(source["statusPresets"] || [], []),
        defaultStatusPresetId: source["defaultStatusPresetId"] != null ? String(source["defaultStatusPresetId"]) : undefined,
        views,
      };
    } catch (e) {
      console.warn("Failed to parse view definition file:", e);
      return null;
    }
  }

  private parseViewConfig(v: Record<string, unknown>, sharedSchema: any): ViewConfig {
    return {
      id: (v["id"] as string) || generateId(),
      name: String(v["name"] || (this.parseViewType(v["viewType"]) === "gallery" ? t("common.galleryView") : this.parseViewType(v["viewType"]) === "board" ? t("common.boardView") : this.parseViewType(v["viewType"]) === "list" ? t("common.listView") : t("common.tableView"))),
      viewType: this.parseViewType(v["viewType"]),
      sourceFolder: String(v["sourceFolder"] || ""),
      sourceRules: Array.isArray(v["sourceRules"]) ? v["sourceRules"] as any : undefined,
      sourceLogic: v["sourceLogic"] === "or" ? "or" : "and",
      newRecordFolder: v["newRecordFolder"] != null ? String(v["newRecordFolder"]) : undefined,
      typeFilter: v["typeFilter"] != null ? String(v["typeFilter"]) : undefined,
      schema: sharedSchema,
      syncComputedToFrontmatter: v["syncComputedToFrontmatter"] !== false,
      statusPresets: normalizeStatusPresets(v["statusPresets"] || [], []),
      defaultStatusPresetId: v["defaultStatusPresetId"] != null ? String(v["defaultStatusPresetId"]) : undefined,
      displayWidth: v["displayWidth"] === "wide" ? "wide" : "default",
      boardGroupField: v["boardGroupField"] != null ? String(v["boardGroupField"]) : undefined,
      boardSubgroupField: v["boardSubgroupField"] != null ? String(v["boardSubgroupField"]) : undefined,
      boardColumnWidth: typeof v["boardColumnWidth"] === "number" ? v["boardColumnWidth"] : undefined,
      defaultColumnWidth: typeof v["defaultColumnWidth"] === "number" ? v["defaultColumnWidth"] : undefined,
      titleField: v["titleField"] != null ? String(v["titleField"]) : undefined,
      galleryImageField: v["galleryImageField"] != null ? String(v["galleryImageField"]) : undefined,
      galleryImageAspectRatio: typeof v["galleryImageAspectRatio"] === "number" ? v["galleryImageAspectRatio"] : undefined,
      galleryCardSize: typeof v["galleryCardSize"] === "number" ? v["galleryCardSize"] : undefined,
      galleryImageFit: v["galleryImageFit"] === "contain" ? "contain" : v["galleryImageFit"] === "cover" ? "cover" : undefined,
      showEmptyFields: v["showEmptyFields"] === true || (Array.isArray(v["alwaysShowEmptyFields"]) && (v["alwaysShowEmptyFields"] as unknown[]).length > 0),
      columnOrder: Array.isArray(v["columnOrder"]) ? v["columnOrder"] as string[] : undefined,
      hiddenColumns: Array.isArray(v["hiddenColumns"]) ? v["hiddenColumns"] as string[] : undefined,
      sortColumnOrder: v["sortColumnOrder"] != null ? String(v["sortColumnOrder"]) : undefined,
      statusFilter: v["statusFilter"] != null ? String(v["statusFilter"]) : undefined,
      searchText: v["searchText"] != null ? String(v["searchText"]) : undefined,
      groupByField: v["groupByField"] != null ? String(v["groupByField"]) : undefined,
      groupOrders: v["groupOrders"] && typeof v["groupOrders"] === "object"
        ? v["groupOrders"] as Record<string, string[]>
        : undefined,
      collapsedGroups: v["collapsedGroups"] && typeof v["collapsedGroups"] === "object"
        ? v["collapsedGroups"] as Record<string, string[]>
        : undefined,
      boardCardOrders: v["boardCardOrders"] && typeof v["boardCardOrders"] === "object"
        ? v["boardCardOrders"] as Record<string, Record<string, string[]>>
        : undefined,
      filterLogic: v["filterLogic"] === "or" ? "or" : "and",
      filters: Array.isArray(v["filters"]) ? v["filters"] as any : undefined,
      sortColumn: v["sortColumn"] != null ? String(v["sortColumn"]) : undefined,
      sortDirection: v["sortDirection"] === "desc" ? "desc" : "asc" as const,
      sortRules: Array.isArray(v["sortRules"]) ? v["sortRules"] as any : undefined,
      viewStates: v["viewStates"] && typeof v["viewStates"] === "object"
        ? v["viewStates"] as any
        : undefined,
    };
  }

  /** Write database config changes back to a view definition file */
  async updateViewDefFile(file: TFile, dbConfig: DatabaseConfig, mutation?: ViewConfigMutation): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const f = fm as Record<string, unknown>;
      f["db_view"] = true;
      f["name"] = dbConfig.name;
      f["database"] = this.toDatabasePayload(dbConfig) as any;
      for (const key of this.legacyViewKeys()) delete f[key];
    });
    if (mutation) this.notifyViewConfigChanged({ ...mutation, database: dbConfig });
  }

  async createViewDefFile(folderPath: string, filename: string, dbConfig: DatabaseConfig): Promise<TFile> {
    const frontmatter = {
      db_view: true,
      name: dbConfig.name,
      database: this.toDatabasePayload(dbConfig),
    };
    const yaml = stringifyYaml(frontmatter).trim();
    const folder = normalizePath(folderPath || "");
    await this.ensureFolder(folder);
    const safeFilename = filename.replace(/[\\/]/g, "-").trim() || "Untitled";
    const withExtension = safeFilename.endsWith(".md") ? safeFilename : `${safeFilename}.md`;
    const path = this.getAvailablePath(normalizePath(folder ? `${folder}/${withExtension}` : withExtension));
    return this.vault.create(path, `---\n${yaml}\n---\n\n`);
  }

  private toDatabasePayload(dbConfig: DatabaseConfig): Record<string, unknown> {
    return {
      id: dbConfig.id,
      name: dbConfig.name || "",
      description: dbConfig.description || "",
      sourceFolder: dbConfig.sourceFolder || "",
      sourceRules: dbConfig.sourceRules || [],
      sourceLogic: dbConfig.sourceLogic || "and",
      newRecordFolder: dbConfig.newRecordFolder || "",
      typeFilter: dbConfig.typeFilter || "",
      columns: dbConfig.schema.columns || [],
      computedFields: dbConfig.schema.computedFields || [],
      syncComputedToFrontmatter: dbConfig.syncComputedToFrontmatter !== false,
      statusPresets: dbConfig.statusPresets || [],
      defaultStatusPresetId: dbConfig.defaultStatusPresetId || "",
      views: dbConfig.views.map((v) => this.toViewPayload(v)),
    };
  }

  private toViewPayload(view: ViewConfig): Record<string, unknown> {
    return {
      id: view.id || "",
      name: view.name || "",
      viewType: view.viewType || "table",
      displayWidth: view.displayWidth || "default",
      sortColumn: view.sortColumn || "",
      sortDirection: view.sortDirection || "asc",
      sortRules: view.sortRules || [],
      columnOrder: view.columnOrder || [],
      hiddenColumns: view.hiddenColumns || [],
      sortColumnOrder: view.sortColumnOrder || "",
      statusFilter: view.statusFilter || "",
      searchText: view.searchText || "",
      groupByField: view.groupByField || "",
      groupOrders: view.groupOrders || {},
      collapsedGroups: view.collapsedGroups || {},
      boardGroupField: view.boardGroupField || "",
      boardSubgroupField: view.boardSubgroupField || "",
      boardColumnWidth: view.boardColumnWidth || 280,
      defaultColumnWidth: view.defaultColumnWidth || 150,
      titleField: view.titleField || "",
      boardCardOrders: view.boardCardOrders || {},
      galleryImageField: view.galleryImageField || "",
      galleryImageAspectRatio: view.galleryImageAspectRatio || 0.75,
      galleryCardSize: view.galleryCardSize || 250,
      galleryImageFit: view.galleryImageFit || "cover",
      showEmptyFields: view.showEmptyFields === true,
      statusPresets: view.statusPresets || [],
      defaultStatusPresetId: view.defaultStatusPresetId || "",
      filterLogic: view.filterLogic || "and",
      filters: view.filters || [],
      viewStates: view.viewStates || {},
    };
  }

  private legacyViewKeys(): string[] {
    return [
      "sourceFolder",
      "sourceRules",
      "sourceLogic",
      "newRecordFolder",
      "typeFilter",
      "columns",
      "computedFields",
      "sortColumn",
      "sortDirection",
      "sortRules",
      "syncComputedToFrontmatter",
      "viewStatusPresets",
      "viewDefaultStatusPresetId",
      "viewType",
      "displayWidth",
      "boardGroupField",
      "boardSubgroupField",
      "boardColumnWidth",
      "defaultColumnWidth",
      "titleField",
      "galleryImageField",
      "galleryImageAspectRatio",
      "galleryCardSize",
      "galleryImageFit",
      "alwaysShowEmptyFields",
      "showEmptyFields",
      "columnOrder",
      "hiddenColumns",
      "sortColumnOrder",
      "statusFilter",
      "searchText",
      "groupByField",
      "groupOrders",
      "collapsedGroups",
      "boardCardOrders",
      "filterLogic",
      "filters",
      "viewStates",
    ];
  }

  private parseViewType(value: unknown): ViewConfig["viewType"] {
    if (value === "board" || value === "gallery" || value === "list") return value;
    return "table";
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (!folderPath) return;
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        await this.vault.createFolder(current);
      }
    }
  }

  private toRecord(file: TFile): NoteRecord | null {
    const cache = this.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter
      ? (cache.frontmatter as Record<string, unknown>)
      : {};
    return { file, frontmatter };
  }

  private matchesSourceRule(record: NoteRecord, rule: SourceRule): boolean {
    const value = this.getSourceFieldValue(record, rule.field);
    const expected = String(rule.value ?? "");
    switch (rule.op) {
      case "inFolder":
        return this.isInFolder(record.file, expected);
      case "hasTag":
        return this.getTags(record).includes(expected.replace(/^#/, ""));
      case "eq":
        return String(value ?? "") === expected;
      case "neq":
        return String(value ?? "") !== expected;
      case "contains":
        return String(value ?? "").toLowerCase().includes(expected.toLowerCase());
      case "empty":
        return value == null || value === "";
      case "notempty":
        return value != null && value !== "";
      default:
        return true;
    }
  }

  private getSourceFieldValue(record: NoteRecord, field: string): unknown {
    if (field === "file.name") return record.file.basename;
    if (field === "file.path") return record.file.path;
    if (field === "file.ext" || field === "file.extension") return record.file.extension;
    if (field === "file.folder") return record.file.parent?.path || "";
    if (field === "file.ctime" || field === "file.created") return record.file.stat.ctime;
    if (field === "file.mtime" || field === "file.modified") return record.file.stat.mtime;
    if (field === "file.size") return record.file.stat.size;
    if (field === "folder") return record.file.parent?.path || "";
    if (field === "tag" || field === "tags") return this.getTags(record).join(" ");
    return record.frontmatter[field];
  }

  private isInFolder(file: TFile, folder: string): boolean {
    const normalized = normalizePath(folder || "");
    if (!normalized || normalized === "/") return true;
    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
    return file.path.startsWith(prefix);
  }

  private getTags(record: NoteRecord): string[] {
    const raw = record.frontmatter["tags"] ?? record.frontmatter["tag"];
    if (Array.isArray(raw)) return raw.map((tag) => String(tag).replace(/^#/, ""));
    if (typeof raw === "string") {
      return raw.split(/[,\s]+/).filter(Boolean).map((tag) => tag.replace(/^#/, ""));
    }
    return [];
  }

  private getAvailablePath(path: string): string {
    if (!this.vault.getAbstractFileByPath(path)) return path;
    const dot = path.lastIndexOf(".");
    const base = dot >= 0 ? path.substring(0, dot) : path;
    const ext = dot >= 0 ? path.substring(dot) : "";
    let i = 1;
    let candidate = `${base} ${i}${ext}`;
    while (this.vault.getAbstractFileByPath(candidate)) {
      i += 1;
      candidate = `${base} ${i}${ext}`;
    }
    return candidate;
  }

  /** Debounce rapid data change events into a single notification */
  private scheduleNotify(): void {
    if (this.notifyTimer !== null) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notify();
    }, 80);
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb();
    }
  }
}
