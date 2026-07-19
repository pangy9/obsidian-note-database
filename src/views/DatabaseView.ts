import { App, FileView, Menu, Scope, WorkspaceLeaf, Notice, Platform, TFile, normalizePath, stringifyYaml, setIcon } from "obsidian";
import { DataChangeBatch, DataSource, NoteRecord, ViewConfigMutation } from "../data/DataSource";
import { RefreshCoordinator } from "../data/RefreshCoordinator";
import { isRefreshBlockedByDrag } from "../data/RefreshBlockers";
import { evaluateBaseFilterExpression } from "../data/BaseExpression";
import { moveDatabaseFilePath, sortDatabaseFileEntries } from "../data/DatabaseFileOrder";
import { QueryEngine } from "../data/QueryEngine";
import { PropertyService } from "../data/PropertyService";
import { ComputedFieldEngine } from "../data/ComputedField";
import { evaluateComputedFields } from "../data/ComputedEvaluator";
import { applyRangeSelection } from "../data/RangeSelection";
import { resolveViewSelection } from "../data/ViewSelection";
import {
  ensureColumnOrder,
  getColumnsInOrder,
  getVisibleColumns,
} from "../data/ColumnConfig";
import { RowPipeline } from "../data/RowPipeline";
import { buildRelationRollups } from "../data/RelationRollup";
import { ViewConfig, ColumnDef, ComputedFieldDef, RowData, DatabaseConfig, DatabaseViewType, FilterRule, GroupOrderMode, SourceRule, StatusColor, StatusOptionDef, StatusPresetDef, generateId, CreateEntryPosition, NumberDisplayStyle, NumberDisplayConfig, DateGroupMode, RowCreateContext } from "../data/types";
import {
  getDefaultCellValue as getColumnDefaultCellValue,
  getStatusPresetOptions,
  getInvalidObsidianTagValues,
  hasObsidianTagValue,
  normalizeStatusPresets,
  resolveDefaultStatusPresetId,
  isOptionColumnType,
  isColumnType,
  isComputedFieldType,
  isObsidianTagsKey,
  normalizeValidObsidianTagValue,
  normalizeOptionValueForKey,
  toBooleanValue,
  toMultiSelectValuesForKey,
  toValidObsidianTagValues,
} from "../data/ColumnTypes";
import { getDefaultGroupOrder, getEffectiveGroupOrder, mergeGroupOrder } from "../data/GroupOrder";
import { formatGroupKeyDisplay, isComputedGroupField, resolveGroupCreateDefaults } from "../data/GroupDisplay";
import { setShowEmptyGroups, setGroupExpandedCount, withEmptyOptionGroups } from "../data/GroupVisibility";
import { isEmptyGroupId, moveMultiSelectGroupValue } from "../data/MultiSelect";
import { generateRanks, rankBetween, rebalanceRanks, resolveNewEntryRankBounds } from "../data/ManualOrder";
import { CellEditSession, CellOptionTransaction, CellRenderer } from "./CellRenderer";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon, renderPropertyTypeIcon } from "./PropertyTypeIcon";
import { ColumnMenu, ColumnMenuOptions } from "./ColumnMenu";
import { ColumnHeaderController } from "./ColumnHeaderController";
import { DatabaseViewState, ViewStateStore } from "./ViewStateStore";
import { RowMenu } from "./RowMenu";
import { openDropdownMenu } from "./DropdownField";
import { openIconPickerPopover } from "./IconPickerPopover";
import { ImageFileSuggestModal } from "./ImageFileSuggestModal";
import { renderRecordIcon } from "./RecordIconRenderer";
import { resolveRecordIconField } from "../data/RecordIcon";
import { applyConditionalFormat } from "../data/ConditionalFormatting";
import { ParsedRecordTemplate, parseRecordTemplate, resolveCoreRecordTemplate } from "../data/RecordTemplate";
import { TableRenderer } from "./TableRenderer";
import {
  captureDatabaseViewport,
  DatabaseViewportRequest,
  resolveDatabaseViewportMode,
  resolveNewRecordRevealBehavior,
  restoreDatabaseViewport,
} from "./DatabaseViewport";

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
import { getDefaultEventDateField, getTimelineDayNonDateTimeColumns } from "../data/CalendarTimelineModel";
import {
  buildCalendarTimelineSearchResults,
  CalendarTimelineSearchResultItem,
  CalendarTimelineSearchResults,
  formatCalendarTimelineSearchResultDate,
} from "../data/CalendarTimelineSearchResults";
import { CalendarTimelineCreateOptions, CalendarTimelineDateChange, CalendarTimelineRenderer } from "./CalendarTimelineRenderer";
import { CalendarRenderer } from "./CalendarRenderer";
import { CalendarToolbarRenderer } from "./CalendarToolbarRenderer";
import { ColumnRenameModal, ColumnRenameResult } from "./modals/ColumnRenameModal";
import { RelationRollupConfigModal } from "./modals/RelationRollupConfigModal";
import { CreateRecordIconFieldModal } from "./modals/CreateRecordIconFieldModal";
import { DeleteDatabaseModal } from "./modals/DeleteDatabaseModal";
import { confirmWithModal } from "./modals/ConfirmModal";
import { AddDatabaseModal } from "./modals/AddDatabaseModal";
import { buildDatabaseWithInferredColumns } from "./modals/AddDatabaseFlow";
import { ComputedSyncQueue, ComputedSyncScope, normalizeComputedSyncMode } from "../data/ComputedSync";
import { getComputedFrontmatterCleanupOptions } from "../data/ComputedCleanup";
import { InvalidTimelineEventsScanner } from "../data/InvalidTimeEvents";
import { getColumnDisplayType, getComputedStorageKey, normalizeComputedStorageKey } from "../data/ColumnDisplay";
import {
  filterPropertyTypeConflictsForChange,
  findPropertyTypeConflicts,
  PropertyTypeConflictEntry,
} from "../data/PropertyTypeConflict";
import { isDateLikeColumnType, setDateDisplayMode } from "../data/DateTimeFormat";
import { getAllSourceRules, getSourceRuleTree, matchesBaseSourceType, matchesSourceRuleTree, mergeDbAndViewSourceRuleTrees, sourceRuleContainsValue, sourceRuleValuesLooseEqual, sourceRuleValuesStrictEqual } from "../data/SourceRules";
import { planCreateEntry, CreateEntryDiagnostic, CreateEntryPlan } from "../data/CreateEntryPlan";
import { planOptionRegistration } from "../data/OptionRegistration";
import { buildBulkEditImpact, buildBulkEditPlan, BulkEditImpact, BulkEditorRequest, getBulkEditableColumns, resolveBulkEditInitialValue, resolveBulkEditorRequest } from "../data/BulkEdit";
import { fileHasLink, getBaseFileFieldType, getFileFieldValue, getRowFileFieldValue, isBaseFileField, isFileFieldKey, isReadonlyFileField } from "../data/FileFields";
import { StatusOptionsModal } from "./modals/StatusOptionsModal";
import { FileTitleDisplay, getFileTitleDisplay } from "./FileTitleDisplay";
import { StatusPresetManagerModal } from "./modals/StatusPresetManagerModal";
import { FormulaModal, FormulaSaveResult } from "./modals/FormulaModal";
import { ComputedFrontmatterCleanupModal } from "./modals/ComputedFrontmatterCleanupModal";
import { InvalidTimeEventEdit, InvalidTimeEventsModal } from "./modals/InvalidTimeEventsModal";
import {
  PropertyTypeConflictChange,
  PropertyTypeConflictModal,
  PropertyTypeConflictModalResult,
} from "./modals/PropertyTypeConflictModal";
import {
  confirmNewDatabasePropertyTypeConflicts,
  MutablePropertyTypeConflictEntry,
} from "./PropertyTypeConflictWorkflow";
import { CsvMarkdownExportModal } from "./modals/CsvMarkdownExportModal";
import { CsvMarkdownExportOptions } from "../data/CsvMarkdownZipExport";
import { t } from "../i18n";
import { createStoredZip, ZipEntry } from "../data/ZipExport";
import { saveZipWithPicker } from "../data/ExportSaveTarget";
import { getEffectiveFilterRules } from "../data/FilterRules";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { estimateAutoColumnWidth } from "./ColumnWidth";
import { createRenderedTextWidthMeasurer } from "./InlineMarkdownRenderer";
import { isHTMLElement } from "./DomGuards";
import { safeString } from "../data/SafeString";
import { parseClipboardTable, serializeSelectedCells as serializeClipboardSelectedCells } from "../data/ClipboardSerializer";
import { openBulkEditFieldMenu } from "./BulkEditFieldMenu";
import { positionToolbarPopover } from "./PopoverPosition";
import { closeRecordDetailPanel, getOpenRecordDetailPath, openRecordDetailPanel, refreshRecordDetailPanel } from "./RecordDetailPanel";
import { syncTableColumnLayouts } from "./TableColumnLayoutSync";
import { highlightSearchMatches, renderSearchHighlightedText } from "./SearchHighlight";
import { isImeComposing } from "../data/KeyboardUtils";
import {
  cycleTableSelectionActiveCell,
  isTableCellAtGridEdge,
  moveTableCellByRowOffset,
  planTableSelectionFill,
  resolveTableCellNavigation,
  type TableCellAddress,
  type TableCellNavigationIntent,
  type TableGridPosition,
} from "../data/TableKeyboardNavigation";
import { getTablePasteValue, planTablePasteLayout, TablePasteLayout } from "../data/TablePastePlan";
import {
  FileRenameChange,
  FileRenameRequest,
  normalizeFileRenameBasename,
  planFileRenames,
} from "../data/FileRenamePlan";

const MAX_SOURCE_RULE_MATCH_TEXT_LENGTH = 10000;
const NEW_COLUMN_HIGHLIGHT_MS = 2200;
const MOBILE_COLUMN_WIDTH_MIN = 60;
const MOBILE_COLUMN_WIDTH_MAX = 360;
const MOBILE_COLUMN_WIDTH_PRESETS = [
  { key: "narrow", width: 100 },
  { key: "medium", width: 150 },
  { key: "wide", width: 240 },
] as const;

function filtersEqual(left: FilterRule, right: FilterRule): boolean {
  return left.field === right.field && left.op === right.op && (left.value || "") === (right.value || "");
}

function clampColumnWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

function propertyTypeChangeTargetsEntry(entry: { sourcePath: string; config: DatabaseConfig }, change: PropertyTypeConflictChange): boolean {
  if (change.databasePath) return entry.sourcePath === change.databasePath;
  return (entry.config.id || entry.sourcePath) === change.databaseId;
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

interface PasteTargetPlan extends BatchTargetPlan<FillTarget & { value: string }> {
  selection: CellSelectionRange | null;
  layout: TablePasteLayout | null;
}

interface PasteNewRowInput {
  groupDefaults: Record<string, unknown>;
  pastedDefaults: Record<string, unknown>;
  pastedCells: Array<{ col: ColumnDef; key: string; value: unknown }>;
  fileName?: string;
}

type CellAddress = TableCellAddress;

interface CellSelectionRange {
  anchor: CellAddress;
  focus: CellAddress;
  active?: CellAddress;
}

interface CellEditChange {
  file: TFile;
  path: string;
  key: string;
  oldValue: unknown;
  oldExists: boolean;
  newValue: unknown;
}

// A bulk edit that has been impact-predicted and resolved to concrete frontmatter changes,
// but not yet written. prepareBulkEdit builds it (no writes), confirmBulkEdit gates it behind
// the confirmation modal + staleness recheck, commitPreparedBulkEdit performs the writes.
interface PreparedBulkEdit {
  plan: ReturnType<typeof buildBulkEditPlan>;
  impact: BulkEditImpact;
  column: ColumnDef;
  changes: CellEditChange[];
}

interface CellHistoryEntry {
  type: "cells";
  label: string;
  changes: CellEditChange[];
  createdFiles?: CreatedFileSnapshot[];
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
  createdFiles?: CreatedFileSnapshot[];
  fileRenames?: FileRenameChange[];
}

interface CreatedFileSnapshot {
  path: string;
  content?: string;
}

interface CreatedHistoryEntry {
  type: "created";
  label: string;
  file: CreatedFileSnapshot;
}

interface PendingCellCut {
  addressKeys: Set<string>;
  clearChanges: CellEditChange[];
  clipboardText: string;
}

type HistoryEntry = CellHistoryEntry | ConfigHistoryEntry | CreatedHistoryEntry;

interface ViewEntry {
  config: DatabaseConfig;
  sourcePath: string;
}

interface ConfigSaveMetadata {
  undoLabel: string | null;
  cellChanges: CellEditChange[] | null;
  skipHistory?: boolean;
}

interface PendingConfigSave extends ConfigSaveMetadata {
  entry: ViewEntry;
  mutation?: ViewConfigMutation;
}

type HeaderPopoverKind = "filter" | "sort" | "columns" | "view";

export class DatabaseView extends FileView {
  allowNoFile = true;
  file: TFile | null = null;
  navigation = false;
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
  private mobileColumnWidthPanelCleanup?: () => void;
  private calendarTimelineRenderer = new CalendarTimelineRenderer({
    openRow: (row) => this.dataSource.openNote(row.file),
    openRecordDetail: (anchorEl, row) => this.openRecordDetailPanel(anchorEl, row),
    showRowMenu: (event, row) => this.rowMenu.show(event, row),
    createEntryForDate: (config, dateKey, options) => {
      const suppressed = this.suppressNextCreate || this.hasActiveOverlay();
      this.suppressNextCreate = false;
      if (suppressed) { this.closeActiveOverlays(); return; }
      void this.createCalendarTimelineEntry(config, dateKey, options);
    },
    updateEventDates: (row, changes) => this.updateCalendarTimelineDates(row, changes),
    reorderTimelineEvent: (row, beforePath, afterPath) => this.moveRowToPosition(row.file.path, beforePath, afterPath),
    moveTimelineEventToGroup: (row, field, fromGroupKey, toGroupKey, beforePath, afterPath) =>
      this.moveRowToGroupAndPosition(row, field, fromGroupKey, toGroupKey, beforePath, afterPath),
    isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
    toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.getConfig(), field, key, count),
    getTimelineInvalidEventCount: () => this.getTimelineInvalidEventCount(),
    openTimelineInvalidEvents: () => { void this.openInvalidEvents(); },
    updateTimelineAnchor: (dateKey, label, timeMinutes) => this.updateTimelineAnchor(dateKey, label, timeMinutes),
    updateTimelineScale: (scale, label) => this.updateTimelineScale(scale, label),
    onConfigChange: (label) => {
      this.pendingUndoLabel = label || t("undo.viewTypeConfig");
      this.scheduleConfigSave();
      this.refresh();
    },
    renderRecordIcon: (parent, row, config, compact) => this.renderRowRecordIcon(parent, row, config, compact),
    renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.getActiveDb()),
    applyConditionalFormat: (element, row, config) => applyConditionalFormat(element, row, config, this.getActiveDb()),
  });
  private calendarRenderer = new CalendarRenderer({
    openRow: (row) => this.dataSource.openNote(row.file),
    openRecordDetail: (anchorEl, row) => this.openRecordDetailPanel(anchorEl, row),
    showRowMenu: (event, row) => this.rowMenu.show(event, row),
    createEntryForDate: (config, dateKey, timeRange) => {
      const suppressed = this.suppressNextCreate || this.hasActiveOverlay();
      this.suppressNextCreate = false;
      if (suppressed) { this.closeActiveOverlays(); return; }
      void this.createCalendarTimelineEntry(config, dateKey, timeRange);
    },
    updateEventDates: (row, changes) => this.updateCalendarTimelineDates(row, changes),
    updateCalendarScale: (scale, anchorDateKey, label) => this.updateCalendarScale(scale, anchorDateKey, label),
    onConfigChange: (label) => {
      this.pendingUndoLabel = label || t("undo.viewTypeConfig");
      this.scheduleConfigSave();
      this.refresh();
    },
    getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns),
    getCalendarInvalidEventCount: () => this.getTimelineInvalidEventCount(),
    renderRecordIcon: (parent, row, config, compact) => this.renderRowRecordIcon(parent, row, config, compact),
    applyConditionalFormat: (element, row, config) => applyConditionalFormat(element, row, config, this.getActiveDb()),
    openCalendarInvalidEvents: () => { void this.openInvalidEvents(); },
    isReadOnly: false,
  });
  private calendarToolbarRenderer = new CalendarToolbarRenderer();
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
  private relationTargetPaths = new Set<string>();
  private relationTargetDatabases: DatabaseConfig[] = [];
  private relationTargetDatabasePaths = new Set<string>();
  private timelineInvalidRowsVersion = 0;
  private timelineInvalidEventsScanner = new InvalidTimelineEventsScanner();
  private calendarTimelineSearchResultsEl: HTMLElement | null = null;
  private selectedRows = new Set<string>();
  private lastSelectedRowPath: string | null = null;
  private cellSelection: CellSelectionRange | null = null;
  private lastCellFocusPosition: TableGridPosition | null = null;
  private isSelectingCells = false;
  private showCellFillInput = false;
  private pendingCellFillDraft: string | null = null;
  private pendingCellCut: PendingCellCut | null = null;
  private bulkEditingColumnKey?: string;
  private closeBulkEditPopover?: () => void;
  private historyStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
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
  private pendingComputedSync = new ComputedSyncQueue<RowData>();
  private syncingComputed = false;
  private propertyTypeConflictModalOpen = false;
  private suppressDataReloadUntil = 0;
  private suppressNextSettingsUpdate = false;
  private suppressNextCreate = false;
  private pendingNewFilePath?: string;
  private pendingNewRecords = new Map<string, NoteRecord & { expiresAt: number }>();
  private pendingNewRowCellFocus?: { rowPath: string; colKey: string };
  private creatingKeyboardRow = false;
  private creatingPasteRows = false;
  private pendingNewRevealTimer: number | null = null;
  private pendingSearchResultRevealPath?: string;
  private pendingCalendarTimelineCreates = new Set<string>();
  private lastCalendarTimelineSameDateFieldNoticeAt = 0;
  /** Last view type we finished rendering. Used to reset the calendar/timeline
   * scroll to the top only on an actual view switch — not on filter/sort/data
   * refreshes, which must preserve the user's scroll position. */
  private lastRenderedViewType: DatabaseViewType | null = null;
  private onConfigChanged?: () => void | Promise<void>;
  private databaseFolder: string;
  private readonly instanceId = generateId();
  private scrollbarIdleTimer: number | null = null;
  private descriptionScrollTimers = new WeakMap<HTMLElement, number>();
  private refreshCoordinator: RefreshCoordinator;
  private pendingSourceReload = false;

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
    this.propertyService = new PropertyService(
      this.app,
      (file, mutator) => this.dataSource.mutateFrontmatter(
        file,
        mutator,
        { sourceInstanceId: this.instanceId }
      )
    );
    this.cellRenderer = new CellRenderer(
      this.dataSource,
      () => this.refreshAfterSave(),
      (row) => this.openRow(row),
      (col) => this.columnMenu.showOptionsEditor(col),
      (col, row) => this.showFormulaModal(col, undefined, row),
      false,
      (row, col, transaction) => this.commitCellOptionTransaction(row, col, transaction),
      (row, col, value) => this.saveCellValueWithHistory(row, col, value),
      (row) => this.getFileTitleInfo(row),
      () => this.getConfig()?.schema.computedFields || [],
      this.app,
      (row, col, intent) => this.restoreTableCellFocus(row, col, intent),
      (row, newName) => this.renameFileWithHistory(row, newName),
      this.instanceId,
    );
    this.columnOperations = new ColumnOperations({
      app: this.app,
      dataSource: this.dataSource,
      propertyService: this.propertyService,
      viewStateStore: this.viewStateStore,
      getConfig: () => this.getStatefulConfig(this.getConfig()),
      getMutableConfig: () => this.getConfig(),
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
    // Capture mousedown before popover onOutside handlers close overlays,
    // so createEntry can know whether an overlay was open at click time.
    this.registerDomEvent(window.activeDocument, "mousedown", () => {
      this.suppressNextCreate = this.hasActiveOverlay();
    }, { capture: true });
    this.rowMenu = new RowMenu({
      app: this.app,
      openRow: (row) => { void this.openRow(row); },
      deleteRow: (row) => this.deleteRow(row),
      duplicateRow: (row) => this.duplicateRow(row),
      isRecordIconShown: () => this.getConfig()?.showRecordIcon === true,
      canToggleRecordIcon: () => ["table", "board", "gallery", "list", "calendar", "timeline"].includes(this.getConfig()?.viewType || "table"),
      toggleRecordIcon: (anchor, row) => this.toggleCurrentViewRecordIcon(anchor, row),
      createEntry: (defaults, position) => this.guardedCreateEntry(defaults, position),
      getConfig: () => this.getConfig(),
      getVisibleRows: () => this.rows,
      getCreateDefaults: (row, context) => this.getCreateEntryDefaultsForRow(row, context),
    });
    const shouldHideResultCreateEntryButtons = () => this.shouldHideResultCreateEntryButtons();
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
      setupRow: (tr, row, context) => this.setupRowInteractions(tr, row, context),
      renderCell: (td, row, col) => this.renderCell(td, row, col),
      renderRecordIcon: (parent, row, config, compact) => this.renderRowRecordIcon(parent, row, config, compact),
      renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.getActiveDb()),
      applyConditionalFormat: (element, row, config, targetField) => applyConditionalFormat(element, row, config, this.getActiveDb(), targetField),
      setupFillHandle: (td, row, col) => this.setupTableFillHandle(td, row, col),
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      moveRowToGroupAndPosition: (row, field, fromGroupKey, toGroupKey, beforePath, afterPath) =>
        this.moveRowToGroupAndPosition(row, field, fromGroupKey, toGroupKey, beforePath, afterPath),
      createEntry: (defaults, position) => this.guardedCreateEntry(defaults, position),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.getConfig(), field, key, count),
      get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); },
    });
    this.boardRenderer = new BoardRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults, position) => this.guardedCreateEntry(defaults, position),
      createGroup: (field, name, color) => this.createBoardGroup(field, name, color),
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
      editFileName: (target, row, currentName) => this.cellRenderer.editFileName(target, row, currentName),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.getConfig(), field, key, count),
      showRowMenu: (event, row, context) => this.rowMenu.show(event, row, context),
      showColumnMenu: (event, col, anchorEl) => this.showContextMenu(event, col, anchorEl, {
        includeWidthActions: false,
      }),
      editFormula: (col) => this.showFormulaModal(col),
      renderRecordIcon: (parent, row, config, compact) => this.renderRowRecordIcon(parent, row, config, compact),
      renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.getActiveDb()),
      applyConditionalFormat: (element, row, config, targetField) => applyConditionalFormat(element, row, config, this.getActiveDb(), targetField),
      get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); },
    });
    this.galleryRenderer = new GalleryRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults, position) => this.guardedCreateEntry(defaults, position),
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      editFileName: (target, row, currentName) => this.cellRenderer.editFileName(target, row, currentName),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns),
      updateCardSize: (width) => this.updateGalleryCardSize(width),
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      moveRowToGroupAndPosition: (row, field, fromGroupKey, toGroupKey, beforePath, afterPath) =>
        this.moveRowToGroupAndPosition(row, field, fromGroupKey, toGroupKey, beforePath, afterPath),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.getConfig(), field, key, count),
      showRowMenu: (event, row, context) => this.rowMenu.show(event, row, context),
      showColumnMenu: (event, col, anchorEl) => this.showContextMenu(event, col, anchorEl, {
        includeWidthActions: false,
      }),
      editFormula: (col) => this.showFormulaModal(col),
      renderRecordIcon: (parent, row, config, compact) => this.renderRowRecordIcon(parent, row, config, compact),
      renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.getActiveDb()),
      applyConditionalFormat: (element, row, config, targetField) => applyConditionalFormat(element, row, config, this.getActiveDb(), targetField),
      get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); },
    });
    this.listRenderer = new ListRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults, position) => this.guardedCreateEntry(defaults, position),
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      editFileName: (target, row, currentName) => this.cellRenderer.editFileName(target, row, currentName),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns),
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      moveRowsToGroup: (row, field, fromGroupKey, toGroupKey) => this.updateBoardGroup(row, field, toGroupKey, fromGroupKey),
      moveRowToGroupAndPosition: (row, field, fromGroupKey, toGroupKey, beforePath, afterPath) =>
        this.moveRowToGroupAndPosition(row, field, fromGroupKey, toGroupKey, beforePath, afterPath),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.getConfig(), field, key, count),
      showRowMenu: (event, row, context) => this.rowMenu.show(event, row, context),
      showColumnMenu: (event, col, anchorEl) => this.showContextMenu(event, col, anchorEl, {
        includeWidthActions: false,
      }),
      editFormula: (col) => this.showFormulaModal(col),
      renderRecordIcon: (parent, row, config, compact) => this.renderRowRecordIcon(parent, row, config, compact),
      renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.getActiveDb()),
      applyConditionalFormat: (element, row, config, targetField) => applyConditionalFormat(element, row, config, this.getActiveDb(), targetField),
      get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); },
    });
    this.columnMenu = new ColumnMenu({
      editColumn: (col) => this.showColumnRenameModal(col),
      editFormula: (col) => this.showFormulaModal(col),
      editRelationRollup: (col) => this.showRelationRollupConfigModal(col),
      editStatusOptions: (col) => this.showStatusOptionsModal(col),
      showOptionsEditor: (col) => this.showStatusOptionsModal(col),
      changeColumnType: (col, type) => { void this.changeColumnType(col, type); },
      insertColumn: (col, side) => { void this.columnOperations.insertColumnNear(col, side); },
      duplicateColumn: (col) => { void this.columnOperations.duplicateColumn(col); },
      moveColumn: (key, offset) => this.columnOperations.moveColumn(key, offset),
      hideColumn: (col) => this.columnOperations.hideColumn(col),
      toggleColumnWrap: (col) => this.toggleColumnWrap(col),
      setTextRenderMode: (col, mode) => this.setTextRenderMode(col, mode),
      setNumberDisplayStyle: (col, style) => this.setNumberDisplayStyle(col, style),
      updateNumberDisplayConfig: (col, partial) => this.updateNumberDisplayConfig(col, partial),
      sortByColumn: (col) => this.sortByColumn(col),
      getColumnSortDirection: (col) => this.getColumnSortDirection(col),
      clearColumnSort: (col) => this.clearColumnSort(col),
      openColumnWidthPanel: (col) => this.showMobileColumnWidthPanel(col),
      autoFitColumn: (col) => this.autoFitColumn(col),
      autoFitAllColumns: () => this.autoFitAllColumns(),
      deleteColumn: (col) => { void this.columnOperations.deleteColumn(col); },
    });
    this.onConfigChanged = onConfigChanged;
    this.refreshCoordinator = new RefreshCoordinator({
      isBlocked: () => this.cellRenderer.hasActiveEditor(this.containerEl_) ||
        isRefreshBlockedByDrag(this.containerEl_) ||
        Date.now() < this.suppressDataReloadUntil,
      isEligible: () => this.isRefreshEligible(),
      onRefresh: (request) => {
        const forceReload = request.manual;
        if (forceReload) this.dataSource.invalidateRecordCache();
        const reloadSource = this.pendingSourceReload || forceReload;
        if (reloadSource) {
          this.rebuildViewEntries();
          this.rerenderToolbar();
          this.pendingSourceReload = false;
        }
        if (!reloadSource && !request.unknown) {
          if (this.tryUpdateExternalChartData(request.paths)) return;
          if (this.tryPatchExternalTableRows(request.paths)) return;
        }
        this.refresh();
      },
      onStateChange: (state) => this.updateRefreshIndicator(state),
      onError: (error) => {
        console.error("Note Database: refresh failed", error);
        new Notice(t("errors.refreshFailed"));
      },
      // active-leaf-change and window focus poke immediately. A hidden tab only
      // needs a low-frequency fallback if Obsidian misses both lifecycle events.
      eligibilityRetryMs: 10_000,
      setTimer: (callback, delay) => this.getRefreshWindow().setTimeout(callback, delay),
      clearTimer: (timer) => this.getRefreshWindow().clearTimeout(timer),
    });
    this.register(this.dataSource.onDataChanged((batch) => this.handleDataChangeBatch(batch)));
    this.register(this.dataSource.onViewConfigChanged((mutation) => this.handlePeerViewConfigChanged(mutation)));
    this.rebuildViewEntries();
  }

  private shouldHideResultCreateEntryButtons(): boolean {
    return this.vs().searchText.trim().length > 0;
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
  private hasActiveOverlay(): boolean {
    if (this.cellRenderer?.hasActiveEditor(this.containerEl_)) return true;
    return Boolean(this.containerEl_?.ownerDocument.querySelector(
      ".modal:not(.is-hidden), .menu, .suggestion-container, " +
      ".db-cell-edit-popover:not(.is-hidden), .db-cell-option-popover:not(.is-hidden), " +
      ".db-dropdown-popover:not(.is-hidden), .db-view-config-panel:not(.is-hidden), " +
      ".db-group-popover:not(.is-hidden), .db-export-popover:not(.is-hidden), " +
      ".db-title-actions-popover:not(.is-hidden), .db-color-picker-popup:not(.is-hidden), " +
      ".db-record-detail-panel:not(.is-hidden), .db-filter-panel:not(.is-hidden), " +
      ".db-sort-panel:not(.is-hidden), .db-column-manager:not(.is-hidden), " +
      ".db-group-order-popover:not(.is-hidden), .db-chart-options-popover:not(.is-hidden), " +
      ".db-calendar-options-popover:not(.is-hidden), .db-calendar-timeline-options-popover:not(.is-hidden), " +
      ".db-database-popover:not(.is-hidden), .db-view-tab-popover:not(.is-hidden), " +
      ".db-add-view-popover:not(.is-hidden), .db-board-drag-group-preview"
    ));
  }

  private guardedCreateEntry(defaults?: Record<string, unknown>, position?: { beforePath?: string; afterPath?: string }): void {
    const suppressed = this.suppressNextCreate || this.hasActiveOverlay();
    this.suppressNextCreate = false;
    if (suppressed) { this.closeActiveOverlays(); return; }
    void this.createBlankEntry(defaults ?? {}, position);
  }

  private guardedCalendarCreate(defaults?: Record<string, unknown>): void {
    const suppressed = this.suppressNextCreate || this.hasActiveOverlay();
    this.suppressNextCreate = false;
    if (suppressed) { this.closeActiveOverlays(); return; }
    void this.createCalendarAwareCreateEntry(defaults);
  }

  private closeActiveOverlays(): void {
    this.cellRenderer?.cancelActiveInlineEditor();
    this.cellRenderer?.closeActiveOptionPopover();
    this.cellRenderer?.closeActiveBulkEditor();
    this.closeHeaderPopovers();
    closeRecordDetailPanel();
    const doc = this.containerEl_?.ownerDocument || window.activeDocument;
    doc.querySelectorAll(
      ".db-color-picker-popup:not(.is-hidden), .db-icon-picker-popover:not(.is-hidden), " +
      ".db-dropdown-popover:not(.is-hidden), .db-calendar-day-popover:not(.is-hidden), " +
      ".db-calendar-week-allday-popover:not(.is-hidden), .db-calendar-mini-popover:not(.is-hidden), " +
      ".menu"
    ).forEach((element) => element.remove());
  }

  private suppressDataReload(ms: number): void {
    this.suppressDataReloadUntil = Math.max(this.suppressDataReloadUntil, Date.now() + ms);
  }

  private handlePeerViewConfigChanged(mutation: ViewConfigMutation): void {
    if (mutation.sourceInstanceId === this.instanceId) return;
    if (!this.matchesCurrentView(mutation)) return;
    if (!this.isRefreshEligible()) {
      this.pendingSourceReload = true;
      this.refreshCoordinator.mark([mutation.dbPath || this.getCurrentEntry()?.sourcePath || ""]);
      return;
    }
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

  private restoreViewSelection(sourcePath?: string, viewId?: string): void {
    const selection = resolveViewSelection(
      this.viewEntries.map((entry) => ({
        sourcePath: entry.sourcePath,
        viewIds: entry.config.views.map((view) => view.id),
      })),
      { sourcePath, viewId },
      this.currentDbIndex,
      this.currentViewIndex,
    );
    this.currentDbIndex = selection.databaseIndex;
    this.currentViewIndex = selection.viewIndex;
  }

  /** Update database configs from settings (called when settings change) */
  updateConfigs(
    databaseFileOrder: string[] = this.databaseFileOrder,
    statusPresets: StatusPresetDef[] = this.statusPresets,
    defaultStatusPresetId: string | undefined = this.defaultStatusPresetId,
    databaseFolder: string = this.databaseFolder
  ): void {
    const currentEntry = this.getCurrentEntry();
    const currentSourcePath = currentEntry?.sourcePath;
    const currentViewId = currentEntry?.config.views[this.currentViewIndex]?.id
      || currentEntry?.config.views[0]?.id;
    this.databaseFileOrder = databaseFileOrder;
    this.statusPresets = normalizeStatusPresets(statusPresets);
    this.defaultStatusPresetId = defaultStatusPresetId;
    this.databaseFolder = databaseFolder;
    this.rebuildViewEntries();
    this.restoreViewSelection(currentSourcePath, currentViewId);
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
    this.isSelectingCells = false;
    this.showCellFillInput = false;
    this.pendingCellFillDraft = null;
    this.bulkEditingColumnKey = undefined;
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

  async onLoadFile(_file: TFile): Promise<void> {
    // The dashboard view is file-less; database-file tabs handle their own file binding.
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    // No file buffer is owned by this view.
  }

  async onRename(_file: TFile): Promise<void> {
    // Database-file tabs override this to follow their backing file.
  }

  canAcceptExtension(extension: string): boolean {
    void extension;
    return false;
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
    // Cmd/Ctrl+F：view scope keymap 优先于全局 editor:open-search（DOM bubble/capture 都会被
    // Obsidian keymap 抢先 stopPropagation）。Mod 自动适配 macOS Cmd / 其它平台 Ctrl；
    // ["Mod"]+"f" 只匹配 Mod+F，Mod+Shift+F 全局搜索不受影响。View.scope 默认 null，需自建。
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "f", (event) => this.handleSearchShortcut(event));
    this.scope.register(["Mod"], "z", (event) => this.handleHistoryShortcut(event, "undo"));
    this.scope.register(["Mod", "Shift"], "z", (event) => this.handleHistoryShortcut(event, "redo"));
    this.scope.register(["Mod"], "y", (event) => this.handleHistoryShortcut(event, "redo"));
    this.scope.register(["Mod"], "d", (event) => this.handleTableFillShortcut(event, "down"));
    this.scope.register(["Mod"], "r", (event) => this.handleTableFillShortcut(event, "right"));
    this.scope.register([], "Escape", (event) => this.handleInlineEditorEscape(event));
    this.registerDomEvent(this.getRefreshWindow(), "focus", () => this.refreshOnActivation());
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf === this.leaf) this.refreshOnActivation();
      else this.closeHeaderPopovers();
    }));
    this.registerEvent(this.app.workspace.on("css-change", () => this.chartRenderer.refreshTheme()));
    this.registerEvent(this.app.workspace.on("database-icon-visibility-change" as never, () => this.rerenderToolbar()));
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
    this.refreshCoordinator.destroy();
    this.chartRenderer.destroy();
    this.closeCalendarTimelineSearchResultsPanel();
    // 清理时间线渲染器的 observer/popover/定时器和进行中的拖拽监听，避免视图关闭后泄漏
    this.calendarTimelineRenderer.destroy();
    // 取消可能仍在调度的无效时间事件分块扫描，避免视图关闭后继续占用 idle 回调
    this.timelineInvalidEventsScanner.clear();
    this.removeHeaderPopoverAutoClose?.();
    this.removeHeaderPopoverAutoClose = undefined;
    this.closeMobileColumnWidthPanel();
    this.closeGroupOrderPopover();
    window.activeDocument.removeEventListener("mousedown", this.handleOutsideClickBound, true);
    if (this.scrollbarIdleTimer !== null) {
      window.clearTimeout(this.scrollbarIdleTimer);
      this.scrollbarIdleTimer = null;
    }
    if (this.computedSyncTimer !== null) {
      this.getRefreshWindow().clearTimeout(this.computedSyncTimer);
      this.computedSyncTimer = null;
    }
    this.pendingComputedSync.clear();
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

  private isActiveView(): boolean {
    return this.app.workspace.getActiveViewOfType(DatabaseView) === this;
  }

  private isRefreshEligible(): boolean {
    if (!this.containerEl_?.isConnected) return false;
    if (this.isActiveView()) return true;
    // A database in another visible split pane should stay current even when
    // the user is editing a note beside it. Hidden workspace tabs have no
    // rendered client rect and keep their dirty queue until shown.
    return this.containerEl_.getClientRects().length > 0;
  }

  private getRefreshWindow(): Window {
    return this.containerEl_?.ownerDocument.defaultView || window;
  }

  private focusSearch(): boolean {
    const control = this.containerEl_?.querySelector<HTMLElement>(".db-search-control");
    const searchInput = control?.querySelector<HTMLInputElement>(".db-search-input");
    if (!control || !searchInput) return false;
    control.addClass("is-active");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      });
    });
    return true;
  }

  // Cmd/Ctrl+F：用 view scope 的 keymap 拦截（view scope 优先于全局 editor:open-search，
  // DOM bubble/capture 监听都会被 Obsidian keymap 抢先 stopPropagation）。Mod 自动适配
  // macOS Cmd / 其它平台 Ctrl；["Mod"]+"f" 只匹配 Mod+F，Mod+Shift+F 全局搜索不受影响。
  // 编辑单元格时也抢焦点（失焦由 CellRenderer 现有 blur restore 处理）。
  private handleSearchShortcut(event: KeyboardEvent): boolean {
    if (this.isActiveView() && this.focusSearch()) {
      event.preventDefault();
      event.stopPropagation();
      return false; // 吃掉事件，阻止 editor:open-search
    }
    return true; // 非数据库视图上下文，放行默认
  }

  private handleInlineEditorEscape(event: KeyboardEvent): boolean {
    if (isImeComposing(event)) return true;
    if (this.isActiveView() && this.showCellFillInput) {
      this.showCellFillInput = false;
      this.pendingCellFillDraft = null;
      this.renderSelectionStatusBar();
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    if (!this.isActiveView() || !this.cellRenderer.cancelActiveInlineEditor()) return true;
    event.preventDefault();
    event.stopPropagation();
    return false;
  }

  private handleTableFillShortcut(event: KeyboardEvent, direction: "down" | "right"): boolean {
    const active = window.activeDocument.activeElement;
    const isEditing = isHTMLElement(active)
      && active.closest("input, textarea, select, .db-cell-editing, .modal") != null;
    if (!this.isActiveView() || isEditing || !this.cellSelection || this.getConfig()?.viewType !== "table") {
      return true;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.fillSelectedCellsFromEdge(direction);
    return false;
  }

  private handleHistoryShortcut(event: KeyboardEvent, direction: "undo" | "redo"): boolean {
    const active = window.activeDocument.activeElement;
    const isEditing = isHTMLElement(active)
      && active.closest("input, textarea, select, .db-cell-editing, .db-cell-popover-editing, .modal") != null;
    if (!this.isActiveView() || isEditing) return true;
    event.preventDefault();
    event.stopPropagation();
    void this.replayHistory(direction);
    return false;
  }

  private handleDatabaseKeydown(event: KeyboardEvent): void {
    if (!this.containerEl_?.isConnected) return;
    const active = window.activeDocument.activeElement;
    const target = event.target;
    const eventTarget = isHTMLElement(target) ? target : null;
    const isEditing = eventTarget?.closest("input, textarea, select, .db-cell-editing, .modal") != null;
    const isInsideView = active instanceof Node && this.containerEl_.contains(active);
    if (!isInsideView && !this.containerEl_.matches(":hover")) return;
    if (isEditing) return;
    // 字段编辑弹出层（选项/日期/颜色选择器）打开时，方向键/Enter 由弹出层自己的 keydown 处理，不导航单元格
    if (this.containerEl_?.querySelector(".db-cell-option-popover, .db-cell-date-popover, .db-color-picker-popup")) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && this.cellSelection) {
      event.preventDefault();
      this.selectEntireTableGrid();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && this.cellSelection) {
      event.preventDefault();
      void this.copySelectedCells();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "x" && this.cellSelection) {
      event.preventDefault();
      void this.cutSelectedCells();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && this.cellSelection) {
      event.preventDefault();
      void this.pasteCellsFromClipboard();
      return;
    }
    if (event.key === "Escape" && this.cellSelection) {
      event.preventDefault();
      if (this.pendingCellCut) {
        this.cancelPendingCellCut();
        return;
      }
      this.clearCellSelection();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.cellSelection) {
      event.preventDefault();
      void this.clearSelectedCells();
      return;
    }

    if (this.cellSelection) {
      const mod = event.metaKey || event.ctrlKey;
      if (event.altKey && event.key === "ArrowDown") {
        if (this.openFocusedColumnMenu()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.shiftKey && event.key === "F10") {
        if (this.openFocusedRowMenu()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key === " " && mod) {
        event.preventDefault();
        this.selectFocusedTableColumn();
        return;
      }
      if (event.key === " " && event.shiftKey) {
        event.preventDefault();
        this.selectFocusedTableRow();
        return;
      }
      if (mod && (event.key === "Home" || event.key === "End")) {
        event.preventDefault();
        this.moveCellFocus(event.key === "Home" ? "grid-start" : "grid-end", event.shiftKey);
        return;
      }
      if (mod && (event.key === "ArrowUp" || event.key === "ArrowDown"
          || event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const intent: TableCellNavigationIntent = event.key === "ArrowUp"
          ? "column-start"
          : event.key === "ArrowDown"
            ? "column-end"
            : event.key === "ArrowLeft"
              ? "row-start"
              : "row-end";
        this.moveCellFocus(intent, event.shiftKey);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        this.moveCellFocus(event.key === "Home" ? "row-start" : "row-end", event.shiftKey);
        return;
      }
      if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault();
        this.moveCellFocusByPage(event.key === "PageUp" ? -1 : 1, event.shiftKey);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const selectedCellCount = this.getSelectedCellAddresses().length;
        if (selectedCellCount > 1) {
          this.cycleCellFocusWithinSelection(event.shiftKey ? "previous" : "next");
          return;
        }
        if (!event.shiftKey && selectedCellCount === 1) {
          const activeAddress = this.getCellSelectionActiveAddress();
          if (this.isLastRenderedTableCell(activeAddress)) {
            void this.createKeyboardRowAfter(activeAddress);
            return;
          }
        }
        this.moveCellFocus(event.shiftKey ? "previous" : "next", false);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const intent: TableCellNavigationIntent = event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "ArrowLeft"
              ? "left"
              : "right";
        this.moveCellFocus(intent, event.shiftKey);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        this.editAtCellSelection();
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        this.startEditAtCellSelectionFocus("stay");
        return;
      }
      const selectedCellCount = this.getSelectedCellAddresses().length;
      if (event.key === " " && selectedCellCount === 1 && this.isFocusedCellCheckbox()) {
        event.preventDefault();
        this.startEditAtCellSelectionFocus("stay");
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
          && selectedCellCount > 0) {
        if (selectedCellCount > 1) {
          event.preventDefault();
          this.startDirectFillForCellSelection(event.key);
          return;
        }
        if (this.startReplaceEditAtCellSelectionFocus(event.key)) {
          event.preventDefault();
          return;
        }
      }
    }
  }

  private moveCellFocus(intent: TableCellNavigationIntent, extend: boolean): void {
    if (!this.cellSelection || !this.containerEl_) return;
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const newAddr = resolveTableCellNavigation(
      rowPaths,
      colKeys,
      this.getCellSelectionActiveAddress(),
      intent,
      this.lastCellFocusPosition,
    );
    if (!newAddr) return;
    this.cellSelection = extend
      ? { anchor: this.cellSelection.anchor, focus: newAddr, active: newAddr }
      : { anchor: newAddr, focus: newAddr };
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
    this.scrollCellIntoView(newAddr);
  }

  private cycleCellFocusWithinSelection(direction: "next" | "previous"): void {
    if (!this.cellSelection) return;
    const active = cycleTableSelectionActiveCell(
      this.getRenderedTableRowPaths(),
      this.getRenderedTableColumnKeys(),
      this.cellSelection.anchor,
      this.cellSelection.focus,
      this.getCellSelectionActiveAddress(),
      direction,
    );
    if (!active) return;
    this.cellSelection = { ...this.cellSelection, active };
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
    this.scrollCellIntoView(active);
  }

  private isLastRenderedTableCell(address: CellAddress): boolean {
    return isTableCellAtGridEdge(
      this.getRenderedTableRowPaths(),
      this.getRenderedTableColumnKeys(),
      address,
      "end",
    );
  }

  private async createKeyboardRowAfter(address: CellAddress): Promise<void> {
    if (this.creatingKeyboardRow || this.getConfig()?.viewType !== "table" || !this.isLastRenderedTableCell(address)) return;
    const row = this.rows.find((candidate) => candidate.file.path === address.rowPath);
    const firstColumnKey = this.getRenderedTableColumnKeys()[0];
    if (!row || !firstColumnKey) return;
    this.creatingKeyboardRow = true;
    const createContext = this.getRenderedTableRowCreateContext(row.file.path);
    const created = await this.createBlankEntry(
      this.getCreateEntryDefaultsForRow(row, createContext),
      { afterPath: row.file.path },
      firstColumnKey,
    );
    // A successful create keeps the guard until revealPendingNewRow moves real DOM focus.
    // This closes the frame-sized window where repeated Tab could create duplicate rows.
    if (!created) {
      this.creatingKeyboardRow = false;
    }
  }

  private openFocusedColumnMenu(): boolean {
    const context = this.getCellSelectionFocusContext();
    if (!context || !this.containerEl_) return false;
    const header = this.containerEl_.querySelector<HTMLElement>(
      `th[data-note-database-column-key="${CSS.escape(context.col.key)}"]`
    );
    if (!header) return false;
    const anchor = header.querySelector<HTMLElement>(".db-column-menu-trigger") || header;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    this.showContextMenu(event, context.col, anchor, {
      onClose: () => this.restoreCellFocusAfterKeyboardMenu(),
    });
    return true;
  }

  private openFocusedRowMenu(): boolean {
    const context = this.getCellSelectionFocusContext();
    if (!context) return false;
    const createContext = this.getRenderedTableRowCreateContext(context.row.file.path, context.td)
      || { visibleRows: this.rows };
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    this.rowMenu.show(
      event,
      context.row,
      createContext,
      context.td,
      () => this.restoreCellFocusAfterKeyboardMenu(),
    );
    return true;
  }

  private restoreCellFocusAfterKeyboardMenu(): void {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const active = window.activeDocument.activeElement;
      if (isHTMLElement(active) && active.closest(".modal, .menu, input, textarea, select")) return;
      this.restorePreservedCellSelectionAfterRefresh();
    }));
  }

  private moveCellFocusByPage(direction: -1 | 1, extend: boolean): void {
    if (!this.cellSelection || !this.containerEl_) return;
    const active = this.getCellSelectionActiveAddress();
    const td = this.containerEl_.querySelector<HTMLElement>(
      `td[data-note-database-row-path="${CSS.escape(active.rowPath)}"][data-note-database-column-key="${CSS.escape(active.colKey)}"]`
    );
    const rowHeight = td?.closest("tr")?.getBoundingClientRect().height || 32;
    const pageRows = Math.max(1, Math.floor(this.containerEl_.clientHeight / rowHeight) - 2);
    const newAddr = moveTableCellByRowOffset(
      this.getRenderedTableRowPaths(),
      this.getRenderedTableColumnKeys(),
      active,
      direction * pageRows,
      this.lastCellFocusPosition,
    );
    if (!newAddr) return;
    this.cellSelection = extend
      ? { anchor: this.cellSelection.anchor, focus: newAddr, active: newAddr }
      : { anchor: newAddr, focus: newAddr };
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
    this.scrollCellIntoView(newAddr);
  }

  private startEditAtCellSelectionFocus(checkboxFinishIntent: TableCellNavigationIntent = "down"): void {
    const context = this.getCellSelectionFocusContext();
    if (!context) return;
    const { td, row, col } = context;
    if (td.classList.contains("db-cell-editing")) return;
    this.cellRenderer.startEdit(td, row, col, undefined, undefined, undefined, checkboxFinishIntent);
  }

  private startReplaceEditAtCellSelectionFocus(initialText: string): boolean {
    const context = this.getCellSelectionFocusContext();
    if (!context || context.td.classList.contains("db-cell-editing")) return false;
    return this.cellRenderer.startReplaceEdit(context.td, context.row, context.col, initialText);
  }

  private startDirectFillForCellSelection(initialText: string): void {
    this.cellRenderer.closeActiveBulkEditor();
    this.bulkEditingColumnKey = undefined;
    this.pendingCellFillDraft = initialText;
    this.showCellFillInput = true;
    this.renderSelectionStatusBar();
  }

  private isFocusedCellCheckbox(): boolean {
    return this.getCellSelectionFocusContext()?.col.type === "checkbox";
  }

  private getCellSelectionFocusContext(): { td: HTMLElement; row: RowData; col: ColumnDef } | null {
    if (!this.cellSelection || !this.containerEl_) return null;
    const { rowPath, colKey } = this.getCellSelectionActiveAddress();
    const active = window.activeDocument.activeElement;
    const focusedCell = isHTMLElement(active)
      ? active.closest<HTMLElement>("td[data-note-database-row-path][data-note-database-column-key]")
      : null;
    const td = focusedCell?.dataset.noteDatabaseRowPath === rowPath
      && focusedCell.dataset.noteDatabaseColumnKey === colKey
      ? focusedCell
      : this.containerEl_.querySelector<HTMLElement>(
          `td[data-note-database-row-path="${CSS.escape(rowPath)}"][data-note-database-column-key="${CSS.escape(colKey)}"]`
        );
    if (!td) return null;
    const row = this.rows.find((r) => r.file.path === rowPath);
    const col = this.getConfig().schema.columns.find((c) => c.key === colKey);
    return row && col ? { td, row, col } : null;
  }

  // Enter on a cell selection: single cell falls back to inline focus edit; multi-cell routes
  // through the shared fill/bulk router (status bar is the popover anchor for bulk editing).
  private editAtCellSelection(): void {
    if (!this.cellSelection) return;
    const addresses = this.getSelectedCellAddresses();
    if (addresses.length <= 1) {
      this.startEditAtCellSelectionFocus();
      return;
    }
    // Multi-cell Enter uses the same path as the status-bar "fill value" action: single editable
    // column → native editor; otherwise the text fill applies to every editable cell in the range.
    this.openBulkEditOrFillForSelection(this.getStatusBarAnchor());
  }

  private scrollCellIntoView(addr: CellAddress): void {
    if (!this.containerEl_) return;
    const td = this.containerEl_.querySelector<HTMLElement>(
      `td[data-note-database-row-path="${CSS.escape(addr.rowPath)}"][data-note-database-column-key="${CSS.escape(addr.colKey)}"]`
    );
    if (!td) return;
    td.tabIndex = 0;
    td.focus();
    td.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private restoreTableCellFocus(
    row: RowData,
    col: ColumnDef,
    intent: TableCellNavigationIntent = "stay",
  ): void {
    if (!this.containerEl_ || this.getConfig()?.viewType !== "table") return;
    const current: CellAddress = { rowPath: row.file.path, colKey: col.key };
    if (intent === "next" && this.isLastRenderedTableCell(current)) {
      void this.createKeyboardRowAfter(current);
      return;
    }
    const address = resolveTableCellNavigation(
      this.getRenderedTableRowPaths(),
      this.getRenderedTableColumnKeys(),
      current,
      intent,
      this.lastCellFocusPosition,
    );
    if (!address) return;
    this.clearSelection();
    this.cellSelection = { anchor: address, focus: address };
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
    window.requestAnimationFrame(() => this.scrollCellIntoView(address));
  }

  private restorePreservedCellSelectionAfterRefresh(): void {
    if (!this.cellSelection) return;
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const hasAddress = (address: CellAddress) =>
      rowPaths.includes(address.rowPath) && colKeys.includes(address.colKey);
    let active = this.getCellSelectionActiveAddress();
    if (!hasAddress(this.cellSelection.anchor) || !hasAddress(this.cellSelection.focus) || !hasAddress(active)) {
      const fallback = resolveTableCellNavigation(
        rowPaths,
        colKeys,
        active,
        "stay",
        this.lastCellFocusPosition,
      );
      if (!fallback) {
        this.clearCellSelection();
        return;
      }
      active = fallback;
      this.cellSelection = { anchor: fallback, focus: fallback };
    }
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
    window.requestAnimationFrame(() => this.scrollCellIntoView(active));
  }

  private refreshOnActivation(): void {
    if (!this.containerEl_?.isConnected) return;
    if (this.configSaveTimer !== null) {
      void this.saveConfigImmediately()
        .then(() => this.refreshCoordinator.poke())
        .catch((err) => this.reportConfigSaveFailure(err));
      return;
    }
    this.refreshCoordinator.poke();
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
      editDatabaseIcon: (anchor) => this.openDatabaseIconPicker(anchor),
      showDatabaseIcon: getNoteDatabasePlugin(this.app)?.settings.showDatabaseIcon !== false,
      toggleDatabaseIcon: () => { void this.toggleDatabaseIcon(); },
      setViewType: (value, viewIndex) => this.setViewType(value, viewIndex),
      setDisplayWidth: (value) => this.setDisplayWidth(value),
      setSearchText: (value) => {
        // Search is intentionally transient: it only mutates the in-memory
        // view state and is never persisted to config. See
        // search-transient.test.ts and VIEW_REGRESSION_MATRIX.md.
        this.vs().searchText = value;
        this.refresh({ viewport: "reset-top" });
      },
      onSearchFocus: () => {
        const config = this.getConfig();
        if (config) this.renderCalendarTimelineSearchResultsPanel(config);
      },
      setGroupByField: (value) => this.setGroupByField(value),
      setGroupOrderMode: (mode) => this.setGroupOrderMode(mode),
      setShowEmptyGroups: (field, value) => this.setShowEmptyGroups(field, value),
      setGroupDateMode: (field, mode) => this.setGroupDateMode(field, mode),
      setGroupRowLimit: (limit) => this.setGroupRowLimit(limit),
      setBoardSubgroupEnabled: (enabled) => this.setBoardSubgroupEnabled(enabled),
      setBoardSubgroupField: (value) => this.setBoardSubgroupField(value),
      toggleViewConfig: (anchorEl) => this.toggleHeaderPopover("view", anchorEl),
      configureGroupOrder: () => this.showGroupOrderPopover(),
      toggleSortPanel: (anchorEl) => this.toggleHeaderPopover("sort", anchorEl),
      toggleChartOptions: (anchorEl) => this.toggleChartOptions(anchorEl),
      toggleCalendarOptions: (containerEl, anchor, config) => {
        this.calendarToolbarRenderer.togglePopover(containerEl, anchor, config, {
          database: this.getActiveDb(),
          createRecordIconField: () => this.openCreateRecordIconFieldModal("view"),
          onChange: (label) => {
            this.pendingUndoLabel = label || t("undo.viewTypeConfig");
            this.scheduleConfigSave();
            this.refresh();
          },
          getInvalidEventCount: () => this.getTimelineInvalidEventCount(),
          openInvalidEvents: () => { void this.openInvalidEvents(); },
        });
      },
      getTimelineInvalidEventCount: () => this.getTimelineInvalidEventCount(),
      openTimelineInvalidEvents: () => { void this.openInvalidEvents(); },
      createRecordIconField: () => this.openCreateRecordIconFieldModal("view"),
      updateViewConfig: (label) => this.updateToolbarViewConfig(label),
      updateTimelineScale: (scale, label) => this.updateTimelineScale(scale, label),
      toggleFilterPanel: (anchorEl) => this.toggleHeaderPopover("filter", anchorEl),
      toggleColumnManager: (anchorEl) => this.toggleHeaderPopover("columns", anchorEl),
      syncComputedFields: () => this.syncComputedFieldsManually(),
      refreshDatabase: () => this.refreshCoordinator.refreshNow(),
      pendingRefreshCount: this.refreshCoordinator.getState().pendingCount,
      pendingRefreshUnknown: this.refreshCoordinator.getState().pendingUnknown,
      isRefreshingDatabase: this.refreshCoordinator.getState().refreshing,
      closeToolbarPopovers: () => this.closeHeaderPopovers(),
      createEntry: (defaults) => this.guardedCalendarCreate(defaults),
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
    this.renderDatabaseCover();
    this.updateStickyOffsets();
  }

  private renderDatabaseCover(): void {
    if (!this.containerEl_) return;
    this.containerEl_.querySelector(":scope > .db-database-cover")?.remove();
    const database = this.getActiveDb();
    const path = database?.coverImage?.trim();
    if (!path) return;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return;
    const header = this.containerEl_.querySelector(":scope > .db-header");
    const cover = this.containerEl_.createDiv({
      cls: "db-database-cover",
      attr: { title: file.path },
    });
    const image = cover.createEl("img", {
      attr: {
        src: this.app.vault.getResourcePath(file),
        alt: database?.name || file.basename,
        draggable: "false",
      },
    });
    const initialPosition = Math.max(0, Math.min(100, database.coverImagePositionY ?? 50));
    image.style.objectPosition = `center ${initialPosition}%`;
    if (!this.hideDatabaseActions) {
      let dragStartY = 0;
      let dragStartPosition = initialPosition;
      let dragging = false;
      cover.addClass("is-repositionable");
      cover.onpointerdown = (event) => {
        if (event.button !== 0 || (event.target as HTMLElement | null)?.closest("button")) return;
        dragging = true;
        dragStartY = event.clientY;
        dragStartPosition = this.getActiveDb().coverImagePositionY ?? 50;
        cover.addClass("is-repositioning");
        cover.setPointerCapture(event.pointerId);
        event.preventDefault();
      };
      cover.onpointermove = (event) => {
        if (!dragging) return;
        const height = Math.max(1, cover.getBoundingClientRect().height);
        const next = Math.max(0, Math.min(100, dragStartPosition - ((event.clientY - dragStartY) / height) * 100));
        const current = this.getActiveDb();
        current.coverImagePositionY = next;
        image.style.objectPosition = `center ${next}%`;
      };
      const finishReposition = (event: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        cover.removeClass("is-repositioning");
        if (cover.hasPointerCapture(event.pointerId)) cover.releasePointerCapture(event.pointerId);
        this.pendingUndoLabel = t("undo.databaseCoverConfig");
        void this.saveConfigImmediately();
      };
      cover.onpointerup = finishReposition;
      cover.onpointercancel = finishReposition;
      const change = cover.createEl("button", {
        cls: "db-database-cover-change db-icon-only-button",
        attr: { type: "button", "aria-label": t("databaseCover.choose") },
      });
      setIcon(change, "image-up");
      change.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        new ImageFileSuggestModal(this.app, (selected) => {
          const current = this.getActiveDb();
          if (!current) return;
          current.coverImage = selected.path;
          current.coverImagePositionY = 50;
          this.pendingUndoLabel = t("undo.databaseCoverConfig");
          void this.saveConfigImmediately().then(() => {
            this.rerenderToolbar();
            this.renderDatabaseCover();
          });
        }, t("databaseCover.choose")).open();
      };
    }
    if (header) this.containerEl_.insertBefore(cover, header);
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

  private handleDataChangeBatch(batch: DataChangeBatch): void {
    const observable = batch.changes.filter((change) => change.sourceInstanceId !== this.instanceId);
    if (observable.length === 0) return;
    const rowPaths = new Set(this.rows.map((row) => row.file.path));
    const sourcePath = this.viewEntries[this.currentDbIndex]?.sourcePath;
    const database = this.hasActiveDatabase() ? this.getActiveDb() : null;
    const relevant = observable.filter((change) => {
      const sourceConfigEcho = change.origin === "plugin" &&
        Boolean(change.sourceInstanceId) &&
        (change.path === sourcePath || change.oldPath === sourcePath);
      if (sourceConfigEcho) {
        // updateViewDefFile already broadcasts the authoritative config through
        // onViewConfigChanged; replaying its file event would refresh peers twice.
        return false;
      }
      return change.path === sourcePath ||
        change.oldPath === sourcePath ||
        rowPaths.has(change.path) ||
        (change.oldPath ? rowPaths.has(change.oldPath) : false) ||
        this.relationTargetPaths.has(change.path) ||
        (change.oldPath ? this.relationTargetPaths.has(change.oldPath) : false) ||
        this.relationTargetDatabasePaths.has(change.path) ||
        (change.oldPath ? this.relationTargetDatabasePaths.has(change.oldPath) : false) ||
        ((change.kind === "created" || change.kind === "changed" || change.kind === "renamed") &&
          this.relationTargetDatabases.some((targetDatabase) => {
            const record = this.dataSource.getRecordSnapshot(change.path);
            return record != null && this.dataSource.matchesRecordForDatabase(record, targetDatabase);
          })) ||
        ((change.kind === "created" || change.kind === "changed" || change.kind === "renamed") &&
          database != null &&
          (() => {
            const record = this.dataSource.getRecordSnapshot(change.path);
            return record != null && this.dataSource.matchesRecordForDatabase(record, database);
          })());
    });
    if (relevant.length === 0) return;
    if (relevant.some((change) => change.path === sourcePath || change.oldPath === sourcePath)) {
      this.pendingSourceReload = true;
    }
    this.refreshCoordinator.mark(relevant.map((change) => change.path));
  }

  /**
   * Preserve a connected Chart.js instance for ordinary data changes so its
   * renderer can use update("none"). Source/config reloads and manual recovery
   * deliberately bypass this path and rebuild the full view.
   */
  private tryUpdateExternalChartData(paths: string[]): boolean {
    if (!this.containerEl_ || !this.hasActiveDatabase()) return false;
    const config = this.getConfig();
    if (config.viewType !== "chart") return false;

    const records = this.includePendingNewRecords(
      this.dataSource.getRecordsForConfig(this.getEffectiveConfig(this.getActiveDb()))
    );
    const pipelineConfig = { ...config, manualOrder: undefined };
    this.rows = this.buildRowsWithRelations(
      records,
      pipelineConfig,
      this.vs(),
      this.getActiveDb(),
      true,
    );
    this.timelineInvalidRowsVersion += 1;
    const computedSync = this.getIncrementalComputedSyncPlan(config, this.rows, new Set(paths));
    this.scheduleComputedSync(
      config,
      computedSync.rows,
      computedSync.scope
    );
    this.renderChart(config);
    this.renderSummary(config);
    return true;
  }

  private getIncrementalComputedSyncPlan(
    config: ViewConfig,
    rows: RowData[],
    changedPaths: ReadonlySet<string>
  ): { rows: RowData[]; scope: ComputedSyncScope } {
    if ((config.schema.computedFields || []).some((definition) =>
      /\bbacklinks\b/i.test(definition.expression)
    )) {
      // A link edit can change another note's backlinks without an event for
      // that target note, so cross-file formulas require the full database.
      return { rows, scope: "database" };
    }
    return {
      rows: rows.filter((row) => changedPaths.has(row.file.path)),
      scope: "rows",
    };
  }

  /**
   * Fast path for small external table updates. Rebuild the row pipeline first
   * so filtering/sorting/computed values remain authoritative, then patch DOM
   * rows only when the rendered ungrouped or grouped structure is identical.
   */
  private tryPatchExternalTableRows(paths: string[]): boolean {
    if (!this.containerEl_ || !this.hasActiveDatabase() || paths.length === 0) return false;
    const config = this.getConfig();
    const state = this.vs();
    if (config.viewType !== "table" || state.searchText.trim()) return false;
    if (config.schema.columns.some((column) => column.type === "rollup")) return false;
    const visibleColumns = getVisibleColumns(config, this.rows, state, this.pendingShowColumns);
    const backlinkComputedKeys = new Set(
      (config.schema.computedFields || [])
        .filter((definition) => /\bbacklinks\b/i.test(definition.expression))
        .map((definition) => definition.key)
    );
    if (visibleColumns.some((column) =>
      column.key === "file.backlinks" ||
      (column.type === "computed" &&
        backlinkComputedKeys.has(column.computedKey || column.key.replace(/^formula\./, "")))
    )) {
      // Editing one note can change another row's backlinks without emitting a
      // file event for that target row, so a changed-path-only patch is unsafe.
      return false;
    }

    const changedPaths = new Set(paths);
    const affectedVisibleCount = this.rows.reduce(
      (count, row) => count + (changedPaths.has(row.file.path) ? 1 : 0),
      0
    );
    const patchLimit = Math.max(12, Math.ceil(this.rows.length / 4));
    if (affectedVisibleCount > patchLimit) return false;

    const activeElement = this.containerEl_.ownerDocument.activeElement as HTMLElement | null;
    const focusedCell = activeElement?.closest<HTMLElement>(
      "td[data-note-database-row-path][data-note-database-column-key]"
    );
    const focusedAddress = focusedCell
      ? {
          rowPath: focusedCell.getAttribute("data-note-database-row-path") || "",
          colKey: focusedCell.getAttribute("data-note-database-column-key") || "",
        }
      : null;

    const nextRows = this.getRowsForView(this.currentViewIndex);
    const patched = state.groupByField
      ? (() => {
          const field = state.groupByField;
          const groups = withEmptyOptionGroups(
            config,
            field,
            this.queryEngine.groupBy(
              nextRows,
              field,
              [],
              config.schema.columns.find((column) => column.key === field),
              config
            )
          );
          const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
          return this.tableRenderer.patchGroupedRows(
            this.containerEl_,
            this.getStatefulConfig(config),
            nextRows,
            this.queryEngine.sortGroups(groups, order),
            field,
            changedPaths
          );
        })()
      : this.tableRenderer.patchUngroupedRows(
          this.containerEl_,
          this.getStatefulConfig(config),
          nextRows,
          changedPaths
        );
    if (!patched) {
      return false;
    }

    this.rows = nextRows;
    this.timelineInvalidRowsVersion += 1;
    const computedSync = this.getIncrementalComputedSyncPlan(config, this.rows, changedPaths);
    this.scheduleComputedSync(
      config,
      computedSync.rows,
      computedSync.scope
    );
    this.renderSummary(config);
    const summary = this.containerEl_.querySelector<HTMLElement>(":scope > .db-summary");
    const tableRoot = this.containerEl_.querySelector<HTMLElement>(
      ":scope > .db-table-wrap, :scope > .db-grouped-table"
    );
    if (summary && tableRoot) this.containerEl_.insertBefore(summary, tableRoot);
    this.renderSelectionStatusBar();

    const openDetailPath = getOpenRecordDetailPath();
    if (openDetailPath) {
      const nextRow = this.rows.find((row) => row.file.path === openDetailPath);
      if (nextRow) refreshRecordDetailPanel(nextRow);
      else closeRecordDetailPanel();
    }
    if (focusedAddress && changedPaths.has(focusedAddress.rowPath)) {
      window.requestAnimationFrame(() => this.scrollCellIntoView(focusedAddress));
    }
    return true;
  }

  private updateRefreshIndicator(state = this.refreshCoordinator.getState()): void {
    const button = this.containerEl_?.querySelector<HTMLElement>(".db-database-refresh-button");
    if (!button) return;
    this.toolbarRenderer.updateDatabaseRefreshButton(button, {
      pendingRefreshCount: state.pendingCount,
      pendingRefreshUnknown: state.pendingUnknown,
      isRefreshingDatabase: state.refreshing,
    });
  }

  private setViewType(value: DatabaseViewType, viewIndex: number = this.currentViewIndex): void {
    const config = this.getConfig();
    if (!config) return;
    if (viewIndex !== this.currentViewIndex) {
      const view = this.getActiveDb().views[viewIndex];
      if (!view) return;
      view.viewType = value;
      this.initializeViewTypeDefaults(view, value);
      this.pendingUndoLabel = t("undo.viewTypeConfig");
      this.scheduleConfigSave();
      this.rerenderToolbar();
      return;
    }
    const descriptionScroll = this.saveDescriptionScrollPosition();
    if (config.viewType === "chart" && value !== "chart") this.chartRenderer.destroy();
    this.viewStateStore.persist(config, this.vs());
    config.viewType = value;
    this.viewStateStore.delete(this.currentDbIndex, this.currentViewIndex);
    this.viewState = undefined;
    this.viewStateStore.persist(config, this.vs());
    this.clearSelection();
    this.clearCellSelection();
    this.initializeViewTypeDefaults(config, value);
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

  private initializeViewTypeDefaults(config: ViewConfig, value: DatabaseViewType): void {
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
    if (value === "calendar") {
      config.calendarStartDateField = config.calendarStartDateField || getDefaultEventDateField(config);
    }
    if (value === "timeline") {
      const defaultDateField = getDefaultEventDateField(config);
      config.timelineStartDateField = config.timelineStartDateField || defaultDateField;
      config.calendarStartDateField = config.calendarStartDateField || defaultDateField;
    }
  }

  private updateToolbarViewConfig(label?: string): void {
    this.pendingUndoLabel = label || t("undo.viewConfig");
    this.scheduleConfigSave();
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
    for (const type of ["table", "board", "gallery", "list", "chart", "calendar", "timeline"] as const) {
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
      this.normalizeBoardSubgroupAfterGroupChange(config, value);
    } else {
      this.vs().groupByField = value;
    }
    // Update group button active state without full toolbar re-render
    const groupBtn = this.containerEl_?.querySelector(".db-group-btn");
    if (groupBtn) groupBtn.toggleClass("is-active", !!value);
    this.pendingUndoLabel = t("undo.groupConfig");
    this.viewStateStore.persist(config, this.vs());
    this.saveCurrentViewConfigInBackground();
    this.refresh({ viewport: "reset-top" });
  }

  private normalizeBoardSubgroupAfterGroupChange(config: ViewConfig, groupField: string): void {
    if (config.boardSubgroupField === groupField) config.boardSubgroupField = undefined;
  }

  private setShowEmptyGroups(field: string, value: boolean): void {
    const config = this.getConfig();
    if (!config) return;
    setShowEmptyGroups(config, field, value);
    this.pendingUndoLabel = t("undo.groupConfig");
    this.scheduleConfigSave();
    this.refresh({ viewport: "reset-top" });
  }

  private setGroupDateMode(field: string, mode: DateGroupMode): void {
    const config = this.getConfig();
    if (!config) return;
    const modes = { ...(config.dateGroupModes || {}) };
    if (mode === "exact") delete modes[field];
    else modes[field] = mode;
    config.dateGroupModes = Object.keys(modes).length > 0 ? modes : undefined;
    this.pendingUndoLabel = t("undo.groupConfig");
    this.scheduleConfigSave();
    this.refresh({ viewport: "reset-top" });
  }

  private setBoardSubgroupEnabled(enabled: boolean): void {
    const config = this.getConfig();
    if (!config || config.viewType !== "board") return;
    config.boardSubgroupEnabled = enabled;
    if (!enabled) config.boardSubgroupField = undefined;
    this.pendingUndoLabel = t("undo.boardSubgroupConfig");
    this.scheduleConfigSave();
    this.updateToolbarIndicators();
    this.refresh({ viewport: "reset-top" });
  }

  private setBoardSubgroupField(value: string): void {
    const config = this.getConfig();
    if (!config || config.viewType !== "board") return;
    const groupField = config.boardGroupField || this.vs().groupByField || this.getDefaultBoardField(config);
    const subgroupField = value && value !== groupField && value !== "file.name" ? value : "";
    config.boardSubgroupEnabled = true;
    config.boardSubgroupField = subgroupField || undefined;
    this.pendingUndoLabel = t("undo.boardSubgroupConfig");
    this.scheduleConfigSave();
    this.updateToolbarIndicators();
    this.refresh({ viewport: "reset-top" });
  }

  private toggleHeaderPopover(kind: HeaderPopoverKind, anchorEl: HTMLElement): void {
    this.chartToolbarRenderer.closePopover();
    this.calendarToolbarRenderer.closePopover();
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
      onChange: (label) => {
        this.pendingUndoLabel = label || t("undo.chartConfig");
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
      isActiveTarget: (target) => target instanceof HTMLElement &&
        Boolean(target.closest(".db-color-picker-popup, .db-dropdown-popover")),
    });
  }

  private handleOutsideClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest(".db-color-picker-popup")) return;
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
    this.calendarToolbarRenderer.closePopover();
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
    const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], col, config));
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
      this.refresh({ viewport: "reset-top" });
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
        row.createSpan({ cls: "db-group-order-name", text: formatGroupKeyDisplay(config, field, key) });
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
    const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], col, config));
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
    this.refresh({ viewport: "reset-top" });
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
    this.refresh({ viewport: "reset-top" });
  }

  /** Switch to a different view within the current database */
  private switchView(viewIndex: number): void {
    const descriptionScroll = this.saveDescriptionScrollPosition();
    this.closeHeaderPopovers();
    this.currentViewIndex = viewIndex;
    this.clearSelection();
    this.clearCellSelection();
    this.rerenderToolbar();
    this.refresh({ viewport: "reset-top" });
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
      calendarStartDateField: viewType === "calendar" || viewType === "timeline"
        ? getDefaultEventDateField({ schema: db.schema } as ViewConfig)
        : undefined,
      timelineStartDateField: viewType === "timeline"
        ? getDefaultEventDateField({ schema: db.schema } as ViewConfig)
        : undefined,
    };
    db.views.push(newView);
    this.currentViewIndex = db.views.length - 1;
    this.clearViewStateCache();
    this.saveCurrentViewConfigInBackground();
    this.rerenderToolbar();
    this.refresh({ viewport: "reset-top" });
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
    this.refresh({ viewport: "reset-top" });
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
    this.refresh({ viewport: "reset-top" });
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
    this.refresh({ viewport: "reset-top" });
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
    if (viewType === "calendar") return t("common.calendarView");
    if (viewType === "timeline") return t("common.timelineView");
    return t("common.tableView");
  }

  /** Add a new database via modal dialog */
  private async addDatabase(): Promise<void> {
    const modal = new AddDatabaseModal(this.app, this.statusPresets, this.defaultStatusPresetId);
    const result = await modal.openAndWait();
    if (!result) return;

    const dbName = this.getUniqueDatabaseName(result.name);
    const newDb = await buildDatabaseWithInferredColumns(this.app, result, dbName);
    if (!newDb) return;
    if (!await this.confirmNewDatabasePropertyTypeConflicts(newDb)) return;

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
    this.refresh({ viewport: "reset-top" });
  }

  private async confirmNewDatabasePropertyTypeConflicts(newDb: DatabaseConfig): Promise<boolean> {
    const existingEntries: MutablePropertyTypeConflictEntry[] = this.viewEntries.map((entry) => ({
      config: entry.config,
      sourcePath: entry.sourcePath,
    }));
    const result = await confirmNewDatabasePropertyTypeConflicts(this.app, existingEntries, { config: newDb }, {
      getDefaultStatusOptions: () => this.getDefaultStatusOptions(),
      getDefaultStatusPresetId: () => this.getDefaultStatusPresetId(),
    });
    if (!result) return false;
    for (const entry of result.changedEntries) {
      if (!entry.sourcePath) continue;
      const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
      if (!(file instanceof TFile)) continue;
      await this.dataSource.updateViewDefFile(file, entry.config, {
        dbId: entry.config.id,
        dbPath: entry.sourcePath,
        sourceInstanceId: this.instanceId,
      });
      this.configSnapshots.set(this.getConfigHistoryKey(entry as ViewEntry), this.cloneDatabaseConfig(entry.config));
    }
    return true;
  }

  private async duplicateCurrentDatabase(): Promise<void> {
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const duplicate = this.createDuplicatedDatabaseConfig(entry.config);

    const folder = this.getParentPath(entry.sourcePath) || this.databaseFolder;
    const file = await this.dataSource.createViewDefFile(folder, duplicate.name, duplicate);
    new Notice(t("notice.copiedDbFile", { path: file.path }));
    void this.onConfigChanged?.();
    this.rebuildViewEntries();
    const idx = this.viewEntries.findIndex((e) => e.sourcePath === file.path);
    this.currentDbIndex = idx >= 0 ? idx : this.viewEntries.length - 1;

    this.currentViewIndex = 0;
    this.clearViewStateCache();
    this.rerenderToolbar();
    this.refresh({ viewport: "reset-top" });
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
          await this.dataSource.trashNote(record.file, { sourceInstanceId: this.instanceId });
        } catch (e) {
          console.warn(`Failed to trash file ${record.file.path}:`, e);
        }
      }
    }

    // Both actions remove the live database file. Plugin trash additionally keeps a restorable snapshot.
    const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    if (file && file instanceof TFile) {
      try {
        await this.dataSource.trashNote(file, { sourceInstanceId: this.instanceId });
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
    this.refresh({ viewport: "reset-top" });
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
      } else if (col.type === "computed" || col.type === "rollup") {
        value = row.computed[col.type === "computed" ? col.computedKey || col.key : col.key];
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
      : col.type === "computed" || col.type === "rollup"
        ? row.computed[col.type === "computed" ? col.computedKey || col.key : col.key]
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
    const records = this.includePendingNewRecords(this.dataSource.getRecordsForConfig(this.getEffectiveConfig(db)));
    return this.buildRowsWithRelations(records, view, state, db);
  }

  private buildRowsWithRelations(
    records: NoteRecord[],
    view: ViewConfig,
    state: DatabaseViewState,
    database: DatabaseConfig | null | undefined,
    cacheTargets = false,
  ): RowData[] {
    const configured = database || this.getActiveDb();
    let derived: Map<string, Record<string, unknown>> | undefined;
    if (configured?.schema.columns.some((column) => column.type === "rollup")) {
      const entries = this.viewEntries;
      const databases = entries.map((entry) => entry.config);
      if (!databases.some((candidate) => candidate.id === configured.id)) databases.push(configured);
      const result = buildRelationRollups({
        app: this.app,
        sourceRecords: records,
        sourceDatabase: configured,
        databases,
        getRecordsForDatabase: (target) => this.dataSource.getRecordsForDatabase(target),
      });
      derived = result.valuesByPath;
      if (cacheTargets) {
        this.relationTargetPaths = result.targetPaths;
        const targetIds = new Set(
          configured.schema.columns
            .filter((column) => column.type === "relation")
            .map((column) => column.relationConfig?.targetDatabaseId)
            .filter((id): id is string => Boolean(id))
        );
        this.relationTargetDatabases = databases.filter((candidate) => targetIds.has(candidate.id));
        this.relationTargetDatabasePaths = new Set(
          entries.filter((entry) => targetIds.has(entry.config.id)).map((entry) => entry.sourcePath)
        );
      }
    } else if (cacheTargets) {
      this.relationTargetPaths.clear();
      this.relationTargetDatabases = [];
      this.relationTargetDatabasePaths.clear();
    }
    return this.rowPipeline.build(
      records,
      this.withBaseThisContext(view),
      state,
      this.app,
      derived,
    );
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
    this.refresh({ viewport: "reset-top" });
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
    // Prefer the stable database id so the copied embed survives file moves/renames.
    const locator = entry.config.id ? `dbId: ${entry.config.id}` : `dbPath: ${entry.sourcePath}`;
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
      this.refresh({ viewport: "reset-top" });
    }
  }

  /** Re-render toolbar with current state (used after view switch) */
  private rerenderToolbar(): void {
    if (!this.containerEl_) return;
    this.closeCalendarTimelineSearchResultsPanel();
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

  /** 日历/时间线视图的 toolbar 新建：注入今日日期作为开始日期，否则新建笔记无日期不在视图中显示 */
  private async createCalendarAwareCreateEntry(defaults?: Record<string, unknown>): Promise<void> {
    const config = this.getConfig();
    const viewType = config?.viewType;
    if ((viewType === "calendar" || viewType === "timeline") && !defaults) {
      const startField = viewType === "timeline"
        ? (config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config))
        : (config.calendarStartDateField || getDefaultEventDateField(config));
      if (startField) {
        const d = new Date();
        const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        void this.createBlankEntry({ [startField]: todayKey });
        return;
      }
    }
    void this.createBlankEntry(defaults);
  }

  private async createBlankEntry(
    defaults: Record<string, unknown> = {},
    position?: CreateEntryPosition,
    focusColumnKey?: string,
  ): Promise<TFile | null> {
    const config = this.getConfig();
    const entry = this.getCurrentEntry();
    if (!config || !entry) return null;
    let template: ParsedRecordTemplate | undefined;
    try {
      template = await this.loadNewRecordTemplate(entry.config);
    } catch (error) {
      new Notice(t("template.loadFailed", { error: String(error) }));
      return null;
    }
    const beforeConfig = this.cloneDatabaseConfig(entry.config);
    let registeredGroupOption = false;
    for (const [key, value] of Object.entries(defaults)) {
      const col = config.schema.columns.find((candidate) => candidate.key === key);
      if (!col) continue;
      const optionPlan = planOptionRegistration(col, value);
      if (optionPlan.addedOptions.length === 0) continue;
      col.statusOptions = optionPlan.options;
      if (optionPlan.clearPresetId) col.statusPresetId = undefined;
      registeredGroupOption = true;
    }
    let plan = this.buildCreateEntryPlan(config, defaults, template?.frontmatter);
    if (template?.engine === "core") {
      template = resolveCoreRecordTemplate(template, plan.filename);
      plan = this.buildCreateEntryPlan(config, defaults, template.frontmatter);
    }
    const diagnostics = [...plan.diagnostics];
    try {
      const file = await this.dataSource.createNote(
        plan.folder,
        plan.filename,
        plan.frontmatter,
        { sourceInstanceId: this.instanceId },
        template?.body || "",
      );
      if (template?.engine === "templater") {
        try {
          await this.runTemplaterOnCreatedFile(file);
        } catch (error) {
          new Notice(t("template.templaterFailed", { error: String(error) }));
        }
      }
      // 精确文件名约束被自动序号化时规则失效，记录风险（不阻止创建）。
      if (plan.hasExactFilenameRule && file.basename !== plan.filename) {
        diagnostics.push({ reason: "filenameSuffix", detail: file.basename });
      }
      this.pendingNewFilePath = file.path;
      this.pendingNewRowCellFocus = focusColumnKey
        ? { rowPath: file.path, colKey: focusColumnKey }
        : undefined;
      this.suppressDataReload(1200);
      this.pendingNewRecords.set(file.path, {
        file,
        frontmatter: { ...plan.frontmatter },
        expiresAt: Date.now() + 8000,
      });
      if (config.schema.computedFields.length > 0) {
        void this.syncComputedForFile(file, plan.frontmatter, undefined, config);
      }
      this.assignManualRankForNewEntry(config, file.path, position);
      if (registeredGroupOption) {
        try {
          const dbFile = this.app.vault.getAbstractFileByPath(entry.sourcePath);
          if (dbFile instanceof TFile) {
            this.suppressDataReload(2500);
            await this.dataSource.updateViewDefFile(dbFile, entry.config, this.getCurrentMutationTarget());
          }
          const after = this.cloneDatabaseConfig(entry.config);
          this.configSnapshots.set(this.getConfigHistoryKey(entry), after);
          this.pushHistory({
            type: "config",
            label: t("undo.createRow"),
            dbId: entry.config.id,
            dbPath: entry.sourcePath,
            viewId: config.id,
            before: beforeConfig,
            after,
            createdFiles: [{ path: file.path }],
          });
        } catch (err) {
          this.replaceDatabaseConfig(entry.config, beforeConfig);
          this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
          try {
            await this.dataSource.trashNote(file, { sourceInstanceId: this.instanceId });
          } catch (rollbackErr) {
            console.error("Note Database: failed to roll back created note after option config save failure", rollbackErr);
          }
          throw err;
        }
      } else {
        this.pushHistory({ type: "created", label: t("undo.createRow"), file: { path: file.path } });
      }
      this.showCreateEntryNotice(file, diagnostics);
      await this.refreshAfterSave();
      return file;
    } catch (err) {
      if (registeredGroupOption) {
        this.replaceDatabaseConfig(entry.config, beforeConfig);
        this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
      }
      new Notice(t("errors.createFailed", { error: String(err) }));
      return null;
    }
  }

  private buildCreateEntryPlan(
    config: ViewConfig,
    defaults: Record<string, unknown>,
    templateFrontmatter: Record<string, unknown> = {},
  ): CreateEntryPlan {
    const sourceConfig = this.getCreateContextConfig(config);
    // 上下文默认值（列默认 < 视图筛选/状态 < 用户/日历/分组 defaults）。来源规则由
    // planCreateEntry 单独叠加为最高优先级，并统一计算文件名、文件夹与诊断。
    // 显式 defaults 的 key 集合标记为用户意图：来源规则覆盖这些才记 conflictOverride；
    // 列默认空值不在集合内，覆盖不记（避免把分组显式传入的 false/""/[] 误判为列默认）。
    const explicitDefaults = this.mergeCreateDefaults(
      config,
      this.getDefaultFrontmatterFromViewFilters(config),
      defaults,
    );
    const intentionalContextKeys = new Set(Object.keys(explicitDefaults));
    const contextFrontmatter: Record<string, unknown> = {};
    for (const col of config.schema.columns) {
      if (isFileFieldKey(col.key) || col.type === "computed" || col.type === "rollup") continue;
      contextFrontmatter[col.key] = this.getDefaultCellValue(col);
    }
    Object.assign(contextFrontmatter, templateFrontmatter, explicitDefaults);
    return planCreateEntry({
      sourceRuleTree: getSourceRuleTree(sourceConfig.sourceRuleTree, sourceConfig.sourceRules, sourceConfig.sourceLogic),
      schema: config.schema,
      sourceFolder: this.normalizeVaultFolder(sourceConfig.sourceFolder || ""),
      newRecordFolder: sourceConfig.newRecordFolder ? this.normalizeVaultFolder(sourceConfig.newRecordFolder) : undefined,
      fallbackFolder: this.databaseFolder || "",
      contextFrontmatter,
      intentionalContextKeys,
      defaultFilename: t("defaults.untitledNote"),
      normalizeFolder: (folder) => this.normalizeVaultFolder(folder),
    });
  }

  private async loadNewRecordTemplate(database: DatabaseConfig): Promise<ParsedRecordTemplate | undefined> {
    const setting = database.newRecordTemplate;
    if (!setting?.path) return undefined;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(setting.path));
    if (!(file instanceof TFile)) throw new Error(t("template.missing"));
    const content = await this.app.vault.read(file);
    return parseRecordTemplate(content, setting.engine || "markdown");
  }

  private async runTemplaterOnCreatedFile(file: TFile): Promise<void> {
    type TemplaterRuntime = {
      templater?: {
        overwrite_file_commands?: (target: TFile) => Promise<unknown>;
      };
    };
    type PluginRegistry = { getPlugin?: (id: string) => unknown; plugins?: Record<string, unknown> };
    const registry = (this.app as unknown as { plugins?: PluginRegistry }).plugins;
    const plugin = (registry?.getPlugin?.("templater-obsidian") ||
      registry?.plugins?.["templater-obsidian"]) as TemplaterRuntime | undefined;
    const execute = plugin?.templater?.overwrite_file_commands;
    if (!execute) throw new Error(t("template.templaterUnavailable"));
    await execute.call(plugin.templater, file);
  }

  /** 创建成功通知显示最终 file.path；有诊断时说明可能不符合来源规则并给出原因概括。 */
  private showCreateEntryNotice(file: TFile, diagnostics: CreateEntryDiagnostic[]): void {
    if (diagnostics.length === 0) {
      new Notice(t("notice.createdNote", { path: file.path }));
      return;
    }
    const reasons = Array.from(new Set(diagnostics.map((d) => `createRuleRisk.${d.reason}`)))
      .map((key) => t(key))
      .join(t("common.enumerationJoin"));
    new Notice(t("notice.createdNoteRuleRisk", { path: file.path, reasons }));
  }

  private async createCalendarTimelineEntry(
    config: ViewConfig,
    dateKey: string,
    options?: CalendarTimelineCreateOptions
  ): Promise<void> {
    const createKey = `${config.id || config.name}:${dateKey}:${options?.endDateKey ?? ""}:${options?.startTimeMinutes ?? ""}:${options?.endTimeMinutes ?? ""}:${options?.groupField ?? ""}:${options?.groupKey ?? ""}`;
    if (this.pendingCalendarTimelineCreates.has(createKey)) return;
    const startField = config.viewType === "timeline"
      ? (config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config))
      : (config.calendarStartDateField || getDefaultEventDateField(config));
    const endField = config.viewType === "timeline"
      ? (config.timelineEndDateField || config.calendarEndDateField)
      : config.calendarEndDateField;
    const startCol = this.getWritableDateColumn(config, startField);
    if (!startCol) {
      new Notice(t("calendar.noWritableDateField"));
      return;
    }
    const endCol = this.getWritableDateColumn(config, endField);

    // 单侧 datetime（一端 date 一端 datetime）或要写时间到 date 列 → 把 date 端转 datetime。
    // 否则 mixed coerce 产生 00:00→00:00 零宽 invalid（A1 隐藏后用户看不到新建条目），
    // 或带时间值污染 date 列、mixed 让 getCalendarEventTiming 判 all-day（进全天区而非时间网格）。
    // changeColumnType 原地更新 col.type，下方 getColumnDisplayType 会读到转换后的 "datetime"。
    // 用户拒绝则不创建。
    const needStartConvert = startCol.type === "date" && (
      options?.startTimeMinutes != null || (endCol != null && endCol.type === "datetime")
    );
    const needEndConvert = endCol != null && endCol.type === "date" && (
      options?.endTimeMinutes != null || startCol.type === "datetime"
    );
    if (needStartConvert || needEndConvert) {
      const ok = await this.ensureCalendarTimelineDateTimeFields([
        needStartConvert ? startCol : null,
        needEndConvert ? endCol : null,
      ]);
      if (!ok) return;
    }

    if (endCol) {
      this.showCalendarTimelineSameDateFieldNotice(startCol, endCol);
    }
    // 月视图全天新增（无显式时间）对 datetime 列写显式时刻：开始 T00:00、结束 T23:59，
    // 形成合法「全天 datetime」事件；date 列（两端都 date）写纯日期（全天条）。
    // 显式 options（周/日视图拖拽创建带时间）优先。
    const startIsDateTime = getColumnDisplayType(startCol, config.schema.computedFields) === "datetime";
    const startMinutes = options?.startTimeMinutes ?? (startIsDateTime ? 0 : undefined);
    const defaults: Record<string, unknown> = {
      [this.getFrontmatterWriteKey(startCol)]: startMinutes != null
        ? this.formatCalendarDateTimeValue(dateKey, startMinutes)
        : dateKey,
    };
    if (endCol) {
      const endDateKey = options?.endDateKey || dateKey;
      const endIsDateTime = getColumnDisplayType(endCol, config.schema.computedFields) === "datetime";
      // datetime 结束列 + 同天：默认 23:59（全天终点），与开始 00:00 形成合法区间。
      const endMinutes = options?.endTimeMinutes ?? (endIsDateTime && endDateKey === dateKey ? 23 * 60 + 59 : undefined);
      defaults[this.getFrontmatterWriteKey(endCol)] = endMinutes != null
        ? this.formatCalendarDateTimeValue(endDateKey, endMinutes)
        : endDateKey;
    }
    this.applyCalendarTimelineCreateGroupDefaults(config, defaults, options);
    this.pendingCalendarTimelineCreates.add(createKey);
    try {
      await this.createBlankEntry(defaults);
    } finally {
      this.pendingCalendarTimelineCreates.delete(createKey);
    }
  }

  private applyCalendarTimelineCreateGroupDefaults(config: ViewConfig, defaults: Record<string, unknown>, options: CalendarTimelineCreateOptions | undefined): void {
    const field = options?.groupField;
    const groupKey = options?.groupKey;
    if (!field || groupKey == null) return;
    const col = config.schema.columns.find((candidate) => candidate.key === field);
    if (!col || col.type === "computed" || col.type === "rollup" || isReadonlyFileField(col.key)) return;
    const writeKey = this.getFrontmatterWriteKey(col);
    if (col.key === "file.tags") {
      defaults[writeKey] = isEmptyGroupId(groupKey) ? [] : toValidObsidianTagValues(groupKey);
      return;
    }
    if (col.type === "multi-select") {
      defaults[writeKey] = isEmptyGroupId(groupKey) ? [] : toMultiSelectValuesForKey(col.key, normalizeOptionValueForKey(col.key, groupKey));
      return;
    }
    if (isEmptyGroupId(groupKey)) {
      defaults[writeKey] = null;
      return;
    }
    if (col.type === "checkbox") {
      defaults[writeKey] = toBooleanValue(groupKey);
      return;
    }
    if (col.type === "select" || col.type === "status") {
      defaults[writeKey] = normalizeOptionValueForKey(col.key, groupKey);
      return;
    }
    defaults[writeKey] = groupKey;
  }

  private async updateCalendarTimelineDates(row: RowData, changes: CalendarTimelineDateChange): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    const writeStart = changes.changedEdge !== "end";
    const writeEnd = changes.changedEdge !== "start";
    const startCol = writeStart ? this.getWritableDateColumn(config, changes.startField) : null;
    if (writeStart && !startCol) {
      new Notice(t("calendar.noWritableDateField"));
      return;
    }
    const endCol = writeEnd ? this.getWritableDateColumn(config, changes.endField) : null;
    if (writeEnd && changes.endField && changes.endDateKey && !endCol) {
      new Notice(t("calendar.noWritableDateField"));
      return;
    }
    const startColForNotice = this.getWritableDateColumn(config, changes.startField);
    const endColForNotice = changes.endField ? this.getWritableDateColumn(config, changes.endField) : null;
    this.showCalendarTimelineSameDateFieldNotice(startColForNotice, endColForNotice);
    const writesTime = changes.startTimeMinutes != null || changes.endTimeMinutes != null;
    if (writesTime && !await this.ensureCalendarTimelineDateTimeFields([writeStart ? startCol : null, writeEnd ? endCol : null])) return;

    const cellChanges: CellEditChange[] = [];
    if (writeStart && startCol) {
      const startValue = changes.startTimeMinutes != null
        ? this.formatCalendarDateTimeValue(changes.startDateKey, changes.startTimeMinutes)
        : changes.startDateKey;
      const startChange = this.createCurrentCellChange(row, startCol, startValue);
      if (!this.areCellValuesEqual(startChange.oldValue, startChange.newValue)) cellChanges.push(startChange);
    }

    if (writeEnd && endCol && changes.endDateKey) {
      const endValue = changes.endTimeMinutes != null
        ? this.formatCalendarDateTimeValue(changes.endDateKey, changes.endTimeMinutes)
        : changes.endDateKey;
      const endChange = this.createCurrentCellChange(row, endCol, endValue);
      if (!this.areCellValuesEqual(endChange.oldValue, endChange.newValue)) cellChanges.push(endChange);
    }
    if (cellChanges.length === 0) {
      new Notice(t("calendar.noDateChange"));
      return;
    }
    try {
      await this.applyCellChanges(cellChanges, t("undo.timelineDates"));
    } catch (err) {
      new Notice(t("errors.updateFailed", { error: String(err) }));
    }
  }

  private showCalendarTimelineSameDateFieldNotice(startCol: ColumnDef | null, endCol: ColumnDef | null): void {
    if (!startCol || !endCol) return;
    if (this.getFrontmatterWriteKey(startCol) !== this.getFrontmatterWriteKey(endCol)) return;
    const now = Date.now();
    if (now - this.lastCalendarTimelineSameDateFieldNoticeAt < 5000) return;
    this.lastCalendarTimelineSameDateFieldNoticeAt = now;
    new Notice(t("calendar.sameDateFieldNotice", { field: startCol.label || startCol.key }));
  }

  private async ensureCalendarTimelineDateTimeFields(columns: Array<ColumnDef | null>): Promise<boolean> {
    const dateColumns = columns
      .filter((col): col is ColumnDef => Boolean(col && col.type === "date"))
      .filter((col, index, all) => all.findIndex((candidate) => candidate.key === col.key) === index);
    if (dateColumns.length === 0) return true;
    const fields = dateColumns.map((col) => col.label || col.key).join(", ");
    if (!await confirmWithModal(this.app, {
      title: t("calendar.convertDateTimeTitle"),
      message: t("calendar.convertDateTimeMessage", { fields }),
      confirmText: t("calendar.convertDateTimeConfirm"),
    })) return false;
    for (const col of dateColumns) {
      await this.changeColumnType(col, "datetime");
    }
    return true;
  }

  private async ensureTimelineDayDateTimeFields(config: ViewConfig): Promise<boolean> {
    const nonDateTimeColumns = getTimelineDayNonDateTimeColumns(config);
    if (nonDateTimeColumns.length === 0) return true;
    const hasReadonlyColumn = nonDateTimeColumns.some((col) => col.type !== "date" || !this.getWritableDateColumn(config, col.key));
    if (hasReadonlyColumn) {
      new Notice(t("calendar.noWritableDateField"));
      return false;
    }
    return this.ensureCalendarTimelineDateTimeFields(nonDateTimeColumns);
  }

  private getWritableDateColumn(config: ViewConfig, field: string | undefined): ColumnDef | null {
    if (!field) return null;
    const col = config.schema.columns.find((candidate) => candidate.key === field);
    if (!col || col.type === "computed" || col.type === "rollup" || isReadonlyFileField(col.key)) return null;
    return isDateLikeColumnType(getColumnDisplayType(col, config.schema.computedFields)) ? col : null;
  }

  private formatCalendarDateTimeValue(dateKey: string, timeMinutes: number): string {
    const clamped = Math.max(0, Math.min(1439, Math.round(timeMinutes)));
    const hours = Math.floor(clamped / 60);
    const minutes = clamped % 60;
    return `${dateKey}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  private getDefaultCellValue(col: ColumnDef): unknown {
    if (col.type === "status" && !col.statusOptions?.length) {
      return this.getDefaultStatusOptions()[0]?.value || "";
    }
    return getColumnDefaultCellValue(col);
  }

  private assignManualRankForNewEntry(
    config: ViewConfig,
    filePath: string,
    position?: CreateEntryPosition,
    scheduleSave = true,
  ): boolean {
    if (!config.manualOrder?.ranks || Object.keys(config.manualOrder.ranks).length === 0) {
      if (!position?.beforePath && !position?.afterPath) return false;
      this.ensureManualRanks(config);
    }
    const manualOrder = config.manualOrder;
    const ranks = manualOrder?.ranks;
    if (!manualOrder || !ranks) return false;
    const fallbackLastPath = this.rows.length > 0 ? this.rows[this.rows.length - 1].file.path : undefined;
    const bounds = resolveNewEntryRankBounds(ranks, position, fallbackLastPath);
    let newRank = rankBetween(bounds.lower, bounds.upper);

    if (newRank === null) {
      manualOrder.ranks = rebalanceRanks(ranks);
      const rebalanced = manualOrder.ranks;
      const rebalancedBounds = resolveNewEntryRankBounds(rebalanced, position, fallbackLastPath);
      newRank = rankBetween(rebalancedBounds.lower, rebalancedBounds.upper);
    }

    if (!newRank) return false;
    const targetRanks = manualOrder.ranks;
    if (!targetRanks) return false;
    targetRanks[filePath] = newRank;
    if (scheduleSave) this.scheduleConfigSave({ skipHistory: true });
    return true;
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

  private getStatusPresetsForLevel(level: "database" | "view", db: DatabaseConfig = this.getActiveDb(), view: ViewConfig = this.getActiveView()): StatusPresetDef[] {
    return normalizeStatusPresets(level === "database" ? (db.statusPresets || []) : (view.statusPresets || []), []);
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
      if (col?.type === "computed" || col?.type === "rollup") continue;
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
    // View-level source rules apply only when the switch is ON, mirroring getEffectiveConfig.
    const viewEnabled = config.viewSourceRulesEnabled === true;
    return {
      ...config,
      sourceFolder: config.sourceFolder || db.sourceFolder || "",
      sourceRules: (viewEnabled ? config.sourceRules : undefined) || db.sourceRules,
      sourceLogic: (viewEnabled ? config.sourceLogic : undefined) || db.sourceLogic,
      sourceRuleTree: mergeDbAndViewSourceRuleTrees(db, viewEnabled ? config : undefined),
      newRecordFolder: config.newRecordFolder || db.newRecordFolder,
      schema: config.schema || db.schema,
    };
  }

  /** Resolve legacy view-level source settings without widening a database query to the vault root. */
  private getEffectiveConfig(dbConfig: DatabaseConfig, viewConfig: ViewConfig = this.getConfig()): DatabaseConfig {
    return {
      ...dbConfig,
      baseThisFilePath: this.getCurrentEntry()?.sourcePath,
      sourceFolder: this.normalizeVaultFolder(dbConfig.sourceFolder || viewConfig.sourceFolder || ""),
      sourceRules: dbConfig.sourceRules || (viewConfig.viewSourceRulesEnabled === true ? viewConfig.sourceRules : undefined),
      sourceLogic: dbConfig.sourceLogic || (viewConfig.viewSourceRulesEnabled === true ? viewConfig.sourceLogic : undefined),
      // View-level source rules apply only when the switch is ON (enable/disable, not just
      // visibility). Each side is normalized to a tree first so a legacy flat side is never dropped.
      sourceRuleTree: mergeDbAndViewSourceRuleTrees(
        dbConfig,
        viewConfig.viewSourceRulesEnabled === true ? viewConfig : undefined
      ),
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
    this.invalidateActiveBulkEditor();
    if (this.cellSelection) this.clearCellSelection();
    const path = row.file.path;
    this.lastSelectedRowPath = applyRangeSelection({
      orderedIds: this.getOrderedSelectionRowPaths(),
      selectedIds: this.selectedRows,
      anchorId: this.lastSelectedRowPath,
      targetId: path,
      selected,
      range: Boolean(event?.shiftKey || this.isPhoneLayout()),
    });
    this.renderSelectionStatusBar();
    this.syncSelectionControls();
  }

  private toggleRowsSelected(rows: RowData[], selected: boolean): void {
    this.invalidateActiveBulkEditor();
    if (this.cellSelection) this.clearCellSelection();
    for (const row of rows) {
      if (selected) this.selectedRows.add(row.file.path);
      else this.selectedRows.delete(row.file.path);
    }
    this.lastSelectedRowPath = this.selectedRows.size > 0 ? rows[rows.length - 1]?.file.path || this.lastSelectedRowPath : null;
    this.renderSelectionStatusBar();
    this.syncSelectionControls();
  }

  private getOrderedSelectionRowPaths(): string[] {
    const ordered = this.getRenderedSelectionRows();
    const source = ordered.length > 0 ? ordered : this.rows;
    return source.map((candidate) => candidate.file.path);
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
    this.invalidateActiveBulkEditor();
    if (this.selectedRows.size === 0 && this.lastSelectedRowPath == null) return;
    this.selectedRows.clear();
    this.lastSelectedRowPath = null;
    this.bulkEditingColumnKey = undefined;
    this.renderSelectionStatusBar();
    this.syncSelectionControls();
  }

  private clearCellSelection(): void {
    this.invalidateActiveBulkEditor();
    if (!this.cellSelection) return;
    this.cellSelection = null;
    this.isSelectingCells = false;
    this.showCellFillInput = false;
    this.pendingCellFillDraft = null;
    this.bulkEditingColumnKey = undefined;
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
  }

  private getCellSelectionActiveAddress(): CellAddress {
    if (!this.cellSelection) throw new Error("Cell selection is not active");
    return this.cellSelection.active ?? this.cellSelection.focus;
  }

  private selectEntireTableGrid(): void {
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    if (!this.cellSelection || rowPaths.length === 0 || colKeys.length === 0) return;
    const active = this.getCellSelectionActiveAddress();
    this.cellSelection = {
      anchor: { rowPath: rowPaths[0], colKey: colKeys[0] },
      focus: { rowPath: rowPaths[rowPaths.length - 1], colKey: colKeys[colKeys.length - 1] },
      active,
    };
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
  }

  private selectFocusedTableRow(): void {
    const colKeys = this.getRenderedTableColumnKeys();
    if (!this.cellSelection || colKeys.length === 0) return;
    const active = this.getCellSelectionActiveAddress();
    this.cellSelection = {
      anchor: { rowPath: active.rowPath, colKey: colKeys[0] },
      focus: { rowPath: active.rowPath, colKey: colKeys[colKeys.length - 1] },
      active,
    };
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
  }

  private selectFocusedTableColumn(): void {
    const rowPaths = this.getRenderedTableRowPaths();
    if (!this.cellSelection || rowPaths.length === 0) return;
    const active = this.getCellSelectionActiveAddress();
    this.cellSelection = {
      anchor: { rowPath: rowPaths[0], colKey: active.colKey },
      focus: { rowPath: rowPaths[rowPaths.length - 1], colKey: active.colKey },
      active,
    };
    this.renderCellSelectionClasses();
    this.renderSelectionStatusBar();
  }

  private setupTableCellSelection(td: HTMLElement, row: RowData, col: ColumnDef): void {
    const address = { rowPath: row.file.path, colKey: col.key };
    const activeAddress = this.cellSelection ? this.getCellSelectionActiveAddress() : null;
    const isFocusCell = activeAddress?.rowPath === address.rowPath
      && activeAddress.colKey === address.colKey;
    td.toggleClass("db-cell-range-selected", this.isCellSelected(address.rowPath, address.colKey));
    td.toggleClass("db-cell-focus", isFocusCell);
    td.toggleClass("db-cell-cut-source", Boolean(this.pendingCellCut?.addressKeys.has(`${address.rowPath}\u0000${address.colKey}`)));
    td.tabIndex = -1;
    const hasGridTabStop = this.containerEl_?.querySelector(
      'td[data-note-database-row-path][data-note-database-column-key][tabindex="0"]'
    );
    td.tabIndex = isFocusCell || (!this.cellSelection && !hasGridTabStop) ? 0 : -1;
    td.addEventListener("focus", () => {
      const active = this.cellSelection ? this.getCellSelectionActiveAddress() : null;
      if (active?.rowPath === address.rowPath && active.colKey === address.colKey) return;
      this.clearSelection();
      this.cellSelection = { anchor: address, focus: address };
      this.renderCellSelectionClasses();
      this.renderSelectionStatusBar();
    });
    td.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (this.isInteractiveCellTarget(event.target)) return;
      this.invalidateActiveBulkEditor();
      event.preventDefault();
      event.stopPropagation();
      if (this.isPhoneLayout()) {
        if (this.cellSelection) {
          this.cellSelection = { anchor: this.cellSelection.anchor, focus: address, active: address };
        } else {
          this.clearSelection();
          this.cellSelection = { anchor: address, focus: address };
        }
        this.isSelectingCells = false;
        this.renderCellSelectionClasses();
        this.renderSelectionStatusBar();
        return;
      }
      if (event.shiftKey && this.cellSelection) {
        this.cellSelection = { anchor: this.cellSelection.anchor, focus: address, active: address };
      } else {
        this.clearSelection();
        this.cellSelection = { anchor: address, focus: address };
      }
      this.isSelectingCells = true;
      this.renderCellSelectionClasses();
      this.renderSelectionStatusBar();
      td.focus({ preventScroll: true });
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
        active: { rowPath: row.file.path, colKey: col.key },
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

  private getPendingCellCutAddressSet(): Set<string> {
    return this.pendingCellCut?.addressKeys || new Set<string>();
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

  private getRenderedTableRowCreateContext(rowPath: string, anchor?: HTMLElement): RowCreateContext | undefined {
    if (!this.containerEl_) return undefined;
    const anchoredRow = anchor?.closest<HTMLElement>("tr[data-note-database-row-path]");
    const active = window.activeDocument.activeElement;
    const focusedRow = isHTMLElement(active)
      ? active.closest<HTMLElement>("tr[data-note-database-row-path]")
      : null;
    let rowEl = anchoredRow?.dataset.noteDatabaseRowPath === rowPath ? anchoredRow : null;
    if (!rowEl && focusedRow?.dataset.noteDatabaseRowPath === rowPath) rowEl = focusedRow;
    rowEl ||= this.containerEl_.querySelector<HTMLElement>(
      `.db-table tbody tr[data-note-database-row-path="${CSS.escape(rowPath)}"]`
    );
    if (!rowEl) return undefined;
    const tbody = rowEl.closest("tbody");
    const visibleRows = tbody
      ? Array.from(tbody.querySelectorAll<HTMLElement>("tr[data-note-database-row-path]"))
          .map((element) => this.rows.find((row) => row.file.path === element.dataset.noteDatabaseRowPath))
          .filter((row): row is RowData => Boolean(row))
      : this.rows;
    const groupField = rowEl.getAttribute("data-note-database-group-field");
    const groupKey = rowEl.getAttribute("data-note-database-group-key");
    return {
      visibleRows,
      groups: groupField != null && groupKey != null ? [{ field: groupField, key: groupKey }] : undefined,
    };
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
    const cutSources = this.getPendingCellCutAddressSet();
    const activeAddress = this.cellSelection ? this.getCellSelectionActiveAddress() : null;
    const focusKey = activeAddress
      ? activeAddress.rowPath + "\u0000" + activeAddress.colKey
      : null;
    const cells = Array.from(this.containerEl_.querySelectorAll<HTMLElement>(
      "td[data-note-database-row-path][data-note-database-column-key]"
    ));
    let foundFocus = false;
    cells.forEach((cell) => {
      const rowPath = cell.dataset.noteDatabaseRowPath;
      const colKey = cell.dataset.noteDatabaseColumnKey;
      const key = rowPath && colKey ? rowPath + "\u0000" + colKey : null;
      const isFocus = Boolean(key && key === focusKey);
      cell.toggleClass("db-cell-range-selected", Boolean(key && selected.has(key)));
      cell.toggleClass("db-cell-cut-source", Boolean(key && cutSources.has(key)));
      cell.toggleClass("db-cell-focus", isFocus);
      cell.tabIndex = isFocus ? 0 : -1;
      if (isFocus) foundFocus = true;
    });
    if (!foundFocus && !this.cellSelection && cells[0]) cells[0].tabIndex = 0;
    if (this.cellSelection) {
      const active = this.getCellSelectionActiveAddress();
      const rowIndex = this.getRenderedTableRowPaths().indexOf(active.rowPath);
      const colIndex = this.getRenderedTableColumnKeys().indexOf(active.colKey);
      if (rowIndex >= 0 && colIndex >= 0) this.lastCellFocusPosition = { rowIndex, colIndex };
    }
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
      await this.dataSource.trashNote(row.file, { sourceInstanceId: this.instanceId });
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
        this.refresh({ viewport: "reset-top" });
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
        this.refresh({ viewport: "reset-top" });
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
        setColumnsVisible: (changes) => this.setColumnsVisible(changes),
        setAllColumnsVisible: (visible) => this.setAllColumnsVisible(visible),
        moveColumn: (key, offset) => this.columnOperations.moveColumn(key, offset),
        moveColumnTo: (key, targetKey, placement) => this.columnOperations.moveColumnTo(key, targetKey, placement),
        toggleColumnWrap: (col) => this.toggleColumnWrap(col),
        editColumn: (col) => this.showColumnRenameModal(col),
        addColumn: () => { void this.columnOperations.appendColumn(); },
        addFileFieldColumn: (key) => { void this.columnOperations.addFileFieldColumn(key); },
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
      onChange: (label) => {
        this.pendingUndoLabel = label || t("undo.viewConfig");
        this.scheduleConfigSave();
        this.refresh();
      },
      onViewTypeChange: (value) => this.setViewType(value),
      onDatabaseChange: (label) => {
        this.pendingUndoLabel = label || t("undo.viewConfig");
        this.scheduleConfigSave();
        this.updateDatabaseChrome();
        this.updateStickyOffsets();
        this.refresh();
      },
      createRecordIconField: (target) => this.openCreateRecordIconFieldModal(target),
      onComputedSyncModeChange: () => this.rerenderToolbar(),
      onComputedFrontmatterCleanup: () => this.showComputedFrontmatterCleanupModal(),
      statusPresets: this.getStatusPresetsForLevel("database", db),
      defaultStatusPresetId: resolveDefaultStatusPresetId(
        this.getStatusPresetsForLevel("database", db),
        db.defaultStatusPresetId
      ),
      statusPresetHelpText: t("viewConfig.statusPreset.help"),
      managedStatusPresetCount: db.statusPresets?.length || 0,
      onDefaultStatusPresetChange: (value) => {
        db.defaultStatusPresetId = value || undefined;
        this.pendingUndoLabel = t("undo.statusPresetConfig");
        this.scheduleConfigSave();
      },
      onManageStatusPresets: () => this.showDatabaseStatusPresetManager(),
      viewStatusPresets: this.getStatusPresetsForLevel("view", db, config),
      defaultViewStatusPresetId: resolveDefaultStatusPresetId(
        this.getStatusPresetsForLevel("view", db, config),
        config.defaultStatusPresetId
      ),
      viewStatusPresetHelpText: t("viewConfig.statusPreset.help"),
      managedViewStatusPresetCount: config.statusPresets?.length || 0,
      onDefaultViewStatusPresetChange: (value) => {
        config.defaultStatusPresetId = value || undefined;
        this.pendingUndoLabel = t("undo.statusPresetConfig");
        this.scheduleConfigSave();
      },
      onManageViewStatusPresets: () => this.showViewStatusPresetManager(),
    }, this.getHeaderPopoverAnchor("view"));
  }

  private getRecentRecordIcons(): string[] {
    return getNoteDatabasePlugin(this.app)?.settings.recentRecordIcons || [];
  }

  private async setRecentRecordIcons(recent: string[]): Promise<void> {
    const plugin = getNoteDatabasePlugin(this.app);
    if (!plugin) return;
    plugin.settings.recentRecordIcons = recent;
    await plugin.saveSettings();
  }

  private openDatabaseIconPicker(anchor: HTMLElement): void {
    const database = this.getActiveDb();
    if (!database) return;
    openIconPickerPopover({
      anchor,
      current: database.icon,
      recent: this.getRecentRecordIcons(),
      onRecentChange: (recent) => this.setRecentRecordIcons(recent),
      onSelect: async (value) => {
        const db = this.getActiveDb();
        if (!db) return;
        db.icon = value || undefined;
        this.pendingUndoLabel = t("recordIcon.icons");
        await this.saveConfigImmediately();
        this.rerenderToolbar();
      },
    });
  }

  private async toggleDatabaseIcon(): Promise<void> {
    const plugin = getNoteDatabasePlugin(this.app);
    if (!plugin) return;
    plugin.settings.showDatabaseIcon = plugin.settings.showDatabaseIcon === false;
    await plugin.saveSettings();
    this.rerenderToolbar();
  }

  private getCreateEntryDefaultsForRow(row: RowData, context?: RowCreateContext): Record<string, unknown> {
    const config = this.getConfig();
    if (!config) return {};
    const viewType = config.viewType;
    if (viewType === "calendar" || viewType === "timeline" || viewType === "chart") return {};
    if (context?.groups?.length) {
      const defaults: Record<string, unknown> = {};
      for (const group of context.groups) {
        if (isFileFieldKey(group.field) || isComputedGroupField(config, group.field)) continue;
        const groupDefaults = resolveGroupCreateDefaults(config, group.field, group.key);
        for (const [key, value] of Object.entries(groupDefaults)) defaults[key] = value;
      }
      return defaults;
    }
    const groupField = this.getActiveGroupField(config);
    if (!groupField || isFileFieldKey(groupField) || isComputedGroupField(config, groupField)) return {};
    const col = config.schema.columns.find((c) => c.key === groupField);
    if (!col) return {};
    const defaults = this.resolveRowGroupDefaults(row, config, groupField, col);
    if (viewType === "board" && config.boardSubgroupField && !isFileFieldKey(config.boardSubgroupField) && !isComputedGroupField(config, config.boardSubgroupField)) {
      const subCol = config.schema.columns.find((c) => c.key === config.boardSubgroupField);
      if (subCol) {
        const subDefaults = this.resolveRowGroupDefaults(row, config, config.boardSubgroupField, subCol);
        for (const [k, v] of Object.entries(subDefaults)) defaults[k] = v;
      }
    }
    return defaults;
  }

  private resolveRowGroupDefaults(row: RowData, config: ViewConfig, field: string, col: ColumnDef): Record<string, unknown> {
    const groups = this.queryEngine.groupBy([row], field, [], col, config);
    const groupKey = groups.find((g) => g.rows.includes(row))?.key;
    if (groupKey == null) return {};
    return resolveGroupCreateDefaults(config, field, groupKey);
  }

  private renderRowRecordIcon(
    parent: HTMLElement,
    row: RowData,
    config: ViewConfig,
    compact = false,
    readOnly = false,
  ): HTMLElement | null {
    if (config.showRecordIcon !== true) return null;
    const database = this.getActiveDb();
    if (!database) return null;
    const field = resolveRecordIconField(database, config);
    const token = field ? row.frontmatter[field] : undefined;
    const icon = renderRecordIcon(parent, token, {
      compact,
      editable: !readOnly,
      tooltip: t("recordIcon.icons"),
      onClick: (anchor) => this.openRecordIconPicker(anchor, row, config),
    });
    if (icon && !readOnly && !Platform.isMobile) {
      icon.addEventListener("contextmenu", (event) => this.openRecordIconContextMenu(event, icon, row, config));
    }
    return icon;
  }

  private openRecordIconPicker(anchor: HTMLElement, row: RowData, config: ViewConfig): void {
    const database = this.getActiveDb();
    if (!database) return;
    const field = resolveRecordIconField(database, config);
    if (!field) {
      this.openRecordIconFieldMenu(anchor, row, config, true);
      return;
    }
    const column = config.schema.columns.find((candidate) => candidate.key === field);
    if (!column) return;
    openIconPickerPopover({
      anchor,
      current: typeof row.frontmatter[field] === "string" ? row.frontmatter[field] : undefined,
      recent: this.getRecentRecordIcons(),
      onRecentChange: (recent) => this.setRecentRecordIcons(recent),
      onConfigureField: () => this.openRecordIconFieldMenu(this.findRecordIconAnchor(row) || anchor, row, config, true),
      onSelect: async (value) => {
        await this.saveCellValueWithHistory(row, column, value);
      },
    });
  }

  private openRecordIconFieldMenu(anchor: HTMLElement, row: RowData, config: ViewConfig, reopenPicker: boolean): void {
    const database = this.getActiveDb();
    if (!database) return;
    const columns = this.orderRecordIconColumns(
      config.schema.columns.filter((column) => column.type === "text" && !column.key.startsWith("file.")),
      resolveRecordIconField(database, config),
    );
    const databaseFieldLabel = database.recordIconField
      ? config.schema.columns.find((column) => column.key === database.recordIconField)?.label || database.recordIconField
      : t("common.notSet");
    const inheritedLabel = t("recordIcon.followDatabaseField", { field: databaseFieldLabel });
    const value = config.recordIconFieldOverrideEnabled === true
      ? `view:${config.recordIconField || ""}`
      : "__inherit_record_icon_field__";
    openDropdownMenu({
      anchor,
      label: t("recordIcon.configureField"),
      value,
      searchable: true,
      options: [
        { value: "__inherit_record_icon_field__", text: inheritedLabel, icon: "database", section: t("recordIcon.currentViewField") },
        ...columns.map((column) => ({ value: `view:${column.key}`, text: column.label || column.key, icon: getPropertyDropdownIcon(getColumnDisplayType(column, config.schema.computedFields)), section: t("recordIcon.currentViewField") })),
        { value: "__create_view_record_icon_field__", text: t("recordIcon.createViewField"), icon: "plus", section: t("recordIcon.currentViewField"), preserveValueOnSelect: true },
        ...columns.map((column) => ({ value: `database:${column.key}`, text: column.label || column.key, icon: getPropertyDropdownIcon(getColumnDisplayType(column, config.schema.computedFields)), section: t("recordIcon.databaseDefaultField") })),
        { value: "__create_database_record_icon_field__", text: t("recordIcon.createDatabaseField"), icon: "plus", section: t("recordIcon.databaseDefaultField"), preserveValueOnSelect: true },
      ],
      renderIcon: (parent, icon) => {
        if (!renderDropdownPropertyTypeIcon(parent, icon)) setIcon(parent, icon);
      },
      onChange: (nextValue) => {
        const reopen = () => {
          this.refresh();
          if (!reopenPicker || !resolveRecordIconField(database, config)) return;
          window.setTimeout(() => this.openRecordIconPicker(this.findRecordIconAnchor(row) || anchor, row, config), 0);
        };
        if (nextValue === "__create_view_record_icon_field__" || nextValue === "__create_database_record_icon_field__") {
          const target = nextValue === "__create_view_record_icon_field__" ? "view" : "database";
          this.openCreateRecordIconFieldModal(target, reopen);
          return;
        }
        if (nextValue === "__inherit_record_icon_field__") {
          config.recordIconFieldOverrideEnabled = undefined;
          config.recordIconField = undefined;
        } else if (nextValue.startsWith("view:")) {
          config.recordIconFieldOverrideEnabled = true;
          config.recordIconField = nextValue.slice("view:".length) || undefined;
        } else if (nextValue.startsWith("database:")) {
          database.recordIconField = nextValue.slice("database:".length) || undefined;
          config.recordIconFieldOverrideEnabled = undefined;
          config.recordIconField = undefined;
        } else return;
        this.pendingUndoLabel = t("recordIcon.field");
        void this.saveConfigImmediately().then(reopen);
      },
    });
  }

  private openRecordIconContextMenu(event: MouseEvent, anchor: HTMLElement, row: RowData, config: ViewConfig): void {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(t("recordIcon.changeRecord"))
      .setIcon("smile-plus")
      .onClick(() => this.openRecordIconPicker(anchor, row, config)));
    menu.addItem((item) => item
      .setTitle(t("recordIcon.configureField"))
      .setIcon("settings-2")
      .onClick(() => this.openRecordIconFieldMenu(anchor, row, config, false)));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t("recordIcon.hideInView"))
      .setIcon("eye-off")
      .onClick(() => this.toggleCurrentViewRecordIcon()));
    menu.showAtMouseEvent(event);
  }

  private orderRecordIconColumns(columns: ColumnDef[], current?: string): ColumnDef[] {
    return [...columns].sort((a, b) => {
      const rank = (column: ColumnDef) => column.key === "icon" ? 0 : column.key === current ? 1 : 2;
      return rank(a) - rank(b) || (a.label || a.key).localeCompare(b.label || b.key);
    });
  }

  private openCreateRecordIconFieldModal(target: "database" | "view", afterCreate?: () => void): void {
    const database = this.getActiveDb();
    const config = this.getConfig();
    if (!database || !config) return;
    new CreateRecordIconFieldModal(this.app, config.schema.columns, async (key, label) => {
      const oldDatabaseField = database.recordIconField;
      const oldOverrideEnabled = config.recordIconFieldOverrideEnabled;
      const oldViewField = config.recordIconField;
      const result = await this.columnOperations.appendNamedTextColumn(
        key,
        label,
        () => {
          if (target === "view") {
            config.recordIconFieldOverrideEnabled = true;
            config.recordIconField = key;
          } else {
            database.recordIconField = key;
            config.recordIconFieldOverrideEnabled = undefined;
            config.recordIconField = undefined;
          }
        },
        () => {
          database.recordIconField = oldDatabaseField;
          config.recordIconFieldOverrideEnabled = oldOverrideEnabled;
          config.recordIconField = oldViewField;
        },
      );
      if (!result) return false;
      this.refresh();
      afterCreate?.();
      return true;
    }).open();
  }

  private findRecordIconAnchor(row: RowData): HTMLElement | null {
    return this.containerEl_?.querySelector<HTMLElement>(
      `[data-note-database-row-path="${CSS.escape(row.file.path)}"] .db-record-icon`
    ) || null;
  }

  private updateRecordIconDOM(row: RowData, config: ViewConfig): boolean {
    if (!this.containerEl_ || config.showRecordIcon !== true) return false;
    const selector = `[data-note-database-row-path="${CSS.escape(row.file.path)}"] .db-record-icon`;
    const currentIcons = Array.from(this.containerEl_.querySelectorAll<HTMLElement>(selector));
    if (currentIcons.length === 0) return false;
    for (const current of currentIcons) {
      const parent = current.parentElement;
      if (!parent) continue;
      const compact = current.hasClass("is-compact");
      const replacement = this.renderRowRecordIcon(parent, row, config, compact);
      if (!replacement) continue;
      if (current.getAttribute("tabindex") === "-1") replacement.setAttr("tabindex", "-1");
      current.replaceWith(replacement);
    }
    return true;
  }

  private isRowFieldRendered(row: RowData, col: ColumnDef): boolean {
    if (!this.containerEl_) return false;
    const rowSelector = `[data-note-database-row-path="${CSS.escape(row.file.path)}"]`;
    const fieldSelector = `[data-note-database-column-key="${CSS.escape(col.key)}"]`;
    return Boolean(this.containerEl_.querySelector(
      `${rowSelector}${fieldSelector}, ${rowSelector} ${fieldSelector}`
    ));
  }

  private toggleCurrentViewRecordIcon(anchor?: HTMLElement, row?: RowData): void {
    const config = this.getConfig();
    const database = this.getActiveDb();
    if (!config || !database) return;
    config.showRecordIcon = config.showRecordIcon === true ? undefined : true;
    if (config.showRecordIcon && !resolveRecordIconField(database, config) && !database.recordIconField) {
      config.recordIconFieldOverrideEnabled = true;
    }
    this.pendingUndoLabel = t("recordIcon.show");
    this.scheduleConfigSave();
    this.refresh();
    if (config.showRecordIcon && !resolveRecordIconField(database, config) && anchor && row) {
      window.setTimeout(() => {
        const liveAnchor = this.findRecordIconAnchor(row);
        this.openRecordIconPicker(liveAnchor || anchor, row, config);
      }, 0);
    }
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
    this.renderDatabaseCover();
  }

  private showColumnRenameModal(col: ColumnDef): void {
    const config = this.getConfig();
    if (!config) return;
    new ColumnRenameModal(this.app, col, config.schema.columns, async (result) => {
      const decision = await this.confirmPropertyTypeConflictBeforeColumnRename(col, result);
      if (!decision) return false;
      if (decision.changes.length > 0) {
        await this.applyPropertyTypeConflictChanges(decision.changes, result.key.trim());
      }
      if (decision.type && decision.type !== col.type) {
        this.applyColumnTypeToColumn(col, decision.type);
      }
      await this.columnOperations.renameColumn(col, result);
    }, config.schema.computedFields).open();
  }

  private showRelationRollupConfigModal(col: ColumnDef): void {
    const database = this.getActiveDb();
    if (!database || (col.type !== "relation" && col.type !== "rollup")) return;
    const entries = this.dataSource.getViewDefFiles();
    const databases = entries.map((entry) => entry.config);
    if (!databases.some((candidate) => candidate.id === database.id)) databases.push(database);
    new RelationRollupConfigModal(this.app, col, database, databases, async () => {
      this.pendingUndoLabel = col.type === "relation"
        ? t("undo.relationConfig")
        : t("undo.rollupConfig");
      await this.saveConfigImmediately();
      this.refreshSchemaChanged();
    }, getNoteDatabasePlugin(this.app)?.settings.showDatabaseIcon !== false).open();
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

  private setColumnsVisible(changes: Array<{ col: ColumnDef; visible: boolean }>): void {
    const config = this.getConfig();
    if (!config || changes.length === 0) return;
    const state = this.vs();
    for (const change of changes) {
      if (change.visible) state.hiddenColumns.delete(change.col.key);
      else state.hiddenColumns.add(change.col.key);
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
    if (config.viewType === "board" && config.boardSubgroupEnabled !== false && config.boardSubgroupField) {
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

  private setTextRenderMode(col: ColumnDef, mode: "plain" | "link" | "markdown"): void {
    col.textRenderMode = mode === "plain" ? undefined : mode;
    this.scheduleConfigSave();
    this.renderColumnManager();
    this.refresh();
  }

  private setNumberDisplayStyle(col: ColumnDef, style: NumberDisplayStyle): void {
    col.numberDisplayStyle = style === "plain" ? undefined : style;
    this.pendingUndoLabel = t("undo.numberDisplayStyleConfig");
    this.scheduleConfigSave();
    this.renderColumnManager();
    this.refresh();
  }

  private updateNumberDisplayConfig(col: ColumnDef, partial: Partial<NumberDisplayConfig>): void {
    const current = col.numberDisplayConfig ?? {};
    const merged: NumberDisplayConfig = { ...current, ...partial };
    // Drop fields that equal their default so frontmatter stays clean (like wrap/plain → undefined).
    if (!merged.ratingSymbol || merged.ratingSymbol === "star") delete merged.ratingSymbol;
    if (merged.ratingSymbol !== "emoji") delete merged.ratingEmoji;
    if (!merged.ratingEmoji || merged.ratingEmoji === "⭐") delete merged.ratingEmoji;
    if (merged.ratingSymbol === "emoji") delete merged.ratingVariant;
    if (!merged.ratingVariant || merged.ratingVariant === "filled") delete merged.ratingVariant;
    if (!merged.ratingMax || merged.ratingMax === 5) delete merged.ratingMax;
    if (merged.progressDivisor == null || merged.progressDivisor === 100) delete merged.progressDivisor;
    if (merged.progressShowValue === true) delete merged.progressShowValue;
    if (!merged.color) delete merged.color;
    col.numberDisplayConfig = Object.keys(merged).length > 0 ? merged : undefined;
    this.pendingUndoLabel = t("undo.numberDisplayStyleConfig");
    this.scheduleConfigSave();
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
      await this.applyOptionCellChangeImmediately(row, target, change);
      return;
    }

    if (!transaction.nextOptions) {
      if (!transaction.setValue) return;
      const change = this.createCurrentCellChange(row, target, transaction.value);
      if (this.areCellValuesEqual(change.oldValue, change.newValue)) return;
      await this.applyOptionCellChangeImmediately(row, target, change);
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

  private async applyOptionCellChangeImmediately(
    row: RowData,
    col: ColumnDef,
    change: CellEditChange
  ): Promise<void> {
    const rollback = {
      ...change,
      newValue: change.oldExists ? this.cloneFillValue(change.oldValue) : null,
    };
    this.applyFrontmatterChangeToRenderedRows(change);
    this.updateCellDOM(row, col);
    this.suppressDataReload(1200);
    try {
      await this.dataSource.updateFrontmatter(
        change.file,
        { [change.key]: change.newValue },
        { sourceInstanceId: this.instanceId }
      );
    } catch (error) {
      this.applyFrontmatterChangeToRenderedRows(rollback);
      this.updateCellDOM(row, col);
      throw error;
    }
    this.pushHistory({ type: "cells", label: t("undo.editCell"), changes: [change] });
    if (this.canApplyCellChangeOptimistically(col)) return;
    await this.syncComputedForCellChanges([change]);
    await this.refreshAfterSave();
    this.restorePreservedCellSelectionAfterRefresh();
    this.rerenderToolbar();
  }

  // Side-effect-free option mutation planning: normalize previous/next, infer renames and
  // removed values, and build the frontmatter cleanup changes those imply. Shared by the
  // single-cell and bulk option paths so rename/delete cleanup semantics stay identical.
  private buildColumnOptionMutation(
    col: ColumnDef,
    previousOptions: StatusOptionDef[],
    nextOptions: StatusOptionDef[],
    options: { cleanupRemovedValues?: string[]; renameValues?: Array<{ from: string; to: string }> } = {}
  ): { normalizedNext: StatusOptionDef[]; cleanupChanges: CellEditChange[] } {
    const normalizedPrevious = this.normalizeOptionDefsForColumn(col, previousOptions);
    const normalizedNext = this.normalizeOptionDefsForColumn(col, nextOptions);
    const previousValues = new Set(normalizedPrevious.map((option) => option.value));
    const nextValues = new Set(normalizedNext.map((option) => option.value));
    const renameValues = (options.renameValues || this.inferOptionRenames(normalizedPrevious, normalizedNext))
      .map((rename) => ({
        from: normalizeOptionValueForKey(col.key, rename.from),
        to: normalizeOptionValueForKey(col.key, rename.to),
      }))
      .filter((rename) => rename.from && rename.to && rename.from !== rename.to);
    const renamedValues = new Set(renameValues.map((rename) => rename.from));
    const inferredRemoved = Array.from(previousValues)
      .filter((value) => !nextValues.has(value) && !renamedValues.has(value));
    const removedValues = new Set(
      (options.cleanupRemovedValues ?? inferredRemoved)
        .map((value) => normalizeOptionValueForKey(col.key, value))
        .filter(Boolean)
    );
    const cleanupChanges = this.mergeCellChanges(this.getOptionValueCellChanges(col, removedValues, renameValues));
    return { normalizedNext, cleanupChanges };
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
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const before = this.cloneDatabaseConfig(entry.config);
    const target = config.schema.columns.find((candidate) => candidate.key === col.key);
    if (!target) return;
    const { normalizedNext, cleanupChanges } = this.buildColumnOptionMutation(target, previousOptions, nextOptions, {
      cleanupRemovedValues: options.cleanupRemovedValues,
      renameValues: options.renameValues,
    });
    const currentChange = options.setValue && options.currentRow
      ? this.createCurrentCellChange(options.currentRow, target, options.value)
      : null;
    const changes = this.mergeCellChanges([
      ...cleanupChanges,
      ...(currentChange ? [currentChange] : []),
    ]);
    target.statusOptions = normalizedNext;
    target.statusPresetId = target.type === "status" ? options.presetId : undefined;
    const showImmediateValue = currentChange != null &&
      options.currentRow != null &&
      !this.areCellValuesEqual(currentChange.oldValue, currentChange.newValue);
    if (showImmediateValue && options.currentRow) {
      this.applyFrontmatterChangeToRenderedRows(currentChange);
      this.updateCellDOM(options.currentRow, target);
    }
    try {
      await this.commitConfigAndCellChanges(
        entry,
        before,
        changes,
        t("undo.fieldOptionsConfig"),
        { preserveCellSelection: Boolean(options.setValue && options.currentRow) },
      );
    } catch (error) {
      if (showImmediateValue && currentChange && options.currentRow) {
        this.applyFrontmatterChangeToRenderedRows({
          ...currentChange,
          newValue: currentChange.oldExists ? this.cloneFillValue(currentChange.oldValue) : null,
        });
        const restoredTarget = this.getConfig()?.schema.columns.find((candidate) => candidate.key === col.key);
        if (restoredTarget) this.updateCellDOM(options.currentRow, restoredTarget);
      }
      throw error;
    }
    if (options.setValue && options.currentRow) {
      this.renderCellSelectionClasses();
      this.renderSelectionStatusBar();
    }
    if (this.showColumnManager) this.renderColumnManager();
  }

  // Bulk adapter for option transactions from the native editor session. Combines option config
  // (color/reorder/rename/delete cleanup) with selected-record value changes into one atomic,
  // single-undo commit. Confirmation gates the value path; canceling or staleness aborts without
  // persisting nextOptions (including any newly created option). file.tags never mutates
  // statusOptions — its value path reuses the prepared bulk commit only.
  private async commitBulkCellOptionTransaction(
    paths: string[],
    col: ColumnDef,
    transaction: CellOptionTransaction
  ): Promise<void> {
    if (col.key === "file.tags") {
      if (!transaction.setValue) return;
      const request = resolveBulkEditorRequest(col, transaction.value);
      const initial = await this.prepareBulkEdit(paths, request);
      if (!initial) return;
      const confirmed = await this.confirmBulkEdit(paths, request, initial);
      if (!confirmed) return;
      await this.commitPreparedBulkEdit(confirmed);
      return;
    }

    const config = this.getConfig();
    if (!config) return;
    const target = config.schema.columns.find((candidate) => candidate.key === col.key);
    if (!target) return;

    const { normalizedNext, cleanupChanges } = this.buildColumnOptionMutation(
      target,
      transaction.previousOptions || target.statusOptions || [],
      transaction.nextOptions || target.statusOptions || [],
      { cleanupRemovedValues: transaction.cleanupRemovedValues, renameValues: transaction.renameValues }
    );

    let prepared: PreparedBulkEdit | null = null;
    if (transaction.setValue) {
      const request = resolveBulkEditorRequest(target, transaction.value);
      prepared = await this.prepareBulkEdit(paths, request);
      if (prepared) {
        const confirmed = await this.confirmBulkEdit(paths, request, prepared);
        if (!confirmed) return;
        prepared = confirmed;
      }
    }

    const entry = this.getCurrentEntry();
    if (!entry) return;
    const before = this.cloneDatabaseConfig(entry.config);
    target.statusOptions = normalizedNext;
    target.statusPresetId = undefined;
    const mergedChanges = this.mergeCellChanges([
      ...cleanupChanges,
      ...(prepared?.changes || []),
    ]);
    await this.commitConfigAndCellChanges(entry, before, mergedChanges, t("undo.bulkEdit"));
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

  private mergeCellChanges(...groups: CellEditChange[][]): CellEditChange[] {
    const merged = new Map<string, CellEditChange>();
    for (const changes of groups) {
      for (const change of changes) {
        const key = `${change.path}\u0000${change.key}`;
        const existing = merged.get(key);
        if (existing) {
          existing.newValue = this.cloneFillValue(change.newValue);
        } else {
          merged.set(key, this.cloneCellChange(change));
        }
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

  private showFormulaModal(
    col: ColumnDef,
    initialResultType?: ComputedFieldDef["type"],
    restoreFocusRow?: RowData,
  ): void {
    const config = this.getConfig();
    const entry = this.getCurrentEntry();
    if (!config || !entry) return;
    const computedKey = col.computedKey || col.key;
    const computedField = config.schema.computedFields.find((field) => field.key === computedKey);
    const baseThisFile = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    const baseThisFrontmatter = baseThisFile instanceof TFile
      ? this.app.metadataCache.getFileCache(baseThisFile)?.frontmatter
      : undefined;
    new FormulaModal(
      this.app,
      col,
      computedField,
      this.rows,
      config.schema.columns.filter((candidate) => candidate.type !== "rollup"),
      normalizeComputedSyncMode(entry.config.computedSyncMode),
      async (result) => {
      const decision = await this.confirmPropertyTypeConflictBeforeFormulaSave(col, result.resultType);
      if (!decision) return false;
      const computedKey = col.computedKey || col.key;
      if (decision.changes.length > 0) {
        await this.applyPropertyTypeConflictChanges(decision.changes, computedKey);
      }
      await this.saveFormula(entry, config, col, {
        ...result,
        resultType: decision.resultType || result.resultType,
      });
    }, baseThisFile instanceof TFile ? baseThisFile : undefined, baseThisFrontmatter, initialResultType, () => {
      if (!restoreFocusRow) return;
      window.requestAnimationFrame(() => this.restoreTableCellFocus(restoreFocusRow, col));
    }).open();
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
          this.getRefreshWindow().clearTimeout(this.computedSyncTimer);
          this.computedSyncTimer = null;
        }
        this.pendingComputedSync.clear();
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
        await this.dataSource.updateFrontmatter(
          record.file,
          updates,
          { sourceInstanceId: this.instanceId }
        );
        changed += 1;
      }
      new Notice(t("notice.clearedComputedFrontmatter", { key: uniqueKeys.join(", "), count: changed }));
      await this.refreshAfterSave();
    } catch (err) {
      console.error("Note Database: failed to clear computed frontmatter", err);
      new Notice(t("errors.updateFailed", { error: String(err) }));
    }
  }

  /** 打开「无效时间事件」修复 Modal：列出开始 > 结束的事件，用户改值后写回。 */
  /** 统计当前时间线来源范围内被隐藏的无效时间事件数量；导航栏图标和 popover warning 共用，缓存命中即时返回。 */
  private getTimelineInvalidEventCount(): number | Promise<number> {
    const config = this.getConfig();
    if (!config) return 0;
    // timeline 和 calendar 视图都接入 invalid 修复入口（A2）；collectInvalidTimelineEvents
    // 本就用 timelineStartDateField || calendarStartDateField 检测，对 calendar config 同样生效。
    if (config.viewType !== "timeline" && config.viewType !== "calendar") return 0;
    const cached = this.timelineInvalidEventsScanner.getCachedOptions(this.rows, config, this.timelineInvalidRowsVersion);
    if (cached) return cached.length;
    return this.timelineInvalidEventsScanner.getOptions(this.rows, config, this.timelineInvalidRowsVersion).then((options) => options.length);
  }

  private async openInvalidEvents(): Promise<void> {
    const config = this.getConfig();
    if (!config) return;
    const options = await this.timelineInvalidEventsScanner.getOptions(this.rows, config, this.timelineInvalidRowsVersion);
    if (options.length === 0) {
      new Notice(t("timeline.invalidEventsNone"));
      return;
    }
    new InvalidTimeEventsModal(this.app, options, async (edits) => {
      await this.applyInvalidEventEdits(edits, config);
    }).open();
  }

  private async applyInvalidEventEdits(edits: InvalidTimeEventEdit[], config: ViewConfig): Promise<void> {
    const changes: CellEditChange[] = [];
    for (const edit of edits) {
      const startCol = config.schema.columns.find((c) => c.key === edit.startField);
      const endCol = config.schema.columns.find((c) => c.key === edit.endField);
      // Modal 值恒为 datetime-local（YYYY-MM-DDTHH:mm）；写回纯 date 列时必须只取 YYYY-MM-DD，
      // 否则会把日期列污染成 datetime（列类型口径漂移）。
      const startIsDateOnly = startCol != null && getColumnDisplayType(startCol, config.schema.computedFields) === "date";
      const endIsDateOnly = endCol != null && getColumnDisplayType(endCol, config.schema.computedFields) === "date";
      if (startCol && edit.startValue) changes.push(this.createCurrentCellChange(edit.row, startCol, startIsDateOnly ? edit.startValue.slice(0, 10) : edit.startValue));
      if (endCol && edit.endValue) changes.push(this.createCurrentCellChange(edit.row, endCol, endIsDateOnly ? edit.endValue.slice(0, 10) : edit.endValue));
    }
    if (changes.length === 0) return;
    try {
      await this.applyCellChanges(changes, t("undo.timelineInvalidEvents"));
    } catch (err) {
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
    if (type === "relation" || type === "rollup") {
      if (
        type === "rollup" &&
        !this.getConfig().schema.columns.some((candidate) =>
          candidate !== col &&
          candidate.type === "relation" &&
          candidate.relationConfig?.targetDatabaseId
        )
      ) {
        new Notice(t("rollup.relationRequired"));
        return;
      }
      if (type === "relation") {
        const decision = await this.confirmPropertyTypeConflictBeforeColumnChange(col, type);
        if (!decision) return;
        if (decision.changes.length > 0) {
          await this.applyPropertyTypeConflictChanges(decision.changes, col.key);
        }
        if (decision.type !== "relation") {
          if (decision.type) await this.columnOperations.changeColumnType(col, decision.type);
          return;
        }
      }
      await this.columnOperations.changeColumnType(col, type);
      this.showRelationRollupConfigModal(col);
      return;
    }
    const decision = type === "computed"
      ? await this.confirmPropertyTypeConflictBeforeComputedCreation(col, "text")
      : await this.confirmPropertyTypeConflictBeforeColumnChange(col, type);
    if (!decision) return;
    if (decision.changes.length > 0) {
      await this.applyPropertyTypeConflictChanges(decision.changes, col.key);
    }
    if (!decision.type) {
      this.refreshSchemaChanged();
      return;
    }
    await this.columnOperations.changeColumnType(col, decision.type);
    if (decision.type === "computed") {
      this.showFormulaModal(col, decision.computedResultType);
    }
  }

  private async confirmPropertyTypeConflictBeforeColumnChange(
    col: ColumnDef,
    requestedType: ColumnDef["type"]
  ): Promise<{ type?: ColumnDef["type"]; computedResultType?: ComputedFieldDef["type"]; changes: PropertyTypeConflictChange[] } | null> {
    if (this.propertyTypeConflictModalOpen) return null;
    const entry = this.getCurrentEntry();
    if (!entry) return { type: requestedType, changes: [] };
    const existingEntries = this.buildPropertyConflictEntries();
    const prospectiveEntries = this.buildProspectivePropertyConflictEntries(col.key, requestedType);
    const prospectiveEntry = prospectiveEntries.find((candidate) => candidate.sourcePath === entry.sourcePath);
    if (!prospectiveEntry) return { type: requestedType, changes: [] };
    const conflicts = filterPropertyTypeConflictsForChange(
      findPropertyTypeConflicts(existingEntries),
      findPropertyTypeConflicts(prospectiveEntries),
      prospectiveEntry,
      col.key
    );
    if (conflicts.length === 0) return { type: requestedType, changes: [] };

    this.propertyTypeConflictModalOpen = true;
    const result = await new PropertyTypeConflictModal(this.app, {
      conflicts,
      activeConflictKey: col.key,
      mode: "confirm-change",
    }, {
      onClosed: () => {
        this.propertyTypeConflictModalOpen = false;
      },
    }).openAndWait();
    if (result.action === "cancel") return null;
    if (result.action === "ignore") return { type: requestedType, changes: [] };
    return this.resolveColumnTypeDecisionFromModalResult(result, col.key);
  }

  private async confirmPropertyTypeConflictBeforeColumnRename(
    col: ColumnDef,
    result: ColumnRenameResult
  ): Promise<{ type?: ColumnDef["type"]; changes: PropertyTypeConflictChange[] } | null> {
    const newKey = result.key.trim();
    if (this.propertyTypeConflictModalOpen) return null;
    if (!newKey || newKey === col.key || isFileFieldKey(col.key) || isFileFieldKey(newKey)) {
      return { changes: [] };
    }
    const entry = this.getCurrentEntry();
    if (!entry) return { changes: [] };
    const existingEntries = this.buildPropertyConflictEntries();
    const prospectiveEntries = this.buildProspectivePropertyConflictEntriesForRename(col.key, newKey);
    const prospectiveEntry = prospectiveEntries.find((candidate) => candidate.sourcePath === entry.sourcePath);
    if (!prospectiveEntry) return { changes: [] };
    const conflicts = filterPropertyTypeConflictsForChange(
      findPropertyTypeConflicts(existingEntries),
      findPropertyTypeConflicts(prospectiveEntries),
      prospectiveEntry,
      newKey
    );
    if (conflicts.length === 0) return { changes: [] };

    this.propertyTypeConflictModalOpen = true;
    const modalResult = await new PropertyTypeConflictModal(this.app, {
      conflicts,
      activeConflictKey: newKey,
      mode: "confirm-change",
    }, {
      onClosed: () => {
        this.propertyTypeConflictModalOpen = false;
      },
    }).openAndWait();
    if (modalResult.action === "cancel") return null;
    if (modalResult.action === "ignore") return { changes: [] };
    return this.resolveColumnTypeDecisionFromModalResult(modalResult, newKey);
  }

  private async confirmPropertyTypeConflictBeforeComputedCreation(
    col: ColumnDef,
    requestedType: ComputedFieldDef["type"]
  ): Promise<{ type?: ColumnDef["type"]; computedResultType?: ComputedFieldDef["type"]; changes: PropertyTypeConflictChange[] } | null> {
    const decision = await this.confirmPropertyTypeConflictBeforeFormulaSave(col, requestedType);
    if (!decision) return null;
    return {
      type: "computed",
      computedResultType: decision.resultType || requestedType,
      changes: decision.changes,
    };
  }

  private async confirmPropertyTypeConflictBeforeFormulaSave(
    col: ColumnDef,
    requestedType: ComputedFieldDef["type"]
  ): Promise<{ resultType?: ComputedFieldDef["type"]; changes: PropertyTypeConflictChange[] } | null> {
    if (this.propertyTypeConflictModalOpen) return null;
    const entry = this.getCurrentEntry();
    if (!entry) return { resultType: requestedType, changes: [] };
    const computedKey = col.computedKey || col.key;
    const existingEntries = this.buildPropertyConflictEntries();
    const prospectiveEntries = this.buildProspectivePropertyConflictEntriesForComputedType(col, requestedType);
    const prospectiveEntry = prospectiveEntries.find((candidate) => candidate.sourcePath === entry.sourcePath);
    if (!prospectiveEntry) return { resultType: requestedType, changes: [] };
    const conflicts = filterPropertyTypeConflictsForChange(
      findPropertyTypeConflicts(existingEntries),
      findPropertyTypeConflicts(prospectiveEntries),
      prospectiveEntry,
      computedKey
    );
    if (conflicts.length === 0) return { resultType: requestedType, changes: [] };

    this.propertyTypeConflictModalOpen = true;
    const result = await new PropertyTypeConflictModal(this.app, {
      conflicts,
      activeConflictKey: computedKey,
      mode: "confirm-change",
    }, {
      onClosed: () => {
        this.propertyTypeConflictModalOpen = false;
      },
    }).openAndWait();
    if (result.action === "cancel") return null;
    if (result.action === "ignore") return { resultType: requestedType, changes: [] };
    return this.resolveComputedTypeDecisionFromModalResult(result, computedKey);
  }

  private buildProspectivePropertyConflictEntries(
    key: string,
    type: ColumnDef["type"]
  ): PropertyTypeConflictEntry[] {
    const currentEntry = this.getCurrentEntry();
    return this.viewEntries.map((entry) => {
      const config = this.cloneDatabaseConfig(entry.config);
      if (currentEntry?.sourcePath === entry.sourcePath) {
        this.applyPropertyTypeToConfig(config, {
          databaseId: config.id || entry.sourcePath,
          databasePath: entry.sourcePath,
          key,
          sourceKind: "column",
          type,
        });
      }
      return { sourcePath: entry.sourcePath, config };
    });
  }

  private buildProspectivePropertyConflictEntriesForRename(
    oldKey: string,
    newKey: string
  ): PropertyTypeConflictEntry[] {
    const currentEntry = this.getCurrentEntry();
    return this.viewEntries.map((entry) => {
      const config = this.cloneDatabaseConfig(entry.config);
      if (currentEntry?.sourcePath === entry.sourcePath) {
        for (const col of config.schema.columns || []) {
          if (col.key !== oldKey) continue;
          const oldComputedKey = getComputedStorageKey(col);
          const newComputedKey = col.type === "computed" ? normalizeComputedStorageKey(newKey) : newKey;
          col.key = newKey;
          if (col.type === "computed") {
            col.computedKey = newComputedKey;
            const computed = config.schema.computedFields.find((field) => field.key === oldComputedKey);
            if (computed) {
              computed.key = newComputedKey;
              computed.label = col.label;
            }
          }
          break;
        }
      }
      return { sourcePath: entry.sourcePath, config };
    });
  }

  private buildProspectivePropertyConflictEntriesForComputedType(
    col: ColumnDef,
    type: ComputedFieldDef["type"]
  ): PropertyTypeConflictEntry[] {
    const currentEntry = this.getCurrentEntry();
    const computedKey = col.computedKey || col.key;
    return this.viewEntries.map((entry) => {
      const config = this.cloneDatabaseConfig(entry.config);
      if (currentEntry?.sourcePath === entry.sourcePath) {
        const targetCol = config.schema.columns.find((candidate) => candidate.key === col.key);
        if (targetCol) {
          targetCol.type = "computed";
          targetCol.computedKey = computedKey;
        }
        const existing = config.schema.computedFields.find((field) => field.key === computedKey);
        if (existing) {
          existing.type = type;
        } else {
          config.schema.computedFields.push({
            key: computedKey,
            label: targetCol?.label || col.label,
            expression: "",
            type,
          });
        }
      }
      return { sourcePath: entry.sourcePath, config };
    });
  }

  private buildPropertyConflictEntries(): PropertyTypeConflictEntry[] {
    return this.viewEntries.map((entry) => ({
      sourcePath: entry.sourcePath,
      config: this.cloneDatabaseConfig(entry.config),
    }));
  }

  private resolveColumnTypeDecisionFromModalResult(
    result: Extract<PropertyTypeConflictModalResult, { action: "resolve" }>,
    currentKey: string
  ): { type?: ColumnDef["type"]; changes: PropertyTypeConflictChange[] } {
    const entry = this.getCurrentEntry();
    const currentDatabaseId = entry ? (entry.config.id || entry.sourcePath) : "";
    const currentDatabasePath = entry?.sourcePath;
    const currentChange = result.changes.find((change) =>
      change.key === currentKey &&
      change.sourceKind === "column" &&
      (currentDatabasePath ? change.databasePath === currentDatabasePath : change.databaseId === currentDatabaseId)
    );
    const type = isColumnType(currentChange?.type) ? currentChange.type : undefined;
    return {
      type,
      changes: result.changes.filter((change) => !(
        change.key === currentKey &&
        change.sourceKind === "column" &&
        (currentDatabasePath ? change.databasePath === currentDatabasePath : change.databaseId === currentDatabaseId)
      )),
    };
  }

  private resolveComputedTypeDecisionFromModalResult(
    result: Extract<PropertyTypeConflictModalResult, { action: "resolve" }>,
    currentKey: string
  ): { resultType?: ComputedFieldDef["type"]; changes: PropertyTypeConflictChange[] } {
    const entry = this.getCurrentEntry();
    const currentDatabaseId = entry ? (entry.config.id || entry.sourcePath) : "";
    const currentDatabasePath = entry?.sourcePath;
    const currentChange = result.changes.find((change) =>
      change.key === currentKey &&
      change.sourceKind === "computed" &&
      (currentDatabasePath ? change.databasePath === currentDatabasePath : change.databaseId === currentDatabaseId)
    );
    const resultType = isComputedFieldType(currentChange?.type) ? currentChange.type : undefined;
    return {
      resultType,
      changes: result.changes.filter((change) => !(
        change.key === currentKey &&
        change.sourceKind === "computed" &&
        (currentDatabasePath ? change.databasePath === currentDatabasePath : change.databaseId === currentDatabaseId)
      )),
    };
  }

  private async applyPropertyTypeConflictChanges(changes: PropertyTypeConflictChange[], currentKey: string): Promise<void> {
    const touched = new Set<string>();
    for (const change of changes) {
      const entry = this.viewEntries.find((candidate) => propertyTypeChangeTargetsEntry(candidate, change));
      if (!entry) continue;
      if (!this.applyPropertyTypeToConfig(entry.config, change)) continue;
      touched.add(entry.sourcePath);
    }
    for (const sourcePath of touched) {
      const entry = this.viewEntries.find((candidate) => candidate.sourcePath === sourcePath);
      if (!entry) continue;
      const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
      if (!(file instanceof TFile)) continue;
      await this.dataSource.updateViewDefFile(file, entry.config, {
        dbId: entry.config.id,
        dbPath: entry.sourcePath,
        sourceInstanceId: this.instanceId,
      });
      this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
    }
    if (touched.size > 0) {
      new Notice(t("propertyConflict.updatedDefinitions", { count: touched.size, key: currentKey }));
    }
  }

  private applyPropertyTypeToConfig(config: DatabaseConfig, change: PropertyTypeConflictChange): boolean {
    if (change.sourceKind === "computed") {
      const field = config.schema.computedFields.find((candidate) => candidate.key === change.key);
      if (!field || !isComputedFieldType(change.type) || field.type === change.type) return false;
      field.type = change.type;
      return true;
    }
    const col = config.schema.columns.find((candidate) => candidate.key === change.key);
    if (!col || !isColumnType(change.type) || col.type === change.type || col.type === "computed" || col.type === "rollup") return false;
    return this.applyColumnTypeToColumn(col, change.type);
  }

  private applyColumnTypeToColumn(col: ColumnDef, type: ColumnDef["type"]): boolean {
    if (col.type === type || col.type === "computed" || col.type === "rollup") return false;
    col.type = type;
    if (isOptionColumnType(type)) {
      if (!col.statusOptions?.length) {
        col.statusOptions = type === "status" ? this.getDefaultStatusOptions() : [];
        col.statusPresetId = type === "status" ? this.getDefaultStatusPresetId() : undefined;
      } else {
        col.statusPresetId = undefined;
      }
    } else {
      col.statusOptions = undefined;
      col.statusPresetId = undefined;
    }
    return true;
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
    const config = this.getConfig();
    this.columnMenu.show(event, col, anchorEl, { ...options, computedFields: config?.schema.computedFields });
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
    if (metadata?.skipHistory && !metadata.undoLabel && cellChanges.length === 0) {
      this.configSnapshots.set(key, after);
      return;
    }
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
      skipHistory: (existing.skipHistory || next.skipHistory) &&
        !existing.undoLabel &&
        !next.undoLabel &&
        !(existing.cellChanges?.length) &&
        !(next.cellChanges?.length),
    };
  }

  /** Debounced config save: batch rapid changes (drag, resize) into one write */
  private scheduleConfigSave(metadataOverride?: Partial<ConfigSaveMetadata>): void {
    // Protect in-memory config mutations immediately. Frontmatter writes can emit
    // metadata events before the debounced view-definition write reaches disk.
    this.suppressDataReload(2500);
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const metadata = { ...this.consumePendingConfigMetadata(), ...metadataOverride };
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
    this.closeCalendarTimelineSearchResultsPanel();
    this.containerEl_?.toggleClass("has-selection-status", false);
    if (!this.hasActiveDatabase()) {
      this.applyViewTypeClass("table");
      this.renderEmptyDashboard();
      return;
    }
    const config = this.getConfig();
    const dbConfig = this.getActiveDb();
    const viewType = config.viewType || "table";
    // Detect an actual view-type switch so we can reset the calendar/timeline
    // scroll to the top. Filter/sort/data refreshes keep the same viewType and
    // must preserve the user's scroll position.
    const viewTypeChanged = this.lastRenderedViewType !== viewType;
    this.applyViewTypeClass(viewType);
    if (!config.schema || !config.schema.columns || config.schema.columns.length === 0) {
      this.containerEl_?.createDiv({
        cls: "db-empty",
        text: t("empty.noColumnsDb", { name: dbConfig.name }),
      });
      return;
    }
    let records: NoteRecord[];
    try {
      records = this.includePendingNewRecords(this.dataSource.getRecordsForConfig(this.getEffectiveConfig(dbConfig)));
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
    // 按当前视图的年份显示策略写入全局，供 DateTimeFormat.shouldShowYear 读取。
    setDateDisplayMode(config.yearDisplayMode || "always");
    const pipelineConfig = config.viewType === "chart" ? { ...config, manualOrder: undefined } : config;
    this.rows = this.buildRowsWithRelations(records, pipelineConfig, this.vs(), dbConfig, true);
    this.timelineInvalidRowsVersion += 1;
    this.scheduleComputedSync(config, this.rows);

    if (config.viewType !== "chart") this.renderSummary(config);
    if (!this.containerEl_) return;

    if (config.viewType === "board") {
      this.renderBoard(config);
    } else if (config.viewType === "gallery") {
      this.renderGallery(config);
    } else if (config.viewType === "list") {
      this.renderList(config);
    } else if (config.viewType === "chart") {
      this.renderChart(config);
    } else if (config.viewType === "calendar") {
      this.calendarRenderer.render(this.containerEl_, config, this.rows);
    } else if (config.viewType === "timeline") {
      this.calendarTimelineRenderer.renderTimeline(this.containerEl_, this.getTimelineRenderConfig(config), this.rows);
    } else if (this.vs().groupByField) {
      this.renderGroupedTable(config, this.vs().groupByField);
    } else {
      this.renderTable(config);
    }
    if (config.viewType === "chart") this.renderSummary(config);
    this.renderCalendarTimelineSearchResultsPanel(config);
    this.renderSelectionStatusBar();
    // Clear pending-show flags after one render cycle
    this.pendingShowColumns.clear();
    this.applyPendingColumnHighlight();
    this.revealPendingNewRow();
    this.revealPendingSearchResult();
    this.lastRenderedViewType = viewType;
    if (viewTypeChanged && (viewType === "calendar" || viewType === "timeline")) {
      this.resetCalendarTimelineScroll();
    }
  }

  /** Reset the scroll container to the top when switching INTO a calendar or
   * timeline view. These views are much taller than the viewport, so without an
   * explicit reset the container keeps the previous view's scrollTop and the
   * scrollbar parks in the middle. table/board/gallery/list are short enough that
   * their content starts at the top naturally. */
  private resetCalendarTimelineScroll(): void {
    if (!this.containerEl_) return;
    this.containerEl_.scrollTop = 0;
  }

  private renderCalendarTimelineSearchResultsPanel(config: ViewConfig): void {
    this.closeCalendarTimelineSearchResultsPanel();
    if (!this.containerEl_ || (config.viewType !== "calendar" && config.viewType !== "timeline")) return;
    const query = this.vs().searchText.trim();
    if (!query) return;
    const searchControl = this.containerEl_.querySelector<HTMLElement>(".db-search-control");
    const searchInput = searchControl?.querySelector<HTMLInputElement>(".db-search-input");
    if (!searchControl || !searchInput) return;
    if (window.activeDocument.activeElement !== searchInput) return;
    const visibleRange = config.viewType === "timeline"
      ? this.calendarTimelineRenderer.getCurrentVisibleRange()
      : this.calendarRenderer.getCurrentVisibleRange();
    const results = buildCalendarTimelineSearchResults(this.rows, config, visibleRange);
    const panel = window.activeDocument.body.createDiv({ cls: "db-calendar-search-results-popover" });
    this.calendarTimelineSearchResultsEl = panel;
    this.positionCalendarTimelineSearchResultsPanel(panel, searchControl);
    this.renderCalendarTimelineSearchResultsContent(panel, results, query);
    panel.onmousedown = (event) => {
      event.preventDefault();
    };
    searchInput.onblur = () => {
      this.closeCalendarTimelineSearchResultsPanel();
    };
    searchInput.onkeydown = (event) => {
      if (event.key !== "Escape") return;
      if (this.calendarTimelineSearchResultsEl?.isConnected) {
        event.preventDefault();
        event.stopPropagation();
        this.closeCalendarTimelineSearchResultsPanel();
        searchInput.blur();
      }
    };
  }

  private renderCalendarTimelineSearchResultsContent(panel: HTMLElement, results: CalendarTimelineSearchResults, query: string): void {
    panel.createDiv({
      cls: "db-calendar-search-results-summary",
      text: t("search.calendarTimelineSummary", { total: results.totalCount, visible: results.visibleCount }),
    });
    if (results.totalCount === 0) {
      panel.createDiv({ cls: "db-calendar-search-results-empty", text: t("search.noMatches") });
      return;
    }
    const list = panel.createDiv({ cls: "db-calendar-search-results-list" });
    const currentRangeItems = results.items.filter((item) => item.inCurrentRange);
    const outsideRangeItems = results.items.filter((item) => !item.inCurrentRange);
    const visibleItems = [...currentRangeItems, ...outsideRangeItems].slice(0, 50);
    const currentVisibleItems = visibleItems.filter((item) => item.inCurrentRange);
    const outsideVisibleItems = visibleItems.filter((item) => !item.inCurrentRange);
    const renderSection = (label: string, items: CalendarTimelineSearchResultItem[]) => {
      if (items.length === 0) return;
      const section = list.createDiv({ cls: "db-calendar-search-results-section" });
      section.createDiv({ cls: "db-calendar-search-results-section-title", text: label });
      for (const item of items) this.renderCalendarTimelineSearchResultButton(section, item, query);
    };
    renderSection(t("search.inCurrentRange"), currentVisibleItems);
    renderSection(t("search.outsideCurrentRange"), outsideVisibleItems);
    if (results.totalCount > visibleItems.length) {
      panel.createDiv({
        cls: "db-calendar-search-results-more",
        text: t("search.moreResults", { count: results.totalCount - visibleItems.length }),
      });
    }
  }

  private renderCalendarTimelineSearchResultButton(list: HTMLElement, item: CalendarTimelineSearchResultItem, query: string): void {
    const button = list.createEl("button", {
      cls: `db-calendar-search-result${item.inCurrentRange ? " is-current-range" : ""}`,
      attr: { type: "button" },
    });
    renderSearchHighlightedText(button.createSpan({ cls: "db-calendar-search-result-title" }), item.title || t("common.untitled"), query);
    renderSearchHighlightedText(button.createSpan({ cls: "db-calendar-search-result-date" }), formatCalendarTimelineSearchResultDate(item), query);
    button.onclick = (event) => {
      event.preventDefault();
      this.closeCalendarTimelineSearchResultsPanel();
      const activeEl = window.activeDocument.activeElement;
      if (activeEl instanceof HTMLElement) activeEl.blur();
      this.jumpToCalendarTimelineSearchResult(item);
    };
  }

  private positionCalendarTimelineSearchResultsPanel(panel: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(320, Math.min(480, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = Math.min(rect.bottom + 6, window.innerHeight - 80);
    panel.setCssProps({
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
    });
  }

  private closeCalendarTimelineSearchResultsPanel(): void {
    this.calendarTimelineSearchResultsEl?.remove();
    this.calendarTimelineSearchResultsEl = null;
  }

  private jumpToCalendarTimelineSearchResult(item: CalendarTimelineSearchResultItem): void {
    const config = this.getConfig();
    if (!config) return;
    this.pendingSearchResultRevealPath = item.filePath;
    if (config.viewType === "timeline") {
      const timeMinutes = (config.timelineScale || "week") === "day" ? item.startMinutes : undefined;
      this.updateTimelineAnchor(item.startDateKey, t("undo.timelineAnchorConfig"), timeMinutes);
      return;
    }
    if (config.viewType !== "calendar") return;
    config.calendarMonth = item.startDateKey.slice(0, 7);
    config.calendarWeekStart = item.startDateKey;
    config.calendarDay = item.startDateKey;
    this.pendingUndoLabel = t("undo.calendarMonthConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private getTimelineRenderConfig(config: ViewConfig): ViewConfig {
    const state = this.vs();
    return {
      ...config,
      // 时间线分组完全跟随 groupByField（ViewStateStore 的统一分组入口）。
      // 不能用 `state.groupByField || config.timelineGroupField`：用户在分组 popover
      // 选「无分组」时 groupByField 是空串（falsy），`||` 会回退到历史字段
      // timelineGroupField，导致「未分组」无法生效。timelineGroupField 是无活跃写入
      // 入口的历史字段（.base 导入和 setGroupByField 都只写 groupByField）。
      timelineGroupField: state.groupByField,
      sortColumn: state.sortColumn,
      sortDirection: state.sortDirection,
      sortRules: state.sortRules,
    };
  }

  private updateTimelineAnchor(dateKey: string, label?: string, timeMinutes?: number): void {
    const config = this.getConfig();
    if (!config) return;
    config.timelineAnchor = dateKey;
    if (typeof timeMinutes === "number" && Number.isFinite(timeMinutes)) config.timelineAnchorTimeMinutes = timeMinutes;
    else delete config.timelineAnchorTimeMinutes;
    this.pendingUndoLabel = label || t("undo.timelineAnchorConfig");
    this.scheduleConfigSave();
    this.refresh({ viewport: "preserve-raw" });
  }

  private async updateTimelineScale(scale: NonNullable<ViewConfig["timelineScale"]>, label?: string): Promise<boolean> {
    const config = this.getConfig();
    if (!config || (config.timelineScale || "week") === scale) return false;
    if (scale === "day" && !await this.ensureTimelineDayDateTimeFields(config)) return false;
    config.timelineScale = scale;
    this.pendingUndoLabel = label || t("undo.timelineScaleConfig");
    this.scheduleConfigSave();
    this.refresh();
    return true;
  }

  private updateCalendarScale(scale: NonNullable<ViewConfig["calendarScale"]>, anchorDateKey: string, label?: string): void {
    const config = this.getConfig();
    if (!config || (config.calendarScale || "month") === scale) return;
    config.calendarScale = scale;
    config.calendarMonth = anchorDateKey.slice(0, 7);
    config.calendarWeekStart = anchorDateKey;
    config.calendarDay = anchorDateKey;
    this.pendingUndoLabel = label || t("undo.calendarScaleConfig");
    this.scheduleConfigSave();
    this.refresh();
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

  // Status-bar element that anchors the native bulk editor popover. Re-queried on demand because
  // renderSelectionStatusBar rebuilds the bar on every selection change.
  private getStatusBarAnchor(): HTMLElement | null {
    return this.containerEl_?.querySelector<HTMLElement>(":scope > .db-selection-status-bar") ?? null;
  }

  /** Selection changes invalidate the path snapshot captured by a native bulk editor session. */
  private invalidateActiveBulkEditor(): void {
    this.bulkEditingColumnKey = undefined;
    this.cellRenderer.closeActiveBulkEditor();
  }

  // The editor popover horizontally aligns with the field chip's left edge (not the status bar's
  // left edge). Falls back to the status bar when no chip is rendered yet.
  private getBulkEditChipAnchor(): HTMLElement | null {
    return this.containerEl_?.querySelector<HTMLElement>(":scope > .db-selection-status-bar .db-selection-chip") ?? null;
  }

  // Render the single "editing field" chip shown in the status bar while a native bulk editor is
  // open. Re-resolves the column from the live config so a config swap mid-edit still matches.
  private renderBulkEditingChip(bar: HTMLElement, col: ColumnDef, onClick?: () => void): void {
    const chip = bar.createDiv({ cls: "db-selection-chip" + (onClick ? " is-clickable" : "") });
    renderPropertyTypeIcon(chip, col, "db-property-icon");
    chip.createSpan({ cls: "db-selection-chip-label", text: col.label || col.key });
    if (onClick) {
      chip.setAttr("role", "button");
      chip.setAttr("tabindex", "0");
      chip.setAttr("title", t("bulkEdit.editField"));
      chip.onclick = onClick;
      chip.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      };
    }
  }

  // Close the current native bulk editor and reopen the field menu so the user can switch fields.
  // Closing fires session.onClose which clears bulkEditingColumnKey and re-renders the status bar
  // back to its button form before the field menu opens.
  // Reopen the native bulk editor for the field currently shown in the chip (row selection).
  // The chip persists after the editor closes, so the user can click it to re-edit the same field.
  private openBulkEditNativeEditorForRows(): void {
    const config = this.getConfig();
    const paths = Array.from(this.selectedRows);
    if (!config || paths.length === 0 || !this.bulkEditingColumnKey) return;
    const column = config.schema.columns.find((candidate) => candidate.key === this.bulkEditingColumnKey);
    if (!column) return;
    const anchor = this.getStatusBarAnchor() ?? this.containerEl_!;
    this.openBulkEditNativeEditor(anchor, paths, column);
  }

  // Fields that drive board/grouping layouts; changing them may move records between groups.
  private collectBulkGroupingFields(): Set<string> {
    const view = this.getConfig();
    return new Set([
      this.vs().groupByField,
      view?.boardGroupField,
      view?.boardSubgroupEnabled ? view?.boardSubgroupField : undefined,
    ].filter((field): field is string => Boolean(field)));
  }

  // Fields referenced by any source rule (db-side always, view-side only when enabled). Editing a
  // field used in a source filter can drop records out of the database/view, so it is gated like a
  // grouping field.
  private collectSourceRuleFields(): Set<string> {
    const db = this.getActiveDb();
    const view = this.getConfig();
    if (!db) return new Set();
    const viewEnabled = view?.viewSourceRulesEnabled === true;
    const tree = mergeDbAndViewSourceRuleTrees(db, viewEnabled ? view : undefined);
    return new Set(getAllSourceRules(tree).map((rule) => rule.field));
  }

  private openBulkEditForRows(anchor: HTMLElement): void {
    const config = this.getConfig();
    const paths = Array.from(this.selectedRows);
    if (!config || paths.length === 0) return;
    this.cellRenderer.closeActiveBulkEditor();
    this.closeBulkEditPopover?.();
    this.closeBulkEditPopover = openBulkEditFieldMenu({
      anchor,
      columns: config.schema.columns,
      computedFields: config.schema.computedFields,
      onSelect: (column) => window.setTimeout(() => this.openBulkEditNativeEditor(anchor, paths, column), 0),
    });
  }

  private openBulkEditForSelectedCells(anchor: HTMLElement, columnKey: string): void {
    const config = this.getConfig();
    if (!config) return;
    const column = config.schema.columns.find((candidate) => candidate.key === columnKey);
    if (!column) return;
    const paths = Array.from(new Set(this.getSelectedCellAddresses()
      .filter((address) => address.colKey === columnKey)
      .map((address) => address.rowPath)));
    if (paths.length === 0) return;
    this.openBulkEditNativeEditor(anchor, paths, column);
  }

  // Shared router for cell-range "fill" actions (fill button + Enter on multi-cell selection):
  // single editable column → native bulk editor; otherwise toggle the plain text fill input.
  private openBulkEditOrFillForSelection(anchor?: HTMLElement | null): void {
    const columnKeys = new Set(this.getSelectedCellAddresses().map((address) => address.colKey));
    if (columnKeys.size === 1) {
      const config = this.getConfig();
      const col = config?.schema.columns.find((c) => c.key === [...columnKeys][0]);
      if (col && getBulkEditableColumns([col]).length && anchor) {
        this.showCellFillInput = false;
        this.pendingCellFillDraft = null;
        this.openBulkEditForSelectedCells(anchor, [...columnKeys][0]);
        return;
      }
    }
    this.showCellFillInput = !this.showCellFillInput;
    this.pendingCellFillDraft = null;
    this.renderSelectionStatusBar();
  }

  // Second layer: open the native CellRenderer editor for one column across the selected paths.
  // Re-reads records, skips missing, resolves common/mixed state, and routes every commit through
  // prepare → confirm → commit (value) or commitBulkCellOptionTransaction (options).
  private openBulkEditNativeEditor(anchor: HTMLElement, paths: string[], column: ColumnDef): void {
    const db = this.getActiveDb();
    const config = this.getConfig();
    if (!db || !config) return;
    const records = this.dataSource.getRecordsForDatabase(db);
    const recordByPath = new Map(records.map((record) => [record.file.path, record]));
    const existingPaths = paths.filter((path) => recordByPath.has(path));
    if (existingPaths.length === 0) {
      new Notice(t("bulkEdit.allMissing"));
      return;
    }
    const representativeRecord = recordByPath.get(existingPaths[0])!;
    const representative = this.rows.find((row) => row.file.path === existingPaths[0]) ?? {
      file: representativeRecord.file,
      frontmatter: representativeRecord.frontmatter,
      computed: {},
    };
    const key = this.getFrontmatterWriteKey(column);
    const values = existingPaths.map((path) => this.cloneFillValue(recordByPath.get(path)!.frontmatter[key]));
    const initial = resolveBulkEditInitialValue(column, values);

    // Close any still-open bulk editor first so its onClose clears the previous field before we
    // set the new one. Prevents a stale chip if the user switches fields or selections mid-edit.
    this.cellRenderer.closeActiveBulkEditor();
    this.closeBulkEditPopover?.();
    this.closeBulkEditPopover = undefined;

    // Flip the status bar into chip mode (field capsule only) and re-query the anchor from the
    // freshly rendered bar. The chip replaces the button group for the duration of the edit.
    this.bulkEditingColumnKey = column.key;
    this.renderSelectionStatusBar();
    const editorAnchor = this.getStatusBarAnchor();
    if (!editorAnchor) return;

    const editablePaths = existingPaths;
    const session: CellEditSession = {
      mixed: initial.mixed,
      // getter: the bar element is rebuilt on every renderSelectionStatusBar, so a captured
      // reference would go stale. Re-querying keeps the popover anchored to the live element.
      anchorEl: () => this.getBulkEditChipAnchor() ?? this.getStatusBarAnchor(),
      commitValue: async (value) => {
        const request = resolveBulkEditorRequest(column, value);
        const prepared = await this.prepareBulkEdit(editablePaths, request);
        if (!prepared) return;
        const confirmed = await this.confirmBulkEdit(editablePaths, request, prepared);
        if (!confirmed) return;
        await this.commitPreparedBulkEdit(confirmed);
      },
      commitOptionTransaction: async (transaction) => {
        await this.commitBulkCellOptionTransaction(editablePaths, column, transaction);
      },
      onClose: () => {
        // Keep bulkEditingColumnKey so the chip persists after the editor closes — the user can
        // click the chip to re-edit the same field. It is cleared when the row selection clears.
        this.renderSelectionStatusBar();
      },
    };
    this.cellRenderer.startEditSession(editorAnchor, representative, column, initial.value, session);
  }

  private async buildBulkEditContext(paths: string[], request: BulkEditorRequest): Promise<{
    plan: ReturnType<typeof buildBulkEditPlan>;
    impact: BulkEditImpact;
  }> {
    const db = this.getActiveDb();
    const view = this.getConfig();
    if (!db || !view) throw new Error("No active database");
    const column = getBulkEditableColumns(view.schema.columns).find((candidate) => candidate.key === request.columnKey);
    if (!column) throw new Error("Field is no longer editable");
    const records = this.dataSource.getRecordsForDatabase(db);
    const recordByPath = new Map(records.map((record) => [record.file.path, record]));
    const missingPaths = paths.filter((path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      return !(file instanceof TFile) || !recordByPath.has(path);
    });
    const key = this.getFrontmatterWriteKey(column);
    const targets = paths.flatMap((path) => {
      const record = recordByPath.get(path);
      if (!record) return [];
      return [{
        path,
        oldValue: this.cloneFillValue(record.frontmatter[key]),
        oldExists: Object.prototype.hasOwnProperty.call(record.frontmatter, key),
      }];
    });
    const plan = buildBulkEditPlan(column, request.mode, request.value, targets);
    const changeByPath = new Map(plan.changes.map((change) => [change.path, change]));
    const candidateRecords = records.map((record) => {
      const change = changeByPath.get(record.file.path);
      if (!change) return record;
      const frontmatter = { ...record.frontmatter };
      if (change.newValue === null) delete frontmatter[key];
      else frontmatter[key] = this.cloneFillValue(change.newValue);
      return { file: record.file, frontmatter };
    });
    const dbAfter = candidateRecords.filter((record) => this.dataSource.matchesRecordForDatabase(record, db));
    const effectiveConfig = this.getEffectiveConfig(db, view);
    const activeSourceAfter = dbAfter.filter((record) => this.dataSource.matchesRecordForDatabase(record, effectiveConfig));
    const resultAfter = this.buildRowsWithRelations(
      activeSourceAfter,
      view,
      this.vs(),
      db,
    );
    const groupingFields = this.collectBulkGroupingFields();
    const impact = buildBulkEditImpact(plan, {
      missingPaths,
      databasePathsAfter: new Set(dbAfter.map((record) => record.file.path)),
      viewPathsAfter: new Set(resultAfter.map((row) => row.file.path)),
      isGroupingField: groupingFields.has(column.key),
    });
    return { plan, impact };
  }

  private async applyBulkEdit(paths: string[], request: BulkEditorRequest): Promise<void> {
    const initial = await this.prepareBulkEdit(paths, request);
    if (!initial) return;
    const confirmed = await this.confirmBulkEdit(paths, request, initial);
    if (!confirmed) return;
    await this.commitPreparedBulkEdit(confirmed);
  }

  // Build impact + concrete frontmatter changes without any config/frontmatter mutation.
  private async prepareBulkEdit(paths: string[], request: BulkEditorRequest): Promise<PreparedBulkEdit | null> {
    const { plan, impact } = await this.buildBulkEditContext(paths, request);
    if (impact.changed === 0) {
      new Notice(t("bulkEdit.noChanges"));
      return null;
    }
    const config = this.getConfig();
    if (!config) return null;
    const column = config.schema.columns.find((candidate) => candidate.key === plan.column.key);
    if (!column) return null;
    const key = this.getFrontmatterWriteKey(column);
    const changes: CellEditChange[] = [];
    for (const change of plan.changes) {
      const file = this.app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) continue;
      changes.push({
        file,
        path: change.path,
        key,
        oldValue: this.cloneFillValue(change.oldValue),
        oldExists: change.oldExists,
        newValue: this.cloneFillValue(change.newValue),
      });
    }
    return { plan, impact, column, changes };
  }

  // Gate a prepared edit behind the confirmation modal, then re-prepare and reject if the
  // impact drifted while the modal was open. No writes occur here.
  private async confirmBulkEdit(paths: string[], request: BulkEditorRequest, prepared: PreparedBulkEdit): Promise<PreparedBulkEdit | null> {
    if (!prepared.impact.requiresConfirmation) return prepared;
    // Mobile native editors are high-z-index inline overlays. Close the active editor before
    // opening the shared modal so the confirmation is visible and receives touch input.
    if (Platform.isMobile || this.isPhoneLayout()) this.cellRenderer.closeActiveBulkEditor();
    const parts = [t("bulkEdit.confirmChanged", { count: prepared.impact.changed })];
    if (prepared.impact.leavesCurrentViewPaths.length) parts.push(t("bulkEdit.leavesView", { count: prepared.impact.leavesCurrentViewPaths.length }));
    if (prepared.impact.leavesDatabasePaths.length) parts.push(t("bulkEdit.leavesDatabase", { count: prepared.impact.leavesDatabasePaths.length }));
    if (prepared.impact.movesGroupPaths.length) parts.push(t("bulkEdit.movesGroup", { count: prepared.impact.movesGroupPaths.length }));
    if (prepared.impact.missingPaths.length) parts.push(t("bulkEdit.missing", { count: prepared.impact.missingPaths.length }));
    const confirmed = await confirmWithModal(this.app, {
      title: t("bulkEdit.confirmTitle"),
      message: parts.join("\n"),
      confirmText: t("bulkEdit.apply"),
      danger: prepared.plan.mode === "clear" || prepared.plan.mode === "remove",
    });
    if (confirmed !== true) return null;

    const confirmedImpact = JSON.stringify({
      changed: prepared.impact.changed,
      leavesCurrentViewPaths: prepared.impact.leavesCurrentViewPaths,
      leavesDatabasePaths: prepared.impact.leavesDatabasePaths,
      movesGroupPaths: prepared.impact.movesGroupPaths,
      missingPaths: prepared.impact.missingPaths,
    });
    const latest = await this.prepareBulkEdit(paths, request);
    if (!latest) return null;
    const latestImpact = JSON.stringify({
      changed: latest.impact.changed,
      leavesCurrentViewPaths: latest.impact.leavesCurrentViewPaths,
      leavesDatabasePaths: latest.impact.leavesDatabasePaths,
      movesGroupPaths: latest.impact.movesGroupPaths,
      missingPaths: latest.impact.missingPaths,
    });
    if (confirmedImpact !== latestImpact) {
      new Notice(t("bulkEdit.previewChanged"));
      return null;
    }
    return latest;
  }

  private async commitPreparedBulkEdit(prepared: PreparedBulkEdit): Promise<void> {
    const { plan, impact, column, changes } = prepared;
    if (!changes.length) {
      new Notice(t("bulkEdit.allMissing"));
      return;
    }
    const entry = this.getCurrentEntry();
    if (!entry) return;
    if (plan.optionPlan?.addedOptions.length) {
      const before = this.cloneDatabaseConfig(entry.config);
      column.statusOptions = plan.optionPlan.options;
      if (plan.optionPlan.clearPresetId) column.statusPresetId = undefined;
      await this.commitConfigAndCellChanges(entry, before, changes, t("undo.bulkEdit"));
    } else {
      await this.commitAtomicCellChanges(changes, t("undo.bulkEdit"));
    }
    const visiblePaths = new Set(this.rows.map((row) => row.file.path));
    const selectedCountBeforeRefresh = this.selectedRows.size;
    for (const path of Array.from(this.selectedRows)) if (!visiblePaths.has(path)) this.selectedRows.delete(path);
    if (this.selectedRows.size !== selectedCountBeforeRefresh) this.invalidateActiveBulkEditor();
    this.renderSelectionStatusBar();
    this.syncSelectionControls();
    const skipped = impact.missingPaths.length + (plan.changes.length - changes.length);
    new Notice(skipped > 0
      ? t("bulkEdit.completedSkipped", { count: changes.length, skipped })
      : t("bulkEdit.completed", { count: changes.length }));
  }

  private renderSelectionStatusBar(): void {
    if (!this.containerEl_) return;
    this.closeBulkEditPopover?.();
    this.containerEl_.querySelector(":scope > .db-selection-status-bar")?.remove();
    const rowCount = this.selectedRows.size;
    const addresses = this.getSelectedCellAddresses();
    const cellCount = addresses.length;
    const config = this.getConfig();
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
      const columnKeys = new Set(addresses.map((address) => address.colKey));
      let chipRendered = false;
      if (this.pendingCellFillDraft == null && columnKeys.size === 1) {
        const col = config?.schema.columns.find((candidate) => candidate.key === [...columnKeys][0]);
        if (col && getBulkEditableColumns([col]).length) {
          this.renderBulkEditingChip(bar, col, () => this.openBulkEditForSelectedCells(this.getStatusBarAnchor() ?? this.containerEl_!, col.key));
          chipRendered = true;
        }
      }
      if (!chipRendered) {
        const fillBtn = bar.createEl("button", {
          cls: "db-selection-action",
          text: t("selection.fillValue"),
          attr: { type: "button" },
        });
        fillBtn.onclick = () => {
          this.openBulkEditOrFillForSelection(fillBtn);
        };
        if (this.showCellFillInput) this.renderCellFillInput(bar);
      }
      const clearBtn = bar.createEl("button", {
        cls: "db-selection-delete",
        text: t("selection.clearCells"),
        attr: { type: "button" },
      });
      clearBtn.onclick = () => { void this.clearSelectedCells(); };
    } else {
      bar.createSpan({ cls: "db-selection-count", text: t("toolbar.selectedCount", { count: rowCount }) });
      const editBtn = bar.createEl("button", {
        cls: "db-selection-action",
        text: t("bulkEdit.editField"),
        attr: { type: "button" },
      });
      editBtn.onclick = () => this.openBulkEditForRows(editBtn);
      const editingCol = this.bulkEditingColumnKey ? config?.schema.columns.find((candidate) => candidate.key === this.bulkEditingColumnKey) : undefined;
      if (editingCol) {
        this.renderBulkEditingChip(bar, editingCol, () => this.openBulkEditNativeEditorForRows());
      }
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
    input.value = this.pendingCellFillDraft ?? "";
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
      if (isImeComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.showCellFillInput = false;
        this.pendingCellFillDraft = null;
        this.renderSelectionStatusBar();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        void this.fillSelectedCells(input.value);
      }
    };
    input.oninput = () => { this.pendingCellFillDraft = input.value; };
    apply.onclick = (event) => event.stopPropagation();
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
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

  private includePendingNewRecords(records: NoteRecord[]): NoteRecord[] {
    if (this.pendingNewRecords.size === 0) return records;
    const now = Date.now();
    const found = new Set<string>();
    const merged = records.map((record) => {
      const pending = this.pendingNewRecords.get(record.file.path);
      if (!pending) return record;
      found.add(record.file.path);
      return {
        file: record.file,
        frontmatter: { ...pending.frontmatter, ...record.frontmatter },
      };
    });

    for (const [path, pending] of this.pendingNewRecords) {
      if (found.has(path)) {
        if (path !== this.pendingNewFilePath) this.pendingNewRecords.delete(path);
        continue;
      }
      if (now > pending.expiresAt) {
        this.pendingNewRecords.delete(path);
        continue;
      }
      if (this.pendingRecordMatchesActiveSource(pending)) {
        merged.push({ file: pending.file, frontmatter: pending.frontmatter });
      }
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
      const focusRequest = this.pendingNewRowCellFocus?.rowPath === path
        ? this.pendingNewRowCellFocus
        : undefined;
      const focusCell = focusRequest
        ? target.querySelector<HTMLElement>(
            `td[data-note-database-column-key="${CSS.escape(focusRequest.colKey)}"]`
          )
        : null;
      const scrollTarget = focusCell || (target.matches("tr")
        ? target.querySelector<HTMLElement>("td") || target
        : target);
      if (this.getConfig()?.viewType === "list") {
        this.revealListRowLeadingEdge(target);
      } else {
        scrollTarget.scrollIntoView(resolveNewRecordRevealBehavior(
          this.getConfig()?.viewType,
          Boolean(focusCell),
        ));
      }
      if (focusCell && focusRequest) {
        this.selectedRows.clear();
        this.lastSelectedRowPath = null;
        const address = { rowPath: focusRequest.rowPath, colKey: focusRequest.colKey };
        this.cellSelection = { anchor: address, focus: address };
        this.renderCellSelectionClasses();
        this.renderSelectionStatusBar();
        focusCell.focus({ preventScroll: true });
      }
      target.addClass("is-new-record-highlight");
      this.clearPendingNewRow();
      window.setTimeout(() => {
        if (target.isConnected) target.removeClass("is-new-record-highlight");
      }, 2200);
    });
  }

  private revealPendingSearchResult(): void {
    const path = this.pendingSearchResultRevealPath;
    if (!path || !this.containerEl_) return;
    const target = this.findRenderedRowElement(path);
    if (!target) return;
    this.pendingSearchResultRevealPath = undefined;
    window.requestAnimationFrame(() => {
      if (!target.isConnected) return;
      target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      target.addClass("is-new-record-highlight");
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
    const pending = this.pendingNewRecords.get(this.pendingNewFilePath);
    if (!pending) {
      this.clearPendingNewRow();
      return;
    }
    if (Date.now() > pending.expiresAt) {
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
    const path = this.pendingNewFilePath;
    this.pendingNewFilePath = undefined;
    if (path) this.pendingNewRecords.delete(path);
    this.pendingNewRowCellFocus = undefined;
    this.creatingKeyboardRow = false;
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

  private setupRowInteractions(tr: HTMLElement, row: RowData, context?: RowCreateContext): void {
    this.rowMenu.attachToRow(tr, row, context);
  }

  private async deleteRow(row: RowData): Promise<void> {
    const displayName = row.file.name.replace(/\.md$/, "");
    try {
      await this.dataSource.trashNote(row.file, { sourceInstanceId: this.instanceId });
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

  private async duplicateRow(row: RowData): Promise<void> {
    try {
      const file = await this.dataSource.duplicateNote(
        row.file,
        t("menu.copySuffix"),
        { sourceInstanceId: this.instanceId }
      );
      new Notice(t("notice.duplicatedRecord", { path: file.path }));
      this.pendingNewFilePath = file.path;
      this.pendingNewRecords.set(file.path, { file, frontmatter: { ...row.frontmatter }, expiresAt: Date.now() + 8000 });
      await this.refreshAfterSave();
    } catch (err) {
      console.error("Note Database: failed to duplicate row", err);
      new Notice(t("errors.deleteFailed", { error: String(err) }));
    }
  }

  private async renameFileWithHistory(row: RowData, newName: string): Promise<boolean> {
    const entry = this.getCurrentEntry();
    if (!entry) return false;
    const plan = planFileRenames(
      [{ sourcePath: row.file.path, newName }],
      this.app.vault.getMarkdownFiles().map((file) => file.path),
    );
    if (plan.conflicts.length > 0) {
      const conflict = plan.conflicts[0];
      if (conflict.reason === "empty") return false;
      new Notice(t("errors.fileExists", { name: conflict.targetPath || newName }));
      return false;
    }
    if (plan.changes.length === 0) return true;

    const before = this.cloneDatabaseConfig(entry.config);
    this.remapRecordPathsInConfig(entry.config, plan.changes, "new");
    const after = this.cloneDatabaseConfig(entry.config);
    const configChanged = JSON.stringify(before) !== JSON.stringify(after);
    const dbFile = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    let renamed = false;
    try {
      await this.executeFileRenamesAtomically(plan.changes, "new");
      renamed = true;
      if (configChanged && dbFile instanceof TFile) {
        this.suppressDataReload(2500);
        await this.dataSource.updateViewDefFile(dbFile, entry.config, this.getCurrentMutationTarget());
      }
      this.configSnapshots.set(this.getConfigHistoryKey(entry), after);
      this.pushHistory({
        type: "config",
        label: t("undo.renameFile"),
        dbId: entry.config.id,
        dbPath: entry.sourcePath,
        viewId: this.getConfig()?.id,
        before,
        after,
        fileRenames: plan.changes,
      });
      this.remapTransientRecordPaths(plan.changes, "new");
      await this.refreshAfterSave();
      if (this.cellSelection) this.restorePreservedCellSelectionAfterRefresh();
      this.rerenderToolbar();
      return true;
    } catch (err) {
      this.replaceDatabaseConfig(entry.config, before);
      this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
      if (configChanged && dbFile instanceof TFile) {
        try {
          await this.dataSource.updateViewDefFile(dbFile, entry.config, this.getCurrentMutationTarget());
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back file rename config", rollbackErr);
        }
      }
      if (renamed) {
        try {
          await this.executeFileRenamesAtomically(plan.changes, "old");
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back file rename", rollbackErr);
        }
      }
      new Notice(t("errors.renameFailed", { error: String(err) }));
      return false;
    }
  }

  private async executeFileRenamesAtomically(
    changes: FileRenameChange[],
    direction: "old" | "new",
  ): Promise<void> {
    if (changes.length === 0) return;
    const moves = changes.map((change) => ({
      sourcePath: direction === "new" ? change.oldPath : change.newPath,
      targetPath: direction === "new" ? change.newPath : change.oldPath,
    }));
    const sourceKeys = new Set(moves.map((move) => move.sourcePath.normalize("NFC").toLowerCase()));
    const targetKeys = new Set<string>();
    const occupiedByKey = new Map(
      this.app.vault.getMarkdownFiles().map((file) => [file.path.normalize("NFC").toLowerCase(), file] as const),
    );
    const stages: Array<{ file: TFile; sourcePath: string; targetPath: string; tempPath: string }> = [];
    for (let index = 0; index < moves.length; index++) {
      const move = moves[index];
      const file = this.app.vault.getAbstractFileByPath(move.sourcePath);
      if (!(file instanceof TFile)) throw new Error(`Rename source no longer exists: ${move.sourcePath}`);
      const targetKey = move.targetPath.normalize("NFC").toLowerCase();
      if (targetKeys.has(targetKey)) throw new Error(`Duplicate rename target: ${move.targetPath}`);
      targetKeys.add(targetKey);
      if (occupiedByKey.has(targetKey) && !sourceKeys.has(targetKey)) {
        throw new Error(`Rename target already exists: ${move.targetPath}`);
      }
      stages.push({
        file,
        sourcePath: move.sourcePath,
        targetPath: move.targetPath,
        tempPath: this.getTemporaryRenamePath(move.sourcePath, index),
      });
    }

    try {
      for (const stage of stages) {
        this.suppressDataReload(2500);
        await this.dataSource.renameNote(
          stage.file,
          stage.tempPath,
          { sourceInstanceId: this.instanceId }
        );
      }
      for (const stage of stages) {
        this.suppressDataReload(2500);
        await this.dataSource.renameNote(
          stage.file,
          stage.targetPath,
          { sourceInstanceId: this.instanceId }
        );
      }
    } catch (err) {
      await this.rollbackFileRenameStages(stages);
      throw err;
    }
  }

  private getTemporaryRenamePath(sourcePath: string, index: number): string {
    const slash = sourcePath.lastIndexOf("/");
    const parent = slash >= 0 ? sourcePath.slice(0, slash + 1) : "";
    let attempt = 0;
    while (true) {
      const candidate = normalizePath(
        `${parent}note-database-rename-${this.instanceId}-${Date.now()}-${index}-${attempt}.md`,
      );
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
      attempt += 1;
    }
  }

  private async rollbackFileRenameStages(
    stages: Array<{ file: TFile; sourcePath: string; targetPath: string; tempPath: string }>,
  ): Promise<void> {
    const moved = stages.filter((stage) => stage.file.path !== stage.sourcePath);
    const restaged: Array<{ stage: typeof stages[number]; tempPath: string }> = [];
    for (let index = 0; index < moved.length; index++) {
      const stage = moved[index];
      try {
        const tempPath = this.getTemporaryRenamePath(stage.sourcePath, stages.length + index);
        this.suppressDataReload(2500);
        await this.dataSource.renameNote(
          stage.file,
          tempPath,
          { sourceInstanceId: this.instanceId }
        );
        restaged.push({ stage, tempPath });
      } catch (rollbackErr) {
        console.error("Note Database: failed to stage file rename rollback", rollbackErr);
      }
    }
    for (const { stage } of restaged) {
      try {
        this.suppressDataReload(2500);
        await this.dataSource.renameNote(
          stage.file,
          stage.sourcePath,
          { sourceInstanceId: this.instanceId }
        );
      } catch (rollbackErr) {
        console.error("Note Database: failed to restore file rename source", rollbackErr);
      }
    }
  }

  private remapRecordPathsInConfig(
    database: DatabaseConfig,
    changes: FileRenameChange[],
    direction: "old" | "new",
  ): void {
    const pathMap = new Map(changes.map((change) => (
      direction === "new" ? [change.oldPath, change.newPath] : [change.newPath, change.oldPath]
    )));
    const remapPath = (path: string): string => pathMap.get(path) || path;
    for (const view of database.views) {
      const ranks = view.manualOrder?.ranks;
      if (ranks) {
        view.manualOrder = {
          ...(view.manualOrder || {}),
          ranks: Object.fromEntries(Object.entries(ranks).map(([path, rank]) => [remapPath(path), rank])),
        };
      }
      if (view.boardCardOrders) {
        view.boardCardOrders = Object.fromEntries(
          Object.entries(view.boardCardOrders).map(([field, groups]) => [
            field,
            Object.fromEntries(Object.entries(groups).map(([group, paths]) => [group, paths.map(remapPath)])),
          ]),
        );
      }
      this.remapFileGroupState(view, pathMap);
    }
  }

  private remapFileGroupState(view: ViewConfig, pathMap: Map<string, string>): void {
    const fileGroupFields = new Set(["file.name", "file.basename", "file.path", "file.file"]);
    const groupValueMap = (field: string): Map<string, string> => new Map(
      Array.from(pathMap, ([oldPath, newPath]) => [
        this.getFileGroupValueForPath(field, oldPath),
        this.getFileGroupValueForPath(field, newPath),
      ]),
    );
    const remapListMap = (source: Record<string, string[]> | undefined): Record<string, string[]> | undefined => {
      if (!source) return source;
      return Object.fromEntries(Object.entries(source).map(([field, values]) => {
        if (!fileGroupFields.has(field)) return [field, values];
        const valuesMap = groupValueMap(field);
        return [field, values.map((value) => valuesMap.get(value) || value)];
      }));
    };
    view.groupOrders = remapListMap(view.groupOrders);
    view.collapsedGroups = remapListMap(view.collapsedGroups);
    if (view.expandedGroupRows) {
      view.expandedGroupRows = Object.fromEntries(
        Object.entries(view.expandedGroupRows).map(([field, values]) => {
          if (!fileGroupFields.has(field)) return [field, values];
          const valuesMap = groupValueMap(field);
          return [field, Object.fromEntries(Object.entries(values).map(([value, count]) => [valuesMap.get(value) || value, count]))];
        }),
      );
    }
  }

  private getFileGroupValueForPath(field: string, path: string): string {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (field === "file.name") return name;
    if (field === "file.basename") return name.replace(/\.md$/i, "");
    if (field === "file.path" || field === "file.file") return path;
    return path;
  }

  private remapTransientRecordPaths(changes: FileRenameChange[], direction: "old" | "new"): void {
    const pathMap = new Map(changes.map((change) => (
      direction === "new" ? [change.oldPath, change.newPath] : [change.newPath, change.oldPath]
    )));
    const remap = (path: string): string => pathMap.get(path) || path;
    if (this.cellSelection) {
      this.cellSelection = {
        anchor: { ...this.cellSelection.anchor, rowPath: remap(this.cellSelection.anchor.rowPath) },
        focus: { ...this.cellSelection.focus, rowPath: remap(this.cellSelection.focus.rowPath) },
        active: this.cellSelection.active
          ? { ...this.cellSelection.active, rowPath: remap(this.cellSelection.active.rowPath) }
          : undefined,
      };
    }
    this.selectedRows = new Set(Array.from(this.selectedRows, remap));
    if (this.lastSelectedRowPath) this.lastSelectedRowPath = remap(this.lastSelectedRowPath);
  }

  private renderCell(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef
  ): void {
    this.cellRenderer.renderCell(td, row, col);
    const config = this.getConfig();
    if (config) applyConditionalFormat(td, row, config, this.getActiveDb(), col.key);
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
    if (col.type === "computed" || col.type === "rollup") return false;
    if (!isFileFieldKey(col.key)) return true;
    return col.key === "file.tags";
  }

  private canPasteColumn(col: ColumnDef): boolean {
    return col.key === "file.name" || this.canFillColumn(col);
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
    await this.applyCellChangeOptimistically(
      change,
      t("undo.editCell"),
      !this.canApplyCellChangeOptimistically(col),
    );
  }

  private canApplyCellChangeOptimistically(col: ColumnDef): boolean {
    if (col.type === "computed" || col.type === "rollup" || isFileFieldKey(col.key)) return false;
    const config = this.getConfig();
    if (!config) return false;
    const state = this.vs();
    const groupField = config.viewType === "board"
      ? config.boardGroupField || state.groupByField || this.getDefaultBoardField(config)
      : state.groupByField;
    if (groupField === col.key) return false;
    if (config.viewType === "board" && config.boardSubgroupField === col.key) return false;
    if (config.viewType !== "table" && config.titleField === col.key) return false;
    if (config.viewType === "gallery" && config.galleryImageField === col.key) return false;
    if (state.searchText.trim()) return false;
    if (state.sortColumn === col.key || state.sortRules.some((rule) => rule.field === col.key)) return false;
    if (getEffectiveFilterRules(state.filters).some((rule) => rule.field === col.key)) return false;
    if (this.isColumnReferencedByComputedFields(col.key)) return false;
    if (config.schema.columns.some((column) =>
      column.type === "rollup" && column.rollupConfig?.relationField === col.key
    )) return false;
    return true;
  }

  private async applyCellChangeOptimistically(
    change: CellEditChange,
    label: string,
    reconcileAfterWrite = false,
  ): Promise<void> {
    this.suppressDataReload(1200);
    const rollback: CellEditChange = {
      ...change,
      newValue: change.oldExists ? this.cloneFillValue(change.oldValue) : null,
    };
    this.applyFrontmatterChangeToRenderedRows(change);
    const row = this.rows.find((candidate) => candidate.file.path === change.path);
    const col = this.getConfig()?.schema.columns.find((candidate) => candidate.key === change.key);
    const config = this.getConfig();
    const database = this.getActiveDb();
    const updatesRecordIcon = Boolean(
      row &&
      col &&
      config &&
      database &&
      resolveRecordIconField(database, config) === col.key
    );
    if (row && col) {
      if (!updatesRecordIcon || this.isRowFieldRendered(row, col)) this.updateCellDOM(row, col);
      if (updatesRecordIcon && config) this.updateRecordIconDOM(row, config);
    }
    try {
      await this.dataSource.updateFrontmatter(
        change.file,
        { [change.key]: change.newValue },
        { sourceInstanceId: this.instanceId }
      );
    } catch (err) {
      this.applyFrontmatterChangeToRenderedRows(rollback);
      if (row && col) {
        if (!updatesRecordIcon || this.isRowFieldRendered(row, col)) this.updateCellDOM(row, col);
        if (updatesRecordIcon && config) this.updateRecordIconDOM(row, config);
      }
      new Notice(t("errors.updateFailed", { error: String(err) }));
      return;
    }
    this.pushHistory({ type: "cells", label, changes: [change] });
    if (!reconcileAfterWrite) return;
    await this.syncComputedForCellChanges([change]);
    await this.refreshAfterSave();
    this.rerenderToolbar();
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
    this.updateConditionalFormatDOM(row, config);
  }

  private updateConditionalFormatDOM(row: RowData, config: ViewConfig): void {
    if (!this.containerEl_) return;
    const selector = `[data-note-database-row-path="${CSS.escape(row.file.path)}"]`;
    for (const element of Array.from(this.containerEl_.querySelectorAll<HTMLElement>(selector))) {
      if (element.matches("td[data-note-database-column-key]")) continue;
      const field = element.getAttribute("data-note-database-column-key") || undefined;
      applyConditionalFormat(element, row, config, this.getActiveDb(), field);
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
    const config = this.getConfig();
    if (config) applyConditionalFormat(newTd, row, config, this.getActiveDb(), col.key);
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
      await this.dataSource.updateFrontmatter(
        entry.file,
        entry.updates,
        { sourceInstanceId: this.instanceId }
      );
    }
  }

  private async applyFrontmatterChangesAtomically(
    changes: CellEditChange[],
    direction: "old" | "new",
  ): Promise<void> {
    const byPath = new Map<string, CellEditChange[]>();
    for (const change of changes) {
      const list = byPath.get(change.path) || [];
      list.push(change);
      byPath.set(change.path, list);
    }
    const applied: CellEditChange[] = [];
    try {
      for (const pathChanges of byPath.values()) {
        await this.applyFrontmatterChanges(pathChanges, direction);
        applied.push(...pathChanges);
      }
    } catch (err) {
      if (applied.length > 0) {
        await this.applyFrontmatterChanges(applied, direction === "new" ? "old" : "new");
      }
      throw err;
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

  private async fillSelectedCellsFromEdge(direction: "down" | "right"): Promise<void> {
    if (!this.cellSelection) return;
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const steps = planTableSelectionFill(
      rowPaths,
      colKeys,
      this.cellSelection.anchor,
      this.cellSelection.focus,
      direction,
    );
    if (steps.length === 0) return;

    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const colByKey = new Map(this.getConfig().schema.columns.map((col) => [col.key, col]));
    const changes: CellEditChange[] = [];
    let skipped = 0;
    for (const step of steps) {
      const sourceRow = rowByPath.get(step.source.rowPath);
      const sourceCol = colByKey.get(step.source.colKey);
      const targetRow = rowByPath.get(step.target.rowPath);
      const targetCol = colByKey.get(step.target.colKey);
      if (!sourceRow || !sourceCol || !targetRow || !targetCol || !this.canFillColumn(targetCol)) {
        skipped += 1;
        continue;
      }
      const value = direction === "down"
        ? this.cloneFillValue(this.getFillValue(sourceRow, sourceCol))
        : this.normalizeBatchInputValue(targetCol, this.getColumnDisplayText(sourceRow, sourceCol));
      const invalidTags = this.getInvalidFileTagValues(targetCol, value);
      if (invalidTags.length > 0) {
        skipped += 1;
        this.showInvalidFileTagsNotice(invalidTags);
        continue;
      }
      const change = this.createCellChange(targetRow, targetCol, value);
      if (!this.areCellValuesEqual(change.oldValue, change.newValue)) changes.push(change);
    }
    if (changes.length === 0) {
      if (skipped > 0) new Notice(t("notice.noEditableCellsSkipped", { skipped }));
      return;
    }
    try {
      await this.applyCellChanges(changes, t("undo.fillCells"), { preserveCellSelection: true });
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

  private getSelectedCellClipboardPayload(
    format: "tsv" | "markdown" | "csv" = "tsv",
  ): { selected: CellAddress[]; content: string } | null {
    const selected = this.getSelectedCellAddresses();
    if (selected.length === 0) return null;
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const colByKey = new Map(this.getConfig().schema.columns.map((col) => [col.key, col]));
    const content = serializeClipboardSelectedCells(
      format,
      selected,
      rowPaths,
      colKeys,
      rowByPath,
      colByKey,
      (row, col) => this.getColumnDisplayText(row, col),
    );
    return { selected, content };
  }

  private async copySelectedCells(format: "tsv" | "markdown" | "csv" = "tsv"): Promise<void> {
    const payload = this.getSelectedCellClipboardPayload(format);
    if (!payload) return;
    await navigator.clipboard.writeText(payload.content);
    this.cancelPendingCellCut();
    new Notice(t("notice.copiedCells", { count: payload.selected.length }));
  }

  private async cutSelectedCells(): Promise<void> {
    const payload = this.getSelectedCellClipboardPayload("tsv");
    if (!payload) return;
    const plan = this.getSelectedEditableCellTargetPlan();
    await navigator.clipboard.writeText(payload.content);
    this.cancelPendingCellCut(false);
    if (plan.targets.length === 0) {
      new Notice(plan.skipped > 0
        ? t("notice.noEditableCellsSkipped", { skipped: plan.skipped })
        : t("notice.noEditableCells"));
      return;
    }
    const clearChanges = plan.targets.map((target) => this.createCellChange(target.row, target.col, null));
    this.pendingCellCut = {
      addressKeys: new Set(payload.selected.map((address) => `${address.rowPath}\u0000${address.colKey}`)),
      clearChanges: clearChanges.map((change) => this.cloneCellChange(change)),
      clipboardText: payload.content,
    };
    this.renderCellSelectionClasses();
    new Notice(t("notice.cutCells", { count: plan.targets.length }));
  }

  private cancelPendingCellCut(render = true): void {
    if (!this.pendingCellCut) return;
    this.pendingCellCut = null;
    if (render) this.renderCellSelectionClasses();
  }

  private resolvePendingCellCut(clipboardText: string): { clearChanges: CellEditChange[] } | null {
    const pending = this.pendingCellCut;
    if (!pending) return null;
    if (pending.clipboardText !== clipboardText) {
      this.cancelPendingCellCut();
      return null;
    }
    for (const change of pending.clearChanges) {
      const file = this.app.vault.getAbstractFileByPath(change.path);
      if (!(file instanceof TFile)) {
        this.cancelPendingCellCut();
        new Notice(t("notice.cutSourceChanged"));
        return null;
      }
      const frontmatter = this.dataSource.getFrontmatterSnapshot(file);
      const exists = Object.prototype.hasOwnProperty.call(frontmatter, change.key);
      if (exists !== change.oldExists || !this.areCellValuesEqual(frontmatter[change.key], change.oldValue)) {
        this.cancelPendingCellCut();
        new Notice(t("notice.cutSourceChanged"));
        return null;
      }
    }
    return { clearChanges: pending.clearChanges.map((change) => this.cloneCellChange(change)) };
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
    // Conservative gate for cross-column fills: large batches, grouping fields (may move records
    // between board groups), or source-rule fields (may drop records out of the database/view).
    const affectedColumns = new Set(plan.targets.map((target) => target.col.key));
    const groupingFields = this.collectBulkGroupingFields();
    const sourceRuleFields = this.collectSourceRuleFields();
    const requiresConfirmation =
      changes.length >= 20 ||
      [...affectedColumns].some((k) => groupingFields.has(k)) ||
      [...affectedColumns].some((k) => sourceRuleFields.has(k));
    if (requiresConfirmation && !await confirmWithModal(this.app, {
      title: t("bulkEdit.confirmTitle"),
      message: t("bulkEdit.confirmChanged", { count: changes.length }),
      confirmText: t("bulkEdit.apply"),
      danger: true,
    })) return;
    await this.applyExplicitOptionCellChanges(
      changes,
      t("undo.fillCells"),
      { preserveCellSelection: true },
    );
    this.showCellFillInput = false;
    this.pendingCellFillDraft = null;
    this.renderSelectionStatusBar();
    this.showBatchNotice("filled", changes.length, skipped);
  }

  private async pasteCellsFromClipboard(): Promise<void> {
    if (!this.cellSelection) return;
    const text = await navigator.clipboard.readText();
    const matrix = parseClipboardTable(text);
    if (matrix.length === 0 || matrix.every((row) => row.length === 0)) return;
    const plan = this.getPasteTargetPlan(matrix);
    const changes: CellEditChange[] = [];
    const renameRequests: FileRenameRequest[] = [];
    let skipped = plan.skipped;
    for (const target of plan.targets) {
      if (target.col.key === "file.name") {
        if (!normalizeFileRenameBasename(target.value)) {
          skipped += 1;
          continue;
        }
        renameRequests.push({ sourcePath: target.row.file.path, newName: target.value });
        continue;
      }
      const invalidTags = this.getInvalidFileTagValues(target.col, target.value);
      if (invalidTags.length > 0) {
        skipped += 1;
        this.showInvalidFileTagsNotice(invalidTags);
        continue;
      }
      changes.push(this.createCellChange(target.row, target.col, this.normalizeBatchInputValue(target.col, target.value)));
    }
    const renamePlan = planFileRenames(
      renameRequests,
      this.app.vault.getMarkdownFiles().map((file) => file.path),
    );
    if (renamePlan.conflicts.length > 0) {
      this.showFileRenameConflict(renamePlan.conflicts[0], renameRequests);
      return;
    }
    if (plan.layout?.newRows) {
      await this.pasteCellsWithCreatedRows(text, matrix, plan, changes, renamePlan.changes, skipped);
      return;
    }
    if (plan.targets.length === 0) {
      new Notice(skipped > 0 ? t("notice.noEditableCellsSkipped", { skipped }) : t("notice.noEditableCells"));
      return;
    }
    const pendingCut = this.resolvePendingCellCut(text);
    const combinedChanges = pendingCut
      ? this.mergeCellChanges(pendingCut.clearChanges, changes)
      : this.mergeCellChanges(changes);
    if (plan.selection) this.cellSelection = plan.selection;
    if (combinedChanges.length === 0 && renamePlan.changes.length === 0) {
      if (pendingCut) this.cancelPendingCellCut();
      this.renderCellSelectionClasses();
      this.renderSelectionStatusBar();
      return;
    }
    const label = t(pendingCut ? "undo.moveCells" : "undo.pasteCells");
    if (renamePlan.changes.length > 0) {
      await this.commitPasteWithFileRenames(combinedChanges, renamePlan.changes, label);
    } else {
      await this.applyExplicitOptionCellChanges(
        combinedChanges,
        label,
        { preserveCellSelection: true },
      );
    }
    this.showBatchNotice("pasted", changes.length + renamePlan.changes.length, skipped);
  }

  private showFileRenameConflict(
    conflict: ReturnType<typeof planFileRenames>["conflicts"][number],
    requests: FileRenameRequest[],
  ): void {
    if (conflict.reason === "empty") return;
    const request = requests.find((candidate) => candidate.sourcePath === conflict.sourcePath);
    new Notice(t("errors.fileExists", { name: conflict.targetPath || request?.newName || conflict.sourcePath }));
  }

  private remapCellChangePaths(
    changes: CellEditChange[],
    fileRenames: FileRenameChange[],
    direction: "old" | "new",
  ): CellEditChange[] {
    const pathMap = new Map(fileRenames.map((change) => (
      direction === "new" ? [change.oldPath, change.newPath] : [change.newPath, change.oldPath]
    )));
    return changes.map((change) => {
      const path = pathMap.get(change.path) || change.path;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`Paste target no longer exists: ${path}`);
      return { ...this.cloneCellChange(change), file, path };
    });
  }

  private async commitPasteWithFileRenames(
    changes: CellEditChange[],
    fileRenames: FileRenameChange[],
    label: string,
  ): Promise<void> {
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const before = this.cloneDatabaseConfig(entry.config);
    for (const change of changes) {
      const col = entry.config.schema.columns.find((candidate) => this.getFrontmatterWriteKey(candidate) === change.key);
      if (col) change.newValue = this.registerPastedOptionValue(col, change.newValue);
    }
    this.remapRecordPathsInConfig(entry.config, fileRenames, "new");
    const after = this.cloneDatabaseConfig(entry.config);
    const configChanged = JSON.stringify(before) !== JSON.stringify(after);
    const dbFile = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    let renamed = false;
    let configWriteAttempted = false;
    let remappedChanges: CellEditChange[] = [];
    const applied: CellEditChange[] = [];
    try {
      await this.executeFileRenamesAtomically(fileRenames, "new");
      renamed = true;
      remappedChanges = this.remapCellChangePaths(changes, fileRenames, "new");
      if (configChanged && dbFile instanceof TFile) {
        configWriteAttempted = true;
        this.suppressDataReload(2500);
        await this.dataSource.updateViewDefFile(dbFile, entry.config, this.getCurrentMutationTarget());
      }
      const byPath = new Map<string, CellEditChange[]>();
      for (const change of remappedChanges) {
        const list = byPath.get(change.path) || [];
        list.push(change);
        byPath.set(change.path, list);
      }
      for (const pathChanges of byPath.values()) {
        const updates: Record<string, unknown> = {};
        for (const change of pathChanges) updates[change.key] = this.cloneFillValue(change.newValue);
        this.suppressDataReload(2500);
        await this.dataSource.updateFrontmatter(
          pathChanges[0].file,
          updates,
          { sourceInstanceId: this.instanceId }
        );
        applied.push(...pathChanges);
      }
    } catch (err) {
      if (applied.length > 0) {
        try {
          await this.applyFrontmatterChanges(applied, "old");
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back renamed paste values", rollbackErr);
        }
      }
      this.replaceDatabaseConfig(entry.config, before);
      if (configWriteAttempted && dbFile instanceof TFile) {
        try {
          this.suppressDataReload(2500);
          await this.dataSource.updateViewDefFile(dbFile, entry.config, this.getCurrentMutationTarget());
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back renamed paste config", rollbackErr);
        }
      }
      if (renamed) {
        try {
          await this.executeFileRenamesAtomically(fileRenames, "old");
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back pasted file names", rollbackErr);
        }
      }
      this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
      new Notice(t("errors.batchFillFailed", { error: String(err) }));
      return;
    }

    this.configSnapshots.set(this.getConfigHistoryKey(entry), after);
    this.pushHistory({
      type: "config",
      label,
      dbId: entry.config.id,
      dbPath: entry.sourcePath,
      viewId: this.getConfig()?.id,
      before,
      after,
      cellChanges: changes.length > 0 ? changes.map((change) => this.cloneCellChange(change)) : undefined,
      fileRenames: fileRenames.map((change) => ({ ...change })),
    });
    this.remapTransientRecordPaths(fileRenames, "new");
    await this.syncComputedForCellChanges(remappedChanges);
    await this.refreshAfterSave();
    if (this.cellSelection) this.restorePreservedCellSelectionAfterRefresh();
    this.rerenderToolbar();
  }

  private preparePasteNewRows(
    matrix: string[][],
    plan: PasteTargetPlan,
  ): { rows: PasteNewRowInput[]; skipped: number } {
    const layout = plan.layout;
    if (!layout || layout.newRows === 0) return { rows: [], skipped: 0 };
    const config = this.getConfig();
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const colByKey = new Map(config.schema.columns.map((col) => [col.key, col]));
    const contextRow = rowByPath.get(rowPaths[rowPaths.length - 1]);
    if (!contextRow) return { rows: [], skipped: 0 };
    const createContext = this.getRenderedTableRowCreateContext(contextRow.file.path);
    const groupDefaults = this.getCreateEntryDefaultsForRow(contextRow, createContext);
    const rows: PasteNewRowInput[] = [];
    let skipped = 0;

    for (let r = layout.existingRows; r < layout.fillRows; r++) {
      const pastedDefaults: Record<string, unknown> = {};
      const pastedCells: PasteNewRowInput["pastedCells"] = [];
      for (let c = 0; c < layout.usableCols; c++) {
        const col = colByKey.get(colKeys[layout.startCol + c]);
        if (!col) continue;
        if (!this.canPasteColumn(col)) {
          skipped += 1;
          continue;
        }
        const input = getTablePasteValue(matrix, r, c);
        const invalidTags = this.getInvalidFileTagValues(col, input);
        if (invalidTags.length > 0) {
          skipped += 1;
          this.showInvalidFileTagsNotice(invalidTags);
          continue;
        }
        if (col.key === "file.name") {
          const fileName = normalizeFileRenameBasename(input);
          if (fileName) pastedCells.push({ col, key: col.key, value: fileName });
          continue;
        }
        const key = this.getFrontmatterWriteKey(col);
        const value = this.normalizeCellValueForChange(col, this.normalizeBatchInputValue(col, input));
        pastedDefaults[key] = this.cloneFillValue(value);
        pastedCells.push({ col, key, value: this.cloneFillValue(value) });
      }
      if (pastedCells.length > 0) {
        const fileName = pastedCells.find((cell) => cell.col.key === "file.name")?.value;
        rows.push({
          groupDefaults: this.cloneFillValue(groupDefaults) as Record<string, unknown>,
          pastedDefaults,
          pastedCells,
          fileName: typeof fileName === "string" ? fileName : undefined,
        });
      }
    }
    return { rows, skipped };
  }

  private registerPastedOptionValue(col: ColumnDef, value: unknown): unknown {
    const optionPlan = planOptionRegistration(col, value);
    if (!optionPlan.participates) return value;
    if (optionPlan.addedOptions.length > 0) {
      col.statusOptions = optionPlan.options;
      if (optionPlan.clearPresetId) col.statusPresetId = undefined;
    }
    return this.cloneFillValue(optionPlan.value);
  }

  private async pasteCellsWithCreatedRows(
    clipboardText: string,
    matrix: string[][],
    targetPlan: PasteTargetPlan,
    targetChanges: CellEditChange[],
    fileRenames: FileRenameChange[],
    initialSkipped: number,
  ): Promise<void> {
    if (this.creatingPasteRows) return;
    const layout = targetPlan.layout;
    const config = this.getConfig();
    const entry = this.getCurrentEntry();
    if (!layout || !entry) return;
    const prepared = this.preparePasteNewRows(matrix, targetPlan);
    const pastedNewCellCount = prepared.rows.reduce((count, row) => count + row.pastedCells.length, 0);
    const skipped = initialSkipped + prepared.skipped;
    if (targetChanges.length === 0 && pastedNewCellCount === 0 && fileRenames.length === 0) {
      new Notice(skipped > 0 ? t("notice.noEditableCellsSkipped", { skipped }) : t("notice.noEditableCells"));
      return;
    }
    this.creatingPasteRows = true;

    const pendingCut = this.resolvePendingCellCut(clipboardText);
    const combinedChanges = pendingCut
      ? this.mergeCellChanges(pendingCut.clearChanges, targetChanges)
      : this.mergeCellChanges(targetChanges);
    const before = this.cloneDatabaseConfig(entry.config);
    const created: Array<{ file: TFile; plan: CreateEntryPlan; diagnostics: CreateEntryDiagnostic[] }> = [];
    const applied: CellEditChange[] = [];
    let renamed = false;
    let configWriteAttempted = false;
    let remappedChanges: CellEditChange[] = [];

    try {
      for (const change of combinedChanges) {
        const col = config.schema.columns.find((candidate) => this.getFrontmatterWriteKey(candidate) === change.key);
        if (col) change.newValue = this.registerPastedOptionValue(col, change.newValue);
      }
      this.remapRecordPathsInConfig(entry.config, fileRenames, "new");

      const createPlans = prepared.rows.map((row) => {
        const defaults = this.mergeCreateDefaults(config, row.groupDefaults, row.pastedDefaults);
        for (const [key, value] of Object.entries(defaults)) {
          const col = config.schema.columns.find((candidate) => (
            candidate.key === key || this.getFrontmatterWriteKey(candidate) === key
          ));
          if (col) defaults[key] = this.registerPastedOptionValue(col, value);
        }
        const createPlan = this.buildCreateEntryPlan(config, defaults);
        if (row.fileName) createPlan.filename = row.fileName;
        return { createPlan, requestedFileName: row.fileName };
      });

      if (fileRenames.length > 0) {
        await this.executeFileRenamesAtomically(fileRenames, "new");
        renamed = true;
      }
      remappedChanges = this.remapCellChangePaths(combinedChanges, fileRenames, "new");
      const renamePathMap = new Map(fileRenames.map((change) => [change.oldPath, change.newPath]));
      const rowPaths = this.getRenderedTableRowPaths().map((path) => renamePathMap.get(path) || path);
      let afterPath = rowPaths[rowPaths.length - 1];
      for (const { createPlan, requestedFileName } of createPlans) {
        this.suppressDataReload(2500);
        const file = await this.dataSource.createNote(
          createPlan.folder,
          createPlan.filename,
          createPlan.frontmatter,
          { sourceInstanceId: this.instanceId }
        );
        const diagnostics = [...createPlan.diagnostics];
        if ((createPlan.hasExactFilenameRule || requestedFileName) && file.basename !== createPlan.filename) {
          diagnostics.push({ reason: "filenameSuffix", detail: file.basename });
        }
        created.push({ file, plan: createPlan, diagnostics });
        this.assignManualRankForNewEntry(config, file.path, { afterPath }, false);
        afterPath = file.path;
      }

      const after = this.cloneDatabaseConfig(entry.config);
      const configChanged = JSON.stringify(before) !== JSON.stringify(after);
      const dbFile = this.app.vault.getAbstractFileByPath(entry.sourcePath);
      if (configChanged && dbFile instanceof TFile) {
        configWriteAttempted = true;
        this.suppressDataReload(2500);
        await this.dataSource.updateViewDefFile(dbFile, entry.config, this.getCurrentMutationTarget());
      }

      const byPath = new Map<string, CellEditChange[]>();
      for (const change of remappedChanges) {
        const list = byPath.get(change.path) || [];
        list.push(change);
        byPath.set(change.path, list);
      }
      for (const pathChanges of byPath.values()) {
        const file = this.app.vault.getAbstractFileByPath(pathChanges[0].path);
        if (!(file instanceof TFile)) throw new Error(`Paste target no longer exists: ${pathChanges[0].path}`);
        const updates: Record<string, unknown> = {};
        for (const change of pathChanges) updates[change.key] = this.cloneFillValue(change.newValue);
        this.suppressDataReload(2500);
        await this.dataSource.updateFrontmatter(
          file,
          updates,
          { sourceInstanceId: this.instanceId }
        );
        applied.push(...pathChanges);
      }

      const createdFiles = created.map(({ file }) => ({ path: file.path }));
      this.configSnapshots.set(this.getConfigHistoryKey(entry), after);
      this.pushHistory({
        type: "config",
        label: t(pendingCut ? "undo.moveCells" : "undo.pasteCells"),
        dbId: entry.config.id,
        dbPath: entry.sourcePath,
        viewId: config.id,
        before,
        after,
        cellChanges: combinedChanges.length > 0
          ? combinedChanges.map((change) => this.cloneCellChange(change))
          : undefined,
        createdFiles,
        fileRenames: fileRenames.length > 0 ? fileRenames.map((change) => ({ ...change })) : undefined,
      });

      const expiresAt = Date.now() + 8000;
      for (const item of created) {
        this.pendingNewRecords.set(item.file.path, {
          file: item.file,
          frontmatter: { ...item.plan.frontmatter },
          expiresAt,
        });
        if (config.schema.computedFields.length > 0) {
          void this.syncComputedForFile(item.file, item.plan.frontmatter, undefined, config);
        }
      }
      await this.syncComputedForCellChanges(remappedChanges);

      this.remapTransientRecordPaths(fileRenames, "new");
      const rowPathsWithCreated = [
        ...this.getRenderedTableRowPaths().map((path) => renamePathMap.get(path) || path),
        ...created.map(({ file }) => file.path),
      ];
      const colKeys = this.getRenderedTableColumnKeys();
      const endRowPath = created[created.length - 1]?.file.path
        || rowPathsWithCreated[Math.min(rowPathsWithCreated.length - 1, layout.startRow + layout.fillRows - 1)];
      const endColKey = colKeys[layout.startCol + layout.usableCols - 1];
      const startRowPath = rowPathsWithCreated[layout.startRow];
      const startColKey = colKeys[layout.startCol];
      if (startRowPath && startColKey && endRowPath && endColKey) {
        this.cellSelection = {
          anchor: { rowPath: startRowPath, colKey: startColKey },
          focus: { rowPath: endRowPath, colKey: endColKey },
          active: { rowPath: startRowPath, colKey: startColKey },
        };
      }
      await this.refreshAfterSave();
      this.restorePreservedCellSelectionAfterRefresh();
      this.rerenderToolbar();
      this.showBatchPasteNotice(targetChanges.length + fileRenames.length + pastedNewCellCount, skipped, created.length);
      const riskRows = created.filter((item) => item.diagnostics.length > 0).length;
      if (riskRows > 0) new Notice(t("notice.createdRowsRuleRisk", { count: riskRows }));
    } catch (err) {
      if (applied.length > 0) {
        try {
          await this.applyFrontmatterChanges(applied, "old");
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back pasted cell changes", rollbackErr);
        }
      }
      for (const item of [...created].reverse()) {
        try {
          await this.dataSource.trashNote(item.file, { sourceInstanceId: this.instanceId });
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back pasted record creation", rollbackErr);
        }
      }
      this.replaceDatabaseConfig(entry.config, before);
      if (configWriteAttempted) {
        const dbFile = this.app.vault.getAbstractFileByPath(entry.sourcePath);
        if (dbFile instanceof TFile) {
          try {
            await this.dataSource.updateViewDefFile(dbFile, entry.config, this.getCurrentMutationTarget());
          } catch (rollbackErr) {
            console.error("Note Database: failed to roll back paste config", rollbackErr);
          }
        }
      }
      if (renamed) {
        try {
          await this.executeFileRenamesAtomically(fileRenames, "old");
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back pasted file names", rollbackErr);
        }
      }
      this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
      new Notice(t("errors.batchFillFailed", { error: String(err) }));
    } finally {
      this.creatingPasteRows = false;
    }
  }

  private showBatchPasteNotice(count: number, skipped: number, createdRows: number): void {
    const key = skipped > 0
      ? "notice.pastedCellsCreatedRowsSkipped"
      : "notice.pastedCellsCreatedRows";
    new Notice(t(key, { count, skipped, rows: createdRows }));
  }

  private getPasteTargetPlan(matrix: string[][]): PasteTargetPlan {
    const selected = this.getSelectedCellAddresses();
    if (selected.length === 0) return { targets: [], skipped: 0, selection: null, layout: null };
    const rowPaths = this.getRenderedTableRowPaths();
    const colKeys = this.getRenderedTableColumnKeys();
    const layout = planTablePasteLayout(rowPaths, colKeys, selected, matrix);
    if (!layout) return { targets: [], skipped: 0, selection: null, layout: null };
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const colByKey = new Map(this.getConfig().schema.columns.map((col) => [col.key, col]));
    const endRow = Math.min(rowPaths.length - 1, layout.startRow + layout.fillRows - 1);
    const endCol = Math.min(colKeys.length - 1, layout.startCol + layout.fillCols - 1);
    const selection = endRow >= layout.startRow && endCol >= layout.startCol
      ? {
          anchor: { rowPath: rowPaths[layout.startRow], colKey: colKeys[layout.startCol] },
          focus: { rowPath: rowPaths[endRow], colKey: colKeys[endCol] },
          active: { rowPath: rowPaths[layout.startRow], colKey: colKeys[layout.startCol] },
        }
      : null;
    const targets: Array<FillTarget & { value: string }> = [];
    let skipped = 0;
    for (let r = 0; r < layout.existingRows; r++) {
      for (let c = 0; c < layout.usableCols; c++) {
        const row = rowByPath.get(rowPaths[layout.startRow + r]);
        const col = colByKey.get(colKeys[layout.startCol + c]);
        if (!row || !col) continue;
        if (!this.canPasteColumn(col)) {
          skipped += 1;
          continue;
        }
        const value = getTablePasteValue(matrix, r, c);
        targets.push({ row, col, value });
      }
    }
    return { targets, skipped, selection, layout };
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
    const frontmatter = this.dataSource.getFrontmatterSnapshot(row.file);
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

  /** Explicit UI input adopts new option values; mechanical propagation keeps using applyCellChanges. */
  private async applyExplicitOptionCellChanges(
    changes: CellEditChange[],
    label: string,
    options: { preserveCellSelection?: boolean } = {},
  ): Promise<void> {
    const entry = this.getCurrentEntry();
    if (!entry) return;
    const before = this.cloneDatabaseConfig(entry.config);
    let added = false;
    for (const change of changes) {
      const col = entry.config.schema.columns.find((candidate) => this.getFrontmatterWriteKey(candidate) === change.key);
      if (!col) continue;
      const plan = planOptionRegistration(col, change.newValue);
      if (!plan.participates) continue;
      change.newValue = this.cloneFillValue(plan.value);
      if (plan.addedOptions.length === 0) continue;
      col.statusOptions = plan.options;
      if (plan.clearPresetId) col.statusPresetId = undefined;
      added = true;
    }
    if (!added) {
      await this.commitAtomicCellChanges(changes, label, options);
      return;
    }
    await this.commitConfigAndCellChanges(entry, before, changes, label, options);
  }

  private async commitAtomicCellChanges(
    changes: CellEditChange[],
    label: string,
    options: { preserveCellSelection?: boolean } = {},
  ): Promise<void> {
    const effective = changes.filter((change) => change.key !== "file.name" && !isReadonlyFileField(change.key));
    if (effective.length === 0) return;
    const applied: CellEditChange[] = [];
    try {
      const byPath = new Map<string, CellEditChange[]>();
      for (const change of effective) {
        const list = byPath.get(change.path) || [];
        list.push(change);
        byPath.set(change.path, list);
      }
      for (const pathChanges of byPath.values()) {
        const file = this.app.vault.getAbstractFileByPath(pathChanges[0].path);
        if (!(file instanceof TFile)) continue;
        const updates: Record<string, unknown> = {};
        for (const change of pathChanges) updates[change.key] = this.cloneFillValue(change.newValue);
        await this.dataSource.updateFrontmatter(
          file,
          updates,
          { sourceInstanceId: this.instanceId }
        );
        applied.push(...pathChanges);
      }
    } catch (err) {
      if (applied.length) await this.applyFrontmatterChanges(applied, "old");
      throw err;
    }
    if (!applied.length) return;
    this.pushHistory({ type: "cells", label, changes: applied.map((change) => this.cloneCellChange(change)) });
    await this.syncComputedForCellChanges(applied);
    if (!options.preserveCellSelection) this.clearCellSelection();
    await this.refreshAfterSave();
    if (options.preserveCellSelection) this.restorePreservedCellSelectionAfterRefresh();
    this.rerenderToolbar();
  }

  private async syncComputedForCellChanges(changes: CellEditChange[]): Promise<void> {
    const config = this.getConfig();
    if (!config?.schema.computedFields.length) return;
    const affectedFields = changes.map((change) => change.key);
    const updatesByPath = new Map<string, Record<string, unknown>>();
    for (const change of changes) {
      const updates = updatesByPath.get(change.path) || {};
      updates[change.key] = change.newValue;
      updatesByPath.set(change.path, updates);
    }
    for (const [path, updates] of updatesByPath) {
      const row = this.rows.find((candidate) => candidate.file.path === path);
      if (row) await this.syncComputedForFile(row.file, { ...row.frontmatter, ...updates }, affectedFields);
    }
  }

  private async commitConfigAndCellChanges(
    entry: ViewEntry,
    before: DatabaseConfig,
    changes: CellEditChange[],
    label: string,
    options: { preserveCellSelection?: boolean } = {},
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    const applied: CellEditChange[] = [];
    let configSaved = false;
    try {
      if (file instanceof TFile) {
        this.suppressDataReload(2500);
        await this.dataSource.updateViewDefFile(file, entry.config, this.getCurrentMutationTarget());
      }
      configSaved = true;
      const byPath = new Map<string, CellEditChange[]>();
      for (const change of changes) {
        const list = byPath.get(change.path) || [];
        list.push(change);
        byPath.set(change.path, list);
      }
      for (const pathChanges of byPath.values()) {
        const target = this.app.vault.getAbstractFileByPath(pathChanges[0].path);
        if (!(target instanceof TFile)) continue;
        const updates: Record<string, unknown> = {};
        for (const change of pathChanges) updates[change.key] = this.cloneFillValue(change.newValue);
        await this.dataSource.updateFrontmatter(
          target,
          updates,
          { sourceInstanceId: this.instanceId }
        );
        applied.push(...pathChanges);
      }
    } catch (err) {
      if (applied.length > 0) await this.applyFrontmatterChanges(applied, "old");
      this.replaceDatabaseConfig(entry.config, before);
      if (configSaved && file instanceof TFile) {
        this.suppressDataReload(2500);
        await this.dataSource.updateViewDefFile(file, entry.config, this.getCurrentMutationTarget());
      }
      this.configSnapshots.set(this.getConfigHistoryKey(entry), this.cloneDatabaseConfig(entry.config));
      throw err;
    }
    const after = this.cloneDatabaseConfig(entry.config);
    this.configSnapshots.set(this.getConfigHistoryKey(entry), after);
    this.pushHistory({
      type: "config",
      label,
      dbId: entry.config.id,
      dbPath: entry.sourcePath,
      viewId: this.getConfig()?.id,
      before,
      after,
      cellChanges: changes.map((change) => this.cloneCellChange(change)),
    });
    await this.syncComputedForCellChanges(changes);
    if (!options.preserveCellSelection) this.clearCellSelection();
    await this.refreshAfterSave();
    if (options.preserveCellSelection) this.restorePreservedCellSelectionAfterRefresh();
    this.rerenderToolbar();
  }

  private async applyCellChanges(
    changes: CellEditChange[],
    label: string,
    options: { preserveCellSelection?: boolean } = {}
  ): Promise<void> {
    const effectiveChanges = changes.filter((change) => change.key !== "file.name" && !isReadonlyFileField(change.key));
    if (effectiveChanges.length === 0) return;
    this.suppressDataReload(1200);
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
        await this.dataSource.updateFrontmatter(
          entry.file,
          entry.updates,
          { sourceInstanceId: this.instanceId }
        );
      } catch (err) {
        if (appliedChanges.length > 0) {
          this.pushHistory({ type: "cells", label, changes: appliedChanges });
          if (!options.preserveCellSelection) this.clearCellSelection();
          await this.refreshAfterSave();
          if (options.preserveCellSelection) this.restorePreservedCellSelectionAfterRefresh();
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
    if (!options.preserveCellSelection) this.clearCellSelection();
    await this.refreshAfterSave();
    if (options.preserveCellSelection) this.restorePreservedCellSelectionAfterRefresh();
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
    if (!this.applyingHistory) {
      this.redoStack = [];
      this.cancelPendingCellCut();
    }
    this.updateUndoAction();
  }

  async undoLastEdit(): Promise<void> {
    await this.replayHistory("undo");
  }

  async redoLastEdit(): Promise<void> {
    await this.replayHistory("redo");
  }

  private async replayHistory(direction: "undo" | "redo"): Promise<void> {
    const source = direction === "undo" ? this.historyStack : this.redoStack;
    const destination = direction === "undo" ? this.redoStack : this.historyStack;
    const entry = source[0];
    if (!entry) {
      new Notice(t(direction === "undo" ? "notice.nothingToUndo" : "notice.nothingToRedo"));
      this.updateUndoAction();
      return;
    }
    this.applyingHistory = true;
    try {
      await this.applyHistoryEntry(entry, direction);
      source.shift();
      destination.unshift(entry);
      if (destination.length > 15) destination.length = 15;
      new Notice(t(direction === "undo" ? "notice.undone" : "notice.redone", { action: entry.label }));
    } catch (err) {
      console.error(`Note Database: failed to ${direction} edit`, err);
      new Notice(t("errors.updateFailed", { error: String(err) }));
    } finally {
      this.applyingHistory = false;
      this.updateUndoAction();
    }
  }

  private async applyHistoryEntry(entry: HistoryEntry, direction: "undo" | "redo"): Promise<void> {
    if (entry.type === "config") {
      await this.applyConfigHistoryEntry(entry, direction);
      // Config replay replaces view objects; close popovers holding detached references.
      this.containerEl_?.querySelectorAll(".db-cell-option-popover").forEach((el) => el.remove());
      return;
    }
    if (entry.type === "created") {
      await this.applyCreatedHistoryEntry(entry, direction);
      return;
    }
    await this.applyCellHistoryEntry(entry, direction);
  }

  private async applyCellHistoryEntry(entry: CellHistoryEntry, direction: "undo" | "redo"): Promise<void> {
    if (direction === "redo") {
      for (const created of entry.createdFiles || []) {
        if (created.content == null) {
          throw new Error(`Cannot redo create because no file snapshot is available: ${created.path}`);
        }
        if (this.app.vault.getAbstractFileByPath(created.path)) {
          throw new Error(`Cannot redo create because the path already exists: ${created.path}`);
        }
      }
      for (const created of entry.createdFiles || []) await this.restoreCreatedFile(created);
    }
    const valueDirection = direction === "undo" ? "old" : "new";
    if (entry.changes.length > 0) {
      await this.applyFrontmatterChanges(entry.changes, valueDirection);
      await this.syncComputedForCellChanges(this.getDirectedHistoryChanges(entry.changes, direction));
    }
    if (direction === "undo") {
      for (const created of entry.createdFiles || []) await this.removeCreatedFile(created);
    }
    await this.refreshAfterSave();
    if (this.cellSelection) this.restorePreservedCellSelectionAfterRefresh();
    this.rerenderToolbar();
  }

  private getDirectedHistoryChanges(
    changes: CellEditChange[],
    direction: "undo" | "redo",
  ): CellEditChange[] {
    if (direction === "redo") return changes.map((change) => this.cloneCellChange(change));
    return changes.map((change) => ({
      ...this.cloneCellChange(change),
      newValue: change.oldExists ? this.cloneFillValue(change.oldValue) : null,
    }));
  }

  private async applyCreatedHistoryEntry(entry: CreatedHistoryEntry, direction: "undo" | "redo"): Promise<void> {
    if (direction === "undo") await this.removeCreatedFile(entry.file);
    else await this.restoreCreatedFile(entry.file);
    await this.refreshAfterSave();
    this.rerenderToolbar();
  }

  private async removeCreatedFile(snapshot: CreatedFileSnapshot): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(snapshot.path);
    if (!(file instanceof TFile)) return;
    snapshot.content = await this.app.vault.cachedRead(file);
    await this.dataSource.trashNote(file, { sourceInstanceId: this.instanceId });
    this.pendingNewRecords.delete(snapshot.path);
    if (this.pendingNewFilePath === snapshot.path) this.clearPendingNewRow();
  }

  private async restoreCreatedFile(snapshot: CreatedFileSnapshot): Promise<void> {
    if (this.app.vault.getAbstractFileByPath(snapshot.path)) {
      throw new Error(`Cannot redo create because the path already exists: ${snapshot.path}`);
    }
    if (snapshot.content == null) {
      throw new Error(`Cannot redo create because no file snapshot is available: ${snapshot.path}`);
    }
    this.dataSource.markPluginWrite(snapshot.path, this.instanceId);
    await this.app.vault.create(snapshot.path, snapshot.content);
  }

  private async applyConfigHistoryEntry(entry: ConfigHistoryEntry, direction: "undo" | "redo"): Promise<void> {
    const index = this.viewEntries.findIndex((candidate) => candidate.sourcePath === entry.dbPath);
    if (index < 0) throw new Error(`Cannot replay history because the database is unavailable: ${entry.dbPath || entry.dbId}`);
    if (direction === "redo") {
      const movingSourceKeys = new Set((entry.fileRenames || []).map((change) => (
        change.oldPath.normalize("NFC").toLowerCase()
      )));
      for (const created of entry.createdFiles || []) {
        if (created.content == null) {
          throw new Error(`Cannot redo create because no file snapshot is available: ${created.path}`);
        }
        if (
          this.app.vault.getAbstractFileByPath(created.path) &&
          !movingSourceKeys.has(created.path.normalize("NFC").toLowerCase())
        ) {
          throw new Error(`Cannot redo create because the path already exists: ${created.path}`);
        }
      }
    }
    const target = this.viewEntries[index];
    const previous = this.cloneDatabaseConfig(target.config);
    const renameDirection = direction === "undo" ? "old" : "new";
    const valueDirection = direction === "undo" ? "old" : "new";
    const removedCreated: CreatedFileSnapshot[] = [];
    const restoredCreated: CreatedFileSnapshot[] = [];
    let historyChanges: CellEditChange[] = [];
    let cellValuesApplied = false;
    let renamed = false;
    try {
      // Undo must remove newly-created files first: a created path may intentionally reuse a
      // source path that the rename transaction freed (A.md -> B.md, then create A.md).
      if (direction === "undo") {
        for (const created of entry.createdFiles || []) {
          const file = this.app.vault.getAbstractFileByPath(created.path);
          if (!(file instanceof TFile)) continue;
          await this.removeCreatedFile(created);
          removedCreated.push(created);
        }
      }
      if (entry.fileRenames?.length) {
        await this.executeFileRenamesAtomically(entry.fileRenames, renameDirection);
        this.remapTransientRecordPaths(entry.fileRenames, renameDirection);
        renamed = true;
      }
      this.replaceDatabaseConfig(target.config, direction === "undo" ? entry.before : entry.after);
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
        historyChanges = entry.fileRenames?.length
          ? this.remapCellChangePaths(entry.cellChanges, entry.fileRenames, renameDirection)
          : entry.cellChanges.map((change) => this.cloneCellChange(change));
        await this.applyFrontmatterChangesAtomically(historyChanges, valueDirection);
        cellValuesApplied = true;
        await this.syncComputedForCellChanges(this.getDirectedHistoryChanges(historyChanges, direction));
      }
      if (direction === "redo") {
        for (const created of entry.createdFiles || []) {
          await this.restoreCreatedFile(created);
          restoredCreated.push(created);
        }
      }
      this.toolbarRenderer.closePopovers();
      this.chartToolbarRenderer.closePopover();
      this.calendarToolbarRenderer.closePopover();
      await this.refreshAfterSave();
      if (this.cellSelection) this.restorePreservedCellSelectionAfterRefresh();
      this.rerenderToolbar();
      this.renderViewConfigPanel();
    } catch (err) {
      if (direction === "redo") {
        for (const created of [...restoredCreated].reverse()) {
          try {
            await this.removeCreatedFile(created);
          } catch (rollbackErr) {
            console.error("Note Database: failed to remove restored file after history replay failure", rollbackErr);
          }
        }
      }
      if (cellValuesApplied) {
        try {
          await this.applyFrontmatterChangesAtomically(historyChanges, valueDirection === "new" ? "old" : "new");
        } catch (rollbackErr) {
          console.error("Note Database: failed to restore cell values after history replay failure", rollbackErr);
        }
      }
      this.replaceDatabaseConfig(target.config, previous);
      this.configSnapshots.set(this.getConfigHistoryKey(target), this.cloneDatabaseConfig(target.config));
      const file = this.app.vault.getAbstractFileByPath(target.sourcePath);
      if (file instanceof TFile) {
        try {
          this.suppressDataReload(2500);
          await this.dataSource.updateViewDefFile(file, target.config, this.getCurrentDatabaseMutationTarget());
        } catch (rollbackErr) {
          console.error("Note Database: failed to restore config after history replay failure", rollbackErr);
        }
      }
      if (renamed && entry.fileRenames?.length) {
        const rollbackDirection = renameDirection === "new" ? "old" : "new";
        try {
          await this.executeFileRenamesAtomically(entry.fileRenames, rollbackDirection);
          this.remapTransientRecordPaths(entry.fileRenames, rollbackDirection);
        } catch (rollbackErr) {
          console.error("Note Database: failed to roll back history file rename", rollbackErr);
        }
      }
      if (direction === "undo") {
        for (const created of removedCreated) {
          try {
            await this.restoreCreatedFile(created);
          } catch (rollbackErr) {
            console.error("Note Database: failed to restore removed file after history replay failure", rollbackErr);
          }
        }
      }
      throw err;
    }
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
    const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], config.schema.columns.find((c) => c.key === field), config));
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
      const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], config.schema.columns.find((c) => c.key === field), config));
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
      const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], config.schema.columns.find((c) => c.key === field), config));
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
    const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], config.schema.columns.find((c) => c.key === field), config));
    const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
    const groupMap = new Map(groups.map((group) => [group.key, group]));
    const col = config.schema.columns.find((candidate) => candidate.key === field);
    const defaultKeys = getDefaultGroupOrder(config, field);
    if (col && defaultKeys.length > 0 && col.type === "checkbox") {
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
    const subgroupField = config.boardSubgroupEnabled !== false ? config.boardSubgroupField : undefined;
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
      onConfigChange: (label) => {
        this.pendingUndoLabel = label || t("undo.chartConfig");
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
    this.pendingUndoLabel = t("undo.chartDrilldownFilterConfig");
    this.viewStateStore.persist(config, state);
    this.scheduleConfigSave();
    this.rerenderToolbar();
    this.refresh();
  }

  private getBoardSubgroups(config: ViewConfig, field: string, rows: RowData[]): BoardGroup["subgroups"] {
    const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(rows, field, [], config.schema.columns.find((c) => c.key === field), config));
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
    // 只追加缺失 record 的 rank（保留现有），不 generateRanks 重新生成——覆盖会破坏 setManualRank 的改动，
    // 导致拖拽重排后内存 ranks 被重置、视图不刷新（见 ensureVisibleRowsHaveManualRanks 同类修复）。
    this.appendMissingRanks(ranks, paths.filter((path) => ranks[path] == null));
    return true;
  }

  private ensureVisibleRowsHaveManualRanks(config: ViewConfig): void {
    const ranks = config.manualOrder?.ranks;
    if (!ranks) return;
    const missing = this.rows.filter((row) => ranks[row.file.path] == null);
    if (missing.length === 0) return;
    // 只追加缺失 record 的 rank（保留现有 rank 值），不重新生成——否则会覆盖 setManualRank 刚改的 rank，
    // 导致拖拽重排后视图不刷新（rank 存了但内存被 generateRanks 重置，切换视图重新加载才正确）。
    this.appendMissingRanks(ranks, missing.map((row) => row.file.path));
  }

  /** 把缺失的 path 追加到现有最大 rank 之后（用 rankBetween 递增），保留现有 rank 值不被覆盖。 */
  private appendMissingRanks(ranks: Record<string, string>, missingPaths: string[]): void {
    const sorted = Object.entries(ranks).sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
    let lastRank = sorted[sorted.length - 1]?.[1];
    for (const path of missingPaths) {
      if (ranks[path] != null) continue;
      const nextRank = lastRank ? rankBetween(lastRank, undefined) : rankBetween(undefined, undefined);
      if (!nextRank) continue;
      ranks[path] = nextRank;
      lastRank = nextRank;
    }
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

  private expandGroup(config: ViewConfig | undefined, field: string, key: string, count: number): void {
    if (!config) return;
    setGroupExpandedCount(config, field, key, count);
    this.pendingUndoLabel = t("undo.groupCollapseConfig");
    this.scheduleConfigSave();
    this.refresh();
  }

  private setGroupRowLimit(limit: number): void {
    const config = this.getConfig();
    if (!config) return;
    config.groupRowLimit = limit > 0 ? limit : undefined;
    config.expandedGroupRows = undefined; // changing the limit resets all per-group expansions
    this.pendingUndoLabel = t("undo.groupConfig");
    this.scheduleConfigSave();
    this.refresh({ viewport: "reset-top" });
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
      const config = this.getConfig();
      const entry = this.getCurrentEntry();
      const col = config?.schema.columns.find((candidate) => candidate.key === field);
      if (!entry || !col) return;
      const before = this.cloneDatabaseConfig(entry.config);
      const rows = this.getRowsForGroupMove(row);
      const changes: CellEditChange[] = [];
      for (const targetRow of rows) {
        const nextValue = this.getMovedGroupValue(targetRow, field, col, fromValue, value);
        changes.push(this.createCurrentCellChange(targetRow, col, nextValue));
      }
      const registration = isEmptyGroupId(value) ? undefined : planOptionRegistration(col, value);
      if (registration?.addedOptions.length) {
        col.statusOptions = registration.options;
        if (registration.clearPresetId) col.statusPresetId = undefined;
        await this.commitConfigAndCellChanges(entry, before, changes, t("undo.editCell"));
      } else {
        await this.applyCellChanges(changes, t("undo.editCell"));
      }
    } catch (err) {
      new Notice(t("errors.updateFailed", { error: String(err) }));
    }
  }

  private async createBoardGroup(field: string, name: string, color: StatusColor): Promise<boolean> {
    const config = this.getConfig();
    const entry = this.getCurrentEntry();
    const column = config?.schema.columns.find((candidate) => candidate.key === field);
    if (!config || !entry || !column || column.type === "computed" || column.type === "rollup") return false;
    const displayType = getColumnDisplayType(column, config.schema.computedFields);
    if (displayType !== "status" && displayType !== "select" && displayType !== "multi-select") return false;
    const registration = planOptionRegistration(column, name);
    if (registration.addedOptions.length === 0) {
      new Notice(t("board.groupExists", { name: name.trim() }));
      return false;
    }
    registration.addedOptions[0].color = color;
    const before = this.cloneDatabaseConfig(entry.config);
    column.statusOptions = registration.options;
    if (registration.clearPresetId) column.statusPresetId = undefined;
    // “新建分组”必须立即产生一个可见的空列，即使用户此前关闭过空分组显示。
    setShowEmptyGroups(config, field, true);
    try {
      await this.commitConfigAndCellChanges(entry, before, [], t("undo.groupConfig"));
      return true;
    } catch (error) {
      new Notice(t("errors.updateFailed", { error: String(error) }));
      return false;
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
    const entry = this.getCurrentEntry();
    if (!config || !entry) return;
    const before = this.cloneDatabaseConfig(entry.config);
    try {
      this.setManualRank(config, row.file.path, beforePath, afterPath);

      const rows = this.getRowsForGroupMove(row);
      const cellChanges: CellEditChange[] = [];
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
        // 在写回前捕获分组字段改动，使「撤销卡片顺序」能完整回退分组移动（不只回退 rank）。
        for (const field of Object.keys(frontmatterUpdates)) {
          const col = config.schema.columns.find((candidate) => candidate.key === field);
          if (col) cellChanges.push(this.createCurrentCellChange(targetRow, col, frontmatterUpdates[field]));
        }
      }
      for (const update of updates) {
        const col = config.schema.columns.find((candidate) => candidate.key === update.field);
        if (!col || isEmptyGroupId(update.toGroupKey)) continue;
        const plan = planOptionRegistration(col, update.toGroupKey);
        if (plan.addedOptions.length === 0) continue;
        col.statusOptions = plan.options;
        if (plan.clearPresetId) col.statusPresetId = undefined;
      }
      await this.commitConfigAndCellChanges(entry, before, cellChanges, t("undo.cardOrderConfig"));
    } catch (err) {
      this.replaceDatabaseConfig(entry.config, before);
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

  private showMobileColumnWidthPanel(col: ColumnDef): void {
    const config = this.getConfig();
    const root = this.containerEl_;
    if (!config || !root) return;
    this.closeMobileColumnWidthPanel();

    const doc = root.ownerDocument;
    const backdrop = doc.body.createDiv({ cls: "db-mobile-column-width-backdrop" });
    const panel = doc.body.createDiv({ cls: "db-mobile-column-width-panel" });
    const title = panel.createDiv({
      cls: "db-mobile-column-width-title",
      text: t("columnWidth.adjustTitle", { name: col.label || col.key }),
    });
    title.setAttr("aria-live", "polite");

    const valueRow = panel.createDiv({ cls: "db-mobile-column-width-value-row" });
    const slider = valueRow.createEl("input", {
      cls: "db-mobile-column-width-slider",
      attr: {
        type: "range",
        min: String(MOBILE_COLUMN_WIDTH_MIN),
        max: String(MOBILE_COLUMN_WIDTH_MAX),
        step: "1",
        "aria-label": t("menu.adjustColumnWidth"),
      },
    });
    const valueEl = valueRow.createSpan({ cls: "db-mobile-column-width-value" });

    const presets = panel.createDiv({ cls: "db-mobile-column-width-presets" });
    const autoButton = presets.createEl("button", {
      cls: "db-mobile-column-width-preset",
      text: t("columnWidth.auto"),
      attr: { type: "button" },
    });
    for (const preset of MOBILE_COLUMN_WIDTH_PRESETS) {
      const button = presets.createEl("button", {
        cls: "db-mobile-column-width-preset",
        text: t(`columnWidth.${preset.key}`),
        attr: { type: "button" },
      });
      button.onclick = () => {
        applyWidth(preset.width);
        persist();
      };
    }

    let dirty = false;
    const setSliderValue = (width: number) => {
      const max = Math.max(MOBILE_COLUMN_WIDTH_MAX, Math.ceil(width));
      slider.max = String(max);
      slider.value = String(clampColumnWidth(width, MOBILE_COLUMN_WIDTH_MIN, max));
      valueEl.setText(String(Math.round(width)));
    };
    const applyWidth = (width: number) => {
      if (!Number.isFinite(width)) return;
      const nextWidth = Math.round(Math.max(MOBILE_COLUMN_WIDTH_MIN, width));
      config.columnWidths = { ...(config.columnWidths || {}), [col.key]: nextWidth };
      dirty = true;
      setSliderValue(nextWidth);
      syncTableColumnLayouts(root, config);
    };
    const persist = () => {
      if (!dirty) return;
      this.pendingUndoLabel = t("undo.columnWidthConfig");
      this.scheduleConfigSave();
      dirty = false;
    };
    const close = () => {
      persist();
      cleanup();
    };
    const cleanup = () => {
      backdrop.remove();
      panel.remove();
      doc.removeEventListener("keydown", onKeydown, true);
      if (this.mobileColumnWidthPanelCleanup === close) {
        this.mobileColumnWidthPanelCleanup = undefined;
      }
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };

    slider.oninput = () => applyWidth(Number(slider.value));
    slider.onchange = () => persist();
    autoButton.onclick = () => {
      applyWidth(this.calculateAutoColumnWidth(col, this.rows));
      persist();
    };
    backdrop.onclick = () => close();
    doc.addEventListener("keydown", onKeydown, true);
    this.mobileColumnWidthPanelCleanup = close;
    setSliderValue(config.columnWidths?.[col.key] || col.width || config.defaultColumnWidth || 150);
  }

  private closeMobileColumnWidthPanel(): void {
    this.mobileColumnWidthPanelCleanup?.();
    this.mobileColumnWidthPanelCleanup = undefined;
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
    return estimateAutoColumnWidth(
      col,
      rows,
      (row, column) => this.getColumnDisplayText(row, column),
      createRenderedTextWidthMeasurer,
    );
  }

  private getColumnDisplayText(row: RowData, col: ColumnDef): string {
    if (col.key === "file.name") return this.getFileDisplayName(row);
    const value = isBaseFileField(col.key)
      ? getRowFileFieldValue(row, col.key)
      : col.type === "computed" || col.type === "rollup"
        ? row.computed[col.type === "computed" ? col.computedKey || col.key : col.key]
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
      await this.dataSource.updateFrontmatter(
        file,
        updates,
        { sourceInstanceId: this.instanceId }
      );
    }
  }

  private scheduleComputedSync(
    config: ViewConfig,
    rows: RowData[],
    syncScope: ComputedSyncScope = "database"
  ): void {
    if (config.schema.computedFields.length === 0 || !this.isAutomaticComputedSync()) {
      if (this.computedSyncTimer !== null) this.getRefreshWindow().clearTimeout(this.computedSyncTimer);
      this.computedSyncTimer = null;
      this.pendingComputedSync.clear();
      return;
    }
    // A deleted/non-matching changed path may produce no incremental rows.
    // It must not postpone useful work already waiting in the queue.
    if (syncScope === "rows" && rows.length === 0) return;
    if (this.computedSyncTimer !== null) this.getRefreshWindow().clearTimeout(this.computedSyncTimer);
    this.computedSyncTimer = null;
    this.pendingComputedSync.merge(rows, syncScope);
    const entry = this.getCurrentEntry();
    const syncConfig = JSON.parse(JSON.stringify(config)) as ViewConfig;
    const recordConfig = entry
      ? this.cloneDatabaseConfig(this.getEffectiveConfig(entry.config, config))
      : undefined;
    const sourcePath = entry?.sourcePath;
    this.computedSyncTimer = this.getRefreshWindow().setTimeout(() => {
      this.computedSyncTimer = null;
      if (sourcePath && this.getCurrentEntry()?.sourcePath !== sourcePath) {
        this.pendingComputedSync.clear();
        return;
      }
      const pending = this.pendingComputedSync.drain();
      if (this.syncingComputed) {
        this.scheduleComputedSync(syncConfig, pending.rows, pending.scope);
        return;
      }
      void this.syncComputedFieldsNow(false, syncConfig, recordConfig, pending.rows, false, pending.scope).catch((err) => {
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
    force = false,
    syncScope: ComputedSyncScope = "database"
  ): Promise<void> {
    if (!config || this.syncingComputed) return;
    const activeDb = recordConfig || this.getCurrentEntry()?.config;
    if (!force && !this.isAutomaticComputedSync(activeDb)) return;
    this.syncingComputed = true;
    try {
      const computedColumns = config.schema.columns.filter((col) => col.type === "computed");
      const db = activeDb;
      const scopedRecords = fallbackRows.map((row) => ({
        file: row.file,
        frontmatter: row.frontmatter,
      }));
      const records = syncScope === "rows"
        ? scopedRecords
        : db
          ? this.dataSource.getRecordsForDatabase(recordConfig || this.getEffectiveConfig(db, config))
          : scopedRecords;
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
          await this.dataSource.updateFrontmatter(
            record.file,
            updates,
            { sourceInstanceId: this.instanceId }
          );
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

  private openRecordDetailPanel(anchorEl: HTMLElement, row: RowData): void {
    if (!this.containerEl_) return;
    const config = this.getConfig();
    if (!config) return;
    const columns = getVisibleColumns(config, this.rows, this.vs(), this.pendingShowColumns);
    openRecordDetailPanel({
      anchorEl,
      host: this.containerEl_,
      row,
      columns,
      config,
      app: this.app,
      actions: {
        editCell: (target, r, col, event) => this.cellRenderer.startEdit(target, r, col, event),
        editFileName: (target, r, currentName) => this.cellRenderer.editFileName(target, r, currentName),
        showColumnMenu: (event, col, anchorEl) => this.showContextMenu(event, col, anchorEl, { includeWidthActions: false }),
        openRow: (r) => this.dataSource.openNote(r.file),
        renderRecordIcon: (parent, r, view, compact) => this.renderRowRecordIcon(parent, r, view, compact),
        applyConditionalFormat: (element, r, view, targetField) =>
          applyConditionalFormat(element, r, view, this.getActiveDb(), targetField),
        isReadOnly: false,
      },
    });
  }

  refresh(options: { viewport?: DatabaseViewportRequest } = {}): void {
    if (!this.containerEl_) return;
    const nextViewType = this.hasActiveDatabase() ? (this.getConfig()?.viewType || "table") : "table";
    const viewportMode = resolveDatabaseViewportMode(this.lastRenderedViewType, nextViewType, options.viewport);
    const viewport = viewportMode === "preserve-anchor" ? captureDatabaseViewport(this.containerEl_) : undefined;
    const rawViewport = viewportMode === "preserve-raw"
      ? { top: this.containerEl_.scrollTop, left: this.containerEl_.scrollLeft }
      : undefined;
    // Remove only top-level rendered results; panels manage their own contents.
    // All view types use the same cleanup selector so that render() always
    // rebuilds elements in a fixed order (summary → chart/table/…).
    this.containerEl_.querySelectorAll(
      ":scope > .db-table, :scope > .db-table-wrap, :scope > .db-grouped-table, :scope > .db-board, :scope > .db-gallery, :scope > .db-gallery-grouped, :scope > .db-gallery-total-header, :scope > .db-list, :scope > .db-list-grouped, :scope > .db-list-total-header, :scope > .db-chart, :scope > .db-chart-empty, :scope > .db-chart-number, :scope > .db-calendar, :scope > .db-timeline, :scope > .db-summary, :scope > .db-selection-status-bar, :scope > .db-empty"
    )
      .forEach(el => el.remove());
    this.render();
    if (viewport && this.containerEl_) restoreDatabaseViewport(this.containerEl_, viewport);
    if (rawViewport && this.containerEl_) {
      this.containerEl_.scrollTop = rawViewport.top;
      this.containerEl_.scrollLeft = rawViewport.left;
    }
    if (viewportMode === "reset-top" && this.containerEl_) {
      this.containerEl_.scrollTop = 0;
      this.containerEl_.scrollLeft = 0;
    }
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
    const searchQuery = this.vs().searchText;
    if (searchQuery) highlightSearchMatches(this.containerEl_, searchQuery);
    // 视图 re-render 后刷新常驻面板：同记录则局部刷新字段（编辑后常驻），否则关闭（记录被筛掉/切库）
    const openDetailPath = getOpenRecordDetailPath();
    if (openDetailPath) {
      const newRow = this.rows.find((r) => r.file.path === openDetailPath);
      if (newRow) refreshRecordDetailPanel(newRow);
      else closeRecordDetailPanel();
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
