import { App, MarkdownRenderChild, MarkdownSectionInformation, Menu, normalizePath, Notice, setIcon, setTooltip, TFile } from "obsidian";
import { t } from "../i18n";
import { DataChangeBatch, DataSource, NoteRecord, ViewConfigMutation } from "../data/DataSource";
import { RefreshCoordinator } from "../data/RefreshCoordinator";
import { isRefreshBlockedByDrag } from "../data/RefreshBlockers";
import { ensureColumnOrder, getColumnsInOrder, getVisibleColumns } from "../data/ColumnConfig";
import { QueryEngine } from "../data/QueryEngine";
import { RowPipeline } from "../data/RowPipeline";
import { buildRelationRollups } from "../data/RelationRollup";
import { ColumnDef, DatabaseConfig, FilterRule, GroupOrderMode, RowData, ViewConfig, generateId, NumberDisplayStyle } from "../data/types";
import { ComputedFieldEngine } from "../data/ComputedField";
import { setDateDisplayMode } from "../data/DateTimeFormat";
import { evaluateComputedFields } from "../data/ComputedEvaluator";
import {
  isObsidianTagsKey,
  normalizeObsidianTagValue,
  toBooleanValue,
  toMultiSelectValuesForKey,
} from "../data/ColumnTypes";
import { getDefaultGroupOrder, getEffectiveGroupOrder, mergeGroupOrder } from "../data/GroupOrder";
import { formatGroupKeyDisplay } from "../data/GroupDisplay";
import { setShowEmptyGroups, setGroupExpandedCount, withEmptyOptionGroups } from "../data/GroupVisibility";
import { getEffectiveFilterRules } from "../data/FilterRules";
import { CellAddress, serializeSelectedCells, getCellDisplayText } from "../data/ClipboardSerializer";
import { createCsvMarkdownZip } from "../data/CsvMarkdownZipExport";
import { generateRanks, rankBetween, rebalanceRanks } from "../data/ManualOrder";
import { safeString } from "../data/SafeString";
import { CsvMarkdownExportModal } from "./modals/CsvMarkdownExportModal";
import { BoardGroup, BoardRenderer } from "./BoardRenderer";
import { CellRenderer } from "./CellRenderer";
import { ColumnHeaderController } from "./ColumnHeaderController";
import { ColumnManagerRenderer } from "./ColumnManagerRenderer";
import { DatabaseViewState, ViewStateStore } from "./ViewStateStore";
import { FilterPanelRenderer } from "./FilterPanelRenderer";
import { RowMenu } from "./RowMenu";
import { resolveRecordIconField } from "../data/RecordIcon";
import { renderRecordIcon } from "./RecordIconRenderer";
import { SortPanelRenderer } from "./SortPanelRenderer";
import { SummaryRenderer } from "./SummaryRenderer";
import { applyConditionalFormat } from "../data/ConditionalFormatting";
import { GalleryRenderer } from "./GalleryRenderer";
import { ListRenderer } from "./ListRenderer";
import { ChartRenderer } from "./ChartRenderer";
import { CalendarToolbarRenderer } from "./CalendarToolbarRenderer";
import { ChartToolbarRenderer } from "./ChartToolbarRenderer";
import { getDefaultChartDateBucket, getDefaultChartField, getDefaultChartNumberBucket } from "../data/ChartAggregation";
import { getDefaultEventDateField, getTimelineDayNonDateTimeColumns } from "../data/CalendarTimelineModel";
import {
  buildCalendarTimelineSearchResults,
  CalendarTimelineSearchResultItem,
  CalendarTimelineSearchResults,
  formatCalendarTimelineSearchResultDate,
} from "../data/CalendarTimelineSearchResults";
import { InvalidTimelineEventsScanner } from "../data/InvalidTimeEvents";
import { CalendarRenderer } from "./CalendarRenderer";
import {
  closeRecordDetailPanel,
  getOpenRecordDetailPath,
  openRecordDetailPanel,
  refreshRecordDetailPanel,
} from "./RecordDetailPanel";
import { CalendarTimelineRenderer } from "./CalendarTimelineRenderer";
import { FileTitleDisplay, getFileTitleDisplay } from "./FileTitleDisplay";
import { TableRenderer } from "./TableRenderer";
import { isHTMLElement } from "./DomGuards";
import { ToolbarRenderer } from "./ToolbarRenderer";
import { ViewConfigPanelRenderer } from "./ViewConfigPanelRenderer";
import { DATABASE_VIEW_TYPE, DatabaseView } from "./DatabaseView";

import { installPopoverAutoClose } from "./PopoverAutoClose";
import { estimateAutoColumnWidth } from "./ColumnWidth";
import { createRenderedTextWidthMeasurer } from "./InlineMarkdownRenderer";
import { positionToolbarPopover } from "./PopoverPosition";
import { captureEmbeddedHostViewport, DatabaseViewportRequest, EmbeddedHostViewportSnapshot, restoreEmbeddedHostViewport } from "./DatabaseViewport";
import { highlightSearchMatches, renderSearchHighlightedText } from "./SearchHighlight";
import { normalizeComputedSyncMode } from "../data/ComputedSync";
import { getComputedStorageKey, isNumberDisplayColumn } from "../data/ColumnDisplay";
import { getRequiredSourceRules, getSourceRuleTree, getSourceRuleTypedValue, mergeDbAndViewSourceRuleTrees } from "../data/SourceRules";
import { getRowFileFieldValue, isFileFieldKey } from "../data/FileFields";
import { applyRangeSelection } from "../data/RangeSelection";

type HeaderPopoverKind = "filter" | "sort" | "columns" | "view";

function filtersEqual(left: FilterRule, right: FilterRule): boolean {
  return left.field === right.field && left.op === right.op && (left.value || "") === (right.value || "");
}

export interface EmbeddedDatabaseEntry {
  config: DatabaseConfig;
  sourcePath: string;
}

interface EmbeddedReference {
  dbId?: string;
  dbPath?: string;
  viewId?: string;
}

export class EmbeddedDatabaseRenderer extends MarkdownRenderChild {
  private queryEngine = new QueryEngine();
  private rowPipeline = new RowPipeline();
  private rows: RowData[] = [];
  private relationTargetPaths = new Set<string>();
  private relationTargetDatabases: DatabaseConfig[] = [];
  private relationTargetDatabasePaths = new Set<string>();
  private timelineInvalidRowsVersion = 0;
  private timelineInvalidEventsScanner = new InvalidTimelineEventsScanner();
  private calendarTimelineSearchResultsEl: HTMLElement | null = null;
  private pendingSearchResultRevealPath?: string;
  private stateStore = new ViewStateStore();
  private state?: DatabaseViewState;
  private pendingShowColumns = new Set<string>();
  private rowMenu: RowMenu;
  private cellRenderer: CellRenderer;
  private columnHeaderController: ColumnHeaderController;
  private tableRenderer: TableRenderer;
  private boardRenderer: BoardRenderer;
  private galleryRenderer: GalleryRenderer;
  private listRenderer: ListRenderer;
  private chartRenderer = new ChartRenderer();
  private calendarToolbarRenderer = new CalendarToolbarRenderer();
  private chartToolbarRenderer = new ChartToolbarRenderer();
  private calendarRenderer = new CalendarRenderer({
    openRow: (row) => this.dataSource.openNote(row.file),
    openRecordDetail: (anchorEl, row) => this.openRecordDetailPanel(anchorEl, row),
    isReadOnly: true,
    updateCalendarScale: (scale, anchorDateKey) => this.updateCalendarScale(scale, anchorDateKey),
    onConfigChange: () => {
      if (!this.config) return;
      this.persistEmbeddedConfigLocally(this.config);
      this.renderResults(this.config);
      this.saveEmbeddedConfigInBackground();
    },
    getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns),
    getCalendarInvalidEventCount: () => this.getEmbeddedInvalidEventCount(),
    openCalendarInvalidEvents: () => this.openEmbeddedInvalidEvents(),
    renderRecordIcon: (parent, row, config, compact) => this.renderEmbeddedRecordIcon(parent, row, config, compact),
    applyConditionalFormat: (element, row, config) => applyConditionalFormat(element, row, config, this.currentDbConfig),
  });
  private calendarTimelineRenderer = new CalendarTimelineRenderer({
    openRow: (row) => this.dataSource.openNote(row.file),
    openRecordDetail: (anchorEl, row) => this.openRecordDetailPanel(anchorEl, row),
    isReadOnly: true,
    isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
    toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.config, field, key, count),
    updateTimelineAnchor: (dateKey, _label, timeMinutes) => this.updateTimelineAnchor(dateKey, timeMinutes),
    updateTimelineScale: (scale) => this.updateTimelineScale(scale),
    onConfigChange: () => {
      if (!this.config) return;
      this.persistEmbeddedConfigLocally(this.config);
      this.renderResults(this.config);
      this.saveEmbeddedConfigInBackground();
    },
    getTimelineInvalidEventCount: () => this.getEmbeddedInvalidEventCount(),
    openTimelineInvalidEvents: () => this.openEmbeddedInvalidEvents(),
    renderRecordIcon: (parent, row, config, compact) => this.renderEmbeddedRecordIcon(parent, row, config, compact),
    renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.currentDbConfig),
    applyConditionalFormat: (element, row, config) => applyConditionalFormat(element, row, config, this.currentDbConfig),
  });
  /** 嵌入式展开：只读预览（嵌入式 record mutation 只读，字段不可编辑，仅展示 + 打开笔记）。 */
  private openRecordDetailPanel(anchorEl: HTMLElement, row: RowData): void {
    const config = this.config;
    if (!config || !this.containerEl) return;
    const columns = getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns);
    openRecordDetailPanel({
      anchorEl,
      host: this.containerEl,
      row,
      columns,
      config,
      app: this.app,
      actions: {
        editCell: () => {},
        openRow: (r) => this.dataSource.openNote(r.file),
        renderRecordIcon: (parent, r, view, compact) => this.renderEmbeddedRecordIcon(parent, r, view, compact),
        applyConditionalFormat: (element, r, view, targetField) =>
          applyConditionalFormat(element, r, view, this.currentDbConfig, targetField),
        isReadOnly: true,
      },
    });
  }
  private toolbarRenderer = new ToolbarRenderer();
  private filterPanelRenderer = new FilterPanelRenderer();
  private columnManagerRenderer = new ColumnManagerRenderer();
  private viewConfigPanelRenderer = new ViewConfigPanelRenderer();
  private sortPanelRenderer = new SortPanelRenderer();
  private summaryRenderer = new SummaryRenderer();
  private showFilterPanel = false;
  private showColumnManager = false;
  private showSortPanel = false;
  private showViewConfigPanel = false;
  /** Last view type we finished rendering, so we reset the scroll to the top
   * only on a real view-type switch — not on filter/sort/data refreshes. */
  private lastRenderedViewType: string | null = null;
  private activeHeaderPopover?: HeaderPopoverKind;
  private headerPopoverAnchorEl?: HTMLElement;
  private removeHeaderPopoverAutoClose?: () => void;
  private groupOrderPopover?: HTMLElement;
  private removeGroupOrderPopoverListener?: () => void;
  private config?: ViewConfig;
  private currentDbConfig?: DatabaseConfig;
  private currentSourcePath = "";
  private currentViewIndex = 0;
  private viewIndexOverride: number | null = null;
  private selectedRows = new Set<string>();
  private lastSelectedRowPath: string | null = null;
  private cellSelection: { anchor: CellAddress; focus: CellAddress } | null = null;
  private isSelectingCells = false;
  private syncingComputed = false;
  private computedSyncTimer: number | null = null;
  private pendingDataChange = false;
  private suppressDataReloadUntil = 0;
  private readonly handleOutsideClickBound = (event: MouseEvent) => this.handleOutsideClick(event);
  private readonly handleWindowFocusBound = () => this.handleWindowFocus();
  private readonly instanceId = generateId();
  private intersectionObserver?: IntersectionObserver;
  private isIntersecting = false;
  private hasObservedVisibility = false;
  private pendingRefreshWhileHidden = false;
  private pendingDatabaseOverride?: EmbeddedDatabaseEntry;
  private unsubscribe?: () => void;
  private unsubscribeViewConfig?: () => void;
  private configHistoryStack: DatabaseConfig[] = [];
  private headerChromeHiddenOverride: boolean | null = null;
  private embedCodeBlockHosts: HTMLElement[] = [];
  private refreshCoordinator: RefreshCoordinator;
  private pendingSourceReload = false;

  constructor(
    private app: App,
    containerEl: HTMLElement,
    private dataSource: DataSource,
    private databaseEntries: EmbeddedDatabaseEntry[] | (() => EmbeddedDatabaseEntry[]),
    private source: string,
    private sourcePath: string,
    private getSectionInfo: () => MarkdownSectionInformation | null,
    private onConfigChanged: () => Promise<void>,
    private persistMode: "codeblock" | "frontmatter" = "codeblock",
    private defaultRecordFolder = ""
  ) {
    super(containerEl);
    const isCodeBlock = persistMode === "codeblock";
    const shouldHideResultCreateEntryButtons = () =>
      isCodeBlock || (this.config ? this.vs(this.config).searchText.trim().length > 0 : false);
    this.cellRenderer = new CellRenderer(
      this.dataSource,
      () => this.refreshAfterSave(),
      undefined,
      undefined,
      undefined,
      isCodeBlock,
      undefined,
      undefined,
      (row) => this.getFileTitleInfo(row),
      () => this.config?.schema.computedFields || [],
      this.app,
      undefined,
      undefined,
      this.instanceId
    );
    this.rowMenu = new RowMenu({
      app: this.app,
      openRow: (row) => this.dataSource.openNote(row.file),
      deleteRow: (row) => this.deleteRow(row),
      isReadOnly: isCodeBlock,
    });
    this.columnHeaderController = new ColumnHeaderController({
      getConfig: () => this.config,
      ensureColumnOrder: (config) => ensureColumnOrder(config),
      showContextMenu: (event, col, anchorEl) => this.showColumnContextMenu(event, col, anchorEl),
      sortByColumn: (col) => this.sortByColumn(col),
      saveConfig: () => this.persistEmbeddedConfigToSource(),
      setUndoLabel: (_label: string) => { /* no-op in embed mode */ },
      refresh: () => { if (this.config) this.renderResults(this.config); },
    });
    this.tableRenderer = new TableRenderer({
      getVisibleColumns: (config, rows) => getVisibleColumns(config, rows, this.vs(config), this.pendingShowColumns),
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      setupColumnHeader: (th, col) => this.columnHeaderController.setup(th, col),
      setupRow: (tr, row) => this.rowMenu.attachToRow(tr, row),
      renderCell: (td, row, col) => {
        if (isCodeBlock) this.renderReadOnlyCell(td, row, col);
        else this.cellRenderer.renderCell(td, row, col);
        td.toggleClass("db-cell-range-selected", this.isEmbedCellSelected(row.file.path, col.key));
        this.setupEmbedCellSelection(td, row, col);
      },
      renderRecordIcon: (parent, row, config, compact) => this.renderEmbeddedRecordIcon(parent, row, config, compact),
      renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.currentDbConfig),
      applyConditionalFormat: (element, row, config, targetField) => applyConditionalFormat(element, row, config, this.currentDbConfig, targetField),
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      createEntry: (defaults) => { if (!isCodeBlock) void this.createBlankEntry(defaults); },
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.config, field, key, count),
      get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); },
      isReadOnly: isCodeBlock,
    });
    this.boardRenderer = new BoardRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { if (!isCodeBlock) void this.createBlankEntry(defaults); },
      updateGroup: (row, field, value) => this.updateBoardGroup(row, field, value),
      updateGroupOrder: (field, order) => this.updateBoardGroupOrder(field, order),
      updateCardOrder: (field, groupKey, paths) => this.updateBoardCardOrder(field, groupKey, paths),
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      updateColumnWidth: (width) => this.updateBoardColumnWidth(width),
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.config, field, key, count),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
      showColumnMenu: (event, col, anchorEl) => this.showColumnContextMenu(event, col, anchorEl, false),
      renderRecordIcon: (parent, row, config, compact) => this.renderEmbeddedRecordIcon(parent, row, config, compact),
      renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.currentDbConfig),
      applyConditionalFormat: (element, row, config, targetField) => applyConditionalFormat(element, row, config, this.currentDbConfig, targetField),
      isReadOnly: isCodeBlock,
      canReorderGroups: true,
      get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); },
    });
    this.galleryRenderer = new GalleryRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { if (!isCodeBlock) void this.createBlankEntry(defaults); },
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns),
      updateCardSize: (width) => this.updateGalleryCardSize(width),
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.config, field, key, count),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
      showColumnMenu: (event, col, anchorEl) => this.showColumnContextMenu(event, col, anchorEl, false),
      renderRecordIcon: (parent, row, config, compact) => this.renderEmbeddedRecordIcon(parent, row, config, compact),
      renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.currentDbConfig),
      applyConditionalFormat: (element, row, config, targetField) => applyConditionalFormat(element, row, config, this.currentDbConfig, targetField),
      isReadOnly: isCodeBlock,
      get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); },
    });
    this.listRenderer = new ListRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { if (!isCodeBlock) void this.createBlankEntry(defaults); },
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected, event) => this.toggleRowSelected(row, selected, event),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns),
      moveRowToPosition: (movedPath, beforePath, afterPath) => this.moveRowToPosition(movedPath, beforePath, afterPath),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
    expandGroup: (field, key, count) => this.expandGroup(this.config, field, key, count),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
      showColumnMenu: (event, col, anchorEl) => this.showColumnContextMenu(event, col, anchorEl, false),
      renderRecordIcon: (parent, row, config, compact) => this.renderEmbeddedRecordIcon(parent, row, config, compact),
      renderGroupSummaries: (parent, rows, config) => this.summaryRenderer.renderGroupItems(parent, rows, config, this.currentDbConfig),
      applyConditionalFormat: (element, row, config, targetField) => applyConditionalFormat(element, row, config, this.currentDbConfig, targetField),
      isReadOnly: isCodeBlock,
      get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); },
    });
    this.refreshCoordinator = new RefreshCoordinator({
      isBlocked: () => this.cellRenderer.hasActiveEditor(this.containerEl) ||
        isRefreshBlockedByDrag(this.containerEl) ||
        this.syncingComputed ||
        Date.now() < this.suppressDataReloadUntil,
      isEligible: () => this.containerEl.isConnected && (!this.hasObservedVisibility || this.isIntersecting),
      onRefresh: (request) => {
        const forceReload = request.manual;
        if (forceReload) this.dataSource.invalidateRecordCache();
        const reloadSource = this.pendingSourceReload || forceReload;
        if (!reloadSource && !request.unknown) {
          if (this.tryUpdateChangedChartData(request.paths)) return;
          if (this.tryPatchChangedTableRows(request.paths)) return;
        }
        this.refreshChangedData(reloadSource);
        this.pendingSourceReload = false;
      },
      onStateChange: (state) => this.updateRefreshIndicator(state),
      onError: (error) => {
        console.error("Note Database: embedded refresh failed", error);
        new Notice(t("errors.refreshFailed"));
      },
      // IntersectionObserver pokes immediately when the embed becomes visible.
      // Keep only a low-frequency fallback for missed browser notifications.
      eligibilityRetryMs: 10_000,
      setTimer: (callback, delay) => this.getRefreshWindow().setTimeout(callback, delay),
      clearTimer: (timer) => this.getRefreshWindow().clearTimeout(timer),
    });
  }

  private readonly handleEmbedKeydownBound = (event: KeyboardEvent) => this.handleEmbedKeydown(event);
  private readonly handleMouseUpBound = () => { this.isSelectingCells = false; };

  private renderEmbeddedRecordIcon(parent: HTMLElement, row: RowData, config: ViewConfig, compact = false): HTMLElement | null {
    if (config.showRecordIcon !== true || !this.currentDbConfig) return null;
    const field = resolveRecordIconField(this.currentDbConfig, config);
    return renderRecordIcon(parent, field ? row.frontmatter[field] : undefined, { compact, editable: false });
  }

  onload(): void {
    this.containerEl.addClass("note-database-container");
    this.containerEl.addClass("note-database-embed");
    this.markEmbedCodeBlockHost();
    this.unsubscribe = this.dataSource.onDataChanged((batch) => this.handleDataChanged(batch));
    this.unsubscribeViewConfig = this.dataSource.onViewConfigChanged((mutation) => this.handlePeerViewConfigChanged(mutation));
    this.containerEl.ownerDocument.addEventListener("mousedown", this.handleOutsideClickBound, true);
    this.containerEl.ownerDocument.addEventListener("mouseup", this.handleMouseUpBound);
    this.getRefreshWindow().addEventListener("focus", this.handleWindowFocusBound);
    this.containerEl.addEventListener("keydown", this.handleEmbedKeydownBound);
    this.registerEvent(this.app.workspace.on("css-change", () => this.chartRenderer.refreshTheme()));
    this.observeVisibility();
    this.render();
  }

  onunload(): void {
    this.refreshCoordinator.destroy();
    this.chartRenderer.destroy();
    this.closeCalendarTimelineSearchResultsPanel();
    // 清理时间线渲染器的 observer/popover/定时器和进行中的拖拽监听，避免卸载后泄漏
    this.calendarTimelineRenderer.destroy();
    this.chartToolbarRenderer.closePopover();
    this.clearComputedSyncTimer();
    this.removeHeaderPopoverAutoClose?.();
    this.removeHeaderPopoverAutoClose = undefined;
    this.closeGroupOrderPopover();
    this.unsubscribe?.();
    this.unsubscribeViewConfig?.();
    this.containerEl.ownerDocument.removeEventListener("mousedown", this.handleOutsideClickBound, true);
    this.containerEl.ownerDocument.removeEventListener("mouseup", this.handleMouseUpBound);
    this.getRefreshWindow().removeEventListener("focus", this.handleWindowFocusBound);
    this.containerEl.removeEventListener("keydown", this.handleEmbedKeydownBound);
    this.intersectionObserver?.disconnect();
    this.clearFileViewWidthClass();
    this.clearEmbedCodeBlockHost();
    // 取消可能仍在调度的无效时间事件分块扫描，避免卸载后继续占用 idle 回调
    this.timelineInvalidEventsScanner.clear();
  }

  private markEmbedCodeBlockHost(): void {
    if (this.persistMode !== "codeblock") return;
    this.clearEmbedCodeBlockHost();

    let el = this.containerEl.parentElement;
    for (let depth = 0; depth < 8 && isHTMLElement(el); depth++) {
      if (el.hasClass("markdown-rendered") || el.hasClass("markdown-preview-view")) break;
      el.addClass("note-database-embed-codeblock-host");
      this.embedCodeBlockHosts.push(el);
      el = el.parentElement;
    }
  }

  private clearEmbedCodeBlockHost(): void {
    for (const host of this.embedCodeBlockHosts) {
      host.removeClass("note-database-embed-codeblock-host");
    }
    this.embedCodeBlockHosts = [];
  }

  private observeVisibility(): void {
    const ownerWindow = this.getRefreshWindow() as Window & {
      IntersectionObserver?: typeof IntersectionObserver;
    };
    const Observer = ownerWindow.IntersectionObserver;
    if (!Observer) return;
    const observer = new Observer((entries: IntersectionObserverEntry[]) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      this.hasObservedVisibility = true;
      if (visible && this.pendingRefreshWhileHidden) {
        this.pendingRefreshWhileHidden = false;
        this.refreshCoordinator.poke();
      }
      this.isIntersecting = visible;
      if (visible) this.refreshCoordinator.poke();
    });
    this.intersectionObserver = observer;
    observer.observe(this.containerEl);
  }

  private handleWindowFocus(): void {
    this.refreshCoordinator.poke();
  }

  private getRefreshWindow(): Window {
    return this.containerEl.ownerDocument.defaultView || window;
  }

  private refreshOnActivation(): void {
    if (!this.containerEl.isConnected) return;
    this.refreshCoordinator.poke();
  }

  private hardRefreshFromSource(): void {
    const scroll = this.saveScroll();
    this.config = undefined;
    this.state = undefined;
    this.stateStore.clear();
    this.showFilterPanel = false;
    this.showSortPanel = false;
    this.showColumnManager = false;
    this.showViewConfigPanel = false;
    this.clearHeaderPopover();
    this.closeGroupOrderPopover();
    this.cellSelection = null;
    this.isSelectingCells = false;
    this.render(scroll);
    this.pendingDatabaseOverride = undefined;
  }

  private render(scroll?: { top: number; left: number }): void {
    const hostViewport = captureEmbeddedHostViewport(this.containerEl);
    const pos = scroll ?? this.saveScroll();
    const descriptionScroll = this.saveDescriptionScroll();
    this.containerEl.empty();
    this.containerEl.toggleClass("note-database-embed-headerless", this.shouldHideHeaderChrome());
    const config = this.getEmbeddedConfig();
    if (!config) {
      this.containerEl.createDiv({ cls: "db-empty", text: t("errors.databaseViewNotFound") });
      this.restoreEmbeddedHostViewport(hostViewport);
      return;
    }
    // Reset scroll to the top on an actual view-type switch: switching into a
    // tall calendar/timeline embed must start at the top instead of keeping the
    // previous view's mid-page scroll. Filter/sort/data refreshes reuse the same
    // viewType and keep the saved position.
    const viewType = config.viewType || "table";
    // Read-only here: renderResults() owns the lastRenderedViewType update so
    // that both the render() path and the direct renderResults() path
    // (selectViewInView / setViewType) agree on what counts as a view-type switch.
    const viewTypeChanged = this.lastRenderedViewType !== viewType;
    this.renderToolbar(config);
    this.renderHeaderChromeToggle(config);
    this.renderFilterPanel(config);
    this.renderSortPanel(config);
    this.renderColumnManager(config);
    this.renderViewConfigPanel(config);
    this.renderResults(config);
    this.updateStickyOffsets();
    this.restoreScroll(viewTypeChanged ? { top: 0, left: pos.left } : pos);
    this.restoreDescriptionScroll(descriptionScroll);
    this.restoreEmbeddedHostViewport(hostViewport);
  }

  private saveScroll(): { top: number; left: number } {
    return { top: this.containerEl.scrollTop, left: this.containerEl.scrollLeft };
  }

  private restoreScroll(pos: { top: number; left: number }): void {
    this.containerEl.scrollTop = pos.top;
    this.containerEl.scrollLeft = pos.left;
  }

  private saveDescriptionScroll(): number {
    return this.containerEl.querySelector<HTMLElement>(":scope > .db-header .db-description")?.scrollTop || 0;
  }

  private restoreDescriptionScroll(scrollTop: number): void {
    if (scrollTop <= 0) return;
    const restore = () => {
      const desc = this.containerEl.querySelector<HTMLElement>(":scope > .db-header .db-description");
      if (desc) desc.scrollTop = scrollTop;
    };
    restore();
    window.requestAnimationFrame(restore);
  }

  private restoreEmbeddedHostViewport(snapshot: EmbeddedHostViewportSnapshot | null): void {
    restoreEmbeddedHostViewport(snapshot);
    window.requestAnimationFrame(() => restoreEmbeddedHostViewport(snapshot));
  }

  private handleDataChanged(batch: DataChangeBatch): void {
    this.deferRefreshUntilVisible();
    const observable = batch.changes.filter((change) => change.sourceInstanceId !== this.instanceId);
    if (observable.length === 0) return;
    const rowPaths = new Set(this.rows.map((row) => row.file.path));
    const database = this.currentDbConfig;
    const relevant = observable.filter((change) => {
      const sourceConfigEcho = change.origin === "plugin" &&
        Boolean(change.sourceInstanceId) &&
        (change.path === this.currentSourcePath || change.oldPath === this.currentSourcePath);
      if (sourceConfigEcho) return false;
      return change.path === this.currentSourcePath ||
        change.oldPath === this.currentSourcePath ||
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
    if (relevant.some((change) => change.path === this.currentSourcePath || change.oldPath === this.currentSourcePath)) {
      this.pendingSourceReload = true;
    }
    this.refreshCoordinator.mark(relevant.map((change) => change.path));
  }

  private refreshChangedData(reloadSource: boolean): void {
    if (reloadSource) {
      this.config = undefined;
      this.currentDbConfig = undefined;
      this.render();
      return;
    }
    if (this.config) {
      this.renderResults(this.config);
      return;
    }
    this.render();
  }

  /** Keep the connected Chart.js canvas alive for ordinary data refreshes. */
  private tryUpdateChangedChartData(paths: string[]): boolean {
    const config = this.config;
    if (!config || config.viewType !== "chart") return false;
    const records = this.dataSource.getRecordsForConfig(this.getEffectiveConfig(config));
    const pipelineConfig = { ...config, manualOrder: undefined };
    this.rows = this.buildRowsWithRelations(
      records,
      pipelineConfig,
      this.vs(config),
      this.currentDbConfig,
      true,
    );
    this.timelineInvalidRowsVersion += 1;
    this.scheduleComputedSync(
      config,
      this.getIncrementalComputedSyncRows(config, this.rows, new Set(paths))
    );
    this.chartRenderer.render(
      this.containerEl,
      this.getStatefulConfig(config),
      this.rows,
      config.schema.columns,
      {
        onFilter: (rules) => this.applyChartFilters(config, rules),
        onConfigChange: () => {
          this.persistEmbeddedConfigLocally(config);
          this.renderChartOnly(config);
          this.saveEmbeddedConfigInBackground();
        },
      }
    );
    this.summaryRenderer.render(this.containerEl, this.rows, config, this.currentDbConfig, {
      placement: "after-chart",
      onChange: () => {
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      },
    });
    return true;
  }

  private getIncrementalComputedSyncRows(
    config: ViewConfig,
    rows: RowData[],
    changedPaths: ReadonlySet<string>
  ): RowData[] {
    if ((config.schema.computedFields || []).some((definition) =>
      /\bbacklinks\b/i.test(definition.expression)
    )) {
      return rows;
    }
    return rows.filter((row) => changedPaths.has(row.file.path));
  }

  /**
   * Keep small embedded-table refreshes local to the changed rows. As with the
   * full database view, the row pipeline remains authoritative and the patch is
   * accepted only when the complete rendered structure still matches.
   */
  private tryPatchChangedTableRows(paths: string[]): boolean {
    const config = this.config;
    if (!config || paths.length === 0 || config.viewType !== "table") return false;
    const state = this.vs(config);
    if (state.searchText.trim()) return false;
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
      return false;
    }

    const changedPaths = new Set(paths);
    const affectedVisibleCount = this.rows.reduce(
      (count, row) => count + (changedPaths.has(row.file.path) ? 1 : 0),
      0
    );
    const patchLimit = Math.max(12, Math.ceil(this.rows.length / 4));
    if (affectedVisibleCount > patchLimit) return false;

    const records = this.dataSource.getRecordsForConfig(this.getEffectiveConfig(config));
    const nextRows = this.buildRowsWithRelations(
      records,
      config,
      state,
      this.currentDbConfig,
    );
    const renderConfig = this.getStatefulConfig(config);
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
            this.containerEl,
            renderConfig,
            nextRows,
            this.queryEngine.sortGroups(groups, order),
            field,
            changedPaths
          );
        })()
      : this.tableRenderer.patchUngroupedRows(
          this.containerEl,
          renderConfig,
          nextRows,
          changedPaths
        );
    if (!patched) return false;

    this.rows = nextRows;
    this.timelineInvalidRowsVersion += 1;
    this.scheduleComputedSync(
      config,
      this.getIncrementalComputedSyncRows(config, this.rows, changedPaths)
    );
    this.summaryRenderer.render(this.containerEl, this.rows, config, this.currentDbConfig, {
      onChange: () => {
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      },
    });
    const summary = this.containerEl.querySelector<HTMLElement>(":scope > .db-summary");
    const tableRoot = this.containerEl.querySelector<HTMLElement>(
      ":scope > .db-table-wrap, :scope > .db-grouped-table"
    );
    if (summary && tableRoot) this.containerEl.insertBefore(summary, tableRoot);
    this.renderEmbedCellSelectionClasses();
    this.renderEmbedSelectionStatusBar();

    const openDetailPath = getOpenRecordDetailPath();
    if (openDetailPath) {
      const nextRow = this.rows.find((row) => row.file.path === openDetailPath);
      if (nextRow) refreshRecordDetailPanel(nextRow);
      else closeRecordDetailPanel();
    }
    return true;
  }

  private deferRefreshUntilVisible(): boolean {
    if (!this.hasObservedVisibility || this.isIntersecting) return false;
    this.pendingRefreshWhileHidden = true;
    return true;
  }

  private handleOutsideClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (this.cellSelection && this.shouldClearCellSelectionFromPointer(target)) {
      this.clearEmbedCellSelection();
    }
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    if (!this.containerEl.contains(target)) {
      this.closePopovers();
      return;
    }
    if (target.closest(".db-filter-panel, .db-sort-panel, .db-column-manager, .db-view-config-panel, .db-dropdown-popover, .db-toolbar, .db-header")) return;
    this.closePopovers();
  }

  private shouldClearCellSelectionFromPointer(target: HTMLElement): boolean {
    if (!this.containerEl.contains(target)) return !target.closest(".modal");
    return !target.closest(
      "td[data-note-database-row-path][data-note-database-column-key], " +
      ".db-selection-status-bar, .db-cell-editing, input, textarea, select, button, a, " +
      ".db-filter-panel, .db-sort-panel, .db-column-manager, .db-view-config-panel, .db-dropdown-popover, .db-group-order-popover, .menu"
    );
  }

  private closePopovers(): void {
    this.toolbarRenderer.closePopovers();
    this.calendarToolbarRenderer.closePopover();
    this.chartToolbarRenderer.closePopover();
    this.closeGroupOrderPopover();
    if (!this.config) return;
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    this.persistVisibleHeaderPopoverState(this.config);
    this.removeHeaderPopoverAutoClose?.();
    this.removeHeaderPopoverAutoClose = undefined;
    this.showFilterPanel = false;
    this.showSortPanel = false;
    this.showColumnManager = false;
    this.showViewConfigPanel = false;
    this.clearHeaderPopover();
    this.renderFilterPanel(this.config);
    this.renderSortPanel(this.config);
    this.renderColumnManager(this.config);
    this.renderViewConfigPanel(this.config);
    this.updateToolbarIndicators(this.config);
    this.renderResults(this.config);
    this.saveEmbeddedConfigInBackground();
  }

  private persistVisibleHeaderPopoverState(config: ViewConfig): void {
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    this.persistEmbeddedConfigLocally(config);
  }

  private getCurrentMutationTarget(): ViewConfigMutation | undefined {
    const view = this.config || this.getEmbeddedConfig();
    if (!view || !this.currentDbConfig) return undefined;
    return {
      dbId: this.currentDbConfig.id,
      dbPath: this.currentSourcePath,
      viewId: view.id,
      sourceInstanceId: this.instanceId,
    };
  }

  private getCurrentDatabaseMutationTarget(): ViewConfigMutation | undefined {
    if (!this.currentDbConfig) return undefined;
    return {
      dbId: this.currentDbConfig.id,
      dbPath: this.currentSourcePath,
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
    if (mutation.database) {
      this.pendingDatabaseOverride = {
        config: this.cloneDatabaseConfig(mutation.database),
        sourcePath: mutation.dbPath || this.currentSourcePath,
      };
    }
    if (this.hasObservedVisibility && !this.isIntersecting) {
      this.pendingSourceReload = true;
      this.pendingRefreshWhileHidden = true;
      this.refreshCoordinator.mark([mutation.dbPath || this.currentSourcePath]);
      return;
    }
    this.suppressDataReload(1000);
    this.hardRefreshFromSource();
  }

  private matchesCurrentView(mutation: ViewConfigMutation): boolean {
    const view = this.config || this.getEmbeddedConfig();
    if (!view || !this.currentDbConfig) return false;
    const sameDb = mutation.dbPath
      ? this.currentSourcePath === mutation.dbPath
      : mutation.dbId != null && this.currentDbConfig.id === mutation.dbId;
    if (!sameDb) return false;
    return !mutation.viewId || view.id === mutation.viewId;
  }

  private renderResults(config: ViewConfig, options: { viewport?: DatabaseViewportRequest } = {}): void {
    this.closeCalendarTimelineSearchResultsPanel();
    closeRecordDetailPanel();
    const hostViewport = captureEmbeddedHostViewport(this.containerEl);
    // 按当前视图的年份显示策略写入全局，供 DateTimeFormat.shouldShowYear 读取。
    setDateDisplayMode(config.yearDisplayMode || "always");
    const scroll = this.saveScroll();
    // renderResults() is the single owner of lastRenderedViewType so the scroll
    // reset fires for every entry into a different view type — whether the caller
    // went through render() (full re-render) or called renderResults() directly
    // (selectViewInView / setViewType / onViewTypeChange).
    const viewType = config.viewType || "table";
    const viewTypeChanged = this.lastRenderedViewType !== viewType;
    this.lastRenderedViewType = viewType;
    this.containerEl.toggleClass("db-width-wide", config.displayWidth === "wide");
    this.updateFileViewWidthClass(config);
    this.applyViewTypeClass(config.viewType || "table");
    const target = this.containerEl;
    const staleViewSelector = config.viewType === "chart"
      ? ".db-summary, .db-table-wrap, .db-grouped-table, .db-board, .db-gallery, .db-gallery-grouped, .db-gallery-total-header, .db-list, .db-list-grouped, .db-list-total-header, .db-calendar, .db-timeline, .db-empty"
      : ".db-summary, .db-table-wrap, .db-grouped-table, .db-board, .db-gallery, .db-gallery-grouped, .db-gallery-total-header, .db-list, .db-list-grouped, .db-list-total-header, .db-chart, .db-chart-empty, .db-chart-number, .db-calendar, .db-timeline, .db-empty";
    target.querySelectorAll(staleViewSelector).forEach((el) => el.remove());
    if (!config.schema.columns || config.schema.columns.length === 0) {
      target.createDiv({ cls: "db-empty", text: t("errors.noColumns") });
      this.restoreEmbeddedHostViewport(hostViewport);
      return;
    }
    let records: NoteRecord[];
    try {
      records = this.dataSource.getRecordsForConfig(this.getEffectiveConfig(config));
    } catch (err) {
      target.createDiv({ cls: "db-empty", text: t("errors.dataReadFailed", { error: String(err) }) });
      this.restoreEmbeddedHostViewport(hostViewport);
      return;
    }

    const pipelineConfig = config.viewType === "chart" ? { ...config, manualOrder: undefined } : config;
    this.rows = this.buildRowsWithRelations(records, pipelineConfig, this.vs(config), this.currentDbConfig, true);
    this.timelineInvalidRowsVersion += 1;
    this.scheduleComputedSync(config, this.rows);
    if (config.viewType !== "chart") {
      this.summaryRenderer.render(target, this.rows, config, this.currentDbConfig, {
        onChange: () => {
          this.persistEmbeddedConfigLocally(config);
          this.renderResults(config);
          this.saveEmbeddedConfigInBackground();
        },
      });
    }
    const renderConfig = this.getStatefulConfig(config);
    if (config.viewType === "board") {
      const field = config.boardGroupField || this.vs(config).groupByField || this.getDefaultBoardField(config);
      this.boardRenderer.render(target, renderConfig, this.getBoardGroups(config, field), field);
    } else if (config.viewType === "gallery") {
      if (this.vs(config).groupByField) {
        const field = this.vs(config).groupByField;
        const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], config.schema.columns.find((c) => c.key === field), config));
        const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
        this.galleryRenderer.renderGrouped(target, renderConfig, this.queryEngine.sortGroups(groups, order), field);
      } else {
        this.galleryRenderer.render(target, renderConfig, this.rows);
      }
    } else if (config.viewType === "list") {
      if (this.vs(config).groupByField) {
        const field = this.vs(config).groupByField;
        const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], config.schema.columns.find((c) => c.key === field), config));
        const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
        this.listRenderer.renderGrouped(target, renderConfig, this.queryEngine.sortGroups(groups, order), field);
      } else {
        this.listRenderer.render(target, renderConfig, this.rows);
      }
    } else if (config.viewType === "chart") {
      this.chartRenderer.render(target, renderConfig, this.rows, config.schema.columns, {
        onFilter: (rules) => this.applyChartFilters(config, rules),
        onConfigChange: () => {
          this.persistEmbeddedConfigLocally(config);
          this.renderChartOnly(config);
          this.saveEmbeddedConfigInBackground();
        },
      });
    } else if (config.viewType === "calendar") {
      this.calendarRenderer.render(target, renderConfig, this.rows);
    } else if (config.viewType === "timeline") {
      const state = this.vs(config);
      this.calendarTimelineRenderer.renderTimeline(target, {
        ...renderConfig,
        // 同 DatabaseView.getTimelineRenderConfig：分组只跟 state.groupByField，
        // 避免「无分组」空串被 `||` 回退到历史 timelineGroupField。
        timelineGroupField: state.groupByField,
        sortColumn: state.sortColumn,
        sortDirection: state.sortDirection,
        sortRules: state.sortRules,
      }, this.rows);
    } else if (this.vs(config).groupByField) {
      const field = this.vs(config).groupByField;
      const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], config.schema.columns.find((c) => c.key === field), config));
      const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
      this.tableRenderer.renderGroupedTable(target, renderConfig, this.rows, this.queryEngine.sortGroups(groups, order), field);
    } else {
      this.tableRenderer.renderTable(target, renderConfig, this.rows);
    }
    if (config.viewType === "chart") {
      this.summaryRenderer.render(target, this.rows, config, this.currentDbConfig, {
        placement: "after-chart",
        onChange: () => {
          this.persistEmbeddedConfigLocally(config);
          this.renderResults(config);
          this.saveEmbeddedConfigInBackground();
        },
      });
    }
    this.renderCalendarTimelineSearchResultsPanel(config);
    this.revealPendingSearchResult();
    if (options.viewport === "reset-top") {
      this.restoreScroll({ top: 0, left: 0 });
    } else if (options.viewport !== "none") {
      this.restoreScroll(viewTypeChanged && options.viewport !== "preserve-raw" ? { top: 0, left: scroll.left } : scroll);
    }
    this.restoreEmbeddedHostViewport(hostViewport);
    const searchQuery = this.vs(config).searchText;
    if (searchQuery) highlightSearchMatches(this.containerEl, searchQuery);
  }

  private renderCalendarTimelineSearchResultsPanel(config: ViewConfig): void {
    this.closeCalendarTimelineSearchResultsPanel();
    if (config.viewType !== "calendar" && config.viewType !== "timeline") return;
    const query = this.vs(config).searchText.trim();
    if (!query) return;
    const searchControl = this.containerEl.querySelector<HTMLElement>(".db-search-control");
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
    this.renderCalendarTimelineSearchResultsContent(panel, results, config, query);
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

  private renderCalendarTimelineSearchResultsContent(panel: HTMLElement, results: CalendarTimelineSearchResults, config: ViewConfig, query: string): void {
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
      for (const item of items) this.renderCalendarTimelineSearchResultButton(section, config, item, query);
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

  private renderCalendarTimelineSearchResultButton(list: HTMLElement, config: ViewConfig, item: CalendarTimelineSearchResultItem, query: string): void {
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
      this.jumpToCalendarTimelineSearchResult(config, item);
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

  private jumpToCalendarTimelineSearchResult(config: ViewConfig, item: CalendarTimelineSearchResultItem): void {
    this.pendingSearchResultRevealPath = item.filePath;
    if (config.viewType === "timeline") {
      const timeMinutes = (config.timelineScale || "week") === "day" ? item.startMinutes : undefined;
      this.updateTimelineAnchor(item.startDateKey, timeMinutes);
      return;
    }
    if (config.viewType !== "calendar") return;
    config.calendarMonth = item.startDateKey.slice(0, 7);
    config.calendarWeekStart = item.startDateKey;
    config.calendarDay = item.startDateKey;
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
  }

  private revealPendingSearchResult(): void {
    const path = this.pendingSearchResultRevealPath;
    if (!path) return;
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

  private findRenderedRowElement(path: string): HTMLElement | null {
    const candidates = Array.from(
      this.containerEl.querySelectorAll<HTMLElement>("[data-note-database-row-path]")
    );
    return candidates.find((candidate) => candidate.dataset.noteDatabaseRowPath === path) || null;
  }

  private applyViewTypeClass(viewType: NonNullable<ViewConfig["viewType"]>): void {
    for (const type of ["table", "board", "gallery", "list", "chart", "calendar", "timeline"] as const) {
      this.containerEl.toggleClass(`db-view-${type}`, viewType === type);
    }
  }

  private renderToolbar(config: ViewConfig): void {
    // Use the currentDbConfig if available (for multi-view support)
    const baseDbConfig = this.currentDbConfig || {
      id: "embedded",
      name: config.name,
      sourceFolder: config.sourceFolder,
      schema: config.schema,
      views: [config],
    };
    // ToolbarRenderer mutates the current view by reference. Pass our working
    // copy (this.config) as the current view so option edits land on it and
    // persistEmbeddedConfigLocally/renderResults observe them — otherwise the
    // renderer would mutate the source view while the working copy stays stale
    // and the next persist would overwrite the edit with the stale copy.
    const dbConfig = baseDbConfig.views[this.currentViewIndex] === config
      ? baseDbConfig
      : { ...baseDbConfig, views: baseDbConfig.views.map((view, idx) => (idx === this.currentViewIndex ? config : view)) };
    this.toolbarRenderer.render(this.containerEl, [{ config: dbConfig, sourcePath: this.currentSourcePath }], 0, this.currentViewIndex, this.vs(config), {
      selectDatabase: () => undefined,
      selectViewInView: (_dbIndex: number, viewIndex: number) => {
        if (!this.currentDbConfig || viewIndex === this.currentViewIndex) return;
        const descriptionScroll = this.saveDescriptionScroll();
        this.closePopovers();
        this.currentViewIndex = viewIndex;
        this.viewIndexOverride = viewIndex;
        this.config = undefined;
        this.state = undefined;
        const newConfig = this.getEmbeddedConfig()!;
        this.rerenderToolbar(newConfig);
        this.renderResults(newConfig, { viewport: "reset-top" });
        this.restoreDescriptionScroll(descriptionScroll);
        this.persistEmbeddedConfigLocally(newConfig);
        this.saveEmbeddedConfigInBackground();
        this.saveCodeBlockReferenceInBackground(newConfig);
      },
      addView: () => {
        new Notice(t("notice.editInFullView", { action: t("toolbar.addView") }));
      },
      moveView: (fromIndex, toIndex) => this.moveView(fromIndex, toIndex),
      deleteView: (viewIndex: number) => {
        if (!this.currentDbConfig || this.currentDbConfig.views.length <= 1) return;
        // Only switch away from the deleted view in embedded mode; don't modify the source
        this.currentViewIndex = Math.min(viewIndex, this.currentDbConfig.views.length - 2);
        this.config = undefined;
        this.rerenderToolbar(config);
        this.renderResults(this.getEmbeddedConfig()!, { viewport: "reset-top" });
      },
      renameView: () => {
        new Notice(t("notice.editInFullView", { action: t("toolbar.rename") }));
      },
      setViewType: (value, viewIndex) => {
        if (viewIndex != null && viewIndex !== this.currentViewIndex && this.currentDbConfig?.views[viewIndex]) {
          const view = this.currentDbConfig.views[viewIndex];
          this.setEmbeddedViewType(view, value);
          this.initializeEmbeddedViewTypeDefaults(view, value);
          this.persistEmbeddedConfigLocally(config);
          this.rerenderToolbar(config);
          this.saveEmbeddedConfigInBackground();
          return;
        }
        const descriptionScroll = this.saveDescriptionScroll();
        this.setEmbeddedViewType(config, value);
        this.initializeEmbeddedViewTypeDefaults(config, value);
        this.persistEmbeddedConfigLocally(config);
        this.rerenderToolbar(config);
        this.renderResults(config, { viewport: "reset-top" });
        this.restoreDescriptionScroll(descriptionScroll);
        this.saveEmbeddedConfigInBackground();
      },
      setDisplayWidth: (value) => {
        config.displayWidth = value;
        this.persistEmbeddedConfigLocally(config);
        this.containerEl.toggleClass("db-width-wide", value === "wide");
        this.updateFileViewWidthClass(config);
        this.saveEmbeddedConfigInBackground();
      },
      setSearchText: (value) => {
        // Search is intentionally transient: it only mutates the in-memory
        // view state and is never persisted to the source. See
        // search-transient.test.ts and VIEW_REGRESSION_MATRIX.md.
        this.vs(config).searchText = value;
        this.updateToolbarIndicators(config);
        this.renderResults(config, { viewport: "reset-top" });
      },
      onSearchFocus: () => this.renderCalendarTimelineSearchResultsPanel(config),
      setGroupByField: (value) => {
        if (config.viewType === "board") {
          if (!value) return;
          config.boardGroupField = value;
          this.normalizeBoardSubgroupAfterGroupChange(config, value);
        } else {
          this.vs(config).groupByField = value;
        }
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config, { viewport: "reset-top" });
        this.saveEmbeddedConfigInBackground();
      },
      setShowEmptyGroups: (field, value) => {
        setShowEmptyGroups(config, field, value);
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config, { viewport: "reset-top" });
        this.saveEmbeddedConfigInBackground();
      },
      setGroupDateMode: (field, mode) => {
        const modes = { ...(config.dateGroupModes || {}) };
        if (mode === "exact") delete modes[field];
        else modes[field] = mode;
        config.dateGroupModes = Object.keys(modes).length > 0 ? modes : undefined;
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config, { viewport: "reset-top" });
        this.saveEmbeddedConfigInBackground();
      },
      setGroupRowLimit: (limit) => this.setGroupRowLimit(limit),
      setBoardSubgroupEnabled: (enabled) => {
        config.boardSubgroupEnabled = enabled;
        if (!enabled) config.boardSubgroupField = undefined;
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config, { viewport: "reset-top" });
        this.saveEmbeddedConfigInBackground();
      },
      setBoardSubgroupField: (value) => {
        const groupField = config.boardGroupField || this.vs(config).groupByField || this.getDefaultBoardField(config);
        const subgroupField = value && value !== groupField && value !== "file.name" ? value : "";
        config.boardSubgroupEnabled = true;
        config.boardSubgroupField = subgroupField || undefined;
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config, { viewport: "reset-top" });
        this.saveEmbeddedConfigInBackground();
      },
      configureGroupOrder: () => this.showGroupOrderPopover(config),
      setGroupOrderMode: (mode) => this.setGroupOrderMode(config, mode),
      toggleSortPanel: (anchorEl) => this.toggleHeaderPopover(config, "sort", anchorEl),
      toggleChartOptions: (anchorEl) => this.toggleChartOptions(config, anchorEl),
      toggleCalendarOptions: (containerEl, anchor, cfg) => {
        this.calendarToolbarRenderer.togglePopover(containerEl, anchor, cfg, {
          database: this.currentDbConfig,
          onChange: () => {
            this.persistEmbeddedConfigLocally(cfg);
            this.renderResults(cfg);
            this.saveEmbeddedConfigInBackground();
          },
          getInvalidEventCount: () => this.getEmbeddedInvalidEventCount(cfg),
          openInvalidEvents: () => this.openEmbeddedInvalidEvents(),
        });
      },
      updateViewConfig: () => {
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      },
      updateTimelineScale: (scale) => this.updateTimelineScale(scale),
      getTimelineInvalidEventCount: () => this.getEmbeddedInvalidEventCount(config),
      openTimelineInvalidEvents: () => {
        if (this.persistMode === "codeblock") {
          new Notice(t("notice.editInFullView", { action: t("timeline.viewInvalidEvents") }));
          return;
        }
        void this.openFullDatabaseView(config);
      },
      syncComputedFields: this.persistMode === "codeblock"
        ? undefined
        : () => { this.syncComputedFieldsInBackground(config, this.rows, true, true); },
      refreshDatabase: () => this.refreshCoordinator.refreshNow(),
      pendingRefreshCount: this.refreshCoordinator.getState().pendingCount,
      pendingRefreshUnknown: this.refreshCoordinator.getState().pendingUnknown,
      isRefreshingDatabase: this.refreshCoordinator.getState().refreshing,
      toggleFilterPanel: (anchorEl) => this.toggleHeaderPopover(config, "filter", anchorEl),
      toggleColumnManager: (anchorEl) => this.toggleHeaderPopover(config, "columns", anchorEl),
      toggleViewConfig: (anchorEl) => this.toggleHeaderPopover(config, "view", anchorEl),
      closeToolbarPopovers: () => this.closePopovers(),
      openFullView: () => { void this.openFullDatabaseView(config); },
      toggleHeaderChrome: (hidden) => this.toggleHeaderChrome(config, hidden),
      copyViewCode: () => { void this.copyEmbeddedViewCode(config); },
      exportData: (format) => this.exportData(config, format),
      exportCsvMarkdownZip: () => { void this.exportCsvMarkdownZip(); },
      createEntry: (defaults) => { if (this.persistMode !== "codeblock") void this.createBlankEntry(defaults); },
      isReadOnly: this.persistMode === "codeblock",
      showChartOptions: this.persistMode !== "codeblock",
      addDatabase: () => {},
      deleteDatabase: () => {},
      openDatabaseFile: () => {},
      isReadOnlyViews: true,
      hideWidthSelect: true,
      showDatabaseChrome: this.persistMode === "frontmatter",
      hideDatabaseActions: this.persistMode === "frontmatter",
      hideHeaderChrome: this.shouldHideHeaderChrome(),
    });
    this.updateStickyOffsets();
  }

  private renderHeaderChromeToggle(config: ViewConfig): void {
    this.containerEl.querySelector(":scope > .db-embed-header-toggle")?.remove();
    if (this.persistMode !== "codeblock") return;
    const hidden = this.shouldHideHeaderChrome();
    const label = hidden ? t("toolbar.showEmbedHeader") : t("toolbar.hideEmbedHeader");
    const button = this.containerEl.createEl("button", {
      cls: `db-toolbar-icon-button db-embed-header-toggle${hidden ? " is-header-hidden" : ""}`,
      attr: {
        type: "button",
        title: label,
        "aria-label": label,
      },
    });
    setIcon(button, hidden ? "chevron-down" : "chevron-up");
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleHeaderChrome(config, !hidden);
    };
    const header = this.containerEl.querySelector(":scope > .db-header");
    if (header) this.containerEl.insertBefore(button, header);
  }

  private toggleHeaderChrome(config: ViewConfig, hidden: boolean): void {
    this.headerChromeHiddenOverride = hidden;
    this.containerEl.toggleClass("note-database-embed-headerless", hidden);
    this.render();
    this.saveCodeBlockReferenceInBackground(config);
  }

  private rerenderToolbar(config: ViewConfig): void {
    this.closeCalendarTimelineSearchResultsPanel();
    this.containerEl.querySelector(":scope > .db-header")?.remove();
    this.renderToolbar(config);
    this.renderHeaderChromeToggle(config);
  }

  private updateRefreshIndicator(state = this.refreshCoordinator.getState()): void {
    const button = this.containerEl.querySelector<HTMLElement>(".db-database-refresh-button");
    if (!button) return;
    this.toolbarRenderer.updateDatabaseRefreshButton(button, {
      pendingRefreshCount: state.pendingCount,
      pendingRefreshUnknown: state.pendingUnknown,
      isRefreshingDatabase: state.refreshing,
    });
  }

  private updateStickyOffsets(): void {
    const update = () => {
      const hideHeader = this.shouldHideHeaderChrome();
      const header = hideHeader ? null : this.containerEl.querySelector(":scope > .db-header");
      const height = header ? Math.ceil(header.getBoundingClientRect().height) : 88;
      this.containerEl.style.setProperty("--db-table-header-top", `${hideHeader ? 0 : height}px`);
    };
    update();
    window.requestAnimationFrame(update);
  }

  private toggleHeaderPopover(config: ViewConfig, kind: HeaderPopoverKind, anchorEl: HTMLElement): void {
    this.chartToolbarRenderer.closePopover();
    const wasClosingActivePopover = this.activeHeaderPopover != null && this.isHeaderPopoverVisible(this.activeHeaderPopover);
    if (wasClosingActivePopover) this.persistVisibleHeaderPopoverState(config);
    const shouldOpen = this.activeHeaderPopover !== kind || !this.isHeaderPopoverVisible(kind);
    this.showFilterPanel = shouldOpen && kind === "filter";
    this.showSortPanel = shouldOpen && kind === "sort";
    this.showColumnManager = shouldOpen && kind === "columns";
    this.showViewConfigPanel = shouldOpen && kind === "view";
    this.activeHeaderPopover = shouldOpen ? kind : undefined;
    this.headerPopoverAnchorEl = shouldOpen ? anchorEl : undefined;
    this.renderFilterPanel(config);
    this.renderSortPanel(config);
    this.renderColumnManager(config);
    this.renderViewConfigPanel(config);
    if (shouldOpen) this.installHeaderPopoverAutoClose(kind);
    else {
      this.removeHeaderPopoverAutoClose?.();
      this.removeHeaderPopoverAutoClose = undefined;
    }
    if (wasClosingActivePopover) {
      this.updateToolbarIndicators(config);
      this.renderResults(config);
      this.saveEmbeddedConfigInBackground();
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
    const panel = this.containerEl.querySelector<HTMLElement>(panelSelector);
    if (!panel) return;
    this.removeHeaderPopoverAutoClose = installPopoverAutoClose({
      panel,
      anchorEl: this.headerPopoverAnchorEl,
      close: () => this.closePopovers(),
    });
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
    return this.containerEl.querySelector(selector) as HTMLElement | undefined;
  }

  private closeGroupOrderPopover(): void {
    this.removeGroupOrderPopoverListener?.();
    this.removeGroupOrderPopoverListener = undefined;
    this.groupOrderPopover?.remove();
    this.groupOrderPopover = undefined;
  }

  private renderFilterPanel(config: ViewConfig): void {
    this.filterPanelRenderer.render(this.containerEl, this.showFilterPanel, this.vs(config), config, {
      saveState: () => {
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
      },
      refresh: () => {
        this.updateToolbarIndicators(config);
        this.renderResults(config, { viewport: "reset-top" });
      },
      close: () => {
        this.showFilterPanel = false;
        this.clearHeaderPopover();
        this.renderFilterPanel(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      },
    }, this.getHeaderPopoverAnchor("filter"));
  }

  private renderSortPanel(config: ViewConfig): void {
    this.sortPanelRenderer.render(this.containerEl, this.showSortPanel, config, this.vs(config), {
      save: () => {
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
      },
      refresh: () => {
        this.updateToolbarIndicators(config);
        this.renderResults(config, { viewport: "reset-top" });
      },
      close: () => {
        this.showSortPanel = false;
        this.clearHeaderPopover();
        this.renderSortPanel(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      },
    }, this.getHeaderPopoverAnchor("sort"));
  }

  private getStatefulConfig(config: ViewConfig): ViewConfig {
    const state = this.vs(config);
    return {
      ...config,
      sortColumn: state.sortColumn,
      sortDirection: state.sortDirection,
      sortRules: state.sortRules,
    };
  }

  private renderColumnManager(config: ViewConfig): void {
    this.columnManagerRenderer.render(this.containerEl, this.showColumnManager, config, this.vs(config), getColumnsInOrder(config), {
      close: () => {
        this.showColumnManager = false;
        this.clearHeaderPopover();
        this.renderColumnManager(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      },
      setColumnVisible: (col, visible) => {
        if (visible) this.vs(config).hiddenColumns.delete(col.key);
        else this.vs(config).hiddenColumns.add(col.key);
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config);
      },
      setColumnsVisible: (changes) => {
        for (const change of changes) {
          if (change.visible) this.vs(config).hiddenColumns.delete(change.col.key);
          else this.vs(config).hiddenColumns.add(change.col.key);
        }
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
        this.renderColumnManager(config);
        this.renderResults(config);
      },
      setAllColumnsVisible: (visible) => {
        if (visible) {
          this.vs(config).hiddenColumns.clear();
        } else {
          const requiredKeys = this.getRequiredColumnKeys(config);
          for (const col of getColumnsInOrder(config)) {
            if (!requiredKeys.has(col.key)) this.vs(config).hiddenColumns.add(col.key);
          }
        }
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
        this.renderColumnManager(config);
        this.renderResults(config);
      },
      moveColumn: (key, offset) => {
        const order = config.columnOrder || config.schema.columns.map((col) => col.key);
        const index = order.indexOf(key);
        const next = index + offset;
        if (index < 0 || next < 0 || next >= order.length) return;
        [order[index], order[next]] = [order[next], order[index]];
        config.columnOrder = order;
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
      },
      moveColumnTo: (key, targetKey, placement) => {
        if (key === targetKey) return;
        const order = config.columnOrder || config.schema.columns.map((col) => col.key);
        const from = order.indexOf(key);
        const target = order.indexOf(targetKey);
        if (from < 0 || target < 0) return;
        const [item] = order.splice(from, 1);
        let insertIndex = order.indexOf(targetKey);
        if (placement === "after") insertIndex += 1;
        order.splice(insertIndex, 0, item);
        config.columnOrder = order;
        this.persistEmbeddedConfigLocally(config);
        this.renderColumnManager(config);
        this.renderResults(config);
      },
      toggleColumnWrap: (col) => {
        col.wrap = !col.wrap || undefined;
        this.persistEmbeddedConfigLocally(config);
        this.renderColumnManager(config);
        this.renderResults(config);
      },
      editColumn: () => new Notice(t("notice.editInFullView", { action: t("notice.editProperty") })),
      addColumn: () => new Notice(t("notice.editInFullView", { action: t("panel.addColumn") })),
      deleteColumn: () => new Notice(t("notice.editInFullView", { action: t("common.delete") })),
      isReadOnly: true,
    }, this.getHeaderPopoverAnchor("columns"));
  }

  private renderViewConfigPanel(config: ViewConfig): void {
    this.viewConfigPanelRenderer.render(this.containerEl, this.showViewConfigPanel, config, {
      app: this.app,
      database: this.currentDbConfig,
      isDatabaseReadOnly: true,
      onChange: () => {
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      },
      onViewTypeChange: (value) => {
        this.setEmbeddedViewType(config, value);
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
        this.persistEmbeddedConfigLocally(config);
        this.render();
        this.saveEmbeddedConfigInBackground();
      },
      onDatabaseChange: () => {
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      },
    }, this.getHeaderPopoverAnchor("view"));
  }

  private applyChartFilters(config: ViewConfig, rules: FilterRule[]): void {
    if (rules.length === 0) return;
    const state = this.vs(config);
    let changed = false;
    for (const rule of rules) {
      if (state.filters.some((existing) => filtersEqual(existing, rule))) continue;
      state.filters.push(rule);
      changed = true;
    }
    if (!changed) return;
    state.filterLogic = "and";
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config, { viewport: "reset-top" });
    this.saveEmbeddedConfigInBackground();
  }

  private toggleChartOptions(config: ViewConfig, anchorEl: HTMLElement): void {
    if (config.viewType !== "chart" || this.persistMode === "codeblock") return;
    if (this.chartToolbarRenderer.isPopoverOpen()) {
      this.chartToolbarRenderer.closePopover();
      return;
    }
    this.closePopovers();
    const activeAnchor = this.containerEl.querySelector<HTMLElement>(".db-chart-options-toolbar-btn") || anchorEl;
    this.chartToolbarRenderer.togglePopover(this.containerEl, activeAnchor, config, {
      onChange: () => {
        this.persistEmbeddedConfigLocally(config);
        this.renderChartOnly(config);
        this.saveEmbeddedConfigInBackground();
      },
      onExportImage: () => this.chartRenderer.exportPng(this.getChartExportFilename(config)),
      onCopyPng: () => { void this.chartRenderer.copyPng(); },
    });
  }

  private getChartExportFilename(config: ViewConfig): string {
    const dbName = this.currentDbConfig?.name || "database";
    return `${dbName}-${config.name || "chart"}`.replace(/[\\/:*?"<>|]+/g, "-");
  }

  private renderChartOnly(config: ViewConfig): void {
    if (config.viewType !== "chart") return;
    const renderConfig = this.getStatefulConfig(config);
    this.chartRenderer.render(this.containerEl, renderConfig, this.rows, config.schema.columns, {
      onFilter: (rules) => this.applyChartFilters(config, rules),
      onConfigChange: () => {
        this.persistEmbeddedConfigLocally(config);
        this.renderChartOnly(config);
        this.saveEmbeddedConfigInBackground();
      },
    });
  }

  private setEmbeddedViewType(config: ViewConfig, value: NonNullable<ViewConfig["viewType"]>): void {
    if (config.viewType === "chart" && value !== "chart") this.chartRenderer.destroy();
    this.stateStore.persist(config, this.vs(config));
    config.viewType = value;
    this.stateStore.delete(0, this.currentViewIndex);
    this.state = undefined;
  }

  private initializeEmbeddedViewTypeDefaults(config: ViewConfig, value: NonNullable<ViewConfig["viewType"]>): void {
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

  private async openFullDatabaseView(config: ViewConfig): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(DATABASE_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: DATABASE_VIEW_TYPE, active: true });
    }
    void this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof DatabaseView) {
      view.openViewReference(this.currentSourcePath, config.id);
    }
  }

  /** Invalid time-event count for embedded timeline AND calendar views. Mirrors
   *  DatabaseView.getTimelineInvalidEventCount: both view types share the scanner,
   *  which detects via timelineStartDateField || calendarStartDateField. */
  private getEmbeddedInvalidEventCount(config: ViewConfig | undefined = this.config): number | Promise<number> {
    if (!config || (config.viewType !== "timeline" && config.viewType !== "calendar")) return 0;
    const cached = this.timelineInvalidEventsScanner.getCachedOptions(this.rows, config, this.timelineInvalidRowsVersion);
    if (cached) return cached.length;
    return this.timelineInvalidEventsScanner.getOptions(this.rows, config, this.timelineInvalidRowsVersion).then((options) => options.length);
  }

  /** Read-only invalid-events fix path for embeds: codeblock shows a notice, the
   *  db_view file preview opens the full editable view. Never mutates data in place. */
  private openEmbeddedInvalidEvents(): void {
    if (this.persistMode === "codeblock") {
      new Notice(t("notice.editInFullView", { action: t("timeline.viewInvalidEvents") }));
      return;
    }
    if (this.config) void this.openFullDatabaseView(this.config);
  }

  private resolveConfig(): ViewConfig | undefined {
    const ref = this.parseEmbeddedReference();
    const entry = this.resolveDatabaseEntry(ref);
    if (!entry) return undefined;
    const db = entry.config;
    let view = this.viewIndexOverride != null
      ? db.views[this.viewIndexOverride]
      : ref.viewId
      ? db.views.find((candidate) => candidate.id === ref.viewId)
      : db.views[this.currentViewIndex] || db.views[0];
    if (!view) return undefined;
    this.currentDbConfig = db;
    this.currentSourcePath = entry.sourcePath;
    this.currentViewIndex = db.views.indexOf(view);
    return this.cloneConfig(view);
  }

  private getEmbeddedConfig(): ViewConfig | undefined {
    if (this.config) return this.config;
    const sourceConfig = this.resolveConfig();
    if (!sourceConfig) return undefined;
    this.config = sourceConfig;
    return this.config;
  }

  private cloneConfig(config: ViewConfig): ViewConfig {
    return JSON.parse(JSON.stringify(config)) as ViewConfig;
  }

  private cloneDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
    return JSON.parse(JSON.stringify(config)) as DatabaseConfig;
  }

  private parseEmbeddedOptions(): Record<string, string> {
    const options: Record<string, string> = {};
    const trimmed = this.source.trim();
    if (!trimmed.includes(":")) {
      if (trimmed) options.view = trimmed.split("\n").find(Boolean)?.trim() || "";
      return options;
    }
    for (const line of trimmed.split("\n")) {
      const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!match) continue;
      options[match[1]] = match[2].trim();
    }
    return options;
  }

  private updateFileViewWidthClass(config: ViewConfig): void {
    if (this.persistMode !== "frontmatter") return;
    this.containerEl.closest(".markdown-preview-view")
      ?.toggleClass("note-database-file-view-wide", config.displayWidth === "wide");
  }

  private clearFileViewWidthClass(): void {
    if (this.persistMode !== "frontmatter") return;
    this.containerEl.closest(".markdown-preview-view")
      ?.removeClass("note-database-file-view-wide");
  }

  private parseEmbeddedReference(): EmbeddedReference {
    if (this.persistMode === "frontmatter") {
      return { dbPath: this.sourcePath };
    }
    const options = this.parseEmbeddedOptions();
    return {
      dbId: options.dbId || options.databaseId,
      dbPath: options.dbPath || options.databasePath,
      viewId: options.viewId,
    };
  }

  private shouldHideHeaderChrome(): boolean {
    if (this.persistMode !== "codeblock") return false;
    if (this.headerChromeHiddenOverride != null) return this.headerChromeHiddenOverride;
    const options = this.parseEmbeddedOptions();
    return this.isTrueOption(options.hideHeader) ||
      this.isTrueOption(options.hideToolbar) ||
      this.isFalseOption(options.header);
  }

  private isTrueOption(value: string | undefined): boolean {
    return /^(true|yes|1)$/i.test(value || "");
  }

  private isFalseOption(value: string | undefined): boolean {
    return /^(false|no|0)$/i.test(value || "");
  }

  private getDatabaseEntries(): EmbeddedDatabaseEntry[] {
    return typeof this.databaseEntries === "function" ? this.databaseEntries() : this.databaseEntries;
  }

  private resolveDatabaseEntry(ref: EmbeddedReference): EmbeddedDatabaseEntry | undefined {
    const pending = this.pendingDatabaseOverride;
    if (ref.dbPath) {
      const normalized = normalizePath(ref.dbPath.trim());
      if (pending?.sourcePath === normalized) return pending;
      return this.getDatabaseEntries().find((entry) => entry.sourcePath === normalized);
    }
    if (ref.dbId) {
      const normalized = ref.dbId.trim();
      if (pending?.config.id === normalized) return pending;
      return this.getDatabaseEntries().find((entry) => entry.config.id === normalized);
    }
    return undefined;
  }

  private vs(config: ViewConfig): DatabaseViewState {
    const next = this.stateStore.get(0, this.currentViewIndex, config);
    if (this.state !== next) this.state = next;
    return this.state;
  }

  private getRequiredColumnKeys(config: ViewConfig): Set<string> {
    const keys = new Set<string>();
    if (config.viewType === "table") return keys;
    if (config.titleField) keys.add(config.titleField);
    const state = this.vs(config);
    const groupField = config.viewType === "board"
      ? config.boardGroupField || state.groupByField
      : state.groupByField;
    if (groupField) keys.add(groupField);
    if (config.viewType === "board" && config.boardSubgroupEnabled !== false && config.boardSubgroupField) {
      keys.add(config.boardSubgroupField);
    }
    return keys;
  }

  private renderReadOnlyCell(td: HTMLElement, row: RowData, col: ColumnDef): void {
    this.cellRenderer.renderCell(td, row, col);
    td.removeClass("db-editable-cell", "db-cell-selected", "db-cell-editing");
    td.removeAttribute("tabindex");
    const checkbox = td.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox) checkbox.disabled = true;
  }

  /** Limited column context menu for embedded view: hide, wrap, sort only */
  private showColumnContextMenu(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement, includeWidthActions = true): void {
    event.preventDefault();
    event.stopPropagation();
    const config = this.config;
    if (!config) return;
    const menu = new Menu().setUseNativeMenu(false);

    menu.addItem((item) => item
      .setTitle(t("menu.hideProperty", { name: col.label }))
      .setIcon("eye-off")
      .onClick(() => {
        this.vs(config).hiddenColumns.add(col.key);
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      })
    );
    menu.addItem((item) => item
      .setTitle(col.wrap ? t("menu.disableWrap") : t("menu.enableWrap"))
      .setIcon("wrap-text")
      .onClick(() => {
        col.wrap = !col.wrap || undefined;
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        this.saveEmbeddedConfigInBackground();
      })
    );
    if (isNumberDisplayColumn(col, config.schema.computedFields)) {
      const currentStyle = col.numberDisplayStyle ?? "plain";
      const numberStyles: { value: NumberDisplayStyle; key: string }[] = [
        { value: "plain", key: "menu.numberStylePlain" },
        { value: "rating", key: "menu.numberStyleRating" },
        { value: "progress", key: "menu.numberStyleProgress" },
        { value: "ring", key: "menu.numberStyleRing" },
      ];
      for (const { value, key } of numberStyles) {
        menu.addItem((item) => item
          .setTitle(t(key))
          .setChecked(currentStyle === value)
          .onClick(() => {
            col.numberDisplayStyle = value === "plain" ? undefined : value;
            this.persistEmbeddedConfigLocally(config);
            this.renderResults(config);
            this.saveEmbeddedConfigInBackground();
          })
        );
      }
    }
    if (includeWidthActions) {
      menu.addItem((item) => item
        .setTitle(t("menu.autoFitColumn"))
        .setIcon("ruler-dimension-line")
        .onClick(() => this.autoFitColumn(config, col))
      );
      menu.addItem((item) => item
        .setTitle(t("menu.autoFitAllColumns"))
        .setIcon("scan-line")
        .onClick(() => this.autoFitAllColumns(config))
      );
    }
    menu.addItem((item) => item
      .setTitle(t("menu.sortBy", { name: col.label }))
      .setIcon("arrow-up-down")
      .onClick(() => this.sortByColumn(col))
    );
    if (this.getColumnSortDirection(config, col)) {
      menu.addItem((item) => item
        .setTitle(t("menu.clearSort"))
        .setIcon("x")
        .onClick(() => this.clearColumnSort(config, col))
      );
    }

    if (anchorEl?.isConnected) {
      const rect = anchorEl.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    } else {
      menu.showAtMouseEvent(event);
    }
  }

  private autoFitColumn(config: ViewConfig, col: ColumnDef): void {
    config.columnWidths = { ...(config.columnWidths || {}), [col.key]: this.calculateAutoColumnWidth(col, this.rows) };
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
  }

  private autoFitAllColumns(config: ViewConfig): void {
    const nextWidths = { ...(config.columnWidths || {}) };
    for (const col of getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns)) {
      nextWidths[col.key] = this.calculateAutoColumnWidth(col, this.rows);
    }
    config.columnWidths = nextWidths;
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
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
    const value = isFileFieldKey(col.key)
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

  private sortByColumn(col: ColumnDef): void {
    const config = this.config;
    if (!config) return;
    const state = this.vs(config);
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
    this.persistEmbeddedConfigLocally(config);
    this.updateToolbarIndicators(config);
    this.renderResults(config, { viewport: "reset-top" });
    this.saveEmbeddedConfigInBackground();
  }

  private getColumnSortDirection(config: ViewConfig, col: ColumnDef): "asc" | "desc" | null {
    const state = this.vs(config);
    const rule = state.sortRules.length === 1 ? state.sortRules[0] : undefined;
    if (rule?.field === col.key) return rule.direction;
    if (state.sortRules.length === 0 && state.sortColumn === col.key) return state.sortDirection;
    return null;
  }

  private clearColumnSort(config: ViewConfig, col: ColumnDef): void {
    const state = this.vs(config);
    state.sortRules = state.sortRules.filter((rule) => rule.field !== col.key);
    if (state.sortColumn === col.key) {
      state.sortColumn = undefined;
      state.sortDirection = "asc";
    }
    this.persistEmbeddedConfigLocally(config);
    this.updateToolbarIndicators(config);
    this.renderResults(config, { viewport: "reset-top" });
    this.saveEmbeddedConfigInBackground();
  }

  private getDefaultBoardField(config: ViewConfig): string {
    return config.schema.columns.find((col) => col.type === "status" || col.type === "select")?.key ||
      config.schema.columns.find((col) => col.key === "status")?.key ||
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
    const map = new Map(groups.map((group) => [group.key, group]));
    const col = getColumnsInOrder(config).find((candidate) => candidate.key === field);
    const defaultKeys = getDefaultGroupOrder(config, field);
    if (col && defaultKeys.length > 0 && col.type === "checkbox") {
      for (const key of defaultKeys) {
        if (!map.has(key)) map.set(key, { key, rows: [], count: 0 });
      }
    }
    const sortedGroups = this.queryEngine.sortGroups(Array.from(map.values()), order);
    if (!this.hasActiveBoardSort(config)) {
      this.applyBoardCardOrder(config, field, sortedGroups);
    }
    this.applyBoardSubgroups(config, field, sortedGroups);
    return sortedGroups;
  }

  private applyBoardSubgroups(config: ViewConfig, groupField: string, groups: BoardGroup[]): void {
    const subgroupField = config.boardSubgroupEnabled !== false ? config.boardSubgroupField : undefined;
    if (!subgroupField || subgroupField === groupField) return;
    if (!config.schema.columns.some((col) => col.key === subgroupField)) return;
    for (const group of groups) {
      const subgroups = withEmptyOptionGroups(config, subgroupField, this.queryEngine.groupBy(group.rows, subgroupField, [], config.schema.columns.find((c) => c.key === subgroupField), config));
      const order = getEffectiveGroupOrder(config, subgroupField, subgroups.map((subgroup) => subgroup.key));
      group.subgroups = this.queryEngine.sortGroups(subgroups, order);
    }
  }

  private hasActiveBoardSort(config: ViewConfig): boolean {
    const state = this.vs(config);
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
    const config = this.config;
    if (!config) return;
    config.groupOrders = { ...(config.groupOrders || {}), [field]: order };
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
  }

  private updateBoardCardOrder(field: string, groupKey: string, paths: string[]): void {
    const config = this.config;
    if (!config) return;
    config.boardCardOrders = {
      ...(config.boardCardOrders || {}),
      [field]: {
        ...(config.boardCardOrders?.[field] || {}),
        [groupKey]: paths,
      },
    };
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
  }

  private moveRowToPosition(movedPath: string, beforePath?: string, afterPath?: string): void {
    const config = this.config;
    if (!config) return;
    this.ensureManualRanks(config);
    const ranks = config.manualOrder?.ranks;
    if (!ranks) return;

    const beforeRank = beforePath ? ranks[beforePath] : undefined;
    const afterRank = afterPath ? ranks[afterPath] : undefined;
    let newRank = rankBetween(beforeRank, afterRank);
    if (newRank === null) {
      const rebalanced = rebalanceRanks(ranks);
      config.manualOrder = { ...(config.manualOrder || {}), ranks: rebalanced };
      newRank = rankBetween(
        beforePath ? rebalanced[beforePath] : undefined,
        afterPath ? rebalanced[afterPath] : undefined
      );
    }
    if (!newRank || !config.manualOrder?.ranks) return;
    config.manualOrder.ranks[movedPath] = newRank;
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
  }

  private ensureManualRanks(config: ViewConfig): void {
    if (config.manualOrder?.ranks && Object.keys(config.manualOrder.ranks).length > 0) return;
    config.manualOrder = { ...(config.manualOrder || {}), ranks: generateRanks(this.rows.map((row) => row.file.path)) };
  }

  private updateBoardColumnWidth(width: number): void {
    const config = this.config;
    if (!config) return;
    config.boardColumnWidth = width;
    this.persistEmbeddedConfigLocally(config);
    this.saveEmbeddedConfigInBackground();
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
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
  }

  private expandGroup(config: ViewConfig | undefined, field: string, key: string, count: number): void {
    if (!config) return;
    setGroupExpandedCount(config, field, key, count);
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
  }

  private setGroupRowLimit(limit: number): void {
    const config = this.config;
    if (!config) return;
    config.groupRowLimit = limit > 0 ? limit : undefined;
    config.expandedGroupRows = undefined;
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config, { viewport: "reset-top" });
    this.saveEmbeddedConfigInBackground();
  }

  private updateTimelineAnchor(dateKey: string, timeMinutes?: number): void {
    const config = this.config;
    if (!config) return;
    config.timelineAnchor = dateKey;
    if (typeof timeMinutes === "number" && Number.isFinite(timeMinutes)) config.timelineAnchorTimeMinutes = timeMinutes;
    else delete config.timelineAnchorTimeMinutes;
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config, { viewport: "preserve-raw" });
    this.saveEmbeddedConfigInBackground();
  }

  private updateTimelineScale(scale: NonNullable<ViewConfig["timelineScale"]>): boolean {
    const config = this.config;
    if (!config || (config.timelineScale || "week") === scale) return false;
    if (scale === "day" && getTimelineDayNonDateTimeColumns(config).length > 0) {
      new Notice(t("timeline.dayRequiresDateTime"));
      return false;
    }
    config.timelineScale = scale;
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
    return true;
  }

  private updateCalendarScale(scale: NonNullable<ViewConfig["calendarScale"]>, anchorDateKey: string): void {
    const config = this.config;
    if (!config || (config.calendarScale || "month") === scale) return;
    config.calendarScale = scale;
    config.calendarMonth = anchorDateKey.slice(0, 7);
    config.calendarWeekStart = anchorDateKey;
    config.calendarDay = anchorDateKey;
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    this.saveEmbeddedConfigInBackground();
  }

  private updateGalleryCardSize(width: number): void {
    const config = this.config;
    if (!config) return;
    config.galleryCardSize = width;
    this.persistEmbeddedConfigLocally(config);
    this.renderViewConfigPanel(config);
    this.saveEmbeddedConfigInBackground();
  }

  private showGroupOrderPopover(config: ViewConfig): void {
    const field = this.getActiveGroupField(config);
    if (!field) {
      new Notice(t("notice.selectGroupField"));
      return;
    }
    const col = getColumnsInOrder(config).find((candidate) => candidate.key === field);
    const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], col, config));
    const keys = groups.map((group) => group.key);
    const defaultOrder = getDefaultGroupOrder(config, field);
    const knownKeys = new Set([...defaultOrder, ...keys]);
    let order = mergeGroupOrder(
      (config.groupOrders?.[field] || []).filter((key) => knownKeys.has(key)),
      defaultOrder,
      keys
    );

    this.closeGroupOrderPopover();

    const triggerBtn = this.containerEl.querySelector(".db-group-btn");
    const host = this.containerEl;
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
    // Persist every order change immediately so embedded views do not need a save step.
    const commitOrder = () => {
      config.groupOrders = { ...(config.groupOrders || {}), [field]: [...order] };
      this.persistEmbeddedConfigLocally(config);
      this.renderResults(config);
      this.saveEmbeddedConfigInBackground();
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
          attr: { type: "button" },
        });
        setIcon(upBtn, "arrow-up");
        setTooltip(upBtn, t("menu.moveUp"), { delay: 100 });
        upBtn.disabled = index === 0;
        upBtn.onclick = () => {
          if (index === 0) return;
          [order[index], order[index - 1]] = [order[index - 1], order[index]];
          renderList();
          commitOrder();
        };
        const downBtn = moveControls.createEl("button", {
          attr: { type: "button" },
        });
        setIcon(downBtn, "arrow-down");
        setTooltip(downBtn, t("menu.moveDown"), { delay: 100 });
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

  private setGroupOrderMode(config: ViewConfig, mode: GroupOrderMode): void {
    const field = this.getActiveGroupField(config);
    if (!field) return;
    const groups = withEmptyOptionGroups(config, field, this.queryEngine.groupBy(this.rows, field, [], config.schema.columns.find((c) => c.key === field), config));
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
    config.groupOrders = { ...(config.groupOrders || {}), [field]: order };
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config, { viewport: "reset-top" });
    this.saveEmbeddedConfigInBackground();
  }

  private getActiveGroupField(config: ViewConfig): string {
    return config.viewType === "board"
      ? config.boardGroupField || this.vs(config).groupByField || this.getDefaultBoardField(config)
      : this.vs(config).groupByField;
  }

  private toNumericGroupValue(value: string): number {
    const n = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  }

  private toDateGroupValue(value: string): number {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  }

  private async updateBoardGroup(row: RowData, field: string, value: string): Promise<void> {
    new Notice(t("notice.embedReadonly", { action: t("notice.editEntry") }));
  }

  private async deleteRow(row: RowData): Promise<void> {
    new Notice(t("notice.embedReadonly", { action: t("notice.deleteEntry") }));
  }

  private async createBlankEntry(defaults: Record<string, unknown> = {}): Promise<void> {
    new Notice(t("notice.embedReadonly", { action: t("notice.createEntry") }));
  }

  private async refreshAfterSave(): Promise<void> {
    if (this.config) this.renderResults(this.config);
  }

  private getDefaultFrontmatterFromSourceRules(config: ViewConfig): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {};
    const tags = new Set<string>();
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
    const type = config.schema.columns.find((column) => column.key === field)?.type;
    return type !== "computed" && type !== "rollup";
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
    return normalizePath(mostSpecificFolder || this.defaultRecordFolder || "");
  }

  /** Empty sourceFolder means vault root for querying; defaultRecordFolder is only the create fallback. */
  private getEffectiveConfig(config: ViewConfig): DatabaseConfig {
    // Build a DatabaseConfig from the view config for DataSource queries
    const dbSourceFolder = this.currentDbConfig?.sourceFolder || "";
    const dbSourceRules = this.currentDbConfig?.sourceRules;
    const dbSourceLogic = this.currentDbConfig?.sourceLogic;
    const dbSourceRuleTree = this.currentDbConfig?.sourceRuleTree;
    // View-level source rules apply only when the switch is ON; each side is normalized to a tree
    // first so a legacy flat side is never dropped (mergeDbAndViewSourceRuleTrees).
    const viewEnabled = config.viewSourceRulesEnabled === true;
    const db: DatabaseConfig = {
      id: "embedded",
      name: config.name,
      baseThisFilePath: this.sourcePath,
      sourceFolder: this.normalizeVaultFolder(dbSourceFolder || config.sourceFolder || ""),
      sourceRules: dbSourceRules || (viewEnabled ? config.sourceRules : undefined),
      sourceLogic: dbSourceLogic || (viewEnabled ? config.sourceLogic : undefined),
      sourceRuleTree: mergeDbAndViewSourceRuleTrees(
        { sourceRuleTree: dbSourceRuleTree, sourceRules: dbSourceRules, sourceLogic: dbSourceLogic },
        viewEnabled ? config : undefined
      ),
      newRecordFolder: config.newRecordFolder || this.currentDbConfig?.newRecordFolder,
      schema: config.schema,
      views: [config],
    };
    return db;
  }

  private withBaseThisContext(config: ViewConfig): ViewConfig {
    return {
      ...config,
      baseThisFilePath: this.sourcePath,
    };
  }

  /** Show relative paths only when duplicate filenames would otherwise be ambiguous. */
  private getFileDisplayName(row: RowData): string {
    const info = this.getFileTitleInfo(row);
    return info.hasDuplicateName ? info.displayPath : info.name;
  }

  /** Build structured file title pieces for readonly and editable embedded renderers. */
  private getFileTitleInfo(row: RowData): FileTitleDisplay {
    return getFileTitleDisplay(row, this.rows);
  }

  /** Treat empty or "/" as the vault root and keep stored paths vault-relative. */
  private normalizeVaultFolder(folderPath: string): string {
    const normalized = normalizePath(folderPath || "");
    return normalized === "/" ? "" : normalized.replace(/^\/+/, "");
  }

  private toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void {
    this.lastSelectedRowPath = applyRangeSelection({
      orderedIds: this.getOrderedSelectionRowPaths(),
      selectedIds: this.selectedRows,
      anchorId: this.lastSelectedRowPath,
      targetId: row.file.path,
      selected,
      range: Boolean(event?.shiftKey || this.isPhoneLayout()),
    });
    if (this.config) this.renderResults(this.config);
  }

  private toggleRowsSelected(rows: RowData[], selected: boolean): void {
    for (const row of rows) {
      if (selected) this.selectedRows.add(row.file.path);
      else this.selectedRows.delete(row.file.path);
    }
    this.lastSelectedRowPath = this.selectedRows.size > 0 ? rows[rows.length - 1]?.file.path || this.lastSelectedRowPath : null;
    if (this.config) this.renderResults(this.config);
  }

  private getOrderedSelectionRowPaths(): string[] {
    const ordered = this.getRenderedSelectionRows();
    const source = ordered.length > 0 ? ordered : this.rows;
    return source.map((candidate) => candidate.file.path);
  }

  private getRenderedSelectionRows(): RowData[] {
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const seen = new Set<string>();
    const selectors = [
      "tr[data-note-database-row-path]",
      ".db-board-card[data-note-database-row-path]",
      ".db-gallery-card[data-note-database-row-path]",
      ".db-list-row[data-note-database-row-path]",
    ];
    const rows: RowData[] = [];
    for (const element of Array.from(this.containerEl.querySelectorAll<HTMLElement>(selectors.join(",")))) {
      const path = element.dataset.noteDatabaseRowPath;
      if (!path || seen.has(path)) continue;
      const renderedRow = rowByPath.get(path);
      if (!renderedRow) continue;
      seen.add(path);
      rows.push(renderedRow);
    }
    return rows;
  }

  private async deleteSelectedRows(): Promise<void> {
    if (this.selectedRows.size > 0) {
      new Notice(t("notice.embedReadonly", { action: t("notice.deleteEntry") }));
    }
    this.selectedRows.clear();
    this.lastSelectedRowPath = null;
  }

  private scheduleComputedSync(config: ViewConfig, rows: RowData[]): void {
    this.clearComputedSyncTimer();
    if (this.persistMode === "codeblock") return;
    if (!this.isAutomaticComputedSync() || config.schema.computedFields.length === 0) return;
    this.computedSyncTimer = this.getRefreshWindow().setTimeout(() => {
      this.computedSyncTimer = null;
      this.syncComputedFieldsInBackground(config, rows);
    }, 5000);
  }

  private clearComputedSyncTimer(): void {
    if (this.computedSyncTimer === null) return;
    this.getRefreshWindow().clearTimeout(this.computedSyncTimer);
    this.computedSyncTimer = null;
  }

  private async syncComputedForFile(
    file: TFile,
    frontmatter: Record<string, unknown>,
    config: ViewConfig,
    affectedFields?: string[]
  ): Promise<void> {
    if (this.persistMode === "codeblock") return;
    if (!config.schema.computedFields.length || !this.isAutomaticComputedSync()) return;

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
      await this.dataSource.updateFrontmatter(file, updates, { sourceInstanceId: this.instanceId });
    }
  }

  private async syncComputedFields(config: ViewConfig, rows: RowData[], notify = false, force = false): Promise<void> {
    if (this.persistMode === "codeblock") {
      if (notify) new Notice(t("notice.embedReadonly", { action: t("viewConfig.saveComputedResults") }));
      return;
    }
    if ((!force && !this.isAutomaticComputedSync()) || this.syncingComputed) return;
    this.syncingComputed = true;
    try {
      const computedColumns = config.schema.columns.filter((col) => col.type === "computed");
      let changed = 0;
      for (const row of rows) {
        const updates: Record<string, unknown> = {};
        for (const col of computedColumns) {
          const key = getComputedStorageKey(col);
          const value = row.computed[key];
          const next = value == null ? "" : value;
          if (safeString(row.frontmatter[key]) !== safeString(next)) updates[key] = next;
        }
        if (Object.keys(updates).length > 0) {
          await this.dataSource.updateFrontmatter(row.file, updates, { sourceInstanceId: this.instanceId });
          changed += 1;
        }
      }
      if (notify) new Notice(t("notice.syncedFormulas", { count: changed }));
    } finally {
      this.syncingComputed = false;
      this.suppressDataReload(500);
      if (this.pendingDataChange) {
        this.pendingDataChange = false;
        this.render();
      }
    }
  }

  private syncComputedFieldsInBackground(config: ViewConfig, rows: RowData[], notify = false, force = false): void {
    void this.syncComputedFields(config, rows, notify, force).catch((err) => {
      console.error("Note Database: failed to sync embedded computed fields", err);
      new Notice(t("errors.updateFailed", { error: String(err) }));
    });
  }

  private isAutomaticComputedSync(): boolean {
    return normalizeComputedSyncMode(this.currentDbConfig?.computedSyncMode) === "automatic";
  }

  private getBaseComputedEvaluationContext(file: TFile, config?: ViewConfig): {
    app: App;
    file: TFile;
    thisFile?: TFile;
    thisFrontmatter?: Record<string, unknown>;
  } {
    const sourcePath = config?.baseThisFilePath || this.sourcePath;
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

  private persistEmbeddedConfigLocally(config = this.config): void {
    if (!config) return;
    const before = this.persistMode === "frontmatter" && this.currentDbConfig
      ? this.cloneDatabaseConfig(this.currentDbConfig)
      : undefined;
    this.stateStore.persist(config, this.vs(config));
    this.copyConfigToSourceView();
    if (before && this.currentDbConfig && JSON.stringify(before) !== JSON.stringify(this.currentDbConfig)) {
      this.configHistoryStack.unshift(before);
      if (this.configHistoryStack.length > 15) this.configHistoryStack.length = 15;
    }
  }

  private updateToolbarIndicators(config = this.config): void {
    if (!config) return;
    const state = this.vs(config);
    const filterBtn = this.containerEl.querySelector(".db-filter-btn");
    if (isHTMLElement(filterBtn)) this.updateToolbarBadge(filterBtn, getEffectiveFilterRules(state.filters).length);
    const sortBtn = this.containerEl.querySelector(".db-sort-btn");
    if (isHTMLElement(sortBtn)) {
      const count = state.sortRules.filter((rule) => rule.field && rule.direction).length ||
        (state.sortColumn ? 1 : 0);
      this.updateToolbarBadge(sortBtn, count);
    }
    const colBtn = this.containerEl.querySelector(".db-col-manager-btn");
    if (isHTMLElement(colBtn)) this.updateToolbarBadge(colBtn, Math.max(0, (config.schema.columns.length || 0) - state.hiddenColumns.size));
    const groupBtn = this.containerEl.querySelector(".db-group-btn");
    if (isHTMLElement(groupBtn)) {
      const groupValue = config.viewType === "board"
        ? config.boardGroupField || state.groupByField
        : state.groupByField;
      groupBtn.toggleClass("is-active", Boolean(groupValue));
    }
  }

  private normalizeBoardSubgroupAfterGroupChange(config: ViewConfig, groupField: string): void {
    if (config.boardSubgroupField === groupField) config.boardSubgroupField = undefined;
  }

  private updateToolbarBadge(button: HTMLElement, count: number): void {
    button.querySelector(".db-toolbar-badge")?.remove();
    if (count <= 0) return;
    button.createSpan({ cls: "db-toolbar-badge", text: String(count) });
  }

  private persistEmbeddedConfigToSource(): void {
    if (!this.config) return;
    this.persistEmbeddedConfigLocally(this.config);
    this.updateToolbarIndicators(this.config);
    this.saveEmbeddedConfigInBackground();
  }

  private saveEmbeddedConfigInBackground(mutationOverride?: ViewConfigMutation): void {
    void this.saveEmbeddedConfigToSource(mutationOverride).catch((err) => {
      console.error("Note Database: failed to save embedded view config", err);
      new Notice(t("errors.saveViewConfigFailed", { error: String(err) }));
    });
  }

  private async saveEmbeddedConfigToSource(mutationOverride?: ViewConfigMutation): Promise<void> {
    if (!this.config) return;
    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!(file instanceof TFile)) return;
    if (this.persistMode === "frontmatter") {
      await this.saveResolvedDatabaseConfig(file, mutationOverride);
      return;
    }
    if (this.currentSourcePath) {
      const dbFile = this.app.vault.getAbstractFileByPath(this.currentSourcePath);
      if (dbFile instanceof TFile) {
        await this.saveResolvedDatabaseConfig(dbFile, mutationOverride);
        return;
      }
    }
    if (this.currentDbConfig) {
      this.copyConfigToSourceView();
      await this.onConfigChanged();
      const mutation = mutationOverride || this.getCurrentMutationTarget();
      if (mutation) this.dataSource.notifyViewConfigChanged({ ...mutation, database: this.currentDbConfig });
    }
  }

  async undoLastConfigEdit(): Promise<void> {
    const previous = this.configHistoryStack[0];
    if (!previous || !this.currentSourcePath) {
      new Notice(t("notice.nothingToUndo"));
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.currentSourcePath);
    if (!(file instanceof TFile)) return;
    const current = this.currentDbConfig ? this.cloneDatabaseConfig(this.currentDbConfig) : undefined;
    this.pendingDatabaseOverride = { config: previous, sourcePath: this.currentSourcePath };
    this.currentDbConfig = previous;
    this.config = undefined;
    this.state = undefined;
    this.stateStore.clear();
    try {
      await this.dataSource.updateViewDefFile(file, previous, this.getCurrentDatabaseMutationTarget());
      this.configHistoryStack.shift();
      const nextConfig = this.getEmbeddedConfig();
      if (nextConfig) this.render(undefined);
      this.containerEl.querySelectorAll(".db-cell-option-popover").forEach((el) => el.remove());
      new Notice(t("notice.undone", { action: t("undo.viewConfig") }));
    } catch (err) {
      console.error("Note Database: failed to undo embedded config", err);
      if (current) {
        this.pendingDatabaseOverride = { config: current, sourcePath: this.currentSourcePath };
        this.currentDbConfig = current;
        this.config = undefined;
        this.state = undefined;
        this.stateStore.clear();
        const nextConfig = this.getEmbeddedConfig();
        if (nextConfig) this.render(undefined);
      }
      new Notice(t("errors.updateFailed", { error: String(err) }));
    }
  }

  private async saveCodeBlockReference(config: ViewConfig): Promise<void> {
    if (this.persistMode !== "codeblock") return;
    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (!(file instanceof TFile)) return;
    const section = this.getSectionInfo();
    if (!section) return;
    const language = section.text.match(/^```(\S+)/)?.[1] || "note-database";
    const replacement = `\`\`\`${language}\n${this.serializeCodeBlockReference(config)}\n\`\`\``;
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    lines.splice(section.lineStart, section.lineEnd - section.lineStart + 1, replacement);
    this.suppressDataReload(2500);
    this.dataSource.markPluginWrite(file.path, this.instanceId);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private saveCodeBlockReferenceInBackground(config: ViewConfig): void {
    void this.saveCodeBlockReference(config).catch((err) => {
      console.error("Note Database: failed to save embedded code block reference", err);
      new Notice(t("errors.updateFailed", { error: String(err) }));
    });
  }

  private serializeCodeBlockReference(config: ViewConfig): string {
    const lines: string[] = [];
    // Prefer the stable database id over the source path so the embed survives
    // the database file being moved or renamed. currentDbConfig.id is persisted
    // to frontmatter (DataSource backfills it when missing), so it is reliable.
    if (this.currentDbConfig?.id) {
      lines.push(`dbId: ${this.currentDbConfig.id}`);
    }
    if (config.id) lines.push(`viewId: ${config.id}`);
    if (this.shouldHideHeaderChrome()) lines.push("hideHeader: true");
    return lines.join("\n");
  }

  private async copyEmbeddedViewCode(config: ViewConfig): Promise<void> {
    const reference = this.serializeCodeBlockReference(config);
    if (!reference) {
      new Notice(t("notice.noDbCopyInfo"));
      return;
    }
    const code = ["```note-database", reference, "```"].join("\n");
    try {
      await navigator.clipboard.writeText(code);
      new Notice(t("notice.copiedEmbedCode"));
    } catch (err) {
      console.error("Note Database: failed to copy embedded view code", err);
      new Notice(t("errors.copyFailed", { error: String(err) }));
    }
  }

  private exportData(config: ViewConfig, format: "csv" | "markdown"): void {
    if (this.rows.length === 0) {
      new Notice(t("errors.noDataExport"));
      return;
    }
    const visibleColumns = getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns);
    if (visibleColumns.length === 0) {
      new Notice(t("errors.noVisibleColumns"));
      return;
    }

    const getCellValue = (row: RowData, col: ColumnDef): string => {
      const value = isFileFieldKey(col.key)
        ? getRowFileFieldValue(row, col.key)
        : col.type === "computed" || col.type === "rollup"
          ? row.computed[col.type === "computed" ? col.computedKey || col.key : col.key]
          : row.frontmatter[col.key];
      if (value == null || value === "") return "";
      if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, value).join(", ");
      if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
      if (typeof value === "boolean") return value ? "✓" : "";
      return safeString(value);
    };

    let content: string;
    if (format === "csv") {
      const headers = visibleColumns.map((col) => `"${col.label.replace(/"/g, '""')}"`);
      const dataRows = this.rows.map((row) =>
        visibleColumns.map((col) => `"${getCellValue(row, col).replace(/"/g, '""')}"`).join(",")
      );
      content = [headers.join(","), ...dataRows].join("\n");
    } else {
      const headers = visibleColumns.map((col) => col.label);
      const separator = visibleColumns.map(() => "---");
      const dataRows = this.rows.map((row) =>
        visibleColumns.map((col) => getCellValue(row, col).replace(/\|/g, "\\|"))
      );
      content = [
        `| ${headers.join(" | ")} |`,
        `| ${separator.join(" | ")} |`,
        ...dataRows.map((row) => `| ${row.join(" | ")} |`),
      ].join("\n");
    }

    navigator.clipboard.writeText(content).then(() => {
      new Notice(t("notice.copiedExport", { format: format === "csv" ? "CSV" : "Markdown", count: this.rows.length }));
    }).catch((err) => {
      console.error("Note Database: failed to export embedded data", err);
      new Notice(t("errors.clipboardFailed"));
    });
  }

  private async exportCsvMarkdownZip(): Promise<void> {
    const config = this.config || this.getEmbeddedConfig();
    if (!config || !this.currentDbConfig) return;
    const dbConfig = this.currentDbConfig;
    const options = await new CsvMarkdownExportModal(this.app).openAndWait();
    if (!options) return;
    const getExportCellValue = (row: RowData, col: ColumnDef): string => {
      const value = isFileFieldKey(col.key)
        ? getRowFileFieldValue(row, col.key)
        : col.type === "computed" || col.type === "rollup"
          ? row.computed[col.type === "computed" ? col.computedKey || col.key : col.key]
          : row.frontmatter[col.key];
      if (value == null || value === "") return "";
      if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, value).join(", ");
      if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
      return safeString(value);
    };
    await createCsvMarkdownZip(
      this.app,
      dbConfig,
      config,
      this.rows,
      (index) => this.getRowsForExportView(dbConfig, index),
      (view) => {
        const index = dbConfig.views.indexOf(view);
        const rows = this.getRowsForExportView(dbConfig, index);
        const state = this.stateStore.get(0, index, view);
        return getVisibleColumns(view, rows, state, this.pendingShowColumns);
      },
      getExportCellValue,
      "",
      options,
    );
  }

  /** Build the correct filtered and sorted row set for each CSV included in an embedded ZIP export. */
  private buildRowsWithRelations(
    records: NoteRecord[],
    view: ViewConfig,
    state: DatabaseViewState,
    database: DatabaseConfig | null | undefined,
    cacheTargets = false,
  ): RowData[] {
    let derived: Map<string, Record<string, unknown>> | undefined;
    if (database?.schema.columns.some((column) => column.type === "rollup")) {
      const entries = this.getDatabaseEntries();
      const databases = entries.map((entry) => entry.config);
      if (!databases.some((candidate) => candidate.id === database.id)) databases.push(database);
      const result = buildRelationRollups({
        app: this.app,
        sourceRecords: records,
        sourceDatabase: database,
        databases,
        getRecordsForDatabase: (target) => this.dataSource.getRecordsForDatabase(target),
      });
      derived = result.valuesByPath;
      if (cacheTargets) {
        this.relationTargetPaths = result.targetPaths;
        const targetIds = new Set(
          database.schema.columns
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

  private getRowsForExportView(dbConfig: DatabaseConfig, viewIndex: number): RowData[] {
    const sourceView = dbConfig.views[viewIndex];
    if (!sourceView) return [];
    const view = this.cloneConfig(sourceView);
    const records = this.dataSource.getRecordsForConfig(this.getEffectiveConfig(view));
    return this.buildRowsWithRelations(records, view, this.stateStore.get(0, viewIndex, view), dbConfig);
  }

  private moveView(fromIndex: number, toIndex: number): void {
    if (!this.currentDbConfig || fromIndex === toIndex) return;
    const views = this.currentDbConfig.views;
    if (fromIndex < 0 || fromIndex >= views.length || toIndex < 0 || toIndex >= views.length) return;
    const [view] = views.splice(fromIndex, 1);
    views.splice(toIndex, 0, view);
    this.currentViewIndex = this.getMovedIndex(this.currentViewIndex, fromIndex, toIndex);
    this.viewIndexOverride = this.currentViewIndex;
    this.config = undefined;
    const nextConfig = this.getEmbeddedConfig();
    if (!nextConfig) return;
    this.rerenderToolbar(nextConfig);
    this.renderResults(nextConfig);
    this.saveEmbeddedConfigInBackground(this.getCurrentDatabaseMutationTarget());
    this.saveCodeBlockReferenceInBackground(nextConfig);
  }

  private getMovedIndex(current: number, from: number, to: number): number {
    if (current === from) return to;
    if (from < current && to >= current) return current - 1;
    if (from > current && to <= current) return current + 1;
    return current;
  }

  private async saveResolvedDatabaseConfig(file: TFile, mutationOverride?: ViewConfigMutation): Promise<void> {
    if (!this.config || !this.currentDbConfig) return;
    this.suppressDataReload(2500);
    this.copyConfigToSourceView();
    await this.dataSource.updateViewDefFile(file, this.currentDbConfig, mutationOverride || this.getCurrentMutationTarget());
  }

  private copyConfigToSourceView(): void {
    if (!this.config || !this.currentDbConfig) return;
    const origView = this.currentDbConfig.views[this.currentViewIndex];
    if (!origView) return;
    origView.viewType = this.config.viewType;
    origView.displayWidth = this.config.displayWidth;
    origView.boardColumnWidth = this.config.boardColumnWidth;
    origView.boardGroupField = this.config.boardGroupField;
    origView.boardSubgroupEnabled = this.config.boardSubgroupEnabled;
    origView.boardSubgroupField = this.config.boardSubgroupField;
    origView.defaultColumnWidth = this.config.defaultColumnWidth;
    origView.groupOrders = this.config.groupOrders;
    origView.showEmptyGroups = this.config.showEmptyGroups;
    origView.collapsedGroups = this.config.collapsedGroups;
    origView.boardCardOrders = this.config.boardCardOrders;
    origView.manualOrder = this.config.manualOrder;
    origView.galleryImageField = this.config.galleryImageField;
    origView.titleField = this.config.titleField;
    origView.galleryImageAspectRatio = this.config.galleryImageAspectRatio;
    origView.galleryCardSize = this.config.galleryCardSize;
    origView.galleryImageFit = this.config.galleryImageFit;
    origView.chartType = this.config.chartType;
    origView.chartGroupField = this.config.chartGroupField;
    origView.chartDateBucket = this.config.chartDateBucket;
    origView.chartNumberBucket = this.config.chartNumberBucket;
    origView.chartNumberBucketSize = this.config.chartNumberBucketSize;
    origView.chartStackField = this.config.chartStackField;
    origView.chartSeriesField = this.config.chartSeriesField;
    origView.chartAggregation = this.config.chartAggregation;
    origView.chartValueField = this.config.chartValueField;
    origView.chartSecondaryAggregation = this.config.chartSecondaryAggregation;
    origView.chartSecondaryValueField = this.config.chartSecondaryValueField;
    origView.chartColorPalette = this.config.chartColorPalette;
    origView.chartColorByValue = this.config.chartColorByValue;
    origView.chartValueAxisRange = this.config.chartValueAxisRange;
    origView.chartValueAxisMin = this.config.chartValueAxisMin;
    origView.chartValueAxisMax = this.config.chartValueAxisMax;
    origView.chartReferenceLines = this.config.chartReferenceLines;
    origView.calendarMonth = this.config.calendarMonth;
    origView.calendarStartDateField = this.config.calendarStartDateField;
    origView.calendarEndDateField = this.config.calendarEndDateField;
    origView.calendarTitleField = this.config.calendarTitleField;
    origView.calendarColorField = this.config.calendarColorField;
    origView.calendarCellMinHeight = this.config.calendarCellMinHeight;
    origView.calendarKeepCellAspectRatio = this.config.calendarKeepCellAspectRatio;
    origView.calendarScale = this.config.calendarScale;
    origView.calendarDay = this.config.calendarDay;
    origView.calendarStartHour = this.config.calendarStartHour;
    origView.calendarEndHour = this.config.calendarEndHour;
    origView.calendarHourHeight = this.config.calendarHourHeight;
    origView.calendarWeekSlotDuration = this.config.calendarWeekSlotDuration;
    origView.calendarColumnSizeMode = this.config.calendarColumnSizeMode;
    origView.calendarCustomColumnWidth = this.config.calendarCustomColumnWidth;
    origView.calendarRowSizeMode = this.config.calendarRowSizeMode;
    origView.calendarCustomRowHeights = this.config.calendarCustomRowHeights;
    origView.calendarWeekStart = this.config.calendarWeekStart;
    origView.calendarAllDayMaxLanes = this.config.calendarAllDayMaxLanes;
    origView.calendarFirstDayOfWeek = this.config.calendarFirstDayOfWeek;
    origView.yearDisplayMode = this.config.yearDisplayMode;
    origView.calendarMonthVisibleLanes = this.config.calendarMonthVisibleLanes;
    origView.timelineStartDateField = this.config.timelineStartDateField;
    origView.timelineEndDateField = this.config.timelineEndDateField;
    origView.timelineGroupField = this.config.timelineGroupField;
    origView.timelineTitleField = this.config.timelineTitleField;
    origView.timelineColorField = this.config.timelineColorField;
    origView.timelineScale = this.config.timelineScale;
    origView.timelineAnchor = this.config.timelineAnchor;
    origView.timelineAnchorTimeMinutes = this.config.timelineAnchorTimeMinutes;
    origView.timelineColumnSizeMode = this.config.timelineColumnSizeMode;
    origView.timelineCustomUnitWidth = this.config.timelineCustomUnitWidth;
    origView.showEmptyFields = this.config.showEmptyFields;
    origView.columnOrder = this.config.columnOrder;
    origView.columnWidths = this.config.columnWidths;
    origView.hiddenColumns = this.config.hiddenColumns;
    origView.filters = this.config.filters;
    origView.filterLogic = this.config.filterLogic;
    origView.sortRules = this.config.sortRules;
    origView.groupByField = this.config.groupByField;
    origView.viewStates = this.config.viewStates;
    origView.sourceRules = this.config.sourceRules;
    origView.sourceLogic = this.config.sourceLogic;
    origView.sourceRuleTree = this.config.sourceRuleTree;
    origView.viewSourceRulesEnabled = this.config.viewSourceRulesEnabled;
    for (const col of this.config.schema.columns) {
      const sourceCol = this.currentDbConfig.schema.columns.find((candidate) => candidate.key === col.key);
      if (!sourceCol) continue;
      sourceCol.wrap = col.wrap;
      sourceCol.numberDisplayStyle = col.numberDisplayStyle;
    }
    this.stateStore.persist(origView, this.vs(this.config));
  }

  // ── Cell selection & clipboard (embedded views) ──

  private handleEmbedKeydown(event: KeyboardEvent): void {
    if (!this.containerEl.isConnected) return;
    const target = event.target;
    const eventTarget = isHTMLElement(target) ? target : null;
    const isEditing = eventTarget?.closest("input, textarea, select, .db-cell-editing, .modal") != null;
    if (isEditing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && this.cellSelection) {
      event.preventDefault();
      void this.copySelectedEmbedCells("tsv");
      return;
    }
    if (event.key === "Escape" && this.cellSelection) {
      event.preventDefault();
      this.clearEmbedCellSelection();
    }
  }

  private async copySelectedEmbedCells(format: "tsv" | "markdown" | "csv" = "tsv"): Promise<void> {
    const selected = this.getSelectedEmbedCellAddresses();
    if (selected.length === 0) return;
    if (!this.config) return;
    // Derive row/column order from the actual table DOM for accuracy
    const rowPaths = this.getEmbedTableRowPaths();
    const colKeys = this.getEmbedTableColKeys();
    const rowByPath = new Map(this.rows.map((row) => [row.file.path, row]));
    const colByKey = new Map(this.config.schema.columns.map((col) => [col.key, col]));
    const content = serializeSelectedCells(format, selected, rowPaths, colKeys, rowByPath, colByKey, getCellDisplayText);
    await navigator.clipboard.writeText(content);
    new Notice(t("notice.copiedCells", { count: selected.length }));
  }

  /** Get row paths in the order they appear in the rendered table DOM */
  private getEmbedTableRowPaths(): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();
    this.containerEl.querySelectorAll<HTMLElement>("tr[data-note-database-row-path]").forEach((tr) => {
      const path = tr.dataset.noteDatabaseRowPath;
      if (!path || seen.has(path)) return;
      seen.add(path);
      paths.push(path);
    });
    return paths.length > 0 ? paths : this.rows.map((row) => row.file.path);
  }

  /** Get column keys in the order they appear in the rendered table thead */
  private getEmbedTableColKeys(): string[] {
    const firstRow = this.containerEl.querySelector<HTMLElement>(".db-table tbody tr[data-note-database-row-path]");
    if (firstRow) {
      const seen = new Set<string>();
      return Array.from(firstRow.children)
        .filter((cell): cell is HTMLElement => cell.instanceOf(HTMLElement) && cell.matches("td[data-note-database-column-key]"))
        .map((cell) => cell.dataset.noteDatabaseColumnKey)
        .filter((key): key is string => {
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }
    if (!this.config) return [];
    return getVisibleColumns(this.config, this.rows, this.vs(this.config), this.pendingShowColumns).map((col) => col.key);
  }

  private setupEmbedCellSelection(td: HTMLElement, row: RowData, col: ColumnDef): void {
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (!this.config) return;
      event.preventDefault(); // prevent browser text selection during drag
      const addr: CellAddress = { rowPath: row.file.path, colKey: col.key };
      if (this.isPhoneLayout()) {
        if (this.cellSelection) {
          this.cellSelection = { anchor: this.cellSelection.anchor, focus: addr };
        } else {
          this.cellSelection = { anchor: addr, focus: addr };
        }
        this.isSelectingCells = false;
        this.renderEmbedSelectionStatusBar();
        this.renderEmbedCellSelectionClasses();
        return;
      }
      if (event.shiftKey && this.cellSelection) {
        this.cellSelection = { anchor: this.cellSelection.anchor, focus: addr };
      } else {
        this.cellSelection = { anchor: addr, focus: addr };
      }
      this.isSelectingCells = true;
      this.renderEmbedSelectionStatusBar();
      this.renderEmbedCellSelectionClasses();
    };

    const handleMouseEnter = () => {
      if (!this.isSelectingCells || !this.cellSelection) return;
      const addr: CellAddress = { rowPath: row.file.path, colKey: col.key };
      this.cellSelection = { anchor: this.cellSelection.anchor, focus: addr };
      this.renderEmbedSelectionStatusBar();
      this.renderEmbedCellSelectionClasses();
    };

    td.addEventListener("mousedown", handleMouseDown);
    td.addEventListener("mouseenter", handleMouseEnter);
  }

  private isPhoneLayout(): boolean {
    return window.activeDocument.body.classList.contains("is-phone");
  }

  private getSelectedEmbedCellAddresses(): CellAddress[] {
    if (!this.cellSelection || !this.config) return [];
    const rowPaths = this.getEmbedTableRowPaths();
    const colKeys = this.getEmbedTableColKeys();
    const { anchor, focus } = this.cellSelection;
    const anchorRow = rowPaths.indexOf(anchor.rowPath);
    const anchorCol = colKeys.indexOf(anchor.colKey);
    const focusRow = rowPaths.indexOf(focus.rowPath);
    const focusCol = colKeys.indexOf(focus.colKey);
    if (anchorRow < 0 || anchorCol < 0 || focusRow < 0 || focusCol < 0) return [];
    const rowStart = Math.min(anchorRow, focusRow);
    const rowEnd = Math.max(anchorRow, focusRow);
    const colStart = Math.min(anchorCol, focusCol);
    const colEnd = Math.max(anchorCol, focusCol);
    const addrs: CellAddress[] = [];
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        addrs.push({ rowPath: rowPaths[r], colKey: colKeys[c] });
      }
    }
    return addrs;
  }

  private isEmbedCellSelected(rowPath: string, colKey: string): boolean {
    if (!this.cellSelection) return false;
    const addrs = this.getSelectedEmbedCellAddresses();
    return addrs.some((addr) => addr.rowPath === rowPath && addr.colKey === colKey);
  }

  private clearEmbedCellSelection(): void {
    this.cellSelection = null;
    this.isSelectingCells = false;
    this.renderEmbedCellSelectionClasses();
    this.renderEmbedSelectionStatusBar();
  }

  private renderEmbedCellSelectionClasses(): void {
    const selected = new Set(this.getSelectedEmbedCellAddresses().map((addr) => `${addr.rowPath}\u0000${addr.colKey}`));
    this.containerEl.querySelectorAll<HTMLElement>("td[data-note-database-row-path][data-note-database-column-key]").forEach((cell) => {
      const rowPath = cell.dataset.noteDatabaseRowPath;
      const colKey = cell.dataset.noteDatabaseColumnKey;
      cell.toggleClass("db-cell-range-selected", Boolean(rowPath && colKey && selected.has(`${rowPath}\u0000${colKey}`)));
    });
  }

  /** Render a full Dashboard-style selection status bar.
   *  Paste/fill/clear/undo buttons are rendered but hidden via CSS (.note-database-embed .db-embed-hide).
   *  Only copy actions are wired up. */
  private renderEmbedSelectionStatusBar(): void {
    this.containerEl.querySelectorAll(".db-selection-status-bar").forEach((el) => el.remove());
    this.containerEl.toggleClass("has-selection-status", !!this.cellSelection);
    if (!this.cellSelection) return;
    const config = this.config || this.getEmbeddedConfig();
    if (!config || config.viewType !== "table") return;
    const cellCount = this.getSelectedEmbedCellAddresses().length;
    if (cellCount === 0) return;
    const bar = this.containerEl.createDiv({ cls: "db-selection-status-bar" });

    // Clear selection checkbox (matches Dashboard)
    const checkbox = bar.createEl("input", {
      cls: "db-selection-clear-checkbox",
      attr: { type: "checkbox", title: t("toolbar.selectedCells", { count: cellCount }) },
    });
    checkbox.checked = true;
    checkbox.onchange = () => { if (!checkbox.checked) this.clearEmbedCellSelection(); };

    // Count text
    bar.createSpan({ cls: "db-selection-count", text: t("toolbar.selectedCells", { count: cellCount }) });

    // Copy buttons (same structure as Dashboard)
    const copyTsvBtn = bar.createEl("button", { cls: "db-selection-action", text: t("selection.copyTsv"), attr: { type: "button" } });
    copyTsvBtn.onclick = () => { void this.copySelectedEmbedCells("tsv"); };
    const copyMdBtn = bar.createEl("button", { cls: "db-selection-action", text: t("selection.copyMarkdown"), attr: { type: "button" } });
    copyMdBtn.onclick = () => { void this.copySelectedEmbedCells("markdown"); };
    const copyCsvBtn = bar.createEl("button", { cls: "db-selection-action", text: t("selection.copyCsv"), attr: { type: "button" } });
    copyCsvBtn.onclick = () => { void this.copySelectedEmbedCells("csv"); };

    // Edit-only buttons — rendered but hidden in embedded view via CSS
    bar.createEl("button", { cls: "db-selection-action db-embed-hide", text: t("selection.pasteCells"), attr: { type: "button" } });
    bar.createEl("button", { cls: "db-selection-action db-embed-hide", text: t("selection.fillValue"), attr: { type: "button" } });
    bar.createEl("button", { cls: "db-selection-delete db-embed-hide", text: t("selection.clearCells"), attr: { type: "button" } });

    const summary = this.containerEl.querySelector(".db-summary");
    if (summary) {
      summary.before(bar);
    } else {
      const tableWrap = this.containerEl.querySelector(".db-table-wrap");
      if (tableWrap) tableWrap.before(bar);
    }
  }

}
