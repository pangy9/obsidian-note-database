import { TFile, Vault, MetadataCache, App, normalizePath, stringifyYaml, EventRef, getAllTags } from "obsidian";
import { ColumnDef, DatabaseConfig, SourceRule, ViewConfig } from "./types";
import { generateId } from "./types";
import { evaluateBaseFilterExpression } from "./BaseExpression";
import { evaluateComputedFields } from "./ComputedEvaluator";
import { hasObsidianTagValue, normalizeStatusPresets, toObsidianTagValues } from "./ColumnTypes";
import { normalizeComputedSyncMode } from "./ComputedSync";
import { fileHasLink, getBaseFileFieldType, getFileFieldValue, isBaseFileField } from "./FileFields";
import { getSourceRuleTree, matchesBaseSourceType, matchesSourceRuleTree, parseSourceRuleTree, sourceRuleContainsValue, sourceRuleValuesLooseEqual, sourceRuleValuesStrictEqual } from "./SourceRules";
import { linkDatabaseSchema } from "./ColumnConfig";
import { t } from "../i18n";

const MAX_SOURCE_RULE_MATCH_TEXT_LENGTH = 10000;

export interface NoteRecord {
  file: TFile;
  frontmatter: Record<string, unknown>;
}

export type DataChangeCallback = () => void;
export type FrontmatterMutator = (frontmatter: Record<string, unknown>) => void;

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
  private notifyTimer: number | null = null;
  private frontmatterOverrides = new Map<string, { values: Record<string, unknown>; expiresAt: number }>();
  private viewDefOverrides = new Map<string, { config: DatabaseConfig; expiresAt: number }>();
  /** Per-file write queue to serialize processFrontMatter calls on the same file */
  private writeQueues = new Map<string, Promise<void>>();

  constructor(app: App) {
    this.app = app;
    this.vault = app.vault;
    this.metadataCache = app.metadataCache;
  }

  /** Serialize async writes to the same file path to prevent overlapping processFrontMatter.
   *  Errors from a previous write do not block subsequent writes in the queue. */
  private enqueueWrite(path: string, operation: () => Promise<void>): Promise<void> {
    const prev = this.writeQueues.get(path) ?? Promise.resolve();
    // Swallow previous error so the queue is never poisoned, then run this operation
    const next = prev.catch(() => {}).then(() => operation());
    this.writeQueues.set(path, next);
    // Clean up when this slot is the tail of the chain (whether fulfilled or rejected)
    const cleanup = () => {
      if (this.writeQueues.get(path) === next) {
        this.writeQueues.delete(path);
      }
    };
    next.then(cleanup, cleanup);
    return next;
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
    this.writeQueues.clear();
  }

  private trackEvent(ref: any): void {
    if (ref && typeof ref.offref === "function") {
      this.eventRefs.push(ref);
    }
  }

  /** Get all notes in a folder */
  getNotesInFolder(folderPath: string, typeFilter?: string): NoteRecord[] {
    const allFiles = this.vault.getMarkdownFiles();
    const normalizedFolder = this.normalizeVaultFolder(folderPath);
    const prefix = normalizedFolder ? (normalizedFolder.endsWith("/") ? normalizedFolder : normalizedFolder + "/") : "";

    const files = allFiles.filter(
      (f) => (!prefix || f.path.startsWith(prefix)) && f.extension === "md"
    );

    return files
      .map((f) => {
        const cache = this.metadataCache.getFileCache(f);
        const frontmatter = this.withFrontmatterOverride(
          f.path,
          cache?.frontmatter ? (cache.frontmatter as Record<string, unknown>) : {}
        );
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
    const sourceRuleTree = getSourceRuleTree(db.sourceRuleTree, effectiveRules, db.sourceLogic);
    if (!sourceRuleTree && effectiveRules.length === 0) {
      return this.getNotesInFolder(db.sourceFolder, db.typeFilter);
    }
    const records = this.vault.getMarkdownFiles()
      .map((file) => this.toRecord(file))
      .filter((record): record is NoteRecord => record != null)
      .filter((record) => record.frontmatter["db_view"] !== true);
    return records.filter((record) => {
      if (db.sourceFolder && !this.isInFolder(record.file, db.sourceFolder)) return false;
      if (sourceRuleTree && !matchesSourceRuleTree(
        sourceRuleTree,
        (rule) => this.matchesSourceRule(record, rule, db),
        (rule) => this.matchesSourceExpression(record, rule.expression, db)
      )) return false;
      if (!db.typeFilter) return true;
      return record.frontmatter["type"] === db.typeFilter;
    });
  }

  private getEffectiveSourceRules(db: DatabaseConfig): SourceRule[] {
    const rules = db.sourceRules || [];
    const sourceFolder = this.normalizeVaultFolder(db.sourceFolder);
    if (!sourceFolder) return rules;
    // Keep narrower folder rules. Only remove the duplicate rule already enforced by sourceFolder.
    return rules.filter((rule) => (
      rule.op !== "inFolder" ||
      this.normalizeVaultFolder(String(rule.value ?? "")) !== sourceFolder
    ));
  }

  /** Backward-compatible alias */
  getRecordsForConfig(db: DatabaseConfig): NoteRecord[] {
    return this.getRecordsForDatabase(db);
  }

  /** Modify a note's frontmatter with a queued mutator and remember changed keys for immediate reads. */
  async mutateFrontmatter(
    file: TFile,
    mutator: FrontmatterMutator
  ): Promise<void> {
    return this.enqueueWrite(file.path, async () => {
      let updates: Record<string, unknown> | null = null;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const frontmatter = fm as Record<string, unknown>;
          const before = this.cloneFrontmatter(frontmatter);
          mutator(frontmatter);
          updates = this.diffFrontmatter(before, frontmatter);
        });
        if (updates && Object.keys(updates).length > 0) {
          this.rememberFrontmatterUpdates(file.path, updates);
        }
      } catch (err) {
        if (updates && Object.keys(updates).length > 0) this.frontmatterOverrides.delete(file.path);
        throw err;
      }
    });
  }

  /** Modify a note's frontmatter fields using the official API.
   *  Writes to the same file are serialized to prevent overlapping processFrontMatter. */
  async updateFrontmatter(
    file: TFile,
    updates: Record<string, unknown>
  ): Promise<void> {
    return this.mutateFrontmatter(file, (frontmatter) => {
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) delete frontmatter[key];
        else frontmatter[key] = value;
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
    const folder = this.normalizeVaultFolder(folderPath);
    await this.ensureFolder(folder);
    const basePath = normalizePath(folder ? `${folder}/${safeFilename}.md` : `${safeFilename}.md`);
    const path = this.getAvailablePath(basePath);
    return await this.app.vault.create(path, content);
  }

  /** Open a note in the workspace */
  openNote(file: TFile): void {
    void this.app.workspace.getLeaf(false)?.openFile(file);
  }

  /** Move a note to trash instead of deleting permanently. */
  async trashNote(file: TFile): Promise<void> {
    await this.app.fileManager.trashFile(file);
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
      const override = this.getViewDefOverride(f.path);
      if (override) {
        results.push({ file: f, config: override });
        continue;
      }
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
  parseDatabaseConfig(fm: Record<string, unknown>): DatabaseConfig | null {
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
          name: this.getDefaultViewName(viewType),
          viewType,
          sourceFolder: String(source["sourceFolder"] || ""),
          sourceRules: Array.isArray(source["sourceRules"]) ? source["sourceRules"] as any : undefined,
          sourceLogic: source["sourceLogic"] === "or" ? "or" : "and",
          sourceRuleTree: parseSourceRuleTree(source["sourceRuleTree"]),
          newRecordFolder: source["newRecordFolder"] != null ? String(source["newRecordFolder"]) : undefined,
          typeFilter: source["typeFilter"] != null ? String(source["typeFilter"]) : undefined,
          schema: sharedSchema,
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
          columnWidths: this.parseNumberMap(source["columnWidths"]),
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
          manualOrder: source["manualOrder"] && typeof source["manualOrder"] === "object"
            ? source["manualOrder"] as { ranks?: Record<string, string> }
            : undefined,
          filterLogic: source["filterLogic"] === "or" ? "or" : "and",
          filters: Array.isArray(source["filters"]) ? source["filters"] as any : undefined,
          resultLimit: this.parseResultLimit(source["resultLimit"]),
          summaryRules: this.parseStringMap(source["summaryRules"]),
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
        sourceRuleTree: parseSourceRuleTree(source["sourceRuleTree"]),
        newRecordFolder: source["newRecordFolder"] != null ? String(source["newRecordFolder"]) : undefined,
        typeFilter: source["typeFilter"] != null ? String(source["typeFilter"]) : undefined,
        computedSyncMode: normalizeComputedSyncMode(source["computedSyncMode"]),
        summaryFormulas: this.parseStringMap(source["summaryFormulas"]),
        schema: sharedSchema,
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
      name: String(v["name"] || this.getDefaultViewName(this.parseViewType(v["viewType"]))),
      viewType: this.parseViewType(v["viewType"]),
      sourceFolder: String(v["sourceFolder"] || ""),
      sourceRules: Array.isArray(v["sourceRules"]) ? v["sourceRules"] as any : undefined,
      sourceLogic: v["sourceLogic"] === "or" ? "or" : "and",
      sourceRuleTree: parseSourceRuleTree(v["sourceRuleTree"]),
      newRecordFolder: v["newRecordFolder"] != null ? String(v["newRecordFolder"]) : undefined,
      typeFilter: v["typeFilter"] != null ? String(v["typeFilter"]) : undefined,
      schema: sharedSchema,
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
      columnWidths: this.parseNumberMap(v["columnWidths"]),
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
      manualOrder: v["manualOrder"] && typeof v["manualOrder"] === "object"
        ? v["manualOrder"] as { ranks?: Record<string, string> }
        : undefined,
      filterLogic: v["filterLogic"] === "or" ? "or" : "and",
      filters: Array.isArray(v["filters"]) ? v["filters"] as any : undefined,
      resultLimit: this.parseResultLimit(v["resultLimit"]),
      summaryRules: this.parseStringMap(v["summaryRules"]),
      sortColumn: v["sortColumn"] != null ? String(v["sortColumn"]) : undefined,
      sortDirection: v["sortDirection"] === "desc" ? "desc" : "asc" as const,
      sortRules: Array.isArray(v["sortRules"]) ? v["sortRules"] as any : undefined,
      viewStates: v["viewStates"] && typeof v["viewStates"] === "object"
        ? v["viewStates"] as any
        : undefined,
    };
  }

  /** Write database config changes back to a view definition file.
   *  Serialized per-file to prevent conflicts with concurrent frontmatter writes. */
  async updateViewDefFile(file: TFile, dbConfig: DatabaseConfig, mutation?: ViewConfigMutation): Promise<void> {
    return this.enqueueWrite(file.path, async () => {
      this.rememberViewDefConfig(file.path, dbConfig);
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const f = fm as Record<string, unknown>;
          f["db_view"] = true;
          f["name"] = dbConfig.name;
          f["database"] = this.toDatabasePayload(dbConfig) as any;
          for (const key of this.legacyViewKeys()) delete f[key];
        });
      } catch (err) {
        this.viewDefOverrides.delete(file.path);
        throw err;
      }
      if (mutation) this.notifyViewConfigChanged({ ...mutation, database: dbConfig });
    });
  }

  async createViewDefFile(folderPath: string, filename: string, dbConfig: DatabaseConfig): Promise<TFile> {
    const frontmatter = {
      db_view: true,
      name: dbConfig.name,
      database: this.toDatabasePayload(dbConfig),
    };
    const yaml = stringifyYaml(frontmatter).trim();
    const folder = this.normalizeVaultFolder(folderPath);
    await this.ensureFolder(folder);
    const safeFilename = filename.replace(/[\\/]/g, "-").trim() || "Untitled";
    const withExtension = safeFilename.endsWith(".md") ? safeFilename : `${safeFilename}.md`;
    const path = this.getAvailablePath(normalizePath(folder ? `${folder}/${withExtension}` : withExtension));
    const file = await this.vault.create(path, `---\n${yaml}\n---\n\n`);
    // Cache the config so getViewDefFiles can read it before the metadata cache indexes the new file
    this.rememberViewDefConfig(file.path, dbConfig);
    return file;
  }

  private toDatabasePayload(dbConfig: DatabaseConfig): Record<string, unknown> {
    return {
      id: dbConfig.id,
      name: dbConfig.name || "",
      description: dbConfig.description || "",
      sourceFolder: dbConfig.sourceFolder || "",
      sourceRules: dbConfig.sourceRules || [],
      sourceLogic: dbConfig.sourceLogic || "and",
      sourceRuleTree: dbConfig.sourceRuleTree,
      newRecordFolder: dbConfig.newRecordFolder || "",
      typeFilter: dbConfig.typeFilter || "",
      computedSyncMode: normalizeComputedSyncMode(dbConfig.computedSyncMode),
      summaryFormulas: dbConfig.summaryFormulas || {},
      columns: dbConfig.schema.columns || [],
      computedFields: dbConfig.schema.computedFields || [],
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
      sourceFolder: view.sourceFolder || "",
      sourceRules: view.sourceRules || [],
      sourceLogic: view.sourceLogic || "and",
      sourceRuleTree: view.sourceRuleTree,
      newRecordFolder: view.newRecordFolder || "",
      typeFilter: view.typeFilter || "",
      displayWidth: view.displayWidth || "default",
      sortColumn: view.sortColumn || "",
      sortDirection: view.sortDirection || "asc",
      sortRules: view.sortRules || [],
      columnOrder: view.columnOrder || [],
      columnWidths: view.columnWidths || {},
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
      manualOrder: view.manualOrder && view.manualOrder.ranks && Object.keys(view.manualOrder.ranks).length > 0
        ? view.manualOrder
        : undefined,
      galleryImageField: view.galleryImageField || "",
      galleryImageAspectRatio: view.galleryImageAspectRatio || 0.75,
      galleryCardSize: view.galleryCardSize || 250,
      galleryImageFit: view.galleryImageFit || "cover",
      showEmptyFields: view.showEmptyFields === true,
      statusPresets: view.statusPresets || [],
      defaultStatusPresetId: view.defaultStatusPresetId || "",
      filterLogic: view.filterLogic || "and",
      filters: view.filters || [],
      resultLimit: view.resultLimit,
      summaryRules: view.summaryRules || {},
      viewStates: view.viewStates || {},
    };
  }

  private legacyViewKeys(): string[] {
    return [
      "sourceFolder",
      "sourceRules",
      "sourceLogic",
      "sourceRuleTree",
      "newRecordFolder",
      "typeFilter",
      "computedSyncMode",
      "summaryFormulas",
      "columns",
      "computedFields",
      "sortColumn",
      "sortDirection",
      "sortRules",
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
      "columnWidths",
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
      "resultLimit",
      "summaryRules",
      "viewStates",
    ];
  }

  private parseResultLimit(value: unknown): number | undefined {
    const limit = typeof value === "number" ? value : Number(value);
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
  }

  private parseStringMap(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => key.trim() && item != null)
      .map(([key, item]) => [key, String(item)] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private parseNumberMap(value: unknown): Record<string, number> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key.trim(), Number(item)] as const)
      .filter(([key, item]) => key && Number.isFinite(item) && item > 0);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private parseViewType(value: unknown): ViewConfig["viewType"] {
    if (value === "board" || value === "gallery" || value === "list") return value;
    return "table";
  }

  private getDefaultViewName(viewType: ViewConfig["viewType"]): string {
    if (viewType === "board") return t("common.boardView");
    if (viewType === "gallery") return t("common.galleryView");
    if (viewType === "list") return t("common.listView");
    return t("common.tableView");
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

  /** Treat empty or "/" as the vault root and keep stored paths vault-relative. */
  private normalizeVaultFolder(folderPath: string): string {
    const normalized = normalizePath(folderPath || "");
    return normalized === "/" ? "" : normalized.replace(/^\/+/, "");
  }

  private toRecord(file: TFile): NoteRecord | null {
    const cache = this.metadataCache.getFileCache(file);
    const frontmatter = this.withFrontmatterOverride(
      file.path,
      cache?.frontmatter ? (cache.frontmatter as Record<string, unknown>) : {}
    );
    return { file, frontmatter };
  }

  private rememberFrontmatterUpdates(path: string, updates: Record<string, unknown>): void {
    this.cleanupFrontmatterOverrides();
    const existing = this.frontmatterOverrides.get(path)?.values || {};
    this.frontmatterOverrides.set(path, {
      values: { ...existing, ...updates },
      expiresAt: Date.now() + 10000,
    });
  }

  private diffFrontmatter(
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): Record<string, unknown> {
    // Track only changed top-level keys so metadata overlays mirror Obsidian's frontmatter shape.
    const updates: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const beforeHas = Object.prototype.hasOwnProperty.call(before, key);
      const afterHas = Object.prototype.hasOwnProperty.call(after, key);
      if (!afterHas) {
        if (beforeHas) updates[key] = null;
        continue;
      }
      if (!beforeHas || !this.valuesEqual(before[key], after[key])) {
        updates[key] = this.cloneFrontmatterValue(after[key]);
      }
    }
    return updates;
  }

  private cloneFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
    // Snapshot before mutation so in-place array/object edits can still be compared reliably.
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      clone[key] = this.cloneFrontmatterValue(value);
    }
    return clone;
  }

  private cloneFrontmatterValue(value: unknown): unknown {
    // Frontmatter values are YAML-compatible; JSON cloning is enough for nested arrays/objects here.
    if (Array.isArray(value)) return value.map((entry) => this.cloneFrontmatterValue(entry));
    if (value && typeof value === "object") {
      const serialized = JSON.stringify(value);
      return serialized == null ? value : JSON.parse(serialized);
    }
    return value;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    // Normalize nullish scalars while comparing structured values by content.
    if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === "object") || (b && typeof b === "object")) {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    return (a ?? null) === (b ?? null);
  }

  private withFrontmatterOverride(path: string, frontmatter: Record<string, unknown>): Record<string, unknown> {
    this.cleanupFrontmatterOverrides();
    const override = this.frontmatterOverrides.get(path);
    if (!override) return frontmatter;
    const merged = { ...frontmatter };
    for (const [key, value] of Object.entries(override.values)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    return merged;
  }

  private cleanupFrontmatterOverrides(): void {
    const now = Date.now();
    for (const [path, override] of this.frontmatterOverrides) {
      if (override.expiresAt <= now) this.frontmatterOverrides.delete(path);
    }
  }

  private rememberViewDefConfig(path: string, config: DatabaseConfig): void {
    this.cleanupViewDefOverrides();
    const cloned = this.cloneDatabaseConfig(config);
    linkDatabaseSchema(cloned);
    this.viewDefOverrides.set(path, {
      config: cloned,
      expiresAt: Date.now() + 10000,
    });
  }

  private getViewDefOverride(path: string): DatabaseConfig | null {
    this.cleanupViewDefOverrides();
    const override = this.viewDefOverrides.get(path);
    if (!override) return null;
    const cloned = this.cloneDatabaseConfig(override.config);
    linkDatabaseSchema(cloned);
    return cloned;
  }

  private cleanupViewDefOverrides(): void {
    const now = Date.now();
    for (const [path, override] of this.viewDefOverrides) {
      if (override.expiresAt <= now) this.viewDefOverrides.delete(path);
    }
  }

  private cloneDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
    return JSON.parse(JSON.stringify(config)) as DatabaseConfig;
  }

  private matchesSourceRule(record: NoteRecord, rule: SourceRule, db: DatabaseConfig): boolean {
    const value = this.getSourceFieldValue(record, rule.field, db);
    const expected = String(rule.value ?? "");
    const columns = db.schema.columns;
    switch (rule.op) {
      case "inFolder":
        return this.isInFolder(record.file, expected);
      case "hasTag":
        return hasObsidianTagValue(this.getTags(record), expected);
      case "hasProperty":
        return Object.prototype.hasOwnProperty.call(record.frontmatter, rule.field);
      case "hasLink":
        return fileHasLink(this.app, record.file, expected, this.metadataCache.getFileCache(record.file));
      case "eq":
        return baseSourceValuesEqual(value, rule, columns);
      case "neq":
        return !baseSourceValuesEqual(value, rule, columns);
      case "strictEq":
        return sourceRuleValuesStrictEqual(value, rule);
      case "strictNeq":
        return !sourceRuleValuesStrictEqual(value, rule);
      case "contains":
        return sourceRuleContainsValue(value, rule);
      case "startsWith":
        return matchesStringSourceRuleValue(value, (text) => text.startsWith(expected));
      case "endsWith":
        return matchesStringSourceRuleValue(value, (text) => text.endsWith(expected));
      case "matches": {
        const regex = parseSourceRuleRegex(expected);
        return regex ? matchesStringSourceRuleValue(value, (text) => {
          regex.lastIndex = 0;
          return regex.test(text);
        }) : false;
      }
      case "isType":
        return matchesBaseSourceType(value, expected, rule.field, columns, db.schema.computedFields);
      case "gt":
        return compareSourceRuleValue(value, rule, columns, (result) => result > 0);
      case "gte":
        return compareSourceRuleValue(value, rule, columns, (result) => result >= 0);
      case "lt":
        return compareSourceRuleValue(value, rule, columns, (result) => result < 0);
      case "lte":
        return compareSourceRuleValue(value, rule, columns, (result) => result <= 0);
      case "empty":
        return isBaseSourceEmptyValue(value);
      case "notempty":
        return !isBaseSourceEmptyValue(value);
      case "truthy":
        return Boolean(value);
      default:
        return true;
    }
  }

  private matchesSourceExpression(record: NoteRecord, expression: string, db: DatabaseConfig): boolean {
    try {
      const thisFile = this.getBaseThisFile(db);
      const thisFrontmatter = thisFile
        ? this.metadataCache.getFileCache(thisFile)?.frontmatter as Record<string, unknown> | undefined
        : undefined;
      return evaluateBaseFilterExpression(expression, {
        app: this.app,
        file: record.file,
        frontmatter: record.frontmatter,
        thisFile,
        thisFrontmatter,
        computedFields: db.schema.computedFields,
        columns: db.schema.columns,
      });
    } catch (error) {
      console.warn("Note Database: failed to evaluate Bases source expression", expression, error);
      return false;
    }
  }

  private getBaseThisFile(db: DatabaseConfig): TFile | undefined {
    if (!db.baseThisFilePath) return undefined;
    const file = this.vault.getAbstractFileByPath(db.baseThisFilePath);
    return file instanceof TFile ? file : undefined;
  }

  private getSourceFieldValue(record: NoteRecord, field: string, db?: DatabaseConfig): unknown {
    if (field.startsWith("formula.")) {
      const key = field.slice("formula.".length);
      if (!db?.schema.computedFields?.some((computed) => computed.key === key)) return undefined;
      const thisFile = this.getBaseThisFile(db);
      const thisFrontmatter = thisFile
        ? this.metadataCache.getFileCache(thisFile)?.frontmatter as Record<string, unknown> | undefined
        : undefined;
      return evaluateComputedFields(db.schema.computedFields, db.schema.columns, record.frontmatter, {
        app: this.app,
        file: record.file,
        thisFile,
        thisFrontmatter,
      })[key];
    }
    if (isBaseFileField(field)) {
      return getFileFieldValue(
        record.file,
        field,
        record.frontmatter,
        this.metadataCache.getFileCache(record.file),
        this.app
      );
    }
    if (field === "folder") return record.file.parent?.path || "";
    if (field === "tags") return this.getTags(record).join(" ");
    return record.frontmatter[field];
  }

  private isInFolder(file: TFile, folder: string): boolean {
    const normalized = this.normalizeVaultFolder(folder);
    if (!normalized) return true;
    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
    return file.path.startsWith(prefix);
  }

  private getTags(record: NoteRecord): string[] {
    const cache = this.metadataCache.getFileCache(record.file);
    return toObsidianTagValues([
      ...toObsidianTagValues(record.frontmatter["tags"]),
      ...(cache ? getAllTags(cache) || [] : []),
    ]);
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
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
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

function isBaseSourceEmptyValue(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Date) return !Number.isFinite(value.getTime());
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function baseSourceValuesEqual(value: unknown, rule: SourceRule, columns?: ColumnDef[]): boolean {
  if (Array.isArray(value)) return value.length === 1 && baseSourceScalarValuesEqual(value[0], rule, columns);
  return baseSourceScalarValuesEqual(value, rule, columns);
}

function baseSourceScalarValuesEqual(value: unknown, rule: SourceRule, columns?: ColumnDef[]): boolean {
  const expected = String(rule.value ?? "");
  if (shouldCompareSourceRuleAsDate(rule, columns)) {
    const leftDate = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(String(value));
    const rightDate = Date.parse(expected);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate === rightDate;
  }
  if (rule.valueType) return sourceRuleValuesLooseEqual(value, rule);
  return String(value ?? "") === expected;
}

function shouldCompareSourceRuleAsDate(rule: SourceRule, columns?: ColumnDef[]): boolean {
  if (rule.valueType === "date") return true;
  return isBaseFileField(rule.field) && getBaseFileFieldType(rule.field) === "date";
}

function matchesStringSourceRuleValue(value: unknown, predicate: (text: string) => boolean): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => {
    if (item == null) return false;
    const text = String(item);
    return text.length <= MAX_SOURCE_RULE_MATCH_TEXT_LENGTH && predicate(text);
  });
}

function parseSourceRuleRegex(expected: string): RegExp | undefined {
  const literal = expected.match(/^\/((?:\\.|[^/\\\n])*)\/([a-z]*)$/);
  try {
    return literal ? new RegExp(literal[1], literal[2]) : new RegExp(expected);
  } catch {
    return undefined;
  }
}

function compareSourceRuleValue(value: unknown, rule: SourceRule, columns: ColumnDef[] | undefined, predicate: (result: number) => boolean): boolean {
  const expected = String(rule.value ?? "");
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => {
    if (item == null || item === "") return false;
    return predicate(compareScalarSourceRuleValue(item, expected, shouldCompareSourceRuleAsDate(rule, columns)));
  });
}

function compareScalarSourceRuleValue(value: unknown, expected: string, preferDate: boolean): number {
  if (preferDate) {
    const leftDate = value instanceof Date ? value.getTime() : Date.parse(String(value));
    const rightDate = Date.parse(expected);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  }
  const leftNumber = typeof value === "number" ? value : Number(value);
  const rightNumber = Number(expected);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  const rightDate = Date.parse(expected);
  const leftDate = value instanceof Date
    ? value.getTime()
    : typeof value === "number" && Number.isFinite(rightDate)
      ? value
      : Date.parse(String(value));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  return String(value ?? "").localeCompare(expected);
}
