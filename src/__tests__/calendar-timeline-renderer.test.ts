import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("calendar and timeline render integration", () => {
  it("keeps calendar overflow popovers at least as informative as collapsed events", () => {
    const calendarRenderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const dayPopover = calendarRenderer.slice(
      calendarRenderer.indexOf("private createDayPopover("),
      calendarRenderer.indexOf("private positionDayPopover("),
    );
    const allDayPopover = calendarRenderer.slice(
      calendarRenderer.indexOf("private createAllDayOverflowPopover("),
      calendarRenderer.indexOf("private renderTimeGrid("),
    );

    expect(dayPopover).toContain("db-calendar-month-dates");
    // D1: datetime 跨天事件附时间分量；date 跨天仍纯日期范围
    expect(dayPopover).toContain("this.formatMonthDateRange(event.startDateKey, event.endDateKey, event.startMinutes, event.endMinutes)");
    expect(allDayPopover).toContain("db-calendar-month-dates");
    expect(allDayPopover).toContain("this.formatMonthDateRange(event.startDateKey, event.endDateKey, event.startMinutes, event.endMinutes)");
    expect(cssRule(styles, ".note-database-container .db-calendar-day .db-calendar-day-popover")).toContain("max-width: min(520px, calc(100vw - 32px))");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-popover")).toContain("max-width: min(520px, calc(100vw - 32px))");
    expect(cssRule(styles, ".note-database-container .db-calendar-day-popover-events .db-calendar-month-segment")).toContain("flex-wrap: wrap");
    expect(cssRule(styles, ".note-database-container .db-calendar-day-popover-events .db-calendar-month-title")).toContain("word-break: normal");
    expect(cssRule(styles, ".note-database-container .db-calendar-day-popover-events .db-calendar-month-dates")).toContain("white-space: nowrap");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-title")).toContain("flex: 1 0 min(8ch, 100%)");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-dates")).toContain("flex: 0 1 auto");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-dates")).not.toContain("max-width: min(24ch, 55%)");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-dates")).toContain("text-overflow: ellipsis");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-time")).toContain("flex: 0 1 auto");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-event-title")).toContain("white-space: normal");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-event-title")).toContain("-webkit-line-clamp: 2");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-timed-event.is-compact .db-calendar-week-event-title")).toContain("white-space: nowrap");
  });

  it("opens calendar day view from week headers by double click or mobile context menu", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    const calendarRenderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(calendarRenderer).not.toContain("confirmSwitchToDayView");
    expect(dashboard).not.toContain("confirmSwitchToDayView");
    expect(embedded).not.toContain("confirmSwitchToDayView");
    expect(embedded).not.toContain("from \"./modals/ConfirmModal\"");
    expect(calendarRenderer).toContain("attachDayViewNavigation");
    expect(calendarRenderer).toContain("button.ondblclick = (event) =>");
    expect(calendarRenderer).toContain("dateButton.ondblclick = (event) =>");
    expect(calendarRenderer).toContain("button.oncontextmenu = (event) =>");
    expect(calendarRenderer).toContain("dateButton.oncontextmenu = (event) =>");
    expect(calendarRenderer).toContain("new Menu()");
    expect(calendarRenderer).toContain("calendar.openDayView");
    expect(calendarRenderer).not.toContain("button.onclick = () => this.openDayFromTimeHeader");
    expect(calendarRenderer).not.toContain("dateButton.onclick = (event) => {\n\t\t\t\tevent.preventDefault();\n\t\t\t\tevent.stopPropagation();\n\t\t\t\tthis.openDayFromTimeHeader");
    expect(i18n).toContain("\"calendar.openDayView\"");
  });

  it("wires calendar and timeline renderers into dashboard and embedded views", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    const calendarRenderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    const miniCalendarRenderer = readFileSync(new URL("../views/CalendarMiniCalendarRenderer.ts", import.meta.url), "utf8");
    const interactionModel = readFileSync(new URL("../data/CalendarInteractionModel.ts", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const calendarTimelineToolbar = readFileSync(new URL("../views/CalendarTimelineToolbarRenderer.ts", import.meta.url), "utf8");

    expect(dashboard).toContain("private calendarTimelineRenderer = new CalendarTimelineRenderer");
    expect(dashboard).toContain("this.calendarRenderer.render");
    expect(dashboard).toContain("this.calendarTimelineRenderer.renderTimeline");
    expect(dashboard).toContain("getTimelineRenderConfig");
    expect(dashboard).not.toContain("config.timelineGroupField = this.vs().groupByField || config.timelineGroupField");
    // timelineGroupField 只跟 state.groupByField（「无分组」空串不能再被 `||`
    // 回退到历史 config.timelineGroupField，否则「未分组」无法生效）。
    expect(dashboard).toContain("timelineGroupField: state.groupByField,");
    expect(dashboard).toContain("sortColumn: state.sortColumn");
    expect(dashboard).toContain("sortRules: state.sortRules");
    expect(dashboard).toContain("updateTimelineAnchor: (dateKey, label, timeMinutes) => this.updateTimelineAnchor(dateKey, label, timeMinutes)");
    expect(dashboard).toContain('this.refresh({ viewport: "preserve-raw" })');
    expect(dashboard).toContain("resolveDatabaseViewportMode");
    expect(embedded).toContain('this.renderResults(config, { viewport: "preserve-raw" })');
    expect(dashboard).toContain("updateTimelineScale: (scale, label) => this.updateTimelineScale(scale, label)");
    expect(dashboard).toContain("if (scale === \"day\" && !await this.ensureTimelineDayDateTimeFields(config)) return false;");
    expect(dashboard).toContain("private async ensureTimelineDayDateTimeFields(config: ViewConfig): Promise<boolean>");
    expect(dashboard).toContain("getTimelineDayNonDateTimeColumns(config)");
    expect(dashboard).toContain("return this.ensureCalendarTimelineDateTimeFields(nonDateTimeColumns)");
    expect(renderer).toContain("normalizeTimelineDayScale(config)");
    expect(renderer).toContain("this.actions.onConfigChange?.(t(\"undo.timelineScaleConfig\"))");
    expect(calendarTimelineToolbar).toContain("normalizeTimelineDayScale(config)");
    expect(dashboard).toContain("if (!this.containerEl_) return;\n\n    if (config.viewType === \"board\")");
    expect(dashboard).toContain("createEntryForDate");
    expect(dashboard).toContain("createEntryForDate: (config, dateKey, options) => { void this.createCalendarTimelineEntry(config, dateKey, options); }");
    expect(dashboard).toContain("applyCalendarTimelineCreateGroupDefaults");
    expect(dashboard).toContain("defaults[writeKey]");
    expect(dashboard).toContain("updateEventDates");
    expect(dashboard).toContain("reorderTimelineEvent");
    expect(dashboard).toContain("moveTimelineEventToGroup");
    expect(dashboard).toContain("isGroupCollapsed: (field, key) => this.isGroupCollapsed(this.getConfig(), field, key)");
    expect(dashboard).toContain("toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.getConfig(), field, key)");
    expect(dashboard).toContain("showRowMenu: (event, row) => this.rowMenu.show(event, row)");
    expect(dashboard).toContain("createCalendarTimelineEntry");
    expect(dashboard).toContain("pendingCalendarTimelineCreates");
    expect(dashboard).toContain("type: \"created\"");
    expect(dashboard).toContain("undoCreatedEntry");
    expect(dashboard).toContain("calendarStartDateField || getDefaultEventDateField(config)");
    expect(dashboard).toContain("updateCalendarTimelineDates");
    expect(dashboard).toContain("ensureCalendarTimelineDateTimeFields");
    expect(dashboard).toContain("const writeStart = changes.changedEdge !== \"end\"");
    expect(dashboard).toContain("const writeEnd = changes.changedEdge !== \"start\"");
    expect(dashboard).toContain("confirmWithModal(this.app, {");
    expect(dashboard).toContain("await this.changeColumnType(col, \"datetime\")");
    expect(dashboard).toContain("this.showCalendarTimelineSameDateFieldNotice(startCol, endCol)");
    expect(dashboard).toContain("applyCellChanges(cellChanges, t(\"undo.timelineDates\"))");
    expect(embedded).toContain("private calendarRenderer = new CalendarRenderer");
    expect(embedded).toContain("this.calendarRenderer.render(target, renderConfig, this.rows)");
    expect(embedded).toContain("this.calendarTimelineRenderer.renderTimeline");
    expect(embedded).toContain("getTimelineInvalidEventCount");
    expect(embedded).toContain("openTimelineInvalidEvents");
    expect(embedded).toContain("isReadOnly: true");
    expect(embedded).toContain("toggleGroupCollapsed: (field, key) => this.toggleGroupCollapsed(this.config, field, key)");
    expect(embedded).toContain("updateTimelineScale: (scale) => this.updateTimelineScale(scale)");
    expect(embedded).toContain("if (scale === \"day\" && getTimelineDayNonDateTimeColumns(config).length > 0)");
    expect(embedded).toContain("new Notice(t(\"timeline.dayRequiresDateTime\"))");
    expect(embedded).toContain("updateCalendarScale: (scale, anchorDateKey) => this.updateCalendarScale(scale, anchorDateKey)");
    expect(embedded).toContain("timelineGroupField: state.groupByField,");
    expect(calendarRenderer).toContain("formatCalendarTitleParts");
    expect(calendarRenderer).toContain("renderCalendarTitle");
    expect(calendarRenderer).toContain("updateCalendarScale?(scale: \"month\" | \"week\" | \"day\", anchorDateKey: string, label?: string): void");
    expect(calendarRenderer).toContain("this.actions.updateCalendarScale(scale, anchor, t(\"undo.calendarScaleConfig\"))");
    expect(calendarRenderer).toContain("CalendarEventDateChange");
    expect(interactionModel).toContain("changedEdge?: \"start\" | \"end\" | \"both\"");
    expect(interactionModel).toContain("resolveDayMoveChange");
    expect(interactionModel).toContain("input.startMinutes != null");
    expect(interactionModel).toContain("input.endMinutes != null && input.endField");
    // all-day resize 的时间保留逻辑已提取到 resolveAllDayResizeChange（E2 修复）
    expect(interactionModel).toContain("resolveAllDayResizeChange");
    expect(interactionModel).toContain("input.mode === \"resize-start\" && input.startMinutes != null");
    expect(interactionModel).toContain("input.mode === \"resize-end\" && input.endMinutes != null && input.endField");
    expect(calendarRenderer).toContain("resolveAllDayResizeChange");
    expect(calendarRenderer).toContain("resolveDayMoveChange");
    expect(calendarRenderer).toContain("db-calendar-title-main");
    expect(calendarRenderer).toContain("db-calendar-title-year");
    expect(calendarRenderer).not.toContain("header.createDiv({ cls: \"db-calendar-title\", text:");
    expect(calendarRenderer).toContain("const TIMED_EVENT_TIME_VISIBILITY_HEIGHT = 42");
    expect(calendarRenderer).toContain("const isCompact = height < TIMED_EVENT_TIME_VISIBILITY_HEIGHT");
    expect(calendarRenderer).toContain("eventEl.toggleClass(\"is-compact\", height < TIMED_EVENT_TIME_VISIBILITY_HEIGHT)");
    expect(calendarRenderer).not.toContain("const isCompact = height < 30");
    expect(calendarRenderer).not.toContain("attr: { role: \"group\", \"aria-label\": t(\"viewConfig.calendarScale\") }");
    expect(calendarRenderer).not.toContain("title: option.text");
    expect(calendarRenderer).not.toContain("title: t(\"viewConfig.calendarScale\")");
    expect(calendarRenderer).not.toContain("\"aria-label\": t(\"viewConfig.calendarScale\")");
    expect(renderer).toContain("CalendarTimelineDateChange");
    expect(renderer).toContain("formatCalendarTitleParts");
    expect(renderer).toContain("renderTimelineTitle");
    expect(renderer).toContain("db-timeline-title-main");
    expect(renderer).toContain("db-timeline-title-year");
    expect(renderer).not.toContain("header.createDiv({ cls: \"db-timeline-title\", text:");
    expect(renderer).toContain("CalendarTimelineCreateOptions");
    expect(renderer).toContain("CalendarEventCreateOptions");
    expect(interactionModel).toContain("endDateKey?: string");
    expect(renderer).toContain("createEntryForDate?(config: ViewConfig, dateKey: string, options?: CalendarTimelineCreateOptions): void");
    expect(renderer).toContain("updateTimelineAnchor?(dateKey: string, label?: string, timeMinutes?: number): void");
    expect(renderer).toContain("updateTimelineScale?(scale: TimelineScale, label?: string): boolean | Promise<boolean> | void");
    expect(renderer).toContain("this.actions.updateTimelineAnchor?.(dateKey, t(\"undo.timelineAnchorConfig\"), timeMinutes)");
    expect(renderer).toContain("await this.actions.updateTimelineScale(scale, t(\"undo.timelineScaleConfig\"))");
    expect(interactionModel).toContain("startTimeMinutes?: number");
    expect(interactionModel).toContain("endTimeMinutes?: number");
    expect(renderer).toContain("showRowMenu?(event: MouseEvent, row: RowData): void");
    expect(renderer).toContain("createEntryForDate");
    expect(renderer).not.toContain("setupCalendarDayDropZone");
    expect(renderer).not.toContain("setupCalendarEventDrag");
    expect(renderer).not.toContain("renderCalendarMobileMenuButton");
    expect(renderer).not.toContain("showCalendarMobileMenu");
    expect(renderer).not.toContain("db-calendar-add-button");
    expect(renderer).not.toContain("db-calendar-mobile-menu-button");
    expect(renderer).not.toContain("db-calendar-drop-snap");
    expect(renderer).not.toContain("application/x-note-database-calendar-event");
    expect(renderer).not.toContain("if (!this.actions.isReadOnly && this.actions.createEntryForDate)");
    expect(renderer).not.toContain("renderCalendarResizeHandle(button");
    // T3：move 专用 HTML5 drag 死代码已删（drop zone / MIME / payload 全清）。
    expect(renderer).not.toContain("application/x-note-database-timeline-event");
    expect(renderer).not.toContain("setupTimelineGroupDropZone");
    expect(renderer).toContain("setupTimelineEventDateDrag");
    expect(renderer).toContain("renderTimelineResizeHandle");
    expect(renderer).toContain("beginTimelineResize");
    expect(renderer).toContain("beginTimelineTimeDrag");
    expect(renderer).toContain("beginTimelineDateDrag");
    // move 入口改为 pointer（mousedown），接收完整 lane/model 上下文。
    expect(renderer).toContain("setupTimelineEventDateDrag(button, eventsEl, config");
    expect(renderer).toContain("this.beginTimelineDateDrag(button, eventsEl, config");
    // U4：date move 用事件真实起始日（originalStartDay，可负）+ deltaDays 算新起始日，
    // 不再用 windowStart + 被夹取的 unit 偏移改写事件真实起始日（QA 问题 6 根因）。
    expect(renderer).toContain("const originalStartDay = dateKeyDaysBetween(windowStartKey, event.startDateKey) ?? 0");
    expect(renderer).toContain("addDateKeyDays(windowStartKey, nextStartDay)");
    expect(renderer).toContain("timelineResizeInProgress");
    expect(renderer).toContain("data-timeline-resize-mode");
    expect(renderer).toContain("handle.addEventListener(\"mousedown\"");
    // U4：beginTimelineResize preview 改用 resolveEventAbsoluteScale 把新日期区间换算成绝对刻度（统一口径）。
    expect(renderer).toContain("startDateKey: nextStartKey, endDateKey: nextEndKey");
    expect(renderer).toContain("CALENDAR_TIME_SNAP_MINUTES");
    expect(renderer).toContain("TIME_SNAP_MINUTES = CALENDAR_TIME_SNAP_MINUTES");
    expect(renderer).toContain("formatTimelineEventMeta");
    expect(renderer).toContain("formatTimelineDayTimeRange");
    expect(renderer).toContain("startTimeMinutes: startDateTime.minutes");
    expect(renderer).toContain("endTimeMinutes: endField ? endDateTime.minutes : undefined");
    expect(renderer).toContain("getTimelineNavigationShiftUnits");
    expect(renderer).toContain("getTimelineShortNavigationShiftUnits");
    expect(renderer).toContain("shiftTimelineAnchorTime");
    expect(renderer).toContain("this.shiftTimeline(config, scale, -1, model, \"short\")");
    expect(renderer).toContain("this.shiftTimeline(config, scale, -1, model, \"long\")");
    expect(renderer).toContain("this.shiftTimeline(config, scale, 1, model, \"short\")");
    expect(renderer).toContain("this.shiftTimeline(config, scale, 1, model, \"long\")");
    expect(renderer).toContain("this.getTimelineRenderUnitWidth(config, scale)");
    expect(renderer).toContain("resolveTimelineUnitWidth(config, scale)");
    expect(renderer).toContain("resolveTimelineViewportUnitCount(width, unitWidth, config.timelineScale || \"week\")");
    expect(renderer).toContain("resolveTimelineViewportUnitSpan(width, unitWidth)");
    expect(renderer).toContain("getTimelineViewportContentWidth(rect.width || container.clientWidth || 0, paddingLeft, paddingRight)");
    expect(renderer).toContain("const visibleUnitCount = this.getTimelineViewportUnitCount(container, config, unitWidth)");
    expect(renderer).toContain("const visibleUnitSpan = this.getTimelineViewportUnitSpan(container, unitWidth)");
    expect(renderer).toContain("visibleUnitCount,");
    expect(renderer).toContain("visibleUnitSpan,");
    expect(renderer).toContain("private timelineResizeObserver: ResizeObserver | null = null");
    expect(renderer).toContain("this.observeTimelineViewport(container, config, rows)");
    expect(renderer).toContain("const nextUnitCount = this.getTimelineViewportUnitCount(container, config, unitWidth)");
    expect(renderer).toContain("const nextUnitSpan = this.getTimelineViewportUnitSpan(container, unitWidth)");
    expect(renderer).toContain("if (nextUnitCount !== this.timelineObservedUnitCount || this.hasTimelineViewportUnitSpanChanged(nextUnitSpan)) {");
    expect(renderer).toContain("this.getTimelineVisibleMinutes(config, { ...model, totalUnits: Math.max(1, visibleUnitSpan ?? model.totalUnits) })");
    expect(renderer).toContain("Math.max(1, visibleUnitSpan ?? model.totalUnits) * MINUTES_PER_DAY");
    expect(renderer).toContain("const leftAnchor = this.getTimelineViewportLeftAnchor(config, nextUnitCount)");
    expect(renderer).toContain("const renderConfig = leftAnchor");
    expect(renderer).toContain("getTimelineViewportStartAnchor(config, renderedWindow.startDateKey, visibleUnitCount, renderedWindow.startMinutes)");
    expect(renderer).toContain("const previousScrollTop = container.scrollTop");
    expect(renderer).toContain("const previousScrollLeft = container.scrollLeft");
    expect(renderer).toContain("container.scrollTop = previousScrollTop");
    expect(renderer).toContain("container.scrollLeft = previousScrollLeft");
    expect(renderer).toContain("buildTimelineTicks(");
    expect(renderer).toContain("getEffectiveLocale()");
    expect(calendarTimelineToolbar).toContain("getTimelineColumnWidthSpec(config.timelineScale || \"week\")");
    // U4：timed move/resize 改用 resolveEventAbsoluteScale（与渲染同口径）+ applyTimelineAbsolutePosition 定位。
    expect(renderer).toContain("const originalRange = resolveEventAbsoluteScale(event, model.startDateKey || event.startDateKey)");
    expect(renderer).not.toContain("const originalEnd = Math.min(endMax");
    expect(renderer).toContain("this.applyTimelineAbsolutePosition(button, previewStart, previewEnd, visible.startMinutes, model.unit)");
    expect(renderer).toContain("isClippedStart");
    expect(renderer).toContain("isClippedEnd");
    expect(renderer).toContain("isOverEvent");
    expect(renderer).toContain("${isOverEvent ? \" is-over-event\" : \"\"}");
    expect(renderer).toContain("isClippedStart ? \" is-clipped-start\" : \"\"");
    expect(renderer).toContain("if (!range.isClippedStart)");
    expect(renderer).toContain("if (!range.isClippedEnd)");
    expect(calendarRenderer).toContain("syncTimedDragDropTarget");
    expect(calendarRenderer).toContain("this.syncTimedDragDropTarget(eventEl, targetDateKey)");
    expect(renderer).toContain("data-timeline-lane-key");
    expect(renderer).toContain("syncTimelineTimedDropTarget");
    expect(renderer).toContain("getTimelineTimedDropTarget");
    expect(renderer).toContain("\"--db-timeline-offset\": \"1\"");
    expect(renderer).toContain("\"--db-timeline-span\": String(Math.max(1, totalUnits))");
    expect(renderer).toContain("CalendarEventDateChange");
    expect(renderer).toContain("changedEdge: mode === \"resize-start\" ? \"start\" : mode === \"resize-end\" ? \"end\" : \"both\"");
    expect(renderer).toContain("resolveAllDayResizeChange({");
    expect(renderer).toContain("resolveDayMoveChange({");
    expect(renderer).toContain("startMinutes: event.startMinutes");
    expect(renderer).toContain("endMinutes: event.endMinutes");
    // U4：move 入口改纯按列类型分流——datetime 列（日视图）走 timed move，date 列走 date move。
    // 旧的 isCrossDayAllDay 双轨与 --db-timeline-offset/span（U3 后 CSS 已不读）已移除。
    expect(renderer).toContain("const useTimedMove = model.scale === \"day\" && !isDateColumn");
    expect(renderer).not.toContain("--db-timeline-offset\") || String((event.gridOffsetUnits");
    expect(renderer).toContain("const wasTimed = button.hasClass(\"is-timed\")");
    expect(renderer).toContain("if (!wasTimed) button.removeClass(\"is-timed\")");
    expect(renderer).toContain("renderTimelineMobileMenuButton");
    expect(renderer).toContain("showTimelineMobileMenu");
    expect(renderer).toContain("canTimelineReorder");
    expect(renderer).toContain("canMoveTimelineAcrossLane");
    expect(renderer).toContain("db-timeline-snap-marker");
    expect(renderer).toContain("db-timeline-resize-handle");
    expect(renderer).not.toContain("db-timeline-reorder-handle");
    expect(renderer).toContain("db-timeline-mobile-menu-button");
    expect(renderer).toContain("isPhoneLayout");
    expect(renderer).not.toContain("activeCalendarDragPayload");
    // T3：activeTimelineDragPayload 字段随 group drop zone 一并删除。
    expect(renderer).not.toContain("activeTimelineDragPayload");
    // HTML5 drag ghost 工具链：timeline（T3）和 calendar（move pointer 化）均已删除。
    expect(renderer).not.toContain("activeDragGhost");
    expect(calendarRenderer).not.toContain("activeDragGhost");
    expect(calendarRenderer).not.toContain("event.dataTransfer?.setDragImage(ghost, this.activeDragGhostOffsetX, this.activeDragGhostOffsetY)");
    expect(renderer).not.toContain("event.dataTransfer?.setDragImage(ghost, this.activeDragGhostOffsetX, this.activeDragGhostOffsetY)");
    expect(calendarRenderer).not.toContain("ghost.addClass(\"db-calendar-drag-ghost\", \"is-native-drag-image\")");
    expect(renderer).not.toContain("ghost.addClass(className, \"is-native-drag-image\")");
    expect(calendarRenderer).not.toContain("ghost.removeClass(\"is-dragging\", \"is-moving\", \"is-resizing\")");
    expect(renderer).not.toContain("ghost.removeClass(\"is-dragging\", \"is-moving\", \"is-resizing\")");
    expect(calendarRenderer).toContain("eventEl.toggleClass(\"is-moving\", mode === \"move\")");
    expect(renderer).toContain("button.toggleClass(\"is-moving\", mode === \"move\")");
    expect(calendarRenderer).not.toContain("getTransparentDragImage");
    expect(renderer).not.toContain("getTransparentDragImage");
    expect(calendarRenderer).not.toContain("const host = source.closest<HTMLElement>(\".note-database-container\") || window.activeDocument.body;");
    expect(renderer).not.toContain("const host = source.closest<HTMLElement>(\".note-database-container\") || window.activeDocument.body;");
    expect(calendarRenderer).not.toContain("host.appendChild(ghost)");
    expect(renderer).not.toContain("host.appendChild(ghost)");
    expect(calendarRenderer).not.toContain("from \"./DragPreview\"");
    expect(renderer).not.toContain("from \"./DragPreview\"");
    expect(calendarRenderer).not.toContain("installDragGhostCleanupListeners");
    expect(renderer).not.toContain("installDragGhostCleanupListeners");
    expect(calendarRenderer).not.toContain("private moveDragGhost");
    expect(renderer).not.toContain("private moveDragGhost");
    expect(calendarRenderer).not.toContain("this.moveDragGhost(");
    expect(renderer).not.toContain("this.moveDragGhost(");
    expect(renderer).not.toContain("cleanupDragGhost");
    // T3：group drop zone 已删，dropEffect 不再出现在 timeline renderer。
    expect(renderer).not.toContain("dropEffect = \"move\"");
    // move 入口已 pointer 化：effectAllowed / setData("text/plain") 是 move 专用 HTML5 drag token，不再出现。
    expect(renderer).not.toContain("effectAllowed = \"move\"");
    expect(renderer).not.toContain("setData(\"text/plain\"");
    expect(renderer).not.toContain("window.setTimeout(() => ghost.remove(), 50)");
    // T3：drop zone 删除后，activeTimelineDragPayload 赋值已不存在。
    expect(renderer).not.toContain("this.activeTimelineDragPayload = null;");
    expect(renderer).toContain("requestDateKey");
    expect(renderer).toContain("input.type = \"date\"");
    expect(renderer).toContain("input.showPicker");
    expect(renderer).toContain("calendar.moveToday");
    expect(renderer).toContain("calendar.extendOneDay");
    expect(renderer).toContain("mobile.moveTop");
    expect(renderer).toContain("moveTimelineEventToGroup");
    expect(renderer).toContain("return !isExplicitlySorted(config)");
    expect(renderer).toContain("return col.type !== \"multi-select\"");
    expect(renderer).toContain("buildCalendarMonthModel");
    expect(renderer).toContain("buildTimelineModel");
    expect(miniCalendarRenderer).toContain("calendar.prevMonth");
    expect(renderer).not.toContain("calendar.today");
    expect(miniCalendarRenderer).toContain("calendar.nextMonth");
    expect(renderer).toContain("getCalendarSlotDuration(config)");
    expect(renderer).toContain("is-slot-${this.getTimelineSlotDuration(config)}");
    expect(renderer).not.toContain("attr: { role: \"group\", \"aria-label\": t(\"viewConfig.timelineScale\") }");
    expect(renderer).not.toContain("title: option.text");
    expect(renderer).not.toContain("title: t(\"viewConfig.timelineScale\")");
    expect(renderer).not.toContain("\"aria-label\": t(\"viewConfig.timelineScale\")");
    expect(renderer).not.toContain("visibleEvents");
    expect(renderer).not.toContain("getCalendarVisibleEventLimit(config)");
    expect(renderer).not.toContain("hiddenEventCount");
    expect(renderer).not.toContain("calendar.moreEvents");
    expect(renderer).not.toContain("db-calendar-more-events");
    expect(renderer).not.toContain("db-calendar-events-expanded");
    expect(renderer).not.toContain("renderCalendarExpandedEvents");
    expect(renderer).not.toContain("db-calendar-event-title");
    expect(renderer).not.toContain("db-calendar-event-meta");
    expect(renderer).not.toContain("Math.floor(availableHeight / 36)");
    expect(renderer).toContain("--db-calendar-event-accent");
    expect(renderer).toContain("--db-calendar-event-bg");
    expect(renderer).toContain("\"data-note-database-row-path\": event.row.file.path");
    expect(renderer).toContain("button.oncontextmenu");
    expect(miniCalendarRenderer).toContain("is-today");
    expect(renderer).not.toContain("db-calendar-day-heading");
    expect(renderer).toContain("getTodayDateKey");
    expect(renderer).toContain("onConfigChange");
    expect(renderer).toContain("model.eventCount === 0");
    expect(renderer).toContain("model.visibleEventCount === 0");
    expect(renderer).toContain("renderTimelineEmptyRange");
    expect(renderer).toContain("timeline.noEventsInRange");
    expect(renderer).toContain("isCurrentTimelineTick");
    expect(renderer).toContain("isCurrentTimelineDateTick");
    expect(calendarRenderer).toContain("isCurrentCalendarHourTick");
    expect(renderer).toContain("db-timeline-axis");
    expect(renderer).toContain("db-timeline-ticks");
    expect(renderer).toContain("db-timeline-tick");
    expect(renderer).toContain("db-timeline-tick-label");
    expect(renderer).toContain("db-timeline-tick-weekday");
    expect(renderer).toContain("db-timeline-tick-date");
    expect(renderer).not.toContain("tickEl.createSpan({ text: tick.label });");
    expect(renderer).toContain("buildTimelineAxisBands({");
    expect(renderer).toContain("getTimelineTitleWindow");
    expect(renderer).toContain("scale: model.scale");
    expect(renderer).toContain("startMinutes: model.startMinutes");
    expect(renderer).toContain("totalUnits: model.totalUnits");
    expect(renderer).toContain("locale: getEffectiveLocale()");
    expect(renderer).toContain("const band = axis.createDiv({ cls: \"db-timeline-ticks-band\" });");
    expect(renderer).not.toContain("if (axisBands.length > 0)");
    expect(renderer).toContain("timeline.uncategorized");
    expect(renderer).toContain("--db-timeline-today-offset-units");
    expect(renderer).toContain("db-timeline-today-line");
    expect(renderer).toContain("is-current-date-tick");
    expect(renderer).not.toContain("db-timeline-current-bridge");
    expect(renderer).toContain("body.createDiv({ cls: \"db-timeline-today-line\"");
    expect(renderer).not.toContain("scroll.createDiv({ cls: \"db-timeline-today-line\"");
    expect(renderer).not.toContain("renderTimelineTodayMarker");
    expect(renderer).toContain("db-timeline-event-title");
    expect(renderer).toContain("db-timeline-event-meta");
    expect(renderer).toContain("db-timeline-event-content");
    expect(renderer).toContain("button.querySelector<HTMLElement>(\".db-timeline-event-meta\")");
    expect(renderer).toContain("db-timeline-body");
    expect(renderer).toContain("renderTimelineGroupHeader");
    expect(renderer).toContain("renderTimelineGroupTag");
    expect(renderer).toContain("renderTimelineCreateRow");
    expect(renderer).toContain("setupTimelineCreateRow");
    expect(renderer).toContain("updateTimelineCreatePreview");
    expect(renderer).toContain("clearTimelineCreatePreview");
    expect(renderer).toContain("getTimelineCreateSpanUnits");
    expect(renderer).toContain("attr: { type: \"button\" }");
    expect(renderer).not.toContain("attr: { type: \"button\", title: t(\"toolbar.new\"), \"aria-label\": t(\"toolbar.new\") }");
    expect(renderer).not.toContain("attr: { type: \"button\", \"aria-label\": t(\"toolbar.new\") }");
    expect(renderer).toContain("\"--db-timeline-create-offset\"");
    expect(renderer).toContain("\"--db-timeline-create-span\"");
    expect(renderer).toContain("\"--db-timeline-create-left\"");
    expect(renderer).toContain("\"--db-timeline-create-width\"");
    expect(renderer).toContain("--db-timeline-band-start");
    expect(renderer).toContain("button.addClass(\"is-previewing\")");
    expect(renderer).toContain("this.actions.createEntryForDate?.(config, target.dateKey, options)");
    expect(renderer).toContain("options.groupField = config.timelineGroupField");
    expect(renderer).toContain("options.groupKey = groupKey");
    expect(renderer).toContain("renderTimelineJumpIndicator");
    expect(renderer).toContain("jumpTimelineToEvent");
    expect(renderer).toContain("toggleGroupCollapsed");
    expect(renderer).toContain("isGroupCollapsed");
    expect(renderer).toContain("resolveEventAbsoluteScale(event");
    expect(renderer).toContain("db-timeline-group-tag");
    expect(renderer).toContain("--db-timeline-exact-offset");
    expect(renderer).toContain("--db-timeline-exact-width");
    expect(renderer).toContain("--db-timeline-offset");
    expect(renderer).toContain("--db-timeline-span");
    expect(renderer).toContain("--db-timeline-row");
    expect(renderer).toContain("--db-timeline-event-rows");
    // T3：group drop zone 已删，lane 渲染不再挂 HTML5 drop。
    expect(renderer).not.toContain("this.setupTimelineGroupDropZone(groupEl, events, config, model, lane.key, lane.events)");
    expect(renderer).toContain("model.scale");
    // T3：grabOffsetDays / getTimelineGrabOffsetDays / getTimelineDropDateKey 随 drop zone 一并删除。
    expect(renderer).not.toContain("grabOffsetDays");
    expect(renderer).not.toContain("getTimelineGrabOffsetDays");
    expect(renderer).not.toContain("getTimelineDropDateKey");
    expect(renderer).toContain("Math.floor((clientX - rect.left) / unitWidth)");
    expect(renderer).not.toContain("unit === \"week\"");
    expect(renderer).not.toContain("getTimelineDayDateFromPoint");
    expect(renderer).toContain("this.renderTimelineRangeSnap(eventsEl, button, this.formatDateRange(nextStartKey, nextEndKey), renderStart, visible.startMinutes, unit, unitWidth)");
    expect(renderer).toContain("this.renderTimelineRangeSnap(eventsEl, button, label, renderStart, visible.startMinutes, unit, unitWidth)");
    expect(renderer).not.toContain("addDateKeyDays(pointerDateKey, -Math.max(0, payload.grabOffsetDays || 0))");
    // T3：timeline move 已全量 pointer 化，HTML5 drag 事件入口与 draggable 标记均已移除。
    expect(renderer).not.toContain("addEventListener(\"dragstart\"");
    expect(renderer).not.toContain("button.draggable = true");
    expect(renderer).toContain("parseDateKeyToUtc");
    expect(renderer).toContain("getLocaleWeekStartsOn");
    expect(renderer).toContain("weekStartsOn");
    expect(renderer).toContain("renderTimelineMiniCalendarButton");
    expect(calendarRenderer).toContain("renderMiniCalendar");
    expect(renderer).toContain("renderMiniCalendar");
    expect(miniCalendarRenderer).toContain("export type MiniCalendarMode = \"day\" | \"month\" | \"year\"");
    expect(miniCalendarRenderer).toContain("export interface MiniCalendarEventIndex");
    expect(miniCalendarRenderer).toContain("export function buildMiniCalendarEventIndex");
    expect(miniCalendarRenderer).toContain("export function renderMiniCalendar");
    expect(miniCalendarRenderer).toContain("mode: MiniCalendarMode");
    expect(miniCalendarRenderer).toContain("renderMiniCalendarMonthGrid");
    expect(miniCalendarRenderer).toContain("renderMiniCalendarYearGrid");
    expect(miniCalendarRenderer).toContain("onSelectMonth(monthKey)");
    expect(miniCalendarRenderer).toContain("onSelectYear(year)");
    expect(miniCalendarRenderer).toContain("onSelectDate(day.dateKey)");
    expect(miniCalendarRenderer).toContain("onSelectToday(todayKey)");
    expect(miniCalendarRenderer).toContain("eventIndex.monthKeys.has(monthKey)");
    expect(miniCalendarRenderer).toContain("eventIndex.yearKeys.has(String(year))");
    expect(calendarRenderer).toContain("miniCalendarMode: MiniCalendarMode");
    expect(calendarRenderer).toContain("this.miniCalendarMode = \"month\"");
    expect(calendarRenderer).toContain("this.miniCalendarMode = \"year\"");
    expect(calendarRenderer).toContain("buildMiniCalendarEventIndex");
    expect(calendarRenderer).toContain("jumpMiniCalendarToToday");
    expect(calendarRenderer).toContain("onSelectToday: (dateKey) => this.jumpMiniCalendarToToday(popover, config, dateKey)");
    expect(calendarRenderer).not.toContain("onSelectToday: (dateKey) => this.navigateViaMini(config, dateKey)");
    expect(renderer).toContain("miniCalendarMode: MiniCalendarMode");
    expect(renderer).toContain("this.miniCalendarMode = \"month\"");
    expect(renderer).toContain("this.miniCalendarMode = \"year\"");
    expect(renderer).toContain("buildMiniCalendarEventIndex");
    expect(renderer).toContain("jumpTimelineMiniCalendarToToday");
    expect(renderer).toContain("onSelectToday: (dateKey) => this.jumpTimelineMiniCalendarToToday(popover, config, dateKey)");
    expect(renderer).not.toContain("onSelectToday: (dateKey) => this.navigateTimelineViaMini(config, dateKey)");
    expect(calendarRenderer).toContain(".db-calendar-day[data-date-key=");
    expect(calendarRenderer).toContain("db-calendar-month-flash-column");
    expect(calendarRenderer).toContain("requestCalendarDateFlash");
    expect(calendarRenderer).toContain("this.requestCalendarDateFlash(dateKey)");
    expect(calendarRenderer).toContain("this.requestCalendarDateFlash(config.calendarWeekStart)");
    expect(calendarRenderer).toContain("this.requestCalendarDateFlash(config.calendarDay)");
    expect(renderer).toContain("private pendingFlashDateKey: string | null = null");
    expect(renderer).toContain("this.pendingFlashDateKey = dateKey");
    expect(renderer).toContain("this.requestTimelineDateFlash(today)");
    expect(renderer).toContain("this.flashRafHandle = window.requestAnimationFrame");
    expect(renderer).toContain("private flashTimelineDate(dateKey: string): void");
    // 跳转闪光不再查询表头 tick 做染色（日期数字不高亮），只保留主体泳道的列背景条
    expect(renderer).not.toContain(".db-timeline-tick[data-date-key=");
    expect(renderer).toContain(".db-timeline-body");
    expect(renderer).toContain("db-timeline-body-flash-column");
    expect(renderer).not.toContain("querySelectorAll<HTMLElement>(\".db-timeline-events\")");
    expect(renderer).toContain("--db-timeline-flash-offset");
    expect(renderer).toContain("--db-timeline-flash-span");
    expect(renderer).toContain("this.renderTimelineScaleControl(controls, config, scale)");
    expect(renderer.indexOf("this.renderTimelineScaleControl(controls, config, scale)")).toBeLessThan(renderer.indexOf("this.renderTimelineNavButton(controls, \"timeline.prevLong\""));
    expect(calendarRenderer).toContain("this.renderCalendarScaleControl(controls, config, \"month\"");
    expect(calendarRenderer).toContain("this.renderCalendarScaleControl(controls, config, \"week\"");
    expect(calendarRenderer).toContain("this.renderCalendarScaleControl(controls, config, \"day\"");
    expect(calendarRenderer.indexOf("this.renderCalendarScaleControl(controls, config, \"month\"")).toBeLessThan(calendarRenderer.indexOf("this.renderNavButton(controls, \"calendar.prevMonth\""));
    expect(renderer).toContain("toggleTimelineMiniCalendar");
    expect(renderer).toContain("navigateTimelineViaMini");
    expect(renderer).not.toContain("config.timelineAnchor =");
    expect(renderer).toContain("t(\"undo.timelineAnchorConfig\")");
    expect(renderer).toContain("shiftCalendarMonth");
    expect(renderer).toContain("calendar.datePicker");
    expect(renderer).toContain("calendar-days");
    expect(renderer).not.toContain("scrollHost.scrollLeft");
    expect(renderer).not.toContain("lane.allDayEvents.forEach");

    expect(dashboard).toContain("showRowMenu");
    expect(toolbar).toContain("const viewType = currentView?.viewType || \"table\"");
    expect(toolbar).toContain("input.rows = 1");
    expect(toolbar).toContain("getDatabaseDescriptionEditMaxHeight");
    expect(toolbar).toContain("const initialHeight = Math.ceil(el.getBoundingClientRect().height)");
    expect(toolbar).toContain("this.syncDatabaseDescriptionEditHeight(input, initialHeight)");
    expect(toolbar).not.toContain("window.requestAnimationFrame(() => this.autoGrowTextarea(input, maxHeight, initialHeight))");
    expect(toolbar).toContain("const showSortButton = viewType !== \"chart\";");
    expect(toolbar).toContain("toggleCalendarTimelineOptions");
    expect(toolbar).toContain("renderCalendarTimelineOptionsButton");
    expect(toolbar).toContain("CalendarTimelineToolbarRenderer");
    expect(calendarTimelineToolbar).toContain("db-chart-options-row db-calendar-range-row db-calendar-timeline-range-row");
    expect(calendarTimelineToolbar).toContain("setIcon(row.createSpan({ cls: \"db-chart-options-row-icon\" }), \"ruler\")");
    expect(calendarTimelineToolbar).toContain("cls: \"db-view-config-number\"");
    expect(calendarTimelineToolbar).toContain("getTimelineColumnWidthSpec(config.timelineScale || \"week\").defaultWidth");
    expect(calendarTimelineToolbar).toContain("getTimelineColumnWidthSpec(config.timelineScale || \"week\").min");
    expect(calendarTimelineToolbar).toContain("getTimelineColumnWidthSpec(config.timelineScale || \"week\").max");
    expect(renderer).toContain("resolveTimelineUnitWidth(config, scale)");
    expect(renderer).not.toContain("getDefaultTimelineColumnWidth");
    expect(renderer).not.toContain("getTimelineColumnWidthMin");
    expect(renderer).not.toContain("getTimelineColumnWidthMax");
    expect(toolbar).toContain("appendViewSettingsIcon");
    expect(toolbar).toContain("settingsBadge");
    expect(toolbar).toContain("db-view-settings-icon");
    expect(toolbar).toContain("if (viewType === \"timeline\") return \"chart-gantt\"");
    expect(toolbar).toContain("toolbar.changeViewType");
    expect(toolbar).toContain("showViewTypeChangeMenu");
    expect(toolbar).toContain("actions.setViewType(value as DatabaseViewType, viewIndex)");
    expect(dashboard).toContain("setViewType: (value, viewIndex) => this.setViewType(value, viewIndex)");
    expect(embedded).toContain("setViewType: (value, viewIndex) =>");
    expect(calendarTimelineToolbar).toContain("timeline.options");
    expect(calendarTimelineToolbar).toContain("config.timelineColorField");
    expect(calendarTimelineToolbar).toContain("config.timelineScale");
    expect(calendarTimelineToolbar).toContain("this.renderSameDateFieldWarning(data, config.timelineStartDateField, config.timelineEndDateField)");
    expect(calendarTimelineToolbar).toContain("config.timelineScale === \"day\"");
    expect(calendarTimelineToolbar).toContain("calendarWeekSlotDuration");
    expect(calendarTimelineToolbar).toContain("viewConfig.calendarWeekSlotDuration");
    expect(calendarTimelineToolbar).toContain("undo.calendarSlotDurationConfig");

    const searchIndex = toolbar.indexOf("if (!phoneLayout && !isChartView) this.renderSearch(right, state, actions)");
    const optionsIndex = toolbar.indexOf("this.renderCalendarTimelineOptionsButton(right, currentView, actions)");
    expect(searchIndex).toBeGreaterThan(0);
    expect(optionsIndex).toBeGreaterThan(0);
    expect(optionsIndex).toBeLessThan(searchIndex);
  });

  it("uses specific undo labels for calendar and timeline view settings", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(panel).toContain("onChange(label?: string): void");
    expect(renderer).toContain("onConfigChange?(label?: string): void");
    expect(dashboard).toContain("this.pendingUndoLabel = label || t(\"undo.viewTypeConfig\")");
    expect(dashboard).toContain("this.pendingUndoLabel = label || t(\"undo.viewConfig\")");
    expect(dashboard).toContain("applyCellChanges(cellChanges, t(\"undo.timelineDates\"))");
    expect(dashboard).toContain("this.pendingUndoLabel = t(\"undo.cardOrderConfig\")");
    expect(panel).not.toContain("config.calendarStartDateField = value || undefined");
    expect(panel).not.toContain("config.calendarEndDateField = value || undefined");
    expect(panel).not.toContain("config.calendarTitleField = value || undefined");
    expect(panel).not.toContain("config.timelineStartDateField = value || undefined");
    expect(panel).not.toContain("config.timelineEndDateField = value || undefined");
    expect(panel).not.toContain("config.timelineTitleField = value || undefined");
    expect(panel).not.toContain("config.timelineScale = value === \"day\"");
    const calendarTimelineToolbar = readFileSync(new URL("../views/CalendarTimelineToolbarRenderer.ts", import.meta.url), "utf8");
    const calendarToolbar = readFileSync(new URL("../views/CalendarToolbarRenderer.ts", import.meta.url), "utf8");
    expect(calendarToolbar).toContain("actions.onChange(t(\"undo.calendarStartFieldConfig\"))");
    expect(calendarToolbar).toContain("actions.onChange(t(\"undo.calendarEndFieldConfig\"))");
    expect(calendarToolbar).toContain("this.renderSameDateFieldWarning(data, config.calendarStartDateField, config.calendarEndDateField)");
    expect(calendarToolbar).toContain("actions.onChange(t(\"undo.calendarTitleFieldConfig\"))");
    expect(calendarToolbar).toContain("actions.onChange(t(\"undo.calendarFirstDayOfWeekConfig\"))");
    expect(calendarToolbar).toContain("actions.onChange(t(\"undo.calendarMonthLanesConfig\"))");
    expect(calendarToolbar).toContain("actions.onChange(t(\"undo.calendarAllDayLanesConfig\"))");
    expect(calendarTimelineToolbar).toContain("actions.onChange(t(\"undo.timelineStartFieldConfig\"))");
    expect(calendarTimelineToolbar).toContain("actions.onChange(t(\"undo.timelineEndFieldConfig\"))");
    expect(calendarTimelineToolbar).toContain("config.timelineStartDateField = value || undefined;\n      normalizeTimelineDayScale(config);");
    expect(calendarTimelineToolbar).toContain("config.timelineEndDateField = value || undefined;\n      normalizeTimelineDayScale(config);");
    expect(calendarTimelineToolbar).toContain("typeof result === \"number\"");
    expect(calendarTimelineToolbar).toContain("actions.onChange(t(\"undo.timelineTitleFieldConfig\"))");
    expect(calendarTimelineToolbar).toContain("actions.onChange(t(\"undo.timelineColorFieldConfig\"))");
    expect(calendarTimelineToolbar).toContain("actions.onChange(t(\"undo.timelineScaleConfig\"))");
    expect(calendarTimelineToolbar).toContain("actions.onChange(t(\"undo.calendarSlotDurationConfig\"))");
    expect(renderer).toContain("this.applyCalendarEventColor(button, event.color)");
    expect(renderer).not.toContain("this.actions.onConfigChange?.(t(\"undo.calendarMonthConfig\"))");

    for (const key of [
      "undo.calendarStartFieldConfig",
      "undo.calendarEndFieldConfig",
      "undo.calendarTitleFieldConfig",
      "undo.calendarColorFieldConfig",
      "undo.calendarMonthConfig",
      "undo.calendarCellSizeConfig",
      "undo.calendarFirstDayOfWeekConfig",
      "undo.calendarMonthLanesConfig",
      "undo.calendarAllDayLanesConfig",
      "undo.timelineStartFieldConfig",
      "undo.timelineEndFieldConfig",
      "undo.timelineTitleFieldConfig",
      "undo.timelineColorFieldConfig",
      "undo.timelineScaleConfig",
      "undo.timelineDates",
      "undo.createRow",
      "undo.viewTypeConfig",
      "undo.cardOrderConfig",
    ]) {
      expect(i18n).toContain(`"${key}"`);
    }
  });

  it("uses specific undo labels for shared view settings and refreshes the open settings panel after undo", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../views/ViewConfigPanelRenderer.ts", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(panel).toContain("onDatabaseChange?(label?: string): void");
    expect(dashboard).toContain("onDatabaseChange: (label) =>");
    expect(dashboard).toContain("this.pendingUndoLabel = label || t(\"undo.viewConfig\")");
    expect(dashboard).toContain("this.renderViewConfigPanel();\n  }\n\n  private replaceDatabaseConfig");

    for (const marker of [
      "actions.onChange(t(\"undo.showEmptyFieldsConfig\"))",
      "actions.onDatabaseChange?.(t(\"undo.databaseNameConfig\"))",
      "actions.onDatabaseChange?.(t(\"undo.databaseDescriptionConfig\"))",
      "actions.onDatabaseChange?.(t(\"undo.sourceFolderConfig\"))",
      "actions.onDatabaseChange?.(t(\"undo.sourceRulesConfig\"))",
      "actions.onDatabaseChange?.(t(\"undo.newRecordFolderConfig\"))",
      "actions.onDatabaseChange?.(t(\"undo.computedSyncModeConfig\"))",
      "actions.onChange(t(\"undo.galleryCoverFieldConfig\"))",
      "actions.onChange(t(\"undo.galleryImageFitConfig\"))",
      "actions.onChange(t(\"undo.cardSizeConfig\"))",
      "actions.onChange(t(\"undo.galleryCoverRatioConfig\"))",
      "actions.onChange(t(\"undo.titleFieldConfig\"))",
      "actions.onChange(t(\"undo.boardSubgroupConfig\"))",
      "actions.onChange(t(\"undo.boardColumnWidthConfig\"))",
      "actions.onChange(t(\"undo.defaultColumnWidthConfig\"))",
    ]) {
      expect(panel).toContain(marker);
    }

    for (const key of [
      "undo.showEmptyFieldsConfig",
      "undo.databaseNameConfig",
      "undo.sourceFolderConfig",
      "undo.sourceRulesConfig",
      "undo.newRecordFolderConfig",
      "undo.computedSyncModeConfig",
      "undo.galleryCoverFieldConfig",
      "undo.galleryImageFitConfig",
      "undo.galleryCoverRatioConfig",
      "undo.titleFieldConfig",
      "undo.boardSubgroupConfig",
      "undo.boardColumnWidthConfig",
      "undo.defaultColumnWidthConfig",
    ]) {
      expect(i18n).toContain(`"${key}"`);
    }
  });

  it("keeps shared dropdown selected state current while an options popover stays open", () => {
    const dropdown = readFileSync(new URL("../views/DropdownField.ts", import.meta.url), "utf8");

    expect(dropdown).toContain("let currentValue = options.value");
    expect(dropdown).toContain("value: currentValue");
    expect(dropdown).toContain("currentValue = value");
  });

  it("includes shared calendar and timeline styles", () => {
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(cssRule(styles, ".note-database-container")).toContain("scrollbar-gutter: stable");

    // Calendar styles (new card-based layout)
    expect(styles).toContain(".note-database-container .db-calendar");
    expect(styles).toContain(".note-database-container .db-calendar-grid");
    expect(styles).toContain(".note-database-container .db-calendar-day.is-today");
    expect(styles).toContain(".note-database-container .db-calendar-day-heading");
    expect(styles).toContain(".note-database-container .db-calendar-day-number");
    expect(styles).toContain(".note-database-container .db-calendar-month-segment");
    expect(styles).toContain(".note-database-container .db-calendar-month-timed-dot");
    expect(styles).toContain(".note-database-container .db-calendar-time-header-row");
    expect(styles).toContain(".note-database-embed.note-database-container .db-calendar-week-sticky");
    expect(cssRule(styles, ".note-database-embed.note-database-container .db-calendar-week-sticky")).toContain("top: calc(var(--db-table-header-top) - 1pt)");
    expect(styles).toContain(".note-database-container .db-calendar-timed-current-line");
    expect(styles).toContain(".note-database-container .db-calendar-selection-preview");
    expect(styles).toContain(".note-database-container .db-calendar-time-resize-handle");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-event-content")).toContain("justify-content: flex-start");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-event-title")).toContain("flex: 1 1 auto");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-event-time")).toContain("overflow: hidden");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-timed-event.is-compact .db-calendar-week-event-content")).toContain("justify-content: center");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-timed-event.is-compact .db-calendar-week-event-time")).toContain("display: none");
    expect(styles).toContain(".note-database-container .db-calendar-add-button");
    expect(styles).toContain(".note-database-container .db-calendar-more-events");
    expect(styles).toContain(".note-database-container .db-calendar-events-expanded");
    expect(styles).toContain(".note-database-container .db-calendar-day.is-drop-target");
    expect(styles).toContain(".note-database-container .db-calendar-time-columns .db-calendar-week-day-col.is-drop-target");
    expect(styles).toContain(".note-database-container .db-calendar-week-allday-col.is-drop-target");
    expect(styles).toContain(".note-database-container .db-calendar-drop-snap");
    // drag-ghost CSS 已随 HTML5 drag move 删除（move pointer 化后用 segment grid 变量 + month-ghost）。
    expect(styles).not.toContain(".note-database-container .db-calendar-drag-ghost");
    expect(styles).toContain(".note-database-container .db-calendar-week-timed-event.is-moving");
    expect(styles).not.toContain(".db-calendar-transparent-drag-image");
    expect(styles).toContain(".note-database-container .db-calendar-nav-button");
    expect(styles).toContain(".note-database-container .db-calendar-scale-control");
    expect(styles).toContain(".note-database-container .db-timeline-scale-control");
    expect(styles).toContain(".note-database-container .db-calendar-scale-menu");
    expect(styles).toContain(".note-database-container .db-timeline-scale-menu");
    expect(styles).toContain("body.is-mobile .note-database-container .db-calendar-scale-segment");
    expect(styles).toContain("body.is-mobile .note-database-container .db-timeline-scale-segment");
    expect(styles).toContain("body.is-mobile .note-database-container .db-calendar-scale-menu");
    expect(styles).toContain("body.is-mobile .note-database-container .db-timeline-scale-menu");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-title-font-family: \"Source Serif 4\"");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-heading-vertical-space: 12px");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-heading-row-min-height: 37px");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-heading-font-size: 28px");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-heading-line-height: 1.3");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-description-min-height: 20px");
    expect(cssRule(styles, ".note-database-container .db-header")).toContain("gap: var(--db-heading-vertical-space)");
    expect(cssRule(styles, ".note-database-container .db-header")).toContain("padding: var(--db-heading-vertical-space) 12px 0");
    expect(cssRule(styles, ".note-database-container .db-heading-row")).toContain("min-height: var(--db-heading-row-min-height)");
    expect(cssRule(styles, ".note-database-container .db-heading")).toContain("padding: 0 4px");
    expect(cssRule(styles, ".note-database-container .db-heading")).toContain("font-size: var(--db-heading-font-size)");
    expect(cssRule(styles, ".note-database-container .db-heading")).toContain("line-height: var(--db-heading-line-height)");
    expect(cssRule(styles, ".note-database-container .db-heading-text")).toContain("font-family: var(--db-title-font-family)");
    expect(cssRule(styles, ".note-database-container .db-heading-edit")).toContain("font-family: var(--db-title-font-family)");
    expect(cssRule(styles, ".note-database-container .db-heading-edit")).toContain("font-size: var(--db-heading-font-size)");
    expect(cssRule(styles, ".note-database-container .db-heading-edit")).toContain("line-height: var(--db-heading-line-height)");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("width: 100%");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("max-width: none");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("display: block");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("min-height: var(--db-description-min-height)");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("max-height: 30vh");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("font-family: var(--font-interface)");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("margin-left: 0");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("margin-top: 0");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("margin-bottom: 0");
    expect(cssRule(styles, ".note-database-container .db-heading-edit-description")).toContain("padding: 0 4px 0 0");
    expect(cssRule(styles, ".note-database-container .db-heading-button")).toContain("appearance: none");
    expect(cssRule(styles, ".note-database-container .db-heading-button")).toContain("margin: 0");
    expect(cssRule(styles, ".note-database-container .db-heading-button")).toContain("min-height: 0");
    expect(cssRule(styles, ".note-database-container .db-title-row")).toContain("min-height: var(--db-heading-row-min-height)");
    expect(cssRule(styles, ".note-database-container .db-title")).toContain("font-family: var(--db-title-font-family)");
    expect(cssRule(styles, ".note-database-container .db-title")).toContain("font-size: var(--db-heading-font-size)");
    expect(cssRule(styles, ".note-database-container .db-title")).toContain("line-height: var(--db-heading-line-height)");
    expect(cssRule(styles, ".note-database-container .db-title-actions")).not.toContain("font-family");
    expect(cssRule(styles, ".note-database-container .db-description")).toContain("margin-top: 0");
    expect(cssRule(styles, ".note-database-container .db-description")).toContain("min-height: var(--db-description-min-height)");
    expect(cssRule(styles, ".note-database-embed.note-database-container .db-description")).toContain("margin: 0");
    expect(cssRule(styles, ".note-database-embed.note-database-container .db-description")).toContain("min-height: var(--db-description-min-height)");
    expect(cssRule(styles, ".note-database-container .db-timeline-title,\n.note-database-container .db-calendar-title")).toContain("display: inline-flex");
    expect(cssRule(styles, ".note-database-container .db-calendar")).toContain("gap: 12px");
    expect(cssRule(styles, ".note-database-container .db-timeline")).toContain("gap: 12px");
    expect(cssRule(styles, ".note-database-container .db-calendar-header")).toContain("align-items: flex-end");
    expect(cssRule(styles, ".note-database-container .db-calendar-header")).toContain("padding: 25px 0 12px");
    expect(cssRule(styles, ".note-database-container .db-timeline-header")).toContain("align-items: flex-end");
    expect(cssRule(styles, ".note-database-container .db-timeline-header")).toContain("padding: 25px 0 12px");
    expect(cssRule(styles, ".note-database-container .db-timeline-title-main,\n.note-database-container .db-calendar-title-main")).toContain("font-size: 22px");
    expect(cssRule(styles, ".note-database-container .db-timeline-title-main,\n.note-database-container .db-calendar-title-main")).toContain("font-family: var(--db-title-font-family)");
    expect(cssRule(styles, ".note-database-container .db-timeline-title-main,\n.note-database-container .db-calendar-title-main")).toContain("font-weight: 700");
    expect(cssRule(styles, ".note-database-container .db-timeline-title-year,\n.note-database-container .db-calendar-title-year")).toContain("font-size: 14px");
    expect(cssRule(styles, ".note-database-container .db-timeline-title-year,\n.note-database-container .db-calendar-title-year")).toContain("color: var(--text-muted)");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-title")).toContain("font-family: var(--font-interface)");
    expect(styles).toContain("border-left: 3px solid var(--db-calendar-event-accent, var(--interactive-accent))");
    expect(styles).toContain("background-color: var(--background-primary)");
    expect(styles).toContain("background-image: linear-gradient(var(--db-calendar-event-bg");
    expect(styles).not.toContain(".note-database-container .db-calendar-today-label");
    expect(styles).not.toContain(".note-database-container .db-calendar-resize-handle");
    expect(styles).toContain(".db-hidden-date-input");
    expect(styles).toContain("background: var(--background-primary)");

    // Timeline styles
    expect(styles).toContain(".note-database-container .db-timeline");
    expect(styles).toContain(".note-database-container .db-timeline-empty-range");
    expect(styles).toContain(".note-database-container .db-timeline-axis");
    expect(styles).toContain(".note-database-container .db-timeline-ticks");
    expect(styles).toContain(".note-database-container .db-timeline-tick");
    expect(styles).toContain(".note-database-container .db-timeline-today-line");
    expect(styles).toContain(".note-database-container .db-timeline-today-line::before");
    expect(styles).not.toContain(".note-database-container .db-timeline-today-marker");
    expect(styles).toContain("var(--db-timeline-group-width, 120px)");
    expect(styles).toContain("var(--db-timeline-body-width, auto)");
    expect(styles).toContain("--db-timeline-body-width: minmax(0, 1fr)");
    expect(cssRule(styles, ".note-database-container .db-timeline")).toContain("box-sizing: border-box");
    expect(cssRule(styles, ".note-database-container .db-timeline")).toContain("width: 100%");
    expect(cssRule(styles, ".note-database-container .db-timeline")).toContain("--db-timeline-extension-width: 70px");
    expect(cssRule(styles, ".note-database-container .db-timeline")).toContain("--db-timeline-unit-width");
    expect(cssRule(styles, ".note-database-container .db-timeline")).toContain("--db-timeline-content-width: calc(var(--db-timeline-units) * var(--db-timeline-unit-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline")).toContain("--db-timeline-grid-line-color");
    expect(cssRule(styles, ".note-database-container .db-timeline")).toContain("--db-timeline-clipped-fade-width: 18px");
    expect(cssRule(styles, ".note-database-container.db-view-timeline")).toContain("overflow-x: hidden");
    expect(cssRule(styles, ".note-database-container.db-view-timeline")).toContain("overflow-y: auto");
    expect(cssRule(styles, ".note-database-container.db-view-timeline")).toContain("overscroll-behavior-x: none");
    expect(cssRule(styles, ".note-database-container.db-view-timeline")).toContain("touch-action: pan-y");
    expect(cssRule(styles, ".note-database-container.db-view-timeline:not(.note-database-embed) .db-timeline")).toContain("min-height: calc(100% - var(--db-table-header-top, 96px) - 24px)");
    expect(cssRule(styles, ".note-database-container .db-timeline")).not.toContain("--db-timeline-grid-fade");
    expect(cssRule(styles, ".note-database-container .db-timeline")).not.toContain("--db-timeline-content-max-width");
    expect(cssRule(styles, ".note-database-container .db-timeline")).not.toContain("margin-inline");
    expect(cssRule(styles, ".note-database-container .db-timeline")).not.toContain("padding-inline");
    expect(cssRule(styles, ".note-database-container .db-timeline-scroll")).toContain("display: flex");
    expect(cssRule(styles, ".note-database-container .db-timeline-scroll")).toContain("flex: 1 1 auto");
    expect(cssRule(styles, ".note-database-container .db-timeline-scroll")).toContain("min-height: 240px");
    expect(cssRule(styles, ".note-database-container .db-timeline-scroll")).toContain("overflow-x: visible");
    expect(cssRule(styles, ".note-database-container .db-timeline-scroll")).toContain("width: 100%");
    expect(cssRule(styles, ".note-database-container .db-timeline-scroll")).toContain("isolation: isolate");
    expect(styles).not.toContain(".note-database-container .db-timeline-scroll::before");
    expect(styles).not.toContain(".note-database-container .db-timeline-scroll::after");
    expect(styles).toContain(".note-database-container .db-timeline-body::before");
    expect(styles).toContain(".note-database-container .db-timeline-body::after");
    expect(cssRule(styles, ".note-database-container .db-timeline-body::before")).toContain("left: calc(var(--db-timeline-extension-width) * -1)");
    expect(cssRule(styles, ".note-database-container .db-timeline-body::before")).toContain("width: var(--db-timeline-extension-width)");
    expect(cssRule(styles, ".note-database-container .db-timeline-body::before")).toContain("pointer-events: none");
    expect(cssRule(styles, ".note-database-container .db-timeline-body::after")).toContain("right: calc(var(--db-timeline-extension-width) * -1)");
    expect(cssRule(styles, ".note-database-container .db-timeline-axis")).toContain("width: 100%");
    expect(cssRule(styles, ".note-database-container .db-timeline-axis")).not.toContain("var(--db-timeline-group-width");
    expect(cssRule(styles, ".note-database-container .db-timeline-ticks")).toContain("grid-column: 1 / -1");
    expect(cssRule(styles, ".note-database-container .db-timeline-ticks")).toContain("grid-template-columns: repeat(var(--db-timeline-units), var(--db-timeline-unit-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline-ticks")).not.toContain("background-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-ticks")).not.toContain("var(--db-timeline-grid-fade)");
    expect(cssRule(styles, ".note-database-container.db-view-timeline:not(.note-database-embed) .db-timeline-ticks")).toContain("border-bottom: 0");
    expect(styles).toContain(".note-database-container.db-view-timeline:not(.note-database-embed) .db-timeline-ticks::after");
    expect(cssRule(styles, ".note-database-container.db-view-timeline:not(.note-database-embed) .db-timeline-ticks::after")).toContain("left: calc(var(--db-timeline-extension-width) * -1)");
    expect(cssRule(styles, ".note-database-container.db-view-timeline:not(.note-database-embed) .db-timeline-ticks::after")).toContain("right: calc(var(--db-timeline-extension-width) * -1)");
    expect(cssRule(styles, ".note-database-container.db-view-timeline:not(.note-database-embed) .db-timeline-ticks::after")).not.toContain("width: 100vw");
    expect(cssRule(styles, ".note-database-container.db-view-timeline:not(.note-database-embed) .db-timeline-ticks::after")).not.toContain("transform: translateX(-50%)");
    expect(styles).not.toContain(".note-database-container .db-timeline-tick:first-child span");
    expect(cssRule(styles, ".note-database-container .db-timeline-ticks-band")).toContain("grid-column: 1 / -1");
    expect(cssRule(styles, ".note-database-container .db-timeline-ticks-band")).toContain("grid-template-columns: repeat(var(--db-timeline-units), var(--db-timeline-unit-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline-ticks-band")).toContain("min-height: 24px");
    expect(cssRule(styles, ".note-database-container .db-timeline-band-item")).toContain("grid-column: var(--db-timeline-band-start, auto) / span var(--db-timeline-band-span, 1)");
    expect(cssRule(styles, ".note-database-container .db-timeline-band-item")).toContain("font-family: var(--db-title-font-family)");
    expect(cssRule(styles, ".note-database-container .db-timeline-body")).toContain("width: max(100%, var(--db-timeline-content-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline-body")).toContain("min-width: 100%");
    expect(cssRule(styles, ".note-database-container .db-timeline-body")).toContain("flex: 1 1 auto");
    expect(cssRule(styles, ".note-database-container .db-timeline-body")).toContain("background-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-body")).not.toContain("var(--db-timeline-grid-fade)");
    expect(cssRule(styles, ".note-database-container .db-timeline-body")).toContain("background-position: 0 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-body")).not.toContain("var(--db-timeline-group-width");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line")).toContain("left: var(--db-timeline-today-offset-px, calc(var(--db-timeline-unit-width) * var(--db-timeline-today-offset-units, 0)))");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line")).toContain("top: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line")).toContain("background: var(--db-current-time-color)");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line")).not.toContain("box-shadow");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line::before")).toContain("top: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line::before")).toContain("background: var(--db-current-time-color)");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line::before")).not.toContain("box-shadow");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line::before")).toContain("transform: translate(-50%, -50%)");
    expect(styles).not.toContain("db-timeline-current-bridge");
    expect(styles).toContain(".note-database-container .db-timeline-tick.is-current-time-tick .db-timeline-tick-date");
    expect(styles).toContain(".note-database-container .db-timeline-tick.is-current-date-tick .db-timeline-tick-date");
    expect(styles).not.toContain(".note-database-container .db-timeline-tick.is-current-date-tick span,");
    expect(styles).toContain(".note-database-container .db-calendar-week-hour-label.is-current-time-tick");
    expect(cssRule(styles, ".note-database-container .db-timeline-tick.is-current-time-tick .db-timeline-tick-date,\n.note-database-container .db-calendar-week-hour-label.is-current-time-tick")).toContain("color: var(--db-current-time-color)");
    expect(cssRule(styles, ".note-database-container .db-calendar-day.is-today .db-calendar-day-number")).toContain("background: var(--db-current-time-color)");
    expect(cssRule(styles, ".note-database-container .db-timeline-tick.is-current-date-tick .db-timeline-tick-date,\n.note-database-container .db-calendar-week-day-num.is-today,\n.note-database-container .db-calendar-week-allday-date.is-today")).toContain("background: var(--db-current-time-color)");
    expect(cssRule(styles, ".note-database-container .db-timeline-tick.is-current-date-tick .db-timeline-tick-date,\n.note-database-container .db-calendar-week-day-num.is-today,\n.note-database-container .db-calendar-week-allday-date.is-today")).toContain("border-radius: 999px");
    expect(cssRule(styles, ".note-database-container .db-timeline-tick.is-current-date-tick .db-timeline-tick-date,\n.note-database-container .db-calendar-week-day-num.is-today,\n.note-database-container .db-calendar-week-allday-date.is-today")).toContain("width: 22px");
    expect(cssRule(styles, ".note-database-container .db-timeline-tick.is-current-date-tick .db-timeline-tick-date,\n.note-database-container .db-calendar-week-day-num.is-today,\n.note-database-container .db-calendar-week-allday-date.is-today")).toContain("height: 22px");
    expect(cssRule(styles, ".note-database-container .db-timeline-tick.is-current-date-tick .db-timeline-tick-date,\n.note-database-container .db-calendar-week-day-num.is-today,\n.note-database-container .db-calendar-week-allday-date.is-today")).toContain("padding: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-tick.is-current-date-tick .db-timeline-tick-date,\n.note-database-container .db-calendar-week-day-num.is-today,\n.note-database-container .db-calendar-week-allday-date.is-today")).not.toContain("padding: 0 6px");
    expect(cssRule(styles, ".note-database-container .db-timeline-tick.is-current-date-tick .db-timeline-tick-date,\n.note-database-container .db-calendar-week-day-num.is-today,\n.note-database-container .db-calendar-week-allday-date.is-today")).not.toContain("box-shadow");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line")).not.toContain("clamp(");
    expect(cssRule(styles, ".note-database-container .db-timeline-today-line")).not.toContain("var(--db-timeline-group-width");
    expect(styles).toContain("column-gap: 0");
    expect(styles).toContain("repeat(var(--db-timeline-event-rows, 0), var(--db-timeline-event-row-height, 24px))");
    expect(cssRule(styles, ".note-database-container .db-calendar-timed-current-line")).toContain("background: var(--db-current-time-color)");
    expect(cssRule(styles, ".note-database-container .db-calendar-timed-current-line")).not.toContain("box-shadow");
    expect(cssRule(styles, ".note-database-container .db-calendar-timed-current-line::before")).toContain("background: var(--db-current-time-color)");
    expect(cssRule(styles, ".note-database-container .db-calendar-timed-current-line::before")).not.toContain("box-shadow");
    expect(styles).not.toContain("db-calendar-week-current-bridge");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-current-time-color");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-current-time-saturation: max(var(--accent-s, 82%), 82%)");
    expect(cssRule(styles, ".note-database-container")).toContain("--db-current-time-color: hsl(var(--accent-h, 254) var(--db-current-time-saturation) var(--db-current-time-lightness))");
    expect(cssRule(styles, ".note-database-container")).not.toContain("--db-current-time-halo");
    expect(cssRule(styles, ".note-database-container")).not.toContain("--db-current-time-glow");
    expect(cssRule(styles, ".theme-dark .note-database-container")).toContain("--db-current-time-lightness: clamp(58%, calc(var(--accent-l, 56%) + 10%), 70%)");
    expect(cssRule(styles, ".note-database-container .db-toolbar .db-new-button:hover")).toContain("var(--interactive-accent)");
    expect(cssRule(styles, ".note-database-container .db-toolbar .db-new-button:hover")).not.toContain("var(--background-modifier-hover)");
    expect(cssRule(styles, ".note-database-container .db-calendar-range-row .db-view-config-range")).toContain("grid-template-columns: minmax(0, 1fr) 64px");
    expect(styles).not.toContain(".db-calendar-timeline-range-row input[type=\"range\"]");
    expect(styles).toContain("grid-row: var(--db-timeline-row, 1)");
    expect(styles).toContain(".note-database-container .db-timeline-group");
    expect(styles).toContain(".note-database-container .db-timeline-group-header");
    expect(styles).toContain(".note-database-container .db-timeline-group-toggle");
    expect(cssRule(styles, ".note-database-container .db-timeline-group-header")).not.toContain("background");
    expect(cssRule(styles, ".note-database-container .db-timeline-group-header-grid")).not.toContain("background");
    expect(styles).toContain(".note-database-container .db-timeline-window-jump");
    expect(styles).toContain(".note-database-container .db-calendar-mini-view-grid");
    expect(styles).toContain(".note-database-container .db-calendar-mini-view-cell");
    expect(styles).toContain(".note-database-container .db-calendar-mini-view-cell.has-events");
    expect(styles).toContain(".note-database-container .db-calendar-mini-footer");
    expect(styles).toContain(".note-database-container .db-calendar-mini-today");
    expect(cssRule(styles, ".note-database-container .db-calendar-mini-footer")).toContain("justify-content: flex-end");
    expect(cssRule(styles, ".note-database-container .db-calendar-mini-today")).toContain("color: var(--text-muted)");
    expect(cssRule(styles, ".note-database-container .db-calendar-mini-today:hover")).toContain("color: var(--interactive-accent)");
    expect(styles).not.toContain(".note-database-container .db-calendar-day.is-flash");
    expect(styles).toContain(".note-database-container .db-calendar-month-flash-column");
    // 表头日期数字不再染色高亮（用户反馈不美观），但保留主体泳道的列背景闪光条
    expect(styles).not.toContain(".note-database-container .db-timeline-tick.is-flash .db-timeline-tick-date::after");
    expect(styles).toContain(".note-database-container .db-timeline-body-flash-column");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump")).toContain("position: sticky");
    expect(styles).toContain(".note-database-container .db-timeline-window-jump svg");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump svg")).toContain("width: 14px");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump svg")).toContain("height: 14px");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump.is-after")).toContain("right: 6px");
    expect(cssRule(styles, ".note-database-container .db-timeline-event")).not.toContain("mask-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-start")).toContain("border-left: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-start")).not.toContain("mask-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-start::before")).toContain("left: calc(var(--db-timeline-clipped-fade-width) * -1)");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-start::before")).toContain("mask-image: linear-gradient(to right, transparent 0, black 100%)");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end")).toContain("border-top-right-radius: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end")).toContain("background-color: transparent");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end")).toContain("background-image: none");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end")).toContain("box-shadow: none");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end")).not.toContain("mask-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end::after")).toContain("inset: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end::after")).toContain("box-shadow: var(--db-timeline-event-shadow)");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end::after")).not.toContain("right: calc(var(--db-timeline-clipped-fade-width) * -1)");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end::after")).not.toContain("var(--background-primary) 100%");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end::after")).toContain("mask-image: linear-gradient(to right, black 0, black calc(100% - var(--db-timeline-clipped-fade-width)), transparent 100%)");
    expect(cssRule(styles, ".note-database-container .db-timeline-event-content")).toContain("position: relative");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end .db-timeline-event-content")).not.toContain("mask-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end .db-timeline-event-content")).not.toContain("-webkit-mask-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end .db-timeline-event-title")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end .db-timeline-event-title")).toContain("overflow: hidden");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end .db-timeline-event-meta")).toContain("min-width: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end .db-timeline-event-meta")).toContain("overflow: hidden");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end .db-timeline-event-meta")).not.toContain("mask-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end .db-timeline-event-meta")).not.toContain("-webkit-mask-image");
    expect(cssRule(styles, ".note-database-container .db-timeline-event.is-clipped-end.is-resizing")).toContain("box-shadow: none");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump")).toContain("opacity: 0.78");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump")).toContain("pointer-events: auto");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump.is-over-event")).toContain("opacity: 0");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump.is-over-event")).toContain("pointer-events: none");
    expect(styles).toContain(".note-database-container .db-timeline-events:hover .db-timeline-window-jump.is-over-event");
    expect(styles).toContain(".note-database-container .db-timeline-window-jump.is-over-event:focus-visible");
    expect(styles).toContain("pointer-events: auto");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump.is-before")).not.toContain("translateX(calc(-100%");
    expect(cssRule(styles, ".note-database-container .db-timeline-window-jump.is-after")).not.toContain("translateX(calc(100%");
    expect(styles).toContain(".note-database-container .db-timeline-create-row");
    expect(cssRule(styles, ".note-database-container .db-timeline-events")).toContain("width: max(100%, var(--db-timeline-content-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline-events")).toContain("grid-template-columns: repeat(var(--db-timeline-units), var(--db-timeline-unit-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline-events")).not.toContain("margin-left");
    expect(cssRule(styles, ".note-database-container .db-timeline-create-row")).toContain("width: max(100%, var(--db-timeline-content-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline-create-row")).toContain("grid-template-columns: repeat(var(--db-timeline-units), var(--db-timeline-unit-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline-create-row")).not.toContain("margin-left");
    expect(styles).toContain(".note-database-container .db-timeline-create-button");
    expect(styles).toContain(".note-database-container .db-timeline-create-button::before");
    expect(cssRule(styles, ".note-database-container .db-timeline-create-button")).toContain("--db-timeline-create-label-min-width: 72px");
    expect(styles).toContain("var(--db-timeline-create-left, 0px)");
    expect(styles).toContain("var(--db-timeline-create-width, var(--db-timeline-unit-width))");
    expect(styles).toContain(".note-database-container .db-timeline-create-button.is-previewing::before");
    expect(cssRule(styles, ".note-database-container .db-timeline-create-content")).toContain("--db-timeline-create-content-left");
    expect(cssRule(styles, ".note-database-container .db-timeline-create-content")).toContain("left: var(--db-timeline-create-content-left)");
    expect(cssRule(styles, ".note-database-container .db-timeline-create-content")).toContain("width: max(var(--db-timeline-create-width, var(--db-timeline-unit-width)), var(--db-timeline-create-label-min-width))");
    expect(cssRule(styles, ".note-database-container .db-timeline-create-content")).toContain("max-width: calc(100% - var(--db-timeline-create-content-left))");
    expect(styles).toContain(".note-database-container .db-timeline-events.is-drop-target");
    expect(styles).toContain(".note-database-container .db-timeline-events.is-resize-target");
    expect(styles).toContain(".note-database-container .db-timeline-snap-marker");
    expect(styles).toContain(".note-database-container .db-timeline-snap-marker.is-timed-range");
    expect(styles).toContain(".note-database-container .db-timeline-event > .db-timeline-snap-marker");
    expect(styles).toMatch(/\.note-database-container \.db-calendar-timed-drag-preview,\n\.note-database-container \.db-timeline-snap-marker\.is-timed-range,\n\.note-database-container \.db-timeline-event > \.db-timeline-snap-marker \{[\s\S]*?border-radius: 3px;[\s\S]*?background: var\(--interactive-accent\);[\s\S]*?color: var\(--text-on-accent\);/);
    expect(styles).toContain("bottom: 4px");
    expect(cssRule(styles, ".note-database-container .db-timeline-snap-marker.is-timed-range")).toContain("left: var(--db-timeline-snap-left, 8px)");
    expect(cssRule(styles, ".note-database-container .db-timeline-snap-marker.is-timed-range")).toContain("width: var(--db-timeline-snap-width, max-content)");
    expect(cssRule(styles, ".note-database-container .db-timeline-snap-marker.is-timed-range")).toContain("min-width: min(220px, calc(100% - var(--db-timeline-snap-left, 8px) - 8px))");
    expect(cssRule(styles, ".note-database-container .db-timeline-snap-marker.is-timed-range")).toContain("max-width: calc(100% - var(--db-timeline-snap-left, 8px) - 8px)");
    expect(styles).toMatch(/\.note-database-container \.db-timeline-event > \.db-timeline-snap-marker \{[\s\S]*?left: 6px;[\s\S]*?right: auto;[\s\S]*?width: max-content;/);
    expect(styles).toContain(".note-database-container .db-timeline-resize-handle");
    expect(styles).toContain(".note-database-container .db-timeline-resize-handle::before");
    expect(styles).toContain(".note-database-container .db-timeline-event.is-resizing");
    expect(styles).toContain("cursor: ew-resize");
    expect(styles).toContain("width: 12px");
    expect(styles).toContain("left: -3px");
    expect(styles).not.toContain(".note-database-container .db-timeline-reorder-handle");
    expect(styles).toContain(".note-database-container .db-timeline-mobile-menu-button");
    // move ghost 已随 move 专用 HTML5 drag 死代码删除，孤儿 CSS 也一并清理。
    expect(styles).not.toContain(".note-database-container .db-timeline-drag-ghost");
    expect(styles).toContain(".note-database-container .db-timeline-event.is-moving");
    expect(styles).not.toContain(".db-timeline-transparent-drag-image");
    expect(styles).toContain("box-shadow: 0 12px 26px rgba(0, 0, 0, 0.18)");
    expect(styles).not.toContain(".db-drag-preview");
    expect(styles).not.toContain(".note-database-container .db-timeline-event.is-drop-before::before");
    expect(styles).toContain(".note-database-container .db-timeline-group-tag");
    expect(styles).toContain("background: none");
    expect(styles).toContain("background-color: var(--background-primary)");
    expect(styles).toContain("background-image: linear-gradient(");
    // U3：is-timed 双轨已删，所有事件统一用 base 的 exact-offset/width 定位。
    expect(styles).not.toContain(".note-database-container .db-timeline-event.is-timed");
    expect(cssRule(styles, ".note-database-container .db-timeline-event")).toContain("min-height: 20px");
    expect(cssRule(styles, ".note-database-container .db-timeline-event")).toContain("height: 20px");
    expect(cssRule(styles, ".note-database-container .db-timeline-event-title")).toContain("flex: 0 0 auto");
    expect(cssRule(styles, ".note-database-container .db-timeline-event-title")).toContain("min-width: max-content");
    expect(cssRule(styles, ".note-database-container .db-timeline-event-title")).toContain("overflow: visible");
    expect(cssRule(styles, ".note-database-container .db-timeline-event-title")).not.toContain("text-overflow: ellipsis");
    expect(styles).not.toContain(".note-database-container .db-timeline.is-scale-day .db-timeline-events");
    expect(styles).toContain(".note-database-container .db-timeline.is-scale-day.is-slot-15 .db-timeline-body");
    expect(styles).toContain(".note-database-container .db-timeline.is-scale-day.is-slot-30 .db-timeline-body");
    expect(styles).toContain("calc(var(--db-timeline-unit-width) * 0.25");
    expect(styles).toContain("calc(var(--db-timeline-unit-width) * 0.5");
    expect(cssRule(styles, ".note-database-container .db-timeline.is-scale-day.is-slot-15 .db-timeline-body")).toContain("background-size: var(--db-timeline-unit-width) 100%, var(--db-timeline-unit-width) 100%");
    expect(cssRule(styles, ".note-database-container .db-timeline.is-scale-day.is-slot-15 .db-timeline-body")).toContain("background-repeat: repeat, repeat");
    expect(cssRule(styles, ".note-database-container .db-timeline.is-scale-day.is-slot-30 .db-timeline-body")).toContain("background-size: var(--db-timeline-unit-width) 100%, var(--db-timeline-unit-width) 100%");
    expect(cssRule(styles, ".note-database-container .db-timeline.is-scale-day.is-slot-30 .db-timeline-body")).toContain("background-repeat: repeat, repeat");
    expect(styles).toContain(".note-database-container .db-timeline.is-scale-day.is-slot-60 .db-timeline-body");
    expect(styles).toContain("margin-left: var(--db-timeline-exact-offset, 0px)");
    expect(styles).toContain("width: var(--db-timeline-exact-width, 100%)");
    expect(styles).toContain(".note-database-container .db-timeline-group-count");
    // U3：grid-column 不再用 offset/span 定位（改 1/-1 占满行），水平定位统一走 margin-left/width (exact)。
    expect(styles).toContain("grid-column: 1 / -1");
    expect(i18n).toContain("\"timeline.uncategorized\"");
    expect(i18n).toContain("\"timeline.noEventsInRange\"");
    expect(i18n).toContain("\"timeline.jumpToEvent\"");
    expect(i18n).toContain("\"timeline.prevShort\"");
    expect(i18n).toContain("\"timeline.nextShort\"");
    expect(i18n).toContain("\"timeline.prevLong\"");
    expect(i18n).toContain("\"timeline.nextLong\"");
    expect(i18n).toContain("\"timeline.dayRequiresDateTime\"");
    expect(i18n).toContain("\"calendar.convertDateTimeTitle\"");
    expect(i18n).toContain("\"calendar.convertDateTimeMessage\"");
    expect(i18n).toContain("\"calendar.convertDateTimeConfirm\"");
    expect(i18n).toContain("\"calendar.noWritableDateField\"");
    expect(i18n).toContain("\"calendar.sameDateFieldWarning\"");
    expect(i18n).toContain("\"calendar.sameDateFieldNotice\"");
    expect(i18n).toContain("\"calendar.resizeStart\"");
    expect(i18n).toContain("\"calendar.resizeEnd\"");
    expect(i18n).toContain("\"calendar.moveToday\"");
    expect(i18n).toContain("\"calendar.moveToDatePrompt\"");
    expect(i18n).toContain("\"calendar.extendOneDay\"");
    expect(i18n).toContain("\"undo.timelineDates\"");
  });

  it("uses compact calendar layout render paths for month, week, and day", () => {
    const renderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const toolbar = readFileSync(new URL("../views/CalendarToolbarRenderer.ts", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(renderer).toContain("buildCalendarMonthWeekLayouts");
    expect(renderer).toContain("buildCalendarTimedEventLayouts");
    expect(renderer).toContain("buildCalendarWeekAllDayLayout");
    expect(renderer).toContain("this.renderDay(container, config, rows)");
    expect(renderer).toContain("renderMonthSegments");
    expect(renderer).toContain("renderTimeHeaderRow");
    expect(renderer).toContain("renderCurrentTimeLine");
    expect(renderer).toContain("setupTimeRangeSelection");
    expect(renderer).toContain("setupTimedEventPointerDrag");
    expect(renderer).toContain("db-calendar-month-segment");
    expect(renderer).toContain("db-calendar-month-timed-dot");
    expect(renderer).not.toContain("this.renderDayEvents(eventsContainer, config, day.events, columns, titleField)");

    expect(toolbar).toContain("{ value: \"day\", text: t(\"calendar.scaleDay\") }");
    expect(toolbar).toContain("calendarStartHour");
    expect(toolbar).toContain("calendarEndHour");
    expect(toolbar).toContain("calendarHourHeight");

    expect(dashboard).toContain("startTimeMinutes");
    expect(dashboard).toContain("formatCalendarDateTimeValue");
  });

  it("uses real-edge semantics for calendar all-day segments", () => {
    const renderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const allDaySection = renderer.slice(
      renderer.indexOf("private renderAllDaySection("),
      renderer.indexOf("private createAllDayOverflowPopover("),
    );

    expect(allDaySection).toContain('segment.isStart ? "is-start" : "is-continuation"');
    expect(allDaySection).toContain('segment.isEnd ? "is-end" : "continues-after"');
    expect(allDaySection).toContain('if (segment.isStart) this.attachMonthResizeHandle(eventEl, stage, days, segment, config, "resize-start", ".db-calendar-week-allday-cols", ".db-calendar-week-allday-col", days.length)');
    expect(allDaySection).toContain('if (segment.isEnd) this.attachMonthResizeHandle(eventEl, stage, days, segment, config, "resize-end", ".db-calendar-week-allday-cols", ".db-calendar-week-allday-col", days.length)');
    const monthSegments = renderer.slice(
      renderer.indexOf("private renderMonthSegments("),
      renderer.indexOf("private renderMonthOverflowButtons("),
    );
    expect(monthSegments).toContain('this.attachMonthResizeHandle(eventEl, weekEl, layout.days, segment, config, "resize-start", ".db-calendar-month-week", ".db-calendar-day", 7)');
    expect(monthSegments).not.toContain("if (!segment.isTimed && !this.actions.isReadOnly");
    expect(renderer).toContain("private resolveMonthMoveTarget(");
    expect(renderer).not.toContain("private monthTargetFromPointer(");

    expect(cssRule(styles, ".note-database-container .db-calendar-month-segment.is-all-day.is-continuation")).toContain("border-left-color: transparent");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-segment.is-all-day.continues-after")).toContain("background-color: transparent");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-segment.is-all-day.is-continuation::before")).toContain("mask-image: linear-gradient(to right, transparent 0, black 100%)");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-segment.is-all-day.continues-after::after")).toContain("mask-image: linear-gradient(to right, black 0, black calc(100% - 18px), transparent 100%)");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-time")).toContain("z-index: 1");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-title")).toContain("z-index: 1");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-dates")).toContain("z-index: 1");
    expect(cssRule(styles, ".note-database-container .db-calendar-time-columns .db-calendar-week-day-col.is-drop-target,\n.note-database-container .db-calendar-week-allday-col.is-drop-target,\n.note-database-container .db-calendar-week-allday-col.is-resize-target")).toContain("outline:");
  });

  it("keeps calendar event card text on the default UI font", () => {
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    expect(cssRule(styles, ".note-database-container .db-calendar-month-title")).toContain("font-family: var(--font-interface)");
    expect(cssRule(styles, ".note-database-container .db-calendar-month-title")).not.toContain("var(--db-title-font-family)");
    expect(styles).not.toContain(".note-database-container .db-calendar-day-view .db-calendar-week-allday-gutter");
    expect(styles).not.toContain(".note-database-container .db-calendar-day-view .db-calendar-week-allday-date");
    expect(styles).not.toContain(".note-database-container .db-calendar-day-view .db-calendar-week-day-name");
    expect(cssRule(styles, ".note-database-container .db-calendar-day-view .db-calendar-time-header-day")).toContain("justify-content: flex-start");
    expect(cssRule(styles, ".note-database-container .db-calendar-day-view .db-calendar-time-header-day")).toContain("text-align: left");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-date")).toContain("justify-self: start");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-date")).toContain("margin: 2px 0 0 10px");
    expect(renderer).toContain("db-calendar-week-allday-empty");
    expect(renderer).toContain("calendar.noAllDayEvents");
    expect(renderer).toContain("let firstAllDayCol: HTMLElement | null = null");
    expect(renderer).toContain("firstAllDayCol?.createDiv({ cls: \"db-calendar-week-allday-empty\"");
    expect(renderer).not.toContain("empty.setCssProps({ gridColumn");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-empty")).toContain("position: absolute");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-empty")).toContain("left: 10px");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-empty")).toContain("top: 34px");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-empty")).toContain("line-height: 1.4");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-empty")).toContain("justify-self: start");
    expect(cssRule(styles, ".note-database-container .db-calendar-week-allday-empty")).toContain("text-align: left");
    expect(i18n).toContain("\"calendar.noAllDayEvents\"");
    expect(i18n).toContain("\"calendar.noAllDayEvents\": \"无全天 / 跨天事件\"");
  });

  it("lets cross-day all-day events drag and resize in day scale instead of silently skipping", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    // 旧逻辑 `if (isAllDay && !canPromoteAllDayToTimed) return` 让跨天 all-day 事件在
    // 日视图直接 return，跳过所有拖拽/resize——这是「跨天事件无法拖拽重排序也无法
    // resize」的根因。确保该粗暴 return 已删除。
    expect(renderer).not.toContain("if (isAllDay && !canPromoteAllDayToTimed) return");
    // U4：date 列事件（含跨天）统一走 date 交互（重排序/移动 + 按天 resize），按列类型而非
    // isCrossDayAllDay 分流；不再有粗暴 return。
    expect(renderer).toContain("const useTimedMove = model.scale === \"day\" && !isDateColumn");
    // resize 入口同样按列类型分流：date 列用按天 resize（beginTimelineResize）。
    expect(renderer).toContain("(model.unit === \"hour\" || model.scale === \"day\") && !isDateColumn");
    // 日视图按天交互：getTimelineDateFromPoint 在 day scale 按 eventsEl 全宽算天偏移，
    // 不再把小时 index 当天偏移（拖 1 小时宽度 = 1 天的错乱映射）。
    expect(renderer).toContain("if (scale === \"day\")");
  });

  it("preserves datetime time on month move and avoids invalid on plus-create", () => {
    const calendarRenderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    // 月视图 move（pointer）通过共享 helper 透传原有时间分量：beginMonthMove onUp 透传 segment.event 时刻。
    expect(calendarRenderer).toContain("resolveDayMoveChange({");
    expect(calendarRenderer).toContain("startMinutes: segment.event.startMinutes");
    expect(calendarRenderer).toContain("endMinutes: segment.event.endMinutes");
    // + 号新增 datetime 列默认 T00:00 / T23:59，避免同天 00:00→00:00 零宽 invalid。
    expect(dashboard).toContain("startIsDateTime ? 0");
    expect(dashboard).toContain("23 * 60 + 59");
    // move 跨天事件保持跨度：beginMonthMove 防御性重算 durationDays（不信任 event.durationDays=1）。
    expect(calendarRenderer).toContain("dateKeyDaysBetween(segment.event.startDateKey, segment.event.endDateKey)");
    // 单侧 datetime 创建弹转换确认：date 端转 datetime，拒绝则不创建（不污染 date 列、不产生 invalid）。
    expect(dashboard).toContain("needStartConvert");
    expect(dashboard).toContain("needEndConvert");
    expect(dashboard).toContain("ensureCalendarTimelineDateTimeFields([");
    expect(dashboard).toContain("if (!ok) return");
  });
});

describe("timeline cross-day event meta label", () => {
  it("formats day-scale timed ranges with a dated start and hyphen separator", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    const metaFormatter = renderer.slice(
      renderer.indexOf("private formatTimelineEventMeta("),
      renderer.indexOf("private isCurrentTimelineTick("),
    );
    const timedPreview = renderer.slice(
      renderer.indexOf("const preview = (start: number, end: number): void =>"),
      renderer.indexOf("const onMove = (moveEvent: MouseEvent): void =>"),
    );
    // 日视图 timed range 的开始端必须带日期，分隔符跟其它尺度一样用 hyphen，不用右箭头/次日文案。
    expect(metaFormatter).toContain("formatTimelineDayTimeRange(event.startDateKey, event.startMinutes, event.endDateKey, event.endMinutes)");
    expect(timedPreview).toContain("formatTimelineDayTimeRange(startDateTime.dateKey, startDateTime.minutes, endDateTime.dateKey, endDateTime.minutes)");
    expect(timedPreview).toContain("this.renderTimelineRangeSnap(eventsEl, button, label, previewStart, visible.startMinutes, model.unit, unitWidth)");
    expect(timedPreview).not.toContain("this.renderTimelineSnap(button, label)");
    expect(metaFormatter).not.toContain("→");
    expect(metaFormatter).not.toContain("timeline.nextDay");
    expect(timedPreview).not.toContain("→");
    expect(timedPreview).not.toContain("timeline.nextDay");
    // 拖拽 preview 用 dayOffset 判断跨几天（避免跨多天误显 next day）。
    expect(timedPreview).not.toContain("dayOffset === 1");
  });

  it("anchors timeline drag preview cards from the visible range start and clamps them inside the lane", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    const resizePreview = renderer.slice(
      renderer.indexOf("const previewRange = (targetKey: string): void =>"),
      renderer.indexOf("const targetFromX = (clientX: number): string =>"),
    );
    const dateMovePreview = renderer.slice(
      renderer.indexOf("const preview = (startDay: number): void =>"),
      renderer.indexOf("const clearReorderLine = (): void =>"),
    );
    const rangeSnap = renderer.slice(
      renderer.indexOf("private renderTimelineRangeSnap("),
      renderer.indexOf("private renderTimelineSnap("),
    );
    const snapRenderer = renderer.slice(
      renderer.indexOf("private renderTimelineSnap("),
      renderer.indexOf("private getTimelineTimedDropTarget("),
    );

    expect(resizePreview).toContain("this.renderTimelineRangeSnap(eventsEl, button, this.formatDateRange(nextStartKey, nextEndKey), renderStart, visible.startMinutes, unit, unitWidth)");
    expect(resizePreview).not.toContain("this.renderTimelineSnap(button");
    expect(dateMovePreview).toContain("this.renderTimelineRangeSnap(eventsEl, button, label, renderStart, visible.startMinutes, unit, unitWidth)");
    expect(dateMovePreview).not.toContain("this.renderTimelineSnap(button");
    expect(rangeSnap).toContain("leftPx: ((renderStart - visibleStart) / minutesPerUnit) * unitWidth");
    expect(rangeSnap).toContain("widthPx: this.getTimelineSnapPreviewWidth(label)");
    expect(snapRenderer).toContain("const laneWidth = eventsEl.clientWidth || eventsEl.getBoundingClientRect().width || 0");
    expect(snapRenderer).toContain("const maxLeft = Math.max(8, laneWidth - snapWidth - 8)");
    expect(snapRenderer).toContain("Math.min(maxLeft, Math.max(8, options!.leftPx!))");
    expect(snapRenderer).toContain("--db-timeline-snap-width");
  });
});

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}
