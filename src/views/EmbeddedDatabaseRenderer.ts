import { App, MarkdownRenderChild, MarkdownSectionInformation, Menu, normalizePath, Notice, TFile } from "obsidian";
import { t } from "../i18n";
import { DataSource, NoteRecord, ViewConfigMutation } from "../data/DataSource";
import { ensureColumnOrder, getColumnsInOrder, getVisibleColumns } from "../data/ColumnConfig";
import { QueryEngine } from "../data/QueryEngine";
import { RowPipeline } from "../data/RowPipeline";
import { ColumnDef, DatabaseConfig, GroupOrderMode, RowData, ViewConfig, generateId } from "../data/types";
import { isOptionColumnType, toBooleanValue } from "../data/ColumnTypes";
import { getDefaultGroupOrder, getEffectiveGroupOrder } from "../data/GroupOrder";
import { getEffectiveFilterRules } from "../data/FilterRules";
import { CellAddress, serializeSelectedCells, getCellDisplayText } from "../data/ClipboardSerializer";
import { createCsvMarkdownZip, CsvMarkdownExportOptions } from "../data/CsvMarkdownZipExport";
import { CsvMarkdownExportModal } from "./modals/CsvMarkdownExportModal";
import { BoardGroup, BoardRenderer } from "./BoardRenderer";
import { CellRenderer } from "./CellRenderer";
import { ColumnHeaderController } from "./ColumnHeaderController";
import { ColumnManagerRenderer } from "./ColumnManagerRenderer";
import { DatabaseViewState, ViewStateStore } from "./ViewStateStore";
import { FilterPanelRenderer } from "./FilterPanelRenderer";
import { RowMenu } from "./RowMenu";
import { SortPanelRenderer } from "./SortPanelRenderer";
import { SummaryRenderer } from "./SummaryRenderer";
import { GalleryRenderer } from "./GalleryRenderer";
import { ListRenderer } from "./ListRenderer";
import { TableRenderer } from "./TableRenderer";
import { ToolbarRenderer } from "./ToolbarRenderer";
import { ViewConfigPanelRenderer } from "./ViewConfigPanelRenderer";
import { DATABASE_VIEW_TYPE, DatabaseView } from "./DatabaseView";
import { GroupOrderModal } from "./modals/GroupOrderModal";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { estimateAutoColumnWidth } from "./ColumnWidth";

type HeaderPopoverKind = "filter" | "sort" | "columns" | "view";

export interface EmbeddedDatabaseEntry {
  config: DatabaseConfig;
  sourcePath: string | null;
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
  private activeHeaderPopover?: HeaderPopoverKind;
  private headerPopoverAnchorEl?: HTMLElement;
  private removeHeaderPopoverAutoClose?: () => void;
  private config?: ViewConfig;
  private currentDbConfig?: DatabaseConfig;
  private currentSourcePath: string | null = null;
  private currentViewIndex = 0;
  private viewIndexOverride: number | null = null;
  private selectedRows = new Set<string>();
  private cellSelection: { anchor: CellAddress; focus: CellAddress } | null = null;
  private isSelectingCells = false;
  private syncingComputed = false;
  private pendingDataChange = false;
  private suppressDataReloadUntil = 0;
  private readonly handleOutsideClickBound = (event: MouseEvent) => this.handleOutsideClick(event);
  private readonly handleWindowFocusBound = () => this.refreshOnActivation();
  private readonly instanceId = generateId();
  private intersectionObserver?: IntersectionObserver;
  private isIntersecting = false;
  private pendingDatabaseOverride?: EmbeddedDatabaseEntry;
  private unsubscribe?: () => void;
  private unsubscribeViewConfig?: () => void;
  private configHistoryStack: DatabaseConfig[] = [];

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
    this.cellRenderer = new CellRenderer(this.dataSource, () => this.refreshAfterSave(), undefined, undefined, undefined, isCodeBlock);
    this.rowMenu = new RowMenu({
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
      toggleRowSelected: (row, selected) => this.toggleRowSelected(row, selected),
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
      createEntry: (defaults) => { if (!isCodeBlock) void this.createBlankEntry(defaults); },
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
      hideCreateEntry: isCodeBlock,
      isReadOnly: isCodeBlock,
    });
    this.boardRenderer = new BoardRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { if (!isCodeBlock) void this.createBlankEntry(defaults); },
      updateGroup: (row, field, value) => this.updateBoardGroup(row, field, value),
      updateGroupOrder: (field, order) => this.updateBoardGroupOrder(field, order),
      updateCardOrder: (field, groupKey, paths) => this.updateBoardCardOrder(field, groupKey, paths),
      updateColumnWidth: (width) => this.updateBoardColumnWidth(width),
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected) => this.toggleRowSelected(row, selected),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
      showColumnMenu: (event, col, anchorEl) => this.showColumnContextMenu(event, col, anchorEl, false),
      isReadOnly: isCodeBlock,
      canReorderGroups: true,
    });
    this.galleryRenderer = new GalleryRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { if (!isCodeBlock) void this.createBlankEntry(defaults); },
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected) => this.toggleRowSelected(row, selected),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns),
      updateCardSize: (width) => this.updateGalleryCardSize(width),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
      showColumnMenu: (event, col, anchorEl) => this.showColumnContextMenu(event, col, anchorEl, false),
      isReadOnly: isCodeBlock,
    });
    this.listRenderer = new ListRenderer(this.app, {
      openRow: (row) => this.dataSource.openNote(row.file),
      createEntry: (defaults) => { if (!isCodeBlock) void this.createBlankEntry(defaults); },
      isRowSelected: (row) => this.selectedRows.has(row.file.path),
      toggleRowSelected: (row, selected) => this.toggleRowSelected(row, selected),
      areAllRowsSelected: (rows) => rows.length > 0 && rows.every((row) => this.selectedRows.has(row.file.path)),
      toggleRowsSelected: (rows, selected) => this.toggleRowsSelected(rows, selected),
      editCell: (target, row, col, event) => this.cellRenderer.startEdit(target, row, col, event),
      getColumns: (config) => getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns),
      isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.config, field, key),
      toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key),
      showRowMenu: (event, row) => this.rowMenu.show(event, row),
      showColumnMenu: (event, col, anchorEl) => this.showColumnContextMenu(event, col, anchorEl, false),
      isReadOnly: isCodeBlock,
    });
  }

  private readonly handleEmbedKeydownBound = (event: KeyboardEvent) => this.handleEmbedKeydown(event);
  private readonly handleMouseUpBound = () => { this.isSelectingCells = false; };

  onload(): void {
    this.containerEl.addClass("note-database-container");
    this.containerEl.addClass("note-database-embed");
    this.unsubscribe = this.dataSource.onDataChanged(() => this.handleDataChanged());
    this.unsubscribeViewConfig = this.dataSource.onViewConfigChanged((mutation) => this.handlePeerViewConfigChanged(mutation));
    document.addEventListener("mousedown", this.handleOutsideClickBound, true);
    document.addEventListener("mouseup", this.handleMouseUpBound);
    window.addEventListener("focus", this.handleWindowFocusBound);
    this.containerEl.addEventListener("keydown", this.handleEmbedKeydownBound);
    this.observeVisibility();
    this.render();
  }

  onunload(): void {
    this.removeHeaderPopoverAutoClose?.();
    this.removeHeaderPopoverAutoClose = undefined;
    this.unsubscribe?.();
    this.unsubscribeViewConfig?.();
    document.removeEventListener("mousedown", this.handleOutsideClickBound, true);
    document.removeEventListener("mouseup", this.handleMouseUpBound);
    window.removeEventListener("focus", this.handleWindowFocusBound);
    this.containerEl.removeEventListener("keydown", this.handleEmbedKeydownBound);
    this.intersectionObserver?.disconnect();
    this.clearFileViewWidthClass();
  }

  private observeVisibility(): void {
    if (typeof IntersectionObserver === "undefined") return;
    this.intersectionObserver = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible && !this.isIntersecting) this.refreshOnActivation();
      this.isIntersecting = visible;
    });
    this.intersectionObserver.observe(this.containerEl);
  }

  private refreshOnActivation(): void {
    if (!this.containerEl.isConnected) return;
    this.hardRefreshFromSource();
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
    this.cellSelection = null;
    this.isSelectingCells = false;
    this.render(scroll);
    this.pendingDatabaseOverride = undefined;
  }

  private render(scroll?: { top: number; left: number }): void {
    const pos = scroll ?? this.saveScroll();
    this.containerEl.empty();
    const config = this.getEmbeddedConfig();
    if (!config) {
      this.containerEl.createDiv({ cls: "db-empty", text: t("errors.databaseViewNotFound") });
      return;
    }
    this.renderToolbar(config);
    this.renderFilterPanel(config);
    this.renderSortPanel(config);
    this.renderColumnManager(config);
    this.renderViewConfigPanel(config);
    this.renderResults(config);
    this.updateStickyOffsets();
    this.restoreScroll(pos);
  }

  private saveScroll(): { top: number; left: number } {
    return { top: this.containerEl.scrollTop, left: this.containerEl.scrollLeft };
  }

  private restoreScroll(pos: { top: number; left: number }): void {
    this.containerEl.scrollTop = pos.top;
    this.containerEl.scrollLeft = pos.left;
  }

  private handleDataChanged(): void {
    if (this.syncingComputed) {
      this.pendingDataChange = true;
      return;
    }
    if (this.config && Date.now() < this.suppressDataReloadUntil) {
      return;
    }
    if (this.config && this.shouldPreserveChrome()) {
      this.renderResults(this.config);
      return;
    }
    this.render();
  }

  private shouldPreserveChrome(): boolean {
    return this.showFilterPanel ||
      this.showSortPanel ||
      this.showColumnManager ||
      this.showViewConfigPanel ||
      this.containerEl.contains(document.activeElement);
  }

  private handleOutsideClick(event: MouseEvent): void {
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (!this.containerEl.contains(target)) {
      this.closePopovers();
      return;
    }
    if (target.closest(".db-filter-panel, .db-sort-panel, .db-column-manager, .db-view-config-panel, .db-toolbar, .db-header")) return;
    this.closePopovers();
  }

  private closePopovers(): void {
    this.toolbarRenderer.closePopovers();
    if (!this.config) return;
    if (!this.showFilterPanel && !this.showSortPanel && !this.showColumnManager && !this.showViewConfigPanel) return;
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
    void this.saveEmbeddedConfigToSource();
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

  private renderResults(config: ViewConfig): void {
    const scroll = this.saveScroll();
    this.containerEl.toggleClass("db-width-wide", config.displayWidth === "wide");
    this.updateFileViewWidthClass(config);
    this.applyViewTypeClass(config.viewType || "table");
    const target = this.containerEl;
    target.querySelectorAll(".db-summary, .db-table-wrap, .db-grouped-table, .db-board, .db-gallery, .db-gallery-grouped, .db-gallery-total-header, .db-list, .db-list-grouped, .db-list-total-header, .db-empty").forEach((el) => el.remove());
    if (!config.schema.columns || config.schema.columns.length === 0) {
      target.createDiv({ cls: "db-empty", text: t("errors.noColumns") });
      return;
    }
    if (config.schema.columns.length === 1) {
      target.createDiv({ cls: "db-empty", text: t("errors.onlyNameColumn") });
      return;
    }
    let records: NoteRecord[];
    try {
      records = this.dataSource.getRecordsForConfig(this.getEffectiveConfig(config));
    } catch (err) {
      target.createDiv({ cls: "db-empty", text: t("errors.dataReadFailed", { error: String(err) }) });
      return;
    }

    this.rows = this.rowPipeline.build(records, config, this.vs(config));
    void this.syncComputedFields(config, this.rows);
    this.summaryRenderer.render(target, this.rows);
    const renderConfig = this.getStatefulConfig(config);
    if (config.viewType === "board") {
      const field = config.boardGroupField || this.vs(config).groupByField || this.getDefaultBoardField(config);
      this.boardRenderer.render(target, renderConfig, this.getBoardGroups(config, field), field);
    } else if (config.viewType === "gallery") {
      if (this.vs(config).groupByField) {
        const field = this.vs(config).groupByField;
        const groups = this.queryEngine.groupBy(this.rows, field);
        const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
        this.galleryRenderer.renderGrouped(target, renderConfig, this.queryEngine.sortGroups(groups, order), field);
      } else {
        this.galleryRenderer.render(target, renderConfig, this.rows);
      }
    } else if (config.viewType === "list") {
      if (this.vs(config).groupByField) {
        const field = this.vs(config).groupByField;
        const groups = this.queryEngine.groupBy(this.rows, field);
        const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
        this.listRenderer.renderGrouped(target, renderConfig, this.queryEngine.sortGroups(groups, order), field);
      } else {
        this.listRenderer.render(target, renderConfig, this.rows);
      }
    } else if (this.vs(config).groupByField) {
      const field = this.vs(config).groupByField;
      const groups = this.queryEngine.groupBy(this.rows, field);
      const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
      this.tableRenderer.renderGroupedTable(target, renderConfig, this.rows, this.queryEngine.sortGroups(groups, order), field);
    } else {
      this.tableRenderer.renderTable(target, renderConfig, this.rows);
    }
    this.restoreScroll(scroll);
  }

  private applyViewTypeClass(viewType: NonNullable<ViewConfig["viewType"]>): void {
    for (const type of ["table", "board", "gallery", "list"] as const) {
      this.containerEl.toggleClass(`db-view-${type}`, viewType === type);
    }
  }

  private renderToolbar(config: ViewConfig): void {
    // Use the currentDbConfig if available (for multi-view support)
    const dbConfig = this.currentDbConfig || {
      id: "embedded",
      name: config.name,
      sourceFolder: config.sourceFolder,
      schema: config.schema,
      views: [config],
    } as DatabaseConfig;
    this.toolbarRenderer.render(this.containerEl, [{ config: dbConfig, sourcePath: null }], 0, this.currentViewIndex, this.vs(config), {
      selectDatabase: () => undefined,
      selectViewInView: (_dbIndex: number, viewIndex: number) => {
        if (!this.currentDbConfig || viewIndex === this.currentViewIndex) return;
        this.closePopovers();
        this.currentViewIndex = viewIndex;
        this.viewIndexOverride = viewIndex;
        this.config = undefined;
        this.state = undefined;
        const newConfig = this.getEmbeddedConfig()!;
        this.rerenderToolbar(newConfig);
        this.renderResults(newConfig);
        this.persistEmbeddedConfigLocally(newConfig);
        void this.saveEmbeddedConfigToSource();
        void this.saveCodeBlockReference(newConfig);
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
        this.renderResults(this.getEmbeddedConfig()!);
      },
      renameView: () => {
        new Notice(t("notice.editInFullView", { action: t("toolbar.rename") }));
      },
      setViewType: (value) => {
        config.viewType = value;
        if (value === "gallery") {
          config.galleryImageField = config.galleryImageField || this.getDefaultGalleryImageField(config);
          config.galleryCardSize = config.galleryCardSize || 250;
          config.galleryImageAspectRatio = config.galleryImageAspectRatio || 0.75;
          config.galleryImageFit = config.galleryImageFit || "cover";
        }
        this.persistEmbeddedConfigLocally(config);
        this.rerenderToolbar(config);
        this.renderResults(config);
        void this.saveEmbeddedConfigToSource();
      },
      setDisplayWidth: (value) => {
        config.displayWidth = value;
        this.persistEmbeddedConfigLocally(config);
        this.containerEl.toggleClass("db-width-wide", value === "wide");
        this.updateFileViewWidthClass(config);
        void this.saveEmbeddedConfigToSource();
      },
      setSearchText: (value) => {
        this.vs(config).searchText = value;
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config);
      },
      setGroupByField: (value) => {
        if (config.viewType === "board") {
          if (!value) return;
          config.boardGroupField = value;
        } else {
          this.vs(config).groupByField = value;
        }
        this.persistEmbeddedConfigLocally(config);
        this.rerenderToolbar(config);
        this.renderResults(config);
        void this.saveEmbeddedConfigToSource();
      },
      configureGroupOrder: () => this.showGroupOrderModal(config),
      setGroupOrderMode: (mode) => this.setGroupOrderMode(config, mode),
      toggleSortPanel: (anchorEl) => this.toggleHeaderPopover(config, "sort", anchorEl),
      syncComputedFields: () => { void this.syncComputedFields(config, this.rows, true); },
      toggleFilterPanel: (anchorEl) => this.toggleHeaderPopover(config, "filter", anchorEl),
      toggleColumnManager: (anchorEl) => this.toggleHeaderPopover(config, "columns", anchorEl),
      toggleViewConfig: (anchorEl) => this.toggleHeaderPopover(config, "view", anchorEl),
      closeToolbarPopovers: () => this.closePopovers(),
      openFullView: () => { void this.openFullDatabaseView(config); },
      copyViewCode: () => { void this.copyEmbeddedViewCode(config); },
      exportData: (format) => this.exportData(config, format),
      exportCsvMarkdownZip: () => { void this.exportCsvMarkdownZip(); },
      createEntry: (defaults) => { if (this.persistMode !== "codeblock") void this.createBlankEntry(defaults); },
      isReadOnly: this.persistMode === "codeblock",
      addDatabase: () => {},
      deleteDatabase: () => {},
      openDatabaseFile: () => {},
      isReadOnlyViews: true,
      hideWidthSelect: true,
      showDatabaseChrome: this.persistMode === "frontmatter",
      hideDatabaseActions: this.persistMode === "frontmatter",
    });
    this.updateStickyOffsets();
  }

  private rerenderToolbar(config: ViewConfig): void {
    this.containerEl.querySelector(":scope > .db-header")?.remove();
    this.renderToolbar(config);
  }

  private updateStickyOffsets(): void {
    const update = () => {
      const header = this.containerEl.querySelector(":scope > .db-header") as HTMLElement | null;
      const height = header ? Math.ceil(header.getBoundingClientRect().height) : 88;
      this.containerEl.style.setProperty("--db-table-header-top", `${height}px`);
    };
    update();
    window.requestAnimationFrame(update);
  }

  private toggleHeaderPopover(config: ViewConfig, kind: HeaderPopoverKind, anchorEl: HTMLElement): void {
    const wasClosingActivePopover = this.activeHeaderPopover != null && this.isHeaderPopoverVisible(this.activeHeaderPopover);
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
      void this.saveEmbeddedConfigToSource();
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

  private renderFilterPanel(config: ViewConfig): void {
    this.filterPanelRenderer.render(this.containerEl, this.showFilterPanel, this.vs(config), config, {
      saveState: () => {
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
      },
      refresh: () => {
        this.updateToolbarIndicators(config);
        this.renderResults(config);
      },
      close: () => {
        this.showFilterPanel = false;
        this.clearHeaderPopover();
        this.renderFilterPanel(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config);
        void this.saveEmbeddedConfigToSource();
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
        this.renderResults(config);
      },
      close: () => {
        this.showSortPanel = false;
        this.clearHeaderPopover();
        this.renderSortPanel(config);
        this.updateToolbarIndicators(config);
        this.renderResults(config);
        void this.saveEmbeddedConfigToSource();
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
        void this.saveEmbeddedConfigToSource();
      },
      setColumnVisible: (col, visible) => {
        if (visible) this.vs(config).hiddenColumns.delete(col.key);
        else this.vs(config).hiddenColumns.add(col.key);
        this.persistEmbeddedConfigLocally(config);
        this.updateToolbarIndicators(config);
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
      database: this.currentDbConfig,
      isDatabaseReadOnly: true,
      onChange: () => {
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        void this.saveEmbeddedConfigToSource();
      },
      onViewTypeChange: (value) => {
        config.viewType = value;
        if (value === "board" && !config.boardGroupField) {
          config.boardGroupField = this.getDefaultBoardField(config);
        }
        if (value === "gallery") {
          config.galleryImageField = config.galleryImageField || this.getDefaultGalleryImageField(config);
          config.galleryCardSize = config.galleryCardSize || 250;
          config.galleryImageAspectRatio = config.galleryImageAspectRatio || 0.75;
          config.galleryImageFit = config.galleryImageFit || "cover";
        }
        this.persistEmbeddedConfigLocally(config);
        this.render();
        void this.saveEmbeddedConfigToSource();
      },
      onDatabaseChange: () => {
        if (this.currentDbConfig) {
          config.sourceFolder = this.currentDbConfig.sourceFolder;
          config.sourceRules = this.currentDbConfig.sourceRules;
          config.sourceLogic = this.currentDbConfig.sourceLogic;
          config.newRecordFolder = this.currentDbConfig.newRecordFolder;
          config.typeFilter = this.currentDbConfig.typeFilter;
          config.syncComputedToFrontmatter = this.currentDbConfig.syncComputedToFrontmatter;
        }
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        void this.saveEmbeddedConfigToSource();
      },
    }, this.getHeaderPopoverAnchor("view"));
  }

  private async openFullDatabaseView(config: ViewConfig): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(DATABASE_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: DATABASE_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof DatabaseView) {
      view.openViewReference(this.currentSourcePath, config.id, this.currentDbConfig?.id);
    }
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
    this.inheritDbProperties(view, db);
    this.currentDbConfig = db;
    this.currentSourcePath = entry.sourcePath;
    this.currentViewIndex = db.views.indexOf(view);
    return this.cloneConfig(view);
  }

  private inheritDbProperties(view: ViewConfig, db: DatabaseConfig): void {
    if (!view.sourceFolder) view.sourceFolder = db.sourceFolder;
    if (!view.sourceRules) view.sourceRules = db.sourceRules;
    if (!view.sourceLogic) view.sourceLogic = db.sourceLogic;
    if (!view.newRecordFolder) view.newRecordFolder = db.newRecordFolder;
    if (!view.typeFilter) view.typeFilter = db.typeFilter;
    if (view.syncComputedToFrontmatter === undefined) view.syncComputedToFrontmatter = db.syncComputedToFrontmatter;
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
    if (config.viewType === "board" && config.boardSubgroupField) {
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
        void this.saveEmbeddedConfigToSource();
      })
    );
    menu.addItem((item) => item
      .setTitle(col.wrap ? t("menu.disableWrap") : t("menu.enableWrap"))
      .setIcon("wrap-text")
      .onClick(() => {
        col.wrap = !col.wrap || undefined;
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        void this.saveEmbeddedConfigToSource();
      })
    );
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
    col.width = this.calculateAutoColumnWidth(col, this.rows);
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    void this.saveEmbeddedConfigToSource();
  }

  private autoFitAllColumns(config: ViewConfig): void {
    for (const col of getVisibleColumns(config, this.rows, this.vs(config), this.pendingShowColumns)) {
      col.width = this.calculateAutoColumnWidth(col, this.rows);
    }
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    void this.saveEmbeddedConfigToSource();
  }

  private calculateAutoColumnWidth(col: ColumnDef, rows: RowData[]): number {
    return estimateAutoColumnWidth(col, rows, (row, column) => this.getColumnDisplayText(row, column));
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
    this.renderResults(config);
    void this.saveEmbeddedConfigToSource();
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
    this.renderResults(config);
    void this.saveEmbeddedConfigToSource();
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
    const groups = this.queryEngine.groupBy(this.rows, field);
    const order = getEffectiveGroupOrder(config, field, groups.map((group) => group.key));
    const map = new Map(groups.map((group) => [group.key, group]));
    const col = getColumnsInOrder(config).find((candidate) => candidate.key === field);
    const defaultKeys = getDefaultGroupOrder(config, field);
    if (col && defaultKeys.length > 0 && (isOptionColumnType(col.type) || col.type === "checkbox")) {
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
    const subgroupField = config.boardSubgroupField;
    if (!subgroupField || subgroupField === groupField) return;
    if (!config.schema.columns.some((col) => col.key === subgroupField)) return;
    for (const group of groups) {
      const subgroups = this.queryEngine.groupBy(group.rows, subgroupField);
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
    void this.saveEmbeddedConfigToSource();
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
    void this.saveEmbeddedConfigToSource();
  }

  private updateBoardColumnWidth(width: number): void {
    const config = this.config;
    if (!config) return;
    config.boardColumnWidth = width;
    this.persistEmbeddedConfigLocally(config);
    void this.saveEmbeddedConfigToSource();
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
    void this.saveEmbeddedConfigToSource();
  }

  private updateGalleryCardSize(width: number): void {
    const config = this.config;
    if (!config) return;
    config.galleryCardSize = width;
    this.persistEmbeddedConfigLocally(config);
    this.renderViewConfigPanel(config);
    void this.saveEmbeddedConfigToSource();
  }

  private showGroupOrderModal(config: ViewConfig): void {
    const field = this.getActiveGroupField(config);
    if (!field) {
      new Notice(t("notice.selectGroupField"));
      return;
    }
    const col = getColumnsInOrder(config).find((candidate) => candidate.key === field);
    const groups = this.queryEngine.groupBy(this.rows, field);
    const keys = groups.map((group) => group.key);
    new GroupOrderModal(
      this.app,
      col?.label || field,
      keys,
      config.groupOrders?.[field] || [],
      getDefaultGroupOrder(config, field),
      async (order) => {
        config.groupOrders = { ...(config.groupOrders || {}), [field]: order };
        this.persistEmbeddedConfigLocally(config);
        this.renderResults(config);
        void this.saveEmbeddedConfigToSource();
      }
    ).open();
  }

  private setGroupOrderMode(config: ViewConfig, mode: GroupOrderMode): void {
    const field = this.getActiveGroupField(config);
    if (!field) return;
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
    config.groupOrders = { ...(config.groupOrders || {}), [field]: order };
    this.persistEmbeddedConfigLocally(config);
    this.renderResults(config);
    void this.saveEmbeddedConfigToSource();
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

  private getCreateFolder(config: ViewConfig): string {
    const folderRule = config.sourceRules?.find((rule) => rule.op === "inFolder" && rule.value);
    return config.sourceFolder || folderRule?.value || config.newRecordFolder || this.defaultRecordFolder || "";
  }

  /** When no sourceFolder and no sourceRules, use defaultRecordFolder as fallback so querying and creating are consistent. */
  private getEffectiveConfig(config: ViewConfig): DatabaseConfig {
    // Build a DatabaseConfig from the view config for DataSource queries
    const db: DatabaseConfig = {
      id: "embedded",
      name: config.name,
      sourceFolder: config.sourceFolder || this.defaultRecordFolder,
      sourceRules: config.sourceRules,
      sourceLogic: config.sourceLogic,
      newRecordFolder: config.newRecordFolder,
      typeFilter: config.typeFilter,
      schema: config.schema,
      syncComputedToFrontmatter: config.syncComputedToFrontmatter,
      views: [config],
    };
    if (db.sourceFolder || db.sourceRules?.length) return db;
    db.sourceFolder = this.defaultRecordFolder;
    return db;
  }

  private toggleRowSelected(row: RowData, selected: boolean): void {
    if (selected) this.selectedRows.add(row.file.path);
    else this.selectedRows.delete(row.file.path);
    if (this.config) this.renderResults(this.config);
  }

  private toggleRowsSelected(rows: RowData[], selected: boolean): void {
    for (const row of rows) {
      if (selected) this.selectedRows.add(row.file.path);
      else this.selectedRows.delete(row.file.path);
    }
    if (this.config) this.renderResults(this.config);
  }

  private async deleteSelectedRows(): Promise<void> {
    if (this.selectedRows.size > 0) {
      new Notice(t("notice.embedReadonly", { action: t("notice.deleteEntry") }));
    }
    this.selectedRows.clear();
  }

  private async syncComputedFields(config: ViewConfig, rows: RowData[], notify = false): Promise<void> {
    if (config.syncComputedToFrontmatter === false || this.syncingComputed) return;
    this.syncingComputed = true;
    try {
      const computedColumns = config.schema.columns.filter((col) => col.type === "computed");
      let changed = 0;
      for (const row of rows) {
        const updates: Record<string, unknown> = {};
        for (const col of computedColumns) {
          const value = row.computed[col.computedKey || col.key];
          const next = value == null ? "" : value;
          if (String(row.frontmatter[col.key] ?? "") !== String(next ?? "")) updates[col.key] = next;
        }
        if (Object.keys(updates).length > 0) {
          await this.dataSource.updateFrontmatter(row.file, updates);
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
    if (filterBtn instanceof HTMLElement) this.updateToolbarBadge(filterBtn, getEffectiveFilterRules(state.filters).length);
    const sortBtn = this.containerEl.querySelector(".db-sort-btn");
    if (sortBtn instanceof HTMLElement) {
      const count = state.sortRules.filter((rule) => rule.field && rule.direction).length ||
        (state.sortColumn ? 1 : 0);
      this.updateToolbarBadge(sortBtn, count);
    }
    const colBtn = this.containerEl.querySelector(".db-col-manager-btn");
    if (colBtn instanceof HTMLElement) this.updateToolbarBadge(colBtn, Math.max(0, (config.schema.columns.length || 0) - state.hiddenColumns.size));
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
    void this.saveEmbeddedConfigToSource();
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
    const previous = this.configHistoryStack.shift();
    if (!previous || !this.currentSourcePath) {
      new Notice(t("notice.nothingToUndo"));
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.currentSourcePath);
    if (!(file instanceof TFile)) return;
    this.pendingDatabaseOverride = { config: previous, sourcePath: this.currentSourcePath };
    this.currentDbConfig = previous;
    this.config = undefined;
    this.state = undefined;
    this.stateStore.clear();
    await this.dataSource.updateViewDefFile(file, previous, this.getCurrentDatabaseMutationTarget());
    const nextConfig = this.getEmbeddedConfig();
    if (nextConfig) this.render(undefined);
    this.containerEl.querySelectorAll(".db-cell-option-popover").forEach((el) => el.remove());
    new Notice(t("notice.undone", { action: t("undo.viewConfig") }));
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
    await this.app.vault.modify(file, lines.join("\n"));
  }

  private serializeCodeBlockReference(config: ViewConfig): string {
    const lines: string[] = [];
    if (this.currentSourcePath) {
      lines.push(`dbPath: ${this.currentSourcePath}`);
    } else if (this.currentDbConfig?.id) {
      lines.push(`dbId: ${this.currentDbConfig.id}`);
    }
    if (config.id) lines.push(`viewId: ${config.id}`);
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
      if (col.key === "file.name") return row.file.name.replace(/\.md$/, "");
      const value = col.type === "computed" && col.computedKey
        ? row.computed[col.computedKey]
        : row.frontmatter[col.key];
      if (value == null || value === "") return "";
      if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
      if (typeof value === "boolean") return value ? "✓" : "";
      return String(value);
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
    const options = await new CsvMarkdownExportModal(this.app).open();
    if (!options) return;
    const getExportCellValue = (row: RowData, col: ColumnDef): string => {
      if (col.key === "file.name") return row.file.basename;
      const value = col.type === "computed" && col.computedKey
        ? row.computed[col.computedKey]
        : row.frontmatter[col.key];
      if (value == null || value === "") return "";
      if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
      return String(value);
    };
    await createCsvMarkdownZip(
      this.app,
      this.currentDbConfig,
      config,
      this.rows,
      (_index) => this.rows,
      (view) => getVisibleColumns(view, this.rows, this.vs(view), this.pendingShowColumns),
      getExportCellValue,
      "",
      options,
    );
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
    void this.saveEmbeddedConfigToSource(this.getCurrentDatabaseMutationTarget());
    void this.saveCodeBlockReference(nextConfig);
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
    origView.groupOrders = this.config.groupOrders;
    origView.boardCardOrders = this.config.boardCardOrders;
    origView.galleryImageField = this.config.galleryImageField;
    origView.titleField = this.config.titleField;
    origView.galleryImageAspectRatio = this.config.galleryImageAspectRatio;
    origView.galleryCardSize = this.config.galleryCardSize;
    origView.galleryImageFit = this.config.galleryImageFit;
    origView.columnOrder = this.config.columnOrder;
    origView.hiddenColumns = this.config.hiddenColumns;
    origView.filters = this.config.filters;
    origView.filterLogic = this.config.filterLogic;
    origView.sortRules = this.config.sortRules;
    origView.searchText = this.config.searchText;
    origView.groupByField = this.config.groupByField;
    origView.viewStates = this.config.viewStates;
    this.stateStore.persist(origView, this.vs(this.config));
  }

  // ── Cell selection & clipboard (embedded views) ──

  private handleEmbedKeydown(event: KeyboardEvent): void {
    if (!this.containerEl.isConnected) return;
    const target = event.target;
    const eventTarget = target instanceof HTMLElement ? target : null;
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
        .filter((cell): cell is HTMLElement => cell instanceof HTMLElement && cell.matches("td[data-note-database-column-key]"))
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
    const pasteBtn = bar.createEl("button", { cls: "db-selection-action db-embed-hide", text: t("selection.pasteCells"), attr: { type: "button" } });
    const fillBtn = bar.createEl("button", { cls: "db-selection-action db-embed-hide", text: t("selection.fillValue"), attr: { type: "button" } });
    const clearBtn = bar.createEl("button", { cls: "db-selection-delete db-embed-hide", text: t("selection.clearCells"), attr: { type: "button" } });

    const summary = this.containerEl.querySelector(".db-summary");
    if (summary) {
      summary.before(bar);
    } else {
      const tableWrap = this.containerEl.querySelector(".db-table-wrap");
      if (tableWrap) tableWrap.before(bar);
    }
  }

}
