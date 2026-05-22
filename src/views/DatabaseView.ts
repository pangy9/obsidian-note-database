import { ItemView, WorkspaceLeaf, Notice, TFile, Modal, stringifyYaml } from "obsidian";
import { DataSource, NoteRecord, ViewConfigMutation } from "../data/DataSource";
import { moveDatabaseFilePath, sortDatabaseFileEntries } from "../data/DatabaseFileOrder";
import { QueryEngine } from "../data/QueryEngine";
import { PropertyService } from "../data/PropertyService";
import { ComputedFieldEngine } from "../data/ComputedField";
import {
  ensureColumnOrder,
  getColumnsInOrder,
  getVisibleColumns,
} from "../data/ColumnConfig";
import { RowPipeline } from "../data/RowPipeline";
import { ViewConfig, ColumnDef, RowData, DatabaseConfig, DatabaseViewType, GroupOrderMode, StatusOptionDef, StatusPresetDef, generateId } from "../data/types";
import {
  getDefaultCellValue as getColumnDefaultCellValue,
  getStatusPresetOptions,
  normalizeStatusPresets,
  resolveDefaultStatusPresetId,
  isOptionColumnType,
  getColumnOptionValues,
  toBooleanValue,
} from "../data/ColumnTypes";
import { getDefaultGroupOrder, getEffectiveGroupOrder } from "../data/GroupOrder";
import { isEmptyGroupId, moveMultiSelectGroupValue } from "../data/MultiSelect";
import { CellRenderer } from "./CellRenderer";
import { ColumnMenu } from "./ColumnMenu";
import { ColumnHeaderController } from "./ColumnHeaderController";
import { DatabaseViewState, ViewStateStore } from "./ViewStateStore";
import { RowMenu } from "./RowMenu";
import { TableRenderer } from "./TableRenderer";

import { SummaryRenderer } from "./SummaryRenderer";
import { FilterPanelRenderer } from "./FilterPanelRenderer";
import { ColumnManagerRenderer } from "./ColumnManagerRenderer";
import { SortPanelRenderer } from "./SortPanelRenderer";
import { ToolbarRenderer } from "./ToolbarRenderer";
import { ViewConfigPanelRenderer } from "./ViewConfigPanelRenderer";
import { ColumnOperations } from "./ColumnOperations";
import { BoardGroup, BoardRenderer } from "./BoardRenderer";
import { GalleryRenderer } from "./GalleryRenderer";
import { ListRenderer } from "./ListRenderer";
import { ColumnRenameModal } from "./modals/ColumnRenameModal";
import { DeleteDatabaseModal } from "./modals/DeleteDatabaseModal";
import { AddDatabaseModal } from "./modals/AddDatabaseModal";
import { StatusOptionsModal } from "./modals/StatusOptionsModal";
import { StatusPresetManagerModal } from "./modals/StatusPresetManagerModal";
import { FormulaModal, FormulaSaveResult } from "./modals/FormulaModal";
import { GroupOrderModal } from "./modals/GroupOrderModal";
import { t } from "../i18n";
import { createStoredZip, ZipEntry } from "../data/ZipExport";
import { getEffectiveFilterRules } from "../data/FilterRules";

export const DATABASE_VIEW_TYPE = "note-database-view";

interface CsvMarkdownExportOptions {
  includeFrontmatter: boolean;
}

interface FillTarget {
  row: RowData;
  col: ColumnDef;
}

interface ViewEntry {
  config: DatabaseConfig;
  sourcePath: string | null;
}

type HeaderPopoverKind = "filter" | "sort" | "columns" | "view";

export class DatabaseView extends ItemView {
  private dataSource: DataSource;
  private propertyService: PropertyService;
  private cellRenderer: CellRenderer;
  private columnMenu: ColumnMenu;
  private columnHeaderController: ColumnHeaderController;
  private columnOperations: ColumnOperations;
  private rowMenu: RowMenu;
  private tableRenderer: TableRenderer;
  private summaryRenderer = new SummaryRenderer();
  private filterPanelRenderer = new FilterPanelRenderer();
  private columnManagerRenderer = new ColumnManagerRenderer();
  private sortPanelRenderer = new SortPanelRenderer();
  private viewConfigPanelRenderer = new ViewConfigPanelRenderer();
  private toolbarRenderer = new ToolbarRenderer();
  private boardRenderer: BoardRenderer;
  private galleryRenderer: GalleryRenderer;
  private listRenderer: ListRenderer;
  private queryEngine = new QueryEngine();
  private rowPipeline = new RowPipeline();
  private containerEl_: HTMLElement | null = null;
  /** Settings-based database configs (source of truth for settings) */
  private databases: DatabaseConfig[] = [];
  /** Combined database entries (settings + file-based) */
  private viewEntries: ViewEntry[] = [];
  private databaseFileOrder: string[] = [];
  private statusPresets: StatusPresetDef[] = [];
  private defaultStatusPresetId?: string;
  private currentDbIndex = 0;
  private currentViewIndex = 0;
  private rows: RowData[] = [];
  private selectedRows = new Set<string>();
  private lastSelectedRowPath: string | null = null;
  private viewStateStore = new ViewStateStore();
  private viewState?: DatabaseViewState;
  private showFilterPanel = false;
  private showSortPanel = false;
  private showViewConfigPanel = false;
  /** Columns just created that should bypass auto-hide for one render cycle */
  private pendingShowColumns: Set<string> = new Set();
  private showColumnManager = false;
  private activeHeaderPopover?: HeaderPopoverKind;
  private headerPopoverAnchorEl?: HTMLElement;
  private readonly handleOutsideClickBound = (event: MouseEvent) => this.handleOutsideClick(event);
  private configSaveTimer: number | null = null;
  private computedSyncTimer: number | null = null;
  private syncingComputed = false;
  private suppressDataReloadUntil = 0;
  private suppressNextSettingsUpdate = false;
  private pendingNewFilePath?: string;
  private pendingNewRecord?: NoteRecord & { expiresAt: number };
  private pendingNewRevealTimer: number | null = null;
  private onConfigChanged?: () => void | Promise<void>;
  private databaseFolder: string;
  private readonly instanceId = generateId();

  constructor(
    leaf: WorkspaceLeaf,
    dataSource: DataSource,
    databases: DatabaseConfig[],
    databaseFileOrder: string[],
    databaseFolder: string,
    statusPresets: StatusPresetDef[],
    defaultStatusPresetId: string | undefined,
    onConfigChanged?: () => void | Promise<void>
  ) {
    super(leaf);
    this.dataSource = dataSource;
    this.databaseFileOrder = databaseFileOrder;
    this.databaseFolder = databaseFolder;
    this.statusPresets = normalizeStatusPresets(statusPresets);
    this.defaultStatusPresetId = defaultStatusPresetId;
    this.propertyService = new PropertyService(this.app);
    this.cellRenderer = new CellRenderer(
      this.dataSource,
      () => this.refreshAfterSave(),
      (row) => this.openRow(row),
      (col) => this.columnMenu.showOptionsEditor(col),
      (col) => this.showFormulaModal(col),
      false,
      () => this.scheduleConfigSave()
    );
    this.columnOperations = new ColumnOperations({
      dataSource: this.dataSource,
      propertyService: this.propertyService,
      viewStateStore: this.viewStateStore,
      getConfig: () => this.getConfig(),
      getActiveDb: () => this.getActiveDb(),
      getState: () => this.vs(),
      getFilesForConfig: (config) => this.getFilesForConfig(config),
      saveConfigImmediately: () => this.saveConfigImmediately(),
      saveCurrentViewConfig: () => this.saveCurrentViewConfig(),
      scheduleConfigSave: () => this.scheduleConfigSave(),
      refresh: () => this.refresh(),
      refreshSchemaChanged: () => this.refreshSchemaChanged(),
      refreshAfterSave: () => this.refreshAfterSave(),
      markPendingColumn: (key) => this.pendingShowColumns.add(key),
      refreshColumnManager: () => {
        if (this.showColumnManager) this.renderColumnManager();
      },
      getDefaultStatusOptions: () => this.getDefaultStatusOptions(),
    });
    this.rowMenu = new RowMenu({
      openRow: (row) => { void this.openRow(row); },
      deleteRow: (row) => this.deleteRow(row),
    });
    this.columnHeaderController = new ColumnHeaderController({
      getConfig: () => this.getConfig(),
      ensureColumnOrder: (config) => ensureColumnOrder(config),
      showContextMenu: (event, col, anchorEl) => this.showContextMenu(event, col, anchorEl),
      sortByColumn: (col) => this.sortByColumn(col),
      saveConfig: () => this.scheduleConfigSave(),
      refresh: () => this.refresh(),
    });
    this.tableRenderer = new TableRenderer({
      getVisibleColumns: (config, rows) => getVisibleColumns(config, rows, this.vs(), this.pendingShowColumns),
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      setupColumnHeader: (th, col) => this.setupColumnHeader(th, col),
      setupRow: (tr, row) => this.setupRowInteractions(tr, row),
      renderCell: (td, row, col) => this.renderCell(td, row, col),
      setupFillHandle: (td, row, col) => this.setupTableFillHandle(td, row, col),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      createEntry: (defaults) => { void this.createBlankEntry(defaults); },
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
    });
    this.boardRenderer = new BoardRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { void this.createBlankEntry(defaults); },
      updateGroup: (row, field, value, fromValue) => this.updateBoardGroup(row, field, value, fromValue),
      updateGroupOrder: (field, order) => this.updateBoardGroupOrder(field, order),
      updateCardOrder: (field, groupKey, paths) => this.updateBoardCardOrder(field, groupKey, paths),
      updateColumnWidth: (width) => this.updateBoardColumnWidth(width),
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
    });
    this.galleryRenderer = new GalleryRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { void this.createBlankEntry(defaults); },
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns),
      updateCardSize: (width) => this.updateGalleryCardSize(width),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
    });
    this.listRenderer = new ListRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { void this.createBlankEntry(defaults); },
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
    });
    this.columnMenu = new ColumnMenu({
      editColumn: (col) => this.showColumnRenameModal(col),
      editFormula: (col) => this.showFormulaModal(col),
      editStatusOptions: (col) => this.showStatusOptionsModal(col),
      showOptionsEditor: (col) => this.showStatusOptionsModal(col),
      changeColumnType: (col, type) => { void this.changeColumnType(col, type); },
      insertColumn: (col, side) => { void this.columnOperations.insertColumnNear(col, side); },
      duplicateColumn: (col) => { void this.columnOperations.duplicateColumn(col); },
      moveColumn: (key, offset) => this.columnOperations.moveColumn(key, offset),
      hideColumn: (col) => this.columnOperations.hideColumn(col),
      toggleColumnWrap: (col) => this.toggleColumnWrap(col),
      sortByColumn: (col) => this.sortByColumn(col),
      getColumnSortDirection: (col) => this.getColumnSortDirection(col),
      clearColumnSort: (col) => this.clearColumnSort(col),
      autoFitColumn: (col) => this.autoFitColumn(col),
      autoFitAllColumns: () => this.autoFitAllColumns(),
      deleteColumn: (col) => { void this.columnOperations.deleteColumn(col); },
    });
    this.databases = databases;
    this.onConfigChanged = onConfigChanged;
    this.register(this.dataSource.onDataChanged(() => {
      if (Date.now() < this.suppressDataReloadUntil) return;
      this.rebuildViewEntries();
      this.rerenderToolbar();
      this.refresh();
    }));
    this.register(this.dataSource.onViewConfigChanged((mutation) => this.handlePeerViewConfigChanged(mutation)));
    this.rebuildViewEntries();
  }

  /** Get the current view's transient state (always non-null) */
  private vs(): DatabaseViewState {
    const state = this.viewStateStore.get(this.currentDbIndex, this.currentViewIndex, this.getActiveView());
    if (this.viewState !== state) {
      this.viewState = state;
    }
    return this.viewState;
  }

  /** Get the active database config */
  private getActiveDb(): DatabaseConfig {
    return this.viewEntries[this.currentDbIndex]?.config || this.databases[0];
  }

  /** Get the active view config within the current database */
  private getActiveView(): ViewConfig {
    const db = this.getActiveDb();
    return db.views[this.currentViewIndex] || db.views[0];
  }

  /** Get the combined config for backward compatibility with sub-components */
  private getConfig(): ViewConfig {
    return this.getActiveView();
  }

  /** Get the current database entry */
  private getCurrentEntry(): ViewEntry | undefined {
    return this.viewEntries[this.currentDbIndex];
  }

  private getCurrentMutationTarget(): ViewConfigMutation | undefined {
    const entry = this.getCurrentEntry();
    const view = this.getConfig();
    if (!entry || !view) return undefined;
    return {
      dbId: entry.config.id,
      dbPath: entry.sourcePath,
      viewId: view.id,
      sourceInstanceId: this.instanceId,
    };
  }

  private getCurrentDatabaseMutationTarget(): ViewConfigMutation | undefined {
    const entry = this.getCurrentEntry();
    if (!entry) return undefined;
    return {
      dbId: entry.config.id,
      dbPath: entry.sourcePath,
      sourceInstanceId: this.instanceId,
    };
  }

  private handlePeerViewConfigChanged(mutation: ViewConfigMutation): void {
    if (mutation.sourceInstanceId === this.instanceId) return;
    if (!this.matchesCurrentView(mutation)) return;
    this.suppressDataReloadUntil = Date.now() + 1000;
    this.hardRefreshFromSource(mutation.database);
  }

  private matchesCurrentView(mutation: ViewConfigMutation): boolean {
    const entry = this.getCurrentEntry();
    const view = this.getConfig();
    if (!entry || !view) return false;
    const sameDb = mutation.dbPath
      ? entry.sourcePath === mutation.dbPath
      : mutation.dbId != null && entry.config.id === mutation.dbId;
    if (!sameDb) return false;
    return !mutation.viewId || view.id === mutation.viewId;
  }

  private hardRefreshFromSource(databaseOverride?: DatabaseConfig): void {
    const entry = this.getCurrentEntry();
    const view = this.getConfig();
    const sourcePath = entry?.sourcePath || null;
    const dbId = entry?.config.id;
    const viewId = view?.id;
    this.rebuildViewEntries();
    const nextDbIndex = this.viewEntries.findIndex((candidate) => {
      if (sourcePath) return candidate.sourcePath === sourcePath;
      return dbId != null && candidate.config.id === dbId;
    });
    if (nextDbIndex >= 0) {
      if (databaseOverride && this.viewEntries[nextDbIndex].sourcePath) {
        this.viewEntries[nextDbIndex].config = this.cloneDatabaseConfig(databaseOverride);
      }
      this.currentDbIndex = nextDbIndex;
      const nextViews = this.viewEntries[nextDbIndex].config.views;
      const nextViewIndex = viewId ? nextViews.findIndex((candidate) => candidate.id === viewId) : -1;
      this.currentViewIndex = nextViewIndex >= 0 ? nextViewIndex : Math.min(this.currentViewIndex, nextViews.length - 1);
      if (this.currentViewIndex < 0) this.currentViewIndex = 0;
    }
    this.viewStateStore.clear();
    this.viewState = undefined;
    this.showFilterPanel = false;
    this.showSortPanel = false;
    this.showColumnManager = false;
    this.showViewConfigPanel = false;
    this.clearHeaderPopover();
    this.rerenderToolbar();
    this.refresh();
  }

  private cloneDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
    return JSON.parse(JSON.stringify(config)) as DatabaseConfig;
  }

  /** Check if the current dashboard page is showing a file-based database */
  isShowingFileDatabase(): boolean {
    return !!this.viewEntries[this.currentDbIndex]?.sourcePath;
  }

  /** Get the currently active database config (for external access) */
  getActiveDatabaseConfig(): { db: DatabaseConfig; isFileBased: boolean; sourcePath: string | null } | null {
    const entry = this.viewEntries[this.currentDbIndex];
    if (!entry) return null;
    return { db: entry.config, isFileBased: !!entry.sourcePath, sourcePath: entry.sourcePath };
  }

  async exportCurrentViewAsCsvMarkdownZip(): Promise<TFile | null> {
    const options = await new CsvMarkdownExportModal(this.app).open();
    if (!options) return null;
    return this.createCsvMarkdownZip(options);
  }

  private async createCsvMarkdownZip(options: CsvMarkdownExportOptions): Promise<TFile | null> {
    const db = this.getActiveDb();
    const config = this.getConfig();
    if (!db || !config) return null;
    const state = this.vs();
    const rows = this.rows.length > 0 ? this.rows : this.getRowsForView(this.currentViewIndex);
    if (rows.length === 0) {
      new Notice(t("errors.noDataExport"));
      return null;
    }
    const baseName = this.sanitizeFilename(db.name || "Database");
    const zipEntries: ZipEntry[] = [];
    const pageNames = new Map<string, number>();

    // Build markdown files
    for (const row of rows) {
      const title = row.file.basename || t("common.untitled");
      const pageName = this.getUniqueExportName(this.sanitizeFilename(title), pageNames);
      const md = await this.app.vault.cachedRead(row.file);
      const body = this.stripFrontmatter(md).trim();
      zipEntries.push({
        path: `${baseName}/notes/${pageName}.md`,
        content: this.buildMarkdownExportContent(row, title, body, options.includeFrontmatter),
      });
    }

    // Build CSV files: one per view + summary + schema
    this.addAllViewCsvEntries(zipEntries, db, baseName);

    // Metadata JSON
    zipEntries.push({
      path: `${baseName}/note-database.json`,
      content: JSON.stringify({
        format: "note-database-csv-markdown",
        version: 3,
        exportedAt: new Date().toISOString(),
        includeFrontmatter: options.includeFrontmatter,
        summaryCsvFile: `${baseName}_all.csv`,
        database: this.cloneDatabaseConfig(db),
        activeViewId: config.id,
      }, null, 2),
    });

    const zip = createStoredZip(zipEntries);
    const folder = this.databaseFolder || "";
    const path = this.getAvailableExportPath(folder, `${baseName}.zip`);
    const adapter = this.app.vault.adapter;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parent) await this.ensureFolder(parent);
    await adapter.writeBinary(path, zip);
    const file = this.app.vault.getAbstractFileByPath(path);
    new Notice(t("notice.exportedCsvMarkdownZip", { path }));
    return file instanceof TFile ? file : null;
  }

  private addAllViewCsvEntries(entries: ZipEntry[], db: DatabaseConfig, baseName: string): void {
    const allViews = db.views.map((view, index) => ({ view, index }));
    if (allViews.length === 0) return;

    const usedViewNames = new Map<string, number>();
    const allColumns: ColumnDef[] = [];
    const seenColumnKeys = new Set<string>();
    const allRowsByPath = new Map<string, RowData>();

    // One CSV per view
    for (const entry of allViews) {
      const view = entry.view;
      const viewState = this.viewStateStore.get(this.currentDbIndex, entry.index, view);
      const viewRows = this.getRowsForView(entry.index);
      const visibleColumns = getVisibleColumns(view, viewRows, viewState, this.pendingShowColumns)
        .filter((col) => col.key !== "file.name");
      for (const col of visibleColumns) {
        if (seenColumnKeys.has(col.key)) continue;
        seenColumnKeys.add(col.key);
        allColumns.push(col);
      }
      for (const row of viewRows) {
        if (!allRowsByPath.has(row.file.path)) allRowsByPath.set(row.file.path, row);
      }
      const viewName = this.getUniqueExportName(
        this.sanitizeFilename(view.name || this.getDefaultViewName(view.viewType || "table")),
        usedViewNames
      );
      const headers = ["Name", ...visibleColumns.map((col) => col.label || col.key)];
      const csvRows = [headers.map((v) => this.csvEscape(v)).join(",")];
      for (const row of viewRows) {
        const values = [row.file.basename || t("common.untitled"), ...visibleColumns.map((col) => this.getExportCellValue(row, col))];
        csvRows.push(values.map((v) => this.csvEscape(v)).join(","));
      }
      entries.push({ path: `${baseName}/views/${viewName}.csv`, content: csvRows.join("\n") });
    }

    // Summary CSV: all data with all columns (use this file for import)
    const headers = ["Name", "Path", ...allColumns.map((col) => col.label || col.key)];
    const summaryRows = [headers.map((v) => this.csvEscape(v)).join(",")];
    for (const row of allRowsByPath.values()) {
      const values = [
        row.file.basename || t("common.untitled"),
        row.file.path,
        ...allColumns.map((col) => this.getExportCellValue(row, col)),
      ];
      summaryRows.push(values.map((v) => this.csvEscape(v)).join(","));
    }
    entries.push({ path: `${baseName}/${baseName}_all.csv`, content: summaryRows.join("\n") });

    // Schema CSV: property name, key, type
    const schemaHeaders = ["Property", "Key", "Type"];
    const schemaRows = [schemaHeaders.join(",")];
    for (const col of db.schema.columns) {
      schemaRows.push([col.label || col.key, col.key, col.type].map((v) => this.csvEscape(v)).join(","));
    }
    entries.push({ path: `${baseName}/${baseName}_schema.csv`, content: schemaRows.join("\n") });
  }

  /** Rebuild the combined database list from configuration and file-based sources */
  private rebuildViewEntries(): void {
    const entries: ViewEntry[] = this.databases.map(db => ({
      config: db, // share reference — modifications to config directly affect settings source
      sourcePath: null,
    }));
    const existingPaths = new Set(entries.map(e => e.sourcePath).filter((p): p is string => p !== null));
    const defFiles = sortDatabaseFileEntries(this.dataSource.getViewDefFiles(), this.databaseFileOrder);
    for (const df of defFiles) {
      if (!existingPaths.has(df.file.path)) {
        entries.push({ config: df.config, sourcePath: df.file.path });
        existingPaths.add(df.file.path);
      }
    }
    this.viewEntries = entries;
    if (this.currentDbIndex >= entries.length) {
      this.currentDbIndex = 0;
      this.currentViewIndex = 0;
    }
  }

  /** Update database configs from settings (called when settings change) */
  updateConfigs(
    databases: DatabaseConfig[],
    databaseFileOrder: string[] = this.databaseFileOrder,
    statusPresets: StatusPresetDef[] = this.statusPresets,
    defaultStatusPresetId: string | undefined = this.defaultStatusPresetId
  ): void {
    this.databases = databases;
    this.databaseFileOrder = databaseFileOrder;
    this.statusPresets = normalizeStatusPresets(statusPresets);
    this.defaultStatusPresetId = defaultStatusPresetId;
    this.rebuildViewEntries();
    if (this.suppressNextSettingsUpdate) {
      this.suppressNextSettingsUpdate = false;
      return;
    }
    this.viewState = this.viewStateStore.get(this.currentDbIndex, this.currentViewIndex, this.getActiveView());
    this.selectedRows.clear();
    this.lastSelectedRowPath = null;
    this.rerenderToolbar();
    this.refresh();
  }

  getViewType(): string {
    return DATABASE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Note Database";
  }

  getIcon(): string {
    return "database";
  }

  async onOpen(): Promise<void> {
    this.containerEl_ = this.contentEl;
    this.containerEl_.addClass("note-database-container");
    document.addEventListener("mousedown", this.handleOutsideClickBound, true);
    this.registerDomEvent(window, "focus", () => this.refreshOnActivation());
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf === this.leaf) this.refreshOnActivation();
    }));
    try {
      this.renderToolbar();
      this.render();
    } catch (e) {
      console.error("Note Database: render error", e);
      const errMsg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : "";
      const configInfo = this.viewEntries.length > 0
        ? t("errors.currentDb", { name: this.viewEntries[this.currentDbIndex]?.config.name || "?" })
        : t("errors.viewConfigEmpty");
      this.containerEl_.createDiv({
        cls: "db-empty",
        attr: { style: "white-space: pre-wrap; font-family: monospace; font-size: 12px;" },
        text: `${t("errors.renderError", { message: errMsg })}\n${configInfo}\n\n${stack ? stack.substring(0, 500) : t("errors.noStack")}`,
      });
    }
  }

  async onClose(): Promise<void> {
    document.removeEventListener("mousedown", this.handleOutsideClickBound, true);
    if (this.computedSyncTimer !== null) {
      clearTimeout(this.computedSyncTimer);
      this.computedSyncTimer = null;
    }
    if (this.configSaveTimer !== null) {
      await this.saveConfigImmediately();
    }
  }

  private refreshOnActivation(): void {
    if (!this.containerEl_?.isConnected) return;
    if (this.configSaveTimer !== null) {
      void this.saveConfigImmediately().then(() => this.hardRefreshFromSource());
      return;
    }
    this.hardRefreshFromSource();
  }

  private renderToolbar(): void {
    if (!this.containerEl_) return;
    this.applyDisplayWidth();
    const currentConfig = this.getConfig();
    const needsSetup = !currentConfig?.schema?.columns || currentConfig.schema.columns.length < 2;
    this.toolbarRenderer.render(this.containerEl_, this.viewEntries, this.currentDbIndex, this.currentViewIndex, this.vs(), {
      selectDatabase: (index) => this.selectView(index),
      moveDatabase: (fromIndex, toIndex) => this.moveDatabase(fromIndex, toIndex),
      selectViewInView: (_dbIndex, viewIndex) => this.switchView(viewIndex),
      addView: (viewType) => this.addView(viewType),
      deleteView: (viewIndex) => this.deleteView(viewIndex),
      renameView: (viewIndex, name) => this.renameView(viewIndex, name),
      moveView: (fromIndex, toIndex) => this.moveView(fromIndex, toIndex),
      renameDatabase: (name) => this.renameDatabase(name),
      updateDatabaseDescription: (description) => this.updateDatabaseDescription(description),
      setViewType: (value) => this.setViewType(value),
      setDisplayWidth: (value) => this.setDisplayWidth(value),
      setSearchText: (value) => {
        this.vs().searchText = value;
        this.refresh();
      },
      setGroupByField: (value) => this.setGroupByField(value),
      setGroupOrderMode: (mode) => this.setGroupOrderMode(mode),
      toggleViewConfig: (anchorEl) => this.toggleHeaderPopover("view", anchorEl),
      configureGroupOrder: () => this.showGroupOrderModal(),
      toggleSortPanel: (anchorEl) => this.toggleHeaderPopover("sort", anchorEl),
      syncComputedFields: () => { void this.syncComputedFieldsNow(true); },
      toggleFilterPanel: (anchorEl) => this.toggleHeaderPopover("filter", anchorEl),
      toggleColumnManager: (anchorEl) => this.toggleHeaderPopover("columns", anchorEl),
      closeToolbarPopovers: () => this.closeHeaderPopovers(),
      createEntry: (defaults) => { void this.createBlankEntry(defaults); },
      isReadOnly: needsSetup,
      showDatabaseChrome: true,
      addDatabase: () => this.addDatabase(),
      deleteDatabase: () => { void this.deleteDatabase(); },
      copyCurrentDatabase: () => { void this.duplicateCurrentDatabase(); },
      copyCurrentView: (viewIndex) => this.duplicateView(viewIndex),
      copyViewCode: (viewIndex) => { void this.copyCurrentViewCode(viewIndex); },
      openDatabaseFile: () => { void this.openDatabaseFile(); },
      exportData: (format) => this.exportData(format),
      exportCsvMarkdownZip: () => { void this.exportCurrentViewAsCsvMarkdownZip(); },
    });
    this.updateStickyOffsets();
  }

  private updateStickyOffsets(): void {
    if (!this.containerEl_) return;
    const update = () => {
      if (!this.containerEl_) return;
      const header = this.containerEl_.querySelector(":scope > .db-header") as HTMLElement | null;
      const height = header ? Math.ceil(header.getBoundingClientRect().height) : 96;
      this.containerEl_.style.setProperty("--db-table-header-top", `${height}px`);
    };
    update();
    window.requestAnimationFrame(update);
  }

  private setViewType(value: DatabaseViewType): void {
    const config = this.getConfig();
    if (!config) return;
    config.viewType = value;
    this.clearSelection();
    if (value === "board" && !config.boardGroupField) {
      config.boardGroupField = this.getDefaultBoardField(config);
    }
    if (value === "gallery") {
      config.galleryImageField = config.galleryImageField || this.getDefaultGalleryImageField(config);
      config.galleryCardSize = config.galleryCardSize || 250;
      config.galleryImageAspectRatio = config.galleryImageAspectRatio || 0.75;
      config.galleryImageFit = config.galleryImageFit || "cover";
    }
    this.scheduleConfigSave();
    this.rerenderToolbar();
    this.refresh();
  }

  private setDisplayWidth(value: "default" | "wide"): void {
    const config = this.getConfig();
    if (!config) return;
    const entry = this.getCurrentEntry();
    if (entry?.sourcePath) config.displayWidth = value;
    else config.dashboardDisplayWidth = value;
    this.scheduleConfigSave();
    this.applyDisplayWidth();
    this.rerenderToolbar();
  }

  private applyDisplayWidth(): void {
    if (!this.containerEl_) return;
    const config = this.getConfig();
    const entry = this.getCurrentEntry();
    const width = entry?.sourcePath ? config?.displayWidth : config?.dashboardDisplayWidth;
    const wide = width === "wide";
    this.containerEl_.toggleClass("db-width-wide", wide);
    this.containerEl_.toggleClass("db-width-default", !wide);
  }

  private applyViewTypeClass(viewType: DatabaseViewType): void {
    if (!this.containerEl_) return;
    for (const type of ["table", "board", "gallery", "list"] as const) {
      this.containerEl_.toggleClass(`db-view-${type}`, viewType === type);
    }
  }

  private setGroupByField(value: string): void {
    const config = this.getConfig();
    if (!config) return;
    if (config.viewType === "board") {
      // Board view requires a group field; reject empty values
      if (!value) return;
      config.boardGroupField = value;
    } else {
      this.vs().groupByField = value;
    }
    this.viewStateStore.persist(config, this.vs());
    void this.saveCurrentViewConfig();
    this.rerenderToolbar();
    this.refresh();
  }

  private toggleHeaderPopover(kind: HeaderPopoverKind, anchorEl: HTMLElement): void {
    const wasClosingActivePopover = this.activeHeaderPopover != null && this.isHeaderPopoverVisible(this.activeHeaderPopover);
    const shouldOpen = this.activeHeaderPopover !== kind || !this.isHeaderPopoverVisible(kind);
    this.showFilterPanel = shouldOpen && kind === "filter";
    this.showSortPanel = shouldOpen && kind === "sort";
    this.showColumnManager = shouldOpen && kind === "columns";
    this.showViewConfigPanel = shouldOpen && kind === "view";
    this.activeHeaderPopover = shouldOpen ? kind : undefined;
    this.headerPopoverAnchorEl = shouldOpen ? anchorEl : undefined;
    this.renderFilterPanel();
    this.renderSortPanel();
    this.renderColumnManager();
    this.renderViewConfigPanel();
    if (wasClosingActivePopover) {
      this.updateToolbarIndicators();
      this.refresh();
      if (this.configSaveTimer !== null) void this.saveConfigImmediately();
    }
  }

  private isHeaderPopoverVisible(kind: HeaderPopoverKind): boolean {
    if (kind === "filter") return this.showFilterPanel;
    if (kind === "sort") return this.showSortPanel;
    if (kind === "view") return this.showViewConfigPanel;
    return this.showColumnManager;
  }

  private clearHeaderPopover(): void {
    this.activeHeaderPopover = undefined;
    this.headerPopoverAnchorEl = undefined;
  }

  private handleOutsideClick(event: MouseEvent): void {
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (this.containerEl_?.contains(target)) {
      if (target.closest(".db-filter-panel, .db-sort-panel, .db-column-manager, .db-view-config-panel, .db-toolbar, .db-header")) {
        return;
      }
    }
    this.closeHeaderPopovers();
  }

  private closeHeaderPopovers(): void {
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    this.showFilterPanel = false;
    this.showSortPanel = false;
    this.showColumnManager = false;
    this.showViewConfigPanel = false;
    this.clearHeaderPopover();
    this.renderFilterPanel();
    this.renderSortPanel();
    this.renderColumnManager();
    this.renderViewConfigPanel();
    this.updateToolbarIndicators();
    this.refresh();
    if (this.configSaveTimer !== null) {
      void this.saveConfigImmediately();
    }
  }

  private getHeaderPopoverAnchor(kind: HeaderPopoverKind): HTMLElement | undefined {
    if (this.activeHeaderPopover !== kind) return undefined;
    if (this.headerPopoverAnchorEl?.isConnected) return this.headerPopoverAnchorEl;
    const selector = kind === "filter"
      ? ".db-filter-btn"
      : kind === "sort"
        ? ".db-sort-btn"
        : kind === "view"
          ? ".db-view-config-btn"
          : ".db-col-manager-btn";
    return this.containerEl_?.querySelector(selector) as HTMLElement | undefined;
  }

  private showGroupOrderModal(): void {
    const config = this.getConfig();
    if (!config) return;
    const field = this.getActiveGroupField(config);
    if (!field) {
      new Notice(t("notice.selectGroupField"));
      return;
    }
    const col = config.schema.columns.find((candidate) => candidate.key === field);
    const groups = this.queryEngine.groupBy(this.rows, field);
    const keys = groups.map((group) => group.key);
    const currentOrder = config.groupOrders?.[field] || [];
    new GroupOrderModal(
      this.app,
      col?.label || field,
      keys,
      currentOrder,
      getDefaultGroupOrder(config, field),
      async (order) => {
        config.groupOrders = { ...(config.groupOrders || {}), [field]: order };
        this.scheduleConfigSave();
        this.rerenderToolbar();
        this.refresh();
      }
    ).open();
  }

  private setGroupOrderMode(mode: GroupOrderMode): void {
    const config = this.getConfig();
    if (!config) return;
    const field = this.getActiveGroupField(config);
    if (!field) return;
    const col = config.schema.columns.find((candidate) => candidate.key === field);
    const groups = this.queryEngine.groupBy(this.rows, field);
    const keys = groups.map((group) => group.key);
    const optionOrder = getDefaultGroupOrder(config, field).filter((key) => keys.includes(key));
    const appendMissing = (order: string[]) => [...order, ...keys.filter((key) => !order.includes(key))];
    let order: string[];

    switch (mode) {
      case "number-asc":
        order = [...keys].sort((a, b) => this.toNumericGroupValue(a) - this.toNumericGroupValue(b) || a.localeCompare(b));
        break;
      case "number-desc":
        order = [...keys].sort((a, b) => this.toNumericGroupValue(b) - this.toNumericGroupValue(a) || a.localeCompare(b));
        break;
      case "date-asc":
        order = [...keys].sort((a, b) => this.toDateGroupValue(a) - this.toDateGroupValue(b) || a.localeCompare(b));
        break;
      case "date-desc":
        order = [...keys].sort((a, b) => this.toDateGroupValue(b) - this.toDateGroupValue(a) || a.localeCompare(b));
        break;
      case "checkbox-false-first":
        order = [...keys].sort((a, b) => Number(toBooleanValue(a)) - Number(toBooleanValue(b)) || a.localeCompare(b));
        break;
      case "checkbox-true-first":
        order = [...keys].sort((a, b) => Number(toBooleanValue(b)) - Number(toBooleanValue(a)) || a.localeCompare(b));
        break;
      case "option-asc":
      case "multi-select-priority":
        order = appendMissing(optionOrder);
        break;
      case "option-desc":
        order = appendMissing([...optionOrder].reverse());
        break;
      case "text-desc":
        order = [...keys].sort((a, b) => b.localeCompare(a));
        break;
      case "text-asc":
      default:
        order = [...keys].sort((a, b) => a.localeCompare(b));
        break;
    }

    if (!col && order.length === 0) return;
    config.groupOrders = { ...(config.groupOrders || {}), [field]: order };
    this.scheduleConfigSave();
    this.rerenderToolbar();
    this.refresh();
  }

  private toNumericGroupValue(value: string): number {
    const n = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  }

  private toDateGroupValue(value: string): number {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  }

  private getActiveGroupField(config: ViewConfig): string {
    if (config.viewType === "board") {
      return config.boardGroupField || this.vs().groupByField || this.getDefaultBoardField(config);
    }
    return this.vs().groupByField;
  }

  private selectView(index: number): void {
    this.closeHeaderPopovers();
    this.currentDbIndex = index;
    this.currentViewIndex = 0;
    this.clearSelection();
    this.clearHeaderPopover();
    this.rerenderToolbar();
    this.refresh();
  }

  /** Switch to a different view within the current database */
  private switchView(viewIndex: number): void {
    this.closeHeaderPopovers();
    this.currentViewIndex = viewIndex;
    this.clearSelection();
    this.rerenderToolbar();
    this.refresh();
  }

  /** Add a new view to the current database */
  private addView(viewType: DatabaseViewType): void {
    const db = this.getActiveDb();
    if (!db || db.views.length >= 15) return;
    const sourceView = db.views[0];
    const newView: ViewConfig = {
      id: generateId(),
      name: this.getDefaultViewName(viewType),
      viewType,
      sourceFolder: db.sourceFolder,
      sourceRules: db.sourceRules,
      sourceLogic: db.sourceLogic,
      newRecordFolder: db.newRecordFolder,
      typeFilter: db.typeFilter,
      schema: db.schema,
      syncComputedToFrontmatter: db.syncComputedToFrontmatter,
      columnOrder: sourceView?.columnOrder ? [...sourceView.columnOrder] : undefined,
      boardGroupField: viewType === "board"
        ? (db.schema.columns.find(c => c.key !== "file.name")?.key || "file.name")
        : undefined,
      galleryImageField: viewType === "gallery"
        ? this.getDefaultGalleryImageField(sourceView || { schema: db.schema } as ViewConfig)
        : undefined,
      galleryCardSize: viewType === "gallery" ? 250 : undefined,
      galleryImageAspectRatio: viewType === "gallery" ? 0.75 : undefined,
      galleryImageFit: viewType === "gallery" ? "cover" : undefined,
    };
    db.views.push(newView);
    this.currentViewIndex = db.views.length - 1;
    void this.saveCurrentViewConfig();
    this.rerenderToolbar();
    this.refresh();
  }

  /** Delete a view from the current database (must keep at least 1) */
  private deleteView(viewIndex: number): void {
    const db = this.getActiveDb();
    if (!db || db.views.length <= 1) return;
    db.views.splice(viewIndex, 1);
    if (this.currentViewIndex >= db.views.length) {
      this.currentViewIndex = db.views.length - 1;
    }
    void this.saveCurrentViewConfig();
    this.rerenderToolbar();
    this.refresh();
  }

  /** Rename a view */
  private renameView(viewIndex: number, name: string): void {
    const db = this.getActiveDb();
    if (!db || !db.views[viewIndex]) return;
    db.views[viewIndex].name = name;
    void this.saveCurrentViewConfig();
    this.rerenderToolbar();
  }

  private moveView(fromIndex: number, toIndex: number): void {
    const db = this.getActiveDb();
    if (!db || fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= db.views.length || toIndex < 0 || toIndex >= db.views.length) return;
    const [view] = db.views.splice(fromIndex, 1);
    db.views.splice(toIndex, 0, view);
    this.currentViewIndex = this.getMovedIndex(this.currentViewIndex, fromIndex, toIndex);
    void this.saveCurrentViewConfig(this.getCurrentDatabaseMutationTarget());
    this.rerenderToolbar();
    this.refresh();
  }

  private moveDatabase(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const fromEntry = this.viewEntries[fromIndex];
    const toEntry = this.viewEntries[toIndex];
    if (!fromEntry || !toEntry) return;
    if (Boolean(fromEntry.sourcePath) !== Boolean(toEntry.sourcePath)) return;
    const currentEntry = this.getCurrentEntry();
    const currentDbId = currentEntry?.config.id;
    const currentSourcePath = currentEntry?.sourcePath || null;
    const currentViewId = this.getConfig()?.id;

    if (fromEntry.sourcePath && toEntry.sourcePath) {
      const currentFilePaths = this.viewEntries
        .map((entry) => entry.sourcePath)
        .filter((path): path is string => Boolean(path));
      const nextOrder = moveDatabaseFilePath(currentFilePaths, fromEntry.sourcePath, toEntry.sourcePath);
      this.databaseFileOrder.splice(0, this.databaseFileOrder.length, ...nextOrder);
    } else {
      const fromDbIndex = this.databases.indexOf(fromEntry.config);
      const toDbIndex = this.databases.indexOf(toEntry.config);
      if (fromDbIndex < 0 || toDbIndex < 0) return;
      const [db] = this.databases.splice(fromDbIndex, 1);
      this.databases.splice(toDbIndex, 0, db);
    }

    this.suppressNextSettingsUpdate = true;
    void this.onConfigChanged?.();
    this.rebuildViewEntries();
    const nextIndex = this.viewEntries.findIndex((entry) => {
      if (currentSourcePath) return entry.sourcePath === currentSourcePath;
      return entry.config.id === currentDbId;
    });
    if (nextIndex >= 0) {
      this.currentDbIndex = nextIndex;
      const views = this.viewEntries[nextIndex].config.views;
      const nextViewIndex = currentViewId ? views.findIndex((view) => view.id === currentViewId) : -1;
      this.currentViewIndex = nextViewIndex >= 0 ? nextViewIndex : Math.min(this.currentViewIndex, views.length - 1);
    }
    if (this.currentViewIndex < 0) this.currentViewIndex = 0;
  }

  private getMovedIndex(current: number, from: number, to: number): number {
    if (current === from) return to;
    if (from < current && to >= current) return current - 1;
    if (from > current && to <= current) return current + 1;
    return current;
  }

  private renameDatabase(name: string): void {
    const db = this.getActiveDb();
    if (!db) return;
    db.name = name.trim() || t("common.untitledDatabase");
    void this.saveCurrentViewConfig();
    this.rerenderToolbar();
  }

  private updateDatabaseDescription(description: string): void {
    const db = this.getActiveDb();
    if (!db) return;
    db.description = description.trim() || undefined;
    void this.saveCurrentViewConfig();
    this.rerenderToolbar();
  }

  /** Get a unique database name, appending numeric suffix if needed */
  private getUniqueDatabaseName(baseName: string): string {
    const existing = new Set(this.viewEntries.map(e => e.config.name));
    if (!existing.has(baseName)) return baseName;
    let i = 1;
    while (existing.has(`${baseName} ${i}`)) i++;
    return `${baseName} ${i}`;
  }

  private getDefaultViewName(viewType: DatabaseViewType): string {
    if (viewType === "board") return t("common.boardView");
    if (viewType === "gallery") return t("common.galleryView");
    if (viewType === "list") return t("common.listView");
    return t("common.tableView");
  }

  /** Add a new database via modal dialog */
  private async addDatabase(): Promise<void> {
    const modal = new AddDatabaseModal(this.app, this.databaseFolder);
    const result = await modal.open();
    if (!result) return;

    const dbName = this.getUniqueDatabaseName(result.name);

    const view: ViewConfig = {
      id: generateId(),
      name: t("common.tableView"),
      viewType: "table",
      sourceFolder: result.sourceFolder || this.databaseFolder,
      schema: { columns: [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" }], computedFields: [] },
    };
    if (result.typeFilter) {
      view.typeFilter = result.typeFilter;
    }
    const newDb: DatabaseConfig = {
      id: generateId(),
      name: dbName,
      sourceFolder: result.sourceFolder || this.databaseFolder,
      typeFilter: result.typeFilter || undefined,
      schema: view.schema,
      views: [view],
    };

    if (result.createAs === "file") {
      const file = await this.dataSource.createViewDefFile(
        this.databaseFolder,
        dbName,
        newDb
      );
      new Notice(t("notice.createdDbFile", { path: file.path }));
      void this.onConfigChanged?.();
    } else {
      this.databases.push(newDb);
      void this.onConfigChanged?.();
    }
    this.rebuildViewEntries();
    const idx = this.viewEntries.findIndex(e => e.config.name === dbName);
    this.currentDbIndex = idx >= 0 ? idx : 0;
    this.currentViewIndex = 0;
    this.rerenderToolbar();
    this.refresh();
  }

  private async duplicateCurrentDatabase(): Promise<void> {
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const duplicate = this.createDuplicatedDatabaseConfig(entry.config);

    if (entry.sourcePath) {
      const folder = this.getParentPath(entry.sourcePath) || this.databaseFolder;
      const file = await this.dataSource.createViewDefFile(folder, duplicate.name, duplicate);
      this.viewEntries.push({ config: duplicate, sourcePath: file.path });
      this.currentDbIndex = this.viewEntries.length - 1;
      new Notice(t("notice.copiedDbFile", { path: file.path }));
      void this.onConfigChanged?.();
    } else {
      this.databases.push(duplicate);
      await this.onConfigChanged?.();
      this.rebuildViewEntries();
      const nextIndex = this.viewEntries.findIndex((candidate) => candidate.config.id === duplicate.id);
      this.currentDbIndex = nextIndex >= 0 ? nextIndex : this.viewEntries.length - 1;
      new Notice(t("notice.copiedDatabase", { name: duplicate.name }));
    }

    this.currentViewIndex = 0;
    this.rerenderToolbar();
    this.refresh();
  }

  private createDuplicatedDatabaseConfig(source: DatabaseConfig): DatabaseConfig {
    const duplicate = this.cloneDatabaseConfig(source);
    duplicate.id = generateId();
    duplicate.name = this.getUniqueDatabaseName(t("defaults.dbCopy", { name: source.name || t("common.untitledDatabase") }));
    duplicate.schema = JSON.parse(JSON.stringify(source.schema)) as DatabaseConfig["schema"];
    duplicate.views = (source.views || []).map((view) => {
      const cloned = JSON.parse(JSON.stringify(view)) as ViewConfig;
      cloned.id = generateId();
      cloned.schema = duplicate.schema;
      return cloned;
    });
    return duplicate;
  }

  private getParentPath(path: string): string {
    const index = path.lastIndexOf("/");
    return index > 0 ? path.slice(0, index) : "";
  }

  /** Delete the current database with confirmation */
  private async deleteDatabase(): Promise<void> {
    const db = this.getActiveDb();
    const entry = this.getCurrentEntry();
    if (!db || !entry) return;

    const records = this.dataSource.getRecordsForConfig(this.getEffectiveConfig(db));
    const fileCount = records.length;

    const result = await new DeleteDatabaseModal(this.app, db.name, fileCount).open();
    if (!result) return;

    // Optionally delete associated files
    if (result.deleteFiles) {
      for (const record of records) {
        try {
          await this.dataSource.trashNote(record.file);
        } catch (e) {
          console.warn(`Failed to trash file ${record.file.path}:`, e);
        }
      }
    }

    // Move to recycle bin or permanently remove
    if (result.action === "trash") {
      // Store in plugin settings trashedDatabases
      const plugin = (this.app as any).plugins?.plugins?.["note-database"];
      if (plugin?.settings) {
        if (!plugin.settings.trashedDatabases) plugin.settings.trashedDatabases = [];
        plugin.settings.trashedDatabases.push({
          database: JSON.parse(JSON.stringify(db)),
          deletedAt: Date.now(),
        });
        await plugin.saveSettings();
      }
    }

    // Remove from the current list
    const idx = this.databases.indexOf(db);
    if (idx >= 0) this.databases.splice(idx, 1);

    // If file-based, also delete the file
    if (entry.sourcePath) {
      const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
      if (file) await this.dataSource.trashNote(file as any);
    }

    this.rebuildViewEntries();
    this.currentDbIndex = Math.min(this.currentDbIndex, this.viewEntries.length - 1);
    this.currentViewIndex = 0;
    void this.onConfigChanged?.();
    this.rerenderToolbar();
    this.refresh();
  }

  private async openDatabaseFile(): Promise<void> {
    const entry = this.getCurrentEntry();
    if (!entry) return;
    if (entry.sourcePath) {
      // File-based: open the file in the editor
      const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf("tab").openFile(file);
      }
    } else {
      // Configuration database: generate a database file
      const db = entry.config;
      const file = await this.dataSource.createViewDefFile(
        this.databaseFolder,
        db.name || "Database",
        db
      );
      new Notice(t("notice.createdDbFile", { path: file.path }));
      this.dataSource.openNote(file);
    }
  }

  private exportData(format: "csv" | "markdown", viewIndex = this.currentViewIndex): void {
    const db = this.getActiveDb();
    const config = db?.views[viewIndex] || this.getConfig();
    const active = viewIndex === this.currentViewIndex;
    const rows = active ? this.rows : this.getRowsForView(viewIndex);
    const state = active ? this.vs() : this.viewStateStore.get(this.currentDbIndex, viewIndex, config);
    if (!config || rows.length === 0) {
      new Notice(t("errors.noDataExport"));
      return;
    }
    const visibleColumns = getVisibleColumns(config, rows, state, active ? this.pendingShowColumns : new Set());
    if (visibleColumns.length === 0) {
      new Notice(t("errors.noVisibleColumns"));
      return;
    }

    const getCellValue = (row: RowData, col: ColumnDef): string => {
      if (col.key === "file.name") return row.file.name.replace(/\.md$/, "");
      let value: unknown;
      if (col.type === "computed" && col.computedKey) {
        value = row.computed[col.computedKey];
      } else {
        value = row.frontmatter[col.key];
      }
      if (value == null || value === "") return "";
      if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
      if (typeof value === "boolean") return value ? "✓" : "";
      return String(value);
    };

    let content: string;
    if (format === "csv") {
      const headers = visibleColumns.map((col) => `"${col.label.replace(/"/g, '""')}"`);
      const dataRows = rows.map((row) =>
        visibleColumns.map((col) => {
          const val = getCellValue(row, col);
          return `"${val.replace(/"/g, '""')}"`;
        }).join(",")
      );
      content = [headers.join(","), ...dataRows].join("\n");
    } else {
      const headers = visibleColumns.map((col) => col.label);
      const separator = visibleColumns.map(() => "---");
      const dataRows = rows.map((row) =>
        visibleColumns.map((col) => {
          const val = getCellValue(row, col).replace(/\|/g, "\\|");
          return val;
        })
      );
      content = [
        `| ${headers.join(" | ")} |`,
        `| ${separator.join(" | ")} |`,
        ...dataRows.map((r) => `| ${r.join(" | ")} |`),
      ].join("\n");
    }

    navigator.clipboard.writeText(content).then(() => {
      new Notice(t("notice.copiedExport", { format: format === "csv" ? "CSV" : "Markdown", count: rows.length }));
    }).catch(() => {
      new Notice(t("errors.clipboardFailed"));
    });
  }

  private getExportCellValue(row: RowData, col: ColumnDef): string {
    if (col.key === "file.name") return row.file.name.replace(/\.md$/, "");
    const value = col.type === "computed" && col.computedKey
      ? row.computed[col.computedKey]
      : row.frontmatter[col.key];
    if (value == null || value === "") return "";
    if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
  }

  private csvEscape(value: string): string {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  private stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;
    const end = content.indexOf("\n---", 3);
    if (end < 0) return content;
    return content.slice(end + 4).replace(/^\s*\n/, "");
  }

  private buildMarkdownExportContent(row: RowData, title: string, body: string, includeFrontmatter: boolean): string {
    const normalizedBody = body || `# ${title}\n`;
    if (!includeFrontmatter) return normalizedBody;
    const yaml = stringifyYaml(row.frontmatter || {}).trim();
    return yaml ? `---\n${yaml}\n---\n\n${normalizedBody}` : normalizedBody;
  }

  private sanitizeFilename(value: string): string {
    return String(value || "Untitled").replace(/[\\/:"*?<>|#^[\]]/g, "-").trim() || "Untitled";
  }

  private getUniqueExportName(base: string, used: Map<string, number>): string {
    const current = used.get(base) || 0;
    used.set(base, current + 1);
    return current === 0 ? base : `${base} ${current + 1}`;
  }

  private getAvailableExportPath(folder: string, filename: string): string {
    const safeFolder = folder.replace(/^\/+|\/+$/g, "");
    const dot = filename.lastIndexOf(".");
    const name = dot >= 0 ? filename.slice(0, dot) : filename;
    const ext = dot >= 0 ? filename.slice(dot) : "";
    let candidate = safeFolder ? `${safeFolder}/${filename}` : filename;
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = safeFolder ? `${safeFolder}/${name} ${i}${ext}` : `${name} ${i}${ext}`;
      i++;
    }
    return candidate;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private getRowsForView(viewIndex: number): RowData[] {
    const db = this.getActiveDb();
    const view = db?.views[viewIndex] || this.getConfig();
    const state = this.viewStateStore.get(this.currentDbIndex, viewIndex, view);
    const records = this.includePendingNewRecord(this.dataSource.getRecordsForConfig(this.getEffectiveConfig(db)));
    return this.rowPipeline.build(records, view, state);
  }

  private duplicateView(viewIndex = this.currentViewIndex): void {
    const db = this.getActiveDb();
    const source = db?.views[viewIndex];
    if (!db || !source) return;
    if (db.views.length >= 15) {
      new Notice(t("notice.viewLimit"));
      return;
    }
    const duplicated = JSON.parse(JSON.stringify(source)) as ViewConfig;
    duplicated.id = generateId();
    duplicated.name = this.getUniqueDuplicatedViewName(db, source.name || this.getDefaultViewName(source.viewType || "table"));
    duplicated.schema = db.schema;
    const insertIndex = Math.min(viewIndex + 1, db.views.length);
    db.views.splice(insertIndex, 0, duplicated);
    this.currentViewIndex = insertIndex;
    void this.saveCurrentViewConfig(this.getCurrentDatabaseMutationTarget());
    this.rerenderToolbar();
    this.refresh();
    new Notice(t("notice.copiedView", { name: duplicated.name }));
  }

  private getUniqueDuplicatedViewName(db: DatabaseConfig, baseName: string): string {
    const existing = new Set(db.views.map((view) => view.name));
    const base = t("defaults.viewCopy", { name: baseName });
    if (!existing.has(base)) return base;
    let i = 2;
    while (existing.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  private async copyCurrentViewCode(viewIndex = this.currentViewIndex): Promise<void> {
    const entry = this.getCurrentEntry();
    const view = entry?.config.views[viewIndex] || this.getConfig();
    if (!entry || !view) return;
    const locator = entry.sourcePath
      ? `dbPath: ${entry.sourcePath}`
      : `dbId: ${entry.config.id}`;
    const lines = [
      "```note-database",
      locator,
      `viewId: ${view.id || ""}`,
      "```",
    ];
    const code = lines.join("\n");
    try {
      await navigator.clipboard.writeText(code);
      new Notice(t("notice.copiedEmbedCode"));
    } catch (err) {
      console.error("Note Database: failed to copy embed code", err);
      new Notice(t("errors.copyFailed", { error: String(err) }));
    }
  }

  openViewReference(sourcePath: string | null, viewId?: string, dbId?: string): void {
    this.rebuildViewEntries();
    const bySource = sourcePath
      ? this.viewEntries.findIndex((entry) => entry.sourcePath === sourcePath)
      : -1;
    const byId = dbId
      ? this.viewEntries.findIndex((entry) => entry.config.id === dbId)
      : -1;
    const index = bySource >= 0 ? bySource : byId;
    if (index >= 0) {
      this.currentDbIndex = index;
      const views = this.viewEntries[index].config.views;
      const viewIndex = viewId ? views.findIndex((view) => view.id === viewId) : -1;
      this.currentViewIndex = viewIndex >= 0 ? viewIndex : 0;
      this.rerenderToolbar();
      this.refresh();
    }
  }

  /** Re-render toolbar with current state (used after view switch) */
  private rerenderToolbar(): void {
    if (!this.containerEl_) return;
    const existing = this.containerEl_.querySelector(".db-header");
    if (existing) existing.remove();
    this.renderToolbar();
  }

  private refreshSchemaChanged(): void {
    this.rerenderToolbar();
    this.renderFilterPanel();
    this.renderSortPanel();
    this.renderColumnManager();
    this.renderViewConfigPanel();
    this.refresh();
  }

  private async createBlankEntry(defaults: Record<string, unknown> = {}): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    const sourceConfig = this.getCreateContextConfig(config);
    const frontmatter: Record<string, unknown> = {
      ...this.getDefaultFrontmatterFromSourceRules(sourceConfig),
      ...this.getDefaultFrontmatterFromViewFilters(config),
      ...defaults,
    };
    if (sourceConfig.typeFilter) frontmatter["type"] = sourceConfig.typeFilter;
    for (const col of config.schema.columns) {
      if (col.key === "file.name" || col.type === "computed") continue;
      if (!Object.prototype.hasOwnProperty.call(frontmatter, col.key)) {
        frontmatter[col.key] = this.getDefaultCellValue(col);
      }
    }
    try {
      const file = await this.dataSource.createNote(this.getCreateFolder(sourceConfig), t("defaults.untitledNote"), frontmatter);
      this.pendingNewFilePath = file.path;
      this.suppressDataReloadUntil = Date.now() + 1200;
      this.pendingNewRecord = {
        file,
        frontmatter: { ...frontmatter },
        expiresAt: Date.now() + 8000,
      };
      new Notice(t("notice.createdRow", { name: file.basename }));
      await this.refreshAfterSave();
    } catch (err) {
      new Notice(t("errors.createFailed", { error: String(err) }));
    }
  }

  private getDefaultCellValue(col: ColumnDef): unknown {
    if (col.type === "status" && !col.statusOptions?.length) {
      return this.getDefaultStatusOptions()[0]?.value || "";
    }
    return getColumnDefaultCellValue(col);
  }

  private getAvailableStatusPresets(db: DatabaseConfig = this.getActiveDb(), view?: ViewConfig): StatusPresetDef[] {
    const globalPresets = normalizeStatusPresets(this.statusPresets);
    const databasePresets = normalizeStatusPresets(db.statusPresets || [], []);
    const viewPresets = normalizeStatusPresets(view?.statusPresets || [], []);
    const merged = new Map<string, StatusPresetDef>();
    for (const preset of globalPresets) merged.set(preset.id, preset);
    for (const preset of databasePresets) merged.set(preset.id, preset);
    for (const preset of viewPresets) merged.set(preset.id, preset);
    return Array.from(merged.values());
  }

  private getDefaultStatusPresetId(db: DatabaseConfig = this.getActiveDb(), view: ViewConfig = this.getActiveView()): string {
    return resolveDefaultStatusPresetId(
      this.getAvailableStatusPresets(db, view),
      view?.defaultStatusPresetId || db.defaultStatusPresetId || this.defaultStatusPresetId
    );
  }

  private getDefaultStatusOptions(db: DatabaseConfig = this.getActiveDb(), view: ViewConfig = this.getActiveView()): StatusOptionDef[] {
    return getStatusPresetOptions(this.getAvailableStatusPresets(db, view), this.getDefaultStatusPresetId(db, view));
  }

  private getDefaultFrontmatterFromSourceRules(config: ViewConfig): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {};
    if (config.typeFilter) frontmatter["type"] = config.typeFilter;
    for (const rule of config.sourceRules || []) {
      if (rule.op === "eq" && rule.value != null && !rule.field.startsWith("file.")) {
        frontmatter[rule.field] = rule.value;
      }
      if (rule.op === "hasTag" && rule.value) {
        frontmatter["tags"] = [rule.value.replace(/^#/, "")];
      }
    }
    return frontmatter;
  }

  private getDefaultFrontmatterFromViewFilters(config: ViewConfig): Record<string, unknown> {
    const state = this.vs();
    const frontmatter: Record<string, unknown> = {};
    if (state.statusFilter) frontmatter["status"] = state.statusFilter;
    if (state.filterLogic === "or") return frontmatter;

    for (const rule of state.filters) {
      if (!rule.field || rule.field.startsWith("file.") || !rule.value) continue;
      const col = config.schema.columns.find((candidate) => candidate.key === rule.field);
      if (col?.type === "computed") continue;
      if (rule.op !== "eq" && rule.op !== "contains") continue;
      if (col?.type === "multi-select") {
        frontmatter[rule.field] = [rule.value];
      } else if (col?.type === "checkbox") {
        frontmatter[rule.field] = toBooleanValue(rule.value);
      } else {
        frontmatter[rule.field] = rule.value;
      }
    }

    return frontmatter;
  }

  private getCreateContextConfig(config: ViewConfig): ViewConfig {
    const db = this.getActiveDb();
    return {
      ...config,
      sourceFolder: config.sourceFolder || db.sourceFolder || "",
      sourceRules: config.sourceRules || db.sourceRules,
      sourceLogic: config.sourceLogic || db.sourceLogic,
      newRecordFolder: config.newRecordFolder || db.newRecordFolder || db.sourceFolder,
      typeFilter: config.typeFilter || db.typeFilter,
      schema: config.schema || db.schema,
      syncComputedToFrontmatter: config.syncComputedToFrontmatter ?? db.syncComputedToFrontmatter,
    };
  }

  private getCreateFolder(config: ViewConfig): string {
    const folderRule = config.sourceRules?.find((rule) => rule.op === "inFolder" && rule.value);
    return config.sourceFolder || config.newRecordFolder || folderRule?.value || this.databaseFolder;
  }

  /** When no sourceFolder and no sourceRules, use databaseFolder as fallback so querying and creating are consistent. */
  private getEffectiveConfig(dbConfig: DatabaseConfig): DatabaseConfig {
    if (dbConfig.sourceFolder || dbConfig.sourceRules?.length) return dbConfig;
    return { ...dbConfig, sourceFolder: this.databaseFolder };
  }

  private toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void {
    const path = row.file.path;
    if (event?.shiftKey && this.lastSelectedRowPath && this.lastSelectedRowPath !== path) {
      const range = this.getSelectionRangeRows(this.lastSelectedRowPath, path);
      if (range.length > 0) {
        for (const item of range) {
          if (selected) this.selectedRows.add(item.file.path);
          else this.selectedRows.delete(item.file.path);
        }
      } else if (selected) {
        this.selectedRows.add(path);
      } else {
        this.selectedRows.delete(path);
      }
    } else if (selected) {
      this.selectedRows.add(path);
    } else {
      this.selectedRows.delete(path);
    }
    this.lastSelectedRowPath = this.selectedRows.size > 0 ? path : null;
    this.renderSelectionStatusBar();
    this.syncSelectionControls();
  }

  private toggleRowsSelected(rows: RowData[], selected: boolean): void {
    for (const row of rows) {
      if (selected) this.selectedRows.add(row.file.path);
      else this.selectedRows.delete(row.file.path);
    }
    this.lastSelectedRowPath = this.selectedRows.size > 0 ? rows[rows.length - 1]?.file.path || this.lastSelectedRowPath : null;
    this.renderSelectionStatusBar();
    this.syncSelectionControls();
  }

  private getSelectionRangeRows(fromPath: string, toPath: string): RowData[] {
    const ordered = this.getRenderedSelectionRows();
    const source = ordered.length > 0 ? ordered : this.rows;
    const from = source.findIndex((candidate) => candidate.file.path === fromPath);
    const to = source.findIndex((candidate) => candidate.file.path === toPath);
    if (from < 0 || to < 0) return [];
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    return source.slice(start, end + 1);
  }

  private getRenderedSelectionRows(): RowData[] {
    if (!this.containerEl_) return [];
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const seen = new Set<string>();
    const selectors = [
      "tr[data-note-database-row-path]",
      ".db-board-card[data-note-database-row-path]",
      ".db-gallery-card[data-note-database-row-path]",
      ".db-list-row[data-note-database-row-path]",
    ];
    const rows: RowData[] = [];
    for (const element of Array.from(this.containerEl_.querySelectorAll<HTMLElement>(selectors.join(",")))) {
      const path = element.dataset.noteDatabaseRowPath;
      if (!path || seen.has(path)) continue;
      const row = rowByPath.get(path);
      if (!row) continue;
      seen.add(path);
      rows.push(row);
    }
    return rows;
  }

  private clearSelection(): void {
    if (this.selectedRows.size === 0 && this.lastSelectedRowPath == null) return;
    this.selectedRows.clear();
    this.lastSelectedRowPath = null;
    this.renderSelectionStatusBar();
    this.syncSelectionControls();
  }

  private async deleteSelectedRows(): Promise<void> {
    const rows = this.rows.filter((row) => this.selectedRows.has(row.file.path));
    if (rows.length === 0) return;
    if (!window.confirm(t("confirm.deleteSelected", { count: rows.length }))) return;
    for (const row of rows) {
      await this.dataSource.trashNote(row.file);
    }
    this.selectedRows.clear();
    this.lastSelectedRowPath = null;
    await this.refreshAfterSave();
  }

  /** Render the filter panel below the toolbar */
  private renderFilterPanel(): void {
    if (!this.containerEl_) return;
    const config = this.getConfig();
    if (!config) return;
    this.filterPanelRenderer.render(this.containerEl_, this.showFilterPanel, this.vs(), config, {
      saveState: () => {
        this.scheduleViewStateSave();
        this.updateToolbarIndicators();
      },
      refresh: () => {
        this.updateToolbarIndicators();
        this.refresh();
      },
      close: () => {
        this.showFilterPanel = false;
        this.clearHeaderPopover();
        this.renderFilterPanel();
        this.updateToolbarIndicators();
        this.refresh();
        void this.saveConfigImmediately();
      },
    }, this.getHeaderPopoverAnchor("filter"));
  }

  private renderSortPanel(): void {
    if (!this.containerEl_) return;
    const config = this.getConfig();
    if (!config) return;
    this.sortPanelRenderer.render(this.containerEl_, this.showSortPanel, config, this.vs(), {
      save: () => {
        this.scheduleViewStateSave();
        this.updateToolbarIndicators();
      },
      refresh: () => {
        this.updateToolbarIndicators();
        this.refresh();
      },
      close: () => {
        this.showSortPanel = false;
        this.clearHeaderPopover();
        this.renderSortPanel();
        this.updateToolbarIndicators();
        this.refresh();
        void this.saveConfigImmediately();
      },
    }, this.getHeaderPopoverAnchor("sort"));
  }

  private updateToolbarIndicators(): void {
    if (!this.containerEl_) return;
    const state = this.vs();
    const filterBtn = this.containerEl_.querySelector(".db-filter-btn");
    if (filterBtn instanceof HTMLElement) this.updateToolbarBadge(filterBtn, getEffectiveFilterRules(state.filters).length);
    const sortBtn = this.containerEl_.querySelector(".db-sort-btn");
    if (sortBtn instanceof HTMLElement) {
      const count = state.sortRules.filter((rule) => rule.field && rule.direction).length ||
        (state.sortColumn ? 1 : 0);
      this.updateToolbarBadge(sortBtn, count);
    }
    const colBtn = this.containerEl_.querySelector(".db-col-manager-btn");
    if (colBtn instanceof HTMLElement) this.updateToolbarBadge(colBtn, Math.max(0, (this.getConfig()?.schema.columns.length || 0) - state.hiddenColumns.size));
  }

  private updateToolbarBadge(button: HTMLElement, count: number): void {
    button.querySelector(".db-toolbar-badge")?.remove();
    if (count <= 0) return;
    button.createSpan({ cls: "db-toolbar-badge", text: String(count) });
  }

  /** Render column management panel below the toolbar */
  private renderColumnManager(): void {
    if (!this.containerEl_) return;
    const config = this.getConfig();
    if (!config) return;
    this.columnManagerRenderer.render(
      this.containerEl_,
      this.showColumnManager,
      config,
      this.vs(),
      getColumnsInOrder(config),
      {
        close: () => {
          this.showColumnManager = false;
          this.clearHeaderPopover();
          this.renderColumnManager();
          void this.saveConfigImmediately();
        },
        setColumnVisible: (col, visible) => this.columnOperations.setColumnVisible(col, visible),
        setAllColumnsVisible: (visible) => this.setAllColumnsVisible(visible),
        moveColumn: (key, offset) => this.columnOperations.moveColumn(key, offset),
        moveColumnTo: (key, targetKey, placement) => this.columnOperations.moveColumnTo(key, targetKey, placement),
        toggleColumnWrap: (col) => this.toggleColumnWrap(col),
        editColumn: (col) => this.showColumnRenameModal(col),
        addColumn: () => { void this.columnOperations.appendColumn(); },
      },
      this.getHeaderPopoverAnchor("columns")
    );
  }

  private renderViewConfigPanel(): void {
    if (!this.containerEl_) return;
    const config = this.getConfig();
    const db = this.getActiveDb();
    this.viewConfigPanelRenderer.render(this.containerEl_, this.showViewConfigPanel, config, {
      database: db,
      onChange: () => {
        this.scheduleConfigSave();
        this.refresh();
      },
      onViewTypeChange: (value) => this.setViewType(value),
      onDatabaseChange: () => {
        this.scheduleConfigSave();
        this.updateDatabaseChrome();
        this.updateStickyOffsets();
        this.refresh();
      },
      statusPresets: this.getAvailableStatusPresets(db),
      defaultStatusPresetId: resolveDefaultStatusPresetId(
        this.getAvailableStatusPresets(db),
        db.defaultStatusPresetId || this.defaultStatusPresetId
      ),
      onDefaultStatusPresetChange: (value) => {
        db.defaultStatusPresetId = value || undefined;
        this.scheduleConfigSave();
      },
      onManageStatusPresets: () => this.showDatabaseStatusPresetManager(),
      viewStatusPresets: this.getAvailableStatusPresets(db, config),
      defaultViewStatusPresetId: this.getDefaultStatusPresetId(db, config),
      onDefaultViewStatusPresetChange: (value) => {
        config.defaultStatusPresetId = value || undefined;
        this.scheduleConfigSave();
      },
      onManageViewStatusPresets: () => this.showViewStatusPresetManager(),
    }, this.getHeaderPopoverAnchor("view"));
  }

  private updateDatabaseChrome(): void {
    if (!this.containerEl_) return;
    const db = this.getActiveDb();
    const heading = this.containerEl_.querySelector(":scope > .db-header .db-heading") as HTMLElement | null;
    if (heading) {
      const name = db?.name || t("common.untitledDatabase");
      const headingText = heading.querySelector(".db-heading-text") as HTMLElement | null;
      if (headingText) headingText.textContent = name;
      else heading.textContent = name;
      heading.setAttribute("title", name);
    }
    const header = this.containerEl_.querySelector(":scope > .db-header") as HTMLElement | null;
    if (!header) return;
    const existing = header.querySelector(".db-description") as HTMLElement | null;
    const desc = existing || header.createDiv({ cls: "db-description" });
    const description = db?.description || "";
    const placeholder = t("viewConfig.descriptionPlaceholder");
    if (!existing && heading?.parentElement?.nextSibling) header.insertBefore(desc, heading.parentElement.nextSibling);
    desc.textContent = description;
    desc.toggleClass("is-empty", !description);
    desc.setAttribute("title", description || placeholder);
    desc.setAttribute("data-placeholder", placeholder);
  }

  private showColumnRenameModal(col: ColumnDef): void {
    const config = this.getConfig();
    if (!config) return;
    new ColumnRenameModal(this.app, col, config.schema.columns, async (result) => {
      await this.columnOperations.renameColumn(col, result);
    }).open();
  }

  private setAllColumnsVisible(visible: boolean): void {
    const config = this.getConfig();
    if (!config) return;
    const state = this.vs();
    if (visible) {
      state.hiddenColumns.clear();
    } else {
      const requiredKeys = this.getRequiredColumnKeys(config, state);
      for (const col of getColumnsInOrder(config)) {
        if (!requiredKeys.has(col.key)) state.hiddenColumns.add(col.key);
      }
    }
    this.viewStateStore.persist(config, state);
    this.scheduleConfigSave();
    this.rerenderToolbar();
    this.renderColumnManager();
    this.refresh();
  }

  private getRequiredColumnKeys(config: ViewConfig, state: DatabaseViewState): Set<string> {
    const keys = new Set<string>();
    if (config.viewType === "table") return keys;
    if (config.titleField) keys.add(config.titleField);
    const groupField = config.viewType === "board"
      ? config.boardGroupField || state.groupByField
      : state.groupByField;
    if (groupField) keys.add(groupField);
    if (config.viewType === "board" && config.boardSubgroupField) {
      keys.add(config.boardSubgroupField);
    }
    return keys;
  }

  private toggleColumnWrap(col: ColumnDef): void {
    col.wrap = !col.wrap || undefined;
    this.scheduleConfigSave();
    this.renderColumnManager();
    this.refresh();
  }

  private showStatusOptionsModal(col: ColumnDef): void {
    new StatusOptionsModal(this.app, col, async (options) => {
      col.statusOptions = options;
      await this.saveCurrentViewConfig();
      this.refresh();
    }, this.getAvailableStatusPresets(this.getActiveDb(), this.getConfig()), true, this.getDefaultStatusOptions()).open();
  }

  private showDatabaseStatusPresetManager(): void {
    const db = this.getActiveDb();
    new StatusPresetManagerModal(
      this.app,
      `${db.name || t("common.untitledDatabase")} · ${t("statusPresets.title")}`,
      db.statusPresets || [],
      db.defaultStatusPresetId || this.defaultStatusPresetId,
      async (presets, defaultPresetId) => {
        db.statusPresets = presets;
        db.defaultStatusPresetId = defaultPresetId;
        await this.saveCurrentViewConfig();
        this.renderViewConfigPanel();
      }
    ).open();
  }

  private showViewStatusPresetManager(): void {
    const db = this.getActiveDb();
    const view = this.getConfig();
    new StatusPresetManagerModal(
      this.app,
      `${view.name || t("common.untitled")} · ${t("statusPresets.title")}`,
      view.statusPresets || [],
      view.defaultStatusPresetId || db.defaultStatusPresetId || this.defaultStatusPresetId,
      async (presets, defaultPresetId) => {
        view.statusPresets = presets;
        view.defaultStatusPresetId = defaultPresetId;
        await this.saveCurrentViewConfig();
        this.renderViewConfigPanel();
      }
    ).open();
  }

  private showFormulaModal(col: ColumnDef): void {
    const config = this.getConfig();
    if (!config) return;
    const computedKey = col.computedKey || col.key;
    const computedField = config.schema.computedFields.find((field) => field.key === computedKey);
    new FormulaModal(this.app, col, computedField, this.rows, config.schema.columns, async (result) => {
      await this.saveFormula(col, result);
    }).open();
  }

  private async saveFormula(col: ColumnDef, result: FormulaSaveResult): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    col.type = "computed";
    col.computedKey = col.computedKey || col.key;
    const existing = config.schema.computedFields.find((field) => field.key === col.computedKey);
    if (existing) {
      existing.label = col.label;
      existing.expression = result.expression;
      existing.type = result.resultType;
    } else {
      config.schema.computedFields.push({
        key: col.computedKey,
        label: col.label,
        expression: result.expression,
        type: result.resultType,
      });
    }
    await this.saveCurrentViewConfig();
    this.refresh();
  }

  private async changeColumnType(col: ColumnDef, type: ColumnDef["type"]): Promise<void> {
    await this.columnOperations.changeColumnType(col, type);
    if (type === "computed") this.showFormulaModal(col);
  }

  private getFilesForConfig(config: ViewConfig): TFile[] {
    return this.dataSource
      .getRecordsForConfig(this.getActiveDb())
      .map((record) => record.file);
  }

  private async saveConfigImmediately(): Promise<void> {
    if (this.configSaveTimer !== null) {
      clearTimeout(this.configSaveTimer);
      this.configSaveTimer = null;
    }
    await this.saveCurrentViewConfig();
  }

  /** Show a floating context menu on column header right-click */
  private showContextMenu(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement): void {
    this.columnMenu.show(event, col, anchorEl);
  }

  /** Save the current view config back to its source (settings or file) */
  private async saveCurrentViewConfig(mutationOverride?: ViewConfigMutation): Promise<void> {
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const mutation = mutationOverride || this.getCurrentMutationTarget();
    if (entry.sourcePath) {
      // File-based: write back to file
      const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
      if (file instanceof TFile) {
        this.suppressDataReloadUntil = Date.now() + 2500;
        await this.dataSource.updateViewDefFile(file, entry.config, mutation);
      }
    } else {
      // Settings-based: entry.config shares reference with viewConfigs,
      // so modifications are already in the settings source object
      await this.onConfigChanged?.();
      if (mutation) this.dataSource.notifyViewConfigChanged({ ...mutation, database: entry.config });
    }
  }

  private scheduleViewStateSave(): void {
    const config = this.getConfig();
    if (!config) return;
    this.viewStateStore.persist(config, this.vs());
    this.scheduleConfigSave();
  }

  /** Debounced config save: batch rapid changes (drag, resize) into one write */
  private scheduleConfigSave(): void {
    if (this.configSaveTimer !== null) {
      clearTimeout(this.configSaveTimer);
    }
    this.configSaveTimer = window.setTimeout(() => {
      this.configSaveTimer = null;
      this.saveCurrentViewConfig().catch((err) => {
        console.error("Note Database: failed to save view config", err);
        new Notice(t("errors.saveViewConfigFailed", { error: String(err) }));
      });
    }, 300);
  }

  private render(): void {
    const config = this.getConfig();
    const dbConfig = this.getActiveDb();
    this.applyDisplayWidth();
    this.containerEl_?.toggleClass("has-selection-status", false);
    this.applyViewTypeClass(config?.viewType || "table");
    if (!config) {
      this.containerEl_?.createDiv({
        cls: "db-empty",
        text: t("empty.noDatabases"),
      });
      return;
    }
    if (!config.schema || !config.schema.columns || config.schema.columns.length === 0) {
      this.containerEl_?.createDiv({
        cls: "db-empty",
        text: t("empty.noColumnsDb", { name: dbConfig.name }),
      });
      return;
    }
    if (config.schema.columns.length === 1) {
      this.containerEl_?.createDiv({
        cls: "db-empty",
        text: t("empty.onlyNameColumnDb", { name: dbConfig.name }),
      });
      return;
    }
    let records: NoteRecord[];
    try {
      records = this.includePendingNewRecord(this.dataSource.getRecordsForConfig(this.getEffectiveConfig(dbConfig)));
    } catch (e) {
      this.containerEl_?.createDiv({
        cls: "db-empty",
        text: t("errors.readFolderFailed", { error: String(e) }),
      });
      return;
    }

    this.rows = this.rowPipeline.build(records, config, this.vs());
    this.scheduleComputedSync(config, this.rows);

    this.renderSummary();
    this.renderSelectionStatusBar();

    if (config.viewType === "board") {
      this.renderBoard(config);
    } else if (config.viewType === "gallery") {
      this.renderGallery(config);
    } else if (config.viewType === "list") {
      this.renderList(config);
    } else if (this.vs().groupByField) {
      this.renderGroupedTable(config, this.vs().groupByField);
    } else {
      this.renderTable(config);
    }
    // Clear pending-show flags after one render cycle
    this.pendingShowColumns.clear();
    this.revealPendingNewRow();
  }

  private renderSummary(): void {
    if (!this.containerEl_) return;
    this.summaryRenderer.render(this.containerEl_, this.rows);
  }

  private renderSelectionStatusBar(): void {
    if (!this.containerEl_) return;
    this.containerEl_.querySelector(":scope > .db-selection-status-bar")?.remove();
    const count = this.selectedRows.size;
    this.containerEl_.toggleClass("has-selection-status", count > 0);
    if (count <= 0) return;
    const bar = this.containerEl_.createDiv({ cls: "db-selection-status-bar" });
    const checkbox = bar.createEl("input", {
      cls: "db-selection-clear-checkbox",
      attr: { type: "checkbox", title: t("toolbar.selectedCount", { count }) },
    });
    checkbox.checked = true;
    checkbox.onchange = () => {
      if (!checkbox.checked) {
        this.clearSelection();
      }
    };
    bar.createSpan({ cls: "db-selection-count", text: t("toolbar.selectedCount", { count }) });
    const deleteBtn = bar.createEl("button", {
      cls: "db-selection-delete",
      text: t("common.delete"),
      attr: { type: "button" },
    });
    deleteBtn.onclick = () => { void this.deleteSelectedRows(); };
    const summary = this.containerEl_.querySelector(":scope > .db-summary");
    if (summary?.parentElement) summary.parentElement.insertBefore(bar, summary.nextSibling);
  }

  private syncSelectionControls(): void {
    if (!this.containerEl_) return;
    this.syncRowSelectionInputs();
    this.syncGroupedSelectionInputs();
  }

  private syncRowSelectionInputs(): void {
    if (!this.containerEl_) return;
    const rowSelectors = [
      [".db-table tbody tr[data-note-database-row-path]", ".db-select-col input[type='checkbox']"],
      [".db-board-card[data-note-database-row-path]", ".db-board-card-checkbox"],
      [".db-gallery-card[data-note-database-row-path]", ".db-gallery-card-checkbox"],
      [".db-list-row[data-note-database-row-path]", ".db-list-row-checkbox"],
    ] as const;
    for (const [rowSelector, inputSelector] of rowSelectors) {
      this.containerEl_.querySelectorAll<HTMLElement>(rowSelector).forEach((rowEl) => {
        const path = rowEl.getAttribute("data-note-database-row-path");
        const input = rowEl.querySelector<HTMLInputElement>(inputSelector);
        if (!path || !input) return;
        input.checked = this.selectedRows.has(path);
        input.indeterminate = false;
      });
    }
  }

  private syncGroupedSelectionInputs(): void {
    if (!this.containerEl_) return;
    this.containerEl_.querySelectorAll<HTMLElement>(".db-table").forEach((table) => {
      this.syncScopeSelectionInput(
        table.querySelector<HTMLInputElement>("thead .db-select-col input[type='checkbox']"),
        this.getSelectionPaths(table, "tbody tr[data-note-database-row-path]")
      );
    });
    this.containerEl_.querySelectorAll<HTMLElement>(".db-board-column").forEach((column) => {
      this.syncScopeSelectionInput(
        column.querySelector<HTMLInputElement>(".db-board-column-checkbox"),
        this.getSelectionPaths(column, ".db-board-card[data-note-database-row-path]")
      );
    });
    this.containerEl_.querySelectorAll<HTMLElement>(".db-board-subgroup").forEach((subgroup) => {
      this.syncScopeSelectionInput(
        subgroup.querySelector<HTMLInputElement>(".db-board-subgroup-checkbox"),
        this.getSelectionPaths(subgroup, ".db-board-card[data-note-database-row-path]")
      );
    });
    this.containerEl_.querySelectorAll<HTMLElement>(".db-gallery-group").forEach((group) => {
      this.syncScopeSelectionInput(
        group.querySelector<HTMLInputElement>(".db-gallery-group-checkbox"),
        this.getSelectionPaths(group, ".db-gallery-card[data-note-database-row-path]")
      );
    });
    const totalHeader = this.containerEl_.querySelector<HTMLElement>(":scope > .db-gallery-total-header");
    const gallery = this.containerEl_.querySelector<HTMLElement>(":scope > .db-gallery");
    if (totalHeader && gallery) {
      this.syncScopeSelectionInput(
        totalHeader.querySelector<HTMLInputElement>(".db-gallery-group-checkbox"),
        this.getSelectionPaths(gallery, ".db-gallery-card[data-note-database-row-path]")
      );
    }
    this.containerEl_.querySelectorAll<HTMLElement>(".db-list-group").forEach((group) => {
      this.syncScopeSelectionInput(
        group.querySelector<HTMLInputElement>(".db-list-group-checkbox"),
        this.getSelectionPaths(group, ".db-list-row[data-note-database-row-path]")
      );
    });
    const listTotalHeader = this.containerEl_.querySelector<HTMLElement>(":scope > .db-list-total-header");
    const list = this.containerEl_.querySelector<HTMLElement>(":scope > .db-list");
    if (listTotalHeader && list) {
      this.syncScopeSelectionInput(
        listTotalHeader.querySelector<HTMLInputElement>(".db-list-group-checkbox"),
        this.getSelectionPaths(list, ".db-list-row[data-note-database-row-path]")
      );
    }
  }

  private getSelectionPaths(parent: HTMLElement, selector: string): string[] {
    return Array.from(parent.querySelectorAll<HTMLElement>(selector))
      .map((el) => el.getAttribute("data-note-database-row-path") || "")
      .filter((path) => path.length > 0);
  }

  private syncScopeSelectionInput(input: HTMLInputElement | null, paths: string[]): void {
    if (!input) return;
    const selectedCount = paths.filter((path) => this.selectedRows.has(path)).length;
    input.checked = paths.length > 0 && selectedCount === paths.length;
    input.indeterminate = selectedCount > 0 && selectedCount < paths.length;
  }

  private includePendingNewRecord(records: NoteRecord[]): NoteRecord[] {
    const pending = this.pendingNewRecord;
    if (!pending) return records;
    if (Date.now() > pending.expiresAt) {
      this.clearPendingNewRow();
      return records;
    }

    let found = false;
    const merged = records.map((record) => {
      if (record.file.path !== pending.file.path) return record;
      found = true;
      return {
        file: record.file,
        frontmatter: { ...pending.frontmatter, ...record.frontmatter },
      };
    });

    if (!found) {
      merged.push({
        file: pending.file,
        frontmatter: pending.frontmatter,
      });
    }
    return merged;
  }

  private revealPendingNewRow(): void {
    const path = this.pendingNewFilePath;
    if (!path || !this.containerEl_) return;

    const target = this.findRenderedRowElement(path);
    if (!target) {
      this.schedulePendingNewRowRevealRetry();
      return;
    }

    requestAnimationFrame(() => {
      if (!target.isConnected) {
        this.schedulePendingNewRowRevealRetry();
        return;
      }
      const scrollTarget = target.matches("tr")
        ? target.querySelector<HTMLElement>("td") || target
        : target;
      scrollTarget.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      target.addClass("is-new-record-highlight");
      this.clearPendingNewRow();
      window.setTimeout(() => {
        if (target.isConnected) target.removeClass("is-new-record-highlight");
      }, 2200);
    });
  }

  private findRenderedRowElement(path: string): HTMLElement | null {
    if (!this.containerEl_) return null;
    const candidates = Array.from(
      this.containerEl_.querySelectorAll<HTMLElement>("[data-note-database-row-path]")
    );
    return candidates.find((candidate) => candidate.dataset.noteDatabaseRowPath === path) || null;
  }

  private schedulePendingNewRowRevealRetry(): void {
    if (!this.pendingNewFilePath) return;
    if (this.pendingNewRecord && Date.now() > this.pendingNewRecord.expiresAt) {
      this.clearPendingNewRow();
      return;
    }
    if (this.pendingNewRevealTimer !== null) return;
    this.pendingNewRevealTimer = window.setTimeout(() => {
      this.pendingNewRevealTimer = null;
      this.refresh();
    }, 350);
  }

  private clearPendingNewRow(clearTimer = true): void {
    this.pendingNewFilePath = undefined;
    this.pendingNewRecord = undefined;
    if (clearTimer && this.pendingNewRevealTimer !== null) {
      clearTimeout(this.pendingNewRevealTimer);
      this.pendingNewRevealTimer = null;
    }
  }

  /** Set up all column header interactions: click-sort, context menu, drag-to-reorder, resize */
  private setupColumnHeader(th: HTMLElement, col: ColumnDef): void {
    this.columnHeaderController.setup(th, col);
  }

  private renderTable(config: ViewConfig): void {
    if (!this.containerEl_) return;
    this.tableRenderer.renderTable(this.containerEl_, this.getStatefulConfig(config), this.rows);
  }

  private setupRowInteractions(tr: HTMLElement, row: RowData): void {
    this.rowMenu.attachToRow(tr, row);
  }

  private async deleteRow(row: RowData): Promise<void> {
    const displayName = row.file.name.replace(/\.md$/, "");
    try {
      await this.dataSource.trashNote(row.file);
      new Notice(t("notice.deletedRow", { name: displayName }));
      await this.refreshAfterSave();
    } catch (err) {
      console.error("Note Database: failed to delete row", err);
      new Notice(t("errors.deleteFailed", { error: String(err) }));
    }
  }

  private async openRow(row: RowData): Promise<void> {
    await this.syncComputedFieldsNow(false);
    this.dataSource.openNote(row.file);
  }

  private renderCell(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef
  ): void {
    this.cellRenderer.renderCell(td, row, col);
  }

  private setupTableFillHandle(td: HTMLElement, row: RowData, col: ColumnDef): void {
    if (!this.canFillColumn(col)) return;
    td.addClass("db-fillable-cell");
    const handle = td.createSpan({
      cls: "db-cell-fill-handle",
      attr: { title: t("cell.dragFill") },
    });
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.startTableFillDrag(event, td, row, col);
    });
  }

  private canFillColumn(col: ColumnDef): boolean {
    return col.key !== "file.name" && col.type !== "computed";
  }

  private startTableFillDrag(event: MouseEvent, sourceCell: HTMLElement, sourceRow: RowData, col: ColumnDef): void {
    const tbody = sourceCell.closest("tbody");
    if (!tbody) return;
    if (sourceCell.querySelector("input, textarea, select")) return;
    const sourceValue = this.cloneFillValue(this.getFillValue(sourceRow, col));
    sourceCell.addClass("is-fill-source");
    let targetCells: HTMLElement[] = [];

    const clearTargets = () => {
      for (const cell of targetCells) cell.removeClass("is-fill-target");
      targetCells = [];
    };
    const updateTargets = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const targetCell = element?.closest<HTMLElement>("td[data-note-database-row-path][data-note-database-column-key]");
      if (!targetCell || targetCell.closest("tbody") !== tbody) {
        clearTargets();
        return;
      }
      const nextCells = this.getTableFillRange(sourceCell, targetCell, tbody);
      clearTargets();
      targetCells = nextCells;
      for (const cell of targetCells) cell.addClass("is-fill-target");
    };
    const onMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      updateTargets(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      sourceCell.removeClass("is-fill-source");
      const targets = this.getFillTargets(targetCells);
      clearTargets();
      if (targets.length > 0) void this.applyTableFill(targets, sourceValue);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
    updateTargets(event.clientX, event.clientY);
  }

  private getTableFillRange(sourceCell: HTMLElement, targetCell: HTMLElement, tbody: Element): HTMLElement[] {
    if (sourceCell === targetCell) return [];
    const rows = Array.from(tbody.querySelectorAll<HTMLElement>("tr[data-note-database-row-path]"));
    const sourceRow = sourceCell.closest("tr");
    const targetRow = targetCell.closest("tr");
    const sourceIndex = sourceRow ? rows.indexOf(sourceRow as HTMLElement) : -1;
    const targetIndex = targetRow ? rows.indexOf(targetRow as HTMLElement) : -1;
    if (sourceIndex < 0 || targetIndex < 0) return [];

    const firstRow = rows[0];
    const visibleColKeys = firstRow
      ? Array.from(firstRow.querySelectorAll<HTMLElement>("td[data-note-database-column-key]"))
        .map((cell) => cell.dataset.noteDatabaseColumnKey)
        .filter((key): key is string => Boolean(key))
      : [];
    const sourceColKey = sourceCell.dataset.noteDatabaseColumnKey;
    const targetColKey = targetCell.dataset.noteDatabaseColumnKey;
    const sourceColIndex = sourceColKey ? visibleColKeys.indexOf(sourceColKey) : -1;
    const targetColIndex = targetColKey ? visibleColKeys.indexOf(targetColKey) : -1;
    if (sourceColIndex < 0 || targetColIndex < 0) return [];

    const rowStart = Math.min(sourceIndex, targetIndex);
    const rowEnd = Math.max(sourceIndex, targetIndex);
    const colStart = Math.min(sourceColIndex, targetColIndex);
    const colEnd = Math.max(sourceColIndex, targetColIndex);
    const cells: HTMLElement[] = [];
    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex++) {
      for (let colIndex = colStart; colIndex <= colEnd; colIndex++) {
        if (rowIndex === sourceIndex && colIndex === sourceColIndex) continue;
        const key = visibleColKeys[colIndex];
        const cell = rows[rowIndex]?.querySelector<HTMLElement>(`td[data-note-database-column-key="${CSS.escape(key)}"]`);
        if (!cell) continue;
        const targetCol = this.getFillColumnByKey(key);
        if (!targetCol || !this.canFillColumn(targetCol)) continue;
        cells.push(cell);
      }
    }
    return cells;
  }

  private getFillTargets(cells: HTMLElement[]): FillTarget[] {
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const seen = new Set<string>();
    const targets: FillTarget[] = [];
    for (const cell of cells) {
      const path = cell.dataset.noteDatabaseRowPath;
      const colKey = cell.dataset.noteDatabaseColumnKey;
      if (!path || !colKey) continue;
      const key = `${path}\u0000${colKey}`;
      if (seen.has(key)) continue;
      const row = rowByPath.get(path);
      const targetCol = this.getFillColumnByKey(colKey);
      if (!row || !targetCol || !this.canFillColumn(targetCol)) continue;
      seen.add(key);
      targets.push({ row, col: targetCol });
    }
    return targets;
  }

  private getFillColumnByKey(key: string): ColumnDef | undefined {
    return this.getConfig()?.schema.columns.find((candidate) => candidate.key === key);
  }

  private getFillValue(row: RowData, col: ColumnDef): unknown {
    if (col.type === "checkbox") return toBooleanValue(row.frontmatter[col.key]);
    return row.frontmatter[col.key] ?? null;
  }

  private cloneFillValue(value: unknown): unknown {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === "object") return JSON.parse(JSON.stringify(value));
    return value;
  }

  private async applyTableFill(targets: FillTarget[], value: unknown): Promise<void> {
    try {
      const updatesByPath = new Map<string, { row: RowData; updates: Record<string, unknown> }>();
      for (const target of targets) {
        const entry = updatesByPath.get(target.row.file.path) || { row: target.row, updates: {} };
        entry.updates[target.col.key] = this.cloneFillValue(value);
        updatesByPath.set(target.row.file.path, entry);
      }
      for (const entry of updatesByPath.values()) {
        await this.dataSource.updateFrontmatter(entry.row.file, entry.updates);
      }
      await this.refreshAfterSave();
      new Notice(t("notice.filledCells", { count: targets.length }));
    } catch (err) {
      new Notice(t("errors.batchFillFailed", { error: String(err) }));
    }
  }

  private renderGroupedTable(config: ViewConfig, field: string): void {
    if (!this.containerEl_) return;
    const groups = this.queryEngine.groupBy(this.rows, field);
    const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
    const sortedGroups = this.queryEngine.sortGroups(groups, order);
    this.tableRenderer.renderGroupedTable(this.containerEl_, this.getStatefulConfig(config), this.rows, sortedGroups, field);
  }

  private renderBoard(config: ViewConfig): void {
    if (!this.containerEl_) return;
    const groupField = config.boardGroupField || this.vs().groupByField || this.getDefaultBoardField(config);
    const groups = this.getBoardGroups(config, groupField);
    this.boardRenderer.render(this.containerEl_, this.getStatefulConfig(config), groups, groupField);
  }

  private renderGallery(config: ViewConfig): void {
    if (!this.containerEl_) return;
    const renderConfig = this.getStatefulConfig(config);
    if (this.vs().groupByField) {
      const field = this.vs().groupByField;
      const groups = this.queryEngine.groupBy(this.rows, field);
      const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
      this.galleryRenderer.renderGrouped(this.containerEl_, renderConfig, this.queryEngine.sortGroups(groups, order), field);
      return;
    }
    this.galleryRenderer.render(this.containerEl_, renderConfig, this.rows);
  }

  private renderList(config: ViewConfig): void {
    if (!this.containerEl_) return;
    const renderConfig = this.getStatefulConfig(config);
    if (this.vs().groupByField) {
      const field = this.vs().groupByField;
      const groups = this.queryEngine.groupBy(this.rows, field);
      const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
      this.listRenderer.renderGrouped(this.containerEl_, renderConfig, this.queryEngine.sortGroups(groups, order), field);
      return;
    }
    this.listRenderer.render(this.containerEl_, renderConfig, this.rows);
  }

  private getStatefulConfig(config: ViewConfig): ViewConfig {
    const state = this.vs();
    return {
      ...config,
      sortColumn: state.sortColumn,
      sortDirection: state.sortDirection,
      sortRules: state.sortRules,
    };
  }

  private getDefaultBoardField(config: ViewConfig): string {
    if (config.schema.columns.some((col) => col.key === "status")) return "status";
    if (this.vs().groupByField) return this.vs().groupByField;
    return config.schema.columns.find((col) => col.type === "status" || col.type === "select")?.key ||
      config.schema.columns.find((col) => col.key === "category")?.key ||
      config.schema.columns[0]?.key ||
      "status";
  }

  private getDefaultGalleryImageField(config: ViewConfig): string | undefined {
    return config.galleryImageField ||
      config.schema.columns.find((col) => /封面|cover|image|图片|图像|thumbnail|poster/i.test(col.key) || /封面|图片|图像/.test(col.label))?.key;
  }

  private getBoardGroups(config: ViewConfig, field: string): BoardGroup[] {
    const groups = this.queryEngine.groupBy(this.rows, field);
    const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
    const groupMap = new Map(groups.map((group) => [group.key, group]));
    const col = config.schema.columns.find((candidate) => candidate.key === field);
    const defaultKeys = getDefaultGroupOrder(config, field);
    if (col && defaultKeys.length > 0 && (isOptionColumnType(col.type) || col.type === "checkbox")) {
      for (const key of defaultKeys) {
        if (!groupMap.has(key)) {
          groupMap.set(key, { key, rows: [], count: 0 });
        }
      }
    }
    const sortedGroups = this.queryEngine.sortGroups(Array.from(groupMap.values()), order);
    if (!this.hasActiveBoardSort()) {
      this.applyBoardCardOrder(config, field, sortedGroups);
    }
    this.applyBoardSubgroups(config, field, sortedGroups);
    return sortedGroups;
  }

  private applyBoardSubgroups(config: ViewConfig, groupField: string, groups: BoardGroup[]): void {
    const subgroupField = config.boardSubgroupField;
    if (!subgroupField || subgroupField === groupField) return;
    if (!config.schema.columns.some((col) => col.key === subgroupField)) return;
    for (const group of groups) {
      group.subgroups = this.getBoardSubgroups(config, subgroupField, group.rows);
    }
  }

  private getBoardSubgroups(config: ViewConfig, field: string, rows: RowData[]): BoardGroup["subgroups"] {
    const groups = this.queryEngine.groupBy(rows, field);
    const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
    return this.queryEngine.sortGroups(groups, order);
  }

  private hasActiveBoardSort(): boolean {
    const state = this.vs();
    return Boolean(state.sortColumn || state.sortRules.length > 0);
  }

  private applyBoardCardOrder(config: ViewConfig, field: string, groups: BoardGroup[]): void {
    const orders = config.boardCardOrders?.[field];
    if (!orders) return;
    for (const group of groups) {
      const order = orders[group.key];
      if (!order || order.length === 0) continue;
      const rank = new Map(order.map((path, index) => [path, index]));
      group.rows = [...group.rows].sort((a, b) => {
        const ai = rank.get(a.file.path);
        const bi = rank.get(b.file.path);
        if (ai != null && bi != null) return ai - bi;
        if (ai != null) return -1;
        if (bi != null) return 1;
        return 0;
      });
    }
  }

  private updateBoardGroupOrder(field: string, order: string[]): void {
    const config = this.getConfig();
    if (!config) return;
    config.groupOrders = { ...(config.groupOrders || {}), [field]: order };
    this.scheduleConfigSave();
    this.refresh();
  }

  private updateBoardCardOrder(field: string, groupKey: string, paths: string[]): void {
    const config = this.getConfig();
    if (!config) return;
    config.boardCardOrders = {
      ...(config.boardCardOrders || {}),
      [field]: {
        ...(config.boardCardOrders?.[field] || {}),
        [groupKey]: paths,
      },
    };
    this.scheduleConfigSave();
    this.refresh();
  }

  private updateBoardColumnWidth(width: number): void {
    const config = this.getConfig();
    if (!config) return;
    config.boardColumnWidth = width;
    this.scheduleConfigSave();
  }

  private isGroupCollapsed(config: ViewConfig | undefined, field: string, key: string): boolean {
    if (!config) return false;
    return (config.collapsedGroups?.[field] || []).includes(key);
  }

  private toggleGroupCollapsed(config: ViewConfig | undefined, field: string, key: string): void {
    if (!config) return;
    const current = new Set(config.collapsedGroups?.[field] || []);
    if (current.has(key)) current.delete(key);
    else current.add(key);
    config.collapsedGroups = { ...(config.collapsedGroups || {}), [field]: Array.from(current) };
    if (config.collapsedGroups[field].length === 0) delete config.collapsedGroups[field];
    this.scheduleConfigSave();
    this.refresh();
  }

  private updateGalleryCardSize(width: number): void {
    const config = this.getConfig();
    if (!config) return;
    config.galleryCardSize = width;
    this.scheduleConfigSave();
    this.renderViewConfigPanel();
  }

  private async updateBoardGroup(row: RowData, field: string, value: string, fromValue?: string): Promise<void> {
    try {
      const col = this.getConfig()?.schema.columns.find((candidate) => candidate.key === field);
      const rows = this.getRowsForGroupMove(row);
      for (const targetRow of rows) {
        const nextValue = this.getMovedGroupValue(targetRow, field, col, fromValue, value);
        await this.dataSource.updateFrontmatter(targetRow.file, { [field]: nextValue });
      }
      await this.refreshAfterSave();
    } catch (err) {
      new Notice(t("errors.updateFailed", { error: String(err) }));
    }
  }

  private getRowsForGroupMove(row: RowData): RowData[] {
    if (!this.selectedRows.has(row.file.path)) return [row];
    const selected = this.rows.filter((candidate) => this.selectedRows.has(candidate.file.path));
    return selected.length > 0 ? selected : [row];
  }

  private getMovedGroupValue(
    row: RowData,
    field: string,
    col: ColumnDef | undefined,
    fromValue: string | undefined,
    toValue: string
  ): unknown {
    if (col?.type === "multi-select") {
      return moveMultiSelectGroupValue(
        row.frontmatter[field],
        fromValue,
        toValue,
        getColumnOptionValues(col)
      );
    }
    if (isEmptyGroupId(toValue)) return null;
    if (col?.type === "checkbox") return toBooleanValue(toValue);
    return toValue;
  }

  private sortByColumn(col: ColumnDef): void {
    const config = this.getConfig();
    if (!config) return;
    ensureColumnOrder(config);
    const state = this.vs();
    const currentRule = state.sortRules.length === 1 && state.sortRules[0].field === col.key
      ? state.sortRules[0]
      : undefined;
    state.sortColumn = undefined;
    state.sortDirection = "asc";
    if (!currentRule) {
      state.sortRules = [{ field: col.key, direction: "asc" }];
    } else if (currentRule.direction === "asc") {
      state.sortRules = [{ field: col.key, direction: "desc" }];
    } else {
      state.sortRules = [];
    }
    this.scheduleViewStateSave();
    this.refresh();
  }

  private getColumnSortDirection(col: ColumnDef): "asc" | "desc" | null {
    const state = this.vs();
    const rule = state.sortRules.length === 1
      ? state.sortRules[0]
      : undefined;
    if (rule?.field === col.key) return rule.direction;
    if (state.sortRules.length === 0 && state.sortColumn === col.key) return state.sortDirection;
    return null;
  }

  private clearColumnSort(col: ColumnDef): void {
    const state = this.vs();
    state.sortRules = state.sortRules.filter((rule) => rule.field !== col.key);
    if (state.sortColumn === col.key) {
      state.sortColumn = undefined;
      state.sortDirection = "asc";
    }
    this.scheduleViewStateSave();
    this.refresh();
  }

  private autoFitColumn(col: ColumnDef): void {
    const config = this.getConfig();
    if (!config) return;
    col.width = this.calculateAutoColumnWidth(col, this.rows);
    this.scheduleConfigSave();
    this.refresh();
  }

  private autoFitAllColumns(): void {
    const config = this.getConfig();
    if (!config) return;
    for (const col of getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns)) {
      col.width = this.calculateAutoColumnWidth(col, this.rows);
    }
    this.scheduleConfigSave();
    this.refresh();
  }

  private calculateAutoColumnWidth(col: ColumnDef, rows: RowData[]): number {
    const labelLength = (col.label || col.key).length;
    const longestValue = rows.reduce((max, row) => {
      const text = this.getColumnDisplayText(row, col);
      return Math.max(max, text.length);
    }, labelLength);
    const base = col.type === "checkbox" ? Math.max(54, labelLength * 7.2 + 32) : Math.ceil(longestValue * 7.2 + 48);
    return Math.max(36, Math.min(base, 800));
  }

  private getColumnDisplayText(row: RowData, col: ColumnDef): string {
    if (col.key === "file.name") return row.file.basename;
    const value = col.type === "computed" && col.computedKey
      ? row.computed[col.computedKey]
      : row.frontmatter[col.key];
    if (value == null) return "";
    if (Array.isArray(value)) return value.map((entry) => String(entry)).join(", ");
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  /** Refresh after waiting for metadata cache to catch up */
  private async refreshAfterSave(): Promise<void> {
    // Yield to event loop so metadata cache can re-parse after processFrontMatter
    await new Promise(resolve => setTimeout(resolve, 0));
    this.refresh();
  }

  private scheduleComputedSync(config: ViewConfig, rows: RowData[]): void {
    if (config.syncComputedToFrontmatter === false || config.schema.computedFields.length === 0) return;
    if (this.computedSyncTimer !== null) clearTimeout(this.computedSyncTimer);
    this.computedSyncTimer = window.setTimeout(() => {
      this.computedSyncTimer = null;
      void this.syncComputedFieldsNow(false, config);
    }, 500);
  }

  private async syncComputedFieldsNow(
    notify: boolean,
    config = this.getConfig()
  ): Promise<void> {
    if (!config || this.syncingComputed) return;
    this.syncingComputed = true;
    try {
      const computedColumns = config.schema.columns.filter((col) => col.type === "computed");
      const db = this.getCurrentEntry()?.config;
      const records = db ? this.dataSource.getRecordsForDatabase(db) : this.rows.map((row) => ({
        file: row.file,
        frontmatter: row.frontmatter,
      }));
      const engine = new ComputedFieldEngine(config.schema.computedFields, config.schema.columns);
      let changed = 0;
      for (const record of records) {
        const computed = engine.evaluate(record.frontmatter);
        const updates: Record<string, unknown> = {};
        for (const col of computedColumns) {
          const key = col.computedKey || col.key;
          const value = computed[key];
          const nextValue = value == null ? "" : value;
          if (String(record.frontmatter[col.key] ?? "") !== String(nextValue ?? "")) {
            updates[col.key] = nextValue;
          }
        }
        if (Object.keys(updates).length > 0) {
          await this.dataSource.updateFrontmatter(record.file, updates);
          changed += 1;
        }
      }
      if (notify) new Notice(t("notice.syncedFormulas", { count: changed }));
    } finally {
      this.syncingComputed = false;
    }
  }

  refresh(): void {
    if (!this.containerEl_) return;
    // Remove only top-level rendered results; panels manage their own contents.
    this.containerEl_.querySelectorAll(":scope > .db-table, :scope > .db-table-wrap, :scope > .db-grouped-table, :scope > .db-board, :scope > .db-gallery, :scope > .db-gallery-grouped, :scope > .db-gallery-total-header, :scope > .db-list, :scope > .db-list-grouped, :scope > .db-list-total-header, :scope > .db-summary, :scope > .db-selection-status-bar, :scope > .db-empty")
      .forEach(el => el.remove());
    this.render();
    this.updateStickyOffsets();
    if (this.showColumnManager) {
      this.renderColumnManager();
    }
    if (this.showSortPanel) {
      this.renderSortPanel();
    }
    if (this.showFilterPanel) {
      this.updateToolbarIndicators();
    }
    if (this.showViewConfigPanel) {
      this.renderViewConfigPanel();
    }
  }
}

class CsvMarkdownExportModal extends Modal {
  private resolve?: (options: CsvMarkdownExportOptions | null) => void;
  private includeFrontmatter = true;

  open(): Promise<CsvMarkdownExportOptions | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("note-database-modal");
    this.contentEl.createEl("h3", { text: t("csvMarkdownExport.title") });
    this.contentEl.createDiv({ cls: "db-panel-empty", text: t("csvMarkdownExport.desc") });

    this.renderCheckboxOption(t("csvMarkdownExport.includeFrontmatter"), this.includeFrontmatter, (value) => {
      this.includeFrontmatter = value;
    });

    const actions = this.contentEl.createDiv({ cls: "db-modal-actions" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    actions.createEl("button", {
      cls: "mod-cta",
      text: t("csvMarkdownExport.export"),
      attr: { type: "button" },
    }).onclick = () => {
      const resolve = this.resolve;
      this.resolve = undefined;
      this.close();
      resolve?.({
        includeFrontmatter: this.includeFrontmatter,
      });
    };
  }

  private renderCheckboxOption(text: string, checked: boolean, onChange: (value: boolean) => void): void {
    const row = this.contentEl.createDiv({ cls: "db-csv-markdown-option-row" });
    const label = row.createEl("label", { cls: "db-csv-markdown-option-label" });
    const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
    checkbox.checked = checked;
    checkbox.onchange = () => onChange(checkbox.checked);
    label.createSpan({ text });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve?.(null);
    this.resolve = undefined;
  }
}
