import { setIcon, setTooltip } from "obsidian";
import { ColumnDef, DatabaseConfig, DatabaseViewType, DateGroupMode, GroupOrderMode, TimelineScale, ViewConfig } from "../data/types";
import { normalizeComputedSyncMode } from "../data/ComputedSync";
import { getColumnDisplayType } from "../data/ColumnDisplay";
import { t } from "../i18n";
import { DatabaseViewState } from "./ViewStateStore";
import { positionToolbarPopover } from "./PopoverPosition";
import { renderPropertyTypeIcon } from "./PropertyTypeIcon";
import { getEffectiveFilterRules } from "../data/FilterRules";
import { isImeComposing } from "../data/KeyboardUtils";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { createDropdownField, DropdownOption, openDropdownMenu } from "./DropdownField";
import { CalendarTimelineToolbarRenderer } from "./CalendarTimelineToolbarRenderer";
import { isDateLikeColumnType } from "../data/DateTimeFormat";
import { isEmptyGroupVisibilityColumn, shouldShowEmptyGroups } from "../data/GroupVisibility";
import { getDateGroupMode } from "../data/GroupDisplay";
import { isHTMLElement } from "./DomGuards";
import { renderRecordIcon } from "./RecordIconRenderer";

/** Safely append an SVG string to an element through parsed DOM nodes. */
function appendSvg(el: HTMLElement, svgString: string): void {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (svg) el.appendChild(el.ownerDocument.adoptNode(svg));
}

export interface ToolbarViewEntry {
  config: DatabaseConfig;
  sourcePath: string;
}

export interface ToolbarActions {
  selectDatabase(index: number): void;
  moveDatabase?(fromIndex: number, toIndex: number): void;
  selectViewInView(dbIndex: number, viewIndex: number): void;
  addView(viewType: DatabaseViewType): void;
  deleteView(viewIndex: number): void;
  renameView(viewIndex: number, name: string): void;
  moveView?(fromIndex: number, toIndex: number): void;
  renameDatabase?(name: string): void;
  updateDatabaseDescription?(description: string): void;
  editDatabaseIcon?(anchor: HTMLElement): void;
  showDatabaseIcon?: boolean;
  toggleDatabaseIcon?(): void;
  addDatabase(): void;
  deleteDatabase(): void;
  copyCurrentDatabase?(): void;
  copyCurrentView?(viewIndex?: number): void;
  copyViewCode?(viewIndex?: number): void;
  openDatabaseFile?(): void;
  exportData?(format: "csv" | "markdown"): void;
  exportCsvMarkdownZip?(): void;
  setViewType(value: DatabaseViewType, viewIndex?: number): void;
  setDisplayWidth(value: "default" | "wide"): void;
  setSearchText(value: string): void;
  onSearchFocus?(): void;
  setGroupByField(value: string): void;
  setGroupOrderMode(mode: GroupOrderMode): void;
  setShowEmptyGroups(field: string, value: boolean): void;
  setGroupDateMode(field: string, mode: DateGroupMode): void;
  setGroupRowLimit(limit: number): void;
  setBoardSubgroupEnabled(enabled: boolean): void;
  setBoardSubgroupField(value: string): void;
  toggleViewConfig(anchorEl: HTMLElement): void;
  configureGroupOrder(): void;
  toggleSortPanel(anchorEl: HTMLElement): void;
  toggleChartOptions?(anchorEl: HTMLElement): void;
  toggleCalendarOptions?(containerEl: HTMLElement, anchor: HTMLElement, config: ViewConfig): void;
  updateViewConfig?(label?: string): void;
  updateTimelineScale?(scale: TimelineScale, label?: string): boolean | Promise<boolean> | void;
  syncComputedFields?(): void;
  refreshDatabase?(): void;
  readonly pendingRefreshCount?: number;
  readonly pendingRefreshUnknown?: boolean;
  readonly isRefreshingDatabase?: boolean;
  toggleFilterPanel(anchorEl: HTMLElement): void;
  toggleColumnManager(anchorEl: HTMLElement): void;
  closeToolbarPopovers?(): void;
  openFullView?(): void;
  toggleHeaderChrome?(hidden: boolean): void;
  createEntry(defaults?: Record<string, unknown>): void;
  readonly isReadOnly?: boolean;
  readonly isReadOnlyViews?: boolean;
  readonly hideWidthSelect?: boolean;
  /** When true, show database selector and view tabs (standalone view) */
  readonly showDatabaseChrome?: boolean;
  readonly hideDatabaseActions?: boolean;
  /** When true, render only the database content and skip title, tabs, and toolbar chrome. */
  readonly hideHeaderChrome?: boolean;
  readonly showChartOptions?: boolean;
  /** Async count of hidden negative-interval timeline events (drives the timeline options notice). */
  getTimelineInvalidEventCount?(): number | Promise<number>;
  /** Open the modal to review/fix negative-interval timeline events. */
  openTimelineInvalidEvents?(): void;
  createRecordIconField?(): void;
}

export class ToolbarRenderer {
  private resizeObserver: ResizeObserver | null = null;
  private draggedViewIndex: number | null = null;
  private draggedDatabaseIndex: number | null = null;
  private suppressViewTabClickUntil = 0;
  private databasePopover?: HTMLElement;
  private removeDatabasePopoverListener?: () => void;
  private groupPopover?: HTMLElement;
  private removeGroupPopoverListener?: () => void;
  private groupPopoverConfig?: ViewConfig;
  private groupPopoverViewType?: DatabaseViewType;
  private groupPopoverActions?: ToolbarActions;
  private groupPopoverState?: DatabaseViewState;
  private groupRowLimitEditingCustom = false;
  private groupRowLimitFocusCustomInput = false;
  private viewTabPopover?: HTMLElement;
  private removeViewTabPopoverListener?: () => void;
  private exportPopover?: HTMLElement;
  private removeExportPopoverListener?: () => void;
  private titleActionsPopover?: HTMLElement;
  private removeTitleActionsPopoverListener?: () => void;
  private descriptionScrollTimers = new WeakMap<HTMLElement, number>();
  private calendarTimelineToolbarRenderer = new CalendarTimelineToolbarRenderer();

  render(
    containerEl: HTMLElement,
    viewEntries: ToolbarViewEntry[],
    currentDbIndex: number,
    currentViewIndex: number,
    state: DatabaseViewState,
    actions: ToolbarActions
  ): void {
    this.closeDatabasePopover();
    this.closeGroupPopover();
    this.closeViewTabPopover();
    this.closeExportPopover();
    this.closeTitleActionsPopover();
    this.calendarTimelineToolbarRenderer.closePopover();
    const currentEntry = viewEntries[currentDbIndex];
    const currentDb = currentEntry?.config;
    const currentView = currentDb?.views[currentViewIndex] || currentDb?.views[0];
    const phoneLayout = this.isPhoneLayout();
    const viewType = currentView?.viewType || "table";
    const isChartView = viewType === "chart";
    const isCalendarTimelineView = viewType === "calendar" || viewType === "timeline";
    const showSortButton = viewType !== "chart";
    const showGroupButton = viewType !== "chart" && viewType !== "calendar";
    const showColumnButton = viewType !== "chart";

    if (actions.hideHeaderChrome) return;

    const header = containerEl.createDiv({ cls: "db-header" });
    containerEl.insertBefore(header, containerEl.firstChild);

    // Row 0: Database name heading
    if (actions.showDatabaseChrome) {
      const headingRow = header.createDiv({ cls: "db-heading-row" });
      if (currentDb && actions.showDatabaseIcon !== false) {
        renderRecordIcon(headingRow, currentDb.icon, {
          editable: Boolean(actions.editDatabaseIcon && !actions.hideDatabaseActions),
          defaultIcon: "database",
          tooltip: currentDb.name,
          onClick: (anchor) => actions.editDatabaseIcon?.(anchor),
        }).addClass("db-database-icon");
      }
      const heading = actions.hideDatabaseActions
        ? headingRow.createDiv({
          cls: "db-heading",
          attr: { title: currentDb?.name || t("common.untitledDatabase") },
        })
        : headingRow.createEl("button", {
          cls: "db-heading db-heading-button",
          attr: {
            type: "button",
            title: currentDb?.name || t("common.untitledDatabase"),
            "aria-label": currentDb?.name || t("common.untitledDatabase"),
          },
        });
      heading.createSpan({ cls: "db-heading-text", text: currentDb?.name || t("common.untitledDatabase") });
      if (!actions.hideDatabaseActions) {
        setIcon(heading.createSpan({ cls: "db-heading-chevron" }), "chevron-down");
        heading.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          actions.closeToolbarPopovers?.();
          this.closeGroupPopover();
          this.closeViewTabPopover();
          this.closeExportPopover();
          this.closeTitleActionsPopover();
          this.renderDatabasePopover(heading, viewEntries, currentDbIndex, actions);
        };
      }
      if (actions.renameDatabase) {
        heading.ondblclick = (event) => {
          this.closeDatabasePopover();
          this.startDatabaseTextEdit(event, heading, currentDb?.name || "", false, (name) => actions.renameDatabase?.(name));
        };
      }
      if (!actions.hideDatabaseActions) {
        const moreBtn = headingRow.createEl("button", {
          cls: "db-heading-more-button",
          attr: { type: "button" },
        });
        setIcon(moreBtn, "more-horizontal");
        setTooltip(moreBtn, t("common.more"), { delay: 100 });
        moreBtn.onclick = (event) => this.showTitleActionsMenu(event, moreBtn, actions, currentDb?.name || "", heading);
      }
      if (currentDb?.description || actions.updateDatabaseDescription) {
        const description = currentDb?.description || "";
        const placeholder = t("viewConfig.descriptionPlaceholder");
        const descEl = header.createDiv({
          cls: `db-description${description ? "" : " is-empty"}`,
          text: description,
          attr: {
            title: description || placeholder,
            "data-placeholder": placeholder,
          },
        });
        this.attachDescriptionScrollState(descEl);
        if (actions.updateDatabaseDescription) {
          descEl.ondblclick = (event) => this.startDatabaseTextEdit(event, descEl, description, true, (value) => actions.updateDatabaseDescription?.(value));
        }
      }
    }

    // Embedded views keep a compact title row; dashboard uses the main heading as database selector.
    if (!actions.showDatabaseChrome) {
      const titleRow = header.createDiv({ cls: "db-title-row" });
      titleRow.createDiv({
        cls: "db-title",
        text: currentDb?.name || t("common.untitledDatabase"),
        attr: { title: currentDb?.name || t("common.untitledDatabase") },
      });

      const titleActions = titleRow.createDiv({ cls: "db-title-actions" });
      this.renderFullViewButton(titleActions, actions);
      if (actions.toggleHeaderChrome && phoneLayout) this.renderHeaderChromeButton(titleActions, actions, false);
      if (!actions.isReadOnly && !isChartView) this.renderNewButton(titleActions, actions);
      if (currentDb?.description) {
        header.createDiv({
          cls: "db-description db-description-embed",
          text: currentDb.description,
          attr: { title: currentDb.description },
        });
        const descEl = header.querySelector<HTMLElement>(".db-description-embed");
        if (descEl) this.attachDescriptionScrollState(descEl);
      }
    }

    // Row 2: View tabs + toolbar
    const toolbar = header.createDiv({ cls: "db-toolbar" });
    const left = toolbar.createDiv({ cls: "db-toolbar-left" });
    const right = toolbar.createDiv({ cls: "db-toolbar-right" });

    if (actions.showDatabaseChrome && currentDb) {
      this.renderViewTabs(left, currentDb, currentViewIndex, actions);
    } else if (currentDb && currentDb.views.length > 0) {
      // Embedded views still show a single active tab so the toolbar shape stays consistent.
      this.renderViewTabs(left, currentDb, currentViewIndex, actions);
    }
    if (phoneLayout && !isChartView) this.renderSearch(left, state, actions);

    if (!actions.hideWidthSelect) this.renderWidthSelect(right, currentEntry, currentView, actions);
    this.renderFilterButton(right, state, actions);
    if (showSortButton) this.renderSortButton(right, state, actions);
    this.renderViewConfigButton(right, actions);
    if (showGroupButton) {
      this.renderGroupSelect(right, currentView, state, actions);
      if (showColumnButton) this.renderColumnButton(right, currentView, state, actions);
    } else if (showColumnButton) {
      this.renderColumnButton(right, currentView, state, actions);
    }
    if (!actions.isReadOnly && normalizeComputedSyncMode(currentDb?.computedSyncMode) === "manual") {
      this.renderComputedSyncButton(right, actions);
    }
    this.renderDatabaseRefreshButton(right, actions);
    this.renderExportButton(right, actions);
    if (actions.showDatabaseChrome && !actions.hideDatabaseActions && actions.openDatabaseFile) this.renderDatabaseFileButton(right, actions);
    if (isChartView && actions.toggleChartOptions && actions.showChartOptions === true) this.renderChartOptionsButton(right, actions);
    if (isCalendarTimelineView && currentView && actions.updateViewConfig) {
      this.renderCalendarTimelineOptionsButton(right, currentView, currentDb, actions);
    }
    if (!phoneLayout && !isChartView) this.renderSearch(right, state, actions);
    if (!actions.isReadOnly && !isChartView) this.renderNewButton(right, actions);
  }

  private isPhoneLayout(): boolean {
    return window.activeDocument.body.classList.contains("is-phone");
  }

  private renderComputedSyncButton(toolbar: HTMLElement, actions: ToolbarActions): void {
    if (!actions.syncComputedFields) return;
    const btn = this.createIconButton(toolbar, "", t("viewConfig.saveComputedResults"));
    appendSvg(btn, ToolbarRenderer.ICONS.refresh_fx);
    btn.onclick = () => actions.syncComputedFields?.();
  }

  private renderDatabaseRefreshButton(toolbar: HTMLElement, actions: ToolbarActions): void {
    if (!actions.refreshDatabase) return;
    const btn = this.createIconButton(toolbar, "", t("toolbar.refreshDatabase"), "db-database-refresh-button");
    setIcon(btn, "refresh-cw");
    btn.onclick = () => actions.refreshDatabase?.();
    this.updateDatabaseRefreshButton(btn, actions);
  }

  updateDatabaseRefreshButton(button: HTMLElement, state: Pick<ToolbarActions,
    "pendingRefreshCount" | "pendingRefreshUnknown" | "isRefreshingDatabase">): void {
    const pending = state.pendingRefreshCount || 0;
    const unknown = state.pendingRefreshUnknown === true;
    const refreshing = state.isRefreshingDatabase === true;
    button.toggleClass("is-refreshing", refreshing);
    button.querySelector(".db-database-refresh-badge")?.remove();
    if (pending > 0 || unknown) {
      button.createSpan({
        cls: "db-database-refresh-badge",
        text: pending > 99 ? "99+" : pending > 0 ? String(pending) : "!",
      });
    }
    const label = refreshing
      ? t("toolbar.refreshingDatabase")
      : pending > 0
        ? t("toolbar.pendingRefreshFiles", { count: pending })
        : unknown
          ? t("toolbar.pendingRefreshUnknown")
          : t("toolbar.refreshDatabase");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }

  private renderCalendarTimelineOptionsButton(toolbar: HTMLElement, config: ViewConfig, database: DatabaseConfig, actions: ToolbarActions): void {
    const label = config.viewType === "timeline" ? t("timeline.options") : t("calendar.options");
    const btn = this.createIconButton(toolbar, "", label);
    btn.addClass("db-calendar-timeline-options-toolbar-btn");
    this.appendViewSettingsIcon(btn, this.getViewTypeIcon(config.viewType || "calendar"));
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      actions.closeToolbarPopovers?.();
      this.closeDatabasePopover();
      this.closeGroupPopover();
      this.closeViewTabPopover();
      this.closeExportPopover();
      this.closeTitleActionsPopover();
      if (config.viewType === "calendar" && actions.toggleCalendarOptions) {
        const container = toolbar.closest(".note-database-container") as HTMLElement || toolbar;
        actions.toggleCalendarOptions(container, btn, config);
      } else {
        this.toggleCalendarTimelineOptions(toolbar, btn, config, database, actions);
      }
    };
  }

  private toggleCalendarTimelineOptions(toolbar: HTMLElement, anchor: HTMLElement, config: ViewConfig, database: DatabaseConfig, actions: ToolbarActions): void {
    this.calendarTimelineToolbarRenderer.togglePopover(toolbar.closest(".note-database-container") as HTMLElement || toolbar, anchor, config, {
      onChange: (label) => actions.updateViewConfig?.(label),
      database,
      createRecordIconField: actions.createRecordIconField ? () => actions.createRecordIconField?.() : undefined,
      updateTimelineScale: (scale, label) => actions.updateTimelineScale?.(scale, label),
      getInvalidEventCount: actions.getTimelineInvalidEventCount
        ? () => actions.getTimelineInvalidEventCount?.() ?? 0
        : undefined,
      openInvalidEvents: () => actions.openTimelineInvalidEvents?.(),
    });
  }

  // ── Database selector popover ──

  private renderDatabasePopover(
    anchorEl: HTMLElement,
    viewEntries: ToolbarViewEntry[],
    currentDbIndex: number,
    actions: ToolbarActions
  ): void {
    const root = anchorEl.closest(".note-database-container");
    if (!root) return;
    if (this.databasePopover?.isConnected) {
      this.closeDatabasePopover();
      return;
    }

    const entries = [...viewEntries];
    let activeIndex = currentDbIndex;
    const panel = root.createDiv({ cls: "db-database-popover" });
    this.databasePopover = panel;
    this.populateDatabasePopover(panel, anchorEl, entries, activeIndex, actions, (nextEntries, nextActiveIndex) => {
      entries.splice(0, entries.length, ...nextEntries);
      activeIndex = nextActiveIndex;
    });

    positionToolbarPopover(panel, anchorEl);
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (panel.contains(target) || anchorEl.contains(target))) return;
      this.closeDatabasePopover();
    };
    const popoverTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    const removeAutoClose = installPopoverAutoClose({ panel, anchorEl, close: () => this.closeDatabasePopover() });
    this.removeDatabasePopoverListener = () => {
      window.clearTimeout(popoverTimer);
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      removeAutoClose();
    };
  }

  private populateDatabasePopover(
    panel: HTMLElement,
    anchorEl: HTMLElement,
    viewEntries: ToolbarViewEntry[],
    currentDbIndex: number,
    actions: ToolbarActions,
    updateState: (entries: ToolbarViewEntry[], currentIndex: number) => void
  ): void {
    panel.empty();
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("settings.databaseList.title") });

    viewEntries.forEach((entry, i) => {
      this.renderDatabasePopoverRow(panel, anchorEl, viewEntries, entry, i, currentDbIndex, actions, true, updateState);
    });

    positionToolbarPopover(panel, anchorEl);
  }

  private renderDatabasePopoverRow(
    panel: HTMLElement,
    anchorEl: HTMLElement,
    viewEntries: ToolbarViewEntry[],
    entry: ToolbarViewEntry,
    index: number,
    currentDbIndex: number,
    actions: ToolbarActions,
    canMove: boolean,
    updateState: (entries: ToolbarViewEntry[], currentIndex: number) => void
  ): void {
    const row = panel.createEl("button", {
      cls: `db-database-popover-row${index === currentDbIndex ? " is-active" : ""}${canMove && actions.moveDatabase ? " is-draggable" : ""}`,
      attr: { type: "button" },
    });
    row.createSpan({ cls: "db-database-popover-drag", text: canMove && actions.moveDatabase ? "⋮⋮" : "" });
    const moveControls = row.createSpan({ cls: "db-mobile-reorder-controls" });
    if (canMove && actions.moveDatabase) {
      const sameSourceIndexes = viewEntries
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .map(({ candidateIndex }) => candidateIndex);
      const sourcePosition = sameSourceIndexes.indexOf(index);
      const upBtn = moveControls.createEl("button", {
        attr: { type: "button" },
      });
      setIcon(upBtn, "arrow-up");
      setTooltip(upBtn, t("menu.moveUp"), { delay: 100 });
      upBtn.disabled = sourcePosition <= 0;
      upBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.moveDatabasePopoverEntry(panel, anchorEl, viewEntries, currentDbIndex, actions, updateState, index, sameSourceIndexes[sourcePosition - 1]);
      };
      const downBtn = moveControls.createEl("button", {
        attr: { type: "button" },
      });
      setIcon(downBtn, "arrow-down");
      setTooltip(downBtn, t("menu.moveDown"), { delay: 100 });
      downBtn.disabled = sourcePosition < 0 || sourcePosition >= sameSourceIndexes.length - 1;
      downBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.moveDatabasePopoverEntry(panel, anchorEl, viewEntries, currentDbIndex, actions, updateState, index, sameSourceIndexes[sourcePosition + 1]);
      };
    }
    const label = entry.config.name || t("common.untitled");
    if (actions.showDatabaseIcon !== false) {
      renderRecordIcon(row, entry.config.icon, { compact: true, defaultIcon: "database" })
        .addClass("db-database-popover-icon");
    }
    row.createSpan({ cls: "db-database-popover-label", text: label });
    if (index === currentDbIndex) setIcon(row.createSpan({ cls: "db-database-popover-check" }), "check");
    row.onclick = () => {
      actions.selectDatabase(index);
      this.closeDatabasePopover();
    };
    if (!canMove || !actions.moveDatabase) return;
    row.draggable = true;
    row.ondragstart = (event) => {
      this.draggedDatabaseIndex = index;
      event.dataTransfer?.setData("text/plain", String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.addClass("is-dragging");
    };
    row.ondragover = (event) => {
      if (this.draggedDatabaseIndex == null || this.draggedDatabaseIndex === index) return;
      event.preventDefault();
      row.addClass("is-drop-target");
    };
    row.ondragleave = () => row.removeClass("is-drop-target");
    row.ondrop = (event) => {
      if (this.draggedDatabaseIndex == null || this.draggedDatabaseIndex === index) return;
      event.preventDefault();
      const from = this.draggedDatabaseIndex;
      const fromEntry = viewEntries[from];
      if (!fromEntry) {
        this.clearDatabaseDragState(panel);
        return;
      }
      this.clearDatabaseDragState(panel);
      const activeEntry = viewEntries[currentDbIndex];
      const nextEntries = [...viewEntries];
      const [moved] = nextEntries.splice(from, 1);
      nextEntries.splice(index, 0, moved);
      const nextActiveIndex = Math.max(0, nextEntries.indexOf(activeEntry));
      actions.moveDatabase?.(from, index);
      updateState(nextEntries, nextActiveIndex);
      this.populateDatabasePopover(panel, anchorEl, nextEntries, nextActiveIndex, actions, updateState);
    };
    row.ondragend = () => this.clearDatabaseDragState(panel);
  }

  private moveDatabasePopoverEntry(
    panel: HTMLElement,
    anchorEl: HTMLElement,
    viewEntries: ToolbarViewEntry[],
    currentDbIndex: number,
    actions: ToolbarActions,
    updateState: (entries: ToolbarViewEntry[], currentIndex: number) => void,
    from: number,
    to: number | undefined
  ): void {
    if (to == null || from === to || from < 0 || to < 0) return;
    const fromEntry = viewEntries[from];
    const toEntry = viewEntries[to];
    if (!fromEntry || !toEntry) return;
    const activeEntry = viewEntries[currentDbIndex];
    const nextEntries = [...viewEntries];
    const [moved] = nextEntries.splice(from, 1);
    nextEntries.splice(to, 0, moved);
    const nextActiveIndex = Math.max(0, nextEntries.indexOf(activeEntry));
    actions.moveDatabase?.(from, to);
    updateState(nextEntries, nextActiveIndex);
    this.populateDatabasePopover(panel, anchorEl, nextEntries, nextActiveIndex, actions, updateState);
  }

  private clearDatabaseDragState(panel: HTMLElement): void {
    this.draggedDatabaseIndex = null;
    panel.querySelectorAll(".db-database-popover-row.is-drop-target, .db-database-popover-row.is-dragging")
      .forEach((el) => el.removeClass("is-drop-target", "is-dragging"));
  }

  private showTitleActionsMenu(
    event: MouseEvent,
    anchorEl: HTMLElement,
    actions: ToolbarActions,
    currentName: string,
    headingEl: HTMLElement
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const root = anchorEl.closest(".note-database-container");
    if (!root) return;
    if (this.titleActionsPopover?.isConnected) {
      this.closeTitleActionsPopover();
      return;
    }

    this.closeTitleActionsPopover();
    this.closeDatabasePopover();
    this.closeGroupPopover();
    this.closeViewTabPopover();
    this.closeExportPopover();
    actions.closeToolbarPopovers?.();

    const panel = root.createDiv({ cls: "db-view-tab-popover db-title-actions-popover" });
    this.titleActionsPopover = panel;
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("common.database") });

    if (actions.renameDatabase) {
      this.renderTitleActionsPopoverRow(panel, t("toolbar.renameDatabase"), "pencil", (rowEvent) => {
        this.startDatabaseTextEdit(rowEvent, headingEl, currentName, false, (name) => actions.renameDatabase?.(name));
      });
    }
    if (actions.copyCurrentDatabase) {
      this.renderTitleActionsPopoverRow(panel, t("toolbar.copyCurrentDatabase"), "copy", () => actions.copyCurrentDatabase?.());
    }
    this.renderTitleActionsPopoverRow(panel, t("toolbar.addDatabase"), "plus", () => actions.addDatabase());
    if (actions.toggleDatabaseIcon) {
      this.renderTitleActionsPopoverRow(panel, t("toolbar.toggleDatabaseIcon"), actions.showDatabaseIcon === false ? "circle-off" : "circle-check", () => actions.toggleDatabaseIcon?.());
    }
    this.renderTitleActionsPopoverRow(panel, t("toolbar.deleteDatabase"), "trash", () => actions.deleteDatabase(), "is-danger");

    positionToolbarPopover(panel, anchorEl);
    const onOutside = (outsideEvent: MouseEvent) => {
      const target = outsideEvent.target as Node | null;
      if (target && (panel.contains(target) || anchorEl.contains(target))) return;
      this.closeTitleActionsPopover();
    };
    const popoverTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    const removeAutoClose = installPopoverAutoClose({ panel, anchorEl, close: () => this.closeTitleActionsPopover() });
    this.removeTitleActionsPopoverListener = () => {
      window.clearTimeout(popoverTimer);
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      removeAutoClose();
    };
  }

  private renderTitleActionsPopoverRow(
    panel: HTMLElement,
    label: string,
    icon: string,
    onClick: (event: MouseEvent) => void,
    extraClass = ""
  ): void {
    const row = panel.createEl("button", {
      cls: `db-view-tab-popover-row ${extraClass}`.trim(),
      attr: { type: "button" },
    });
    setIcon(row.createSpan({ cls: "db-view-tab-popover-marker" }), icon);
    row.createSpan({ cls: "db-view-tab-popover-label", text: label });
    row.onclick = (event) => {
      this.closeTitleActionsPopover();
      onClick(event);
    };
  }

  // ── Row 2: View tabs ──

  private renderViewTabs(
    left: HTMLElement,
    db: DatabaseConfig,
    currentViewIndex: number,
    actions: ToolbarActions
  ): void {
    const tabs = left.createDiv({ cls: "db-view-tabs" });
    const readOnly = actions.isReadOnlyViews;
    const canReorder = Boolean(!readOnly && actions.moveView && db.views.length > 1 && !this.isPhoneLayout());
    const tabEls: { el: HTMLElement; index: number }[] = [];

    db.views.forEach((view, i) => {
      const tab = tabs.createEl("button", {
        cls: `db-view-tab${i === currentViewIndex ? " is-active" : ""}`,
      });
      setIcon(tab.createSpan({ cls: "db-view-tab-icon" }), this.getViewTypeIcon(view.viewType || "table"));
      tab.createSpan({ cls: "db-view-tab-name", text: view.name || t("common.untitled") });
      tab.onclick = () => {
        if (Date.now() < this.suppressViewTabClickUntil) return;
        actions.selectViewInView(0, i);
      };
      if (canReorder) this.setupViewTabDrag(tab, i, actions);
      if (!readOnly) {
        tab.oncontextmenu = (e) => this.showViewTabMenu(e, i, db.views.length, actions, tab, view.viewType || "table");
        tab.ondblclick = () => this.startRenameView(tab, i, actions);
      }
      tabEls.push({ el: tab, index: i });
    });

    // "+" add view button (only in non-readonly mode)
    if (!readOnly && db.views.length < 15) {
      const addBtn = tabs.createEl("button", {
        cls: "db-view-tab db-view-tab-add",
        attr: {},
      });
      setIcon(addBtn, "plus");
      setTooltip(addBtn, t("toolbar.addView"), { delay: 100 });
      addBtn.onclick = (event) => this.showAddViewMenu(event, actions, addBtn);
    }

    // Set up resize observer on the toolbar for dynamic overflow detection
    const toolbar = tabs.closest(".db-toolbar");
    this.resizeObserver?.disconnect();
    if (toolbar) {
      let collapsing = false;
      const checkOverflow = () => {
        if (collapsing) return;
        collapsing = true;
        for (const t of tabEls) t.el.setCssProps({ display: "" });
        const oldBtn = tabs.querySelector(".db-view-tab-more");
        if (oldBtn) oldBtn.remove();
        this.collapseOverflowTabs(tabs, tabEls, db, currentViewIndex, actions);
        collapsing = false;
      };
      this.resizeObserver = new ResizeObserver(() => checkOverflow());
      this.resizeObserver.observe(toolbar);
      // Initial run after layout
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => checkOverflow()));
    }
  }

  private setupViewTabDrag(tab: HTMLElement, index: number, actions: ToolbarActions): void {
    tab.draggable = true;
    tab.ondragstart = (event) => {
      this.draggedViewIndex = index;
      tab.addClass("is-dragging");
      event.dataTransfer?.setData("text/plain", String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };
    tab.ondragover = (event) => {
      if (this.draggedViewIndex == null || this.draggedViewIndex === index) return;
      event.preventDefault();
      tab.addClass("is-drop-target");
    };
    tab.ondragleave = () => tab.removeClass("is-drop-target");
    tab.ondrop = (event) => {
      if (this.draggedViewIndex == null || this.draggedViewIndex === index) return;
      event.preventDefault();
      const from = this.draggedViewIndex;
      this.clearViewTabDragState(tab);
      this.suppressViewTabClickUntil = Date.now() + 250;
      actions.moveView?.(from, index);
    };
    tab.ondragend = () => {
      this.suppressViewTabClickUntil = Date.now() + 250;
      this.clearViewTabDragState(tab);
    };
  }

  private clearViewTabDragState(tab: HTMLElement): void {
    this.draggedViewIndex = null;
    tab.removeClass("is-dragging", "is-drop-target");
    tab.parentElement?.querySelectorAll(".db-view-tab.is-drop-target, .db-view-tab.is-dragging")
      .forEach((el) => el.removeClass("is-drop-target", "is-dragging"));
  }

  private collapseOverflowTabs(
    tabs: HTMLElement,
    tabEls: { el: HTMLElement; index: number }[],
    db: DatabaseConfig,
    currentViewIndex: number,
    actions: ToolbarActions
  ): void {
    const toolbar = tabs.closest(".db-toolbar");
    const right = toolbar?.querySelector(".db-toolbar-right") as HTMLElement | null;
    const phoneSearch = toolbar?.querySelector(".db-toolbar-left .db-search-control") as HTMLElement | null;
    const boundary = this.isPhoneLayout()
      ? (phoneSearch ? phoneSearch.getBoundingClientRect().left - 4 : toolbar?.getBoundingClientRect().right || tabs.getBoundingClientRect().right)
      : right ? right.getBoundingClientRect().left - 6 : tabs.getBoundingClientRect().right;
    const containerWidth = boundary - tabs.getBoundingClientRect().left;
    const gap = parseFloat(getComputedStyle(tabs).columnGap || getComputedStyle(tabs).gap || "3") || 3;

    const addBtn: HTMLElement | null = tabs.querySelector(".db-view-tab-add");
    const addBtnWidth = addBtn ? addBtn.offsetWidth + gap : 0;
    const moreBtnWidth = 24 + gap;

    // Calculate total width of all tabs
    let totalWidth = addBtnWidth;
    for (const t of tabEls) totalWidth += t.el.offsetWidth + gap;

    if (totalWidth <= containerWidth) return; // No overflow

    // Always keep active tab visible; fill remaining space from left to right
    const availableSpace = containerWidth - addBtnWidth - moreBtnWidth;
    const visibleSet = new Set<number>();
    visibleSet.add(currentViewIndex);

    // Measure active tab
    const activeEl = tabEls.find(t => t.index === currentViewIndex);
    let usedWidth = activeEl ? activeEl.el.offsetWidth + gap : 0;

    // Add remaining tabs from left to right until out of space
    for (const t of tabEls) {
      if (visibleSet.has(t.index)) continue;
      if (usedWidth + t.el.offsetWidth + gap > availableSpace) break;
      visibleSet.add(t.index);
      usedWidth += t.el.offsetWidth + gap;
    }

    // Hide non-visible tabs
    const hiddenTabs = tabEls.filter(t => !visibleSet.has(t.index));
    if (hiddenTabs.length === 0) return;

    for (const t of hiddenTabs) t.el.setCssProps({ display: "none" });

    // Create "⋯" overflow dropdown
    const moreBtn = tabs.createEl("button", {
      cls: "db-view-tab db-view-tab-more",
      attr: {},
    });
    moreBtn.createSpan({ text: "⋯" });
    setTooltip(moreBtn, t("toolbar.moreViews"), { delay: 100 });
    moreBtn.onclick = (e: MouseEvent) => {
      openDropdownMenu({
        anchor: moreBtn,
        label: t("toolbar.moreViews"),
        value: String(currentViewIndex),
        popoverClassName: "db-view-tabs-dropdown-popover",
        options: hiddenTabs.map((hidden) => {
          const view = db.views[hidden.index];
          return {
            value: String(hidden.index),
            text: view.name || t("common.untitled"),
            icon: this.getViewTypeIcon(view.viewType || "table"),
          };
        }),
        onChange: (value) => actions.selectViewInView(0, Number(value)),
      });
    };
  }

  private showViewTabMenu(
    event: MouseEvent,
    viewIndex: number,
    totalViews: number,
    actions: ToolbarActions,
    tab: HTMLElement,
    viewType: DatabaseViewType
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const root = tab.closest(".note-database-container");
    if (!root) return;
    this.closeViewTabPopover();
    this.closeDatabasePopover();
    this.closeGroupPopover();
    this.closeExportPopover();
    this.closeTitleActionsPopover();
    actions.closeToolbarPopovers?.();

    const panel = root.createDiv({ cls: "db-view-tab-popover" });
    this.viewTabPopover = panel;
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("viewConfig.viewSection") });

    this.renderViewTabPopoverRow(panel, t("toolbar.rename"), "pencil", () => {
      this.startRenameView(tab, viewIndex, actions);
    });
    if (actions.copyCurrentView) {
      this.renderViewTabPopoverRow(panel, t("toolbar.copyCurrentView"), "copy", () => actions.copyCurrentView?.(viewIndex));
    }
    if (actions.copyViewCode) {
      this.renderViewTabPopoverRow(panel, t("toolbar.copyViewCode"), "code-xml", () => actions.copyViewCode?.(viewIndex));
    }
    this.renderViewTypeChangeRow(panel, viewIndex, viewType, actions);
    if (this.isPhoneLayout() && actions.moveView && totalViews > 1) {
      if (viewIndex > 0) {
        this.renderViewTabPopoverRow(panel, t("toolbar.moveViewFirst"), "chevrons-left", () => actions.moveView?.(viewIndex, 0));
        this.renderViewTabPopoverRow(panel, t("menu.moveUp"), "arrow-left", () => actions.moveView?.(viewIndex, viewIndex - 1));
      }
      if (viewIndex < totalViews - 1) {
        this.renderViewTabPopoverRow(panel, t("menu.moveDown"), "arrow-right", () => actions.moveView?.(viewIndex, viewIndex + 1));
        this.renderViewTabPopoverRow(panel, t("toolbar.moveViewLast"), "chevrons-right", () => actions.moveView?.(viewIndex, totalViews - 1));
      }
    }
    if (totalViews > 1) {
      this.renderViewTabPopoverRow(panel, t("toolbar.deleteView"), "trash", () => {
        actions.deleteView(viewIndex);
      }, "is-danger");
    }

    positionToolbarPopover(panel, tab);
    const onOutside = (outsideEvent: MouseEvent) => {
      const target = outsideEvent.target as Node | null;
      if (target && (panel.contains(target) || tab.contains(target))) return;
      this.closeViewTabPopover();
    };
    const popoverTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    const removeAutoClose = installPopoverAutoClose({ panel, anchorEl: tab, close: () => this.closeViewTabPopover() });
    this.removeViewTabPopoverListener = () => {
      window.clearTimeout(popoverTimer);
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      removeAutoClose();
    };
  }

  private renderViewTypeChangeRow(panel: HTMLElement, viewIndex: number, viewType: DatabaseViewType, actions: ToolbarActions): void {
    const row = panel.createEl("button", {
      cls: "db-view-tab-popover-row",
      attr: { type: "button" },
    });
    setIcon(row.createSpan({ cls: "db-view-tab-popover-marker" }), "replace");
    row.createSpan({ cls: "db-view-tab-popover-label", text: t("toolbar.changeViewType") });
    setIcon(row.createSpan({ cls: "db-view-tab-popover-chevron" }), "chevron-right");
    row.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showViewTypeChangeMenu(row, viewIndex, viewType, actions);
    };
  }

  private showViewTypeChangeMenu(anchor: HTMLElement, viewIndex: number, viewType: DatabaseViewType, actions: ToolbarActions): void {
    openDropdownMenu({
      anchor,
      label: t("toolbar.changeViewType"),
      value: viewType,
      popoverClassName: "db-view-tabs-dropdown-popover",
      options: this.getViewTypeOptions(),
      onChange: (value) => {
        this.closeViewTabPopover();
        actions.setViewType(value as DatabaseViewType, viewIndex);
      },
    });
  }

  private getViewTypeOptions(): Array<{ value: DatabaseViewType; text: string; icon: string }> {
    return [
      { value: "table", text: t("common.tableView"), icon: this.getViewTypeIcon("table") },
      { value: "board", text: t("common.boardView"), icon: this.getViewTypeIcon("board") },
      { value: "gallery", text: t("common.galleryView"), icon: this.getViewTypeIcon("gallery") },
      { value: "list", text: t("common.listView"), icon: this.getViewTypeIcon("list") },
      { value: "chart", text: t("common.chartView"), icon: this.getViewTypeIcon("chart") },
      { value: "calendar", text: t("common.calendarView"), icon: this.getViewTypeIcon("calendar") },
      { value: "timeline", text: t("common.timelineView"), icon: this.getViewTypeIcon("timeline") },
    ];
  }

  private renderViewTabPopoverRow(
    panel: HTMLElement,
    label: string,
    icon: string,
    onClick: () => void,
    extraClass = ""
  ): void {
    const row = panel.createEl("button", {
      cls: `db-view-tab-popover-row ${extraClass}`.trim(),
      attr: { type: "button" },
    });
    setIcon(row.createSpan({ cls: "db-view-tab-popover-marker" }), icon);
    row.createSpan({ cls: "db-view-tab-popover-label", text: label });
    row.onclick = () => {
      this.closeViewTabPopover();
      onClick();
    };
  }

  private showAddViewMenu(event: MouseEvent, actions: ToolbarActions, anchorEl: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    const root = anchorEl.closest(".note-database-container");
    if (!root) return;
    if (this.viewTabPopover?.isConnected && this.viewTabPopover.hasClass("db-add-view-popover")) {
      this.closeViewTabPopover();
      return;
    }
    this.closeViewTabPopover();
    this.closeDatabasePopover();
    this.closeGroupPopover();
    this.closeExportPopover();
    this.closeTitleActionsPopover();
    actions.closeToolbarPopovers?.();

    const panel = root.createDiv({ cls: "db-view-tab-popover db-add-view-popover" });
    this.viewTabPopover = panel;
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("toolbar.addView") });

    this.renderViewTabPopoverRow(panel, t("common.tableView"), this.getViewTypeIcon("table"), () => actions.addView("table"));
    this.renderViewTabPopoverRow(panel, t("common.boardView"), this.getViewTypeIcon("board"), () => actions.addView("board"));
    this.renderViewTabPopoverRow(panel, t("common.galleryView"), this.getViewTypeIcon("gallery"), () => actions.addView("gallery"));
    this.renderViewTabPopoverRow(panel, t("common.listView"), this.getViewTypeIcon("list"), () => actions.addView("list"));
    this.renderViewTabPopoverRow(panel, t("common.chartView"), this.getViewTypeIcon("chart"), () => actions.addView("chart"));
    this.renderViewTabPopoverRow(panel, t("common.calendarView"), this.getViewTypeIcon("calendar"), () => actions.addView("calendar"));
    this.renderViewTabPopoverRow(panel, t("common.timelineView"), this.getViewTypeIcon("timeline"), () => actions.addView("timeline"));
    positionToolbarPopover(panel, anchorEl);
    const onOutside = (outsideEvent: MouseEvent) => {
      const target = outsideEvent.target as Node | null;
      if (target && (panel.contains(target) || anchorEl.contains(target))) return;
      this.closeViewTabPopover();
    };
    const popoverTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    const removeAutoClose = installPopoverAutoClose({ panel, anchorEl, close: () => this.closeViewTabPopover() });
    this.removeViewTabPopoverListener = () => {
      window.clearTimeout(popoverTimer);
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      removeAutoClose();
    };
  }

  private getViewTypeIcon(viewType: DatabaseViewType): string {
    if (viewType === "board") return "layout-grid";
    if (viewType === "gallery") return "image";
    if (viewType === "list") return "list";
    if (viewType === "chart") return "bar-chart";
    if (viewType === "calendar") return "calendar-days";
    if (viewType === "timeline") return "chart-gantt";
    return "table";
  }

  private startRenameView(tab: HTMLElement, viewIndex: number, actions: ToolbarActions): void {
    const nameEl = tab.querySelector(".db-view-tab-name") as HTMLElement;
    if (!nameEl) return;
    const input = tab.ownerDocument.createElement("input");
    input.type = "text";
    input.value = nameEl.textContent || "";
    input.className = "db-view-tab-rename";
    input.style.width = `${Math.max(56, Math.min(140, nameEl.offsetWidth + 18))}px`;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const finish = () => {
      const newName = input.value.trim();
      if (newName) actions.renameView(viewIndex, newName);
      // Re-render will replace the input
    };
    input.onblur = finish;
    input.onkeydown = (e) => {
      if (isImeComposing(e)) return;
      if (e.key === "Enter") finish();
      if (e.key === "Escape") actions.renameView(viewIndex, nameEl.textContent || ""); // cancel
    };
  }

  private startDatabaseTextEdit(
    event: MouseEvent,
    el: HTMLElement,
    value: string,
    multiline: boolean,
    save: (value: string) => void
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const initialHeight = Math.ceil(el.getBoundingClientRect().height);
    const input = multiline ? window.activeDocument.createElement("textarea") : window.activeDocument.createElement("input");
    input.className = multiline ? "db-heading-edit db-heading-edit-description" : "db-heading-edit";
    if (!multiline) (input as HTMLInputElement).type = "text";
    if (multiline && input instanceof HTMLTextAreaElement) input.rows = 1;
    input.value = value;
    el.replaceWith(input);
    if (multiline && input instanceof HTMLTextAreaElement) {
      this.syncDatabaseDescriptionEditHeight(input, initialHeight);
      const maxHeight = this.getDatabaseDescriptionEditMaxHeight(input, initialHeight);
      input.addEventListener("input", () => this.autoGrowTextarea(input, maxHeight, initialHeight));
    }
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (commit) save(next);
      else save(value);
    };
    input.onblur = () => finish(true);
    input.onkeydown = (keyboardEvent) => {
      if (isImeComposing(keyboardEvent)) return;
      if (keyboardEvent.key === "Escape") finish(false);
      if (keyboardEvent.key === "Enter" && (!multiline || keyboardEvent.metaKey || keyboardEvent.ctrlKey)) {
        keyboardEvent.preventDefault();
        finish(true);
      }
    };
  }

  private autoGrowTextarea(textarea: HTMLTextAreaElement, maxHeight: number, minHeight = 0): void {
    textarea.setCssProps({ height: "auto" });
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.setCssProps({ height: `${nextHeight}px` });
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  private syncDatabaseDescriptionEditHeight(textarea: HTMLTextAreaElement, height: number): void {
    const nextHeight = Math.max(0, height);
    if (nextHeight > 0) textarea.setCssProps({ height: `${nextHeight}px` });
    textarea.style.overflowY = textarea.scrollHeight > nextHeight ? "auto" : "hidden";
  }

  private getDatabaseDescriptionEditMaxHeight(textarea: HTMLTextAreaElement, initialHeight: number): number {
    const view = textarea.ownerDocument.defaultView || window;
    const rawMaxHeight = view.getComputedStyle(textarea).maxHeight;
    const parsedMaxHeight = Number.parseFloat(rawMaxHeight);
    const cssMaxHeight = Number.isFinite(parsedMaxHeight) ? parsedMaxHeight : 200;
    return Math.max(initialHeight || 0, cssMaxHeight);
  }

  // ── Row 2: Toolbar buttons ──

  private renderWidthSelect(
    toolbar: HTMLElement,
    entry: ToolbarViewEntry | undefined,
    config: ViewConfig | undefined,
    actions: ToolbarActions
  ): void {
    const current = config?.displayWidth || "default";
    const next = current === "wide" ? "default" : "wide";
    const btn = this.createIconButton(toolbar, "", current === "wide" ? t("toolbar.defaultWidth") : t("toolbar.wide"), "db-width-toggle-btn");
    appendSvg(btn, current === "wide" ? ToolbarRenderer.ICONS.widthIn : ToolbarRenderer.ICONS.widthOut);
    btn.addClass(current === "wide" ? "is-active" : "is-inactive");
    btn.onclick = () => actions.setDisplayWidth(next);
  }

  private renderSearch(toolbar: HTMLElement, state: DatabaseViewState, actions: ToolbarActions): void {
    const wrap = toolbar.createDiv({ cls: `db-search-control${state.searchText ? " is-active" : ""}` });
    const button = wrap.createEl("button", {
      cls: "db-search-button",
      attr: { type: "button" },
    });
    setIcon(button, "search");
    setTooltip(button, t("common.search"), { delay: 100 });
    const searchInput = wrap.createEl("input", {
      cls: "db-search-input",
      attr: { type: "text", placeholder: t("common.search"), "aria-label": t("common.search") },
    });
    searchInput.value = state.searchText;
    button.onclick = () => {
      wrap.addClass("is-active");
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          searchInput.focus();
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        });
      });
    };
    button.onmousedown = (event) => {
      event.preventDefault();
    };
    searchInput.addEventListener("focus", () => {
      wrap.addClass("is-active");
      actions.onSearchFocus?.();
    });
    searchInput.addEventListener("input", () => {
      wrap.toggleClass("is-active", searchInput.value.length > 0 || window.activeDocument.activeElement === searchInput);
      actions.setSearchText(searchInput.value);
    });
    searchInput.addEventListener("blur", () => {
      if (!searchInput.value) wrap.removeClass("is-active");
    });
  }

  private attachDescriptionScrollState(descEl: HTMLElement): void {
    descEl.addEventListener("scroll", () => {
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

  private renderGroupSelect(
    toolbar: HTMLElement,
    config: ViewConfig | undefined,
    state: DatabaseViewState,
    actions: ToolbarActions
  ): string {
    const currentViewType = config?.viewType || "table";
    const groupValue = config ? this.resolveGroupValue(config, currentViewType, state) : state.groupByField;
    const btn = this.createIconButton(toolbar, "", t("toolbar.group"), "db-group-btn");
    appendSvg(btn, ToolbarRenderer.ICONS.group);
    if (groupValue) btn.addClass("is-active");
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!config) return;
      actions.closeToolbarPopovers?.();
      this.closeDatabasePopover();
      this.closeViewTabPopover();
      this.closeExportPopover();
      this.closeTitleActionsPopover();
      this.renderGroupPopover(btn, config, currentViewType, actions, state);
    };
    return groupValue || "";
  }

  private resolveGroupValue(
    config: ViewConfig,
    viewType: DatabaseViewType,
    state: DatabaseViewState
  ): string {
    return viewType === "board"
      ? config.boardGroupField || ""
      : state.groupByField || "";
  }

  private renderGroupPopover(
    anchorEl: HTMLElement,
    config: ViewConfig,
    currentViewType: DatabaseViewType,
    actions: ToolbarActions,
    state: DatabaseViewState
  ): void {
    const root = anchorEl.closest(".note-database-container");
    if (!root) return;
    if (this.groupPopover?.isConnected) {
      this.closeGroupPopover();
      return;
    }

    const panel = root.createDiv({ cls: "db-group-popover" });
    this.groupPopover = panel;
    this.groupPopoverConfig = config;
    this.groupPopoverViewType = currentViewType;
    this.groupPopoverActions = actions;
    this.groupPopoverState = state;

    const groupValue = this.resolveGroupValue(config, currentViewType, state);
    this.populateGroupPopover(panel, config, currentViewType, groupValue, actions);

    positionToolbarPopover(panel, anchorEl);
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (this.isGroupPopoverActiveTarget(target, panel, anchorEl)) return;
      this.closeGroupPopover();
    };
    const popoverTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    const removeAutoClose = installPopoverAutoClose({
      panel,
      anchorEl,
      close: () => this.closeGroupPopover(),
      isActiveTarget: (target) => this.isGroupPopoverActiveTarget(target, panel, anchorEl),
    });
    this.removeGroupPopoverListener = () => {
      window.clearTimeout(popoverTimer);
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      removeAutoClose();
    };
  }

  private isGroupPopoverActiveTarget(target: EventTarget | null, panel: HTMLElement, anchorEl: HTMLElement): boolean {
    if (!(target instanceof Node)) return false;
    if (panel.contains(target) || anchorEl.contains(target)) return true;
    const element = isHTMLElement(target) ? target : target.parentElement;
    return element?.closest(".db-group-row-limit-dropdown-popover") != null;
  }

  private populateGroupPopover(
    panel: HTMLElement,
    config: ViewConfig,
    currentViewType: DatabaseViewType,
    groupValue: string,
    actions: ToolbarActions
  ): void {
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("toolbar.group") });

    const groupColumn = config.schema.columns.find((col) => col.key === groupValue);
    if (groupValue && groupColumn) {
      this.renderGroupPopoverSection(panel, t("toolbar.groupOptions"));
      if (isEmptyGroupVisibilityColumn(config, groupColumn)) {
        this.renderGroupVisibilitySwitch(panel, config, groupValue, actions);
      }
      if (groupColumn.type === "datetime") {
        this.renderGroupDateModeSwitch(panel, config, groupValue, actions);
      }
      if (currentViewType === "board") {
        this.renderBoardSubgroupSwitch(panel, config, actions);
      }
      this.renderGroupRowLimitRow(panel, config, actions);
      this.addGroupOrderRows(panel, config, groupColumn, actions);
    }

    this.renderGroupPopoverSection(panel, t("toolbar.groupBy"));
    if (currentViewType !== "board") {
      this.renderGroupPopoverRow(panel, {
        label: t("common.noGroup"),
        token: "–",
        active: !groupValue,
        onClick: () => actions.setGroupByField(""),
      });
    }
    for (const col of config.schema.columns) {
      this.renderGroupPopoverRow(panel, {
        label: col.label,
        column: col,
        active: groupValue === col.key,
        onClick: () => actions.setGroupByField(col.key),
      });
    }
    if (currentViewType === "board" && this.isBoardSubgroupEnabled(config)) {
      this.renderBoardSubgroupSection(panel, config, groupValue, actions);
    }
  }

  private rebuildGroupPopover(): void {
    const panel = this.groupPopover;
    if (!panel?.isConnected) return;
    const config = this.groupPopoverConfig;
    const viewType = this.groupPopoverViewType;
    const actions = this.groupPopoverActions;
    const state = this.groupPopoverState;
    if (!config || !viewType || !actions || !state) return;

    const scrollTop = panel.scrollTop;
    panel.empty();

    const groupValue = this.resolveGroupValue(config, viewType, state);

    this.populateGroupPopover(panel, config, viewType, groupValue, actions);
    panel.scrollTop = scrollTop;
  }

  private renderGroupPopoverSection(panel: HTMLElement, title: string): void {
    panel.createDiv({ cls: "db-group-popover-section-title", text: title });
  }

  private renderGroupPopoverRow(
    panel: HTMLElement,
    options: { label: string; token?: string; icon?: string; column?: ColumnDef; active?: boolean; onClick(): void }
  ): void {
    const row = panel.createEl("button", {
      cls: `db-group-popover-row${options.active ? " is-active" : ""}`,
      attr: { type: "button" },
    });
    const marker = row.createSpan({ cls: "db-group-popover-marker" });
    if (options.icon) setIcon(marker, options.icon);
    else if (options.column) renderPropertyTypeIcon(marker, options.column);
    else marker.createSpan({ cls: "db-property-icon db-property-icon-text", text: options.token || "" });
    row.createSpan({ cls: "db-group-popover-label", text: options.label });
    if (options.active) setIcon(row.createSpan({ cls: "db-group-popover-check" }), "check");
    row.onclick = () => {
      options.onClick();
      this.rebuildGroupPopover();
    };
  }

  private renderGroupVisibilitySwitch(
    panel: HTMLElement,
    config: ViewConfig,
    field: string,
    actions: ToolbarActions
  ): void {
    const row = panel.createEl("label", { cls: "db-group-popover-row db-group-popover-switch-row" });
    const marker = row.createSpan({ cls: "db-group-popover-marker" });
    setIcon(marker, "eye");
    row.createSpan({ cls: "db-group-popover-label", text: t("toolbar.showEmptyGroup") });
    const input = row.createEl("input", { cls: "db-toggle-switch", attr: { type: "checkbox", role: "switch" } });
    input.checked = shouldShowEmptyGroups(config, field);
    input.onchange = (event) => {
      event.stopPropagation();
      actions.setShowEmptyGroups(field, input.checked);
      this.rebuildGroupPopover();
    };
    input.onclick = (event) => event.stopPropagation();
  }

  private renderGroupDateModeSwitch(
    panel: HTMLElement,
    config: ViewConfig,
    field: string,
    actions: ToolbarActions
  ): void {
    const row = panel.createEl("label", { cls: "db-group-popover-row db-group-popover-switch-row" });
    const marker = row.createSpan({ cls: "db-group-popover-marker" });
    setIcon(marker, "clock");
    row.createSpan({ cls: "db-group-popover-label", text: t("viewConfig.dateGroupIgnoreTime") });
    const input = row.createEl("input", { cls: "db-toggle-switch", attr: { type: "checkbox", role: "switch" } });
    input.checked = getDateGroupMode(config, field) === "date";
    input.onchange = (event) => {
      event.stopPropagation();
      actions.setGroupDateMode(field, input.checked ? "date" : "exact");
      this.rebuildGroupPopover();
    };
    input.onclick = (event) => event.stopPropagation();
  }

  private renderGroupRowLimitRow(panel: HTMLElement, config: ViewConfig, actions: ToolbarActions): void {
    const current = config.groupRowLimit || 0;
    const presets = [10, 25, 50, 100];
    const isPreset = presets.includes(current);
    const customActive = this.groupRowLimitEditingCustom || (!isPreset && current > 0);
    const options: DropdownOption[] = [
      { value: "0", text: t("viewConfig.groupRowLimitUnlimited") },
      ...presets.map((value) => ({ value: String(value), text: String(value) })),
      { value: "custom", text: t("viewConfig.groupRowLimitCustom") },
    ];
    const value = customActive ? "custom" : String(current);
    createDropdownField({
      parent: panel,
      label: t("viewConfig.groupRowLimit"),
      options,
      value,
      onChange: (value) => {
        const custom = value === "custom";
        this.groupRowLimitEditingCustom = custom;
        this.groupRowLimitFocusCustomInput = custom;
        actions.setGroupRowLimit(custom ? (current > 0 ? current : 25) : Number(value) || 0);
        this.rebuildGroupPopover();
      },
      icon: "list-filter",
      className: "db-group-popover-row db-group-row-limit-select-row",
      popoverClassName: "db-group-row-limit-dropdown-popover",
    });
    if (customActive) {
      const row = panel.createDiv({ cls: "db-group-popover-row db-group-row-limit-custom-row" });
      row.createSpan({ cls: "db-group-popover-marker" });
      row.createSpan({ cls: "db-group-popover-label", text: t("viewConfig.groupRowLimitCustom") });
      const input = row.createEl("input", {
        cls: "db-view-config-number db-group-row-limit-input",
        attr: { type: "number", min: "1", max: "500" },
      });
      input.value = String(current);
      input.onclick = (event) => event.stopPropagation();
      input.onchange = () => {
        const n = Math.max(1, Math.round(Number(input.value) || 0));
        this.groupRowLimitEditingCustom = true;
        actions.setGroupRowLimit(n);
        this.rebuildGroupPopover();
      };
      if (this.groupRowLimitFocusCustomInput) {
        this.groupRowLimitFocusCustomInput = false;
        window.setTimeout(() => {
          input.focus();
          input.select();
        }, 0);
      }
    }
  }

  private renderBoardSubgroupSwitch(
    panel: HTMLElement,
    config: ViewConfig,
    actions: ToolbarActions
  ): void {
    const row = panel.createEl("label", { cls: "db-group-popover-row db-group-popover-switch-row" });
    const marker = row.createSpan({ cls: "db-group-popover-marker" });
    setIcon(marker, "layout-list");
    row.createSpan({ cls: "db-group-popover-label", text: t("toolbar.enableBoardSubgroups") });
    const input = row.createEl("input", { cls: "db-toggle-switch", attr: { type: "checkbox", role: "switch" } });
    input.checked = this.isBoardSubgroupEnabled(config);
    input.onchange = (event) => {
      event.stopPropagation();
      actions.setBoardSubgroupEnabled(input.checked);
      this.rebuildGroupPopover();
    };
    input.onclick = (event) => event.stopPropagation();
  }

  private renderBoardSubgroupSection(
    panel: HTMLElement,
    config: ViewConfig,
    groupValue: string,
    actions: ToolbarActions
  ): void {
    this.renderGroupPopoverSection(panel, t("toolbar.subgroupBy"));
    const candidates = this.getBoardSubgroupCandidates(config, groupValue);
    const subgroupField = config.boardSubgroupField || "";
    const hasActiveSubgroup = candidates.some((col) => col.key === subgroupField);
    if (candidates.length === 0) {
      this.renderGroupPopoverNotice(panel, t("toolbar.noAvailableBoardSubgroupFields"), "info");
      return;
    }
    if (!hasActiveSubgroup) {
      this.renderGroupPopoverNotice(panel, t("toolbar.selectBoardSubgroupField"), "info");
    }
    for (const col of candidates) {
      this.renderGroupPopoverRow(panel, {
        label: col.label,
        column: col,
        active: subgroupField === col.key,
        onClick: () => actions.setBoardSubgroupField(col.key),
      });
    }
  }

  private renderGroupPopoverNotice(panel: HTMLElement, label: string, icon: string): void {
    const row = panel.createDiv({ cls: "db-group-popover-row is-disabled" });
    const marker = row.createSpan({ cls: "db-group-popover-marker" });
    setIcon(marker, icon);
    row.createSpan({ cls: "db-group-popover-label", text: label });
  }

  private isBoardSubgroupEnabled(config: ViewConfig): boolean {
    return config.boardSubgroupEnabled === true || Boolean(config.boardSubgroupField);
  }

  private getBoardSubgroupCandidates(config: ViewConfig, groupValue: string): ColumnDef[] {
    return config.schema.columns.filter((col) => col.key !== "file.name" && col.key !== groupValue);
  }

  private addGroupOrderRows(panel: HTMLElement, config: ViewConfig, col: ColumnDef, actions: ToolbarActions): void {
    const add = (title: string, mode: GroupOrderMode, icon: string) => {
      this.renderGroupPopoverRow(panel, { label: title, icon, onClick: () => actions.setGroupOrderMode(mode) });
    };
    const type = this.getEffectiveGroupOrderType(config, col);
    if (type === "number") {
      add(t("groupOrder.numberAsc"), "number-asc", "arrow-up-0-1");
      add(t("groupOrder.numberDesc"), "number-desc", "arrow-down-1-0");
    } else if (type === "currency") {
      add(t("groupOrder.currencyAsc"), "number-asc", "arrow-up-0-1");
      add(t("groupOrder.currencyDesc"), "number-desc", "arrow-down-1-0");
    } else if (isDateLikeColumnType(type)) {
      add(t("groupOrder.dateAsc"), "date-asc", "calendar-arrow-up");
      add(t("groupOrder.dateDesc"), "date-desc", "calendar-arrow-down");
    } else if (type === "checkbox") {
      add(t("groupOrder.checkboxFalseFirst"), "checkbox-false-first", "square");
      add(t("groupOrder.checkboxTrueFirst"), "checkbox-true-first", "check-square");
    } else if (type === "select" || type === "status") {
      add(t("groupOrder.optionAsc"), "option-asc", "list-ordered");
      add(t("groupOrder.optionDesc"), "option-desc", "list-end");
      this.renderGroupPopoverRow(panel, { label: t("groupOrder.custom"), icon: "arrow-up-down", onClick: () => actions.configureGroupOrder() });
    } else if (type === "multi-select") {
      add(t("groupOrder.multiSelectPriority"), "multi-select-priority", "list-tree");
      this.renderGroupPopoverRow(panel, { label: t("groupOrder.custom"), icon: "arrow-up-down", onClick: () => actions.configureGroupOrder() });
    } else {
      add(t("groupOrder.textAsc"), "text-asc", "arrow-up-a-z");
      add(t("groupOrder.textDesc"), "text-desc", "arrow-down-z-a");
      this.renderGroupPopoverRow(panel, { label: t("groupOrder.custom"), icon: "arrow-up-down", onClick: () => actions.configureGroupOrder() });
    }
  }

  private getEffectiveGroupOrderType(config: ViewConfig, col: ColumnDef): ColumnDef["type"] {
    if (col.type === "rollup") return getColumnDisplayType(col, config.schema.computedFields);
    if (col.type !== "computed") return col.type;
    const computedKey = col.computedKey || col.key;
    const computedDef = config.schema.computedFields.find((field) => field.key === computedKey);
    return computedDef?.type || "text";
  }

  private closeGroupPopover(): void {
    this.removeGroupPopoverListener?.();
    this.removeGroupPopoverListener = undefined;
    this.groupRowLimitEditingCustom = false;
    this.groupRowLimitFocusCustomInput = false;
    this.groupPopover?.remove();
    this.groupPopover = undefined;
  }

  private closeViewTabPopover(): void {
    this.removeViewTabPopoverListener?.();
    this.removeViewTabPopoverListener = undefined;
    this.viewTabPopover?.remove();
    this.viewTabPopover = undefined;
  }

  private closeExportPopover(): void {
    this.removeExportPopoverListener?.();
    this.removeExportPopoverListener = undefined;
    this.exportPopover?.remove();
    this.exportPopover = undefined;
  }

  private closeTitleActionsPopover(): void {
    this.removeTitleActionsPopoverListener?.();
    this.removeTitleActionsPopoverListener = undefined;
    this.titleActionsPopover?.remove();
    this.titleActionsPopover = undefined;
  }

  private closeDatabasePopover(): void {
    this.removeDatabasePopoverListener?.();
    this.removeDatabasePopoverListener = undefined;
    this.databasePopover?.remove();
    this.databasePopover = undefined;
    this.draggedDatabaseIndex = null;
  }

  private renderFilterButton(toolbar: HTMLElement, state: DatabaseViewState, actions: ToolbarActions): void {
    const count = getEffectiveFilterRules(state.filters).length;
    const filterBtn = this.createIconButton(toolbar, "list-filter", t("toolbar.filter"), "db-filter-btn db-toolbar-badge-button");
    this.setBadge(filterBtn, count);
    filterBtn.onclick = () => {
      this.closeDatabasePopover();
      this.closeGroupPopover();
      this.closeViewTabPopover();
      this.closeExportPopover();
      this.closeTitleActionsPopover();
      actions.toggleFilterPanel(filterBtn);
    };
  }

  private renderSortButton(toolbar: HTMLElement, state: DatabaseViewState, actions: ToolbarActions): void {
    const count = this.getSortRuleCount(state);
    const sortBtn = this.createIconButton(toolbar, "arrow-up-down", t("toolbar.sort"), "db-sort-btn db-toolbar-badge-button");
    this.setBadge(sortBtn, count);
    sortBtn.onclick = () => {
      this.closeDatabasePopover();
      this.closeGroupPopover();
      this.closeViewTabPopover();
      this.closeExportPopover();
      this.closeTitleActionsPopover();
      actions.toggleSortPanel(sortBtn);
    };
  }

  private renderViewConfigButton(toolbar: HTMLElement, actions: ToolbarActions): void {
    const btn = this.createIconButton(toolbar, "", t("toolbar.settings"), "db-view-config-btn");
    appendSvg(btn, ToolbarRenderer.ICONS.settings);
    btn.onclick = () => {
      this.closeDatabasePopover();
      this.closeGroupPopover();
      this.closeViewTabPopover();
      this.closeExportPopover();
      this.closeTitleActionsPopover();
      actions.toggleViewConfig(btn);
    };
  }

  private renderChartOptionsButton(toolbar: HTMLElement, actions: ToolbarActions): void {
    const btn = this.createIconButton(toolbar, "", t("chart.options"), "db-chart-options-toolbar-btn");
    this.appendViewSettingsIcon(btn, this.getViewTypeIcon("chart"));

    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeDatabasePopover();
      this.closeGroupPopover();
      this.closeViewTabPopover();
      this.closeExportPopover();
      this.closeTitleActionsPopover();
      actions.toggleChartOptions?.(btn);
    };
  }

  private getSortRuleCount(state: DatabaseViewState): number {
    return state.sortRules.filter((rule) => rule.field && rule.direction).length ||
    (state.sortColumn ? 1 : 0);
  }

  private renderColumnButton(toolbar: HTMLElement, config: ViewConfig | undefined, state: DatabaseViewState, actions: ToolbarActions): void {
    const colBtn = this.createIconButton(toolbar, "columns-3", t("toolbar.properties"), "db-col-manager-btn db-toolbar-badge-button");
    const visibleCount = Math.max(0, (config?.schema.columns.length || 0) - state.hiddenColumns.size);
    this.setBadge(colBtn, visibleCount);
    colBtn.onclick = () => {
      this.closeDatabasePopover();
      this.closeGroupPopover();
      this.closeViewTabPopover();
      this.closeExportPopover();
      this.closeTitleActionsPopover();
      actions.toggleColumnManager(colBtn);
    };
  }

  private renderExportButton(toolbar: HTMLElement, actions: ToolbarActions): void {
    if (!actions.exportData && !actions.copyViewCode && !actions.exportCsvMarkdownZip) return;
    const btn = this.createIconButton(toolbar, "", t("toolbar.copyFormats"), "db-export-btn");
    appendSvg(btn, ToolbarRenderer.ICONS.copy);
    btn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeDatabasePopover();
      this.closeGroupPopover();
      this.closeViewTabPopover();
      this.closeTitleActionsPopover();
      actions.closeToolbarPopovers?.();
      this.renderExportPopover(btn, actions);
    };
  }

  private renderExportPopover(anchorEl: HTMLElement, actions: ToolbarActions): void {
    const root = anchorEl.closest(".note-database-container");
    if (!root) return;
    if (this.exportPopover?.isConnected) {
      this.closeExportPopover();
      return;
    }
    const panel = root.createDiv({ cls: "db-export-popover" });
    this.exportPopover = panel;
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("toolbar.copyFormats") });
    if (actions.copyViewCode) {
      this.renderExportPopoverRow(panel, t("toolbar.copyViewCode"), "code-xml", () => actions.copyViewCode?.());
    }
    if (actions.exportData) {
      this.renderExportPopoverRow(panel, t("toolbar.copyCsv"), "table", () => actions.exportData?.("csv"));
      this.renderExportPopoverRow(panel, t("toolbar.copyMarkdown"), "file-text", () => actions.exportData?.("markdown"));
    }
    if (actions.exportCsvMarkdownZip) {
      this.renderExportPopoverRow(panel, t("toolbar.exportCsvMarkdownZip"), "archive", () => actions.exportCsvMarkdownZip?.());
    }
    positionToolbarPopover(panel, anchorEl);
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (panel.contains(target) || anchorEl.contains(target))) return;
      this.closeExportPopover();
    };
    const popoverTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    const removeAutoClose = installPopoverAutoClose({ panel, anchorEl, close: () => this.closeExportPopover() });
    this.removeExportPopoverListener = () => {
      window.clearTimeout(popoverTimer);
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      removeAutoClose();
    };
  }

  private renderExportPopoverRow(panel: HTMLElement, label: string, icon: string, onClick: () => void): void {
    const row = panel.createEl("button", {
      cls: "db-export-popover-row",
      attr: { type: "button" },
    });
    setIcon(row.createSpan({ cls: "db-export-popover-marker" }), icon);
    row.createSpan({ cls: "db-export-popover-label", text: label });
    row.onclick = () => {
      this.closeExportPopover();
      onClick();
    };
  }

  private renderNewButton(toolbar: HTMLElement, actions: ToolbarActions): void {
    const newBtn = toolbar.createEl("button", {
      cls: "db-new-button",
      attr: { "aria-label": t("toolbar.new") },
    });
    setIcon(newBtn.createSpan({ cls: "db-new-button-icon" }), "plus");
    newBtn.createSpan({ text: t("toolbar.new") });
    newBtn.onclick = () => actions.createEntry();
  }

  private renderFullViewButton(toolbar: HTMLElement, actions: ToolbarActions): void {
    if (!actions.openFullView) return;
    const fullBtn = toolbar.createEl("button", {
      cls: "db-toolbar-icon-button db-full-view-btn",
      attr: {},
    });
    setIcon(fullBtn, "maximize-2");
    setTooltip(fullBtn, t("toolbar.openFullView"), { delay: 100 });
    fullBtn.onclick = () => actions.openFullView?.();
  }

  private renderHeaderChromeButton(toolbar: HTMLElement, actions: ToolbarActions, hidden: boolean): void {
    const label = hidden ? t("toolbar.showEmbedHeader") : t("toolbar.hideEmbedHeader");
    const btn = this.createIconButton(toolbar, hidden ? "chevron-down" : "chevron-up", label, "db-embed-header-inline-toggle");
    btn.onclick = () => actions.toggleHeaderChrome?.(!hidden);
  }

  private renderDatabaseFileButton(toolbar: HTMLElement, actions: ToolbarActions): void {
    const btn = toolbar.createEl("button", {
      cls: "db-toolbar-icon-button",
      attr: {},
    });
    setIcon(btn, "file-output");
    setTooltip(btn, t("toolbar.openDatabaseFile"), { delay: 100 });
    btn.onclick = () => actions.openDatabaseFile?.();
  }

  private createIconButton(toolbar: HTMLElement, icon: string, label: string, extraClass = ""): HTMLButtonElement {
    const btn = toolbar.createEl("button", {
      cls: `db-toolbar-icon-button ${extraClass}`.trim(),
      attr: {},
    });
    if (icon) setIcon(btn, icon);
    setTooltip(btn, label, { delay: 100 });
    return btn;
  }

  private appendCompositeIcon(
    button: HTMLElement,
    mainIcon: string,
    badgeSvg: string,
    extraClass = ""
  ): void {
    const wrap = button.createSpan({
      cls: `db-composite-icon ${extraClass}`.trim(),
    });

    setIcon(wrap.createSpan({ cls: "db-composite-icon-main" }), mainIcon);
    appendSvg(wrap.createSpan({ cls: "db-composite-icon-badge" }), badgeSvg);
  }

  private appendViewSettingsIcon(button: HTMLElement, viewIcon: string): void {
    this.appendCompositeIcon(
      button,
      viewIcon,
      ToolbarRenderer.ICONS.settingsBadge,
      "db-view-settings-icon"
    );
  }

  private setBadge(button: HTMLElement, count: number): void {
    if (count <= 0) return;
    button.createSpan({ cls: "db-toolbar-badge", text: String(count) });
  }

  private markLatestMenu(className: string, icons?: string[]): void {
    window.requestAnimationFrame(() => {
      const menus = Array.from(window.activeDocument.querySelectorAll(".menu"));
      const menu = menus[menus.length - 1];
      if (!menu) return;
      menu.addClass(className);
      if (!icons?.length) return;
      const iconEls = Array.from(menu.querySelectorAll<HTMLElement>(".menu-item-icon"));
      iconEls.forEach((el, index) => {
        if (icons[index]) appendSvg(el, icons[index]);
      });
    });
  }

  closePopovers(): void {
    this.closeDatabasePopover();
    this.closeGroupPopover();
    this.closeViewTabPopover();
    this.closeExportPopover();
    this.closeTitleActionsPopover();
    this.calendarTimelineToolbarRenderer.closePopover();
  }

  private static readonly ICONS = {
    widthIn: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-arrows-move-horizontal"><path d="M3 5v14" /><path d="M21 5v14" /><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M17 9l-3 3l3 3" /><path d="M21 12h-7" /><path d="M7 9l3 3l-3 3" /><path d="M3 12h7" /></svg>`,
    widthOut: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-arrows-move-horizontal"><path d="M3 5v14" /><path d="M21 5v14" /><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M18 9l3 3l-3 3" /><path d="M14 12h7" /><path d="M6 9l-3 3l3 3" /><path d="M3 12h7" /></svg>`,
    copy: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-clipboard-copy"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h3m9 -9v-5a2 2 0 0 0 -2 -2h-2" /><path d="M13 17v-1a1 1 0 0 1 1 -1h1m3 0h1a1 1 0 0 1 1 1v1m0 3v1a1 1 0 0 1 -1 1h-1m-3 0h-1a1 1 0 0 1 -1 -1v-1" /><path d="M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2" /></svg>',
    code: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-code"><path d="M7 8l-4 4l4 4"/><path d="M17 8l4 4l-4 4"/><path d="M14 4l-4 16"/></svg>`,
    csv: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-table"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16"/><path d="M9 5v14"/><path d="M15 5v14"/></svg>`,
    markdown: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-markdown"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15v-6l3 4l3-4v6"/><path d="M16 9v6"/><path d="M14 13l2 2l2-2"/></svg>`,
    settings: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-settings-cog"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12.003 21c-.732 .001 -1.465 -.438 -1.678 -1.317a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c.886 .215 1.325 .957 1.318 1.694" /><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><path d="M17.001 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M19.001 15.5v1.5" /><path d="M19.001 21v1.5" /><path d="M22.032 17.25l-1.299 .75" /><path d="M17.27 20l-1.3 .75" /><path d="M15.97 17.25l1.3 .75" /><path d="M20.733 20l1.3 .75" /></svg>',
    settingsBadge: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-gear"> <path d="M3.001 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /> <path d="M5.001 1.5v1.5" /> <path d="M5.001 7v1.5" /> <path d="M8.032 3.25l-1.299 .75" /> <path d="M3.27 6l-1.3 .75" /> <path d="M1.97 3.25l1.3 .75" /> <path d="M6.733 6l1.3 .75" /></svg>',
    group: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-custom-group-fields"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M5 6v12" /><path d="M5 9h3" /><path d="M5 15h3" /><rect x="9" y="5" width="10" height="5" rx="1.5" /><rect x="9" y="14" width="10" height="5" rx="1.5" /></svg>',
    refresh_fx: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="icon icon-custom-recalculate-badge"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M15 7a7 7 0 1 0 2 5"/><path d="M15 4v4h-4"/><g transform="translate(12 10)"><g transform="scale(0.6)" stroke-width="4"><path d="M6.5 5.5h10.5l-5.5 6.5l5.5 6.5h-10.5"/></g></g></svg>',
  };
}
