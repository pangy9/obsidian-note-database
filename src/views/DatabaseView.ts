import { App, ItemView, WorkspaceLeaf, Notice, TFile, normalizePath, stringifyYaml, setIcon } from "obsidian";
import { DataSource, NoteRecord, ViewConfigMutation } from "../data/DataSource";
import { evaluateBaseFilterExpression } from "../data/BaseExpression";
import { moveDatabaseFilePath, sortDatabaseFileEntries } from "../data/DatabaseFileOrder";
import { QueryEngine } from "../data/QueryEngine";
import { PropertyService } from "../data/PropertyService";
import { ComputedFieldEngine } from "../data/ComputedField";
import { evaluateComputedFields } from "../data/ComputedEvaluator";
import {
  ensureColumnOrder,
  getColumnsInOrder,
  getVisibleColumns,
} from "../data/ColumnConfig";
import { RowPipeline } from "../data/RowPipeline";
import { ViewConfig, ColumnDef, RowData, DatabaseConfig, DatabaseViewType, FilterRule, GroupOrderMode, SourceRule, StatusOptionDef, StatusPresetDef, generateId, CreateEntryPosition } from "../data/types";
import {
  getDefaultCellValue as getColumnDefaultCellValue,
  getStatusPresetOptions,
  getInvalidObsidianTagValues,
  hasObsidianTagValue,
  normalizeStatusPresets,
  resolveDefaultStatusPresetId,
  isOptionColumnType,
  isObsidianTagsKey,
  normalizeObsidianTagValue,
  normalizeValidObsidianTagValue,
  normalizeOptionValueForKey,
  toBooleanValue,
  toMultiSelectValuesForKey,
  toValidObsidianTagValues,
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
import { captureDatabaseViewport, restoreDatabaseViewport } from "./DatabaseViewport";

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
import { ChartRenderer } from "./ChartRenderer";
import { ChartToolbarRenderer } from "./ChartToolbarRenderer";
import { getDefaultChartDateBucket, getDefaultChartField, getDefaultChartNumberBucket } from "../data/ChartAggregation";
import { ColumnRenameModal } from "./modals/ColumnRenameModal";
import { DeleteDatabaseModal } from "./modals/DeleteDatabaseModal";
import { confirmWithModal } from "./modals/ConfirmModal";
import { AddDatabaseModal } from "./modals/AddDatabaseModal";
import { BaseImportColumn, BaseImportConfirmModal } from "./modals/BaseImportConfirmModal";
import { collectFileFrontmatterKeys, inferColumnType, getVaultTags, collectUniqueListValues, collectUniqueStringValues } from "../data/FrontmatterScanner";
import { normalizeComputedSyncMode } from "../data/ComputedSync";
import { getComputedFrontmatterCleanupOptions } from "../data/ComputedCleanup";
import { getComputedStorageKey } from "../data/ColumnDisplay";
import { combineSourceRuleTrees, getRequiredSourceRules, getSourceRuleTree, getSourceRuleTypedValue, matchesBaseSourceType, matchesSourceRuleTree, sourceRuleContainsValue, sourceRuleValuesLooseEqual, sourceRuleValuesStrictEqual } from "../data/SourceRules";
import { fileHasLink, getBaseFileFieldType, getFileFieldValue, getRowFileFieldValue, isBaseFileField, isFileFieldKey, isReadonlyFileField } from "../data/FileFields";
import { StatusOptionsModal } from "./modals/StatusOptionsModal";
import { FileTitleDisplay, getFileTitleDisplay } from "./FileTitleDisplay";
import { StatusPresetManagerModal } from "./modals/StatusPresetManagerModal";
import { FormulaModal, FormulaSaveResult } from "./modals/FormulaModal";
import { ComputedFrontmatterCleanupModal } from "./modals/ComputedFrontmatterCleanupModal";
import { CsvMarkdownExportModal } from "./modals/CsvMarkdownExportModal";
import { CsvMarkdownExportOptions } from "../data/CsvMarkdownZipExport";
import { t } from "../i18n";
import { createStoredZip, ZipEntry } from "../data/ZipExport";
import { saveZipWithPicker } from "../data/ExportSaveTarget";
import { getEffectiveFilterRules } from "../data/FilterRules";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { estimateAutoColumnWidth } from "./ColumnWidth";
import { isHTMLElement } from "./DomGuards";
import { safeString } from "../data/SafeString";
import { positionToolbarPopover } from "./PopoverPosition";

const MAX_SOURCE_RULE_MATCH_TEXT_LENGTH = 10000;
const NEW_COLUMN_HIGHLIGHT_MS = 2200;

function filtersEqual(left: FilterRule, right: FilterRule): boolean {
  return left.field === right.field && left.op === right.op && (left.value || "") === (right.value || "");
}

export const DATABASE_VIEW_TYPE = "note-database-view";

/**
 * Safely retrieve the NoteDatabasePlugin instance from the Obsidian app registry.
 * Returns null if the plugin is not loaded (e.g. during hot-reload or tests).
 */
interface NoteDatabasePluginLike {
  settings: import("../data/types").PluginSettings;
  saveSettings(): Promise<void>;
  openDatabaseFileView?(file: TFile): Promise<void>;
}

function getNoteDatabasePlugin(app: App): NoteDatabasePluginLike | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
  const instance = plugins?.plugins?.["note-database"];
  if (instance && typeof (instance as NoteDatabasePluginLike).saveSettings === "function") {
    return instance as NoteDatabasePluginLike;
  }
  return null;
}

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

interface ConfigSaveMetadata {
  undoLabel: string | null;
  cellChanges: CellEditChange[] | null;
}

interface PendingConfigSave extends ConfigSaveMetadata {
  entry: ViewEntry;
  mutation?: ViewConfigMutation;
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
  private chartRenderer = new ChartRenderer();
  private chartToolbarRenderer = new ChartToolbarRenderer();
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
  private pendingRevealColumnKey?: string;
  private pendingRevealColumnUntil = 0;
  private pendingRevealColumnScrolled = false;
  private pendingRevealColumnTimer: number | null = null;
  private showColumnManager = false;
  private activeHeaderPopover?: HeaderPopoverKind;
  private headerPopoverAnchorEl?: HTMLElement;
  private removeHeaderPopoverAutoClose?: () => void;
  private groupOrderPopover?: HTMLElement;
  private removeGroupOrderPopoverListener?: () => void;
  private readonly handleOutsideClickBound = (event: MouseEvent) => this.handleOutsideClick(event);
  private configSaveTimer: number | null = null;
  private pendingConfigSave: PendingConfigSave | null = null;
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
  private descriptionScrollTimers = new WeakMap<HTMLElement, number>();

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
      (row) => this.getFileTitleInfo(row),
      () => this.getConfig()?.schema.computedFields || [],
      this.app
    );
    this.columnOperations = new ColumnOperations({
      app: this.app,
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
      refreshSchemaChanged: (options) => this.refreshSchemaChanged(options),
      refreshAfterSave: () => this.refreshAfterSave(),
      markPendingColumn: (key) => this.markPendingColumn(key),
      refreshColumnManager: () => {
        if (this.showColumnManager) this.renderColumnManager();
      },
      setPendingUndoLabel: (label) => { this.pendingUndoLabel = label; },
      setPendingConfigCellChanges: (changes) => {
        this.pendingConfigCellChanges = changes.map((change) => this.normalizeFrontmatterValueChange(change));
      },
      getDefaultStatusOptions: () => this.getDefaultStatusOptions(),
      getDefaultStatusPresetId: () => this.getDefaultStatusPresetId(),
    });
    this.rowMenu = new RowMenu({
      app: this.app,
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
      createEntry: (defaults, position) => { void this.createBlankEntry(defaults, position); },
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
    });
    this.boardRenderer = new BoardRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults, position) => { void this.createBlankEntry(defaults, position); },
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
      editFormula: (col) => this.showFormulaModal(col),
    });
    this.galleryRenderer = new GalleryRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults, position) => { void this.createBlankEntry(defaults, position); },
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
      editFormula: (col) => this.showFormulaModal(col),
    });
    this.listRenderer = new ListRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults, position) => { void this.createBlankEntry(defaults, position); },
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
      editFormula: (col) => this.showFormulaModal(col),
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
    if (!this.hasActiveDatabase()) {
      return this.viewState || {
        hiddenColumns: new Set<string>(),
        filters: [],
        filterLogic: "and",
        sortRules: [],
        sortDirection: "asc",
        groupByField: "",
        statusFilter: "",
        searchText: "",
      };
    }
    const config = this.getConfig();
    const state = this.viewStateStore.get(this.currentDbIndex, this.currentViewIndex, config);
    if (this.viewState !== state) {
      this.viewState = state;
    }
    return this.viewState;
  }

  private clearViewStateCache(): void {
    this.viewStateStore.clear();
    this.viewState = undefined;
  }

  private hasActiveDatabase(): boolean {
    return Boolean(this.viewEntries[this.currentDbIndex]?.config?.views?.length);
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
    const options = await new CsvMarkdownExportModal(this.app).openAndWait();
    if (!options) return null;
    return this.createCsvMarkdownZip(options);
  }

  private async createCsvMarkdownZip(options: CsvMarkdownExportOptions): Promise<TFile | null> {
    const db = this.getActiveDb();
    const config = this.getConfig();
    if (!db || !config) return null;
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
    const result = await saveZipWithPicker(this.app, zip, `${baseName}.zip`, this.databaseFolder || "");
    return result?.file || null;
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
    const structureChanged = !this.hasSameViewEntryStructure(entries);
    this.viewEntries = entries;
    if (this.currentDbIndex >= entries.length) {
      this.currentDbIndex = 0;
      this.currentViewIndex = 0;
    }
    this.captureConfigSnapshots();
    if (structureChanged) this.clearViewStateCache();
  }

  private hasSameViewEntryStructure(entries: ViewEntry[]): boolean {
    if (entries.length !== this.viewEntries.length) return false;
    return entries.every((entry, index) => {
      const current = this.viewEntries[index];
      if (!current || current.sourcePath !== entry.sourcePath) return false;
      const currentViewIds = current.config.views.map((view) => view.id);
      const nextViewIds = entry.config.views.map((view) => view.id);
      return currentViewIds.length === nextViewIds.length &&
        currentViewIds.every((id, viewIndex) => id === nextViewIds[viewIndex]);
    });
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
    this.viewState = this.hasActiveDatabase()
      ? this.viewStateStore.get(this.currentDbIndex, this.currentViewIndex, this.getActiveView())
      : undefined;
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
    return "Note database";
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
    window.activeDocument.addEventListener("mousedown", this.handleOutsideClickBound, true);
    this.registerDomEvent(window.activeDocument, "keydown", (event) => this.handleDatabaseKeydown(event));
    this.registerDomEvent(window, "focus", () => this.refreshOnActivation());
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf === this.leaf) this.refreshOnActivation();
      else this.closeHeaderPopovers();
    }));
    this.registerEvent(this.app.workspace.on("css-change", () => this.chartRenderer.refreshTheme()));
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
    this.chartRenderer.destroy();
    this.removeHeaderPopoverAutoClose?.();
    this.removeHeaderPopoverAutoClose = undefined;
    this.closeGroupOrderPopover();
    window.activeDocument.removeEventListener("mousedown", this.handleOutsideClickBound, true);
    if (this.scrollbarIdleTimer !== null) {
      window.clearTimeout(this.scrollbarIdleTimer);
      this.scrollbarIdleTimer = null;
    }
    if (this.computedSyncTimer !== null) {
      window.clearTimeout(this.computedSyncTimer);
      this.computedSyncTimer = null;
    }
    if (this.configSaveTimer !== null) {
      await this.saveConfigImmediately();
    }
  }

  onResize(): void {
    this.chartRenderer.resize();
  }

  /** Default-width dashboards hide the vertical scrollbar again shortly after scrolling. */
  private markContainerScrolling(): void {
    this.containerEl_?.addClass("is-scrolling");
    if (this.scrollbarIdleTimer !== null) window.clearTimeout(this.scrollbarIdleTimer);
    this.scrollbarIdleTimer = window.setTimeout(() => {
      this.containerEl_?.removeClass("is-scrolling");
      this.scrollbarIdleTimer = null;
    }, 900);
  }

  private attachDescriptionScrollState(descEl: HTMLElement): void {
    if (descEl.dataset.noteDatabaseDescriptionScroll === "true") return;
    descEl.dataset.noteDatabaseDescriptionScroll = "true";
    this.registerDomEvent(descEl, "scroll", () => {
      descEl.addClass("is-scrolling");
      const existing = this.descriptionScrollTimers.get(descEl);
      if (existing != null) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        descEl.removeClass("is-scrolling");
        this.descriptionScrollTimers.delete(descEl);
      }, 900);
      this.descriptionScrollTimers.set(descEl, timer);
    });
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
    const active = window.activeDocument.activeElement;
    const target = event.target;
    const eventTarget = isHTMLElement(target) ? target : null;
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
      void this.saveConfigImmediately()
        .then(() => this.hardRefreshFromSource())
        .catch((err) => this.reportConfigSaveFailure(err));
      return;
    }
    this.hardRefreshFromSource();
  }

  protected get hideDatabaseActions(): boolean { return false; }

  private saveDescriptionScrollPosition(): number {
    return this.containerEl_?.querySelector<HTMLElement>(":scope > .db-header .db-description")?.scrollTop || 0;
  }

  private restoreDescriptionScrollPosition(scrollTop: number): void {
    if (scrollTop <= 0) return;
    const restore = () => {
      const desc = this.containerEl_?.querySelector<HTMLElement>(":scope > .db-header .db-description");
      if (desc) desc.scrollTop = scrollTop;
    };
    restore();
    window.requestAnimationFrame(restore);
  }

  protected renderToolbar(): void {
    if (!this.containerEl_) return;
    this.applyDisplayWidth();
    if (!this.hasActiveDatabase()) return;
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
      toggleChartOptions: (anchorEl) => this.toggleChartOptions(anchorEl),
      toggleFilterPanel: (anchorEl) => this.toggleHeaderPopover("filter", anchorEl),
      toggleColumnManager: (anchorEl) => this.toggleHeaderPopover("columns", anchorEl),
      syncComputedFields: () => this.syncComputedFieldsManually(),
      closeToolbarPopovers: () => this.closeHeaderPopovers(),
      createEntry: (defaults) => { void this.createBlankEntry(defaults); },
      isReadOnly: needsSetup,
      showChartOptions: true,
      showDatabaseChrome: true,
      hideDatabaseActions: this.hideDatabaseActions,
      addDatabase: () => { void this.addDatabase(); },
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
      const header = this.containerEl_.querySelector(":scope > .db-header");
      const height = header ? Math.ceil(header.getBoundingClientRect().height) : 96;
      this.containerEl_.style.setProperty("--db-table-header-top", `${height}px`);
    };
    update();
    window.requestAnimationFrame(update);
  }

  private setViewType(value: DatabaseViewType): void {
    const config = this.getConfig();
    if (!config) return;
    const descriptionScroll = this.saveDescriptionScrollPosition();
    if (config.viewType === "chart" && value !== "chart") this.chartRenderer.destroy();
    this.viewStateStore.persist(config, this.vs());
    config.viewType = value;
    this.viewStateStore.delete(this.currentDbIndex, this.currentViewIndex);
    this.viewState = undefined;
    this.viewStateStore.persist(config, this.vs());
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
    if (value === "chart") {
      config.chartType = config.chartType || "bar";
      config.chartAggregation = config.chartAggregation || "count";
      if (!config.chartGroupField) config.chartGroupField = getDefaultChartField(config.schema.columns, config.schema.computedFields);
      config.chartDateBucket = getDefaultChartDateBucket(config.schema.columns, config.chartGroupField, config.schema.computedFields);
      config.chartNumberBucket = getDefaultChartNumberBucket(config.schema.columns, config.chartGroupField, config.schema.computedFields);
    }
    this.pendingUndoLabel = t("undo.viewTypeConfig");
    this.scheduleConfigSave();
    this.rerenderToolbar();
    this.refresh();
    this.restoreDescriptionScrollPosition(descriptionScroll);
  }

  private setDisplayWidth(value: "default" | "wide"): void {
    const config = this.getConfig();
    if (!config) return;
    config.displayWidth = value;
    this.pendingUndoLabel = t("undo.displayWidthConfig");
    this.scheduleConfigSave();
    this.applyDisplayWidth();
    this.rerenderToolbar();
    this.refresh();
  }

  private applyDisplayWidth(): void {
    if (!this.containerEl_) return;
    if (!this.hasActiveDatabase()) {
      this.containerEl_.toggleClass("db-width-wide", false);
      this.containerEl_.toggleClass("db-width-default", true);
      return;
    }
    const config = this.getConfig();
    const width = config?.displayWidth;
    const wide = width === "wide";
    this.containerEl_.toggleClass("db-width-wide", wide);
    this.containerEl_.toggleClass("db-width-default", !wide);
  }

  private applyViewTypeClass(viewType: DatabaseViewType): void {
    if (!this.containerEl_) return;
    for (const type of ["table", "board", "gallery", "list", "chart"] as const) {
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
    this.saveCurrentViewConfigInBackground();
    this.refresh();
  }

  private toggleHeaderPopover(kind: HeaderPopoverKind, anchorEl: HTMLElement): void {
    this.chartToolbarRenderer.closePopover();
    const wasClosingActivePopover = this.activeHeaderPopover != null && this.isHeaderPopoverVisible(this.activeHeaderPopover);
    if (wasClosingActivePopover) this.persistVisibleHeaderPopoverState();
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
      if (this.configSaveTimer !== null) this.saveConfigImmediatelyInBackground();
    }
  }

  private toggleChartOptions(anchorEl: HTMLElement): void {
    const config = this.getConfig();
    if (!this.containerEl_ || !config || config.viewType !== "chart") return;
    if (this.chartToolbarRenderer.isPopoverOpen()) {
      this.chartToolbarRenderer.closePopover();
      return;
    }
    this.closeHeaderPopovers();
    const activeAnchor = this.containerEl_.querySelector<HTMLElement>(".db-chart-options-toolbar-btn") || anchorEl;
    this.chartToolbarRenderer.togglePopover(this.containerEl_, activeAnchor, config, {
      onChange: () => {
        this.scheduleConfigSave();
        this.renderChart(config);
      },
      onExportImage: () => this.chartRenderer.exportPng(this.getChartExportFilename(config)),
      onCopyPng: () => { void this.chartRenderer.copyPng(); },
    });
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
      if (target.closest(".db-filter-panel, .db-sort-panel, .db-column-manager, .db-view-config-panel, .db-dropdown-popover, .db-toolbar, .db-header")) {
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
      ".db-filter-panel, .db-sort-panel, .db-column-manager, .db-view-config-panel, .db-dropdown-popover, .db-group-order-popover, .menu"
    );
  }

  private closeHeaderPopovers(): void {
    this.toolbarRenderer.closePopovers();
    this.chartToolbarRenderer.closePopover();
    this.closeGroupOrderPopover();
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    this.persistVisibleHeaderPopoverState();
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
      this.saveConfigImmediatelyInBackground();
    }
  }

  private persistVisibleHeaderPopoverState(): void {
    if (this.showFilterPanel) {
      this.pendingUndoLabel = t("undo.filterConfig");
      this.scheduleViewStateSave();
      return;
    }
    if (this.showSortPanel) {
      this.pendingUndoLabel = t("undo.sortConfig");
      this.scheduleViewStateSave();
      return;
    }
    if (this.showColumnManager) {
      this.pendingUndoLabel = t("undo.hideColumnsConfig");
      this.scheduleViewStateSave();
      return;
    }
    if (this.showViewConfigPanel) {
      this.pendingUndoLabel = t("undo.viewConfig");
      this.scheduleConfigSave();
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
    const host = this.containerEl_ || window.activeDocument.body;
    const anchorEl = isHTMLElement(triggerBtn) ? triggerBtn : undefined;

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
    outsideTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", closeOnOutside, true), 0);
    removeAutoClose = installPopoverAutoClose({ panel: popover, anchorEl, close: () => this.closeGroupOrderPopover() });
    this.removeGroupOrderPopoverListener = () => {
      if (outsideTimer !== undefined) window.clearTimeout(outsideTimer);
      window.activeDocument.removeEventListener("mousedown", closeOnOutside, true);
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
    const descriptionScroll = this.saveDescriptionScrollPosition();
    this.closeHeaderPopovers();
    this.currentViewIndex = viewIndex;
    this.clearSelection();
    this.clearCellSelection();
    this.rerenderToolbar();
    this.refresh();
    this.restoreDescriptionScrollPosition(descriptionScroll);
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
      sourceFolder: "",
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
      chartType: viewType === "chart" ? "bar" : undefined,
      chartGroupField: viewType === "chart" ? getDefaultChartField(db.schema.columns, db.schema.computedFields) : undefined,
      chartDateBucket: viewType === "chart" ? getDefaultChartDateBucket(db.schema.columns, getDefaultChartField(db.schema.columns, db.schema.computedFields), db.schema.computedFields) : undefined,
      chartNumberBucket: viewType === "chart" ? getDefaultChartNumberBucket(db.schema.columns, getDefaultChartField(db.schema.columns, db.schema.computedFields), db.schema.computedFields) : undefined,
      chartAggregation: viewType === "chart" ? "count" : undefined,
    };
    db.views.push(newView);
    this.currentViewIndex = db.views.length - 1;
    this.clearViewStateCache();
    this.saveCurrentViewConfigInBackground();
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
    this.clearViewStateCache();
    this.saveCurrentViewConfigInBackground();
    this.rerenderToolbar();
    this.refresh();
  }

  /** Rename a view */
  private renameView(viewIndex: number, name: string): void {
    const db = this.getActiveDb();
    if (!db || !db.views[viewIndex]) return;
    db.views[viewIndex].name = name;
    this.saveCurrentViewConfigInBackground();
    this.rerenderToolbar();
  }

  private moveView(fromIndex: number, toIndex: number): void {
    const db = this.getActiveDb();
    if (!db || fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= db.views.length || toIndex < 0 || toIndex >= db.views.length) return;
    const [view] = db.views.splice(fromIndex, 1);
    db.views.splice(toIndex, 0, view);
    this.currentViewIndex = this.getMovedIndex(this.currentViewIndex, fromIndex, toIndex);
    this.clearViewStateCache();
    this.saveCurrentViewConfigInBackground(this.getCurrentDatabaseMutationTarget());
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
    this.clearViewStateCache();
    this.rerenderToolbar();
    this.refresh();
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
    this.saveCurrentViewConfigInBackground();
    this.rerenderToolbar();
  }

  private updateDatabaseDescription(description: string): void {
    const db = this.getActiveDb();
    if (!db) return;
    db.description = description.trim() || undefined;
    this.pendingUndoLabel = t("undo.databaseDescriptionConfig");
    this.saveCurrentViewConfigInBackground(this.getCurrentDatabaseMutationTarget());
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
    if (viewType === "chart") return t("common.chartView");
    return t("common.tableView");
  }

  /** Add a new database via modal dialog */
  private async addDatabase(): Promise<void> {
    const modal = new AddDatabaseModal(this.app, this.databaseFolder);
    const result = await modal.openAndWait();
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
        const col: BaseImportColumn = { key, label, type, fileCount: fileCounts.get(key) || 0 };

        // Pre-populate options for option-based types
        if (type === "multi-select" && isObsidianTagsKey(key)) {
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

        inferredColumns.push(col);
      }

      const confirmed = await new BaseImportConfirmModal(
        this.app,
        inferredColumns,
        {
          titleText: t("addDatabase.scanTitle"),
          descText: t("addDatabase.scanDesc"),
          defaultUnchecked: true,
        }
      ).openAndWait();
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
        columns.push({ key: col.key, label: col.label || col.key, type: col.type, statusOptions: col.statusOptions });
      }
    } else {
      // No frontmatter found
      new Notice(t("notice.noImportableProperties"));
    }

    const view: ViewConfig = {
      id: generateId(),
      name: t("common.tableView"),
      viewType: "table",
      sourceFolder: "",
      schema: { columns, computedFields: [] },
    };
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
    this.clearViewStateCache();
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

    const result = await new DeleteDatabaseModal(this.app, db.name, fileCount).openAndWait();
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

    // Both actions remove the live database file. Plugin trash additionally keeps a restorable snapshot.
    const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    if (file && file instanceof TFile) {
      try {
        await this.dataSource.trashNote(file);
      } catch (e) {
        new Notice(t("errors.deleteFailed", { error: String(e) }));
        return;
      }
    }

    // Move to plugin trash or system trash
    if (result.action === "plugin-trash") {
      // Store in plugin settings trashedDatabases
      const plugin = getNoteDatabasePlugin(this.app);
      if (plugin) {
        if (!plugin.settings.trashedDatabases) plugin.settings.trashedDatabases = [];
        plugin.settings.trashedDatabases.push({
          database: JSON.parse(JSON.stringify(db)) as DatabaseConfig,
          deletedAt: Date.now(),
        });
        try {
          await plugin.saveSettings();
        } catch (e) {
          console.error("Note Database: failed to save database trash settings", e);
          new Notice(t("errors.updateFailed", { error: String(e) }));
        }
      }
    }

    this.rebuildViewEntries();
    this.currentDbIndex = Math.max(0, Math.min(this.currentDbIndex, this.viewEntries.length - 1));
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
      const plugin = getNoteDatabasePlugin(this.app);
      if (plugin?.openDatabaseFileView) {
        await plugin.openDatabaseFileView(file);
      } else {
        await this.app.workspace.getLeaf("tab").openFile(file);
      }
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
      let value: unknown;
      if (isBaseFileField(col.key)) {
        value = getRowFileFieldValue(row, col.key);
      } else if (col.type === "computed" && col.computedKey) {
        value = row.computed[col.computedKey];
      } else {
        value = row.frontmatter[col.key];
      }
      if (value == null || value === "") return "";
      if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, value).join(", ");
      if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
      if (typeof value === "boolean") return value ? "✓" : "";
      return safeString(value);
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
    const value = isBaseFileField(col.key)
      ? getRowFileFieldValue(row, col.key)
      : col.type === "computed" && col.computedKey
        ? row.computed[col.computedKey]
        : row.frontmatter[col.key];
    if (value == null || value === "") return "";
    if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, value).join(", ");
    if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
    if (typeof value === "boolean") return value ? "true" : "false";
    return safeString(value);
  }

  private csvEscape(value: string): string {
    return `"${safeString(value).replace(/"/g, '""')}"`;
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

  private getRowsForView(viewIndex: number): RowData[] {
    const db = this.getActiveDb();
    const view = db?.views[viewIndex] || this.getConfig();
    const state = this.viewStateStore.get(this.currentDbIndex, viewIndex, view);
    const records = this.includePendingNewRecord(this.dataSource.getRecordsForConfig(this.getEffectiveConfig(db)));
    return this.rowPipeline.build(records, this.withBaseThisContext(view), state, this.app);
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
    this.clearViewStateCache();
    this.saveCurrentViewConfigInBackground(this.getCurrentDatabaseMutationTarget());
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

  private refreshSchemaChanged(options?: { preserveViewport?: boolean }): void {
    const viewport = options?.preserveViewport && this.containerEl_
      ? captureDatabaseViewport(this.containerEl_)
      : undefined;
    this.rerenderToolbar();
    this.renderFilterPanel();
    this.renderSortPanel();
    this.renderColumnManager();
    this.renderViewConfigPanel();
    this.refresh();
    if (viewport && this.containerEl_) {
      const container = this.containerEl_;
      window.requestAnimationFrame(() => {
        restoreDatabaseViewport(container, viewport);
        this.revealPendingColumn();
      });
    } else {
      window.requestAnimationFrame(() => this.revealPendingColumn());
    }
  }

  private markPendingColumn(key: string): void {
    this.pendingShowColumns.add(key);
    this.pendingRevealColumnKey = key;
    this.pendingRevealColumnUntil = Date.now() + NEW_COLUMN_HIGHLIGHT_MS;
    this.pendingRevealColumnScrolled = false;
    if (this.pendingRevealColumnTimer !== null) {
      window.clearTimeout(this.pendingRevealColumnTimer);
      this.pendingRevealColumnTimer = null;
    }
  }

  private async createBlankEntry(defaults: Record<string, unknown> = {}, position?: CreateEntryPosition): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    const sourceConfig = this.getCreateContextConfig(config);
    const frontmatter = this.mergeCreateDefaults(
      config,
      this.getDefaultFrontmatterFromSourceRules(sourceConfig),
      this.getDefaultFrontmatterFromViewFilters(config),
      defaults
    );
    if (sourceConfig.typeFilter) frontmatter["type"] = sourceConfig.typeFilter;
    for (const col of config.schema.columns) {
      if (isFileFieldKey(col.key) || col.type === "computed") continue;
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
        void this.syncComputedForFile(file, frontmatter, undefined, config);
      }
      this.assignManualRankForNewEntry(config, file.path, position);
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

  private assignManualRankForNewEntry(config: ViewConfig, filePath: string, position?: CreateEntryPosition): void {
    if (!config.manualOrder?.ranks || Object.keys(config.manualOrder.ranks).length === 0) return;
    const ranks = config.manualOrder.ranks;
    const lowerPath = position?.afterPath;
    const upperPath = position?.beforePath;
    const lowerRank = lowerPath ? ranks[lowerPath] : undefined;
    const upperRank = upperPath ? ranks[upperPath] : undefined;
    const fallbackLastPath = this.rows.length > 0 ? this.rows[this.rows.length - 1].file.path : undefined;
    const fallbackLastRank = fallbackLastPath ? ranks[fallbackLastPath] : undefined;
    let newRank = rankBetween(lowerRank ?? fallbackLastRank, upperRank);

    if (newRank === null) {
      config.manualOrder.ranks = rebalanceRanks(ranks);
      const rebalanced = config.manualOrder.ranks;
      newRank = rankBetween(
        lowerPath ? rebalanced[lowerPath] : fallbackLastPath ? rebalanced[fallbackLastPath] : undefined,
        upperPath ? rebalanced[upperPath] : undefined
      );
    }

    if (!newRank || !config.manualOrder.ranks) return;
    config.manualOrder.ranks[filePath] = newRank;
    this.scheduleConfigSave();
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
    const tags = new Set<string>();
    if (config.typeFilter) frontmatter["type"] = config.typeFilter;
    const sourceRuleTree = getSourceRuleTree(config.sourceRuleTree, config.sourceRules, config.sourceLogic);
    for (const rule of getRequiredSourceRules(sourceRuleTree)) {
      if ((rule.op === "eq" || rule.op === "strictEq") && rule.value != null && this.isWritableSourceRuleField(config, rule.field)) {
        frontmatter[rule.field] = rule.op === "strictEq" || rule.valueType ? getSourceRuleTypedValue(rule) : rule.value;
      }
      if (rule.op === "hasProperty" && this.isWritableSourceRuleField(config, rule.field) && !Object.prototype.hasOwnProperty.call(frontmatter, rule.field)) {
        frontmatter[rule.field] = "";
      }
      if (rule.op === "hasTag" && rule.value) {
        tags.add(normalizeObsidianTagValue(rule.value));
      }
    }
    if (tags.size > 0) frontmatter["tags"] = Array.from(tags);
    return frontmatter;
  }

  private isWritableSourceRuleField(config: ViewConfig, field: string): boolean {
    if (!field || field.startsWith("file.") || field.startsWith("formula.")) return false;
    return config.schema.columns.find((column) => column.key === field)?.type !== "computed";
  }

  private mergeCreateDefaults(config: ViewConfig, ...sources: Record<string, unknown>[]): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {};
    for (const source of sources) {
      for (const [key, value] of Object.entries(source)) {
        const col = config.schema.columns.find((candidate) => candidate.key === key);
        if (col?.type === "multi-select" || isObsidianTagsKey(key)) {
          frontmatter[key] = Array.from(new Set([
            ...toMultiSelectValuesForKey(key, frontmatter[key]),
            ...toMultiSelectValuesForKey(key, value),
          ]));
        } else {
          frontmatter[key] = value;
        }
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
      sourceRuleTree: combineSourceRuleTrees(db.sourceRuleTree, config.sourceRuleTree),
      newRecordFolder: config.newRecordFolder || db.newRecordFolder,
      typeFilter: config.typeFilter || db.typeFilter,
      schema: config.schema || db.schema,
    };
  }

  private getCreateFolder(config: ViewConfig): string {
    if (config.newRecordFolder) return normalizePath(config.newRecordFolder);
    const sourceFolder = this.normalizeVaultFolder(config.sourceFolder || "");
    const sourceRuleTree = getSourceRuleTree(config.sourceRuleTree, config.sourceRules, config.sourceLogic);
    const ruledFolders = getRequiredSourceRules(sourceRuleTree)
      .filter((rule) => rule.op === "inFolder" && rule.value)
      .map((rule) => this.normalizeVaultFolder(String(rule.value)))
      .filter((folder) => !sourceFolder || !folder || folder === sourceFolder || folder.startsWith(`${sourceFolder}/`));
    const mostSpecificFolder = ruledFolders.reduce(
      (current, folder) => folder.length > current.length ? folder : current,
      sourceFolder
    );
    if (mostSpecificFolder || config.sourceFolder) return normalizePath(mostSpecificFolder || "/");
    return normalizePath(mostSpecificFolder || this.databaseFolder || "");
  }

  /** Resolve legacy view-level source settings without widening a database query to the vault root. */
  private getEffectiveConfig(dbConfig: DatabaseConfig, viewConfig: ViewConfig = this.getConfig()): DatabaseConfig {
    return {
      ...dbConfig,
      baseThisFilePath: this.getCurrentEntry()?.sourcePath,
      sourceFolder: this.normalizeVaultFolder(dbConfig.sourceFolder || viewConfig.sourceFolder || ""),
      sourceRules: dbConfig.sourceRules || viewConfig.sourceRules,
      sourceLogic: dbConfig.sourceLogic || viewConfig.sourceLogic,
      sourceRuleTree: combineSourceRuleTrees(dbConfig.sourceRuleTree, viewConfig.sourceRuleTree),
      typeFilter: dbConfig.typeFilter || viewConfig.typeFilter,
    };
  }

  private withBaseThisContext(config: ViewConfig): ViewConfig {
    return {
      ...config,
      baseThisFilePath: this.getCurrentEntry()?.sourcePath,
    };
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
        window.activeDocument.removeEventListener("mouseup", onMouseUp, true);
      };
      window.activeDocument.addEventListener("mouseup", onMouseUp, true);
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
    return window.activeDocument.body.classList.contains("is-phone");
  }

  private isInteractiveCellTarget(target: EventTarget | null): boolean {
    return isHTMLElement(target) &&
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
    if (!await confirmWithModal(this.app, {
      title: t("common.delete"),
      message: t("confirm.deleteSelected", { count: rows.length }),
      confirmText: t("common.delete"),
      danger: true,
    })) return;
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
        this.saveConfigImmediatelyInBackground();
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
        this.saveConfigImmediatelyInBackground();
      },
    }, this.getHeaderPopoverAnchor("sort"));
  }

  private updateToolbarIndicators(): void {
    if (!this.containerEl_) return;
    const state = this.vs();
    const filterBtn = this.containerEl_.querySelector(".db-filter-btn");
    if (isHTMLElement(filterBtn)) this.updateToolbarBadge(filterBtn, getEffectiveFilterRules(state.filters).length);
    const sortBtn = this.containerEl_.querySelector(".db-sort-btn");
    if (isHTMLElement(sortBtn)) {
      const count = state.sortRules.filter((rule) => rule.field && rule.direction).length ||
        (state.sortColumn ? 1 : 0);
      this.updateToolbarBadge(sortBtn, count);
    }
    const colBtn = this.containerEl_.querySelector(".db-col-manager-btn");
    if (isHTMLElement(colBtn)) this.updateToolbarBadge(colBtn, Math.max(0, (this.getConfig()?.schema.columns.length || 0) - state.hiddenColumns.size));
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
          this.saveConfigImmediatelyInBackground();
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
      app: this.app,
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
      onComputedSyncModeChange: () => this.rerenderToolbar(),
      onComputedFrontmatterCleanup: () => this.showComputedFrontmatterCleanupModal(),
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
    const heading = this.containerEl_.querySelector(":scope > .db-header .db-heading");
    if (heading) {
      const name = db?.name || t("common.untitledDatabase");
      const headingText = heading.querySelector(".db-heading-text");
      if (headingText) headingText.textContent = name;
      else heading.textContent = name;
      heading.setAttribute("title", name);
    }
    const header = this.containerEl_.querySelector(":scope > .db-header");
    if (!header) return;
    const existing = header.querySelector<HTMLElement>(".db-description");
    const desc = existing || header.createDiv({ cls: "db-description" });
    const description = db?.description || "";
    const placeholder = t("viewConfig.descriptionPlaceholder");
    if (!existing && heading?.parentElement?.nextSibling) header.insertBefore(desc, heading.parentElement.nextSibling);
    desc.textContent = description;
    desc.toggleClass("is-empty", !description);
    desc.setAttribute("title", description || placeholder);
    desc.setAttribute("data-placeholder", placeholder);
    this.attachDescriptionScrollState(desc);
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
    if (isFileFieldKey(col.key)) {
      new Notice(t("fileField.fixedType"));
      return;
    }
    this.pendingUndoLabel = t("undo.fieldOptionsConfig");
    new StatusOptionsModal(this.app, col, async (result) => {
      const previousOptions = col.statusOptions?.map((option) => ({ ...option })) || [];
      await this.commitColumnOptionsTransaction(col, previousOptions, result.options, { presetId: result.presetId });
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

    if (target.key === "file.tags") {
      if (transaction.nextOptions) {
        target.statusOptions = this.normalizeFileTagColorOptions(transaction.nextOptions);
        target.statusPresetId = undefined;
        this.pendingUndoLabel = t("undo.fieldOptionsConfig");
        await this.saveCurrentViewConfig();
        this.refresh();
        return;
      }
      if (!transaction.setValue) return;
      const invalidTags = this.getInvalidFileTagValues(target, transaction.value);
      if (invalidTags.length > 0) {
        this.showInvalidFileTagsNotice(invalidTags);
        return;
      }
      const change = this.createCurrentCellChange(row, target, transaction.value);
      if (this.areCellValuesEqual(change.oldValue, change.newValue)) return;
      await this.applyCellChanges([change], t("undo.editCell"));
      return;
    }

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
      presetId?: string;
    } = {}
  ): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    const target = config.schema.columns.find((candidate) => candidate.key === col.key);
    if (!target) return;
    const normalizedPrevious = this.normalizeOptionDefsForColumn(target, previousOptions);
    const normalizedNext = this.normalizeOptionDefsForColumn(target, nextOptions);
    const previousValues = new Set(normalizedPrevious.map((option) => option.value));
    const nextValues = new Set(normalizedNext.map((option) => option.value));
    const renameValues = (options.renameValues || this.inferOptionRenames(normalizedPrevious, normalizedNext))
      .map((rename) => ({
        from: normalizeOptionValueForKey(target.key, rename.from),
        to: normalizeOptionValueForKey(target.key, rename.to),
      }))
      .filter((rename) => rename.from && rename.to && rename.from !== rename.to);
    const renamedValues = new Set(renameValues.map((rename) => rename.from));
    const inferredRemoved = Array.from(previousValues)
      .filter((value) => !nextValues.has(value) && !renamedValues.has(value));
    const removedValues = new Set(
      (options.cleanupRemovedValues ?? inferredRemoved)
        .map((value) => normalizeOptionValueForKey(target.key, value))
        .filter(Boolean)
    );
    const changes = this.mergeCellChanges([
      ...this.getOptionValueCellChanges(target, removedValues, renameValues),
      ...(
        options.setValue && options.currentRow
          ? [this.createCurrentCellChange(options.currentRow, target, options.value)]
          : []
      ),
    ]);
    target.statusOptions = normalizedNext;
    target.statusPresetId = target.type === "status" ? options.presetId : undefined;
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

  private normalizeOptionDefsForColumn(col: ColumnDef, options: StatusOptionDef[]): StatusOptionDef[] {
    const normalized: StatusOptionDef[] = [];
    const seen = new Set<string>();
    for (const option of options || []) {
      const value = normalizeOptionValueForKey(col.key, option.value);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      normalized.push({ ...option, value });
    }
    return normalized;
  }

  private normalizeFileTagColorOptions(options: StatusOptionDef[]): StatusOptionDef[] {
    const normalized: StatusOptionDef[] = [];
    const seen = new Set<string>();
    for (const option of options || []) {
      const value = normalizeValidObsidianTagValue(option.value);
      if (!value || seen.has(value)) continue;
      const color = option.color || "gray";
      if (color === "gray") continue;
      seen.add(value);
      normalized.push({ value, color });
    }
    return normalized;
  }

  private getOptionValuesForColumn(col: ColumnDef): string[] {
    return this.normalizeOptionDefsForColumn(col, col.statusOptions || []).map((option) => option.value);
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
        const values = toMultiSelectValuesForKey(col.key, oldValue);
        const normalized: string[] = [];
        for (const value of values) {
          const nextValue = renameMap.get(value) || value;
          if (removedValues.has(nextValue) || normalized.includes(nextValue)) continue;
          normalized.push(nextValue);
        }
        if (this.areCellValuesEqual(values, normalized)) continue;
        newValue = normalized;
      } else {
        const current = safeString(oldValue);
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
    const entry = this.getCurrentEntry();
    if (!config || !entry) return;
    const computedKey = col.computedKey || col.key;
    const computedField = config.schema.computedFields.find((field) => field.key === computedKey);
    const baseThisFile = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    const baseThisFrontmatter = baseThisFile instanceof TFile
      ? this.app.metadataCache.getFileCache(baseThisFile)?.frontmatter
      : undefined;
    new FormulaModal(this.app, col, computedField, this.rows, config.schema.columns, normalizeComputedSyncMode(entry.config.computedSyncMode), async (result) => {
      await this.saveFormula(entry, config, col, result);
    }, baseThisFile instanceof TFile ? baseThisFile : undefined, baseThisFrontmatter).open();
  }

  private showComputedFrontmatterCleanupModal(): void {
    const config = this.getConfig();
    const db = this.getCurrentEntry()?.config;
    if (!config || !db) return;
    const records = this.dataSource.getRecordsForDatabase(this.getEffectiveConfig(db, config));
    const options = getComputedFrontmatterCleanupOptions(config.schema.columns, records);
    if (options.length === 0) {
      new Notice(t("viewConfig.computedCleanup.noFields"));
      return;
    }
    new ComputedFrontmatterCleanupModal(this.app, options, async (keys) => {
      await this.clearComputedFrontmatterProperties(keys);
    }).open();
  }

  private async clearComputedFrontmatterProperties(keys: string[]): Promise<void> {
    const config = this.getConfig();
    const db = this.getCurrentEntry()?.config;
    const uniqueKeys = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)));
    if (!config || !db || uniqueKeys.length === 0) return;
    try {
      if (normalizeComputedSyncMode(db.computedSyncMode) === "automatic") {
        // Cancel any already queued automatic sync so the cleanup cannot be immediately recreated.
        if (this.computedSyncTimer !== null) {
          window.clearTimeout(this.computedSyncTimer);
          this.computedSyncTimer = null;
        }
        db.computedSyncMode = "display-only";
        this.scheduleConfigSave();
        this.rerenderToolbar();
      }
      const records = this.dataSource.getRecordsForDatabase(this.getEffectiveConfig(db, config));
      let changed = 0;
      for (const record of records) {
        const updates: Record<string, null> = {};
        for (const key of uniqueKeys) {
          if (!Object.prototype.hasOwnProperty.call(record.frontmatter, key)) continue;
          updates[key] = null;
        }
        if (Object.keys(updates).length === 0) continue;
        await this.dataSource.updateFrontmatter(record.file, updates);
        changed += 1;
      }
      new Notice(t("notice.clearedComputedFrontmatter", { key: uniqueKeys.join(", "), count: changed }));
      await this.refreshAfterSave();
    } catch (err) {
      console.error("Note Database: failed to clear computed frontmatter", err);
      new Notice(t("errors.updateFailed", { error: String(err) }));
    }
  }

  private async saveFormula(entry: ViewEntry, config: ViewConfig, col: ColumnDef, result: FormulaSaveResult): Promise<void> {
    col.type = "computed";
    col.computedKey = col.computedKey || col.key;
    const existing = config.schema.computedFields.find((field) => field.key === col.computedKey);
    if (existing) {
      existing.label = col.label;
      existing.expression = result.expression;
      existing.type = result.resultType;
      existing.expressionSyntax = result.expressionSyntax;
    } else {
      config.schema.computedFields.push({
        key: col.computedKey,
        label: col.label,
        expression: result.expression,
        type: result.resultType,
        expressionSyntax: result.expressionSyntax,
      });
    }
    this.pendingUndoLabel = t("undo.formulaConfig");
    await this.saveViewEntryConfig(entry, {
      dbId: entry.config.id,
      dbPath: entry.sourcePath,
      viewId: config.id,
      sourceInstanceId: this.instanceId,
    });
    await this.syncComputedFieldsNow(false, config, this.cloneDatabaseConfig(this.getEffectiveConfig(entry.config, config)));
    if (this.getCurrentEntry()?.sourcePath === entry.sourcePath) this.refresh();
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
      window.clearTimeout(this.configSaveTimer);
      this.configSaveTimer = null;
    }
    const pending = this.pendingConfigSave;
    if (pending) {
      this.pendingConfigSave = null;
      await this.saveViewEntryConfig(pending.entry, pending.mutation, pending);
      return;
    }
    await this.saveCurrentViewConfig();
  }

  private saveConfigImmediatelyInBackground(): void {
    void this.saveConfigImmediately().catch((err) => this.reportConfigSaveFailure(err));
  }

  private saveCurrentViewConfigInBackground(mutationOverride?: ViewConfigMutation): void {
    void this.saveCurrentViewConfig(mutationOverride).catch((err) => this.reportConfigSaveFailure(err));
  }

  private reportConfigSaveFailure(err: unknown): void {
    console.error("Note Database: failed to save view config", err);
    new Notice(t("errors.saveViewConfigFailed", { error: String(err) }));
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
    await this.saveViewEntryConfig(entry, mutation);
  }

  private async saveViewEntryConfig(entry: ViewEntry, mutation?: ViewConfigMutation, metadata?: ConfigSaveMetadata): Promise<void> {
    this.recordConfigHistory(entry, mutation?.viewId, metadata);
    const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    if (file instanceof TFile) {
      this.suppressDataReload(2500);
      await this.dataSource.updateViewDefFile(file, entry.config, mutation);
    }
    this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
    this.updateUndoAction();
  }

  private recordConfigHistory(entry: ViewEntry, viewId?: string, metadata?: ConfigSaveMetadata): void {
    if (this.applyingHistory) return;
    const key = this.getConfigHistoryKey(entry);
    const before = this.configSnapshots.get(key);
    if (!before) {
      this.configSnapshots.set(key, this.cloneDatabaseConfig(entry.config));
      if (!metadata) this.pendingConfigCellChanges = null;
      return;
    }
    const after = this.cloneDatabaseConfig(entry.config);
    const cellChanges = (metadata?.cellChanges || this.pendingConfigCellChanges)?.map((change) => this.cloneCellChange(change)) || [];
    if (!metadata) this.pendingConfigCellChanges = null;
    if (JSON.stringify(before) === JSON.stringify(after) && cellChanges.length === 0) return;
    const label = metadata?.undoLabel || this.pendingUndoLabel || t("undo.viewConfig");
    if (!metadata) this.pendingUndoLabel = null;
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

  private consumePendingConfigMetadata(): ConfigSaveMetadata {
    const metadata: ConfigSaveMetadata = {
      undoLabel: this.pendingUndoLabel,
      cellChanges: this.pendingConfigCellChanges?.map((change) => this.cloneCellChange(change)) || null,
    };
    this.pendingUndoLabel = null;
    this.pendingConfigCellChanges = null;
    return metadata;
  }

  private mergeConfigSaveMetadata(existing: ConfigSaveMetadata, next: ConfigSaveMetadata): ConfigSaveMetadata {
    return {
      undoLabel: next.undoLabel || existing.undoLabel,
      cellChanges: [
        ...(existing.cellChanges || []),
        ...(next.cellChanges || []),
      ],
    };
  }

  /** Debounced config save: batch rapid changes (drag, resize) into one write */
  private scheduleConfigSave(): void {
    // Protect in-memory config mutations immediately. Frontmatter writes can emit
    // metadata events before the debounced view-definition write reaches disk.
    this.suppressDataReload(2500);
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const metadata = this.consumePendingConfigMetadata();
    const mutation = this.getCurrentMutationTarget();
    if (this.pendingConfigSave && this.pendingConfigSave.entry !== entry) {
      const pending = this.pendingConfigSave;
      void this.saveViewEntryConfig(pending.entry, pending.mutation, pending).catch((err) => {
        console.error("Note Database: failed to save view config", err);
        new Notice(t("errors.saveViewConfigFailed", { error: String(err) }));
      });
      this.pendingConfigSave = null;
    }
    this.pendingConfigSave = this.pendingConfigSave
      ? {
        ...this.pendingConfigSave,
        mutation,
        ...this.mergeConfigSaveMetadata(this.pendingConfigSave, metadata),
      }
      : { entry, mutation, ...metadata };
    if (this.configSaveTimer !== null) {
      window.clearTimeout(this.configSaveTimer);
    }
    this.configSaveTimer = window.setTimeout(() => {
      this.configSaveTimer = null;
      const pending = this.pendingConfigSave;
      this.pendingConfigSave = null;
      if (!pending) return;
      this.saveViewEntryConfig(pending.entry, pending.mutation, pending).catch((err) => {
        console.error("Note Database: failed to save view config", err);
        new Notice(t("errors.saveViewConfigFailed", { error: String(err) }));
      });
    }, 300);
  }

  private render(): void {
    this.applyDisplayWidth();
    this.containerEl_?.toggleClass("has-selection-status", false);
    if (!this.hasActiveDatabase()) {
      this.applyViewTypeClass("table");
      this.renderEmptyDashboard();
      return;
    }
    const config = this.getConfig();
    const dbConfig = this.getActiveDb();
    this.applyViewTypeClass(config.viewType || "table");
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
      // Auto-init of manual ranks must not create an undo history entry.
      // Write directly instead of going through scheduleConfigSave → recordConfigHistory,
      // and keep the config snapshot in sync so the next config save won't diff
      // against a stale snapshot and create a spurious undo entry.
      const entry = this.getCurrentEntry();
      if (entry) {
        this.suppressDataReload(2500);
        const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
        if (file instanceof TFile) {
          void this.dataSource.updateViewDefFile(file, entry.config).catch((err) => {
            console.error("Note Database: failed to persist auto-init manual ranks", err);
          });
        }
        this.configSnapshots.set(
          this.getConfigHistoryKey(entry),
          this.cloneDatabaseConfig(entry.config)
        );
      }
    }
    const pipelineConfig = config.viewType === "chart" ? { ...config, manualOrder: undefined } : config;
    this.rows = this.rowPipeline.build(records, this.withBaseThisContext(pipelineConfig), this.vs(), this.app);
    this.scheduleComputedSync(config, this.rows);

    if (config.viewType !== "chart") this.renderSummary(config);

    if (config.viewType === "board") {
      this.renderBoard(config);
    } else if (config.viewType === "gallery") {
      this.renderGallery(config);
    } else if (config.viewType === "list") {
      this.renderList(config);
    } else if (config.viewType === "chart") {
      this.renderChart(config);
    } else if (this.vs().groupByField) {
      this.renderGroupedTable(config, this.vs().groupByField);
    } else {
      this.renderTable(config);
    }
    if (config.viewType === "chart") this.renderSummary(config);
    this.renderSelectionStatusBar();
    // Clear pending-show flags after one render cycle
    this.pendingShowColumns.clear();
    this.applyPendingColumnHighlight();
    this.revealPendingNewRow();
  }

  private renderEmptyDashboard(): void {
    const empty = this.containerEl_?.createDiv({ cls: "db-empty db-empty-dashboard" });
    empty?.createDiv({ cls: "db-empty-title", text: t("empty.noDatabases") });
    const button = empty?.createEl("button", {
      cls: "mod-cta db-empty-action",
      text: t("empty.createFirstDatabase"),
    });
    button?.addEventListener("click", () => {
      void this.addDatabase();
    });
  }

  private renderSummary(config?: ViewConfig): void {
    if (!this.containerEl_) return;
    const viewConfig = config || this.getConfig();
    const isChart = viewConfig.viewType === "chart";
    this.summaryRenderer.render(
      this.containerEl_,
      this.rows,
      viewConfig,
      this.getActiveDb(),
      {
        placement: isChart ? "after-chart" : undefined,
        onChange: () => {
          this.scheduleConfigSave();
          this.refresh();
        },
      }
    );
  }

  private getChartExportFilename(config: ViewConfig): string {
    const dbName = this.getActiveDb()?.name || "database";
    return `${dbName}-${config.name || "chart"}`.replace(/[\\/:*?"<>|]+/g, "-");
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
    window.requestAnimationFrame(() => input.focus());
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
    const rules = (config.sourceRules || []).filter((rule) => (
      !sourceFolder ||
      rule.op !== "inFolder" ||
      this.normalizeVaultFolder(String(rule.value ?? "")) !== sourceFolder
    ));
    const sourceRuleTree = getSourceRuleTree(config.sourceRuleTree, rules, config.sourceLogic);
    if (!sourceRuleTree) return true;
    return matchesSourceRuleTree(
      sourceRuleTree,
      (rule) => this.pendingRecordMatchesRule(record, rule, config),
      (rule) => {
        try {
          return evaluateBaseFilterExpression(rule.expression, {
            app: this.app,
            file: record.file,
            frontmatter: record.frontmatter,
            computedFields: config.schema.computedFields,
            columns: config.schema.columns,
          });
        } catch {
          return false;
        }
      }
    );
  }

  /** Mirrors DataSource source-rule checks for pending records before metadata cache catches up. */
  private pendingRecordMatchesRule(record: NoteRecord, rule: NonNullable<DatabaseConfig["sourceRules"]>[number], config: DatabaseConfig): boolean {
    const expected = String(rule.value ?? "");
    const columns = config.schema.columns;
    const value = this.getPendingSourceField(record, rule.field, config);
    if (rule.op === "inFolder") {
      const folder = this.normalizeVaultFolder(expected);
      return !folder || folder === "/" || record.file.path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
    }
    if (rule.op === "hasTag") {
      return hasObsidianTagValue(toMultiSelectValuesForKey("tags", record.frontmatter["tags"]), expected);
    }
    if (rule.op === "hasProperty") return Object.prototype.hasOwnProperty.call(record.frontmatter, rule.field);
    if (rule.op === "hasLink") return fileHasLink(this.app, record.file, expected, this.app.metadataCache.getFileCache(record.file));
    if (rule.op === "eq") return this.baseSourceValuesEqual(value, rule, columns);
    if (rule.op === "neq") return !this.baseSourceValuesEqual(value, rule, columns);
    if (rule.op === "strictEq") return sourceRuleValuesStrictEqual(value, rule);
    if (rule.op === "strictNeq") return !sourceRuleValuesStrictEqual(value, rule);
    if (rule.op === "contains") return sourceRuleContainsValue(value, rule);
    if (rule.op === "startsWith") return this.matchesStringSourceRuleValue(value, (text) => text.startsWith(expected));
    if (rule.op === "endsWith") return this.matchesStringSourceRuleValue(value, (text) => text.endsWith(expected));
    if (rule.op === "matches") {
      const regex = this.parseSourceRuleRegex(expected);
      return regex ? this.matchesStringSourceRuleValue(value, (text) => {
        regex.lastIndex = 0;
        return regex.test(text);
      }) : false;
    }
    if (rule.op === "isType") return matchesBaseSourceType(value, expected, rule.field, columns, config.schema.computedFields);
    if (rule.op === "gt") return compareSourceRuleValue(value, rule, columns, (result) => result > 0);
    if (rule.op === "gte") return compareSourceRuleValue(value, rule, columns, (result) => result >= 0);
    if (rule.op === "lt") return compareSourceRuleValue(value, rule, columns, (result) => result < 0);
    if (rule.op === "lte") return compareSourceRuleValue(value, rule, columns, (result) => result <= 0);
    if (rule.op === "empty") return this.isBaseSourceEmptyValue(value);
    if (rule.op === "notempty") return !this.isBaseSourceEmptyValue(value);
    if (rule.op === "truthy") return Boolean(value);
    return true;
  }

  private getPendingSourceField(record: NoteRecord, field: string, config: DatabaseConfig): unknown {
    if (field.startsWith("formula.")) {
      const key = field.slice("formula.".length);
      if (!config.schema.computedFields.some((computed) => computed.key === key)) return undefined;
      return evaluateComputedFields(
        config.schema.computedFields,
        config.schema.columns,
        record.frontmatter,
        this.getBaseComputedEvaluationContext(record.file, config)
      )[key];
    }
    return field.startsWith("file.")
      ? this.getPendingFileField(record, field)
      : record.frontmatter[field];
  }

  private isBaseSourceEmptyValue(value: unknown): boolean {
    if (value == null || value === "") return true;
    if (typeof value === "number") return !Number.isFinite(value);
    if (Array.isArray(value)) return value.length === 0;
    if (value instanceof Date) return !Number.isFinite(value.getTime());
    if (value && typeof value === "object") return Object.keys(value).length === 0;
    return false;
  }

  private baseSourceValuesEqual(value: unknown, rule: SourceRule, columns?: ColumnDef[]): boolean {
    if (Array.isArray(value)) return value.length === 1 && this.baseSourceScalarValuesEqual(value[0], rule, columns);
    return this.baseSourceScalarValuesEqual(value, rule, columns);
  }

  private baseSourceScalarValuesEqual(value: unknown, rule: SourceRule, columns?: ColumnDef[]): boolean {
    const expected = String(rule.value ?? "");
    if (this.shouldCompareSourceRuleAsDate(rule, columns)) {
      const leftDate = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(String(value));
      const rightDate = Date.parse(expected);
      if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate === rightDate;
    }
    if (rule.valueType) return sourceRuleValuesLooseEqual(value, rule);
    return safeString(value) === expected;
  }

  private shouldCompareSourceRuleAsDate(rule: SourceRule, columns?: ColumnDef[]): boolean {
    if (rule.valueType === "date") return true;
    return isBaseFileField(rule.field) && getBaseFileFieldType(rule.field) === "date";
  }

  private matchesStringSourceRuleValue(value: unknown, predicate: (text: string) => boolean): boolean {
    const values = Array.isArray(value) ? value : [value];
    return values.some((item) => {
      if (item == null) return false;
      const text = String(item);
      return text.length <= MAX_SOURCE_RULE_MATCH_TEXT_LENGTH && predicate(text);
    });
  }

  private parseSourceRuleRegex(expected: string): RegExp | undefined {
    const literal = expected.match(/^\/((?:\\.|[^/\\\n])*)\/([a-z]*)$/);
    try {
      return literal ? new RegExp(literal[1], literal[2]) : new RegExp(expected);
    } catch {
      return undefined;
    }
  }

  /** Read file.* values used by source rules for an optimistic pending row. */
  private getPendingFileField(record: NoteRecord, field: string): unknown {
    return getFileFieldValue(
      record.file,
      field,
      record.frontmatter,
      this.app.metadataCache.getFileCache(record.file),
      this.app
    );
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

    window.requestAnimationFrame(() => {
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

  private revealPendingColumn(): void {
    const key = this.pendingRevealColumnKey;
    if (!key || !this.containerEl_) return;

    const elements = this.findRenderedColumnElements(key);
    const target = elements.find((element) => element.matches("th")) || elements[0];
    if (!target) return;

    if (!this.pendingRevealColumnScrolled) {
      target.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      this.pendingRevealColumnScrolled = true;
    }
    this.applyPendingColumnHighlight();
  }

  private applyPendingColumnHighlight(): void {
    const key = this.pendingRevealColumnKey;
    if (!key || !this.containerEl_) return;
    if (Date.now() > this.pendingRevealColumnUntil) {
      this.clearPendingColumnHighlight();
      return;
    }

    for (const element of this.findRenderedColumnElements(key)) {
      element.addClass("is-new-column-highlight");
    }

    if (this.pendingRevealColumnTimer === null) {
      this.pendingRevealColumnTimer = window.setTimeout(() => {
        this.pendingRevealColumnTimer = null;
        this.clearPendingColumnHighlight();
      }, Math.max(0, this.pendingRevealColumnUntil - Date.now()));
    }
  }

  private clearPendingColumnHighlight(): void {
    const key = this.pendingRevealColumnKey;
    if (this.containerEl_ && key) {
      for (const element of this.findRenderedColumnElements(key)) {
        element.removeClass("is-new-column-highlight");
      }
    }
    this.pendingRevealColumnKey = undefined;
    this.pendingRevealColumnUntil = 0;
    this.pendingRevealColumnScrolled = false;
    if (this.pendingRevealColumnTimer !== null) {
      window.clearTimeout(this.pendingRevealColumnTimer);
      this.pendingRevealColumnTimer = null;
    }
  }

  private findRenderedColumnElements(key: string): HTMLElement[] {
    if (!this.containerEl_) return [];
    const selector = `[data-note-database-column-key="${CSS.escape(key)}"]`;
    return Array.from(this.containerEl_.querySelectorAll<HTMLElement>(selector))
      .filter((element) => !element.matches("col"));
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
      window.clearTimeout(this.pendingNewRevealTimer);
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
    if (col.type === "computed") return false;
    if (!isFileFieldKey(col.key)) return true;
    return col.key === "file.tags";
  }

  private async saveCellValueWithHistory(row: RowData, col: ColumnDef, value: unknown): Promise<void> {
    if (!this.canFillColumn(col)) return;
    const invalidTags = this.getInvalidFileTagValues(col, value);
    if (invalidTags.length > 0) {
      this.showInvalidFileTagsNotice(invalidTags);
      return;
    }
    const change = this.createCellChange(row, col, value);
    if (this.areCellValuesEqual(change.oldValue, change.newValue)) return;
    if (this.canApplyCellChangeOptimistically(col)) {
      await this.applyCellChangeOptimistically(change, t("undo.editCell"));
      return;
    }
    await this.applyCellChanges([change], t("undo.editCell"));
  }

  private canApplyCellChangeOptimistically(col: ColumnDef): boolean {
    if (col.type === "computed" || isFileFieldKey(col.key)) return false;
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

    const newTd = window.activeDocument.createElement("td");
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
      const element = window.activeDocument.elementFromPoint(clientX, clientY) as HTMLElement | null;
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
      window.activeDocument.removeEventListener("mousemove", onMove, true);
      window.activeDocument.removeEventListener("mouseup", onUp, true);
      sourceCell.removeClass("is-fill-source");
      const plan = this.getFillTargetPlan(targetCells);
      clearTargets();
      if (plan.targets.length > 0) void this.applyTableFill(plan, sourceValue);
      else if (plan.skipped > 0) new Notice(t("notice.noEditableCellsSkipped", { skipped: plan.skipped }));
    };
    window.activeDocument.addEventListener("mousemove", onMove, true);
    window.activeDocument.addEventListener("mouseup", onUp, true);
    updateTargets(event.clientX, event.clientY);
  }

  private getTableFillRange(sourceCell: HTMLElement, targetCell: HTMLElement, tbody: Element): HTMLElement[] {
    if (sourceCell === targetCell) return [];
    const rows = Array.from(tbody.querySelectorAll<HTMLElement>("tr[data-note-database-row-path]"));
    const sourceRow = sourceCell.closest("tr");
    const targetRow = targetCell.closest("tr");
    const sourceIndex = sourceRow ? rows.indexOf(sourceRow) : -1;
    const targetIndex = targetRow ? rows.indexOf(targetRow) : -1;
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
    if (col.key === "file.tags") return toValidObsidianTagValues(row.frontmatter["tags"]);
    if (col.type === "checkbox") return toBooleanValue(row.frontmatter[col.key]);
    return row.frontmatter[col.key] ?? null;
  }

  private cloneFillValue(value: unknown): unknown {
    if (Array.isArray(value)) return [...(value as unknown[])];
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
    return this.cloneCellChange(change);
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
      let skipped = plan.skipped;
      for (const target of plan.targets) {
        const invalidTags = this.getInvalidFileTagValues(target.col, value);
        if (invalidTags.length > 0) {
          skipped += 1;
          this.showInvalidFileTagsNotice(invalidTags);
          continue;
        }
        changes.push(this.createCellChange(target.row, target.col, this.cloneFillValue(value)));
      }
      if (changes.length === 0) return;
      await this.applyCellChanges(changes, t("undo.fillCells"));
      this.showBatchNotice("filled", changes.length, skipped);
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
    const changes: CellEditChange[] = [];
    let skipped = plan.skipped;
    for (const target of plan.targets) {
      const invalidTags = this.getInvalidFileTagValues(target.col, input);
      if (invalidTags.length > 0) {
        skipped += 1;
        this.showInvalidFileTagsNotice(invalidTags);
        continue;
      }
      changes.push(this.createCellChange(target.row, target.col, this.normalizeBatchInputValue(target.col, input)));
    }
    if (changes.length === 0) return;
    await this.applyCellChanges(changes, t("undo.fillCells"));
    this.showCellFillInput = false;
    this.showBatchNotice("filled", changes.length, skipped);
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
    const changes: CellEditChange[] = [];
    let skipped = plan.skipped;
    for (const target of plan.targets) {
      const invalidTags = this.getInvalidFileTagValues(target.col, target.value);
      if (invalidTags.length > 0) {
        skipped += 1;
        this.showInvalidFileTagsNotice(invalidTags);
        continue;
      }
      changes.push(this.createCellChange(target.row, target.col, this.normalizeBatchInputValue(target.col, target.value)));
    }
    if (changes.length === 0) return;
    await this.applyCellChanges(changes, t("undo.pasteCells"));
    this.showBatchNotice("pasted", changes.length, skipped);
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
    if (plan.targets.length > 20 && !await confirmWithModal(this.app, {
      title: t("common.delete"),
      message: t("confirm.clearCells", { count: plan.targets.length }),
      confirmText: t("common.delete"),
      danger: true,
    })) return;
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
    if (col.key === "file.tags") return toValidObsidianTagValues(input);
    if (col.type === "number" || col.type === "currency") {
      const parsed = Number(input);
      return Number.isFinite(parsed) ? parsed : input;
    }
    if (col.type === "checkbox") return toBooleanValue(input);
    if (col.type === "multi-select") {
      return toMultiSelectValuesForKey(col.key, input);
    }
    return input;
  }

  private createCellChange(row: RowData, col: ColumnDef, newValue: unknown): CellEditChange {
    const key = this.getFrontmatterWriteKey(col);
    const oldExists = Object.prototype.hasOwnProperty.call(row.frontmatter, key);
    return {
      file: row.file,
      path: row.file.path,
      key,
      oldValue: this.cloneFillValue(row.frontmatter[key]),
      oldExists,
      newValue: this.cloneFillValue(this.normalizeCellValueForChange(col, newValue)),
    };
  }

  private createCurrentCellChange(row: RowData, col: ColumnDef, newValue: unknown): CellEditChange {
    // Option popovers can survive a refresh after grouped rows move, so re-read the latest value by file path.
    const record = this.getRecordsForActiveDatabase().find((candidate) => candidate.file.path === row.file.path);
    const frontmatter = record?.frontmatter || row.frontmatter;
    const key = this.getFrontmatterWriteKey(col);
    const oldExists = Object.prototype.hasOwnProperty.call(frontmatter, key);
    return {
      file: row.file,
      path: row.file.path,
      key,
      oldValue: this.cloneFillValue(frontmatter[key]),
      oldExists,
      newValue: this.cloneFillValue(this.normalizeCellValueForChange(col, newValue)),
    };
  }

  private getFrontmatterWriteKey(col: ColumnDef): string {
    return col.key === "file.tags" ? "tags" : col.key;
  }

  private normalizeCellValueForChange(col: ColumnDef, value: unknown): unknown {
    if (value == null) return value;
    if (col.key === "file.tags") return toValidObsidianTagValues(value);
    if (col.type === "multi-select") return toMultiSelectValuesForKey(col.key, value);
    if (col.type === "select" || col.type === "status") return normalizeOptionValueForKey(col.key, value);
    return value;
  }

  private async applyCellChanges(changes: CellEditChange[], label: string): Promise<void> {
    const effectiveChanges = changes.filter((change) => change.key !== "file.name" && !isReadonlyFileField(change.key));
    if (effectiveChanges.length === 0) return;
    const updatesByPath = new Map<string, { file: TFile; updates: Record<string, unknown> }>();
    for (const change of effectiveChanges) {
      const entry = updatesByPath.get(change.path) || { file: change.file, updates: {} };
      entry.updates[change.key] = change.newValue;
      updatesByPath.set(change.path, entry);
    }
    const appliedChanges: CellEditChange[] = [];
    for (const entry of updatesByPath.values()) {
      const pathChanges = effectiveChanges.filter((change) => change.path === entry.file.path);
      try {
        await this.dataSource.updateFrontmatter(entry.file, entry.updates);
      } catch (err) {
        if (appliedChanges.length > 0) {
          this.pushHistory({ type: "cells", label, changes: appliedChanges });
          this.clearCellSelection();
          await this.refreshAfterSave();
          this.rerenderToolbar();
        }
        throw err;
      }
      appliedChanges.push(...pathChanges);
    }
    this.pushHistory({ type: "cells", label, changes: appliedChanges });
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
    this.clearCellSelection();
    await this.refreshAfterSave();
    this.rerenderToolbar();
  }

  private getInvalidFileTagValues(col: ColumnDef, value: unknown): string[] {
    if (col.key !== "file.tags" || value == null || value === "") return [];
    return getInvalidObsidianTagValues(value);
  }

  private showInvalidFileTagsNotice(tags: string[]): void {
    if (tags.length === 0) return;
    new Notice(t("fileField.invalidTag", { tag: tags[0] }));
  }

  private pushHistory(entry: HistoryEntry): void {
    this.historyStack.unshift(entry);
    if (this.historyStack.length > 15) this.historyStack.length = 15;
    this.updateUndoAction();
  }

  async undoLastEdit(): Promise<void> {
    const entry = this.historyStack[0];
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
      this.historyStack.shift();
      new Notice(t("notice.undone", { action: entry.label }));
    } catch (err) {
      console.error("Note Database: failed to undo edit", err);
      new Notice(t("errors.updateFailed", { error: String(err) }));
    } finally {
      this.applyingHistory = false;
      this.updateUndoAction();
    }
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

  private renderChart(config: ViewConfig): void {
    if (!this.containerEl_) return;
    this.chartRenderer.render(this.containerEl_, this.getStatefulConfig(config), this.rows, config.schema.columns, {
      onFilter: (rules) => this.applyChartFilters(config, rules),
      onConfigChange: () => {
        this.scheduleConfigSave();
        this.renderChart(config);
      },
    });
  }

  private applyChartFilters(config: ViewConfig, rules: FilterRule[]): void {
    if (rules.length === 0) return;
    const state = this.vs();
    let changed = false;
    for (const rule of rules) {
      if (state.filters.some((existing) => filtersEqual(existing, rule))) continue;
      state.filters.push(rule);
      changed = true;
    }
    if (!changed) return;
    state.filterLogic = "and";
    this.pendingUndoLabel = t("undo.filterConfig");
    this.viewStateStore.persist(config, state);
    this.scheduleConfigSave();
    this.rerenderToolbar();
    this.refresh();
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
      const optionValues = col ? this.getOptionValuesForColumn(col) : [];
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
        toMultiSelectValuesForKey(field, row.frontmatter[field]),
        fromValue == null ? fromValue : normalizeOptionValueForKey(field, fromValue),
        normalizeOptionValueForKey(field, toValue),
        this.getOptionValuesForColumn(col)
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
    config.columnWidths = { ...(config.columnWidths || {}), [col.key]: this.calculateAutoColumnWidth(col, this.rows) };
    this.pendingUndoLabel = t("undo.columnWidthConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private autoFitAllColumns(): void {
    const config = this.getConfig();
    if (!config) return;
    const nextWidths = { ...(config.columnWidths || {}) };
    for (const col of getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns)) {
      nextWidths[col.key] = this.calculateAutoColumnWidth(col, this.rows);
    }
    config.columnWidths = nextWidths;
    this.pendingUndoLabel = t("undo.columnWidthConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private calculateAutoColumnWidth(col: ColumnDef, rows: RowData[]): number {
    return estimateAutoColumnWidth(col, rows, (row, column) => this.getColumnDisplayText(row, column));
  }

  private getColumnDisplayText(row: RowData, col: ColumnDef): string {
    if (col.key === "file.name") return this.getFileDisplayName(row);
    const value = isBaseFileField(col.key)
      ? getRowFileFieldValue(row, col.key)
      : col.type === "computed" && col.computedKey
        ? row.computed[col.computedKey]
        : row.frontmatter[col.key];
    if (value == null) return "";
    if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, value).join(", ");
    if (Array.isArray(value)) return value.map((entry) => String(entry)).join(", ");
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return safeString(value);
      }
    }
    return safeString(value);
  }

  /** Refresh after waiting for metadata cache to catch up */
  private async refreshAfterSave(): Promise<void> {
    // Yield to event loop so metadata cache can re-parse after processFrontMatter
    await new Promise(resolve => window.setTimeout(resolve, 0));
    this.refresh();
  }

  private async syncComputedForFile(
    file: TFile,
    frontmatter: Record<string, unknown>,
    affectedFields?: string[],
    config = this.getConfig()
  ): Promise<void> {
    if (!config?.schema.computedFields.length || !this.isAutomaticComputedSync()) return;

    const computed = evaluateComputedFields(
      config.schema.computedFields,
      config.schema.columns,
      frontmatter,
      this.getBaseComputedEvaluationContext(file, config)
    );

    const computedColumns = config.schema.columns.filter(col => col.type === "computed");
    const updates: Record<string, unknown> = {};

    for (const col of computedColumns) {
      if (affectedFields?.length) {
        const deps = ComputedFieldEngine.extractDependencies(
          config.schema.computedFields.find(cf => cf.key === (col.computedKey || col.key))?.expression || ""
        );
        const allRelevant = [...affectedFields, ...computedColumns.flatMap(c => [c.key, getComputedStorageKey(c)])];
        if (!deps.some(d => allRelevant.includes(d))) continue;
      }
      const key = getComputedStorageKey(col);
      const value = computed[key];
      const nextValue = value == null ? "" : value;
      if (safeString(frontmatter[key]) !== safeString(nextValue)) {
        updates[key] = nextValue;
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.dataSource.updateFrontmatter(file, updates);
    }
  }

  private scheduleComputedSync(config: ViewConfig, rows: RowData[]): void {
    if (this.computedSyncTimer !== null) window.clearTimeout(this.computedSyncTimer);
    this.computedSyncTimer = null;
    if (config.schema.computedFields.length === 0 || !this.isAutomaticComputedSync()) return;
    const entry = this.getCurrentEntry();
    const syncConfig = JSON.parse(JSON.stringify(config)) as ViewConfig;
    const recordConfig = entry
      ? this.cloneDatabaseConfig(this.getEffectiveConfig(entry.config, config))
      : undefined;
    const sourcePath = entry?.sourcePath;
    this.computedSyncTimer = window.setTimeout(() => {
      this.computedSyncTimer = null;
      if (sourcePath && this.getCurrentEntry()?.sourcePath !== sourcePath) return;
      void this.syncComputedFieldsNow(false, syncConfig, recordConfig, rows).catch((err) => {
        console.error("Note Database: failed to sync computed fields", err);
        new Notice(t("errors.updateFailed", { error: String(err) }));
      });
    }, 5000);
  }

  private async syncComputedFieldsNow(
    notify: boolean,
    config = this.getConfig(),
    recordConfig?: DatabaseConfig,
    fallbackRows: RowData[] = this.rows,
    force = false
  ): Promise<void> {
    if (!config || this.syncingComputed) return;
    const activeDb = recordConfig || this.getCurrentEntry()?.config;
    if (!force && !this.isAutomaticComputedSync(activeDb)) return;
    this.syncingComputed = true;
    try {
      const computedColumns = config.schema.columns.filter((col) => col.type === "computed");
      const db = activeDb;
      const records = db ? this.dataSource.getRecordsForDatabase(recordConfig || this.getEffectiveConfig(db, config)) : fallbackRows.map((row) => ({
        file: row.file,
        frontmatter: row.frontmatter,
      }));
      let changed = 0;
      for (const record of records) {
        const computed = evaluateComputedFields(
          config.schema.computedFields,
          config.schema.columns,
          record.frontmatter,
          this.getBaseComputedEvaluationContext(record.file, recordConfig || config)
        );
        const updates: Record<string, unknown> = {};
        for (const col of computedColumns) {
          const key = getComputedStorageKey(col);
          const value = computed[key];
          const nextValue = value == null ? "" : value;
          if (safeString(record.frontmatter[key]) !== safeString(nextValue)) {
            updates[key] = nextValue;
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

  private isAutomaticComputedSync(db = this.getCurrentEntry()?.config): boolean {
    return normalizeComputedSyncMode(db?.computedSyncMode) === "automatic";
  }

  private getBaseComputedEvaluationContext(file: TFile, config?: ViewConfig | DatabaseConfig): {
    app: App;
    file: TFile;
    thisFile?: TFile;
    thisFrontmatter?: Record<string, unknown>;
  } {
    const sourcePath = config?.baseThisFilePath || this.getCurrentEntry()?.sourcePath;
    const thisFile = sourcePath ? this.app.vault.getAbstractFileByPath(sourcePath) : null;
    return {
      app: this.app,
      file,
      thisFile: thisFile instanceof TFile ? thisFile : undefined,
      thisFrontmatter: thisFile instanceof TFile
        ? this.app.metadataCache.getFileCache(thisFile)?.frontmatter
        : undefined,
    };
  }

  private syncComputedFieldsManually(): void {
    void this.syncComputedFieldsNow(true, this.getConfig(), undefined, this.rows, true).catch((err) => {
      console.error("Note Database: failed to sync computed fields", err);
      new Notice(t("errors.updateFailed", { error: String(err) }));
    });
  }

  refresh(): void {
    if (!this.containerEl_) return;
    // Remove only top-level rendered results; panels manage their own contents.
    // All view types use the same cleanup selector so that render() always
    // rebuilds elements in a fixed order (summary → chart/table/…).
    this.containerEl_.querySelectorAll(
      ":scope > .db-table, :scope > .db-table-wrap, :scope > .db-grouped-table, :scope > .db-board, :scope > .db-gallery, :scope > .db-gallery-grouped, :scope > .db-gallery-total-header, :scope > .db-list, :scope > .db-list-grouped, :scope > .db-list-total-header, :scope > .db-chart, :scope > .db-chart-empty, :scope > .db-chart-number, :scope > .db-summary, :scope > .db-selection-status-bar, :scope > .db-empty"
    )
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
      : Date.parse(safeString(value));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  return safeString(value).localeCompare(expected);
}

function shouldCompareSourceRuleAsDate(rule: SourceRule, columns?: ColumnDef[]): boolean {
  if (rule.valueType === "date") return true;
  return isBaseFileField(rule.field) && getBaseFileFieldType(rule.field) === "date";
}
