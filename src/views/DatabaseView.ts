import { ItemView, WorkspaceLeaf, Notice, TFile, normalizePath, stringifyYaml, setIcon } from "obsidian";
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
import { getDefaultGroupOrder, getEffectiveGroupOrder, mergeGroupOrder } from "../data/GroupOrder";
import { isEmptyGroupId, moveMultiSelectGroupValue } from "../data/MultiSelect";
import { generateRanks, rankBetween, rebalanceRanks } from "../data/ManualOrder";
import { CellOptionTransaction, CellRenderer } from "./CellRenderer";
import { ColumnMenu, ColumnMenuOptions } from "./ColumnMenu";
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
import { ColumnOperations, FrontmatterValueChange } from "./ColumnOperations";
import { BoardGroup, BoardRenderer } from "./BoardRenderer";
import { GalleryRenderer } from "./GalleryRenderer";
import { ListRenderer } from "./ListRenderer";
import { ColumnRenameModal } from "./modals/ColumnRenameModal";
import { DeleteDatabaseModal } from "./modals/DeleteDatabaseModal";
import { AddDatabaseModal } from "./modals/AddDatabaseModal";
import { BaseImportColumn, BaseImportConfirmModal } from "./modals/BaseImportConfirmModal";
import { collectFileFrontmatterKeys, inferColumnType, getVaultTags, collectUniqueListValues, collectUniqueStringValues } from "../data/FrontmatterScanner";
import { StatusOptionsModal } from "./modals/StatusOptionsModal";
import { FileTitleDisplay, getFileTitleDisplay } from "./FileTitleDisplay";
import { StatusPresetManagerModal } from "./modals/StatusPresetManagerModal";
import { FormulaModal, FormulaSaveResult } from "./modals/FormulaModal";
import { CsvMarkdownExportModal } from "./modals/CsvMarkdownExportModal";
import { CsvMarkdownExportOptions } from "../data/CsvMarkdownZipExport";
import { t } from "../i18n";
import { createStoredZip, ZipEntry } from "../data/ZipExport";
import { getEffectiveFilterRules } from "../data/FilterRules";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { estimateAutoColumnWidth } from "./ColumnWidth";
import { positionToolbarPopover } from "./PopoverPosition";

export const DATABASE_VIEW_TYPE = "note-database-view";

interface FillTarget {
  row: RowData;
  col: ColumnDef;
}

interface BatchTargetPlan<T extends FillTarget = FillTarget> {
  targets: T[];
  skipped: number;
}

interface CellAddress {
  rowPath: string;
  colKey: string;
}

interface CellSelectionRange {
  anchor: CellAddress;
  focus: CellAddress;
}

interface CellEditChange {
  file: TFile;
  path: string;
  key: string;
  oldValue: unknown;
  oldExists: boolean;
  newValue: unknown;
}

interface CellHistoryEntry {
  type: "cells";
  label: string;
  changes: CellEditChange[];
}

interface ConfigHistoryEntry {
  type: "config";
  label: string;
  dbId: string;
  dbPath: string | null;
  viewId?: string;
  before: DatabaseConfig;
  after: DatabaseConfig;
  cellChanges?: CellEditChange[];
}

type HistoryEntry = CellHistoryEntry | ConfigHistoryEntry;

interface ViewEntry {
  config: DatabaseConfig;
  sourcePath: string;
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
  /** Combined database entries from vault files */
  private viewEntries: ViewEntry[] = [];
  private databaseFileOrder: string[] = [];
  private statusPresets: StatusPresetDef[] = [];
  private defaultStatusPresetId?: string;
  private currentDbIndex = 0;
  private currentViewIndex = 0;
  private rows: RowData[] = [];
  private selectedRows = new Set<string>();
  private lastSelectedRowPath: string | null = null;
  private cellSelection: CellSelectionRange | null = null;
  private isSelectingCells = false;
  private showCellFillInput = false;
  private historyStack: HistoryEntry[] = [];
  private configSnapshots = new Map<string, DatabaseConfig>();
  private pendingConfigCellChanges: CellEditChange[] | null = null;
  private optionTransactionQueue = Promise.resolve();
  private applyingHistory = false;
  private pendingUndoLabel: string | null = null;
  private undoActionEl?: HTMLElement;
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
  private removeHeaderPopoverAutoClose?: () => void;
  private groupOrderPopover?: HTMLElement;
  private removeGroupOrderPopoverListener?: () => void;
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
  private scrollbarIdleTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    dataSource: DataSource,
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
    this.propertyService = new PropertyService(this.app, (file, mutator) => this.dataSource.mutateFrontmatter(file, mutator));
    this.cellRenderer = new CellRenderer(
      this.dataSource,
      () => this.refreshAfterSave(),
      (row) => this.openRow(row),
      (col) => this.columnMenu.showOptionsEditor(col),
      (col) => this.showFormulaModal(col),
      false,
      (row, col, transaction) => this.commitCellOptionTransaction(row, col, transaction),
      (row, col, value) => this.saveCellValueWithHistory(row, col, value),
      (row) => this.getFileTitleInfo(row)
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
      setPendingUndoLabel: (label) => { this.pendingUndoLabel = label; },
      setPendingConfigCellChanges: (changes) => {
        this.pendingConfigCellChanges = changes.map((change) => this.normalizeFrontmatterValueChange(change));
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
      setUndoLabel: (label) => { this.pendingUndoLabel = label; },
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
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      moveRowToGroupAndPosition: (row, field, fromGroupKey, toGroupKey, beforePath, afterPath) =>
        this.moveRowToGroupAndPosition(row, field, fromGroupKey, toGroupKey, beforePath, afterPath),
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
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      moveRowWithGroupUpdatesAndPosition: (row, updates, beforePath, afterPath) =>
        this.moveRowWithGroupUpdatesAndPosition(row, updates, beforePath, afterPath),
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
      showColumnMenu: (event, col, anchorEl) => this.showContextMenu(event, col, anchorEl, {
        includeWidthActions: false,
      }),
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
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      moveRowToGroupAndPosition: (row, field, fromGroupKey, toGroupKey, beforePath, afterPath) =>
        this.moveRowToGroupAndPosition(row, field, fromGroupKey, toGroupKey, beforePath, afterPath),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
      showColumnMenu: (event, col, anchorEl) => this.showContextMenu(event, col, anchorEl, {
        includeWidthActions: false,
      }),
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
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      moveRowToGroupAndPosition: (row, field, fromGroupKey, toGroupKey, beforePath, afterPath) =>
        this.moveRowToGroupAndPosition(row, field, fromGroupKey, toGroupKey, beforePath, afterPath),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
      showColumnMenu: (event, col, anchorEl) => this.showContextMenu(event, col, anchorEl, {
        includeWidthActions: false,
      }),
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
    return this.viewEntries[this.currentDbIndex]?.config;
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

  /** Suppress data reload for at least `ms` milliseconds, never shortening existing suppression */
  private suppressDataReload(ms: number): void {
    this.suppressDataReloadUntil = Math.max(this.suppressDataReloadUntil, Date.now() + ms);
  }

  private handlePeerViewConfigChanged(mutation: ViewConfigMutation): void {
    if (mutation.sourceInstanceId === this.instanceId) return;
    if (!this.matchesCurrentView(mutation)) return;
    this.suppressDataReload(1000);
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
    const sourcePath = entry?.sourcePath;
    const viewId = view?.id;
    this.rebuildViewEntries();
    const nextDbIndex = this.viewEntries.findIndex((candidate) => candidate.sourcePath === sourcePath);
    if (nextDbIndex >= 0) {
      if (databaseOverride) {
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
    this.closeGroupOrderPopover();
    this.rerenderToolbar();
    this.refresh();
  }

  private cloneDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
    return JSON.parse(JSON.stringify(config)) as DatabaseConfig;
  }

  /** Check if the current dashboard page is showing a file-based database */
  isShowingFileDatabase(): boolean {
    return true;
  }

  /** Get the currently active database config (for external access) */
  getActiveDatabaseConfig(): { db: DatabaseConfig; sourcePath: string } | null {
    const entry = this.viewEntries[this.currentDbIndex];
    if (!entry) return null;
    return { db: entry.config, sourcePath: entry.sourcePath };
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

  /** Rebuild the database list from vault files */
  private rebuildViewEntries(): void {
    const entries: ViewEntry[] = [];
    const defFiles = sortDatabaseFileEntries(this.dataSource.getViewDefFiles(), this.databaseFileOrder);
    for (const df of defFiles) {
      entries.push({ config: df.config, sourcePath: df.file.path });
    }
    this.viewEntries = entries;
    if (this.currentDbIndex >= entries.length) {
      this.currentDbIndex = 0;
      this.currentViewIndex = 0;
    }
    this.captureConfigSnapshots();
  }

  private captureConfigSnapshots(): void {
    for (const entry of this.viewEntries) {
      const key = this.getConfigHistoryKey(entry);
      if (!this.configSnapshots.has(key)) {
        this.configSnapshots.set(key, this.cloneDatabaseConfig(entry.config));
      }
    }
  }

  private getConfigHistoryKey(entry: ViewEntry): string {
    return `file:${entry.sourcePath}`;
  }

  /** Update database configs from settings (called when settings change) */
  updateConfigs(
    databaseFileOrder: string[] = this.databaseFileOrder,
    statusPresets: StatusPresetDef[] = this.statusPresets,
    defaultStatusPresetId: string | undefined = this.defaultStatusPresetId
  ): void {
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
    this.cellSelection = null;
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
    this.undoActionEl = this.addAction("undo-2", t("toolbar.undo"), () => { void this.undoLastEdit(); });
    this.undoActionEl.addClass("db-view-undo-action");
    window.requestAnimationFrame(() => this.positionUndoActionNearNavigation());
    this.updateUndoAction();
    this.registerDomEvent(this.containerEl_, "scroll", () => this.markContainerScrolling());
    if (this.containerEl_.parentElement) {
      this.registerDomEvent(this.containerEl_.parentElement, "wheel", (event) => this.forwardOuterWheelScroll(event));
    }
    document.addEventListener("mousedown", this.handleOutsideClickBound, true);
    this.registerDomEvent(document, "keydown", (event) => this.handleDatabaseKeydown(event));
    this.registerDomEvent(window, "focus", () => this.refreshOnActivation());
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf === this.leaf) this.refreshOnActivation();
      else this.closeHeaderPopovers();
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
        cls: "db-empty db-error-display",
        text: `${t("errors.renderError", { message: errMsg })}\n${configInfo}\n\n${stack ? stack.substring(0, 500) : t("errors.noStack")}`,
      });
    }
  }

  async onClose(): Promise<void> {
    this.removeHeaderPopoverAutoClose?.();
    this.removeHeaderPopoverAutoClose = undefined;
    this.closeGroupOrderPopover();
    document.removeEventListener("mousedown", this.handleOutsideClickBound, true);
    if (this.scrollbarIdleTimer !== null) {
      clearTimeout(this.scrollbarIdleTimer);
      this.scrollbarIdleTimer = null;
    }
    if (this.computedSyncTimer !== null) {
      clearTimeout(this.computedSyncTimer);
      this.computedSyncTimer = null;
    }
    if (this.configSaveTimer !== null) {
      await this.saveConfigImmediately();
    }
  }

  /** Default-width dashboards hide the vertical scrollbar again shortly after scrolling. */
  private markContainerScrolling(): void {
    this.containerEl_?.addClass("is-scrolling");
    if (this.scrollbarIdleTimer !== null) clearTimeout(this.scrollbarIdleTimer);
    this.scrollbarIdleTimer = window.setTimeout(() => {
      this.containerEl_?.removeClass("is-scrolling");
      this.scrollbarIdleTimer = null;
    }, 900);
  }

  /** In default width, blank side gutters are outside the scroll container; forward wheel input there. */
  private forwardOuterWheelScroll(event: WheelEvent): void {
    if (!this.containerEl_?.isConnected) return;
    if (!this.containerEl_.hasClass("db-width-default")) return;
    const target = event.target as Node | null;
    if (target && this.containerEl_.contains(target)) return;
    if (!event.deltaY && !event.deltaX) return;
    this.containerEl_.scrollBy({ top: event.deltaY, left: event.deltaX });
    this.markContainerScrolling();
    event.preventDefault();
  }

  private handleDatabaseKeydown(event: KeyboardEvent): void {
    if (!this.containerEl_?.isConnected) return;
    const active = document.activeElement;
    const target = event.target;
    const eventTarget = target instanceof HTMLElement ? target : null;
    const isEditing = eventTarget?.closest("input, textarea, select, .db-cell-editing, .modal") != null;
    const isInsideView = active instanceof Node && this.containerEl_.contains(active);
    if (!isInsideView && !this.containerEl_.matches(":hover")) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      void this.undoLastEdit();
      return;
    }
    if (isEditing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && this.cellSelection) {
      event.preventDefault();
      void this.copySelectedCells();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && this.cellSelection) {
      event.preventDefault();
      void this.pasteCellsFromClipboard();
      return;
    }
    if (event.key === "Escape" && this.cellSelection) {
      event.preventDefault();
      this.clearCellSelection();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.cellSelection) {
      event.preventDefault();
      void this.clearSelectedCells();
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

  protected get hideDatabaseActions(): boolean { return false; }

  protected renderToolbar(): void {
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
      configureGroupOrder: () => this.showGroupOrderPopover(),
      toggleSortPanel: (anchorEl) => this.toggleHeaderPopover("sort", anchorEl),
      toggleFilterPanel: (anchorEl) => this.toggleHeaderPopover("filter", anchorEl),
      toggleColumnManager: (anchorEl) => this.toggleHeaderPopover("columns", anchorEl),
      closeToolbarPopovers: () => this.closeHeaderPopovers(),
      createEntry: (defaults) => { void this.createBlankEntry(defaults); },
      isReadOnly: needsSetup,
      showDatabaseChrome: true,
      hideDatabaseActions: this.hideDatabaseActions,
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
    this.clearCellSelection();
    if (value === "board" && !config.boardGroupField) {
      config.boardGroupField = this.getDefaultBoardField(config);
    }
    if (value === "gallery") {
      config.galleryImageField = config.galleryImageField || this.getDefaultGalleryImageField(config);
      config.galleryCardSize = config.galleryCardSize || 250;
      config.galleryImageAspectRatio = config.galleryImageAspectRatio || 0.75;
      config.galleryImageFit = config.galleryImageFit || "cover";
    }
    this.pendingUndoLabel = t("undo.viewTypeConfig");
    this.scheduleConfigSave();
    this.rerenderToolbar();
    this.refresh();
  }

  private setDisplayWidth(value: "default" | "wide"): void {
    const config = this.getConfig();
    if (!config) return;
    config.displayWidth = value;
    this.pendingUndoLabel = t("undo.displayWidthConfig");
    this.scheduleConfigSave();
    this.applyDisplayWidth();
    this.rerenderToolbar();
  }

  private applyDisplayWidth(): void {
    if (!this.containerEl_) return;
    const config = this.getConfig();
    const width = config?.displayWidth;
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
    // Update group button active state without full toolbar re-render
    const groupBtn = this.containerEl_?.querySelector(".db-group-btn");
    if (groupBtn) groupBtn.toggleClass("is-active", !!value);
    this.pendingUndoLabel = t("undo.groupConfig");
    this.viewStateStore.persist(config, this.vs());
    void this.saveCurrentViewConfig();
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
    if (shouldOpen) this.installHeaderPopoverAutoClose(kind);
    else {
      this.removeHeaderPopoverAutoClose?.();
      this.removeHeaderPopoverAutoClose = undefined;
    }
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

  private installHeaderPopoverAutoClose(kind: HeaderPopoverKind): void {
    this.removeHeaderPopoverAutoClose?.();
    this.removeHeaderPopoverAutoClose = undefined;
    const panelSelector = kind === "filter"
      ? ".db-filter-panel"
      : kind === "sort"
        ? ".db-sort-panel"
        : kind === "view"
          ? ".db-view-config-panel"
          : ".db-column-manager";
    const panel = this.containerEl_?.querySelector<HTMLElement>(panelSelector);
    if (!panel) return;
    this.removeHeaderPopoverAutoClose = installPopoverAutoClose({
      panel,
      anchorEl: this.headerPopoverAnchorEl,
      close: () => this.closeHeaderPopovers(),
    });
  }

  private handleOutsideClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (this.cellSelection && this.shouldClearCellSelectionFromPointer(target)) {
      this.clearCellSelection();
    }
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    if (this.containerEl_?.contains(target)) {
      if (target.closest(".db-filter-panel, .db-sort-panel, .db-column-manager, .db-view-config-panel, .db-toolbar, .db-header")) {
        return;
      }
    }
    this.closeHeaderPopovers();
  }

  private shouldClearCellSelectionFromPointer(target: HTMLElement): boolean {
    if (!this.containerEl_?.contains(target)) return !target.closest(".modal");
    return !target.closest(
      "td[data-note-database-row-path][data-note-database-column-key], " +
      ".db-selection-status-bar, .db-cell-editing, input, textarea, select, button, a, " +
      ".db-filter-panel, .db-sort-panel, .db-column-manager, .db-view-config-panel, .db-group-order-popover, .menu"
    );
  }

  private closeHeaderPopovers(): void {
    this.toolbarRenderer.closePopovers();
    this.closeGroupOrderPopover();
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    this.removeHeaderPopoverAutoClose?.();
    this.removeHeaderPopoverAutoClose = undefined;
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

  private closeGroupOrderPopover(): void {
    this.removeGroupOrderPopoverListener?.();
    this.removeGroupOrderPopoverListener = undefined;
    this.groupOrderPopover?.remove();
    this.groupOrderPopover = undefined;
  }

  private showGroupOrderPopover(): void {
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
    const defaultOrder = getDefaultGroupOrder(config, field);

    // 构建 order 数组
    const knownKeys = new Set([...defaultOrder, ...keys]);
    let order = mergeGroupOrder(
      currentOrder.filter((key) => knownKeys.has(key)),
      defaultOrder,
      keys
    );

    this.closeGroupOrderPopover();

    const triggerBtn = this.headerPopoverAnchorEl || this.containerEl_?.querySelector(".db-group-btn");
    const host = this.containerEl_ || document.body;
    const anchorEl = triggerBtn instanceof HTMLElement ? triggerBtn : undefined;

    const popover = host.createDiv({ cls: "db-group-order-popover" });
    this.groupOrderPopover = popover;
    popover.createEl("h3", { text: t("modal.groupOrderTitle", { field: col?.label || field }) });

    const list = popover.createDiv({ cls: "db-group-order-list" });
    let draggedIndex: number | null = null;
    let dropLine: HTMLElement | null = null;
    let outsideTimer: number | undefined;
    let removeAutoClose: (() => void) | undefined;

    // Keep the panel inside the visible database container after every list height change.
    const positionPopover = () => {
      positionToolbarPopover(popover, anchorEl, { minWidth: 260, preferredWidth: 360, maxWidth: 360 });
    };
    // Persist every order change immediately so there is no separate save step.
    const commitOrder = () => {
      config.groupOrders = { ...(config.groupOrders || {}), [field]: [...order] };
      this.pendingUndoLabel = t("undo.groupConfig");
      this.scheduleConfigSave();
      this.refresh();
      window.requestAnimationFrame(positionPopover);
    };
    const clearDropLine = () => {
      dropLine?.remove();
      dropLine = null;
    };
    const getInsertIndex = (event: DragEvent, targetIndex: number, row: HTMLElement) => {
      const rect = row.getBoundingClientRect();
      return event.clientY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
    };
    const showDropLine = (event: DragEvent, targetIndex: number, row: HTMLElement) => {
      const insertIndex = getInsertIndex(event, targetIndex, row);
      const rows = Array.from(list.querySelectorAll<HTMLElement>(".db-group-order-row"));
      if (!dropLine) dropLine = createDiv({ cls: "db-group-order-drop-line" });
      const ref = rows[insertIndex] || null;
      if (ref) list.insertBefore(dropLine, ref);
      else list.appendChild(dropLine);
    };

    const renderList = () => {
      list.empty();
      dropLine = null;
      order.forEach((key, index) => {
        const row = list.createDiv({ cls: "db-group-order-row" });
        row.draggable = true;
        row.ondragstart = (event) => {
          draggedIndex = index;
          popover.classList.add("is-dragging-order");
          row.classList.add("is-dragging");
          event.dataTransfer?.setData("text/plain", String(index));
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        };
        row.ondragover = (event) => {
          event.preventDefault();
          showDropLine(event, index, row);
        };
        row.ondrop = (event) => {
          event.preventDefault();
          const from = draggedIndex;
          if (from === null || from === index) {
            draggedIndex = null;
            clearDropLine();
            popover.classList.remove("is-dragging-order");
            return;
          }
          let insertIndex = getInsertIndex(event, index, row);
          const [item] = order.splice(from, 1);
          if (from < insertIndex) insertIndex -= 1;
          order.splice(insertIndex, 0, item);
          draggedIndex = null;
          clearDropLine();
          popover.classList.remove("is-dragging-order");
          renderList();
          commitOrder();
        };
        row.ondragend = () => {
          draggedIndex = null;
          clearDropLine();
          popover.classList.remove("is-dragging-order");
          list.querySelectorAll(".db-group-order-row").forEach((r) => r.classList.remove("is-dragging"));
        };

        row.createSpan({ cls: "db-group-order-drag", text: "⋮⋮" });
        row.createSpan({ cls: "db-group-order-name", text: key || t("common.uncategorized") });
        const moveControls = row.createSpan({ cls: "db-mobile-reorder-controls" });
        const upBtn = moveControls.createEl("button", {
          attr: { type: "button", title: t("menu.moveUp"), "aria-label": t("menu.moveUp") },
        });
        setIcon(upBtn, "arrow-up");
        upBtn.disabled = index === 0;
        upBtn.onclick = () => {
          if (index === 0) return;
          [order[index], order[index - 1]] = [order[index - 1], order[index]];
          renderList();
          commitOrder();
        };
        const downBtn = moveControls.createEl("button", {
          attr: { type: "button", title: t("menu.moveDown"), "aria-label": t("menu.moveDown") },
        });
        setIcon(downBtn, "arrow-down");
        downBtn.disabled = index >= order.length - 1;
        downBtn.onclick = () => {
          if (index >= order.length - 1) return;
          [order[index], order[index + 1]] = [order[index + 1], order[index]];
          renderList();
          commitOrder();
        };
      });
      window.requestAnimationFrame(positionPopover);
    };

    renderList();

    if (defaultOrder.length > 0) {
      const resetBtn = popover.createEl("button", {
        cls: "db-panel-button db-group-order-reset",
        text: t("modal.resetToOptionOrder"),
        attr: { type: "button" },
      });
      resetBtn.onclick = () => {
        order = mergeGroupOrder(defaultOrder, keys);
        renderList();
        commitOrder();
      };
    }

    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (popover.contains(target) || anchorEl?.contains(target))) return;
      this.closeGroupOrderPopover();
    };
    outsideTimer = window.setTimeout(() => document.addEventListener("mousedown", closeOnOutside, true), 0);
    removeAutoClose = installPopoverAutoClose({ panel: popover, anchorEl, close: () => this.closeGroupOrderPopover() });
    this.removeGroupOrderPopoverListener = () => {
      if (outsideTimer !== undefined) window.clearTimeout(outsideTimer);
      document.removeEventListener("mousedown", closeOnOutside, true);
      removeAutoClose?.();
    };
    positionPopover();
    window.requestAnimationFrame(positionPopover);
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
    this.pendingUndoLabel = t("undo.groupConfig");
    this.scheduleConfigSave();
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
    this.clearCellSelection();
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
    const currentEntry = this.getCurrentEntry();
    const currentSourcePath = currentEntry?.sourcePath;
    const currentViewId = this.getConfig()?.id;

    const currentFilePaths = this.viewEntries.map((entry) => entry.sourcePath);
    const nextOrder = moveDatabaseFilePath(currentFilePaths, fromEntry.sourcePath, toEntry.sourcePath);
    this.databaseFileOrder.splice(0, this.databaseFileOrder.length, ...nextOrder);

    this.suppressNextSettingsUpdate = true;
    void this.onConfigChanged?.();
    this.rebuildViewEntries();
    const nextIndex = this.viewEntries.findIndex((entry) => entry.sourcePath === currentSourcePath);
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
    const sourceFolder = result.sourceFolder || "";
    const scanRules = result.typeFilter
      ? [{ field: "type" as const, op: "eq" as const, value: result.typeFilter }]
      : undefined;

    // Scan frontmatter from source folder
    const allKeys = new Map<string, string>();
    allKeys.set("file.name", t("defaults.nameColumn"));
    const sampleValues = new Map<string, unknown[]>();
    const fileCounts = new Map<string, number>();
    collectFileFrontmatterKeys(this.app, sourceFolder, scanRules, allKeys, sampleValues, fileCounts);

    // Build column list: always start with file.name
    const columns: ColumnDef[] = [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" }];

    if (allKeys.size > 1) {
      // Found frontmatter keys — show confirmation modal
      const STATUS_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink"] as const;
      const inferredColumns: BaseImportColumn[] = [];

      for (const [key, label] of allKeys) {
        if (key === "file.name") continue;
        const type = inferColumnType(key, sampleValues.get(key) || []);
        const col: any = { key, label, type };

        // Pre-populate options for option-based types
        if (type === "multi-select" && (key === "tags" || key === "tag")) {
          const vaultTags = getVaultTags(this.app, sourceFolder, scanRules);
          if (vaultTags.length > 0) {
            col.statusOptions = vaultTags.map((tag: string, i: number) => ({
              value: tag,
              color: STATUS_COLORS[i % STATUS_COLORS.length],
            }));
          }
        } else if (type === "multi-select") {
          const uniqueValues = collectUniqueListValues(this.app, key, sourceFolder, scanRules);
          if (uniqueValues.length > 0) {
            col.statusOptions = uniqueValues.map((val: string, i: number) => ({
              value: val,
              color: STATUS_COLORS[i % STATUS_COLORS.length],
            }));
          }
        } else if (type === "select" || type === "status") {
          const uniqueValues = collectUniqueStringValues(this.app, key, sourceFolder, scanRules);
          if (uniqueValues.length > 0) {
            col.statusOptions = uniqueValues.map((val: string, i: number) => ({
              value: val,
              color: STATUS_COLORS[i % STATUS_COLORS.length],
            }));
          }
        }

        inferredColumns.push({ ...col, fileCount: fileCounts.get(key) || 0 });
      }

      const confirmed = await new BaseImportConfirmModal(
        this.app,
        inferredColumns,
        {
          titleText: t("addDatabase.scanTitle"),
          descText: t("addDatabase.scanDesc"),
          defaultUnchecked: true,
        }
      ).open();
      if (!confirmed) return;

      // Collect statusOptions for columns where user changed to option types
      for (const col of confirmed) {
        if ((col.type === "status" || col.type === "select" || col.type === "multi-select") && !col.statusOptions) {
          const uniqueValues = collectUniqueStringValues(this.app, col.key, sourceFolder, scanRules);
          if (uniqueValues.length > 0) {
            col.statusOptions = uniqueValues.map((val: string, i: number) => ({
              value: val,
              color: STATUS_COLORS[i % STATUS_COLORS.length],
            }));
          }
        }
        columns.push({ key: col.key, label: col.label || col.key, type: col.type, statusOptions: (col as any).statusOptions });
      }
    } else {
      // No frontmatter found
      new Notice(t("notice.noImportableProperties"));
    }

    const view: ViewConfig = {
      id: generateId(),
      name: t("common.tableView"),
      viewType: "table",
      sourceFolder,
      schema: { columns, computedFields: [] },
    };
    if (result.typeFilter) {
      view.typeFilter = result.typeFilter;
    }
    const newDb: DatabaseConfig = {
      id: generateId(),
      name: dbName,
      sourceFolder,
      typeFilter: result.typeFilter || undefined,
      schema: view.schema,
      views: [view],
    };

    const file = await this.dataSource.createViewDefFile(
      this.databaseFolder,
      dbName,
      newDb
    );
    new Notice(t("notice.createdDbFile", { path: file.path }));
    void this.onConfigChanged?.();
    this.rebuildViewEntries();
    const idx = this.viewEntries.findIndex(e => e.config.name === dbName);
    this.currentDbIndex = idx >= 0 ? idx : 0;
    this.currentViewIndex = 0;
    this.rerenderToolbar();
    this.refresh();

    // Open the new database file in its own tab
    const newLeaf = this.app.workspace.getLeaf("tab");
    if (newLeaf) {
      await newLeaf.openFile(file);
    }
  }

  private async duplicateCurrentDatabase(): Promise<void> {
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const duplicate = this.createDuplicatedDatabaseConfig(entry.config);

    const folder = this.getParentPath(entry.sourcePath) || this.databaseFolder;
    const file = await this.dataSource.createViewDefFile(folder, duplicate.name, duplicate);
    this.viewEntries.push({ config: duplicate, sourcePath: file.path });
    this.currentDbIndex = this.viewEntries.length - 1;
    new Notice(t("notice.copiedDbFile", { path: file.path }));
    void this.onConfigChanged?.();

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

    // Move to plugin trash or system trash
    if (result.action === "plugin-trash") {
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

    // Remove the database file
    const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    if (file) await this.dataSource.trashNote(file as any);

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
    const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf("tab").openFile(file);
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
    const locator = `dbPath: ${entry.sourcePath}`;
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

  openViewReference(sourcePath: string, viewId?: string): void {
    this.rebuildViewEntries();
    const index = this.viewEntries.findIndex((entry) => entry.sourcePath === sourcePath);
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
      this.suppressDataReload(1200);
      this.pendingNewRecord = {
        file,
        frontmatter: { ...frontmatter },
        expiresAt: Date.now() + 8000,
      };
      if (config.schema.computedFields.length > 0) {
        void this.syncComputedForFile(file, frontmatter);
      }
      // Assign manual rank for the new entry (appends to end)
      if (config.manualOrder?.ranks && Object.keys(config.manualOrder.ranks).length > 0) {
        const paths = this.rows.map((r) => r.file.path);
        const lastPath = paths.length > 0 ? paths[paths.length - 1] : undefined;
        const lastRank = lastPath ? config.manualOrder.ranks[lastPath] : undefined;
        const newRank = rankBetween(lastRank, undefined);
        if (newRank) {
          config.manualOrder.ranks[file.path] = newRank;
          this.scheduleConfigSave();
        }
      }
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
      newRecordFolder: config.newRecordFolder || db.newRecordFolder,
      typeFilter: config.typeFilter || db.typeFilter,
      schema: config.schema || db.schema,
    };
  }

  private getCreateFolder(config: ViewConfig): string {
    const folderRule = config.sourceRules?.find((rule) => rule.op === "inFolder" && rule.value);
    return normalizePath(config.newRecordFolder || config.sourceFolder || folderRule?.value || this.databaseFolder || "");
  }

  /** Empty sourceFolder means vault root for querying; newRecordFolder controls only where new notes are created. */
  private getEffectiveConfig(dbConfig: DatabaseConfig): DatabaseConfig {
    return { ...dbConfig, sourceFolder: this.normalizeVaultFolder(dbConfig.sourceFolder || "") };
  }

  /** Show relative paths only when duplicate filenames would otherwise be ambiguous. */
  private getFileDisplayName(row: RowData): string {
    const info = this.getFileTitleInfo(row);
    return info.hasDuplicateName ? info.displayPath : info.name;
  }

  /** Build structured file title pieces for table/card/list renderers. */
  private getFileTitleInfo(row: RowData): FileTitleDisplay {
    return getFileTitleDisplay(row, this.rows);
  }

  private toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void {
    const path = row.file.path;
    const rangeAnchor = this.lastSelectedRowPath;
    const useRangeSelection = Boolean((event?.shiftKey || this.isPhoneLayout()) && rangeAnchor && rangeAnchor !== path);
    if (useRangeSelection && rangeAnchor) {
      const range = this.getSelectionRangeRows(rangeAnchor, path);
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

  private clearCellSelection(): void {
    if (!this.cellSelection) return;
    this.cellSelection = null;
    this.isSelectingCells = false;
    this.showCellFillInput = false;
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
  }

  private setupTableCellSelection(td: HTMLElement, row: RowData, col: ColumnDef): void {
    td.toggleClass("db-cell-range-selected", this.isCellSelected(row.file.path, col.key));
    td.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (this.isInteractiveCellTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      const address = { rowPath: row.file.path, colKey: col.key };
      if (this.isPhoneLayout()) {
        if (this.cellSelection) {
          this.cellSelection = { anchor: this.cellSelection.anchor, focus: address };
        } else {
          this.cellSelection = { anchor: address, focus: address };
        }
        this.isSelectingCells = false;
        this.renderCellSelectionClasses();
        this.renderSelectionStatusBar();
        return;
      }
      if (event.shiftKey && this.cellSelection) {
        this.cellSelection = { anchor: this.cellSelection.anchor, focus: address };
      } else {
        this.cellSelection = { anchor: address, focus: address };
      }
      this.isSelectingCells = true;
      this.renderCellSelectionClasses();
      this.renderSelectionStatusBar();
      const onMouseUp = () => {
        this.isSelectingCells = false;
        document.removeEventListener("mouseup", onMouseUp, true);
      };
      document.addEventListener("mouseup", onMouseUp, true);
    });
    td.addEventListener("mouseenter", () => {
      if (!this.isSelectingCells || !this.cellSelection) return;
      this.cellSelection = {
        anchor: this.cellSelection.anchor,
        focus: { rowPath: row.file.path, colKey: col.key },
      };
      this.renderCellSelectionClasses();
      this.renderSelectionStatusBar();
    });
  }

  private isPhoneLayout(): boolean {
    return document.body.classList.contains("is-phone");
  }

  private isInteractiveCellTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement &&
      Boolean(target.closest("input, textarea, select, button, a, .db-cell-fill-handle, .db-cell-editing"));
  }

  private isCellSelected(rowPath: string, colKey: string): boolean {
    return this.getSelectedCellAddressSet().has(`${rowPath}\u0000${colKey}`);
  }

  private getSelectedCellAddressSet(): Set<string> {
    return new Set(this.getSelectedCellAddresses().map((cell) => `${cell.rowPath}\u0000${cell.colKey}`));
  }

  private getSelectedCellAddresses(): CellAddress[] {
    if (!this.containerEl_ || !this.cellSelection) return [];
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const rowA = rowPaths.indexOf(this.cellSelection.anchor.rowPath);
    const rowB = rowPaths.indexOf(this.cellSelection.focus.rowPath);
    const colA = colKeys.indexOf(this.cellSelection.anchor.colKey);
    const colB = colKeys.indexOf(this.cellSelection.focus.colKey);
    if (rowA < 0 || rowB < 0 || colA < 0 || colB < 0) return [];
    const rowStart = Math.min(rowA, rowB);
    const rowEnd = Math.max(rowA, rowB);
    const colStart = Math.min(colA, colB);
    const colEnd = Math.max(colA, colB);
    const cells: CellAddress[] = [];
    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex++) {
      for (let colIndex = colStart; colIndex <= colEnd; colIndex++) {
        cells.push({ rowPath: rowPaths[rowIndex], colKey: colKeys[colIndex] });
      }
    }
    return cells;
  }

  private getRenderedTableRowPaths(): string[] {
    if (!this.containerEl_) return [];
    const paths: string[] = [];
    const seen = new Set<string>();
    this.containerEl_.querySelectorAll<HTMLElement>(".db-table tbody tr[data-note-database-row-path]").forEach((rowEl) => {
      const path = rowEl.dataset.noteDatabaseRowPath;
      if (!path || seen.has(path)) return;
      seen.add(path);
      paths.push(path);
    });
    return paths;
  }

  private getRenderedTableColumnKeys(): string[] {
    if (!this.containerEl_) return [];
    const firstRow = this.containerEl_.querySelector<HTMLElement>(".db-table tbody tr[data-note-database-row-path]");
    if (!firstRow) return [];
    return Array.from(firstRow.querySelectorAll<HTMLElement>("td[data-note-database-column-key]"))
      .map((cell) => cell.dataset.noteDatabaseColumnKey)
      .filter((key): key is string => Boolean(key));
  }

  private renderCellSelectionClasses(): void {
    if (!this.containerEl_) return;
    const selected = this.getSelectedCellAddressSet();
    this.containerEl_.querySelectorAll<HTMLElement>("td[data-note-database-row-path][data-note-database-column-key]").forEach((cell) => {
      const rowPath = cell.dataset.noteDatabaseRowPath;
      const colKey = cell.dataset.noteDatabaseColumnKey;
      cell.toggleClass("db-cell-range-selected", Boolean(rowPath && colKey && selected.has(`${rowPath}\u0000${colKey}`)));
    });
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
        this.pendingUndoLabel = t("undo.filterConfig");
        this.scheduleViewStateSave();
        this.updateToolbarIndicators();
      },
      refresh: () => {
        this.updateToolbarIndicators();
        this.refresh();
      },
      close: () => {
        this.pendingUndoLabel = t("undo.filterConfig");
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
        this.pendingUndoLabel = t("undo.sortConfig");
        this.scheduleViewStateSave();
        this.updateToolbarIndicators();
      },
      refresh: () => {
        this.updateToolbarIndicators();
        this.refresh();
      },
      close: () => {
        this.pendingUndoLabel = t("undo.sortConfig");
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
        deleteColumn: (col) => { void this.columnOperations.deleteColumn(col); },
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
        this.pendingUndoLabel = t("undo.statusPresetConfig");
        this.scheduleConfigSave();
      },
      onManageStatusPresets: () => this.showDatabaseStatusPresetManager(),
      viewStatusPresets: this.getAvailableStatusPresets(db, config),
      defaultViewStatusPresetId: this.getDefaultStatusPresetId(db, config),
      onDefaultViewStatusPresetChange: (value) => {
        config.defaultStatusPresetId = value || undefined;
        this.pendingUndoLabel = t("undo.statusPresetConfig");
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
    this.pendingUndoLabel = t("undo.hideColumnsConfig");
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
    this.pendingUndoLabel = t("undo.columnWrapConfig");
    this.scheduleConfigSave();
    this.renderColumnManager();
    this.refresh();
  }

  private showStatusOptionsModal(col: ColumnDef): void {
    this.pendingUndoLabel = t("undo.fieldOptionsConfig");
    new StatusOptionsModal(this.app, col, async (options) => {
      const previousOptions = col.statusOptions?.map((option) => ({ ...option })) || [];
      await this.commitColumnOptionsTransaction(col, previousOptions, options);
      this.refresh();
    }, this.getAvailableStatusPresets(this.getActiveDb(), this.getConfig()), true, this.getDefaultStatusOptions()).open();
  }

  private async commitCellOptionTransaction(
    row: RowData,
    col: ColumnDef,
    transaction: CellOptionTransaction
  ): Promise<void> {
    this.optionTransactionQueue = this.optionTransactionQueue
      .then(() => this.runCellOptionTransaction(row, col, transaction))
      .catch((err) => {
        console.error("Note Database: failed to commit option transaction", err);
        new Notice(t("errors.updateFailed", { error: String(err) }));
      });
    return this.optionTransactionQueue;
  }

  private async runCellOptionTransaction(
    row: RowData,
    col: ColumnDef,
    transaction: CellOptionTransaction
  ): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    const target = config.schema.columns.find((candidate) => candidate.key === col.key);
    if (!target) return;

    if (!transaction.nextOptions) {
      if (!transaction.setValue) return;
      const change = this.createCurrentCellChange(row, target, transaction.value);
      if (this.areCellValuesEqual(change.oldValue, change.newValue)) return;
      await this.applyCellChanges([change], t("undo.editCell"));
      return;
    }

    await this.commitColumnOptionsTransaction(
      target,
      transaction.previousOptions || target.statusOptions || [],
      transaction.nextOptions,
      {
        cleanupRemovedValues: transaction.cleanupRemovedValues,
        renameValues: transaction.renameValues,
        currentRow: row,
        setValue: transaction.setValue,
        value: transaction.value,
      }
    );
  }

  private async commitColumnOptionsTransaction(
    col: ColumnDef,
    previousOptions: StatusOptionDef[] = [],
    nextOptions: StatusOptionDef[] = [],
    options: {
      cleanupRemovedValues?: string[];
      renameValues?: Array<{ from: string; to: string }>;
      currentRow?: RowData;
      setValue?: boolean;
      value?: unknown;
    } = {}
  ): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    const target = config.schema.columns.find((candidate) => candidate.key === col.key);
    if (!target) return;
    const normalizedPrevious = previousOptions.map((option) => ({ ...option }));
    const normalizedNext = nextOptions.map((option) => ({ ...option }));
    const previousValues = new Set(normalizedPrevious.map((option) => option.value));
    const nextValues = new Set(normalizedNext.map((option) => option.value));
    const renameValues = (options.renameValues || this.inferOptionRenames(normalizedPrevious, normalizedNext))
      .filter((rename) => rename.from && rename.to && rename.from !== rename.to);
    const renamedValues = new Set(renameValues.map((rename) => rename.from));
    const inferredRemoved = Array.from(previousValues)
      .filter((value) => !nextValues.has(value) && !renamedValues.has(value));
    const removedValues = new Set(options.cleanupRemovedValues ?? inferredRemoved);
    const changes = this.mergeCellChanges([
      ...this.getOptionValueCellChanges(target, removedValues, renameValues),
      ...(
        options.setValue && options.currentRow
          ? [this.createCurrentCellChange(options.currentRow, target, options.value)]
          : []
      ),
    ]);
    target.statusOptions = normalizedNext;
    this.pendingUndoLabel = t("undo.fieldOptionsConfig");
    this.pendingConfigCellChanges = changes;
    await this.saveCurrentViewConfig();
    if (changes.length > 0) {
      await this.applyFrontmatterChanges(changes, "new");
      await this.refreshAfterSave();
    } else {
      this.refresh();
    }
    if (this.showColumnManager) this.renderColumnManager();
  }

  private inferOptionRenames(previousOptions: StatusOptionDef[], nextOptions: StatusOptionDef[]): Array<{ from: string; to: string }> {
    const previousValues = new Set(previousOptions.map((option) => option.value));
    const nextValues = new Set(nextOptions.map((option) => option.value));
    const renames: Array<{ from: string; to: string }> = [];
    const max = Math.min(previousOptions.length, nextOptions.length);
    for (let index = 0; index < max; index += 1) {
      const from = previousOptions[index]?.value;
      const to = nextOptions[index]?.value;
      if (!from || !to || from === to) continue;
      if (nextValues.has(from) || previousValues.has(to)) continue;
      renames.push({ from, to });
    }
    return renames;
  }

  private getOptionValueCellChanges(
    col: ColumnDef,
    removedValues: Set<string>,
    renameValues: Array<{ from: string; to: string }>
  ): CellEditChange[] {
    if (!isOptionColumnType(col.type)) return [];
    const changes: CellEditChange[] = [];
    if (removedValues.size === 0 && renameValues.length === 0) return changes;
    const renameMap = new Map(renameValues.map((rename) => [rename.from, rename.to]));
    for (const record of this.getRecordsForActiveDatabase()) {
      if (!Object.prototype.hasOwnProperty.call(record.frontmatter, col.key)) continue;
      const oldValue = record.frontmatter[col.key];
      let newValue: unknown = oldValue;
      if (col.type === "multi-select") {
        const values = Array.isArray(oldValue)
          ? oldValue.map((value) => String(value))
          : String(oldValue ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        const normalized: string[] = [];
        for (const value of values) {
          const nextValue = renameMap.get(value) || value;
          if (removedValues.has(nextValue) || normalized.includes(nextValue)) continue;
          normalized.push(nextValue);
        }
        if (this.areCellValuesEqual(values, normalized)) continue;
        newValue = normalized;
      } else {
        const current = String(oldValue ?? "");
        if (renameMap.has(current)) {
          newValue = renameMap.get(current) || current;
        } else if (removedValues.has(current)) {
          newValue = null;
        } else {
          continue;
        }
        if (this.areCellValuesEqual(oldValue, newValue)) continue;
      }
      changes.push({
        file: record.file,
        path: record.file.path,
        key: col.key,
        oldValue: this.cloneFillValue(oldValue),
        oldExists: true,
        newValue: this.cloneFillValue(newValue),
      });
    }
    return changes;
  }

  private mergeCellChanges(changes: CellEditChange[]): CellEditChange[] {
    const merged = new Map<string, CellEditChange>();
    for (const change of changes) {
      const key = `${change.path}\u0000${change.key}`;
      const existing = merged.get(key);
      if (existing) {
        existing.newValue = this.cloneFillValue(change.newValue);
      } else {
        merged.set(key, this.cloneCellChange(change));
      }
    }
    return Array.from(merged.values())
      .filter((change) => change.oldExists || change.newValue != null)
      .filter((change) => !this.areCellValuesEqual(change.oldValue, change.newValue));
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
        this.pendingUndoLabel = t("undo.statusPresetConfig");
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
        this.pendingUndoLabel = t("undo.statusPresetConfig");
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
    this.pendingUndoLabel = t("undo.formulaConfig");
    await this.saveCurrentViewConfig();
    await this.syncComputedFieldsNow(false);
    this.refresh();
  }

  private async changeColumnType(col: ColumnDef, type: ColumnDef["type"]): Promise<void> {
    await this.columnOperations.changeColumnType(col, type);
    if (type === "computed") this.showFormulaModal(col);
  }

  private getFilesForConfig(config: ViewConfig): TFile[] {
    return this.dataSource
      .getRecordsForConfig(this.getEffectiveConfig(this.getActiveDb()))
      .map((record) => record.file);
  }

  private getRecordsForActiveDatabase(): NoteRecord[] {
    // Use the same fallback source folder as rendering so bulk mutations target the visible database scope.
    return this.dataSource.getRecordsForConfig(this.getEffectiveConfig(this.getActiveDb()));
  }

  private async saveConfigImmediately(): Promise<void> {
    if (this.configSaveTimer !== null) {
      clearTimeout(this.configSaveTimer);
      this.configSaveTimer = null;
    }
    await this.saveCurrentViewConfig();
  }

  /** Show a floating context menu on column header right-click */
  private showContextMenu(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement, options?: ColumnMenuOptions): void {
    this.columnMenu.show(event, col, anchorEl, options);
  }

  /** Save the current view config back to its source (settings or file) */
  private async saveCurrentViewConfig(mutationOverride?: ViewConfigMutation): Promise<void> {
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const mutation = mutationOverride || this.getCurrentMutationTarget();
    this.recordConfigHistory(entry, mutation?.viewId);
    const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    if (file instanceof TFile) {
      this.suppressDataReload(2500);
      await this.dataSource.updateViewDefFile(file, entry.config, mutation);
    }
    this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
    this.updateUndoAction();
  }

  private recordConfigHistory(entry: ViewEntry, viewId?: string): void {
    if (this.applyingHistory) return;
    const key = this.getConfigHistoryKey(entry);
    const before = this.configSnapshots.get(key);
    if (!before) {
      this.configSnapshots.set(key, this.cloneDatabaseConfig(entry.config));
      this.pendingConfigCellChanges = null;
      return;
    }
    const after = this.cloneDatabaseConfig(entry.config);
    const cellChanges = this.pendingConfigCellChanges?.map((change) => this.cloneCellChange(change)) || [];
    this.pendingConfigCellChanges = null;
    if (JSON.stringify(before) === JSON.stringify(after) && cellChanges.length === 0) return;
    const label = this.pendingUndoLabel || t("undo.viewConfig");
    this.pendingUndoLabel = null;
    this.pushHistory({
      type: "config",
      label,
      dbId: entry.config.id,
      dbPath: entry.sourcePath,
      viewId: viewId || this.getConfig()?.id,
      before,
      after,
      cellChanges: cellChanges.length > 0 ? cellChanges : undefined,
    });
  }

  private scheduleViewStateSave(): void {
    const config = this.getConfig();
    if (!config) return;
    this.viewStateStore.persist(config, this.vs());
    this.scheduleConfigSave();
  }

  /** Debounced config save: batch rapid changes (drag, resize) into one write */
  private scheduleConfigSave(): void {
    // Protect in-memory config mutations immediately. Frontmatter writes can emit
    // metadata events before the debounced view-definition write reaches disk.
    this.suppressDataReload(2500);
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

    if (this.initializeManualRanksForRecords(config, records)) {
      this.pendingUndoLabel = t("undo.cardOrderConfig");
      this.scheduleConfigSave();
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
    const rowCount = this.selectedRows.size;
    const cellCount = this.getSelectedCellAddresses().length;
    const hasSelection = rowCount > 0 || cellCount > 0;
    this.containerEl_.toggleClass("has-selection-status", hasSelection);
    if (!hasSelection) return;
    const bar = this.containerEl_.createDiv({ cls: "db-selection-status-bar" });
    const checkbox = bar.createEl("input", {
      cls: "db-selection-clear-checkbox",
      attr: { type: "checkbox", title: rowCount > 0 ? t("toolbar.selectedCount", { count: rowCount }) : t("toolbar.selectedCells", { count: cellCount }) },
    });
    checkbox.checked = true;
    checkbox.onchange = () => {
      if (!checkbox.checked) {
        this.clearSelection();
        this.clearCellSelection();
      }
    };
    if (cellCount > 0) {
      bar.createSpan({ cls: "db-selection-count", text: t("toolbar.selectedCells", { count: cellCount }) });
      const copyTsvBtn = bar.createEl("button", {
        cls: "db-selection-action",
        text: t("selection.copyTsv"),
        attr: { type: "button" },
      });
      copyTsvBtn.onclick = () => { void this.copySelectedCells("tsv"); };
      const copyMarkdownBtn = bar.createEl("button", {
        cls: "db-selection-action",
        text: t("selection.copyMarkdown"),
        attr: { type: "button" },
      });
      copyMarkdownBtn.onclick = () => { void this.copySelectedCells("markdown"); };
      const copyCsvBtn = bar.createEl("button", {
        cls: "db-selection-action",
        text: t("selection.copyCsv"),
        attr: { type: "button" },
      });
      copyCsvBtn.onclick = () => { void this.copySelectedCells("csv"); };
      const pasteBtn = bar.createEl("button", {
        cls: "db-selection-action",
        text: t("selection.pasteCells"),
        attr: { type: "button" },
      });
      pasteBtn.onclick = () => { void this.pasteCellsFromClipboard(); };
      const fillBtn = bar.createEl("button", {
        cls: "db-selection-action",
        text: t("selection.fillValue"),
        attr: { type: "button" },
      });
      fillBtn.onclick = () => {
        this.showCellFillInput = !this.showCellFillInput;
        this.renderSelectionStatusBar();
      };
      if (this.showCellFillInput) this.renderCellFillInput(bar);
      const clearBtn = bar.createEl("button", {
        cls: "db-selection-delete",
        text: t("selection.clearCells"),
        attr: { type: "button" },
      });
      clearBtn.onclick = () => { void this.clearSelectedCells(); };
    } else {
      bar.createSpan({ cls: "db-selection-count", text: t("toolbar.selectedCount", { count: rowCount }) });
      const deleteBtn = bar.createEl("button", {
        cls: "db-selection-delete",
        text: t("common.delete"),
        attr: { type: "button" },
      });
      deleteBtn.onclick = () => { void this.deleteSelectedRows(); };
    }
    if (this.historyStack.length > 0) {
      const undoBtn = bar.createEl("button", {
        cls: "db-selection-action db-selection-undo",
        text: t("toolbar.undo"),
        attr: { type: "button" },
      });
      undoBtn.onclick = () => { void this.undoLastEdit(); };
    }
    const summary = this.containerEl_.querySelector(":scope > .db-summary");
    if (summary?.parentElement) summary.parentElement.insertBefore(bar, summary.nextSibling);
  }

  private renderCellFillInput(bar: HTMLElement): void {
    const form = bar.createEl("form", { cls: "db-selection-fill-form" });
    const input = form.createEl("input", {
      cls: "db-selection-fill-input",
      attr: {
        type: "text",
        placeholder: t("selection.fillPlaceholder"),
        "aria-label": t("selection.fillPlaceholder"),
      },
    });
    const apply = form.createEl("button", {
      cls: "db-selection-action",
      text: t("common.save"),
      attr: { type: "submit" },
    });
    form.onsubmit = (event) => {
      event.preventDefault();
      void this.fillSelectedCells(input.value);
    };
    input.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.showCellFillInput = false;
        this.renderSelectionStatusBar();
      }
    };
    apply.onclick = (event) => event.stopPropagation();
    requestAnimationFrame(() => input.focus());
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

    if (!found && this.pendingRecordMatchesActiveSource(pending)) {
      merged.push({
        file: pending.file,
        frontmatter: pending.frontmatter,
      });
    }
    return merged;
  }

  /** Avoid showing an optimistic new row when its create folder is outside the current source. */
  private pendingRecordMatchesActiveSource(record: NoteRecord): boolean {
    const config = this.getEffectiveConfig(this.getActiveDb());
    const sourceFolder = this.normalizeVaultFolder(config.sourceFolder || "");
    if (sourceFolder && !record.file.path.startsWith(sourceFolder.endsWith("/") ? sourceFolder : `${sourceFolder}/`)) {
      return false;
    }
    if (config.typeFilter && record.frontmatter["type"] !== config.typeFilter) return false;
    const rules = (config.sourceRules || []).filter((rule) => !sourceFolder || rule.op !== "inFolder");
    if (rules.length === 0) return true;
    const results = rules.map((rule) => this.pendingRecordMatchesRule(record, rule));
    return (config.sourceLogic || "and") === "or" ? results.some(Boolean) : results.every(Boolean);
  }

  /** Mirrors DataSource source-rule checks for pending records before metadata cache catches up. */
  private pendingRecordMatchesRule(record: NoteRecord, rule: NonNullable<DatabaseConfig["sourceRules"]>[number]): boolean {
    const expected = String(rule.value ?? "");
    const value = rule.field.startsWith("file.")
      ? this.getPendingFileField(record, rule.field)
      : record.frontmatter[rule.field];
    if (rule.op === "inFolder") {
      const folder = this.normalizeVaultFolder(expected);
      return !folder || folder === "/" || record.file.path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
    }
    if (rule.op === "hasTag") {
      const tags = record.frontmatter["tags"] ?? record.frontmatter["tag"];
      const list = Array.isArray(tags) ? tags : String(tags ?? "").split(/[,\s]+/);
      return list.map((tag) => String(tag).replace(/^#/, "")).includes(expected.replace(/^#/, ""));
    }
    if (rule.op === "eq") return String(value ?? "") === expected;
    if (rule.op === "neq") return String(value ?? "") !== expected;
    if (rule.op === "contains") return String(value ?? "").toLowerCase().includes(expected.toLowerCase());
    if (rule.op === "empty") return value == null || value === "";
    if (rule.op === "notempty") return value != null && value !== "";
    return true;
  }

  /** Read file.* values used by source rules for an optimistic pending row. */
  private getPendingFileField(record: NoteRecord, field: string): unknown {
    if (field === "file.name") return record.file.basename;
    if (field === "file.path") return record.file.path;
    if (field === "file.ext" || field === "file.extension") return record.file.extension;
    if (field === "file.folder") return record.file.parent?.path || "";
    return undefined;
  }

  /** Treat empty or "/" as the vault root and keep stored paths vault-relative. */
  private normalizeVaultFolder(folderPath: string): string {
    const normalized = normalizePath(folderPath || "");
    return normalized === "/" ? "" : normalized.replace(/^\/+/, "");
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
      if (this.getConfig()?.viewType === "list") {
        this.revealListRowLeadingEdge(target);
      } else {
        scrollTarget.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      }
      target.addClass("is-new-record-highlight");
      this.clearPendingNewRow();
      window.setTimeout(() => {
        if (target.isConnected) target.removeClass("is-new-record-highlight");
      }, 2200);
    });
  }

  /** Reveal a wide list row without asking the browser to scroll outer Obsidian containers. */
  private revealListRowLeadingEdge(target: HTMLElement): void {
    if (!this.containerEl_) return;
    const containerRect = this.containerEl_.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const centeredTop = this.containerEl_.scrollTop
      + targetRect.top
      - containerRect.top
      - Math.max(0, (this.containerEl_.clientHeight - targetRect.height) / 2);
    this.containerEl_.scrollTo({ top: Math.max(0, centeredTop), left: 0, behavior: "smooth" });
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
    this.setupTableCellSelection(td, row, col);
  }

  private setupTableFillHandle(td: HTMLElement, row: RowData, col: ColumnDef): void {
    if (this.isPhoneLayout()) return;
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

  private async saveCellValueWithHistory(row: RowData, col: ColumnDef, value: unknown): Promise<void> {
    if (!this.canFillColumn(col)) return;
    const change = this.createCellChange(row, col, value);
    if (this.areCellValuesEqual(change.oldValue, change.newValue)) return;
    if (this.canApplyCellChangeOptimistically(col)) {
      await this.applyCellChangeOptimistically(change, t("undo.editCell"));
      return;
    }
    await this.applyCellChanges([change], t("undo.editCell"));
  }

  private canApplyCellChangeOptimistically(col: ColumnDef): boolean {
    if (col.type === "computed" || col.key === "file.name") return false;
    const config = this.getConfig();
    if (!config) return false;
    const state = this.vs();
    const groupField = config.viewType === "board"
      ? config.boardGroupField || state.groupByField || this.getDefaultBoardField(config)
      : state.groupByField;
    if (groupField === col.key) return false;
    if (config.boardSubgroupField === col.key) return false;
    if (config.titleField === col.key) return false;
    if (config.galleryImageField === col.key) return false;
    if (state.searchText.trim()) return false;
    if (state.sortColumn === col.key || state.sortRules.some((rule) => rule.field === col.key)) return false;
    if (getEffectiveFilterRules(state.filters).some((rule) => rule.field === col.key)) return false;
    if (this.isColumnReferencedByComputedFields(col.key)) return false;
    return true;
  }

  private async applyCellChangeOptimistically(change: CellEditChange, label: string): Promise<void> {
    this.suppressDataReload(1200);
    const oldValue = change.oldValue;
    try {
      await this.dataSource.updateFrontmatter(change.file, { [change.key]: change.newValue });
    } catch (err) {
      this.applyFrontmatterChangeToRenderedRows({ ...change, newValue: oldValue });
      this.refresh();
      new Notice(t("errors.updateFailed", { error: String(err) }));
      return;
    }
    this.applyFrontmatterChangeToRenderedRows(change);
    this.pushHistory({ type: "cells", label, changes: [change] });

    const row = this.rows.find(r => r.file.path === change.path);
    if (row) {
      const col = this.getConfig()?.schema.columns.find(c => c.key === change.key);
      if (col) this.updateCellDOM(row, col);
    }
  }

  private applyFrontmatterChangeToRenderedRows(change: CellEditChange): void {
    for (const row of this.rows) {
      if (row.file.path !== change.path) continue;
      if (change.newValue === null) delete row.frontmatter[change.key];
      else row.frontmatter[change.key] = this.cloneFillValue(change.newValue);
    }
  }

  private isColumnReferencedByComputedFields(colKey: string): boolean {
    const config = this.getConfig();
    if (!config?.schema.computedFields.length) return false;
    for (const cf of config.schema.computedFields) {
      const expr = cf.expression;
      if (expr.includes(`[${colKey}]`) ||
          expr.includes(`field("${colKey}")`) ||
          expr.includes(`field('${colKey}')`)) {
        return true;
      }
    }
    return false;
  }

  private updateCellDOM(row: RowData, col: ColumnDef): void {
    if (!this.containerEl_) return;
    const config = this.getConfig();
    if (!config) return;

    switch (config.viewType) {
      case "table":
        this.updateTableCellDOM(row, col);
        break;
      case "board":
        this.updateCardFieldDOM(row, col, config, this.boardRenderer.renderCardFieldContent(row, col, config));
        break;
      case "gallery":
        this.updateCardFieldDOM(row, col, config, this.galleryRenderer.renderCardFieldContent(row, col, config));
        break;
      case "list":
        this.updateCardFieldDOM(row, col, config, this.listRenderer.renderRowFieldContent(row, col, config));
        break;
      default:
        this.refresh();
        break;
    }
  }

  private updateCardFieldDOM(row: RowData, col: ColumnDef, config: ViewConfig, newField: HTMLElement): void {
    if (!this.containerEl_) return;
    const cardSelector = `[data-note-database-row-path="${CSS.escape(row.file.path)}"]`;
    const fieldSelector = `[data-note-database-column-key="${CSS.escape(col.key)}"]`;
    const card = this.containerEl_.querySelector<HTMLElement>(cardSelector);
    if (!card) { this.refresh(); return; }
    const oldField = card.querySelector<HTMLElement>(fieldSelector);
    if (!oldField) { this.refresh(); return; }
    oldField.replaceWith(newField);
  }

  private updateTableCellDOM(row: RowData, col: ColumnDef): void {
    if (!this.containerEl_) return;
    const selector = `td[data-note-database-row-path="${CSS.escape(row.file.path)}"][data-note-database-column-key="${CSS.escape(col.key)}"]`;
    const oldTd = this.containerEl_.querySelector<HTMLElement>(selector);
    if (!oldTd) {
      this.refresh();
      return;
    }

    const newTd = document.createElement("td");
    newTd.setAttribute("data-note-database-row-path", row.file.path);
    newTd.setAttribute("data-note-database-column-key", col.key);
    if (oldTd.hasClass("db-cell-range-selected")) {
      newTd.addClass("db-cell-range-selected");
    }

    oldTd.replaceWith(newTd);
    this.cellRenderer.renderCell(newTd, row, col);
    this.setupTableCellSelection(newTd, row, col);
    if (!this.isPhoneLayout() && this.canFillColumn(col)) {
      this.setupTableFillHandle(newTd, row, col);
    }
  }

  private areCellValuesEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === "object") || (b && typeof b === "object")) {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    return (a ?? null) === (b ?? null);
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
      const plan = this.getFillTargetPlan(targetCells);
      clearTargets();
      if (plan.targets.length > 0) void this.applyTableFill(plan, sourceValue);
      else if (plan.skipped > 0) new Notice(t("notice.noEditableCellsSkipped", { skipped: plan.skipped }));
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
        cells.push(cell);
      }
    }
    return cells;
  }

  private getFillTargetPlan(cells: HTMLElement[]): BatchTargetPlan {
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const seen = new Set<string>();
    const targets: FillTarget[] = [];
    let skipped = 0;
    for (const cell of cells) {
      const path = cell.dataset.noteDatabaseRowPath;
      const colKey = cell.dataset.noteDatabaseColumnKey;
      if (!path || !colKey) continue;
      const key = `${path}\u0000${colKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = rowByPath.get(path);
      const targetCol = this.getFillColumnByKey(colKey);
      if (!row || !targetCol || !this.canFillColumn(targetCol)) {
        skipped += 1;
        continue;
      }
      targets.push({ row, col: targetCol });
    }
    return { targets, skipped };
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

  private cloneCellChange(change: CellEditChange): CellEditChange {
    return {
      file: change.file,
      path: change.path,
      key: change.key,
      oldValue: this.cloneFillValue(change.oldValue),
      oldExists: change.oldExists,
      newValue: this.cloneFillValue(change.newValue),
    };
  }

  private normalizeFrontmatterValueChange(change: FrontmatterValueChange): CellEditChange {
    return this.cloneCellChange(change as CellEditChange);
  }

  private async applyFrontmatterChanges(changes: CellEditChange[], direction: "old" | "new"): Promise<void> {
    const updatesByPath = new Map<string, { file: TFile; updates: Record<string, unknown> }>();
    for (const change of changes) {
      const file = this.app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) continue;
      const entry = updatesByPath.get(change.path) || { file, updates: {} };
      if (direction === "old") {
        entry.updates[change.key] = change.oldExists ? this.cloneFillValue(change.oldValue) : null;
      } else {
        entry.updates[change.key] = this.cloneFillValue(change.newValue);
      }
      updatesByPath.set(change.path, entry);
    }
    for (const entry of updatesByPath.values()) {
      await this.dataSource.updateFrontmatter(entry.file, entry.updates);
    }
  }

  private async applyTableFill(plan: BatchTargetPlan, value: unknown): Promise<void> {
    try {
      const changes: CellEditChange[] = [];
      for (const target of plan.targets) {
        changes.push(this.createCellChange(target.row, target.col, this.cloneFillValue(value)));
      }
      await this.applyCellChanges(changes, t("undo.fillCells"));
      this.showBatchNotice("filled", changes.length, plan.skipped);
    } catch (err) {
      new Notice(t("errors.batchFillFailed", { error: String(err) }));
    }
  }

  private getSelectedEditableCellTargetPlan(): BatchTargetPlan {
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const colByKey = new Map(this.getConfig().schema.columns.map((col) => [col.key, col]));
    const targets: FillTarget[] = [];
    let skipped = 0;
    for (const address of this.getSelectedCellAddresses()) {
      const row = rowByPath.get(address.rowPath);
      const col = colByKey.get(address.colKey);
      if (!row || !col || !this.canFillColumn(col)) {
        skipped += 1;
        continue;
      }
      targets.push({ row, col });
    }
    return { targets, skipped };
  }

  private async copySelectedCells(format: "tsv" | "markdown" | "csv" = "tsv"): Promise<void> {
    const selected = this.getSelectedCellAddresses();
    if (selected.length === 0) return;
    const content = this.serializeSelectedCells(format);
    await navigator.clipboard.writeText(content);
    new Notice(t("notice.copiedCells", { count: selected.length }));
  }

  private serializeSelectedCells(format: "tsv" | "markdown" | "csv"): string {
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const selected = this.getSelectedCellAddresses();
    const selectedSet = new Set(selected.map((cell) => `${cell.rowPath}\u0000${cell.colKey}`));
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const colByKey = new Map(this.getConfig().schema.columns.map((col) => [col.key, col]));
    const matrix: string[][] = [];
    const includedColKeys = colKeys.filter((colKey) => selected.some((cell) => cell.colKey === colKey));
    for (const rowPath of rowPaths) {
      const values: string[] = [];
      for (const colKey of colKeys) {
        if (!selectedSet.has(`${rowPath}\u0000${colKey}`)) continue;
        const row = rowByPath.get(rowPath);
        const col = colByKey.get(colKey);
        values.push(row && col ? this.getColumnDisplayText(row, col) : "");
      }
      if (values.length > 0) matrix.push(values);
    }
    if (format === "markdown") {
      const headers = includedColKeys.map((key) => colByKey.get(key)?.label || key);
      const escapeMarkdown = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
      return [
        `| ${headers.map(escapeMarkdown).join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...matrix.map((row) => `| ${row.map(escapeMarkdown).join(" | ")} |`),
      ].join("\n");
    }
    if (format === "csv") {
      const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
      return matrix.map((row) => row.map(escapeCsv).join(",")).join("\n");
    }
    return matrix.map((row) => row.join("\t")).join("\n");
  }

  private async fillSelectedCells(input: string): Promise<void> {
    const plan = this.getSelectedEditableCellTargetPlan();
    if (plan.targets.length === 0) {
      new Notice(plan.skipped > 0 ? t("notice.noEditableCellsSkipped", { skipped: plan.skipped }) : t("notice.noEditableCells"));
      return;
    }
    const changes = plan.targets.map((target) => this.createCellChange(target.row, target.col, this.normalizeBatchInputValue(target.col, input)));
    await this.applyCellChanges(changes, t("undo.fillCells"));
    this.showCellFillInput = false;
    this.showBatchNotice("filled", changes.length, plan.skipped);
  }

  private async pasteCellsFromClipboard(): Promise<void> {
    if (!this.cellSelection) return;
    const text = await navigator.clipboard.readText();
    const matrix = this.parseClipboardTable(text);
    if (matrix.length === 0 || matrix.every((row) => row.length === 0)) return;
    const plan = this.getPasteTargetPlan(matrix);
    if (plan.targets.length === 0) {
      new Notice(plan.skipped > 0 ? t("notice.noEditableCellsSkipped", { skipped: plan.skipped }) : t("notice.noEditableCells"));
      return;
    }
    const changes = plan.targets.map((target) => this.createCellChange(target.row, target.col, this.normalizeBatchInputValue(target.col, target.value)));
    await this.applyCellChanges(changes, t("undo.pasteCells"));
    this.showBatchNotice("pasted", changes.length, plan.skipped);
  }

  private parseClipboardTable(text: string): string[][] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const lines = trimmed.split(/\r?\n/);
    const markdownRows = lines
      .filter((line) => /^\s*\|/.test(line) && !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
      .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim().replace(/\\\|/g, "|")));
    if (markdownRows.length > 0) return markdownRows;
    if (trimmed.includes("\t")) return lines.map((line) => line.split("\t"));
    return lines.map((line) => this.parseCsvLine(line));
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }

  private getPasteTargetPlan(matrix: string[][]): BatchTargetPlan<FillTarget & { value: string }> {
    const selected = this.getSelectedCellAddresses();
    if (selected.length === 0) return { targets: [], skipped: 0 };
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const startRow = Math.min(...selected.map((cell) => rowPaths.indexOf(cell.rowPath)).filter((index) => index >= 0));
    const startCol = Math.min(...selected.map((cell) => colKeys.indexOf(cell.colKey)).filter((index) => index >= 0));
    if (!Number.isFinite(startRow) || !Number.isFinite(startCol)) return { targets: [], skipped: 0 };
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const colByKey = new Map(this.getConfig().schema.columns.map((col) => [col.key, col]));
    const selectedRows = Math.max(1, new Set(selected.map((cell) => cell.rowPath)).size);
    const selectedCols = Math.max(1, new Set(selected.map((cell) => cell.colKey)).size);
    const fillRows = matrix.length === 1 && matrix[0].length === 1 ? selectedRows : matrix.length;
    const fillCols = matrix.length === 1 && matrix[0].length === 1 ? selectedCols : Math.max(...matrix.map((row) => row.length));
    const targets: Array<FillTarget & { value: string }> = [];
    let skipped = 0;
    for (let r = 0; r < fillRows; r++) {
      for (let c = 0; c < fillCols; c++) {
        const row = rowByPath.get(rowPaths[startRow + r]);
        const col = colByKey.get(colKeys[startCol + c]);
        if (!row || !col) continue;
        if (!this.canFillColumn(col)) {
          skipped += 1;
          continue;
        }
        const value = matrix.length === 1 && matrix[0].length === 1
          ? matrix[0][0]
          : matrix[r]?.[c] ?? "";
        targets.push({ row, col, value });
      }
    }
    return { targets, skipped };
  }

  private async clearSelectedCells(): Promise<void> {
    const plan = this.getSelectedEditableCellTargetPlan();
    if (plan.targets.length === 0) {
      new Notice(plan.skipped > 0 ? t("notice.noEditableCellsSkipped", { skipped: plan.skipped }) : t("notice.noEditableCells"));
      return;
    }
    if (plan.targets.length > 20 && !window.confirm(t("confirm.clearCells", { count: plan.targets.length }))) return;
    const changes = plan.targets.map((target) => this.createCellChange(target.row, target.col, null));
    await this.applyCellChanges(changes, t("undo.clearCells"));
    this.showBatchNotice("cleared", changes.length, plan.skipped);
  }

  private showBatchNotice(action: "filled" | "pasted" | "cleared", count: number, skipped: number): void {
    if (skipped > 0) {
      const key = action === "filled"
        ? "notice.filledCellsSkipped"
        : action === "pasted"
          ? "notice.pastedCellsSkipped"
          : "notice.clearedCellsSkipped";
      new Notice(t(key, { count, skipped }));
      return;
    }
    const key = action === "filled"
      ? "notice.filledCells"
      : action === "pasted"
        ? "notice.pastedCells"
        : "notice.clearedCells";
    new Notice(t(key, { count }));
  }

  private normalizeBatchInputValue(col: ColumnDef, input: string): unknown {
    if (input === "") return null;
    if (col.type === "number" || col.type === "currency") {
      const parsed = Number(input);
      return Number.isFinite(parsed) ? parsed : input;
    }
    if (col.type === "checkbox") return toBooleanValue(input);
    if (col.type === "multi-select") {
      return input.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
    return input;
  }

  private createCellChange(row: RowData, col: ColumnDef, newValue: unknown): CellEditChange {
    const oldExists = Object.prototype.hasOwnProperty.call(row.frontmatter, col.key);
    return {
      file: row.file,
      path: row.file.path,
      key: col.key,
      oldValue: this.cloneFillValue(row.frontmatter[col.key]),
      oldExists,
      newValue: this.cloneFillValue(newValue),
    };
  }

  private createCurrentCellChange(row: RowData, col: ColumnDef, newValue: unknown): CellEditChange {
    // Option popovers can survive a refresh after grouped rows move, so re-read the latest value by file path.
    const record = this.getRecordsForActiveDatabase().find((candidate) => candidate.file.path === row.file.path);
    const frontmatter = record?.frontmatter || row.frontmatter;
    const oldExists = Object.prototype.hasOwnProperty.call(frontmatter, col.key);
    return {
      file: row.file,
      path: row.file.path,
      key: col.key,
      oldValue: this.cloneFillValue(frontmatter[col.key]),
      oldExists,
      newValue: this.cloneFillValue(newValue),
    };
  }

  private async applyCellChanges(changes: CellEditChange[], label: string): Promise<void> {
    const effectiveChanges = changes.filter((change) => change.key !== "file.name");
    if (effectiveChanges.length === 0) return;
    const updatesByPath = new Map<string, { file: TFile; updates: Record<string, unknown> }>();
    for (const change of effectiveChanges) {
      const entry = updatesByPath.get(change.path) || { file: change.file, updates: {} };
      entry.updates[change.key] = change.newValue;
      updatesByPath.set(change.path, entry);
    }
    for (const entry of updatesByPath.values()) {
      await this.dataSource.updateFrontmatter(entry.file, entry.updates);
    }
    // Sync computed fields for affected files before rendering
    const config = this.getConfig();
    if (config?.schema.computedFields.length) {
      const affectedFields = effectiveChanges.map((c) => c.key);
      for (const entry of updatesByPath.values()) {
        const row = this.rows.find((r) => r.file.path === entry.file.path);
        if (row) {
          await this.syncComputedForFile(row.file, { ...row.frontmatter, ...entry.updates }, affectedFields);
        }
      }
    }
    this.pushHistory({ type: "cells", label, changes: effectiveChanges });
    this.clearCellSelection();
    await this.refreshAfterSave();
    this.rerenderToolbar();
  }

  private pushHistory(entry: HistoryEntry): void {
    this.historyStack.unshift(entry);
    if (this.historyStack.length > 15) this.historyStack.length = 15;
    this.updateUndoAction();
  }

  async undoLastEdit(): Promise<void> {
    const entry = this.historyStack.shift();
    if (!entry) {
      new Notice(t("notice.nothingToUndo"));
      this.updateUndoAction();
      return;
    }
    this.applyingHistory = true;
    try {
      if (entry.type === "config") {
        await this.undoConfigEntry(entry);
        // Close stale cell option popovers that may survive the table refresh
        this.containerEl_?.querySelectorAll(".db-cell-option-popover").forEach((el) => el.remove());
      } else {
        await this.undoCellEntry(entry);
      }
    } finally {
      this.applyingHistory = false;
      this.updateUndoAction();
    }
    new Notice(t("notice.undone", { action: entry.label }));
  }

  private async undoCellEntry(entry: CellHistoryEntry): Promise<void> {
    const updatesByPath = new Map<string, { file: TFile; updates: Record<string, unknown> }>();
    for (const change of entry.changes) {
      const file = this.app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) continue;
      const target = updatesByPath.get(change.path) || { file, updates: {} };
      target.updates[change.key] = change.oldExists ? this.cloneFillValue(change.oldValue) : null;
      updatesByPath.set(change.path, target);
    }
    for (const target of updatesByPath.values()) {
      await this.dataSource.updateFrontmatter(target.file, target.updates);
    }
    await this.refreshAfterSave();
    this.rerenderToolbar();
    this.renderSelectionStatusBar();
  }

  private async undoConfigEntry(entry: ConfigHistoryEntry): Promise<void> {
    const index = this.viewEntries.findIndex((candidate) => candidate.sourcePath === entry.dbPath);
    if (index < 0) return;
    const target = this.viewEntries[index];
    this.replaceDatabaseConfig(target.config, entry.before);
    this.configSnapshots.set(this.getConfigHistoryKey(target), this.cloneDatabaseConfig(target.config));
    if (entry.viewId) {
      const viewIndex = target.config.views.findIndex((view) => view.id === entry.viewId);
      if (viewIndex >= 0) this.currentViewIndex = viewIndex;
    }
    this.currentDbIndex = index;
    this.viewStateStore.clear();
    this.viewState = undefined;
    const file = this.app.vault.getAbstractFileByPath(target.sourcePath);
    if (file instanceof TFile) {
      this.suppressDataReload(2500);
      await this.dataSource.updateViewDefFile(file, target.config, this.getCurrentDatabaseMutationTarget());
    }
    if (entry.cellChanges?.length) {
      await this.applyFrontmatterChanges(entry.cellChanges, "old");
      await this.refreshAfterSave();
    }
    this.rerenderToolbar();
    if (!entry.cellChanges?.length) this.refresh();
  }

  private replaceDatabaseConfig(target: DatabaseConfig, source: DatabaseConfig): void {
    for (const key of Object.keys(target)) {
      delete (target as unknown as Record<string, unknown>)[key];
    }
    Object.assign(target, this.cloneDatabaseConfig(source));
  }

  private updateUndoAction(): void {
    if (!this.undoActionEl) return;
    const disabled = this.historyStack.length === 0;
    this.undoActionEl.toggleClass("is-disabled", disabled);
    this.undoActionEl.setAttribute("aria-disabled", String(disabled));
    this.undoActionEl.setAttribute("title", disabled ? t("notice.nothingToUndo") : t("toolbar.undo"));
  }

  private positionUndoActionNearNavigation(): void {
    const action = this.undoActionEl;
    if (!action?.isConnected) return;
    const leafContent = this.containerEl_?.closest(".workspace-leaf-content");
    const header = leafContent?.querySelector<HTMLElement>(".view-header");
    const nav = header?.querySelector<HTMLElement>(".view-header-nav-buttons");
    if (!header || !nav) return;
    action.addClass("db-view-undo-action-near-nav");
    nav.insertAdjacentElement("afterend", action);
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
      if (config.manualOrder?.ranks && Object.keys(config.manualOrder.ranks).length > 0) {
        // Manual order already applied by RowPipeline — no per-group sorting needed
      } else if (config.boardCardOrders?.[field]) {
        // Legacy backward compat: use boardCardOrders for per-group ordering
        this.applyBoardCardOrder(config, field, sortedGroups);
      }
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
    this.pendingUndoLabel = t("undo.groupConfig");
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
    this.pendingUndoLabel = t("undo.cardOrderConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private moveRowToPosition(movedPath: string, beforePath?: string, afterPath?: string): void {
    const config = this.getConfig();
    if (!config) return;

    if (!this.setManualRank(config, movedPath, beforePath, afterPath)) return;
    this.pendingUndoLabel = t("undo.cardOrderConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private setManualRank(config: ViewConfig, movedPath: string, beforePath?: string, afterPath?: string): boolean {
    this.ensureManualRanks(config);

    let ranks = config.manualOrder?.ranks;
    if (!ranks) return false;
    let beforeRank = beforePath ? ranks[beforePath] : undefined;
    let afterRank = afterPath ? ranks[afterPath] : undefined;
    if (beforePath && afterPath && beforeRank && afterRank && beforeRank >= afterRank) {
      config.manualOrder!.ranks = generateRanks(this.rows.map((row) => row.file.path));
      ranks = config.manualOrder!.ranks!;
      beforeRank = ranks[beforePath];
      afterRank = ranks[afterPath];
    }
    let newRank = rankBetween(beforeRank, afterRank);

    if (newRank === null) {
      // Ranks too dense — rebalance then retry
      const rebalanced = rebalanceRanks(ranks);
      config.manualOrder!.ranks = rebalanced;
      const newBeforeRank = beforePath ? rebalanced[beforePath] : undefined;
      const newAfterRank = afterPath ? rebalanced[afterPath] : undefined;
      newRank = rankBetween(newBeforeRank, newAfterRank);
    }

    if (!newRank || !config.manualOrder?.ranks) return false;
    config.manualOrder.ranks[movedPath] = newRank;
    return true;
  }

  private ensureManualRanks(config: ViewConfig): void {
    if (config.manualOrder?.ranks && Object.keys(config.manualOrder.ranks).length > 0) {
      this.ensureVisibleRowsHaveManualRanks(config);
      return;
    }

    const orderedPaths = this.getInitialManualOrderPaths(config, this.rows.map((row) => row.file.path));
    if (!config.manualOrder) config.manualOrder = {};
    config.manualOrder.ranks = generateRanks(orderedPaths);
  }

  private getInitialManualOrderPaths(config: ViewConfig, fallbackPaths: string[]): string[] {
    // For board views with existing boardCardOrders, preserve that order.
    const boardField = config.boardGroupField || this.vs().groupByField || this.getDefaultBoardField(config);
    const groupOrders = config.boardCardOrders?.[boardField];
    if (groupOrders) {
      const col = config.schema.columns.find((c) => c.key === boardField);
      const optionValues = col ? getColumnOptionValues(col) : [];
      const groupOrder = getEffectiveGroupOrder(config, boardField, [...Object.keys(groupOrders), ...optionValues]);
      const flattened: string[] = [];
      const seen = new Set<string>();
      for (const groupKey of groupOrder) {
        for (const path of groupOrders[groupKey] || []) {
          if (!seen.has(path)) { flattened.push(path); seen.add(path); }
        }
      }
      // Append records that did not exist in the legacy board order.
      for (const path of fallbackPaths) {
        if (!seen.has(path)) { flattened.push(path); seen.add(path); }
      }
      return flattened;
    }
    return fallbackPaths;
  }

  private initializeManualRanksForRecords(config: ViewConfig, records: NoteRecord[]): boolean {
    const paths = records.map((record) => record.file.path);
    if (paths.length === 0) return false;
    if (!config.manualOrder?.ranks || Object.keys(config.manualOrder.ranks).length === 0) {
      config.manualOrder = {
        ...(config.manualOrder || {}),
        ranks: generateRanks(this.getInitialManualOrderPaths(config, paths)),
      };
      return true;
    }
    const ranks = config.manualOrder.ranks;
    if (paths.every((path) => ranks[path] != null)) return false;
    const orderedPaths = Object.entries(ranks)
      .sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path]) => path);
    const seen = new Set(orderedPaths);
    for (const path of paths) {
      if (!seen.has(path)) {
        orderedPaths.push(path);
        seen.add(path);
      }
    }
    config.manualOrder.ranks = generateRanks(orderedPaths);
    return true;
  }

  private ensureVisibleRowsHaveManualRanks(config: ViewConfig): void {
    const ranks = config.manualOrder?.ranks;
    if (!ranks) return;
    const missing = this.rows.filter((row) => ranks[row.file.path] == null);
    if (missing.length === 0) return;
    const existingOrdered = Object.entries(ranks)
      .sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path]) => path);
    const seen = new Set(existingOrdered);
    const orderedPaths = [...existingOrdered];
    for (const row of this.rows) {
      if (!seen.has(row.file.path)) {
        orderedPaths.push(row.file.path);
        seen.add(row.file.path);
      }
    }
    config.manualOrder!.ranks = generateRanks(orderedPaths);
  }

  private updateBoardColumnWidth(width: number): void {
    const config = this.getConfig();
    if (!config) return;
    config.boardColumnWidth = width;
    this.pendingUndoLabel = t("undo.columnWidthConfig");
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
    this.pendingUndoLabel = t("undo.groupCollapseConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private updateGalleryCardSize(width: number): void {
    const config = this.getConfig();
    if (!config) return;
    config.galleryCardSize = width;
    this.pendingUndoLabel = t("undo.cardSizeConfig");
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

  private async moveRowToGroupAndPosition(
    row: RowData,
    field: string,
    fromGroupKey: string,
    toGroupKey: string,
    beforePath?: string,
    afterPath?: string
  ): Promise<void> {
    await this.moveRowWithGroupUpdatesAndPosition(
      row,
      [{ field, fromGroupKey, toGroupKey }],
      beforePath,
      afterPath
    );
  }

  private async moveRowWithGroupUpdatesAndPosition(
    row: RowData,
    updates: Array<{ field: string; fromGroupKey: string; toGroupKey: string }>,
    beforePath?: string,
    afterPath?: string
  ): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    try {
      this.setManualRank(config, row.file.path, beforePath, afterPath);
      this.pendingUndoLabel = t("undo.cardOrderConfig");
      this.scheduleConfigSave();

      const rows = this.getRowsForGroupMove(row);
      for (const targetRow of rows) {
        const frontmatterUpdates: Record<string, unknown> = {};
        for (const update of updates) {
          const col = config.schema.columns.find((candidate) => candidate.key === update.field);
          frontmatterUpdates[update.field] = this.getMovedGroupValue(
            targetRow,
            update.field,
            col,
            update.fromGroupKey,
            update.toGroupKey
          );
        }
        await this.dataSource.updateFrontmatter(targetRow.file, frontmatterUpdates);
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
    this.pendingUndoLabel = t("undo.sortConfig");
    this.scheduleViewStateSave();
    this.updateToolbarIndicators();
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
    this.pendingUndoLabel = t("undo.sortConfig");
    this.scheduleViewStateSave();
    this.updateToolbarIndicators();
    this.refresh();
  }

  private autoFitColumn(col: ColumnDef): void {
    const config = this.getConfig();
    if (!config) return;
    col.width = this.calculateAutoColumnWidth(col, this.rows);
    this.pendingUndoLabel = t("undo.columnWidthConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private autoFitAllColumns(): void {
    const config = this.getConfig();
    if (!config) return;
    for (const col of getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns)) {
      col.width = this.calculateAutoColumnWidth(col, this.rows);
    }
    this.pendingUndoLabel = t("undo.columnWidthConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private calculateAutoColumnWidth(col: ColumnDef, rows: RowData[]): number {
    return estimateAutoColumnWidth(col, rows, (row, column) => this.getColumnDisplayText(row, column));
  }

  private getColumnDisplayText(row: RowData, col: ColumnDef): string {
    if (col.key === "file.name") return this.getFileDisplayName(row);
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

  private async syncComputedForFile(
    file: TFile,
    frontmatter: Record<string, unknown>,
    affectedFields?: string[]
  ): Promise<void> {
    const config = this.getConfig();
    if (!config?.schema.computedFields.length) return;

    const engine = new ComputedFieldEngine(config.schema.computedFields, config.schema.columns);
    const computed = engine.evaluate(frontmatter);

    const computedColumns = config.schema.columns.filter(col => col.type === "computed");
    const updates: Record<string, unknown> = {};

    for (const col of computedColumns) {
      if (affectedFields?.length) {
        const deps = ComputedFieldEngine.extractDependencies(
          config.schema.computedFields.find(cf => cf.key === (col.computedKey || col.key))?.expression || ""
        );
        const allRelevant = [...affectedFields, ...computedColumns.map(c => c.key)];
        if (!deps.some(d => allRelevant.includes(d))) continue;
      }
      const key = col.computedKey || col.key;
      const value = computed[key];
      const nextValue = value == null ? "" : value;
      if (String(frontmatter[col.key] ?? "") !== String(nextValue ?? "")) {
        updates[col.key] = nextValue;
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.dataSource.updateFrontmatter(file, updates);
    }
  }

  private scheduleComputedSync(config: ViewConfig, rows: RowData[]): void {
    if (config.schema.computedFields.length === 0) return;
    if (this.computedSyncTimer !== null) clearTimeout(this.computedSyncTimer);
    this.computedSyncTimer = window.setTimeout(() => {
      this.computedSyncTimer = null;
      void this.syncComputedFieldsNow(false, config);
    }, 5000);
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
      const records = db ? this.dataSource.getRecordsForDatabase(this.getEffectiveConfig(db)) : this.rows.map((row) => ({
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
