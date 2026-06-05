import { App, FuzzySuggestModal, MarkdownView, Modal, Plugin, WorkspaceLeaf, Notice, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { DataSource } from "./data/DataSource";
import { sortDatabaseFileEntries } from "./data/DatabaseFileOrder";
import { DatabaseView, DATABASE_VIEW_TYPE } from "./views/DatabaseView";
import { DatabaseFileDashboardView, DATABASE_FILE_VIEW_TYPE } from "./views/DatabaseFileView";
import { SettingsTab, DEFAULT_SETTINGS, createDefaultSettings } from "./settings";
import { ColumnDef, ComputedFieldDef, DatabaseConfig, PluginSettings, SortRule, SourceRuleNode, StatusOptionDef, ViewConfig, generateId } from "./data/types";
import {
  createOptionsFromValues,
  getStatusPresetOptions,
  isObsidianTagsKey,
  normalizeStatusPresets,
  resolveDefaultStatusPresetId,
  toMultiSelectValuesForKey,
} from "./data/ColumnTypes";
import { EmbeddedDatabaseEntry, EmbeddedDatabaseRenderer } from "./views/EmbeddedDatabaseRenderer";
import { BaseImportColumn, BaseImportConfirmModal } from "./views/modals/BaseImportConfirmModal";
import { collectComputedFieldSamples, collectFileFrontmatterKeys, inferColumnType, getVaultTags, collectUniqueListValues, collectUniqueStringValues } from "./data/FrontmatterScanner";
import { setLocale, t } from "./i18n";
import { combineSourceRuleTrees, getPositiveSourceRules, getRequiredSourceRules, isSourceRuleGroup } from "./data/SourceRules";
import { BASE_FILE_FIELD_KEYS, getFileFieldValue, isBaseFileField } from "./data/FileFields";
import { linkDatabaseSchemas } from "./data/ColumnConfig";

export default class NoteDatabasePlugin extends Plugin {
  settings!: PluginSettings;
  dataSource!: DataSource;
  private getActiveDbView(): DatabaseView | null {
    const leaf = this.app.workspace.getLeavesOfType(DATABASE_VIEW_TYPE)[0];
    return leaf?.view instanceof DatabaseView ? leaf.view : null;
  }
  private switchingDatabaseFileView = false;
  private markdownDatabaseFileBypass = new Map<string, number>();
  private databaseFileConfigCache = new Map<string, DatabaseConfig>();
  private readonly commandNameKeys: Record<string, string> = {
    "open-dashboard": "command.openDashboard",
    "convert-active-base-to-database": "command.convertBase",
    "show-database-files": "command.showDatabaseFiles",
    "import-csv-markdown": "command.importCsvMarkdown",
    "export-current-view-as-csv-markdown-zip": "command.exportCsvMarkdown",
    "undo-last-database-edit": "command.undoDatabaseEdit",
  };

  async onload(): Promise<void> {
    // Load and migrate settings with defensive fallback
    try {
      const loaded = await this.loadData();
      if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
        const rawSettings = Object.assign(createDefaultSettings(), loaded);

        // Migrate old format: settings.views[] → settings.databases[]
        if (Array.isArray(rawSettings.views) && !rawSettings.databases) {
          rawSettings.databases = (rawSettings.views as any[]).map((v: any, i: number) => {
            const defaultView = DEFAULT_SETTINGS.databases[i];
            if (!v || typeof v !== "object") return defaultView || this.createFallbackDatabase();
            // Sanitize the view config
            if (!v.schema) v.schema = defaultView?.schema || { columns: [], computedFields: [] };
            if (!v.schema.columns) v.schema.columns = defaultView?.schema?.columns || [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" }];
            if (!v.schema.computedFields) v.schema.computedFields = [];
            if (v.columnOrder != null && !Array.isArray(v.columnOrder)) v.columnOrder = undefined;
            if (v.hiddenColumns != null && !Array.isArray(v.hiddenColumns)) v.hiddenColumns = undefined;
            if (v.filters != null && !Array.isArray(v.filters)) v.filters = undefined;
            if (v.filterLogic !== "or") v.filterLogic = "and";
            if (!v.name) v.name = `${t("common.database")} ${i + 1}`;
            if (v.viewType !== "board" && v.viewType !== "gallery" && v.viewType !== "list") v.viewType = "table";
            // Wrap as DatabaseConfig with one ViewConfig child
            const viewCopy = { ...v, id: v.id || generateId() };
            return {
              id: generateId(),
              name: v.name,
              description: v.description,
              sourceFolder: v.sourceFolder || "",
              sourceRules: v.sourceRules,
              sourceLogic: v.sourceLogic,
              sourceRuleTree: v.sourceRuleTree,
              newRecordFolder: v.newRecordFolder,
              typeFilter: v.typeFilter,
              schema: v.schema,
              views: [viewCopy],
            } as DatabaseConfig;
          });
          delete (rawSettings as any).views;
        }

        // Sanitize databases array
        if (Array.isArray(rawSettings.databases)) {
          rawSettings.databases = rawSettings.databases.map((db: any) => {
            if (!db || typeof db !== "object") return this.createFallbackDatabase();
            if (!db.id) db.id = generateId();
            if (db.description != null) db.description = String(db.description);
            if (!db.views || !Array.isArray(db.views) || db.views.length === 0) {
              db.views = [this.createDefaultView(db)];
            }
            if (!db.schema) db.schema = db.views[0]?.schema || { columns: [], computedFields: [] };
            for (const view of db.views) {
              if (!view || typeof view !== "object") continue;
              if (view.viewType !== "board" && view.viewType !== "gallery" && view.viewType !== "list") view.viewType = "table";
            }
            return db;
          });
        }

        // Re-establish shared schema references broken by JSON round-trip.
        // All views within a database must point to the same schema object.
        if (Array.isArray(rawSettings.databases)) {
          linkDatabaseSchemas(rawSettings.databases);
        }

        if (!rawSettings.databaseFolder) rawSettings.databaseFolder = DEFAULT_SETTINGS.databaseFolder;
        if (!Array.isArray(rawSettings.databaseFileOrder)) rawSettings.databaseFileOrder = [];
        rawSettings.statusPresets = normalizeStatusPresets(rawSettings.statusPresets);
        rawSettings.defaultStatusPresetId = resolveDefaultStatusPresetId(rawSettings.statusPresets, rawSettings.defaultStatusPresetId);
        if (Array.isArray(rawSettings.databases)) {
          for (const db of rawSettings.databases) {
            db.statusPresets = normalizeStatusPresets(db.statusPresets || [], []);
            const mergedPresets = [...rawSettings.statusPresets, ...db.statusPresets];
            db.defaultStatusPresetId = db.defaultStatusPresetId
              ? resolveDefaultStatusPresetId(mergedPresets, db.defaultStatusPresetId)
              : undefined;
            for (const view of db.views || []) {
              view.statusPresets = normalizeStatusPresets(view.statusPresets || [], []);
              const viewMergedPresets = [...mergedPresets, ...view.statusPresets];
              view.defaultStatusPresetId = view.defaultStatusPresetId
                ? resolveDefaultStatusPresetId(viewMergedPresets, view.defaultStatusPresetId)
                : undefined;
            }
          }
        }
        if (!rawSettings.language) rawSettings.language = DEFAULT_SETTINGS.language;
        this.settings = rawSettings;
      } else {
        this.settings = createDefaultSettings();
      }
    } catch (e) {
      console.error("Failed to load settings, using defaults:", e);
      this.settings = createDefaultSettings();
    }
    setLocale(this.settings.language);

    // Add settings tab
    this.addSettingTab(new SettingsTab(this.app, this));

    // Initialize data source
    this.dataSource = new DataSource(this.app);
    this.dataSource.startListening((eventRef) => this.registerEvent(eventRef));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file instanceof TFile) this.scheduleDatabaseFileViewOpen(file);
      this.markDatabaseFileTabs();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      const file = this.getLeafFile(leaf) || this.app.workspace.getActiveFile();
      if (file instanceof TFile) this.scheduleDatabaseFileViewOpen(file, leaf || undefined);
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.markDatabaseFileTabs();
      const file = this.app.workspace.getActiveFile();
      if (file instanceof TFile) this.scheduleDatabaseFileViewOpen(file);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      this.databaseFileConfigCache.delete(file.path);
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile instanceof TFile && activeFile.path === file.path) {
        this.scheduleDatabaseFileViewOpen(file);
      }
    }));
    this.app.workspace.onLayoutReady(() => {
      const file = this.app.workspace.getActiveFile();
      if (file instanceof TFile) this.scheduleDatabaseFileViewOpen(file);
      this.markDatabaseFilesInExplorer();
      // Migrate legacy settings-based databases to files
      if (!this.settings.databasesMigrated && Array.isArray(this.settings.databases) && this.settings.databases.length > 0) {
        void this.migrateDatabasesToFiles();
      }
    });

    // Register database view
    this.registerView(
      DATABASE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        return new DatabaseView(
          leaf,
          this.dataSource,
          this.settings.databaseFileOrder || [],
          this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder,
          this.settings.statusPresets || DEFAULT_SETTINGS.statusPresets,
          this.settings.defaultStatusPresetId,
          () => this.saveSettings()
        );
      }
    );
    this.registerView(
      DATABASE_FILE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        const state = leaf.getViewState();
        const filePath = (state.state as any)?.file as string || "";
        const file = filePath ? this.app.vault.getAbstractFileByPath(filePath) : null;
        let configs: DatabaseConfig[] = [];
        if (file instanceof TFile) {
          const config = this.getDatabaseFileConfig(file);
          if (config) configs = [config];
        }
        return new DatabaseFileDashboardView(
          leaf,
          this.dataSource,
          configs,
          filePath,
          this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder,
          this.settings.statusPresets || DEFAULT_SETTINGS.statusPresets,
          this.settings.defaultStatusPresetId,
          () => this.saveSettings(),
        );
      }
    );

    // Add ribbon icon to open the view as a tab (like Kanban plugin)
    this.addRibbonIcon("database", t("app.name"), async () => {
      await this.openDashboard();
    });

    // Add command to open view
    this.addCommand({
      id: "open-dashboard",
      name: t("command.openDashboard"),
      callback: async () => {
        await this.openDashboard();
      },
    });
    this.addCommand({
      id: "convert-active-base-to-database",
      name: t("command.convertBase"),
      callback: async () => {
        await this.convertBaseFromCommand();
      },
    });
    this.addCommand({
      id: "show-database-files",
      name: t("command.showDatabaseFiles"),
      callback: () => this.showDatabaseFiles(),
    });
    this.addCommand({
      id: "import-csv-markdown",
      name: t("command.importCsvMarkdown"),
      callback: async () => {
        await this.importCsvMarkdownFiles();
      },
    });
    this.addCommand({
      id: "export-current-view-as-csv-markdown-zip",
      name: t("command.exportCsvMarkdown"),
      callback: async () => {
        await this.exportCurrentViewAsCsvMarkdownZip();
      },
    });
    this.addCommand({
      id: "undo-last-database-edit",
      name: t("command.undoDatabaseEdit"),
      callback: async () => {
        await this.getActiveDbView()?.undoLastEdit();
      },
    });

    this.registerMarkdownCodeBlockProcessor("note-database", (source, el, ctx) => {
      ctx.addChild(new EmbeddedDatabaseRenderer(
        this.app,
        el,
        this.dataSource,
        () => this.getEmbeddedDatabaseEntries(),
        source,
        ctx.sourcePath,
        () => ctx.getSectionInfo(el),
        () => this.saveSettings(),
        "codeblock",
        this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder
      ));
    });
    this.registerMarkdownCodeBlockProcessor("database-view", (source, el, ctx) => {
      ctx.addChild(new EmbeddedDatabaseRenderer(
        this.app,
        el,
        this.dataSource,
        () => this.getEmbeddedDatabaseEntries(),
        source,
        ctx.sourcePath,
        () => ctx.getSectionInfo(el),
        () => this.saveSettings(),
        "codeblock",
        this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder
      ));
    });
    window.setTimeout(() => this.markDatabaseFileTabs(), 1000);
  }

  private scheduleDatabaseFileViewOpen(file: TFile, leaf?: WorkspaceLeaf, delay = 0): void {
    window.setTimeout(() => {
      void this.openDatabaseFileViewIfNeeded(file, leaf);
    }, delay);
  }

  private async openDatabaseFileViewIfNeeded(file: TFile, targetLeaf?: WorkspaceLeaf): Promise<void> {
    if (this.switchingDatabaseFileView || file.extension !== "md") return;
    const bypassUntil = this.markdownDatabaseFileBypass.get(file.path) || 0;
    if (Date.now() < bypassUntil) return;
    if (!(await this.isDatabaseViewFile(file))) return;
    const leaf = targetLeaf || this.app.workspace.getLeaf(false);
    if (!leaf || leaf.view.getViewType() === DATABASE_FILE_VIEW_TYPE) return;
    const leafFile = this.getLeafFile(leaf);
    if (leafFile instanceof TFile && leafFile.path !== file.path) return;
    if (!(leaf.view instanceof MarkdownView) && leaf.view.getViewType() !== "markdown") return;
    this.switchingDatabaseFileView = true;
    try {
      await leaf.setViewState({
        type: DATABASE_FILE_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      });
    } finally {
      this.switchingDatabaseFileView = false;
    }
  }

  private async isDatabaseViewFile(file: TFile): Promise<boolean> {
    if (this.getDatabaseFileConfig(file)) return true;
    const fm = await this.readFileFrontmatter(file);
    if (fm?.db_view !== true) return false;
    const config = this.dataSource.parseDatabaseConfig(fm);
    if (config) this.databaseFileConfigCache.set(file.path, config);
    return true;
  }

  private getDatabaseFileConfig(file: TFile): DatabaseConfig | null {
    const cached = this.databaseFileConfigCache.get(file.path);
    if (cached) return cached;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (fm?.db_view !== true) return null;
    const config = this.dataSource.parseDatabaseConfig(fm);
    if (config) this.databaseFileConfigCache.set(file.path, config);
    return config;
  }

  private async readFileFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
    try {
      const content = await this.app.vault.cachedRead(file);
      const match = content.match(/^\uFEFF?---\s*\n([\s\S]*?)\n---(?:\n|$)/);
      if (!match) return null;
      const parsed = parseYaml(match[1]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch (error) {
      console.error("Note Database: failed to read database file frontmatter", error);
      return null;
    }
  }

  private getLeafFile(leaf: WorkspaceLeaf | null | undefined): TFile | null {
    const file = (leaf?.view as { file?: unknown } | undefined)?.file;
    return file instanceof TFile ? file : null;
  }

  private async openDatabaseFileAsMarkdown(file: TFile): Promise<void> {
    this.markdownDatabaseFileBypass.set(file.path, Date.now() + 1000);
    const leaf = this.app.workspace.getLeaf(false) || this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "markdown",
      state: { file: file.path, mode: "source" },
      active: true,
    });
  }

  /** Open the dashboard view in the main content area as a new tab */
  async openDashboard(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(DATABASE_VIEW_TYPE);
    if (leaves.length > 0) {
      void this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    if (!leaf) {
      new Notice(t("notice.cannotCreateTab"));
      return;
    }
    await leaf.setViewState({
      type: DATABASE_VIEW_TYPE,
      active: true,
    });
  }

  /** Open the dashboard and switch to a specific file database. */
  async openDashboardReference(sourcePath: string): Promise<void> {
    await this.openDashboard();
    this.getActiveDbView()?.openViewReference(sourcePath);
  }

  /** Notify the database view and status bar that settings have changed */
  notifyViewSettingsChanged(): void {
    const dbView = this.getActiveDbView();
    if (dbView) {
      dbView.updateConfigs(
        this.settings.databaseFileOrder || [],
        this.settings.statusPresets || DEFAULT_SETTINGS.statusPresets,
        this.settings.defaultStatusPresetId
      );
    }
  }

  refreshCommandNames(): void {
    const commands = (this.app as any).commands?.commands as Record<string, { name?: string }> | undefined;
    if (!commands) return;
    for (const [commandId, key] of Object.entries(this.commandNameKeys)) {
      const command = commands[`${this.manifest.id}:${commandId}`];
      if (command) command.name = t(key);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.notifyViewSettingsChanged();
  }

  showDatabaseFiles(): void {
    // 打开插件设置界面，定位到数据库列表分组
    const setting = (this.app as any).setting;
    if (setting) {
      setting.open();
      setting.openTabById(this.manifest.id);
      // 等待 DOM 渲染后滚动到数据库列表分组
      window.requestAnimationFrame(() => {
        const el = window.activeDocument.getElementById("db-settings-database-group");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  }

  private getEmbeddedDatabaseEntries(): EmbeddedDatabaseEntry[] {
    const entries: EmbeddedDatabaseEntry[] = [];
    for (const entry of sortDatabaseFileEntries(this.dataSource.getViewDefFiles(), this.settings.databaseFileOrder || [])) {
      entries.push({ config: entry.config, sourcePath: entry.file.path });
    }
    return entries;
  }

  private getActiveDatabaseView(): DatabaseView | null {
    // Check both dashboard view and single-file view types
    const viewTypes = [DATABASE_VIEW_TYPE, DATABASE_FILE_VIEW_TYPE];
    for (const viewType of viewTypes) {
      for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
        if ((leaf as any).active && leaf.view instanceof DatabaseView) {
          return leaf.view;
        }
      }
      // Fallback: check if any leaf of this type exists
      const leaves = this.app.workspace.getLeavesOfType(viewType);
      if (leaves.length > 0 && leaves[0].view instanceof DatabaseView) {
        return leaves[0].view;
      }
    }
    return null;
  }

  private getDefaultStatusOptions(): StatusOptionDef[] {
    const presets = normalizeStatusPresets(this.settings.statusPresets);
    return getStatusPresetOptions(presets, this.settings.defaultStatusPresetId);
  }

  private async convertBaseToDatabase(file: TFile): Promise<void> {
    const source = await this.app.vault.read(file);
    let config: DatabaseConfig;
    let inferredColumns: BaseImportColumn[];
    let mapViewDowngraded = false;
    try {
      ({ config, inferredColumns, mapViewDowngraded } = this.createConfigFromBase(file, source));
    } catch (error) {
      console.warn("Note Database: failed to convert .base filters", error);
      new Notice(error instanceof Error ? error.message : String(error));
      return;
    }
    if (mapViewDowngraded) new Notice(t("notice.baseMapViewDowngraded"));

    // Show confirmation modal for column type review
    const confirmed = await new BaseImportConfirmModal(this.app, inferredColumns).openAndWait();
    if (!confirmed) {
      new Notice(t("notice.importCancelled"));
      return;
    }
    // Apply user-confirmed types back to schema and populate options if needed
    const STATUS_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink"] as const;
    for (const col of confirmed) {
      const schemaCol = config.schema.columns.find((c) => c.key === col.key);
      if (!schemaCol) continue;
      const originalType = schemaCol.type;
      schemaCol.label = col.label || col.key;
      schemaCol.type = col.type;
      // If user changed to an option-based type, collect unique values as options
      if ((col.type === "status" || col.type === "select" || col.type === "multi-select") && originalType !== col.type) {
        const uniqueValues = collectUniqueStringValues(this.app, col.key, config.sourceFolder, config.sourceRules, config.sourceLogic, config.sourceRuleTree);
        if (uniqueValues.length > 0) {
          (schemaCol as any).statusOptions = uniqueValues.map((val: string, i: number) => ({
            value: val,
            color: STATUS_COLORS[i % STATUS_COLORS.length],
          }));
        } else if (col.type === "status") {
          (schemaCol as any).statusOptions = this.getDefaultStatusOptions();
        }
      }
    }

    this.assignColumnWidthsFromData(config);
    const uniqueName = this.getUniqueDatabaseName(file.basename);
    config.name = uniqueName;
    const created = await this.dataSource.createViewDefFile(
      this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder,
      uniqueName,
      config
    );
    new Notice(t("notice.generatedFromBase", { path: created.path }));
    this.dataSource.openNote(created);
  }

  private async convertBaseFromCommand(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.extension === "base") {
      await this.convertBaseToDatabase(activeFile);
      return;
    }

    const baseFiles = this.app.vault.getFiles()
      .filter((file) => file.extension === "base")
      .sort((a, b) => a.path.localeCompare(b.path));
    if (baseFiles.length === 0) {
      new Notice(t("notice.noBaseFilesFound"));
      return;
    }

    new BaseFileSuggestModal(this.app, baseFiles, (file) => {
      void this.convertBaseToDatabase(file);
    }).open();
  }

  private getUniqueDatabaseName(baseName: string, excludeNames?: Set<string>): string {
    const existing = new Set<string>();
    if (excludeNames) for (const n of excludeNames) existing.add(n);
    for (const entry of this.dataSource.getViewDefFiles()) existing.add(entry.config.name);
    if (!existing.has(baseName)) return baseName;
    let i = 1;
    while (existing.has(`${baseName} ${i}`)) i++;
    return `${baseName} ${i}`;
  }

  async exportCurrentViewAsCsvMarkdownZip(): Promise<void> {
    const view = this.getActiveDatabaseView();
    if (!view) {
      new Notice(t("notice.openDashboardToExportCsvMarkdown"));
      return;
    }
    await view.exportCurrentViewAsCsvMarkdownZip();
  }

  async importCsvMarkdownFiles(): Promise<void> {
    const result = await new CsvMarkdownImportModal(this.app, this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder).openAndWait();
    if (!result) return;
    const metadata = result.metadataFile ? await this.readCsvMarkdownMetadata(result.metadataFile) : null;
    await this.importFromCsvs(result, metadata);
  }

  private async importFromCsvs(
    result: CsvMarkdownImportResult,
    metadata: CsvMarkdownMetadata | null
  ): Promise<void> {
    // Parse all CSV files
    const parsedCsvs: { file: File; table: string[][] }[] = [];
    for (const csvFile of result.csvFiles) {
      const csvText = await csvFile.text();
      const table = this.parseCsv(csvText);
      if (table.length < 1 || table[0].length === 0) {
        new Notice(t("notice.csvMarkdownImportInvalidCsv"));
        return;
      }
      parsedCsvs.push({ file: csvFile, table });
    }
    // Primary CSV (first file) provides the data rows
    const primary = parsedCsvs[0];
    const headers = primary.table[0].map((header) => header.trim());
    const rows = primary.table.slice(1).filter((row) => row.some((cell) => cell.trim().length > 0));
    const titleIndex = this.findCsvMarkdownTitleIndex(headers);
    const skipLabels = new Set(["path"]);
    const dataHeaders = headers
      .map((label, index) => ({ label: label || `Property ${index + 1}`, index }))
      .filter((item) => item.index !== titleIndex && !skipLabels.has(item.label.trim().toLowerCase()));
    const columnKeys = new Map<number, string>();
    const seenKeys = new Set(["file.name"]);
    const metadataColumns = metadata?.database?.schema?.columns || [];
    for (const item of dataHeaders) {
      const metadataColumn = metadataColumns.find((col) => col.key !== "file.name" && (col.label === item.label || col.key === item.label));
      const key = metadataColumn?.key || this.getUniqueImportKey(this.normalizeImportKey(item.label), seenKeys);
      seenKeys.add(key);
      columnKeys.set(item.index, key);
    }

    // Merge columns from all CSVs (additional CSVs may have different visible columns)
    const allColumnLabels = new Map<string, string>(); // key -> label
    for (const item of dataHeaders) {
      allColumnLabels.set(columnKeys.get(item.index)!, item.label);
    }
    for (let i = 1; i < parsedCsvs.length; i++) {
      const csvHeaders = parsedCsvs[i].table[0].map((h) => h.trim());
      const csvTitleIdx = this.findCsvMarkdownTitleIndex(csvHeaders);
      for (let j = 0; j < csvHeaders.length; j++) {
        if (j === csvTitleIdx) continue;
        const label = csvHeaders[j] || `Property ${j + 1}`;
        if (!label) continue;
        const normalizedKey = this.normalizeImportKey(label);
        const existingKey = [...allColumnLabels.keys()].find(
          (k) => k === normalizedKey || allColumnLabels.get(k) === label
        );
        if (!existingKey) {
          const key = this.getUniqueImportKey(normalizedKey, seenKeys);
          seenKeys.add(key);
          allColumnLabels.set(key, label);
        }
      }
    }

    const markdownByTitle = await this.readMarkdownFilesByTitle(result.markdownFiles);
    const folder = normalizePath(result.targetFolder || result.databaseName || "CSV Markdown import");
    await this.ensureVaultFolder(folder);

    const columns: ColumnDef[] = metadata?.database?.schema?.columns?.length
      ? JSON.parse(JSON.stringify(metadata.database.schema.columns)) as ColumnDef[]
      : [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" }];
    for (const [key, label] of allColumnLabels) {
      if (columns.some((candidate) => candidate.key === key)) continue;
      const values = rows.map((row) => {
        const idx = dataHeaders.find((h) => columnKeys.get(h.index) === key)?.index;
        return idx != null ? (row[idx] || "").trim() : "";
      }).filter((value) => value.trim().length > 0);
      const type = this.inferCsvMarkdownColumnType(values);
      const col: ColumnDef = { key, label, type };
      if (type === "select" || type === "multi-select" || type === "status") {
        col.statusOptions = createOptionsFromValues(type === "multi-select"
          ? values.flatMap((value) => this.splitMultiValue(value, key))
          : values);
      }
      columns.push(col);
    }

    // Show type confirmation dialog when no metadata is provided
    if (!metadata) {
      const inferColumns: BaseImportColumn[] = columns
        .filter((col) => col.key !== "file.name")
        .map((col) => {
          const values = rows.map((row) => {
            const idx = dataHeaders.find((h) => columnKeys.get(h.index) === col.key)?.index;
            return idx != null ? (row[idx] || "").trim() : "";
          }).filter(Boolean);
          return { ...col, fileCount: values.length };
        });
      const confirmed = await new BaseImportConfirmModal(this.app, inferColumns).openAndWait();
      if (!confirmed) return;
      // Apply confirmed types back to columns and regenerate options
      for (const confirmedCol of confirmed) {
        const col = columns.find((c) => c.key === confirmedCol.key);
        if (!col) continue;
        const typeChanged = col.type !== confirmedCol.type;
        col.label = confirmedCol.label || col.key;
        col.type = confirmedCol.type;
        if (typeChanged && (col.type === "select" || col.type === "multi-select" || col.type === "status")) {
          const values = rows.map((row) => {
            const idx = dataHeaders.find((h) => columnKeys.get(h.index) === col.key)?.index;
            return idx != null ? (row[idx] || "").trim() : "";
          }).filter(Boolean);
          col.statusOptions = createOptionsFromValues(col.type === "multi-select"
            ? values.flatMap((value) => this.splitMultiValue(value, col.key))
            : values);
        }
      }
    }
    if (!columns.some((col) => col.key === "file.name")) {
      columns.unshift({ key: "file.name", label: t("defaults.nameColumn"), type: "text" });
    }
    const colByKey = new Map(columns.map((col) => [col.key, col]));

    let imported = 0;
    for (const row of rows) {
      const title = (row[titleIndex] || "").trim() || t("defaults.untitledNote");
      const page = markdownByTitle.get(this.normalizeCsvMarkdownTitle(title));
      const frontmatter: Record<string, unknown> = { ...(page?.frontmatter || {}) };
      delete frontmatter["db_view"];
      delete frontmatter["database"];
      for (const item of dataHeaders) {
        const key = columnKeys.get(item.index)!;
        const col = colByKey.get(key);
        if (col?.type === "computed") continue;
        const raw = row[item.index] || "";
        const value = this.parseCsvMarkdownCellValue(raw, col?.type || "text", key);
        if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
        frontmatter[key] = value;
      }
      const body = page?.body || "";
      const path = this.getAvailableVaultPath(folder, `${this.sanitizeFilename(title)}.md`);
      const yaml = stringifyYaml(frontmatter).trim();
      const content = yaml ? `---\n${yaml}\n---\n\n${body}` : body;
      await this.app.vault.create(path, content || `# ${title}\n`);
      imported++;
    }

    const schema = {
      columns,
      computedFields: metadata?.database?.schema?.computedFields
        ? JSON.parse(JSON.stringify(metadata.database.schema.computedFields))
        : [],
    };
    const dbName = this.getUniqueDatabaseName(result.databaseName || result.csvFiles[0].name.replace(/\.csv$/i, ""));

    // Build views: one for each CSV file
    const views: ViewConfig[] = [];
    for (let i = 0; i < parsedCsvs.length; i++) {
      const csvFile = parsedCsvs[i].file;
      const csvHeaders = parsedCsvs[i].table[0].map((h) => h.trim());
      const csvTitleIdx = this.findCsvMarkdownTitleIndex(csvHeaders);
      const viewColumnOrder: string[] = ["file.name"];
      for (let j = 0; j < csvHeaders.length; j++) {
        if (j === csvTitleIdx) continue;
        const label = csvHeaders[j] || `Property ${j + 1}`;
        const normalizedKey = this.normalizeImportKey(label);
        const matchingCol = columns.find(
          (c) => c.key === normalizedKey || c.label === label
        );
        if (matchingCol) viewColumnOrder.push(matchingCol.key);
      }
      const viewName = csvFile.name.replace(/\.csv$/i, "").trim()
        || `${t("common.tableView")} ${i + 1}`;
      views.push({
        id: generateId(),
        name: viewName,
        viewType: "table",
        sourceFolder: "",
        schema,
        columnOrder: viewColumnOrder,
      });
    }

    const config: DatabaseConfig = metadata?.database
      ? this.createImportedDatabaseConfig(metadata.database, dbName, folder, schema)
      : {
        id: generateId(),
        name: dbName,
        sourceFolder: folder,
        newRecordFolder: folder,
        schema,
        views: views.length > 0 ? views : [{
          id: generateId(),
          name: t("common.tableView"),
          viewType: "table",
          sourceFolder: "",
          schema,
          columnOrder: columns.map((col) => col.key),
        }],
      };
    const file = await this.dataSource.createViewDefFile(this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder, dbName, config);
    new Notice(t("notice.csvMarkdownImportComplete", { count: imported, path: file.path }));
    this.dataSource.openNote(file);
    await this.saveSettings();
  }

  private parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.length > 1 || row[0]) rows.push(row);
    return rows;
  }

  private findCsvMarkdownTitleIndex(headers: string[]): number {
    const candidates = ["name", "title", "名称", "标题", "標題", "名稱"];
    const index = headers.findIndex((header) => candidates.includes(header.trim().toLowerCase()));
    return index >= 0 ? index : 0;
  }

  private async readMarkdownFilesByTitle(files: File[]): Promise<Map<string, ImportedMarkdownPage>> {
    const result = new Map<string, ImportedMarkdownPage>();
    for (const file of files) {
      const text = await file.text();
      const title = this.normalizeCsvMarkdownTitle(file.name.replace(/\.(md|markdown)$/i, "").replace(/\s+[a-f0-9]{16,32}$/i, ""));
      result.set(title, this.parseMarkdownPage(text));
    }
    return result;
  }

  private normalizeCsvMarkdownTitle(value: string): string {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  private parseMarkdownPage(text: string): ImportedMarkdownPage {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/);
    if (!match) return { frontmatter: {}, body: text };
    try {
      const frontmatter = parseYaml(match[1]);
      return {
        frontmatter: frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
          ? frontmatter as Record<string, unknown>
          : {},
        body: text.slice(match[0].length),
      };
    } catch {
      return { frontmatter: {}, body: text.slice(match[0].length) };
    }
  }

  private async readCsvMarkdownMetadata(file: File): Promise<CsvMarkdownMetadata | null> {
    try {
      const parsed = JSON.parse(await file.text()) as CsvMarkdownMetadata;
      if (parsed?.format !== "note-database-csv-markdown" || !parsed.database) return null;
      return parsed;
    } catch {
      new Notice(t("notice.csvMarkdownImportInvalidMetadata"));
      return null;
    }
  }

  private createImportedDatabaseConfig(
    source: DatabaseConfig,
    name: string,
    folder: string,
    schema: DatabaseConfig["schema"]
  ): DatabaseConfig {
    const config = JSON.parse(JSON.stringify(source)) as DatabaseConfig;
    config.id = generateId();
    config.name = name;
    config.sourceFolder = folder;
    config.newRecordFolder = folder;
    config.sourceRules = undefined;
    config.sourceLogic = undefined;
    config.sourceRuleTree = undefined;
    config.typeFilter = undefined;
    config.schema = schema;
    config.views = (config.views || []).map((view) => {
      const cloned = JSON.parse(JSON.stringify(view)) as ViewConfig;
      cloned.id = generateId();
      cloned.sourceFolder = "";
      cloned.newRecordFolder = undefined;
      cloned.sourceRules = undefined;
      cloned.sourceLogic = undefined;
      cloned.sourceRuleTree = undefined;
      cloned.typeFilter = undefined;
      cloned.schema = schema;
      cloned.manualOrder = undefined;
      cloned.boardCardOrders = undefined;
      return cloned;
    });
    if (config.views.length === 0) {
      config.views.push({
        id: generateId(),
        name: t("common.tableView"),
        viewType: "table",
        sourceFolder: "",
        schema,
        columnOrder: schema.columns.map((col) => col.key),
      });
    }
    return config;
  }

  private normalizeImportKey(label: string): string {
    const key = label.trim()
      .replace(/[\\/#^[\]:|?*"<>{},]/g, "")
      .replace(/[\s-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return key || `property_${Date.now().toString(36)}`;
  }

  private getUniqueImportKey(base: string, seen: Set<string>): string {
    let key = base || "property";
    let index = 2;
    while (seen.has(key)) {
      key = `${base}_${index}`;
      index++;
    }
    seen.add(key);
    return key;
  }

  private inferCsvMarkdownColumnType(values: string[]): ColumnDef["type"] {
    const cleaned = values.map((value) => value.trim()).filter(Boolean);
    if (cleaned.length === 0) return "text";
    const lower = cleaned.map((value) => value.toLowerCase());
    if (lower.every((value) => ["true", "false", "yes", "no", "checked", "unchecked"].includes(value))) return "checkbox";
    if (cleaned.every((value) => Number.isFinite(Number(value.replace(/[$,¥￥€£\s]/g, ""))))) return "number";
    if (cleaned.every((value) => Number.isFinite(Date.parse(value))) && cleaned.some((value) => /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value))) return "date";
    if (cleaned.some((value) => value.includes(","))) return "multi-select";
    const unique = new Set(cleaned);
    if (unique.size <= Math.min(12, Math.max(3, Math.ceil(cleaned.length / 2)))) return "select";
    return "text";
  }

  private parseCsvMarkdownCellValue(raw: string, type: ColumnDef["type"], key = ""): unknown {
    const text = raw.trim();
    if (!text) return "";
    if (type === "number" || type === "currency") {
      const n = Number(text.replace(/[$,¥￥€£\s]/g, ""));
      return Number.isFinite(n) ? n : text;
    }
    if (type === "date") {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
      return text;
    }
    if (type === "checkbox") {
      return ["true", "yes", "checked", "1", "✓"].includes(text.toLowerCase());
    }
    if (type === "multi-select") return this.splitMultiValue(text, key);
    return text;
  }

  private splitMultiValue(value: string, key = ""): string[] {
    return isObsidianTagsKey(key)
      ? toMultiSelectValuesForKey(key, value)
      : value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  private async ensureVaultFolder(folderPath: string): Promise<void> {
    const parts = normalizePath(folderPath || "").split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private getAvailableVaultPath(folder: string, filename: string): string {
    const safeFolder = normalizePath(folder || "");
    const safeName = this.sanitizeFilename(filename.replace(/\.md$/i, "")) + ".md";
    const dot = safeName.lastIndexOf(".");
    const base = dot >= 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot >= 0 ? safeName.slice(dot) : "";
    let candidate = normalizePath(safeFolder ? `${safeFolder}/${safeName}` : safeName);
    let index = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(safeFolder ? `${safeFolder}/${base} ${index}${ext}` : `${base} ${index}${ext}`);
      index++;
    }
    return candidate;
  }

  private sanitizeFilename(value: string): string {
    return String(value || "Untitled").replace(/[\\/:"*?<>|#^[\]]/g, "-").trim() || "Untitled";
  }

  private createFallbackDatabase(): DatabaseConfig {
    const schema = { columns: [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" } as ColumnDef], computedFields: [] as any[] };
    return {
      id: generateId(),
      name: t("common.database"),
      sourceFolder: "",
      schema,
      views: [{
        id: generateId(),
        name: t("common.tableView"),
        viewType: "table",
        sourceFolder: "",
        schema,
      }],
    };
  }

  private createDefaultView(db: DatabaseConfig): ViewConfig {
    return {
      id: generateId(),
      name: t("common.tableView"),
      viewType: "table",
      sourceFolder: "",
      schema: db.schema,
    };
  }

  private createConfigFromBase(file: TFile, source: string): { config: DatabaseConfig; inferredColumns: BaseImportColumn[]; mapViewDowngraded: boolean } {
    const parsed = this.parseBaseFile(source);
    if (parsed.unsupportedFilters) {
      throw new Error(t("errors.unsupportedBaseFilters"));
    }
    const baseThisFilePath = file.path;
    const sourceFolder = parsed.sourceFolder;
    const sourceRules = parsed.sourceRules;
    const sourceRuleTree = parsed.sourceRuleTree;
    const createFolder = this.getBaseCreateFolder(sourceFolder, sourceRules, sourceRuleTree);
    const baseComputedFields: ComputedFieldDef[] = Object.entries(parsed.formulas).map(([key, expression]) => ({
      key,
      label: this.getBasePropertyDisplayName(parsed.properties, `formula.${key}`, key),
      expression,
      type: "text",
      expressionSyntax: "base" as const,
    }));

    // Collect all columns from all views. Obsidian Bases can show file.*
    // fields, but only file.name maps to a supported built-in column here.
    // Other file.* fields are preserved for sort/group rules, not editable
    // frontmatter columns.
    const allColumnKeys = new Map<string, string>();
    for (const bv of parsed.views) {
      for (const raw of this.getBaseViewOrderKeys(bv)) {
        const key = this.cleanBaseKey(raw);
        if (!this.shouldImportBaseColumn(key)) continue;
        const label = this.getBasePropertyDisplayName(parsed.properties, raw, key === "file.name" ? t("defaults.nameColumn") : key);
        if (!allColumnKeys.has(key)) allColumnKeys.set(key, label);
      }
      if (bv.image) {
        const key = this.cleanBaseKey(bv.image);
        if (key && this.shouldImportBaseColumn(key) && !allColumnKeys.has(key)) {
          allColumnKeys.set(key, this.getBasePropertyDisplayName(parsed.properties, bv.image, key));
        }
      }
      for (const raw of Object.keys(bv.summaries || {})) {
        const key = this.cleanBaseKey(raw);
        if (key && this.shouldImportBaseColumn(key) && !allColumnKeys.has(key)) {
          allColumnKeys.set(key, this.getBasePropertyDisplayName(parsed.properties, raw, key));
        }
      }
    }
    for (const computed of baseComputedFields) {
      const key = `formula.${computed.key}`;
      if (!allColumnKeys.has(key)) allColumnKeys.set(key, computed.label);
    }
    // Ensure file.name exists
    if (!allColumnKeys.has("file.name")) allColumnKeys.set("file.name", t("defaults.nameColumn"));

    // Scan source folder for additional frontmatter properties and collect value samples
    const sampleValues = new Map<string, unknown[]>();
    const fileCounts = new Map<string, number>();
    collectFileFrontmatterKeys(this.app, sourceFolder, parsed.sourceRules, allColumnKeys, sampleValues, fileCounts, parsed.sourceLogic, sourceRuleTree, baseComputedFields, [], file);
    for (const [key, label] of Array.from(allColumnKeys.entries())) {
      allColumnKeys.set(key, this.getBasePropertyDisplayName(parsed.properties, key, label));
    }
    const preliminaryColumns: ColumnDef[] = Array.from(allColumnKeys.keys()).map((key) => (
      key.startsWith("formula.")
        ? { key, label: allColumnKeys.get(key) || key, type: "computed", computedKey: key.slice("formula.".length) }
        : { key, label: allColumnKeys.get(key) || key, type: inferColumnType(key, sampleValues.get(key) || []) }
    ));
    const computedSamples = collectComputedFieldSamples(
      this.app,
      sourceFolder,
      parsed.sourceRules,
      parsed.sourceLogic,
      sourceRuleTree,
      baseComputedFields,
      preliminaryColumns,
      10,
      file
    );
    for (const computed of baseComputedFields) {
      const inferred = inferColumnType(computed.key, computedSamples.get(computed.key) || []);
      if (inferred === "number" || inferred === "date" || inferred === "checkbox") computed.type = inferred;
    }

    const STATUS_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink"] as const;
    const inferredColumns: BaseImportColumn[] = [];
    const schema = {
      columns: Array.from(allColumnKeys.entries()).map(([key, label]) => {
        if (key.startsWith("formula.")) {
          const computedKey = key.slice("formula.".length);
          const col: ColumnDef = { key, label, type: "computed", computedKey };
          return col;
        }
        const type = inferColumnType(key, sampleValues.get(key) || []);
        const col: any = { key, label, type };
        // For tags field, pre-populate options from vault tags
        if (isObsidianTagsKey(key) && type === "multi-select") {
          const vaultTags = getVaultTags(this.app, sourceFolder, parsed.sourceRules, parsed.sourceLogic, sourceRuleTree, baseComputedFields, [], file);
          if (vaultTags.length > 0) {
            col.statusOptions = vaultTags.map((tag: string, i: number) => ({
              value: tag,
              color: STATUS_COLORS[i % STATUS_COLORS.length],
            }));
          }
        }
        // For other multi-select fields inferred from list data, collect unique values as options
        if (type === "multi-select" && !isObsidianTagsKey(key)) {
          const uniqueValues = collectUniqueListValues(this.app, key, sourceFolder, parsed.sourceRules, parsed.sourceLogic, sourceRuleTree, baseComputedFields, [], file);
          if (uniqueValues.length > 0) {
            col.statusOptions = uniqueValues.map((val: string, i: number) => ({
              value: val,
              color: STATUS_COLORS[i % STATUS_COLORS.length],
            }));
          }
        }
        if (key !== "file.name") inferredColumns.push({ ...col, fileCount: fileCounts.get(key) || 0 });
        return col;
      }),
      computedFields: baseComputedFields,
    };

    // Build views from parsed .base data
    const views: ViewConfig[] = parsed.views
      .filter((bv) => bv.type === "table" || bv.type === "cards" || bv.type === "list" || bv.type === "map")
      .map((bv) => {
      const viewType = bv.type === "cards" ? "gallery" : bv.type === "list" ? "list" : "table";
      const galleryImageField = bv.image ? this.cleanBaseKey(bv.image) : undefined;
      const schemaColumnKeys = new Set(schema.columns.map(c => c.key));
      const importedGalleryImageField = galleryImageField && schemaColumnKeys.has(galleryImageField) ? galleryImageField : undefined;
      const baseOrderKeys = this.getBaseViewOrderKeys(bv);
      const viewColumnKeys = new Set(baseOrderKeys.map(k => this.cleanBaseKey(k)).filter(key => schemaColumnKeys.has(key)));
      if (importedGalleryImageField) viewColumnKeys.add(importedGalleryImageField);
      const hiddenColumns = schema.columns
        .filter(c => !viewColumnKeys.has(c.key))
        .map(c => c.key);

      // Map columnSize keys to our schema columns
      const columnOrder = baseOrderKeys.map(k => this.cleanBaseKey(k)).filter(key => schemaColumnKeys.has(key));

      // Extract sort rules
      const sortRules: SortRule[] = (bv.sort || [])
        .map((s: any) => ({
          field: this.cleanBaseKey(s.property),
          direction: (s.direction || "ASC").toLowerCase() === "desc" ? "desc" as const : "asc" as const,
        }))
        .filter((rule: SortRule) => this.isBaseViewRuleField(rule.field, schemaColumnKeys));

      // Primary sort column/direction (first sort rule)
      const primarySort = sortRules[0];
      const groupByField = bv.groupBy ? this.cleanBaseKey(bv.groupBy.property) : undefined;
      const importedGroupByField = groupByField && this.isBaseViewRuleField(groupByField, schemaColumnKeys) ? groupByField : undefined;
      const groupOrders = importedGroupByField
        ? this.getBaseGroupOrders(bv, importedGroupByField, sourceFolder, sourceRules, parsed.sourceLogic, combineSourceRuleTrees(sourceRuleTree, bv.sourceRuleTree), baseComputedFields, schema.columns, file)
        : undefined;

      const columnWidths = this.getBaseViewColumnWidths(bv.columnSize, schemaColumnKeys);

      const view: ViewConfig = {
        id: generateId(),
        name: bv.name || (viewType === "gallery" ? t("common.galleryView") : viewType === "list" ? t("common.listView") : t("common.tableView")),
        viewType,
        sourceFolder,
        sourceRules: (bv.sourceRules || sourceRules).length > 0 ? (bv.sourceRules || sourceRules) : undefined,
        sourceLogic: bv.sourceLogic || parsed.sourceLogic,
        sourceRuleTree: bv.sourceRuleTree,
        newRecordFolder: createFolder,
        schema,
        columnOrder,
        columnWidths,
        hiddenColumns: hiddenColumns.length > 0 ? hiddenColumns : undefined,
        sortRules: sortRules.length > 0 ? sortRules : undefined,
        sortColumn: primarySort?.field,
        sortDirection: primarySort?.direction,
        groupByField: importedGroupByField,
        groupOrders,
        resultLimit: bv.limit,
        summaryRules: this.normalizeBaseSummaryRules(bv.summaries, schemaColumnKeys),
      };

      if (viewType === "gallery") {
        view.galleryImageField = importedGalleryImageField;
        view.galleryImageAspectRatio = typeof bv.imageAspectRatio === "number" ? bv.imageAspectRatio : undefined;
        view.galleryCardSize = typeof bv.cardSize === "number" ? bv.cardSize : undefined;
        view.galleryImageFit = bv.imageFit === "contain" ? "contain" : bv.imageFit === "cover" ? "cover" : undefined;
      }

      return view;
    });

    if (views.length === 0) {
      views.push({
        id: generateId(),
        name: t("common.tableView"),
        viewType: "table",
        sourceFolder,
        sourceRules: sourceRules.length > 0 ? sourceRules : undefined,
        sourceLogic: parsed.sourceLogic,
        sourceRuleTree,
        newRecordFolder: createFolder,
        schema,
        columnOrder: schema.columns.map(c => c.key),
      });
    }

    const config: DatabaseConfig = {
      id: generateId(),
      name: file.basename,
      sourceFolder,
      sourceRules: sourceRules.length > 0 ? sourceRules : undefined,
      sourceLogic: parsed.sourceLogic,
      sourceRuleTree,
      baseThisFilePath,
      newRecordFolder: createFolder,
      computedSyncMode: "display-only",
      summaryFormulas: Object.keys(parsed.summaries).length > 0 ? parsed.summaries : undefined,
      schema,
      views,
    };
    return { config, inferredColumns, mapViewDowngraded: parsed.mapViewCount > 0 };
  }

  private getBaseGroupOrders(
    view: { groupBy?: { direction?: string }; [key: string]: any },
    field: string,
    sourceFolder: string,
    sourceRules: NonNullable<ViewConfig["sourceRules"]>,
    sourceLogic: "and" | "or",
    sourceRuleTree: SourceRuleNode | undefined,
    computedFields: DatabaseConfig["schema"]["computedFields"],
    columns: ColumnDef[],
    baseThisFile?: TFile
  ): Record<string, string[]> | undefined {
    const direction = String(view.groupBy?.direction || "ASC").toLowerCase() === "desc" ? "desc" : "asc";
    const values = collectUniqueStringValues(
      this.app,
      field,
      sourceFolder,
      sourceRules,
      sourceLogic,
      sourceRuleTree,
      computedFields,
      columns,
      baseThisFile
    );
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    return { [field]: direction === "desc" ? sorted.reverse() : sorted };
  }

  private getBaseCreateFolder(
    sourceFolder: string,
    sourceRules: NonNullable<ViewConfig["sourceRules"]>,
    sourceRuleTree?: SourceRuleNode
  ): string {
    const normalizeFolder = (folder: string) => {
      const normalized = normalizePath(folder || "");
      return normalized === "/" ? "" : normalized.replace(/^\/+/, "");
    };
    const normalizedSource = normalizeFolder(sourceFolder);
    const ruledFolders = getRequiredSourceRules(sourceRuleTree || {
      type: "group",
      logic: "and",
      rules: sourceRules,
    })
      .filter((rule) => rule.op === "inFolder" && rule.value)
      .map((rule) => normalizeFolder(String(rule.value)))
      .filter((folder) => !normalizedSource || !folder || folder === normalizedSource || folder.startsWith(`${normalizedSource}/`));
    const mostSpecificFolder = ruledFolders.reduce(
      (current, folder) => folder.length > current.length ? folder : current,
      normalizedSource
    );
    if (mostSpecificFolder || sourceFolder) return normalizePath(mostSpecificFolder || "/");
    return this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder;
  }

  /** Parse a .base file into a structured format */
  private parseBaseFile(source: string): {
    sourceFolder: string;
    sourceRules: NonNullable<ViewConfig["sourceRules"]>;
    sourceLogic: "and" | "or";
    sourceRuleTree?: SourceRuleNode;
    unsupportedFilters: boolean;
    views: Array<{
      type: string;
      name: string;
      order: string[];
      sort: Array<{ property: string; direction: string }>;
      columnSize: Record<string, number>;
      groupBy?: { property: string; direction: string };
      image?: string;
      imageAspectRatio?: number;
      cardSize?: number;
      imageFit?: "cover" | "contain";
      limit?: number;
      summaries?: Record<string, string>;
      sourceRuleTree?: SourceRuleNode;
      sourceRules?: NonNullable<ViewConfig["sourceRules"]>;
      sourceLogic?: "and" | "or";
      unsupportedFilters?: boolean;
      coordinates?: string;
      markerIcon?: string;
      markerColor?: string;
      [key: string]: any;
    }>;
    formulas: Record<string, string>;
    properties: Record<string, any>;
    summaries: Record<string, string>;
    mapViewCount: number;
  } {
    const result = {
      sourceFolder: "",
      sourceRules: [] as NonNullable<ViewConfig["sourceRules"]>,
      sourceLogic: "and" as "and" | "or",
      sourceRuleTree: undefined as SourceRuleNode | undefined,
      unsupportedFilters: false,
      views: [] as any[],
      formulas: {} as Record<string, string>,
      properties: {} as Record<string, any>,
      summaries: {} as Record<string, string>,
      mapViewCount: 0,
    };

    let parsed: Record<string, any> | null = null;
    try {
      parsed = parseYaml(source) as Record<string, any> | null;
    } catch {
      parsed = null;
    }
    if (parsed) {
      result.sourceFolder = String(parsed["sourceFolder"] || "");
      result.formulas = this.getBaseFormulas(parsed["formulas"]);
      result.properties = parsed["properties"] && typeof parsed["properties"] === "object" ? parsed["properties"] : {};
      result.summaries = this.getBaseStringMap(parsed["summaries"]);
      const filters = this.parseBaseFilters(parsed["filters"]);
      result.sourceRuleTree = filters.sourceRuleTree;
      result.sourceRules = getPositiveSourceRules(filters.sourceRuleTree);
      result.sourceLogic = filters.sourceRuleTree && isSourceRuleGroup(filters.sourceRuleTree) ? filters.sourceRuleTree.logic : "and";
      result.unsupportedFilters = !filters.supported;
      if (Array.isArray(parsed["views"])) {
        result.views = parsed["views"].map((view: unknown) => this.parseBaseYamlView(view)).filter((view): view is any => !!view);
        result.unsupportedFilters = result.unsupportedFilters || result.views.some((view) => !!view.unsupportedFilters);
      }
    } else {
      const sfMatch = source.match(/sourceFolder\s*:\s*["']?([^"'\n]+)["']?/);
      if (sfMatch) result.sourceFolder = sfMatch[1].trim();
      const filters = this.getBaseGlobalFilters(source);
      result.sourceRuleTree = filters.sourceRuleTree;
      result.sourceRules = getPositiveSourceRules(filters.sourceRuleTree);
      result.sourceLogic = filters.sourceRuleTree && isSourceRuleGroup(filters.sourceRuleTree) ? filters.sourceRuleTree.logic : "and";
      result.unsupportedFilters = !filters.supported;
    }

    if (result.views.length === 0) {
      // Parse the views: section manually (line-by-line) for older or partially invalid files.
      const lines = source.split("\n");
      let inViews = false;
      let viewStartLine = -1;

      for (let i = 0; i < lines.length; i++) {
        if (/^views\s*:\s*$/.test(lines[i].trim())) {
          inViews = true;
          continue;
        }
        if (inViews && /^\s*-\s+type\s*:/.test(lines[i])) {
          if (viewStartLine >= 0) {
            result.views.push(this.parseBaseViewEntry(lines, viewStartLine, i));
          }
          viewStartLine = i;
        }
      }
      if (viewStartLine >= 0) {
        result.views.push(this.parseBaseViewEntry(lines, viewStartLine, lines.length));
      }
    }

    // Fallback: if no views array found, try old flat format
    if (result.views.length === 0) {
      const orderKeys = this.extractListSectionValues(source, "order");
      if (orderKeys.length > 0) {
        result.views.push({
          type: "table",
          name: t("common.tableView"),
          order: orderKeys,
          sort: [],
          columnSize: {},
        });
      }
    }

    result.mapViewCount = result.views.filter((view) => view?.type === "map").length;
    return result;
  }

  private parseBaseYamlView(view: unknown): any | undefined {
    if (!view || typeof view !== "object") return undefined;
    const source = view as Record<string, any>;
    const filters = this.parseBaseFilters(source["filters"]);
    const sourceRuleTree = filters.sourceRuleTree;
    return {
      type: String(source["type"] || "table"),
      name: source["name"] != null ? String(source["name"]) : "",
      order: Array.isArray(source["order"]) ? source["order"].map((item: unknown) => String(item)) : [],
      sort: Array.isArray(source["sort"]) ? source["sort"] : [],
      columnSize: source["columnSize"] && typeof source["columnSize"] === "object" ? source["columnSize"] : {},
      groupBy: source["groupBy"] && typeof source["groupBy"] === "object" ? source["groupBy"] : undefined,
      image: source["image"] != null ? String(source["image"]) : undefined,
      imageAspectRatio: typeof source["imageAspectRatio"] === "number" ? source["imageAspectRatio"] : undefined,
      cardSize: typeof source["cardSize"] === "number" ? source["cardSize"] : undefined,
      imageFit: source["imageFit"] === "cover" || source["imageFit"] === "contain" ? source["imageFit"] : undefined,
      limit: this.parseBaseLimit(source["limit"]),
      summaries: this.getBaseStringMap(source["summaries"]),
      coordinates: source["coordinates"] != null ? String(source["coordinates"]) : undefined,
      markerIcon: source["markerIcon"] != null ? String(source["markerIcon"]) : undefined,
      markerColor: source["markerColor"] != null ? String(source["markerColor"]) : undefined,
      latitude: source["latitude"] != null ? String(source["latitude"]) : undefined,
      longitude: source["longitude"] != null ? String(source["longitude"]) : undefined,
      lat: source["lat"] != null ? String(source["lat"]) : undefined,
      lng: source["lng"] != null ? String(source["lng"]) : undefined,
      sourceRuleTree,
      sourceRules: getPositiveSourceRules(sourceRuleTree),
      sourceLogic: sourceRuleTree && isSourceRuleGroup(sourceRuleTree) ? sourceRuleTree.logic : "and",
      unsupportedFilters: !filters.supported,
    };
  }

  /** Parse a single view entry from the views: array */
  private parseBaseViewEntry(lines: string[], start: number, end: number): any {
    const entryIndent = lines[start].match(/^(\s*)/)?.[1].length || 0;
    const view: any = { type: "table", name: "", order: [], sort: [], columnSize: {} };
    let section = ""; // "order" | "sort" | "columnSize" | "groupBy" | ""
    let sortEntry: any = null;

    for (let i = start; i < end; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;
      const indent = line.match(/^(\s*)/)?.[1].length || 0;

      // First line: "- type: table"
      if (i === start) {
        const m = trimmed.match(/^-\s*type\s*:\s*(\S+)/);
        if (m) view.type = m[1];
        continue;
      }

      // Stop if we've reached a sibling entry (same or lesser indent)
      if (indent <= entryIndent) break;

      // Section headers
      if (/^order\s*:\s*$/.test(trimmed)) { section = "order"; continue; }
      if (/^sort\s*:\s*$/.test(trimmed)) { section = "sort"; continue; }
      if (/^columnSize\s*:\s*$/.test(trimmed)) { section = "columnSize"; continue; }
      if (/^groupBy\s*:\s*$/.test(trimmed)) { section = "groupBy"; view.groupBy = {}; continue; }

      // Simple key-value at view level
      const nameM = trimmed.match(/^name\s*:\s*(.*)/);
      if (nameM) { view.name = nameM[1].trim(); section = ""; continue; }
      const typeM = trimmed.match(/^type\s*:\s*(.*)/);
      if (typeM) { view.type = typeM[1].trim(); section = ""; continue; }
      const simpleM = trimmed.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)/);
      if (simpleM && indent <= entryIndent + 2) {
        const key = simpleM[1];
        const value = simpleM[2].trim().replace(/^["']|["']$/g, "");
        section = "";
        if (key === "image") view.image = value;
        else if (key === "imageAspectRatio") {
          const ratio = Number(value);
          if (Number.isFinite(ratio)) view.imageAspectRatio = ratio;
        } else if (key === "cardSize") {
          const size = Number(value);
          if (Number.isFinite(size)) view.cardSize = size;
        } else if (key === "imageFit" && (value === "cover" || value === "contain")) {
          view.imageFit = value;
        } else if (key === "limit") {
          view.limit = this.parseBaseLimit(value);
        } else if (key === "coordinates" || key === "markerIcon" || key === "markerColor" || key === "latitude" || key === "longitude" || key === "lat" || key === "lng") {
          view[key] = value;
        }
        continue;
      }

      // List items (order, sort)
      const liM = trimmed.match(/^-\s+(.*)/);
      if (liM) {
        const item = liM[1];
        if (section === "order") {
          view.order.push(item);
        } else if (section === "sort") {
          const kv = item.match(/(\w[\w-]*)\s*:\s*(.*)/);
          if (kv) {
            if (!sortEntry) sortEntry = {};
            sortEntry[kv[1]] = kv[2].trim();
            if (kv[1] === "direction") {
              view.sort.push(sortEntry);
              sortEntry = null;
            }
          }
        }
        continue;
      }

      // Sort entry continuation (e.g., "direction: DESC" after "- property: status")
      if (section === "sort" && sortEntry) {
        const kv = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)/);
        if (kv) {
          sortEntry[kv[1]] = kv[2].trim();
          if (kv[1] === "direction") {
            view.sort.push(sortEntry);
            sortEntry = null;
          }
          continue;
        }
      }

      // Column size entries: "file.name: 280"
      if (section === "columnSize") {
        const csM = trimmed.match(/^(.+?)\s*:\s*(\d+)/);
        if (csM) { view.columnSize[csM[1]] = parseInt(csM[2]); continue; }
      }

      // GroupBy entries: "property: category"
      if (section === "groupBy" && view.groupBy) {
        const gbM = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)/);
        if (gbM) { (view.groupBy as any)[gbM[1]] = gbM[2].trim(); continue; }
      }
    }

    return view;
  }

  private cleanBaseKey(raw: string): string {
    let key = raw.trim().replace(/^["']|["']$/g, "");
    const bracket = key.match(/^(file\.properties|file|formula|note|properties)\[\s*(["'])([\s\S]+?)\2\s*\]$/);
    if (bracket) {
      const value = bracket[3].trim();
      if (!value) return "";
      if (bracket[1] === "note" || bracket[1] === "properties" || bracket[1] === "file.properties") return value;
      return `${bracket[1]}.${value}`;
    }
    if (key.startsWith("note.")) key = key.slice("note.".length);
    if (key.startsWith("properties.")) key = key.slice("properties.".length);
    if (key.startsWith("file.properties.")) key = key.slice("file.properties.".length);
    if (key === "name") return "file.name";
    return key;
  }

  private shouldImportBaseColumn(key: string): boolean {
    return !key.startsWith("file.") || isBaseFileField(key) || key.startsWith("formula.");
  }

  private getBaseViewOrderKeys(view: { order?: string[]; type?: string; [key: string]: any }): string[] {
    const keys = [...(Array.isArray(view.order) ? view.order : [])];
    if (view.type === "map") {
      for (const candidate of ["coordinates", "markerIcon", "markerColor", "latitude", "longitude", "lat", "lng"]) {
        const raw = view[candidate];
        if (typeof raw === "string" && raw.trim()) keys.push(raw);
      }
    }
    return Array.from(new Set(keys));
  }

  private parseBaseLimit(value: unknown): number | undefined {
    const limit = typeof value === "number" ? value : Number(value);
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
  }

  private getBaseFormulas(value: unknown): Record<string, string> {
    return this.getBaseStringMap(value);
  }

  private getBaseStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const map: Record<string, string> = {};
    for (const [key, expression] of Object.entries(value as Record<string, unknown>)) {
      if (expression != null && key.trim()) map[key.trim()] = String(expression);
    }
    return map;
  }

  private normalizeBaseSummaryRules(value: unknown, schemaColumnKeys: Set<string>): Record<string, string> | undefined {
    const rules = this.getBaseStringMap(value);
    const normalized: Record<string, string> = {};
    for (const [rawKey, summary] of Object.entries(rules)) {
      const key = this.cleanBaseKey(rawKey);
      if (this.isBaseViewRuleField(key, schemaColumnKeys) && summary.trim()) normalized[key] = summary.trim();
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  private isBaseViewRuleField(key: string, schemaColumnKeys: Set<string>): boolean {
    return schemaColumnKeys.has(key) || BASE_FILE_FIELD_KEYS.has(key);
  }

  private getBaseViewColumnWidths(
    columnSize: Record<string, number> | undefined,
    schemaColumnKeys: Set<string>
  ): Record<string, number> | undefined {
    const widths: Record<string, number> = {};
    for (const [rawKey, rawWidth] of Object.entries(columnSize || {})) {
      const key = this.cleanBaseKey(rawKey);
      const width = Number(rawWidth);
      if (!key || !schemaColumnKeys.has(key) || !Number.isFinite(width) || width <= 0) continue;
      widths[key] = Math.max(28, Math.round(width));
    }
    return Object.keys(widths).length > 0 ? widths : undefined;
  }

  private getBasePropertyDisplayName(properties: Record<string, any>, rawKey: string, fallback: string): string {
    const key = this.cleanBaseKey(rawKey);
    const candidates = [rawKey, key];
    if (key.startsWith("formula.")) candidates.push(`formula.${key.slice("formula.".length)}`);
    for (const candidate of candidates) {
      const prop = properties?.[candidate];
      if (prop && typeof prop === "object" && prop["displayName"] != null) return String(prop["displayName"]);
    }
    return fallback;
  }

  private getBaseGlobalFilters(source: string): { sourceRuleTree?: SourceRuleNode; supported: boolean } {
    try {
      const parsed = parseYaml(source) as Record<string, unknown> | null;
      const filters = parsed?.["filters"];
      if (!filters) return { supported: true };
      const sourceRuleTree = this.parseBaseSourceRuleNode(filters);
      return { sourceRuleTree, supported: !!sourceRuleTree };
    } catch {
      return { supported: false };
    }
  }

  private parseBaseFilters(filters: unknown): { sourceRuleTree?: SourceRuleNode; supported: boolean } {
    if (!filters) return { supported: true };
    const sourceRuleTree = this.parseBaseSourceRuleNode(filters);
    return { sourceRuleTree, supported: !!sourceRuleTree };
  }

  private parseBaseSourceRuleNode(value: unknown): SourceRuleNode | undefined {
    if (typeof value === "string") return this.parseBaseSourceRuleExpression(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length !== 1) return undefined;
    const [operator, children] = entries[0];
    if (operator === "not") {
      const child = Array.isArray(children)
        ? (children.length === 1 ? children[0] : { or: children })
        : children;
      const rule = this.parseBaseSourceRuleNode(child);
      return rule ? { type: "not", rule } : undefined;
    }
    if ((operator !== "and" && operator !== "or") || !Array.isArray(children)) return undefined;
    const rules = children.map((child) => this.parseBaseSourceRuleNode(child));
    if (rules.some((rule) => !rule)) return undefined;
    return { type: "group", logic: operator, rules: rules as SourceRuleNode[] };
  }

  private parseBaseSourceRuleExpression(expression: string): SourceRuleNode | undefined {
    const source = this.stripBaseOuterParens(expression.trim());
    const orParts = this.splitBaseLogicalExpression(source, "||");
    if (orParts) return this.parseBaseLogicalSourceRuleParts(orParts, "or", source);
    const andParts = this.splitBaseLogicalExpression(source, "&&");
    if (andParts) return this.parseBaseLogicalSourceRuleParts(andParts, "and", source);
    if (source.startsWith("!") && !source.startsWith("!=")) {
      const negated = this.stripBaseOuterParens(source.slice(1).trim());
      if (negated) {
        const rule = this.parseBaseSourceRuleExpression(negated);
        if (rule && !("type" in rule) && (rule.op === "empty" || rule.op === "notempty")) {
          return { ...rule, op: rule.op === "empty" ? "notempty" : "empty" };
        }
        return rule ? { type: "not", rule } : { type: "expression", expression: source };
      }
    }
    let match = source.match(/^file\.inFolder\((.*)\)$/);
    if (match) {
      const folders = this.parseBaseStringArguments(match[1])
        ?.map((folder) => folder.trim())
        .filter((folder) => folder.length > 0);
      if (folders?.length === 1) return { field: "folder", op: "inFolder", value: folders[0] };
      if (folders && folders.length > 1) {
        return {
          type: "group",
          logic: "or",
          rules: folders.map((folder) => ({ field: "folder", op: "inFolder", value: folder })),
        };
      }
    }
    match = source.match(/^file\.hasTag\((.*)\)$/);
    if (match) {
      const tags = this.parseBaseStringArguments(match[1])
        ?.map((tag) => tag.trim().replace(/^#/, ""))
        .filter((tag) => tag.length > 0);
      if (tags?.length === 1) return { field: "tags", op: "hasTag", value: tags[0] };
      if (tags && tags.length > 1) {
        return {
          type: "group",
          logic: "or",
          rules: tags.map((tag) => ({ field: "tags", op: "hasTag", value: tag })),
        };
      }
    }
    match = source.match(/^file\.hasProperty\((.*)\)$/);
    if (match) {
      const properties = this.parseBaseStringArguments(match[1])
        ?.map((property) => this.cleanBaseKey(property.trim()))
        .filter((property) => property.length > 0);
      if (properties?.length === 1) return { field: properties[0], op: "hasProperty" };
      if (properties && properties.length > 1) {
        return {
          type: "group",
          logic: "and",
          rules: properties.map((property) => ({ field: property, op: "hasProperty" })),
        };
      }
    }
    match = source.match(/^file\.hasLink\((.*)\)$/);
    if (match) {
      const link = this.parseBaseLinkTargetArgument(match[1]);
      if (link) return { field: "file.links", op: "hasLink", value: link };
    }
    match = source.match(/^(\/(?:\\.|[^/\\\n])*\/[a-z]*)\.matches\((.*)\)$/);
    if (match) {
      const field = this.parseBaseRuleFieldOperand(match[2]);
      if (!field || this.isUnsupportedBaseSourceRuleField(field)) {
        return { type: "expression", expression: source };
      }
      return { field, op: "matches", value: match[1] };
    }
    const comparison = this.splitBaseBinaryOperator(source, [">=", "<=", ">", "<"]);
    if (comparison) {
      const field = this.parseBaseRuleFieldOperand(comparison.left);
      const value = this.parseBaseComparisonValue(comparison.right);
      if (field && value && !this.isUnsupportedBaseSourceRuleField(field)) {
        const op = comparison.operator === ">" ? "gt" : comparison.operator === ">=" ? "gte" : comparison.operator === "<" ? "lt" : "lte";
        return { field, op, value };
      }
      const reversedField = this.parseBaseRuleFieldOperand(comparison.right);
      const reversedValue = this.parseBaseComparisonValue(comparison.left);
      if (!reversedField || !reversedValue || this.isUnsupportedBaseSourceRuleField(reversedField)) {
        return { type: "expression", expression: source };
      }
      const reversedOp = comparison.operator === ">" ? "lt" : comparison.operator === ">=" ? "lte" : comparison.operator === "<" ? "gt" : "gte";
      return { field: reversedField, op: reversedOp, value: reversedValue };
    }
    const equality = this.splitBaseBinaryOperator(source, ["===", "!==", "==", "!="]);
    if (equality) {
      let field = this.parseBaseRuleFieldOperand(equality.left);
      let value = this.parseBaseEqualityValue(equality.right);
      if (!field || !value) {
        field = this.parseBaseRuleFieldOperand(equality.right);
        value = this.parseBaseEqualityValue(equality.left);
      }
      if (!field || this.isUnsupportedBaseSourceRuleField(field)) return { type: "expression", expression: source };
      if (!value) return { type: "expression", expression: source };
      const notEqual = equality.operator === "!=" || equality.operator === "!==";
      const strict = equality.operator === "===" || equality.operator === "!==";
      if (strict) {
        if (value.kind === "date") return { type: "expression", expression: source };
        if (value.kind === "null") return { field, op: notEqual ? "strictNeq" : "strictEq", value: "null", valueType: "null" };
        return { field, op: notEqual ? "strictNeq" : "strictEq", value: value.value, valueType: value.valueType };
      }
      if (value.kind === "null") return { field, op: notEqual ? "notempty" : "empty" };
      if (value.kind === "date") return { field, op: notEqual ? "neq" : "eq", value: value.value, valueType: "date" };
      return { field, op: notEqual ? "neq" : "eq", value: value.value, valueType: value.valueType };
    }
    match = source.match(/^(.+?)\.contains\((.*)\)$/);
    if (match) {
      const field = this.parseBaseRuleFieldOperand(match[1]);
      const args = this.parseBaseContainmentArguments(match[2]);
      if (!field || args?.length !== 1 || this.isUnsupportedBaseSourceRuleField(field)) {
        return { type: "expression", expression: source };
      }
      const arg = this.normalizeBaseContainmentValueForField(field, args[0]);
      return { field, op: "contains", value: arg.value, valueType: arg.valueType };
    }
    match = source.match(/^(.+?)\.(containsAll|containsAny)\((.*)\)$/);
    if (match) {
      const field = this.parseBaseRuleFieldOperand(match[1]);
      const args = this.parseBaseContainmentArguments(match[3]);
      if (!field || !args?.length || this.isUnsupportedBaseSourceRuleField(field)) {
        return { type: "expression", expression: source };
      }
      const normalizedArgs = args.map((arg) => this.normalizeBaseContainmentValueForField(field, arg));
      if (normalizedArgs.length === 1) return { field, op: "contains", value: normalizedArgs[0].value, valueType: normalizedArgs[0].valueType };
      return {
        type: "group",
        logic: match[2] === "containsAll" ? "and" : "or",
        rules: normalizedArgs.map((arg) => ({ field, op: "contains", value: arg.value, valueType: arg.valueType })),
      };
    }
    match = source.match(/^(.+?)\.(startsWith|endsWith)\((.*)\)$/);
    if (match) {
      const field = this.parseBaseRuleFieldOperand(match[1]);
      const args = this.parseBaseStringArguments(match[3]);
      if (!field || args?.length !== 1 || this.isUnsupportedBaseSourceRuleField(field)) {
        return { type: "expression", expression: source };
      }
      return { field, op: match[2] as "startsWith" | "endsWith", value: args[0] };
    }
    match = source.match(/^!?\s*(.+?)\.isEmpty\(\s*\)$/);
    if (match) {
      const field = this.parseBaseRuleFieldOperand(match[1]);
      if (!field || this.isUnsupportedBaseSourceRuleField(field)) return { type: "expression", expression: source };
      return { field, op: source.startsWith("!") ? "notempty" : "empty" };
    }
    match = source.match(/^(.+?)\.isTruthy\(\s*\)$/);
    if (match) {
      const field = this.parseBaseRuleFieldOperand(match[1]);
      if (!field || this.isUnsupportedBaseSourceRuleField(field)) return { type: "expression", expression: source };
      return { field, op: "truthy" };
    }
    match = source.match(/^(.+?)\.isType\((.*)\)$/);
    if (match) {
      const field = this.parseBaseRuleFieldOperand(match[1]);
      const args = this.parseBaseStringArguments(match[2]);
      if (!field || args?.length !== 1 || this.isUnsupportedBaseSourceRuleField(field)) {
        return { type: "expression", expression: source };
      }
      return { field, op: "isType", value: args[0].trim() };
    }
    const truthyField = this.parseBaseRuleFieldOperand(source);
    if (truthyField && this.isBaseBareTruthyRuleField(truthyField)) return { field: truthyField, op: "truthy" };
    return { type: "expression", expression: source };
  }

  private parseBaseLogicalSourceRuleParts(parts: string[], logic: "and" | "or", fallbackExpression: string): SourceRuleNode {
    const rules = parts.map((part) => this.parseBaseSourceRuleExpression(part));
    if (rules.some((rule) => !rule)) return { type: "expression", expression: fallbackExpression };
    return { type: "group", logic, rules: rules as SourceRuleNode[] };
  }

  private splitBaseBinaryOperator(source: string, operators: string[]): { left: string; operator: string; right: string } | undefined {
    let depth = 0;
    let quote: string | null = null;
    let regex = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (regex) {
        if (char === "\\") index += 1;
        else if (char === "/") regex = false;
        continue;
      }
      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "/" && this.isBaseRegexStart(source, index)) {
        regex = true;
        continue;
      }
      if (char === "(" || char === "[" || char === "{") {
        depth += 1;
        continue;
      }
      if (char === ")" || char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth !== 0) continue;
      for (const operator of operators) {
        if (!source.startsWith(operator, index)) continue;
        const left = source.slice(0, index).trim();
        const right = source.slice(index + operator.length).trim();
        return left && right ? { left, operator, right } : undefined;
      }
    }
    return undefined;
  }

  private parseBaseComparisonValue(rawValue: string): string | undefined {
    const value = rawValue.trim();
    const date = value.match(/^date\((.*)\)$/);
    if (date) {
      const args = this.parseBaseStringArguments(date[1]);
      return args?.length === 1 ? args[0] : undefined;
    }
    const number = this.parseBaseNumberValue(value);
    if (number != null) return number;
    const quoted = this.parseBaseStringArguments(value);
    if (quoted?.length === 1) return quoted[0];
    if (/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-Z]*)?$/.test(value)) return value;
    return undefined;
  }

  private parseBaseEqualityValue(rawValue: string): { kind: "value"; value: string; valueType: "string" | "number" | "boolean" } | { kind: "date"; value: string } | { kind: "null" } | undefined {
    const value = rawValue.trim();
    if (value === "null") return { kind: "null" };
    if (value === "true" || value === "false") return { kind: "value", value, valueType: "boolean" };
    const date = value.match(/^date\((.*)\)$/);
    if (date) {
      const args = this.parseBaseStringArguments(date[1]);
      return args?.length === 1 ? { kind: "date", value: args[0] } : undefined;
    }
    const quoted = this.parseBaseStringArguments(value);
    if (quoted?.length === 1) return { kind: "value", value: quoted[0], valueType: "string" };
    const linkTarget = this.parseBaseLinkTargetValue(value);
    if (linkTarget) return { kind: "value", value: `[[${linkTarget}]]`, valueType: "string" };
    const number = this.parseBaseNumberValue(value);
    if (number != null) return { kind: "value", value: number, valueType: "number" };
    if (/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-Z]*)?$/.test(value)) return { kind: "value", value, valueType: "string" };
    return undefined;
  }

  private parseBaseContainmentArguments(rawArgs: string): Array<{ value: string; valueType: "string" | "number" | "boolean" | "null" }> | undefined {
    const parts = this.splitBaseArguments(rawArgs);
    if (!parts) return undefined;
    const values: Array<{ value: string; valueType: "string" | "number" | "boolean" | "null" }> = [];
    for (const part of parts) {
      const source = part.trim();
      if (!source) return undefined;
      if (source.startsWith("[") && source.endsWith("]")) {
        const nested = this.parseBaseContainmentArguments(source.slice(1, -1));
        if (!nested) return undefined;
        values.push(...nested);
        continue;
      }
      const value = this.parseBaseContainmentValue(source);
      if (!value) return undefined;
      values.push(value);
    }
    return values;
  }

  private parseBaseContainmentValue(rawValue: string): { value: string; valueType: "string" | "number" | "boolean" | "null" } | undefined {
    const value = rawValue.trim();
    if (value === "null") return { value: "null", valueType: "null" };
    if (value === "true" || value === "false") return { value, valueType: "boolean" };
    const quoted = this.parseBaseStringArguments(value);
    if (quoted?.length === 1) return { value: quoted[0], valueType: "string" };
    const linkTarget = this.parseBaseLinkTargetValue(value);
    if (linkTarget) return { value: `[[${linkTarget}]]`, valueType: "string" };
    const number = this.parseBaseNumberValue(value);
    if (number != null) return { value: number, valueType: "number" };
    if (/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-Z]*)?$/.test(value)) return { value, valueType: "string" };
    return undefined;
  }

  private normalizeBaseContainmentValueForField(
    field: string,
    value: { value: string; valueType: "string" | "number" | "boolean" | "null" }
  ): { value: string; valueType: "string" | "number" | "boolean" | "null" } {
    if ((field === "tags" || field === "file.tags") && value.valueType === "string") {
      return { ...value, value: value.value.trim().replace(/^#/, "") };
    }
    return value;
  }

  private parseBaseNumberValue(rawValue: string): string | undefined {
    const value = rawValue.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return value;
    const number = value.match(/^number\((.*)\)$/);
    if (!number) return undefined;
    const parts = this.splitBaseArguments(number[1]);
    if (!parts || parts.length !== 1) return undefined;
    const literal = this.parseBaseStaticNumberArgument(parts[0]);
    if (literal === undefined) return undefined;
    const parsed = Number(literal);
    return Number.isFinite(parsed) ? String(parsed) : undefined;
  }

  private parseBaseStaticNumberArgument(rawValue: string): string | number | boolean | null | undefined {
    const value = rawValue.trim();
    if (value === "null") return null;
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return value;
    const quoted = this.parseBaseStringArguments(value);
    return quoted?.length === 1 ? quoted[0] : undefined;
  }

  private parseBaseLinkTargetArgument(rawArgs: string): string | undefined {
    const parts = this.splitBaseArguments(rawArgs);
    if (!parts || parts.length !== 1) return undefined;
    return this.parseBaseLinkTargetValue(parts[0]);
  }

  private parseBaseLinkTargetValue(rawValue: string): string | undefined {
    const value = rawValue.trim();
    const quoted = this.parseBaseStringArguments(value);
    if (quoted?.length === 1) return quoted[0].trim() || undefined;
    const file = value.match(/^file\((.*)\)$/);
    if (file) {
      const args = this.parseBaseStringArguments(file[1]);
      return args?.length === 1 ? args[0].trim() || undefined : undefined;
    }
    const link = value.match(/^link\((.*)\)$/);
    if (link) {
      const args = this.parseBaseStringArguments(link[1]);
      return args && args.length >= 1 && args.length <= 2 ? args[0].trim() || undefined : undefined;
    }
    return undefined;
  }

  private parseBaseRuleFieldOperand(rawField: string): string | undefined {
    const field = this.stripBaseOuterParens(rawField.trim());
    const filePropertyBracket = field.match(/^file\.properties\[\s*(["'])([\s\S]+?)\1\s*\]$/);
    if (filePropertyBracket) {
      const key = filePropertyBracket[2].trim();
      return key ? key : undefined;
    }
    const bracket = field.match(/^(file|formula|note|properties)\[\s*(["'])([\s\S]+?)\2\s*\]$/);
    if (bracket) {
      const key = bracket[3].trim();
      if (!key) return undefined;
      if (bracket[1] === "note" || bracket[1] === "properties") return key;
      return `${bracket[1]}.${key}`;
    }
    if (/^(file|formula|note|properties)\.[^\s!=<>()[\]]+$/.test(field) || /^[^\s!=<>()[\].]+$/.test(field)) {
      return this.cleanBaseKey(field);
    }
    return undefined;
  }

  private isBaseBareTruthyRuleField(field: string): boolean {
    if (this.isUnsupportedBaseSourceRuleField(field)) return false;
    return !new Set([
      "Array",
      "Boolean",
      "Math",
      "Number",
      "Object",
      "String",
      "date",
      "duration",
      "escapeHTML",
      "false",
      "file",
      "formula",
      "html",
      "icon",
      "link",
      "list",
      "max",
      "min",
      "note",
      "now",
      "null",
      "properties",
      "random",
      "this",
      "today",
      "true",
    ]).has(field);
  }

  private isUnsupportedBaseSourceRuleField(field: string): boolean {
    return field.startsWith("file.") && !isBaseFileField(field);
  }

  private stripBaseOuterParens(source: string): string {
    const trimmed = source.trim();
    if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return trimmed;
    let depth = 0;
    let quote: string | null = null;
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "\"" || char === "'") {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0 && index < trimmed.length - 1) return trimmed;
    }
    return depth === 0 ? trimmed.slice(1, -1).trim() : trimmed;
  }

  private splitBaseLogicalExpression(source: string, operator: "&&" | "||"): string[] | undefined {
    const parts: string[] = [];
    let start = 0;
    let depth = 0;
    let quote: string | null = null;
    let regex = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (regex) {
        if (char === "\\") index += 1;
        else if (char === "/") regex = false;
        continue;
      }
      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "/" && this.isBaseRegexStart(source, index)) {
        regex = true;
        continue;
      }
      if (char === "(" || char === "[" || char === "{") depth += 1;
      else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
      if (depth === 0 && source.startsWith(operator, index)) {
        const part = source.slice(start, index).trim();
        if (!part) return undefined;
        parts.push(part);
        index += operator.length - 1;
        start = index + 1;
      }
    }
    if (parts.length === 0) return undefined;
    const tail = source.slice(start).trim();
    if (!tail) return undefined;
    parts.push(tail);
    return parts;
  }

  private isBaseRegexStart(source: string, slashIndex: number): boolean {
    for (let index = slashIndex - 1; index >= 0; index -= 1) {
      const char = source[index];
      if (/\s/.test(char)) continue;
      return "([{=!:,&|?".includes(char);
    }
    return true;
  }

  private splitBaseArguments(source: string): string[] | undefined {
    const parts: string[] = [];
    let start = 0;
    let depth = 0;
    let quote: string | null = null;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "\"" || char === "'") {
        quote = char;
        continue;
      }
      if (char === "(" || char === "[" || char === "{") depth += 1;
      else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
      if (depth === 0 && char === ",") {
        const part = source.slice(start, index).trim();
        if (!part) return undefined;
        parts.push(part);
        start = index + 1;
      }
    }
    if (quote || depth !== 0) return undefined;
    const tail = source.slice(start).trim();
    if (!tail && parts.length > 0) return undefined;
    if (tail) parts.push(tail);
    return parts;
  }

  private parseBaseStringArguments(rawArgs: string): string[] | undefined {
    const values: string[] = [];
    let index = 0;
    while (index < rawArgs.length) {
      while (index < rawArgs.length && /\s/.test(rawArgs[index])) index += 1;
      if (index >= rawArgs.length) break;
      const quote = rawArgs[index];
      if (quote !== "\"" && quote !== "'") return undefined;
      index += 1;
      let value = "";
      let closed = false;
      while (index < rawArgs.length) {
        const char = rawArgs[index];
        if (char === "\\") {
          index += 1;
          if (index >= rawArgs.length) return undefined;
          value += rawArgs[index];
          index += 1;
          continue;
        }
        if (char === quote) {
          closed = true;
          index += 1;
          break;
        }
        value += char;
        index += 1;
      }
      if (!closed) return undefined;
      values.push(value);
      while (index < rawArgs.length && /\s/.test(rawArgs[index])) index += 1;
      if (index >= rawArgs.length) break;
      if (rawArgs[index] !== ",") return undefined;
      index += 1;
      while (index < rawArgs.length && /\s/.test(rawArgs[index])) index += 1;
      if (index >= rawArgs.length) return undefined;
    }
    return values;
  }

  /** Assign column widths based on actual data: min(label_or_value_width, max_width) */
  private assignColumnWidthsFromData(config: DatabaseConfig): void {
    // Only assign widths to columns that don't already have one
    const columnsNeedingWidth = config.schema.columns.filter(c => !c.width);
    if (columnsNeedingWidth.length === 0) return;

    const MAX_COL_WIDTH = 250;
    const CHAR_WIDTH = 8;
    const PADDING = 32;

    const longestValues = new Map<string, number>();
    for (const col of columnsNeedingWidth) {
      longestValues.set(col.key, col.label.length);
    }

    const records = this.dataSource.getRecordsForDatabase(config);
    for (const record of records.slice(0, 200)) {
      const f = record.file;
      const fm = record.frontmatter;
      const cache = this.app.metadataCache.getFileCache(f);
      for (const col of columnsNeedingWidth) {
        if (isBaseFileField(col.key)) {
          const val = getFileFieldValue(f, col.key, fm, cache, this.app);
          if (val == null) continue;
          const len = Array.isArray(val)
            ? Math.max(...val.map((item) => String(item).length), 0)
            : typeof val === "object"
              ? JSON.stringify(val).length
              : String(val).length;
          if (len > (longestValues.get(col.key) || 0)) longestValues.set(col.key, len);
          continue;
        }
        const val = fm[col.key];
        if (val == null) continue;
        const len = Array.isArray(val)
          ? Math.max(...val.map((v: any) => String(v).length))
          : String(val).length;
        if (len > (longestValues.get(col.key) || 0)) longestValues.set(col.key, len);
      }
    }

    for (const col of columnsNeedingWidth) {
      const charLen = longestValues.get(col.key) || col.label.length;
      col.width = Math.min(charLen * CHAR_WIDTH + PADDING, MAX_COL_WIDTH);
    }
  }

  private extractListSectionValues(source: string, sectionName: string): string[] {
    const lines = source.split("\n");
    const values: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(new RegExp(`^(\\s*)${sectionName}:\\s*$`));
      if (!match) continue;
      const baseIndent = match[1].length;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line.trim()) continue;
        const indent = line.match(/^(\s*)/)?.[1].length || 0;
        if (indent <= baseIndent) break;
        const pairItem = line.match(/^\s*-\s*[\w-]+\s*:\s*(.+?)\s*$/);
        if (pairItem) { values.push(pairItem[1].trim()); continue; }
        const item = line.match(/^\s*-\s*(.+?)\s*$/);
        if (item) values.push(item[1].trim());
      }
    }
    return values.filter(Boolean);
  }

  private markDatabaseFileTabs(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as any;
      const file = view?.file as TFile | undefined;
      const tabHeaderEl = (leaf as any).tabHeaderEl as HTMLElement | undefined;
      const fm = file instanceof TFile
        ? this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined
        : undefined;
      const isDatabaseFile = file instanceof TFile && fm?.["db_view"] === true;
      tabHeaderEl?.toggleClass("note-database-file-tab", isDatabaseFile);
      view?.containerEl?.toggleClass("note-database-file-leaf", isDatabaseFile);
    }
    // 标记文件列表中的数据库文件
    this.markDatabaseFilesInExplorer();
  }

  private markDatabaseFilesInExplorer(): void {
    const fileExplorers = this.app.workspace.getLeavesOfType("file-explorer");
    for (const leaf of fileExplorers) {
      const container = leaf.view.containerEl;
      // 查找所有文件条目：.tree-item.nav-file > .tree-item-self[data-path]
      const fileItems = container.querySelectorAll<HTMLElement>(".tree-item.nav-file");
      for (const item of fileItems) {
        const self = item.querySelector<HTMLElement>(".tree-item-self[data-path]");
        const path = self?.getAttribute("data-path");
        if (!path) continue;
        const file = this.app.vault.getAbstractFileByPath(path);
        const fm = file instanceof TFile
          ? this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined
          : undefined;
        const isDb = file instanceof TFile && fm?.["db_view"] === true;

        const existingBadge = item.querySelector(".nav-file-tag.note-database-tag");
        if (isDb && !existingBadge) {
          if (self) {
            const badge = window.activeDocument.createElement("div");
            badge.className = "nav-file-tag note-database-tag";
            badge.textContent = "DB";
            self.appendChild(badge);
          }
        } else if (!isDb && existingBadge) {
          existingBadge.remove();
        }
      }
    }
  }

  /** Migrate legacy settings-based databases to vault files. */
  private async migrateDatabasesToFiles(): Promise<void> {
    const databases = this.settings.databases;
    if (!databases || databases.length === 0) return;

    let migrated = 0;
    for (const db of databases) {
      try {
        // Migrate dashboardDisplayWidth → displayWidth on each view
        for (const view of db.views || []) {
          if ((view as any).dashboardDisplayWidth && !view.displayWidth) {
            view.displayWidth = (view as any).dashboardDisplayWidth;
          }
          delete (view as any).dashboardDisplayWidth;
        }
        const uniqueName = this.getUniqueDatabaseName(db.name || t("common.database"));
        db.name = uniqueName;
        await this.dataSource.createViewDefFile(
          this.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder,
          uniqueName,
          db
        );
        migrated++;
      } catch (err) {
        console.error(`Note Database: failed to migrate database "${db.name}":`, err);
      }
    }

    this.settings.databases = [];
    this.settings.databasesMigrated = true;
    delete (this.settings as any).dashboardInitialSource;
    await this.saveSettings();

    if (migrated > 0) {
      new Notice(t("notice.databasesMigrated", { count: migrated }));
      // Refresh the dashboard view if open
      const dbView = this.getActiveDbView();
      if (dbView) {
        dbView.updateConfigs(
          this.settings.databaseFileOrder || [],
          this.settings.statusPresets || DEFAULT_SETTINGS.statusPresets,
          this.settings.defaultStatusPresetId
        );
      }
    }
  }

  onunload(): void {
    this.dataSource.destroy();
  }
}

interface ImportedMarkdownPage {
  frontmatter: Record<string, unknown>;
  body: string;
}

interface CsvMarkdownMetadata {
  format: string;
  version?: number;
  database?: DatabaseConfig;
  activeViewId?: string;
  includeFrontmatter?: boolean;
}

interface CsvMarkdownImportResult {
  databaseName: string;
  targetFolder: string;
  csvFiles: File[];
  markdownFiles: File[];
  metadataFile: File | null;
}

class CsvMarkdownImportModal extends Modal {
  private resolve?: (result: CsvMarkdownImportResult | null) => void;
  private csvFiles: File[] = [];
  private markdownFiles: File[] = [];
  private metadataFile: File | null = null;
  private databaseName = "";
  private targetFolder = "";

  constructor(app: App, private defaultFolder: string) {
    super(app);
  }

  openAndWait(): Promise<CsvMarkdownImportResult | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve?.(null);
    this.resolve = undefined;
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("note-database-modal");
    this.contentEl.createEl("h3", { text: t("csvMarkdownImport.title") });
    this.contentEl.createDiv({ cls: "db-panel-empty", text: t("csvMarkdownImport.desc") });

    const csvRow = this.contentEl.createDiv({ cls: "db-panel-row db-csv-markdown-import-row" });
    csvRow.createSpan({ text: t("csvMarkdownImport.csv") });
    const csvInput = csvRow.createEl("input", { attr: { type: "file", accept: ".csv,text/csv", multiple: "true" } });
    csvInput.addClass("db-hidden-file-input");
    const csvPicker = csvRow.createDiv({ cls: "db-file-picker" });
    const csvButton = csvPicker.createEl("button", { text: t("csvMarkdownImport.chooseCsv"), attr: { type: "button" } });
    const csvLabel = csvPicker.createSpan({ cls: "db-file-picker-label", text: t("csvMarkdownImport.noFile") });
    csvButton.onclick = () => csvInput.click();
    csvInput.onchange = () => {
      this.csvFiles = Array.from(csvInput.files || []);
      csvLabel.textContent = this.csvFiles.length > 1
        ? t("csvMarkdownImport.filesSelected", { count: this.csvFiles.length })
        : this.csvFiles[0]?.name || t("csvMarkdownImport.noFile");
      if (this.csvFiles[0] && !this.databaseName) {
        this.databaseName = this.csvFiles[0].name.replace(/\.csv$/i, "");
        nameInput.value = this.databaseName;
        folderInput.value = this.getDefaultTargetFolder();
      }
      importBtn.disabled = this.csvFiles.length === 0;
    };

    const mdRow = this.contentEl.createDiv({ cls: "db-panel-row db-csv-markdown-import-row" });
    mdRow.createSpan({ text: t("csvMarkdownImport.markdown") });
    const mdInput = mdRow.createEl("input", { attr: { type: "file", accept: ".md,.markdown,text/markdown", multiple: "true" } });
    mdInput.addClass("db-hidden-file-input");
    const mdPicker = mdRow.createDiv({ cls: "db-file-picker" });
    const mdButton = mdPicker.createEl("button", { text: t("csvMarkdownImport.chooseMarkdown"), attr: { type: "button" } });
    const mdLabel = mdPicker.createSpan({ cls: "db-file-picker-label", text: t("csvMarkdownImport.noFile") });
    mdButton.onclick = () => mdInput.click();
    mdInput.onchange = () => {
      this.markdownFiles = Array.from(mdInput.files || []);
      mdLabel.textContent = this.markdownFiles.length > 0
        ? t("csvMarkdownImport.filesSelected", { count: this.markdownFiles.length })
        : t("csvMarkdownImport.noFile");
    };

    const metadataRow = this.contentEl.createDiv({ cls: "db-panel-row db-csv-markdown-import-row" });
    metadataRow.createSpan({ text: t("csvMarkdownImport.metadata") });
    const metadataInput = metadataRow.createEl("input", { attr: { type: "file", accept: ".json,application/json" } });
    metadataInput.addClass("db-hidden-file-input");
    const metadataPicker = metadataRow.createDiv({ cls: "db-file-picker" });
    const metadataButton = metadataPicker.createEl("button", { text: t("csvMarkdownImport.chooseMetadata"), attr: { type: "button" } });
    const metadataLabel = metadataPicker.createSpan({ cls: "db-file-picker-label", text: t("csvMarkdownImport.noFile") });
    metadataButton.onclick = () => metadataInput.click();
    metadataInput.onchange = () => {
      this.metadataFile = metadataInput.files?.[0] || null;
      metadataLabel.textContent = this.metadataFile?.name || t("csvMarkdownImport.noFile");
    };

    const nameRow = this.contentEl.createDiv({ cls: "db-panel-row db-csv-markdown-import-row" });
    nameRow.createSpan({ text: t("csvMarkdownImport.databaseName") });
    const nameInput = nameRow.createEl("input", { attr: { type: "text" } });
    nameInput.value = this.databaseName;
    nameInput.oninput = () => {
      this.databaseName = nameInput.value.trim();
      folderInput.value = this.getDefaultTargetFolder();
    };

    const folderRow = this.contentEl.createDiv({ cls: "db-panel-row db-csv-markdown-import-row" });
    folderRow.createSpan({ text: t("csvMarkdownImport.targetFolder") });
    const folderInput = folderRow.createEl("input", { attr: { type: "text" } });
    folderInput.value = this.getDefaultTargetFolder();
    folderInput.oninput = () => {
      this.targetFolder = folderInput.value.trim();
    };

    const actions = this.contentEl.createDiv({ cls: "db-modal-actions" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const importBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: t("csvMarkdownImport.import"),
      attr: { type: "button" },
    });
    importBtn.disabled = true;
    importBtn.onclick = () => {
      if (this.csvFiles.length === 0) return;
      const result: CsvMarkdownImportResult = {
        databaseName: this.databaseName || this.csvFiles[0].name.replace(/\.csv$/i, ""),
        targetFolder: this.targetFolder || folderInput.value.trim() || this.getDefaultTargetFolder(),
        csvFiles: this.csvFiles,
        markdownFiles: this.markdownFiles,
        metadataFile: this.metadataFile,
      };
      const resolve = this.resolve;
      this.resolve = undefined;
      this.close();
      resolve?.(result);
    };
  }

  private getDefaultTargetFolder(): string {
    const name = this.databaseName || this.csvFiles[0]?.name.replace(/\.csv$/i, "") || "CSV Markdown import";
    const folder = this.defaultFolder || "Databases";
    return normalizePath(`${folder}/${name}`);
  }
}

class BaseFileSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private onChoose: (file: TFile) => void
  ) {
    super(app);
    this.setPlaceholder(t("baseImport.chooseBaseFilePlaceholder"));
    this.emptyStateText = t("settings.databaseFiles.emptyHint");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onOpen(): void {
    super.onOpen();
    this.titleEl.setText(t("baseImport.chooseBaseFile"));
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
