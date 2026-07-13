import { Menu, setIcon, setTooltip } from "obsidian";
import { formatCalendarTime, getCalendarSlotDuration } from "../data/CalendarLayoutModel";
import { isExplicitlySorted } from "../data/ManualOrder";
import { CalendarTitleParts, buildTimelineAxisBands, formatCalendarTitleParts } from "../data/CalendarTitleFormatter";
import { buildCalendarMonthModel, buildTimelineModel, buildTimelineTicks, CalendarTimelineEvent, getDefaultEventDateField, getTimelineAnchor, getTimelineNavigationShiftUnits, getTimelineShortNavigationShiftUnits, getTimelineTitleWindow, getTimelineViewportContentWidth, getTimelineViewportStartAnchor, normalizeTimelineDayScale, resolveEventAbsoluteScale, resolveTimelineJumpAnchor, resolveTimelineReorderNeighbors, resolveTimelineUnitWidth, resolveTimelineViewportUnitCount, resolveTimelineViewportUnitSpan, shiftCalendarMonth, TimelineUnit, UNCATEGORIZED_TIMELINE_LANE } from "../data/CalendarTimelineModel";
import {
  CALENDAR_TIME_SNAP_MINUTES,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  addDateKeyDays,
  dateKeyDaysBetween,
  getLocalDateKey,
  getLocaleWeekStartsOn,
  getWeekdayLabels,
  minuteOfDay,
  parseDateKeyToUtc,
  snapMinutes,
} from "../data/CalendarDateTime";
import { CalendarEventCreateOptions, CalendarEventDateChange, resolveAllDayResizeChange, resolveDayMoveChange, resolveDayRangeResize, resolveTimedDragRange } from "../data/CalendarInteractionModel";
import { CalendarTimelineSearchVisibleRange, timelineHourRange } from "../data/CalendarTimelineSearchResults";
import { formatDateRangeDisplay, formatDateValueDisplay, parseDateTimeParts } from "../data/DateTimeFormat";
import { RowData, TimelineScale, ViewConfig } from "../data/types";
import { getEffectiveLocale, t } from "../i18n";
import { openDropdownMenu } from "./DropdownField";
import { buildMiniCalendarEventIndex, MiniCalendarMode, renderMiniCalendar } from "./CalendarMiniCalendarRenderer";
import { renderGroupExpandControls } from "./GroupExpandControls";
import { getGroupVisibleCount } from "../data/GroupVisibility";

const TIME_SNAP_MINUTES = CALENDAR_TIME_SNAP_MINUTES;

export interface TimelineTimedPositionStyle {
  offsetUnits: number;
  durationUnits: number;
  cssProps: Record<string, string>;
}

export interface TimelineTodayPositionStyle {
  offsetUnits: number;
  cssProps: Record<string, string>;
}

function formatTimelineUnitCssValue(value: number): string {
  if (!Number.isFinite(value)) return "1";
  return String(Math.round(value * 1000) / 1000);
}

export function getTimelineTimedPositionStyle(
  startMinutes: number,
  endMinutes: number,
  visibleStartMinutes: number,
  visibleEndMinutes: number,
  totalUnits: number
): TimelineTimedPositionStyle {
  const start = Math.max(visibleStartMinutes, Math.min(visibleEndMinutes - TIME_SNAP_MINUTES, startMinutes));
  const end = Math.min(visibleEndMinutes, Math.max(start + TIME_SNAP_MINUTES, endMinutes));
  const offsetUnits = Math.max(0, (start - visibleStartMinutes) / 60);
  const durationUnits = Math.max(TIME_SNAP_MINUTES / 60, (end - start) / 60);
  return {
    offsetUnits,
    durationUnits,
    cssProps: {
      "--db-timeline-offset": "1",
      "--db-timeline-span": String(Math.max(1, totalUnits)),
      "--db-timeline-exact-offset": `calc(var(--db-timeline-unit-width) * ${formatTimelineUnitCssValue(offsetUnits)})`,
      "--db-timeline-exact-width": `calc(var(--db-timeline-unit-width) * ${formatTimelineUnitCssValue(durationUnits)})`,
    },
  };
}

export function getTimelineTodayPositionStyle(
  now: Date,
  model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; scale: TimelineScale; unit: TimelineUnit },
  unitWidth: number,
): TimelineTodayPositionStyle | null {
  if (!model.startDateKey || !model.endDateKey || !Number.isFinite(now.getTime())) return null;
  const today = getLocalDateKey(now);
  let offsetUnits: number;

  if (model.scale === "day") {
    const daysFromWindowStart = dateKeyDaysBetween(model.startDateKey, today);
    if (daysFromWindowStart == null) return null;
    const windowStartMinutes = typeof model.startMinutes === "number" && Number.isFinite(model.startMinutes) ? model.startMinutes : 0;
    const currentMinutes = daysFromWindowStart * MINUTES_PER_DAY
      + now.getHours() * MINUTES_PER_HOUR
      + now.getMinutes()
      + now.getSeconds() / MINUTES_PER_HOUR
      + now.getMilliseconds() / 60000;
    offsetUnits = (currentMinutes - windowStartMinutes) / MINUTES_PER_HOUR;
  } else {
    if (today < model.startDateKey || today > model.endDateKey) return null;
    const daysFromWindowStart = dateKeyDaysBetween(model.startDateKey, today);
    if (daysFromWindowStart == null) return null;
    const dayFraction = (
      now.getHours() * MINUTES_PER_HOUR
      + now.getMinutes()
      + now.getSeconds() / MINUTES_PER_HOUR
      + now.getMilliseconds() / 60000
    ) / MINUTES_PER_DAY;
    offsetUnits = daysFromWindowStart + dayFraction;
  }

  if (offsetUnits < 0 || offsetUnits >= model.totalUnits) return null;
  const offsetPx = Number.isFinite(unitWidth) && unitWidth > 0 ? offsetUnits * unitWidth : 0;
  return {
    offsetUnits,
    cssProps: {
      "--db-timeline-today-offset-units": formatTimelineUnitCssValue(offsetUnits),
      "--db-timeline-today-offset-px": `${formatTimelineUnitCssValue(offsetPx)}px`,
    },
  };
}

export interface CalendarTimelineRendererActions {
  openRow(row: RowData): void;
  openRecordDetail?(anchorEl: HTMLElement, row: RowData): void;
  showRowMenu?(event: MouseEvent, row: RowData): void;
  renderRecordIcon?(parent: HTMLElement, row: RowData, config: ViewConfig, compact?: boolean): HTMLElement | null;
  createEntryForDate?(config: ViewConfig, dateKey: string, options?: CalendarTimelineCreateOptions): void;
  updateEventDates?(
    row: RowData,
    changes: CalendarTimelineDateChange
  ): void | Promise<void>;
  reorderTimelineEvent?(row: RowData, beforePath?: string, afterPath?: string): void;
  moveTimelineEventToGroup?(
    row: RowData,
    field: string,
    fromGroupKey: string,
    toGroupKey: string,
    beforePath?: string,
    afterPath?: string
  ): void | Promise<void>;
  updateTimelineAnchor?(dateKey: string, label?: string, timeMinutes?: number): void;
  updateTimelineScale?(scale: TimelineScale, label?: string): boolean | Promise<boolean> | void;
  onConfigChange?(label?: string): void;
  isGroupCollapsed?(field: string, key: string): boolean;
  toggleGroupCollapsed?(field: string, key: string): void;
  expandGroup?(field: string, key: string, count: number): void;
  readonly isReadOnly?: boolean;
  /** 统计被隐藏的无效时间事件数量；导航栏 warning 在 count > 0 时显示，缓存命中可即时返回。 */
  getTimelineInvalidEventCount?(): number | Promise<number>;
  /** 打开「无效时间事件」修复弹窗。 */
  openTimelineInvalidEvents?(): void;
}

export type CalendarTimelineDateChange = CalendarEventDateChange;
export type CalendarTimelineCreateOptions = CalendarEventCreateOptions;

interface TimelineCreateTarget {
  dateKey: string;
  options: CalendarTimelineCreateOptions;
  offsetUnits: number;
  spanUnits: number;
  totalUnits: number;
}

interface TimelineFlashWindow {
  startDateKey: string;
  totalUnits: number;
  scale: TimelineScale;
  startMinutes?: number;
}

export class CalendarTimelineRenderer {
  private rowByPath = new Map<string, RowData>();
  private currentRows: RowData[] = [];
  private timelineResizeInProgress = false;
  private miniCalendarEl: HTMLElement | null = null;
  private miniCalendarMonth: string | null = null;
  private miniCalendarMode: MiniCalendarMode = "day";
  private miniCalendarCleanup: (() => void) | null = null;
  private timelineScaleMenuCleanup: (() => void) | null = null;
  private pendingFlashDateKey: string | null = null;
  private timelineFlashWindow: TimelineFlashWindow | null = null;
  private timelineRoot: HTMLElement | null = null;
  private timelineResizeObserver: ResizeObserver | null = null;
  private timelineObservedUnitCount: number | undefined;
  private timelineObservedUnitSpan: number | undefined;
  private currentVisibleRange: CalendarTimelineSearchVisibleRange | null = null;
  private flashRafHandle: number | null = null;
  private flashTimeoutHandle: number | null = null;
  /** 进行中拖拽的清理函数：移除 capture 监听并复位 resize 标志；视图卸载时调用以避免泄漏/锁死。 */
  private activeTimelineDragCleanup: (() => void) | null = null;
  /** 上一次解析到的无效事件计数；cache miss（Promise）时沿用它做即时显示，避免每次刷新 hide→show 闪现。 */
  private timelineInvalidWarningCount: number | null = null;

  constructor(private actions: CalendarTimelineRendererActions) {}

  getCurrentVisibleRange(): CalendarTimelineSearchVisibleRange | null {
    return this.currentVisibleRange;
  }

  /** 视图卸载/重渲染前的完整清理：断开 ResizeObserver、关闭 mini-calendar/scale menu、
   * 取消挂起的 flash RAF/定时器、中断进行中的拖拽并移除其 capture 监听器。
   * 避免反复打开/关闭时间线视图（尤其嵌入代码块）累积 observer/监听器/闭包泄漏。 */
  destroy(): void {
    this.disconnectTimelineResizeObserver();
    this.closeTimelineMiniCalendar();
    this.closeTimelineScaleMenu();
    this.pendingFlashDateKey = null;
    if (this.flashRafHandle != null) {
      window.cancelAnimationFrame(this.flashRafHandle);
      this.flashRafHandle = null;
    }
    if (this.flashTimeoutHandle != null) {
      window.clearTimeout(this.flashTimeoutHandle);
      this.flashTimeoutHandle = null;
    }
    this.activeTimelineDragCleanup?.();
    this.activeTimelineDragCleanup = null;
    this.timelineRoot = null;
    this.timelineFlashWindow = null;
  }

  renderTimeline(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
    if (normalizeTimelineDayScale(config)) {
      this.actions.onConfigChange?.(t("undo.timelineScaleConfig"));
    }
    this.closeTimelineMiniCalendar();
    this.closeTimelineScaleMenu();
    this.disconnectTimelineResizeObserver();
    if (this.timelineRoot?.isConnected && this.timelineRoot.parentElement === container) this.timelineRoot.remove();
    this.timelineRoot = null;
    this.timelineFlashWindow = null;
    this.currentVisibleRange = null;
    this.currentRows = rows;
    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));
    const startField = config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config);
    if (!startField) {
      this.renderEmpty(container, "timeline.noDateField");
      return;
    }

    const scale = config.timelineScale || "week";
    const unitWidth = this.getTimelineRenderUnitWidth(config, scale);
    const visibleUnitCount = this.getTimelineViewportUnitCount(container, config, unitWidth);
    const visibleUnitSpan = this.getTimelineViewportUnitSpan(container, unitWidth);
    const model = buildTimelineModel(rows, { ...config, timelineStartDateField: startField }, {
      uncategorizedLabel: t("timeline.uncategorized"),
      visibleUnitCount,
      visibleUnitSpan,
    });
    this.currentVisibleRange = this.getModelVisibleRange(model);
    if ((model.eventCount === 0 && model.lanes.length === 0) || !model.startDateKey || !model.endDateKey) {
      this.renderEmpty(container, "timeline.noEvents");
      return;
    }

    const wrap = container.createDiv({ cls: `db-timeline is-scale-${model.scale} is-slot-${this.getTimelineSlotDuration(config)}` });
    this.timelineRoot = wrap;
    this.timelineObservedUnitCount = visibleUnitCount;
    this.timelineObservedUnitSpan = visibleUnitSpan;
    this.observeTimelineViewport(container, config, rows);
    wrap.style.setProperty("--db-timeline-units", String(Math.max(1, model.totalUnits)));
    wrap.style.setProperty("--db-timeline-unit-width", `${unitWidth}px`);
    this.timelineFlashWindow = {
      startDateKey: model.startDateKey,
      totalUnits: model.totalUnits,
      scale: model.scale,
      startMinutes: model.startMinutes,
    };

    this.renderTimelineHeader(wrap, config, model);
    if (model.visibleEventCount === 0 && model.lanes.length === 0) {
      this.renderTimelineEmptyRange(wrap);
      return;
    }

    const scroll = wrap.createDiv({ cls: "db-timeline-scroll" });
    const axis = scroll.createDiv({ cls: "db-timeline-axis" });
    const allTicks = buildTimelineTicks(
      { startDateKey: model.startDateKey, endDateKey: model.endDateKey, totalUnits: model.totalUnits, unit: model.unit, startMinutes: model.startMinutes },
      model.scale,
      config,
      getEffectiveLocale(),
    );
    const axisBands = buildTimelineAxisBands({
      scale: model.scale,
      startDateKey: model.startDateKey,
      endDateKey: model.endDateKey,
      startMinutes: model.startMinutes,
      totalUnits: model.totalUnits,
      locale: getEffectiveLocale(),
    });
    const band = axis.createDiv({ cls: "db-timeline-ticks-band" });
    if (axisBands.length === 0) band.setAttribute("aria-hidden", "true");
    for (const group of axisBands) {
      const bandItem = band.createDiv({ cls: "db-timeline-band-item", text: group.label });
      bandItem.style.setProperty("--db-timeline-band-start", String(group.offset + 1));
      bandItem.style.setProperty("--db-timeline-band-span", String(group.span));
    }
    const now = new Date();
    const ticksEl = axis.createDiv({ cls: "db-timeline-ticks" });
    for (const tick of allTicks) {
      const tickClasses = [
        "db-timeline-tick",
        this.isCurrentTimelineTick(tick, model, now) ? "is-current-time-tick" : "",
        this.isCurrentTimelineDateTick(tick, model, now) ? "is-current-date-tick" : "",
      ].filter(Boolean).join(" ");
      const tickEl = ticksEl.createDiv({
        cls: tickClasses,
        attr: { title: tick.dateKey, "data-date-key": tick.dateKey },
      });
      tickEl.style.setProperty("--db-timeline-tick-offset", String(tick.offsetUnits + 1));
      this.renderTimelineTickLabel(tickEl, tick.label, model.scale);
    }

    const body = scroll.createDiv({ cls: "db-timeline-body" });
    const todayPosition = getTimelineTodayPositionStyle(now, model, unitWidth);
    // 无分组时不渲染 group header（与表格等视图一致），events 直接占满宽度；
    // collapsed 强制 false（无折叠按钮，也不应折叠唯一泳道）。
    const hasGroupField = Boolean(config.timelineGroupField);
    for (const lane of model.lanes) {
      const groupEl = body.createDiv({ cls: "db-timeline-group" });
      // group 自身也带 lane key，使拖拽能解析折叠分组（折叠时无 .db-timeline-events 子元素）。
      groupEl.setAttribute("data-timeline-lane-key", lane.key);
      const collapsed = hasGroupField ? this.renderTimelineGroupHeader(groupEl, config, lane) : false;
      if (collapsed) {
        groupEl.addClass("is-collapsed");
        continue;
      }
      const events = groupEl.createDiv({ cls: "db-timeline-events" });
      events.setAttribute("data-timeline-lane-key", lane.key);
      // day scale：可见小时范围（绝对分钟，可跨午夜）；week/month/quarter：整个多天窗口（0 → totalUnits 天）。
      const visible = model.scale === "day"
        ? this.getTimelineVisibleMinutes(config, { ...model, totalUnits: Math.max(1, visibleUnitSpan ?? model.totalUnits) })
        : { startMinutes: 0, endMinutes: Math.max(1, visibleUnitSpan ?? model.totalUnits) * MINUTES_PER_DAY };
      const limitCount = hasGroupField && config.timelineGroupField
        ? getGroupVisibleCount(config, config.timelineGroupField, lane.key, lane.events.length)
        : lane.events.length;
      const renderedEvents = limitCount < lane.events.length ? lane.events.slice(0, limitCount) : lane.events;
      // 限流时 lane 高度只算可见事件的最高行，缩短 lane、让后续分组顶上（不留垂直空隙）。
      const laneRowCount = limitCount < lane.events.length
        ? renderedEvents.reduce((max, e) => Math.max(max, e.timelineRow || 1), 1)
        : lane.rowCount;
      events.style.setProperty("--db-timeline-event-rows", String(laneRowCount));
      for (const event of renderedEvents) {
        // 统一按绝对刻度（相对 windowStartKey 的分钟）定位事件两端，再用可见窗口夹取。
        // scale.start < visibleStart → 左侧 jump-to-start；scale.end > visibleEnd → 右侧 jump-to-end。
        // 满宽（覆盖整个可见窗口）是 scale 覆盖 visible 的自然结果，无需特判。
        const scale = resolveEventAbsoluteScale(event, model.startDateKey || event.startDateKey);
        const renderStart = Math.max(scale.start, visible.startMinutes);
        const renderEnd = Math.min(scale.end, visible.endMinutes);
        const isClippedStart = scale.start < visible.startMinutes;
        const isClippedEnd = scale.end > visible.endMinutes;
        const isOverEvent = renderStart < renderEnd;
        if (isOverEvent) {
          this.renderTimelineEvent(events, config, event, lane.key, model, { renderStart, renderEnd, visible, isClippedStart, isClippedEnd }, lane.events, model.lanes, event.timelineRow || 1);
        }
        if (isClippedStart) {
          this.renderTimelineJumpIndicator(events, config, event, "before", "start", model, event.timelineRow || 1, isOverEvent);
        }
        if (isClippedEnd) {
          this.renderTimelineJumpIndicator(events, config, event, "after", "end", model, event.timelineRow || 1, isOverEvent);
        }
      }
      if (hasGroupField && config.timelineGroupField) {
        renderGroupExpandControls(groupEl, config, config.timelineGroupField, lane.key, lane.events.length, this.actions);
      }
      this.renderTimelineCreateRow(groupEl, config, model, lane.key);
    }
    if (todayPosition) {
      for (const [property, value] of Object.entries(todayPosition.cssProps)) {
        body.style.setProperty(property, value);
      }
      body.createDiv({ cls: "db-timeline-today-line", attr: { title: this.getTodayDateKey() } });
    }
    if (this.pendingFlashDateKey) {
      const key = this.pendingFlashDateKey;
      this.pendingFlashDateKey = null;
      this.flashRafHandle = window.requestAnimationFrame(() => {
        this.flashRafHandle = null;
        this.flashTimelineDate(key);
      });
    }
  }

  private renderTimelineTickLabel(tickEl: HTMLElement, label: string, scale: TimelineScale): void {
    const labelEl = tickEl.createSpan({ cls: "db-timeline-tick-label" });
    if (scale === "week") {
      const separator = label.lastIndexOf(" ");
      if (separator > 0 && separator < label.length - 1) {
        labelEl.createSpan({ cls: "db-timeline-tick-weekday", text: label.slice(0, separator) });
        labelEl.createSpan({ cls: "db-timeline-tick-date", text: label.slice(separator + 1) });
        return;
      }
    }
    labelEl.createSpan({ cls: "db-timeline-tick-date", text: label });
  }

  /** Render a single timeline event bar with unified absolute-scale positioning. */
  private renderTimelineEvent(
    eventsEl: HTMLElement,
    config: ViewConfig,
    event: CalendarTimelineEvent,
    groupKey: string,
    model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; unit: TimelineUnit; scale: TimelineScale },
    range: { renderStart: number; renderEnd: number; visible: { startMinutes: number; endMinutes: number }; isClippedStart: boolean; isClippedEnd: boolean },
    laneEvents: CalendarTimelineEvent[],
    lanes: Array<{ key: string; label: string; color?: string; events: CalendarTimelineEvent[] }>,
    rowIndex: number,
  ): void {
    const dateText = this.formatTimelineEventMeta(event, model.scale, config);
    // date 列事件保留 muted 全天条视觉（仅样式，定位统一走 exact）。
    const isDateColumn = this.isTimelineDateColumn(config, event);
    const button = eventsEl.createEl("button", {
      cls: `db-timeline-event${isDateColumn ? " is-all-day" : ""}${range.isClippedStart ? " is-clipped-start" : ""}${range.isClippedEnd ? " is-clipped-end" : ""}`,
      attr: { type: "button", title: `${event.title} · ${dateText} · ${event.filePath}`, "data-note-database-row-path": event.row.file.path },
    });
    button.style.setProperty("--db-timeline-row", String(rowIndex));
    // 统一绝对刻度定位（可见窗口夹取后的 [renderStart, renderEnd]）；所有事件同一路径，不再 is-timed 双轨。
    this.applyTimelineAbsolutePosition(button, range.renderStart, range.renderEnd, range.visible.startMinutes, model.unit);
    this.applyCalendarEventColor(button, event.color);
    const content = button.createSpan({ cls: "db-timeline-event-content" });
    this.actions.renderRecordIcon?.(content, event.row, config, true);
    content.createSpan({ cls: `db-timeline-event-title${event.titleIsEmpty ? " is-empty-title" : ""}`, text: event.title });
    content.createSpan({ cls: "db-timeline-event-meta", text: dateText });
    button.onclick = (mouseEvent: MouseEvent) => {
      if ((mouseEvent.target as HTMLElement | null)?.closest(".db-timeline-resize-handle")) return;
      if (this.actions.openRecordDetail) {
        this.actions.openRecordDetail(button, event.row);
      } else {
        this.actions.openRow(event.row);
      }
    };
    button.oncontextmenu = (mouseEvent) => this.actions.showRowMenu?.(mouseEvent, event.row);
    // 拖拽入口按列类型分流（全 scale 通用）：datetime 列在日视图走 timed move（改时间），
    // date 列（任意 scale）走 date move（按天整体平移）。date 列不再进 timed 路径，避免无 time
    // 事件被当作 1h 区间或夹到 visibleStart 改写起始日。
    const useTimedMove = model.scale === "day" && !isDateColumn;
    if (useTimedMove) {
      this.setupTimelineTimedEventPointerDrag(button, eventsEl, config, event, groupKey, model, laneEvents, lanes);
    } else {
      this.setupTimelineEventDateDrag(button, eventsEl, config, event, groupKey, model, laneEvents, lanes);
    }
    if (!this.actions.isReadOnly && this.actions.updateEventDates && (config.timelineEndDateField || config.calendarEndDateField)) {
      if (!range.isClippedStart) this.renderTimelineResizeHandle(button, eventsEl, config, event, model, "start", groupKey);
      if (!range.isClippedEnd) this.renderTimelineResizeHandle(button, eventsEl, config, event, model, "end", groupKey);
    }
    if (this.isPhoneLayout() && !this.actions.isReadOnly) {
      this.renderTimelineMobileMenuButton(button, config, event, groupKey, laneEvents, lanes);
    }
  }

  /**
   * 统一绝对刻度定位：按事件在可见窗口夹取后的 [renderStart, renderEnd] 区间设置 exact-offset/width。
   * day scale 单位=小时（/MINUTES_PER_HOUR）；week/month/quarter 单位=天（/MINUTES_PER_DAY）。
   * 刻度统一是绝对分钟，按 unit 换算成与 CSS --db-timeline-unit-width 对应的列单位。
   */
  private applyTimelineAbsolutePosition(button: HTMLElement, renderStart: number, renderEnd: number, visibleStart: number, unit: TimelineUnit): void {
    const minutesPerUnit = unit === "hour" ? MINUTES_PER_HOUR : MINUTES_PER_DAY;
    const minUnits = unit === "hour" ? 0.25 : 1;
    const offsetUnits = Math.max(0, (renderStart - visibleStart) / minutesPerUnit);
    const widthUnits = Math.max(minUnits, (renderEnd - renderStart) / minutesPerUnit);
    button.setCssProps({
      "--db-timeline-exact-offset": `calc(var(--db-timeline-unit-width) * ${offsetUnits})`,
      "--db-timeline-exact-width": `calc(var(--db-timeline-unit-width) * ${widthUnits})`,
    });
  }

  private renderTimelineJumpIndicator(
    eventsEl: HTMLElement,
    config: ViewConfig,
    event: CalendarTimelineEvent,
    direction: "before" | "after",
    target: "start" | "end",
    model: { startDateKey?: string; totalUnits: number; scale: TimelineScale },
    rowIndex: number,
    isOverEvent = false,
  ): void {
    const dateKey = target === "end" ? event.endDateKey : event.startDateKey;
    const button = eventsEl.createEl("button", {
      cls: `db-timeline-window-jump is-${direction}${isOverEvent ? " is-over-event" : ""}`,
      attr: {
        type: "button",
        "data-note-database-row-path": event.row.file.path,
      },
    });
    button.style.setProperty("--db-timeline-row", String(rowIndex));
    setIcon(button, direction === "before" ? "arrow-left" : "arrow-right");
    setTooltip(button, t("timeline.jumpToEvent", { title: event.title, date: dateKey }), { delay: 100 });
    button.onclick = (mouseEvent) => {
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      this.jumpTimelineToEvent(config, event, model, target);
    };
  }

  private jumpTimelineToEvent(
    config: ViewConfig,
    event: CalendarTimelineEvent,
    model: { startDateKey?: string; totalUnits: number; scale: TimelineScale },
    target: "start" | "end" = "start",
  ): void {
    const anchor = resolveTimelineJumpAnchor({
      event,
      target,
      scale: model.scale || config.timelineScale || "week",
      totalUnits: model.totalUnits,
    });
    this.updateTimelineAnchor(anchor.dateKey, anchor.timeMinutes);
  }

  private renderTimelineGroupHeader(parent: HTMLElement, config: ViewConfig, lane: { key: string; label: string; color?: string; events: CalendarTimelineEvent[] }): boolean {
    const collapseField = this.getTimelineCollapseField(config);
    const collapsed = this.isTimelineGroupCollapsed(config, collapseField, lane.key);
    const header = parent.createDiv({ cls: "db-timeline-group-header" });
    const headerLabel = header.createDiv({ cls: "db-timeline-group-header-label" });
    const toggle = headerLabel.createEl("button", {
      cls: `db-timeline-group-toggle${collapsed ? " is-collapsed" : ""}`,
      attr: { type: "button", "aria-label": collapsed ? t("group.expand") : t("group.collapse") },
    });
    toggle.createSpan({ cls: "db-collapse-triangle" });
    toggle.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.toggleGroupCollapsed?.(collapseField, lane.key);
    };
    this.renderTimelineGroupTag(headerLabel, lane);
    header.createDiv({ cls: "db-timeline-group-header-grid" });
    return collapsed;
  }

  private getTimelineCollapseField(config: ViewConfig): string {
    return config.timelineGroupField || "__timeline__";
  }

  /** 判定事件起始字段是否为 date 列（无 time）。取代已删除的 isAllDay：date 列事件
   *  按「全天条」语义渲染，datetime 列按 timed 语义渲染。Task 3 会在此基础上重写渲染。 */
  private isTimelineDateColumn(config: ViewConfig, event: CalendarTimelineEvent): boolean {
    const startField = config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config);
    const col = config.schema.columns.find((c) => c.key === startField);
    return col?.type === "date";
  }

  private isTimelineGroupCollapsed(config: ViewConfig, field: string, key: string): boolean {
    return this.actions.isGroupCollapsed?.(field, key) ?? (config.collapsedGroups?.[field] || []).includes(key);
  }

  private renderTimelineGroupTag(parent: HTMLElement, lane: { label: string; color?: string; events: CalendarTimelineEvent[] }): void {
    const tag = parent.createSpan({ cls: "db-timeline-group-tag" });
    if (lane.color) {
      tag.addClass(`status-color-${lane.color}`);
      tag.style.setProperty("--db-timeline-group-tag-bg", `var(--status-color-bg-${lane.color})`);
      tag.style.setProperty("--db-timeline-group-tag-fg", `var(--status-color-fg-${lane.color})`);
    }
    tag.createSpan({ cls: "db-timeline-group-title", text: lane.label });
    tag.createSpan({ cls: "db-timeline-group-count", text: String(lane.events.length) });
  }

  private renderTimelineCreateRow(
    parent: HTMLElement,
    config: ViewConfig,
    model: { startDateKey?: string; endDateKey?: string; totalUnits: number; scale: TimelineScale },
    groupKey: string,
  ): void {
    if (this.actions.isReadOnly || !this.actions.createEntryForDate || !model.startDateKey) return;
    const row = parent.createDiv({ cls: "db-timeline-create-row" });
    const button = row.createEl("button", {
      cls: "db-timeline-create-button",
      attr: { type: "button" },
    });
    button.setCssProps({
      "--db-timeline-create-offset": "1",
      "--db-timeline-create-span": String(this.getTimelineCreateSpanUnits(model)),
      "--db-timeline-create-left": "0px",
      "--db-timeline-create-width": `calc(var(--db-timeline-unit-width) * ${this.formatTimelineUnitValue(this.getTimelineCreateSpanUnits(model))})`,
    });
    const content = button.createSpan({ cls: "db-timeline-create-content" });
    setIcon(content.createSpan({ cls: "db-timeline-create-icon" }), "plus");
    content.createSpan({ cls: "db-timeline-create-label", text: t("toolbar.new") });
    this.setupTimelineCreateRow(button, config, model, groupKey);
  }

  private setupTimelineCreateRow(
    button: HTMLElement,
    config: ViewConfig,
    model: { startDateKey?: string; endDateKey?: string; totalUnits: number; scale: TimelineScale },
    groupKey: string,
  ): void {
    button.onmouseenter = (mouseEvent) => this.updateTimelineCreatePreview(button, config, model, mouseEvent.clientX);
    button.onmousemove = (mouseEvent) => this.updateTimelineCreatePreview(button, config, model, mouseEvent.clientX);
    button.onmouseleave = () => this.clearTimelineCreatePreview(button);
    button.onfocus = () => {
      button.setCssProps({
        "--db-timeline-create-offset": "1",
        "--db-timeline-create-span": String(this.getTimelineCreateSpanUnits(model)),
        "--db-timeline-create-left": "0px",
        "--db-timeline-create-width": `calc(var(--db-timeline-unit-width) * ${this.formatTimelineUnitValue(this.getTimelineCreateSpanUnits(model))})`,
      });
    };
    button.onblur = () => this.clearTimelineCreatePreview(button);
    button.onclick = (mouseEvent) => {
      if (!model.startDateKey) return;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      const target = this.getTimelineCreateTargetFromPoint(button, mouseEvent.clientX, config, model);
      this.applyTimelineCreatePreview(button, target);
      const options: CalendarTimelineCreateOptions = { ...target.options };
      if (config.timelineGroupField && groupKey !== UNCATEGORIZED_TIMELINE_LANE) {
        options.groupField = config.timelineGroupField;
        options.groupKey = groupKey;
      }
      this.actions.createEntryForDate?.(config, target.dateKey, options);
    };
  }

  private updateTimelineCreatePreview(
    button: HTMLElement,
    config: ViewConfig,
    model: { startDateKey?: string; endDateKey?: string; totalUnits: number; scale: TimelineScale },
    clientX: number,
  ): void {
    this.applyTimelineCreatePreview(button, this.getTimelineCreateTargetFromPoint(button, clientX, config, model));
  }

  private applyTimelineCreatePreview(button: HTMLElement, target: TimelineCreateTarget): void {
    button.setCssProps({
      "--db-timeline-create-offset": this.formatTimelineUnitValue(target.offsetUnits + 1),
      "--db-timeline-create-span": this.formatTimelineUnitValue(target.spanUnits),
      "--db-timeline-create-left": `calc(var(--db-timeline-unit-width) * ${this.formatTimelineUnitValue(target.offsetUnits)})`,
      "--db-timeline-create-width": `calc(var(--db-timeline-unit-width) * ${this.formatTimelineUnitValue(target.spanUnits)})`,
    });
    button.addClass("is-previewing");
  }

  private clearTimelineCreatePreview(button: HTMLElement): void {
    button.removeClass("is-previewing");
  }

  /** Navigation header: window title + prev/today/next buttons. Mirrors the calendar header. */
  private renderTimelineHeader(wrap: HTMLElement, config: ViewConfig, model: { startDateKey?: string; endDateKey?: string; totalUnits: number; scale: TimelineScale }): void {
    const header = wrap.createDiv({ cls: "db-timeline-header" });
    const fallbackTitleWindow = getTimelineTitleWindow(config, getTimelineAnchor(config));
    const titleWindow = model.startDateKey && model.endDateKey
      ? { startDateKey: model.startDateKey, endDateKey: model.endDateKey }
      : fallbackTitleWindow;
    this.renderTimelineTitle(header, formatCalendarTitleParts({
      scale: model.scale,
      startDateKey: titleWindow.startDateKey,
      endDateKey: titleWindow.endDateKey,
      locale: getEffectiveLocale(),
    }));
    const controls = header.createDiv({ cls: "db-timeline-controls" });
    const scale = model.scale;
    this.renderTimelineScaleControl(controls, config, scale);
    this.renderTimelineNavButton(controls, "timeline.prevLong", () => this.shiftTimeline(config, scale, -1, model, "long"), "chevrons-left");
    this.renderTimelineNavButton(controls, "timeline.prevShort", () => this.shiftTimeline(config, scale, -1, model, "short"), "chevron-left");
    this.renderTimelineNavButton(controls, "timeline.today", () => this.goToTimelineToday(config, model));
    this.renderTimelineNavButton(controls, "timeline.nextShort", () => this.shiftTimeline(config, scale, 1, model, "short"), "chevron-right");
    this.renderTimelineNavButton(controls, "timeline.nextLong", () => this.shiftTimeline(config, scale, 1, model, "long"), "chevrons-right");
    this.renderTimelineMiniCalendarButton(controls, header, config);
    this.renderTimelineInvalidWarning(controls, config);
  }

  private getModelVisibleRange(model: { startDateKey?: string; endDateKey?: string; unit: TimelineUnit; totalUnits: number; startMinutes?: number }): CalendarTimelineSearchVisibleRange | null {
    if (!model.startDateKey || !model.endDateKey) return null;
    if (model.unit === "hour") {
      return timelineHourRange(model.startDateKey, model.startMinutes ?? 0, model.totalUnits);
    }
    return { startDateKey: model.startDateKey, endDateKey: model.endDateKey };
  }

  private renderTimelineScaleControl(parent: HTMLElement, config: ViewConfig, currentScale: TimelineScale): void {
    const options: Array<{ value: TimelineScale; text: string }> = [
      { value: "day", text: t("timeline.scaleDay") },
      { value: "week", text: t("timeline.scaleWeek") },
      { value: "month", text: t("timeline.scaleMonth") },
      { value: "quarter", text: t("timeline.scaleQuarter") },
    ];
    const activeScale = config.timelineScale || currentScale;
    const control = parent.createDiv({
      cls: "db-timeline-scale-control",
      attr: { role: "group" },
    });
    const segment = control.createDiv({ cls: "db-timeline-scale-segment" });
    for (const option of options) {
      const active = option.value === activeScale;
      const button = segment.createEl("button", {
        cls: `db-timeline-scale-button${active ? " is-active" : ""}`,
        text: option.text,
        attr: { type: "button", "aria-pressed": active ? "true" : "false" },
      });
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.setTimelineScale(config, option.value);
      };
    }
    const activeText = options.find((option) => option.value === activeScale)?.text || t("timeline.scaleWeek");
    const menuButton = control.createEl("button", {
      cls: "db-timeline-scale-menu db-timeline-nav-button is-text",
      attr: {
        type: "button",
        "aria-haspopup": "listbox",
      },
    });
    menuButton.createSpan({ cls: "db-timeline-scale-menu-label", text: activeText });
    setIcon(menuButton.createSpan({ cls: "db-timeline-nav-icon db-timeline-scale-menu-chevron" }), "chevron-down");
    menuButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeTimelineScaleMenu();
      this.timelineScaleMenuCleanup = openDropdownMenu({
        anchor: menuButton,
        label: t("viewConfig.timelineScale"),
        options,
        value: activeScale,
        popoverClassName: "db-timeline-scale-popover",
        onChange: (value) => {
          void this.setTimelineScale(config, this.normalizeTimelineScale(value));
          this.closeTimelineScaleMenu();
        },
      });
    };
  }

  private async setTimelineScale(config: ViewConfig, scale: TimelineScale): Promise<void> {
    this.closeTimelineScaleMenu();
    if ((config.timelineScale || "week") === scale) return;
    if (this.actions.updateTimelineScale) {
      await this.actions.updateTimelineScale(scale, t("undo.timelineScaleConfig"));
      return;
    }
    config.timelineScale = scale;
    this.actions.onConfigChange?.(t("undo.timelineScaleConfig"));
  }

  private closeTimelineScaleMenu(): void {
    this.timelineScaleMenuCleanup?.();
    this.timelineScaleMenuCleanup = null;
  }

  private normalizeTimelineScale(value: string): TimelineScale {
    return value === "day" || value === "month" || value === "quarter" ? value : "week";
  }

  private renderTimelineNavButton(parent: HTMLElement, labelKey: string, onClick: () => void, icon?: string): void {
    const button = parent.createEl("button", {
      cls: `db-timeline-nav-button${icon ? " is-icon" : " is-text"}`,
      attr: { type: "button" },
    });
    if (icon) {
      setIcon(button.createSpan({ cls: "db-timeline-nav-icon" }), icon);
    } else {
      button.setText(t(labelKey));
    }
    setTooltip(button, t(labelKey), { delay: 100 });
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    };
  }

  private renderTimelineMiniCalendarButton(controls: HTMLElement, header: HTMLElement, config: ViewConfig): void {
    const button = controls.createEl("button", {
      cls: "db-timeline-nav-button is-icon",
      attr: { type: "button" },
    });
    setIcon(button.createSpan({ cls: "db-timeline-nav-icon" }), "calendar-days");
    setTooltip(button, t("calendar.datePicker"), { delay: 100 });
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleTimelineMiniCalendar(header, config);
    };
  }

  /** 导航栏 invalid 事件图标按钮：异步统计后，仅在 count > 0 时显示 ⚠️，点击打开修复弹窗。 */
  private renderTimelineInvalidWarning(parent: HTMLElement, _config: ViewConfig): void {
    if (!this.actions.getTimelineInvalidEventCount || !this.actions.openTimelineInvalidEvents) return;
    const result = this.actions.getTimelineInvalidEventCount();
    // cache miss（Promise）时沿用上一次的计数做即时显示，避免数据刷新时 hide→show 闪现；
    // resolve 后 applyCount 会修正为真实值（count<=0 则移除按钮）。
    const initialCount = typeof result === "number" ? result : this.timelineInvalidWarningCount;
    if (typeof result === "number") this.timelineInvalidWarningCount = result;
    if (typeof result === "number" && result <= 0) return;
    const button = parent.createEl("button", {
      cls: `db-timeline-nav-button is-icon db-timeline-invalid-toggle${initialCount && initialCount > 0 ? "" : " is-hidden"}`,
      attr: { type: "button" },
    });
    setIcon(button.createSpan({ cls: "db-timeline-nav-icon" }), "alert-triangle");
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.openTimelineInvalidEvents?.();
    };
    const applyCount = (count: number): void => {
      this.timelineInvalidWarningCount = count;
      if (!button.isConnected) return;
      if (count <= 0) {
        button.remove();
        return;
      }
      button.removeClass("is-hidden");
      const label = t("timeline.invalidEventsConflictNotice", { count });
      button.setAttr("title", label);
      button.setAttr("aria-label", label);
    };
    if (initialCount && initialCount > 0) applyCount(initialCount);
    if (typeof result === "number") return;
    void result
      .then((count) => applyCount(count))
      .catch(() => {
        if (button.isConnected) button.remove();
      });
  }

  private toggleTimelineMiniCalendar(header: HTMLElement, config: ViewConfig): void {
    if (this.miniCalendarEl?.isConnected) {
      this.closeTimelineMiniCalendar();
      return;
    }
    this.closeTimelineMiniCalendar();
    const popover = header.createDiv({ cls: "db-calendar-mini-popover db-timeline-mini-popover" });
    this.miniCalendarEl = popover;
    this.miniCalendarMonth = this.resolveTimelineMiniMonthKey(config);
    this.miniCalendarMode = "day";
    this.renderTimelineMiniMonth(popover, config);

    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && popover.contains(target)) return;
      this.closeTimelineMiniCalendar();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.closeTimelineMiniCalendar();
    };
    window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    window.activeDocument.addEventListener("keydown", onKey, true);
    this.miniCalendarCleanup = () => {
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      window.activeDocument.removeEventListener("keydown", onKey, true);
      popover.remove();
      this.miniCalendarEl = null;
      this.miniCalendarMonth = null;
      this.miniCalendarMode = "day";
      this.miniCalendarCleanup = null;
    };
  }

  private closeTimelineMiniCalendar(): void {
    this.miniCalendarCleanup?.();
    this.miniCalendarCleanup = null;
  }

  private renderTimelineMiniMonth(popover: HTMLElement, config: ViewConfig): void {
    const monthKey = this.miniCalendarMonth ?? this.resolveTimelineMiniMonthKey(config);
    const [ys, ms] = monthKey.split("-");
    const year = Number(ys);
    const monthIndex = Number(ms) - 1;

    const weekStartsOn = this.getLocaleWeekStartsOn(config);
    const startField = config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config) || "";
    const model = buildCalendarMonthModel(
      this.currentRows,
      {
        ...config,
        calendarStartDateField: startField,
        calendarEndDateField: config.timelineEndDateField || config.calendarEndDateField,
        calendarTitleField: config.timelineTitleField,
        calendarColorField: config.timelineColorField || config.calendarColorField,
      },
      { year, monthIndex },
      { weekStartsOn },
    );
    const todayKey = this.getTodayDateKey();
    const selectedKeys = this.resolveTimelineMiniSelectedKeys(config);
    const eventIndex = buildMiniCalendarEventIndex({
      rows: this.currentRows,
      config,
      startField,
      endField: config.timelineEndDateField || config.calendarEndDateField,
    });
    renderMiniCalendar({
      popover,
      mode: this.miniCalendarMode,
      monthKey,
      monthTitle: this.formatMonthTitle(year, monthIndex),
      visibleYear: year,
      yearRangeStart: this.getMiniCalendarYearRangeStart(year),
      weeks: model.weeks,
      weekdays: this.getWeekdayLabels(weekStartsOn),
      todayKey,
      selectedKeys,
      eventIndex,
      onPrevious: () => this.shiftTimelineMiniCalendarWindow(popover, config, -1),
      onNext: () => this.shiftTimelineMiniCalendarWindow(popover, config, 1),
      onTitleClick: () => this.drillTimelineMiniCalendarUp(popover, config),
      onSelectMonth: (selectedMonthKey) => {
        this.miniCalendarMonth = selectedMonthKey;
        this.miniCalendarMode = "day";
        this.renderTimelineMiniMonth(popover, config);
      },
      onSelectYear: (selectedYear) => {
        this.miniCalendarMonth = `${String(selectedYear).padStart(4, "0")}-01`;
        this.miniCalendarMode = "month";
        this.renderTimelineMiniMonth(popover, config);
      },
      onSelectDate: (dateKey) => this.navigateTimelineViaMini(config, dateKey),
      onSelectToday: (dateKey) => this.jumpTimelineMiniCalendarToToday(popover, config, dateKey),
    });
  }

  private shiftTimelineMiniCalendarWindow(popover: HTMLElement, config: ViewConfig, direction: 1 | -1): void {
    const monthKey = this.miniCalendarMonth ?? this.resolveTimelineMiniMonthKey(config);
    const delta = this.miniCalendarMode === "day" ? direction : this.miniCalendarMode === "month" ? direction * 12 : direction * 144;
    this.miniCalendarMonth = shiftCalendarMonth(monthKey, delta);
    this.renderTimelineMiniMonth(popover, config);
  }

  private drillTimelineMiniCalendarUp(popover: HTMLElement, config: ViewConfig): void {
    if (this.miniCalendarMode === "day") {
      this.miniCalendarMode = "month";
    } else if (this.miniCalendarMode === "month") {
      this.miniCalendarMode = "year";
    }
    this.renderTimelineMiniMonth(popover, config);
  }

  private jumpTimelineMiniCalendarToToday(popover: HTMLElement, config: ViewConfig, dateKey: string): void {
    this.miniCalendarMonth = dateKey.slice(0, 7);
    this.miniCalendarMode = "day";
    this.renderTimelineMiniMonth(popover, config);
  }

  private navigateTimelineViaMini(config: ViewConfig, dateKey: string): void {
    this.requestTimelineDateFlash(dateKey);
    this.updateTimelineAnchor(dateKey, (config.timelineScale || "week") === "day" ? this.getDefaultTimelineStartMinutes(config) : undefined);
    this.closeTimelineMiniCalendar();
  }

  private requestTimelineDateFlash(dateKey: string): void {
    this.pendingFlashDateKey = dateKey;
  }

  private flashTimelineDate(dateKey: string): void {
    const root = this.timelineRoot ?? window.activeDocument;
    // 跳转闪光只在主体泳道叠一列半透明主题色背景条作为落点指示；表头日期数字
    // 不再染色高亮（用户反馈数字染色不美观）。today 实心圆本身常驻 accent 色，
    // 已足够醒目，无需额外 flash。
    const range = this.getTimelineFlashRange(dateKey);
    const overlays: HTMLElement[] = [];
    if (range) {
      const body = root.querySelector<HTMLElement>(".db-timeline-body");
      if (body) {
        const overlay = body.createDiv({
          cls: "db-timeline-body-flash-column is-flash",
          attr: { "data-date-key": dateKey },
        });
        overlay.style.setProperty("--db-timeline-flash-offset", String(range.offsetUnits));
        overlay.style.setProperty("--db-timeline-flash-span", String(range.spanUnits));
        overlays.push(overlay);
      }
    }
    this.flashTimeoutHandle = window.setTimeout(() => {
      this.flashTimeoutHandle = null;
      overlays.forEach((overlay) => overlay.remove());
    }, 1300);
  }

  private getTimelineFlashRange(dateKey: string): { offsetUnits: number; spanUnits: number } | null {
    const windowModel = this.timelineFlashWindow;
    if (!windowModel) return null;
    const dayOffset = dateKeyDaysBetween(windowModel.startDateKey, dateKey);
    if (dayOffset == null) return null;
    if (windowModel.scale === "day") {
      const visibleStart = windowModel.startMinutes ?? 0;
      const visibleEnd = visibleStart + Math.max(1, windowModel.totalUnits) * MINUTES_PER_HOUR;
      const targetStart = dayOffset * MINUTES_PER_DAY;
      const targetEnd = targetStart + MINUTES_PER_DAY;
      const start = Math.max(visibleStart, targetStart);
      const end = Math.min(visibleEnd, targetEnd);
      if (end <= start) return null;
      return {
        offsetUnits: (start - visibleStart) / MINUTES_PER_HOUR,
        spanUnits: Math.max(TIME_SNAP_MINUTES / MINUTES_PER_HOUR, (end - start) / MINUTES_PER_HOUR),
      };
    }
    if (dayOffset < 0 || dayOffset >= windowModel.totalUnits) return null;
    return { offsetUnits: dayOffset, spanUnits: 1 };
  }

  private resolveTimelineMiniMonthKey(config: ViewConfig): string {
    return getTimelineAnchor(config).slice(0, 7);
  }

  private resolveTimelineMiniSelectedKeys(config: ViewConfig): Set<string> {
    return new Set([getTimelineAnchor(config)]);
  }

  private shiftTimeline(config: ViewConfig, scale: TimelineScale, delta: number, model?: { totalUnits: number }, distance: "short" | "long" = "long"): void {
    const anchor = getTimelineAnchor(config);
    const shiftUnits = distance === "short"
      ? getTimelineShortNavigationShiftUnits(scale)
      : getTimelineNavigationShiftUnits(model?.totalUnits || 1);
    if (scale === "day") {
      const shifted = this.shiftTimelineAnchorTime(anchor, this.getTimelineAnchorTimeMinutes(config), delta * shiftUnits * MINUTES_PER_HOUR);
      this.updateTimelineAnchor(shifted.dateKey, shifted.minutes);
      return;
    }
    this.updateTimelineAnchor(addDateKeyDays(anchor, delta * shiftUnits));
  }

  private goToTimelineToday(config: ViewConfig, model?: { totalUnits: number; scale: TimelineScale }): void {
    const today = this.getTodayDateKey();
    this.requestTimelineDateFlash(today);
    if ((config.timelineScale || model?.scale || "week") === "day") {
      const now = new Date();
      const currentMinutes = now.getHours() * MINUTES_PER_HOUR + now.getMinutes();
      const centeredStart = currentMinutes - Math.floor(Math.max(1, model?.totalUnits || 1) / 2) * MINUTES_PER_HOUR;
      const shifted = this.shiftTimelineAnchorTime(today, 0, centeredStart);
      this.updateTimelineAnchor(shifted.dateKey, shifted.minutes);
      return;
    }
    this.updateTimelineAnchor(today);
  }

  private updateTimelineAnchor(dateKey: string, timeMinutes?: number): void {
    this.actions.updateTimelineAnchor?.(dateKey, t("undo.timelineAnchorConfig"), timeMinutes);
  }

  private getTimelineAnchorTimeMinutes(config: ViewConfig): number {
    const value = config.timelineAnchorTimeMinutes;
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(value)));
    }
    return this.getDefaultTimelineStartMinutes(config);
  }

  private getDefaultTimelineStartMinutes(config: ViewConfig): number {
    return this.getDayStartHour(config) * MINUTES_PER_HOUR;
  }

  private shiftTimelineAnchorTime(dateKey: string, timeMinutes: number, deltaMinutes: number): { dateKey: string; minutes: number } {
    const total = Math.round(timeMinutes + deltaMinutes);
    const dayOffset = Math.floor(total / MINUTES_PER_DAY);
    return {
      dateKey: addDateKeyDays(dateKey, dayOffset),
      minutes: this.minuteOfDay(total),
    };
  }

  private renderTimelineTitle(parent: HTMLElement, parts: CalendarTitleParts): void {
    const title = parent.createDiv({
      cls: "db-timeline-title",
    });
    setTooltip(title, parts.ariaLabel, { delay: 100 });
    title.createSpan({ cls: "db-timeline-title-main", text: parts.main });
    if (parts.year) title.createSpan({ cls: "db-timeline-title-year", text: parts.year });
  }

  private getDayStartHour(config: ViewConfig): number {
    const value = config.calendarStartHour;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(23, Math.round(numeric)));
  }

  private dateKeyDaysBetween(startKey: string, endKey: string): number {
    return dateKeyDaysBetween(startKey, endKey) ?? 0;
  }

  private applyCalendarEventColor(button: HTMLElement, color: string | undefined): void {
    if (!color) return;
    button.style.setProperty("--db-calendar-event-accent", `var(--status-color-fg-${color})`);
    button.style.setProperty("--db-calendar-event-bg", `var(--status-color-bg-${color})`);
  }

  /**
   * Bug 4 方案 B: 在同 lane 内找到离 clientY 最近的（排除自身的）事件，判断插入它之前还是之后。
   * 不限同日期——任意事件都可重排。返回命中目标 path、placeBefore，以及供 reorderTimelineEvent
   * 使用的 before/after path。
   */
  private findTimelineReorderTarget(
    eventsEl: HTMLElement,
    clientY: number,
    draggedPath: string,
    laneEvents: readonly CalendarTimelineEvent[]
  ): { targetPath: string; placeBefore: boolean; beforePath?: string; afterPath?: string } | null {
    const buttons = Array.from(eventsEl.querySelectorAll<HTMLElement>(".db-timeline-event, .db-timeline-window-jump"))
      .filter((btn) => btn.getAttribute("data-note-database-row-path") !== draggedPath);
    if (buttons.length === 0) return null;
    let closest = buttons[0];
    let closestDist = Infinity;
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      const dist = Math.abs(clientY - (rect.top + rect.height / 2));
      if (dist < closestDist) { closestDist = dist; closest = btn; }
    }
    const rect = closest.getBoundingClientRect();
    const placeBefore = clientY < rect.top + rect.height / 2;
    const targetPath = closest.getAttribute("data-note-database-row-path") || "";
    // 用完整 lane 顺序（含 jump 事件）算 before/after——jump 事件不在 visible DOM，
    // 否则 A 会跨越 jump、不紧贴目标（Bug 4）。
    const fullPath = laneEvents.map((event) => event.row.file.path).filter((path) => path !== draggedPath);
    const neighbors = resolveTimelineReorderNeighbors(targetPath, placeBefore, fullPath);
    if (neighbors.beforePath === undefined && neighbors.afterPath === undefined) return null;
    return { targetPath, placeBefore, ...neighbors };
  }

  /** Bug 4: pointer onMove 时刷新重排指示线（is-drop-before / is-drop-after），并返回命中目标供松手复用。 */
  private updateTimelineReorderIndicator(eventsEl: HTMLElement, clientY: number, draggedPath: string, laneEvents: readonly CalendarTimelineEvent[]): { targetPath: string; placeBefore: boolean; beforePath?: string; afterPath?: string } | null {
    // 清除旧的插入线（pointer 模式同一时刻只有一条；清所有 lane 避免同↔跨 lane 切换时残留）。
    this.clearAllTimelineReorderLines();
    const target = this.findTimelineReorderTarget(eventsEl, clientY, draggedPath, laneEvents);
    if (!target) return null;
    const btn = eventsEl.querySelector<HTMLElement>(
      `[data-note-database-row-path="${CSS.escape(target.targetPath)}"]`
    );
    if (btn) {
      // 横跨整行的水平插入线，紧贴目标事件的上边缘（插入其前）或下边缘（插入其后）——
      // 延续旧「卡片边缘 box-shadow」的贴边质感，但跨整行更显眼；无圆点，用细线 + 柔和
      // 发光定位，不阻断。
      const top = target.placeBefore ? btn.offsetTop : btn.offsetTop + btn.offsetHeight;
      const line = eventsEl.createDiv({ cls: "db-timeline-reorder-line" });
      line.style.setProperty("--db-timeline-reorder-line-top", `${top}px`);
    }
    return target;
  }

  /** 清除所有 lane 的 reorder 插入线（pointer 模式同一时刻只有一条）。 */
  private clearAllTimelineReorderLines(): void {
    window.activeDocument.querySelectorAll(".db-timeline-reorder-line").forEach((el) => el.remove());
  }

  /**
   * 垂直拖（同 lane 重排序 / 跨 lane 改分组）统一算插入点：同 lane 用源 laneEvents，
   * 跨 lane 用目标 lane 的 events（从 lanes 按 data-timeline-lane-key 查），指示线画在
   * 目标 eventsEl。未开启手动排序时返回 null（跨 lane 将追加末尾，位置由排序决定）。
   */
  private resolveTimelineReorderTarget(
    sourceEventsEl: HTMLElement,
    targetEventsEl: HTMLElement,
    clientY: number,
    draggedPath: string,
    sourceLaneEvents: readonly CalendarTimelineEvent[],
    lanes: Array<{ key: string; events: readonly CalendarTimelineEvent[] }>,
    config: ViewConfig,
  ): { targetPath: string; placeBefore: boolean; beforePath?: string; afterPath?: string } | null {
    this.clearAllTimelineReorderLines();
    if (!this.canTimelineReorder(config)) return null;
    // 折叠的目标分组没有可见事件，无法精确定位插入点；返回 null 让 moveTimelineEventToGroup 追加末尾。
    if (targetEventsEl.classList.contains("is-collapsed")) return null;
    const isCrossLane = targetEventsEl !== sourceEventsEl;
    const reorderLaneEvents = isCrossLane
      ? (lanes.find((lane) => lane.key === targetEventsEl.dataset.timelineLaneKey)?.events ?? [])
      : sourceLaneEvents;
    if (reorderLaneEvents.length === 0) return null;
    return this.updateTimelineReorderIndicator(targetEventsEl, clientY, draggedPath, reorderLaneEvents);
  }

  private setupTimelineEventDateDrag(
    button: HTMLElement,
    eventsEl: HTMLElement,
    config: ViewConfig,
    event: CalendarTimelineEvent,
    groupKey: string,
    model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; unit?: TimelineUnit; scale?: TimelineScale },
    laneEvents: CalendarTimelineEvent[],
    lanes: Array<{ key: string; events: readonly CalendarTimelineEvent[] }>,
  ): void {
    if (this.actions.isReadOnly || !this.actions.updateEventDates) return;
    button.addClass("is-draggable");
    button.addEventListener("mousedown", (mouseEvent: MouseEvent) => {
      if (mouseEvent.button !== 0) return;
      // resize 进行中或点中 resize 手柄时不触发 move。
      if (this.timelineResizeInProgress) return;
      if ((mouseEvent.target as HTMLElement | null)?.closest(".db-timeline-resize-handle")) return;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      this.beginTimelineDateDrag(button, eventsEl, config, event, groupKey, model, mouseEvent.clientX, mouseEvent.clientY, laneEvents, lanes);
    });
  }

  private setupTimelineTimedEventPointerDrag(
    button: HTMLElement,
    eventsEl: HTMLElement,
    config: ViewConfig,
    event: CalendarTimelineEvent,
    groupKey: string,
    model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; unit: TimelineUnit; scale: TimelineScale },
    laneEvents: CalendarTimelineEvent[],
    lanes: Array<{ key: string; events: readonly CalendarTimelineEvent[] }>,
  ): void {
    if (this.actions.isReadOnly || !this.actions.updateEventDates) return;
    button.addClass("is-draggable");
    button.addEventListener("mousedown", (mouseEvent) => {
      if (mouseEvent.button !== 0) return;
      const mode = ((mouseEvent.target as HTMLElement | null)?.closest(".db-timeline-resize-handle") as HTMLElement | null)
        ?.dataset.timelineResizeMode as "resize-start" | "resize-end" | undefined || "move";
      if (mode !== "move" && !(config.timelineEndDateField || config.calendarEndDateField)) return;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      this.beginTimelineTimeDrag(button, eventsEl, config, event, groupKey, model, mode, mouseEvent.clientX, mouseEvent.clientY, laneEvents, lanes);
    });
  }

  private renderTimelineResizeHandle(
    button: HTMLElement,
    eventsEl: HTMLElement,
    config: ViewConfig,
    event: CalendarTimelineEvent,
    model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; unit: TimelineUnit; scale?: TimelineScale },
    edge: "start" | "end",
    groupKey: string,
  ): void {
    const handle = button.createSpan({
      cls: `db-timeline-resize-handle is-${edge}`,
      attr: {
        title: edge === "start" ? t("calendar.resizeStart") : t("calendar.resizeEnd"),
        "aria-hidden": "true",
        "data-timeline-resize-mode": edge === "start" ? "resize-start" : "resize-end",
      },
    });
    handle.addEventListener("click", (mouseEvent) => {
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
    });
    handle.addEventListener("mousedown", (mouseEvent) => {
      if (mouseEvent.button !== 0) return;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      const mode = edge === "start" ? "resize-start" : "resize-end";
      const isDateColumn = this.isTimelineDateColumn(config, event);
      // 按列类型分流：datetime 列在日视图用 timed resize（改分钟）；date 列用按天 resize（改天数）。
      if ((model.unit === "hour" || model.scale === "day") && !isDateColumn) {
        this.beginTimelineTimeDrag(button, eventsEl, config, event, groupKey, { ...model, scale: "day" }, mode, mouseEvent.clientX, mouseEvent.clientY);
      } else {
        this.beginTimelineResize(button, eventsEl, config, event, model, mode, mouseEvent.clientX);
      }
    });
  }

  private beginTimelineTimeDrag(
    button: HTMLElement,
    eventsEl: HTMLElement,
    config: ViewConfig,
    event: CalendarTimelineEvent,
    groupKey: string,
    model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; unit: TimelineUnit; scale: TimelineScale },
    mode: "move" | "resize-start" | "resize-end",
    startClientX: number,
    startClientY: number,
    laneEvents?: CalendarTimelineEvent[],
    lanes?: Array<{ key: string; events: readonly CalendarTimelineEvent[] }>,
  ): void {
    if (this.actions.isReadOnly || !this.actions.updateEventDates) return;
    const startField = config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config);
    const endField = config.timelineEndDateField || config.calendarEndDateField;
    if (!startField || !(model.startDateKey || event.startDateKey)) return;
    if (mode !== "move" && !endField) return;

    const visible = this.getTimelineVisibleMinutes(config, model);
    // end 上限放宽到当天 +7 天，允许 resize-end 越过 24:00 跨天（如 23:00 → 次日 12:15）。
    const endMax = visible.endMinutes + 7 * MINUTES_PER_DAY;
    const originalRange = resolveEventAbsoluteScale(event, model.startDateKey || event.startDateKey);
    // 用事件真实绝对范围（不夹到 visible）——move 整体平移需基于真实 start，否则窗口外起始的
    // 跨天事件 start 会被夹到 visibleStart，平移后把事件起始日改写成窗口起始日。resize 的边界
    // 夹取由 resolveTimedDragRange 内部 resize 分支自行处理。
    const originalStart = originalRange.start;
    const originalEnd = Math.max(originalStart + TIME_SNAP_MINUTES, originalRange.end);
    let nextStart = originalStart;
    let nextEnd = originalEnd;
    let didDrag = false;
    // 垂直拖同 lane 时的 rank reorder 命中（onMove 设、onUp 用）。
    let lastReorderTarget: { targetPath: string; placeBefore: boolean; beforePath?: string; afterPath?: string } | null = null;
    this.timelineResizeInProgress = mode !== "move";
    button.addClass("is-dragging");
    button.toggleClass("is-moving", mode === "move");
    button.toggleClass("is-resizing", mode !== "move");
    if (mode === "move") eventsEl.addClass("is-drop-target");
    else eventsEl.addClass("is-resize-target");
    let targetEventsEl = eventsEl;

    const unitWidth = this.getTimelineUnitPixelWidth(eventsEl, model.totalUnits);
    const originalExactOffset = button.style.getPropertyValue("--db-timeline-exact-offset");
    const originalExactWidth = button.style.getPropertyValue("--db-timeline-exact-width");
    const wasTimed = button.hasClass("is-timed");
    const metaEl = button.querySelector<HTMLElement>(".db-timeline-event-meta");
    const originalMeta = metaEl?.textContent || "";

    button.addClass("is-timed");
    const restore = (): void => {
      if (originalExactOffset) button.style.setProperty("--db-timeline-exact-offset", originalExactOffset);
      else button.style.removeProperty("--db-timeline-exact-offset");
      if (originalExactWidth) button.style.setProperty("--db-timeline-exact-width", originalExactWidth);
      else button.style.removeProperty("--db-timeline-exact-width");
      if (!wasTimed) button.removeClass("is-timed");
      if (metaEl) metaEl.setText(originalMeta);
    };
    const swallowClick = (clickEvent: MouseEvent): void => {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
    };
    const computeNext = (clientX: number): { start: number; end: number } => {
      const range = resolveTimedDragRange({
        mode,
        originalStart,
        originalEnd,
        visibleStart: visible.startMinutes,
        visibleEnd: visible.endMinutes,
        deltaMinutes: unitWidth > 0 ? ((clientX - startClientX) / unitWidth) * 60 : 0,
        endMaxMinutes: endMax,
      });
      return { start: range.start, end: range.end };
    };
    const preview = (start: number, end: number): void => {
      nextStart = start;
      nextEnd = end;
      // 夹到可见窗口（与旧 applyTimelineTimedPosition 同口径），再走统一 exact 定位（applyTimelineAbsolutePosition）。
      const previewStart = Math.max(visible.startMinutes, Math.min(visible.endMinutes - TIME_SNAP_MINUTES, start));
      const previewEnd = Math.min(visible.endMinutes, Math.max(previewStart + TIME_SNAP_MINUTES, end));
      this.applyTimelineAbsolutePosition(button, previewStart, previewEnd, visible.startMinutes, model.unit);
      const startDateTime = this.getTimelineDateTimeFromAbsolute(model.startDateKey || event.startDateKey, start);
      const endDateTime = this.getTimelineDateTimeFromAbsolute(model.startDateKey || event.startDateKey, end);
      const label = this.formatTimelineDayTimeRange(startDateTime.dateKey, startDateTime.minutes, endDateTime.dateKey, endDateTime.minutes);
      if (metaEl) metaEl.setText(label);
      this.renderTimelineRangeSnap(eventsEl, button, label, previewStart, visible.startMinutes, model.unit, unitWidth);
    };
    const onMove = (moveEvent: MouseEvent): void => {
      if (!didDrag && (Math.abs(moveEvent.clientX - startClientX) > 3 || Math.abs(moveEvent.clientY - startClientY) > 3)) {
        didDrag = true;
        window.activeDocument.addEventListener("click", swallowClick, true);
      }
      const dx = Math.abs(moveEvent.clientX - startClientX);
      const dy = Math.abs(moveEvent.clientY - startClientY);
      const isVertical = mode === "move" && dy >= dx;
      if (isVertical) {
        // 垂直拖：重排序/跨 lane（不改时间）。preview 保持原位，仅高亮目标 lane。
        preview(originalStart, originalEnd);
        targetEventsEl = this.getTimelineTimedDropTarget(moveEvent.clientX, moveEvent.clientY, eventsEl);
        this.syncTimelineTimedDropTarget(eventsEl, targetEventsEl);
        // 算插入点：同 lane 用源 laneEvents，跨 lane 用目标 lane events（精确插入目标位置）。
        lastReorderTarget = this.resolveTimelineReorderTarget(eventsEl, targetEventsEl, moveEvent.clientY, event.row.file.path, laneEvents ?? [], lanes ?? [], config);
      } else {
        // 水平拖（或 resize）：平移改时间；move 模式清除跨 lane 高亮 + reorder 指示线。
        const next = computeNext(moveEvent.clientX);
        preview(next.start, next.end);
        if (mode === "move") {
          targetEventsEl = eventsEl;
          this.syncTimelineTimedDropTarget(eventsEl, eventsEl);
          this.clearAllTimelineReorderLines();
          lastReorderTarget = null;
        }
      }
    };
    const onUp = (upEvent: MouseEvent): void => {
      window.activeDocument.removeEventListener("mousemove", onMove, true);
      window.activeDocument.removeEventListener("mouseup", onUp, true);
      this.activeTimelineDragCleanup = null;
      if (didDrag) {
        window.setTimeout(() => window.activeDocument.removeEventListener("click", swallowClick, true), 0);
      }
      // 垂直拖（reorder/跨 lane）保持 onMove 设的 originalStart/originalEnd——不要用 computeNext
      // 覆盖，否则垂直拖时的水平分量会改写 nextStart，导致下方 nextStart===originalStart 不成立、
      // 走平移而非 reorder（move 改成整体平移不夹后水平分量不再被吞掉，回归由此暴露）。
      const upDx = Math.abs(upEvent.clientX - startClientX);
      const upDy = Math.abs(upEvent.clientY - startClientY);
      const isVerticalUp = mode === "move" && upDy >= upDx;
      if (!isVerticalUp) {
        const next = computeNext(upEvent.clientX);
        preview(next.start, next.end);
      }
      if (mode === "move") {
        // 仅垂直拖（reorder/跨 lane）才按落点重查目标 lane；水平拖（改时间）固定源 lane，
        // 避免光标垂直漂移到相邻 lane 释放时误改分组（与 date-move 的 isVertical 守卫一致）。
        targetEventsEl = isVerticalUp
          ? this.getTimelineTimedDropTarget(upEvent.clientX, upEvent.clientY, eventsEl)
          : eventsEl;
      }
      button.removeClass("is-dragging", "is-resizing", "is-moving");
      if (mode === "move") this.clearAllTimelineDropTargets();
      else eventsEl.removeClass("is-resize-target");
      button.querySelector(":scope > .db-timeline-snap-marker")?.remove();
      eventsEl.querySelector(":scope > .db-timeline-snap-marker")?.remove();
      this.timelineResizeInProgress = false;
      const targetGroupKey = targetEventsEl.dataset.timelineLaneKey || groupKey;
      const didChangeLane = mode === "move"
        && targetGroupKey !== groupKey
        && this.canMoveTimelineAcrossLane(config)
        && Boolean(config.timelineGroupField);
      if (nextStart === originalStart && nextEnd === originalEnd && !didChangeLane) {
        // 垂直同 lane：rank reorder（如果有命中）。
        if (lastReorderTarget && mode === "move") {
          void this.actions.reorderTimelineEvent?.(event.row, lastReorderTarget.beforePath, lastReorderTarget.afterPath);
          return;
        }
        restore();
        return;
      }
      const startDateTime = this.getTimelineDateTimeFromAbsolute(model.startDateKey || event.startDateKey, nextStart);
      const endDateTime = this.getTimelineDateTimeFromAbsolute(model.startDateKey || event.startDateKey, nextEnd);
      if (didChangeLane && config.timelineGroupField) {
        // 跨 lane 拖拽只改分组（垂直意图），不改时间：避免一次拖拽产生「撤销顺序 / 撤销时间」两条记录。
        void this.actions.moveTimelineEventToGroup?.(event.row, config.timelineGroupField, groupKey, targetGroupKey, lastReorderTarget?.beforePath, lastReorderTarget?.afterPath);
        return;
      }
      if (nextStart !== originalStart || nextEnd !== originalEnd) {
        void this.actions.updateEventDates?.(event.row, {
          startField,
          startDateKey: startDateTime.dateKey,
          startTimeMinutes: startDateTime.minutes,
          endField,
          endDateKey: endField ? endDateTime.dateKey : undefined,
          endTimeMinutes: endField ? endDateTime.minutes : undefined,
          changedEdge: mode === "resize-start" ? "start" : mode === "resize-end" ? "end" : "both",
        });
      }
    };

    window.activeDocument.addEventListener("mousemove", onMove, true);
    window.activeDocument.addEventListener("mouseup", onUp, true);
    // 视图卸载中断拖拽时，移除 capture 监听并复位 resize 标志，避免泄漏/锁死后续拖拽。
    this.activeTimelineDragCleanup = () => {
      window.activeDocument.removeEventListener("mousemove", onMove, true);
      window.activeDocument.removeEventListener("mouseup", onUp, true);
      window.activeDocument.removeEventListener("click", swallowClick, true);
      this.timelineResizeInProgress = false;
    };
  }

  private beginTimelineResize(
    button: HTMLElement,
    eventsEl: HTMLElement,
    config: ViewConfig,
    event: CalendarTimelineEvent,
    model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; unit?: TimelineUnit; scale?: TimelineScale },
    mode: "resize-start" | "resize-end",
    startClientX: number,
  ): void {
    if (this.actions.isReadOnly || !this.actions.updateEventDates) return;
    const startField = config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config);
    const endField = config.timelineEndDateField || config.calendarEndDateField;
    const windowStartKey = model.startDateKey || event.startDateKey;
    const windowEndKey = model.endDateKey || this.getTimelineFallbackEndDateKey(windowStartKey, model.totalUnits);
    if (!startField || !endField || !windowStartKey || !windowEndKey) return;

    this.timelineResizeInProgress = true;
    button.addClass("is-resizing", "is-dragging");
    eventsEl.addClass("is-resize-target");

    const originalStartKey = event.startDateKey;
    const originalEndKey = event.endDateKey;
    // 统一用 resolveEventAbsoluteScale 口径 + applyTimelineAbsolutePosition 定位（与渲染同口径）。
    const unit: TimelineUnit = model.unit ?? (model.scale === "day" ? "hour" : "day");
    const visible = model.scale === "day"
      ? this.getTimelineVisibleMinutes(config, model)
      : { startMinutes: 0, endMinutes: Math.max(1, model.totalUnits) * MINUTES_PER_DAY };
    // 捕获渲染时的 exact 定位，restore 原样恢复。
    const originalExactOffset = button.style.getPropertyValue("--db-timeline-exact-offset");
    const originalExactWidth = button.style.getPropertyValue("--db-timeline-exact-width");
    const unitWidth = this.getTimelineUnitPixelWidth(eventsEl, model.totalUnits);
    let didMove = false;
    let nextStartKey = originalStartKey;
    let nextEndKey = originalEndKey;

    const restore = (): void => {
      if (originalExactOffset) button.style.setProperty("--db-timeline-exact-offset", originalExactOffset);
      else button.style.removeProperty("--db-timeline-exact-offset");
      if (originalExactWidth) button.style.setProperty("--db-timeline-exact-width", originalExactWidth);
      else button.style.removeProperty("--db-timeline-exact-width");
    };
    const swallowClick = (clickEvent: MouseEvent): void => {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
    };
    const previewRange = (targetKey: string): void => {
      const range = resolveDayRangeResize(originalStartKey, originalEndKey, targetKey, mode);
      nextStartKey = range.startDateKey;
      nextEndKey = range.endDateKey;
      // 用 resolveEventAbsoluteScale 把新日期区间换算成绝对刻度（date 列无 time：start=当日 0:00、
      // end=endDateKey 次日 0:00），再走统一 exact 定位——所见即所得，天数变化会实时反映在宽度上。
      const scale = resolveEventAbsoluteScale(
        { startDateKey: nextStartKey, endDateKey: nextEndKey, startMinutes: undefined, endMinutes: undefined },
        windowStartKey,
      );
      // 夹到可见窗口（与渲染同口径）。
      const renderStart = Math.max(scale.start, visible.startMinutes);
      const renderEnd = Math.min(scale.end, visible.endMinutes);
      this.applyTimelineAbsolutePosition(button, renderStart, renderEnd, visible.startMinutes, unit);
      this.renderTimelineRangeSnap(eventsEl, button, this.formatDateRange(nextStartKey, nextEndKey), renderStart, visible.startMinutes, unit, unitWidth);
    };
    const targetFromX = (clientX: number): string => {
      return this.getTimelineDateFromPoint(eventsEl, clientX, windowStartKey, model.totalUnits, windowEndKey, model.scale);
    };
    const onMove = (moveEvent: MouseEvent): void => {
      if (!didMove && Math.abs(moveEvent.clientX - startClientX) > 3) {
        didMove = true;
        window.activeDocument.addEventListener("click", swallowClick, true);
      }
      previewRange(targetFromX(moveEvent.clientX));
    };
    const onUp = (upEvent: MouseEvent): void => {
      window.activeDocument.removeEventListener("mousemove", onMove, true);
      window.activeDocument.removeEventListener("mouseup", onUp, true);
      this.activeTimelineDragCleanup = null;
      if (didMove) {
        window.setTimeout(() => window.activeDocument.removeEventListener("click", swallowClick, true), 0);
      }
      previewRange(targetFromX(upEvent.clientX));
      button.removeClass("is-resizing", "is-dragging");
      eventsEl.removeClass("is-resize-target");
      button.querySelector(":scope > .db-timeline-snap-marker")?.remove();
      eventsEl.querySelector(":scope > .db-timeline-snap-marker")?.remove();
      this.timelineResizeInProgress = false;
      if (nextStartKey === originalStartKey && nextEndKey === originalEndKey) {
        restore();
        return;
      }
      void this.actions.updateEventDates?.(event.row, resolveAllDayResizeChange({
        mode,
        newStartDateKey: nextStartKey,
        newEndDateKey: nextEndKey,
        startField,
        endField,
        startMinutes: event.startMinutes,
        endMinutes: event.endMinutes,
      }));
    };

    window.activeDocument.addEventListener("mousemove", onMove, true);
    window.activeDocument.addEventListener("mouseup", onUp, true);
    // 视图卸载中断 resize 时，移除 capture 监听并复位 resize 标志，避免泄漏/锁死后续拖拽。
    this.activeTimelineDragCleanup = () => {
      window.activeDocument.removeEventListener("mousemove", onMove, true);
      window.activeDocument.removeEventListener("mouseup", onUp, true);
      window.activeDocument.removeEventListener("click", swallowClick, true);
      this.timelineResizeInProgress = false;
    };
  }

  /**
   * date 列 move 拖拽（pointer，全 scale 通用）：本体沿轨道实时滑动（吸附感）。
   * 统一用 resolveEventAbsoluteScale + applyTimelineAbsolutePosition（与渲染同口径）。
   * 水平为主=按天整体平移改日期（保持 durationDays）；垂直为主=同 lane 重排序或跨 lane 改分组。
   */
  private beginTimelineDateDrag(
    button: HTMLElement,
    eventsEl: HTMLElement,
    config: ViewConfig,
    event: CalendarTimelineEvent,
    groupKey: string,
    model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; unit?: TimelineUnit; scale?: TimelineScale },
    startClientX: number,
    startClientY: number,
    laneEvents: CalendarTimelineEvent[],
    lanes: Array<{ key: string; events: readonly CalendarTimelineEvent[] }>,
  ): void {
    if (this.actions.isReadOnly || !this.actions.updateEventDates) return;
    const startField = config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config);
    const endField = config.timelineEndDateField || config.calendarEndDateField;
    const windowStartKey = model.startDateKey || event.startDateKey;
    if (!startField || !windowStartKey) return;

    // 统一绝对刻度（相对 windowStartKey 的分钟，与渲染同口径）。
    const unit: TimelineUnit = model.unit ?? (model.scale === "day" ? "hour" : "day");
    const minutesPerUnit = unit === "hour" ? MINUTES_PER_HOUR : MINUTES_PER_DAY;
    const durationDays = Math.max(1, event.durationDays);
    // 事件真实起始日相对窗口起点的偏移（可为负：事件起点在窗口之前）。onUp 用它 + deltaDays 算
    // 新起始日，避免旧实现「windowStart + 被夹取的 unit 偏移」改写事件真实起始日（QA 问题 6）。
    const originalStartDay = dateKeyDaysBetween(windowStartKey, event.startDateKey) ?? 0;
    const originalStartDateKey = event.startDateKey;
    // 可见窗口（与渲染同一夹取口径）：day scale 用小时范围，其余用整个多天窗口。
    const visible = model.scale === "day"
      ? this.getTimelineVisibleMinutes(config, model)
      : { startMinutes: 0, endMinutes: Math.max(1, model.totalUnits) * MINUTES_PER_DAY };
    const unitWidth = this.getTimelineUnitPixelWidth(eventsEl, model.totalUnits);
    // 一天的像素宽：day scale = unitWidth×24（unit=小时），其余 = unitWidth（unit=天）。
    const pixelsPerDay = unitWidth > 0 ? (unitWidth * MINUTES_PER_DAY) / minutesPerUnit : 0;
    const metaEl = button.querySelector<HTMLElement>(".db-timeline-event-meta");
    const originalMeta = metaEl?.textContent || "";
    // 捕获渲染时的 exact 定位（已夹到可见窗口），restore 原样恢复，避免重算夹取。
    const originalExactOffset = button.style.getPropertyValue("--db-timeline-exact-offset");
    const originalExactWidth = button.style.getPropertyValue("--db-timeline-exact-width");

    let didDrag = false;
    let nextStartDay = originalStartDay;
    // 垂直同 lane reorder 命中（onMove 设、onUp 复用，不用 clientY 重新命中）。
    let lastReorderTarget: { targetPath: string; placeBefore: boolean; beforePath?: string; afterPath?: string } | null = null;
    let targetEventsEl = eventsEl;

    button.addClass("is-dragging", "is-moving");
    eventsEl.addClass("is-drop-target");

    const restore = (): void => {
      if (originalExactOffset) button.style.setProperty("--db-timeline-exact-offset", originalExactOffset);
      else button.style.removeProperty("--db-timeline-exact-offset");
      if (originalExactWidth) button.style.setProperty("--db-timeline-exact-width", originalExactWidth);
      else button.style.removeProperty("--db-timeline-exact-width");
      if (metaEl) metaEl.setText(originalMeta);
    };
    const swallowClick = (clickEvent: MouseEvent): void => {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
    };
    // 本体滑到 startDay（沿轨道实时滑动=吸附感），并更新 meta 为目标日期范围。
    const preview = (startDay: number): void => {
      nextStartDay = startDay;
      const nextStartScale = startDay * MINUTES_PER_DAY;
      const nextEndScale = nextStartScale + durationDays * MINUTES_PER_DAY;
      // 夹到可见窗口（与渲染同口径），避免拖拽起始时本体从渲染位置跳到未夹取刻度。
      const renderStart = Math.max(nextStartScale, visible.startMinutes);
      const renderEnd = Math.min(nextEndScale, visible.endMinutes);
      this.applyTimelineAbsolutePosition(button, renderStart, renderEnd, visible.startMinutes, unit);
      const nextStartKey = addDateKeyDays(windowStartKey, startDay);
      const nextEndKey = endField ? addDateKeyDays(nextStartKey, durationDays - 1) : nextStartKey;
      const label = this.formatDateRange(nextStartKey, nextEndKey);
      if (metaEl) metaEl.setText(label);
      this.renderTimelineRangeSnap(eventsEl, button, label, renderStart, visible.startMinutes, unit, unitWidth);
    };
    const clearReorderLine = (): void => {
      this.clearAllTimelineReorderLines();
      lastReorderTarget = null;
    };

    const onMove = (moveEvent: MouseEvent): void => {
      if (!didDrag && (Math.abs(moveEvent.clientX - startClientX) > 3 || Math.abs(moveEvent.clientY - startClientY) > 3)) {
        didDrag = true;
        window.activeDocument.addEventListener("click", swallowClick, true);
      }
      const dx = Math.abs(moveEvent.clientX - startClientX);
      const dy = Math.abs(moveEvent.clientY - startClientY);
      if (dy >= dx) {
        // 垂直为主：本体锁原位，高亮目标 lane + 算插入点（同 lane 源 / 跨 lane 目标 lane）。
        preview(originalStartDay);
        targetEventsEl = this.getTimelineTimedDropTarget(moveEvent.clientX, moveEvent.clientY, eventsEl);
        this.syncTimelineTimedDropTarget(eventsEl, targetEventsEl);
        lastReorderTarget = this.resolveTimelineReorderTarget(eventsEl, targetEventsEl, moveEvent.clientY, event.row.file.path, laneEvents, lanes, config);
      } else {
        // 水平为主：本体沿轨道实时滑（按天吸附）。
        const deltaDays = pixelsPerDay > 0 ? Math.round((moveEvent.clientX - startClientX) / pixelsPerDay) : 0;
        preview(originalStartDay + deltaDays);
        targetEventsEl = eventsEl;
        this.syncTimelineTimedDropTarget(eventsEl, eventsEl);
        clearReorderLine();
      }
    };

    const onUp = (upEvent: MouseEvent): void => {
      window.activeDocument.removeEventListener("mousemove", onMove, true);
      window.activeDocument.removeEventListener("mouseup", onUp, true);
      this.activeTimelineDragCleanup = null;
      if (didDrag) {
        window.setTimeout(() => window.activeDocument.removeEventListener("click", swallowClick, true), 0);
      }
      button.removeClass("is-dragging", "is-moving");
      this.clearAllTimelineDropTargets();
      button.querySelector(":scope > .db-timeline-snap-marker")?.remove();
      eventsEl.querySelector(":scope > .db-timeline-snap-marker")?.remove();

      if (!didDrag) {
        restore();
        return;
      }

      const dx = Math.abs(upEvent.clientX - startClientX);
      const dy = Math.abs(upEvent.clientY - startClientY);
      const isVertical = dy >= dx;
      const upTargetEventsEl = isVertical ? this.getTimelineTimedDropTarget(upEvent.clientX, upEvent.clientY, eventsEl) : eventsEl;
      const targetGroupKey = upTargetEventsEl.dataset.timelineLaneKey || groupKey;
      const didChangeLane = isVertical
        && targetGroupKey !== groupKey
        && this.canMoveTimelineAcrossLane(config)
        && Boolean(config.timelineGroupField);

      // 垂直同 lane：rank reorder（复用 mousemove 缓存命中，不用 clientY 重新命中）。
      if (isVertical && !didChangeLane && this.canTimelineReorder(config) && lastReorderTarget) {
        void this.actions.reorderTimelineEvent?.(event.row, lastReorderTarget.beforePath, lastReorderTarget.afterPath);
        return;
      }
      // 跨 lane 拖拽只改分组（垂直意图），不改日期：避免一次拖拽同时触发分组移动 + 日期修改，
      // 产生「撤销顺序 / 撤销时间」两条撤销记录。设计上垂直=分组/重排、水平=改日期，互斥。
      if (didChangeLane && config.timelineGroupField) {
        void this.actions.moveTimelineEventToGroup?.(event.row, config.timelineGroupField, groupKey, targetGroupKey, lastReorderTarget?.beforePath, lastReorderTarget?.afterPath);
        return;
      }
      // 水平：改日期（所见即所得，nextStartDay 来自 preview）。
      const nextStartKey = addDateKeyDays(windowStartKey, nextStartDay);
      if (nextStartKey !== originalStartDateKey) {
        const nextEndKey = endField ? addDateKeyDays(nextStartKey, durationDays - 1) : undefined;
        void this.actions.updateEventDates?.(event.row, resolveDayMoveChange({
          startField,
          startDateKey: nextStartKey,
          endField,
          endDateKey: nextEndKey,
          startMinutes: event.startMinutes,
          endMinutes: event.endMinutes,
        }));
      } else {
        restore();
      }
    };

    window.activeDocument.addEventListener("mousemove", onMove, true);
    window.activeDocument.addEventListener("mouseup", onUp, true);
    // 视图卸载中断拖拽时，移除 capture 监听并复位标志，避免泄漏/锁死后续拖拽。
    this.activeTimelineDragCleanup = () => {
      window.activeDocument.removeEventListener("mousemove", onMove, true);
      window.activeDocument.removeEventListener("mouseup", onUp, true);
      window.activeDocument.removeEventListener("click", swallowClick, true);
    };
  }

  private renderTimelineMobileMenuButton(
    button: HTMLElement,
    config: ViewConfig,
    event: { row: RowData; startDateKey: string; endDateKey: string; durationDays: number },
    groupKey: string,
    laneEvents: Array<{ row: RowData }>,
    lanes: Array<{ key: string; label: string; events: Array<{ row: RowData }> }>
  ): void {
    const menuButton = button.createEl("button", {
      cls: "db-timeline-mobile-menu-button",
      text: "...",
      attr: { type: "button" },
    });
    setTooltip(menuButton, t("mobile.moveCard"), { delay: 100 });
    menuButton.onclick = (mouseEvent) => {
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      this.showTimelineMobileMenu(mouseEvent, config, event, groupKey, laneEvents, lanes);
    };
  }

  private showTimelineMobileMenu(
    mouseEvent: MouseEvent,
    config: ViewConfig,
    event: { row: RowData; startDateKey: string; endDateKey: string; durationDays: number },
    groupKey: string,
    laneEvents: Array<{ row: RowData }>,
    lanes: Array<{ key: string; label: string; events: Array<{ row: RowData }> }>
  ): void {
    const startField = config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config);
    if (!startField) return;
    const endField = config.timelineEndDateField || config.calendarEndDateField;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("common.open")).setIcon("file-text").onClick(() => this.actions.openRow(event.row)));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("calendar.moveToday")).setIcon("calendar-days").onClick(() => {
      this.updateEventDateRange(event.row, startField, endField, this.getTodayDateKey(), event.durationDays);
    }));
    menu.addItem((item) => item.setTitle(t("calendar.movePrevDay")).setIcon("arrow-left").onClick(() => {
      this.updateEventDateRange(event.row, startField, endField, addDateKeyDays(event.startDateKey, -1), event.durationDays);
    }));
    menu.addItem((item) => item.setTitle(t("calendar.moveNextDay")).setIcon("arrow-right").onClick(() => {
      this.updateEventDateRange(event.row, startField, endField, addDateKeyDays(event.startDateKey, 1), event.durationDays);
    }));
    menu.addItem((item) => item.setTitle(t("calendar.moveToDate")).setIcon("calendar-plus").onClick(() => {
      this.requestDateKey(event.startDateKey, (dateKey) => {
        this.updateEventDateRange(event.row, startField, endField, dateKey, event.durationDays);
      });
    }));
    if (endField) {
      menu.addItem((item) => item.setTitle(t("calendar.extendOneDay")).setIcon("plus").onClick(() => {
        void this.actions.updateEventDates?.(event.row, { startField, startDateKey: event.startDateKey, endField, endDateKey: addDateKeyDays(event.endDateKey, 1), changedEdge: "end" });
      }));
      menu.addItem((item) => item.setTitle(t("calendar.shortenOneDay")).setIcon("minus").setDisabled(event.durationDays <= 1).onClick(() => {
        void this.actions.updateEventDates?.(event.row, { startField, startDateKey: event.startDateKey, endField, endDateKey: addDateKeyDays(event.endDateKey, -1), changedEdge: "end" });
      }));
    }
    if (this.canTimelineReorder(config)) {
      const paths = laneEvents.map((candidate) => candidate.row.file.path).filter((path) => path !== event.row.file.path);
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("mobile.moveTop")).setIcon("chevrons-up").setDisabled(paths.length === 0).onClick(() => {
        this.actions.reorderTimelineEvent?.(event.row, undefined, paths[0]);
      }));
      menu.addItem((item) => item.setTitle(t("mobile.moveBottom")).setIcon("chevrons-down").setDisabled(paths.length === 0).onClick(() => {
        this.actions.reorderTimelineEvent?.(event.row, paths.at(-1), undefined);
      }));
    }
    if (this.canMoveTimelineAcrossLane(config) && config.timelineGroupField) {
      menu.addSeparator();
      for (const lane of lanes) {
        if (lane.key === groupKey) continue;
        menu.addItem((item) => item.setTitle(`${t("mobile.moveTo")} ${lane.label}`).setIcon("move-right").onClick(() => {
          const beforePath = lane.events.map((candidate) => candidate.row.file.path).at(-1);
          void this.actions.moveTimelineEventToGroup?.(event.row, config.timelineGroupField!, groupKey, lane.key, beforePath, undefined);
        }));
      }
    }
    menu.showAtMouseEvent(mouseEvent);
  }

  private getTimelineDateFromPoint(eventsEl: HTMLElement, clientX: number, startDateKey: string, totalUnits: number, endDateKey?: string, scale?: TimelineScale): string {
    const rect = eventsEl.getBoundingClientRect();
    // 日视图（小时网格）：跨天 all-day 事件按天交互——1 天 = eventsEl 全宽，
    // clientX 超出当天范围（拖 resize/移动到相邻天）算 1 天偏移。若沿用下方按小时
    // unit-width 的算法，会把小时 index 当天偏移（拖 1 小时宽度 = 1 天），映射错乱。
    if (scale === "day") {
      const dayWidth = rect.width;
      const rawOffset = dayWidth > 0 ? Math.floor((clientX - rect.left) / dayWidth) : 0;
      return addDateKeyDays(startDateKey, Math.max(0, rawOffset));
    }
    const unitWidth = this.getTimelineUnitPixelWidth(eventsEl, totalUnits);
    const rawOffset = unitWidth > 0 ? Math.floor((clientX - rect.left) / unitWidth) : 0;
    const maxOffset = endDateKey ? Math.max(0, this.dateKeyDaysBetween(startDateKey, endDateKey)) : Math.max(1, totalUnits) - 1;
    const offset = Math.max(0, Math.min(maxOffset, rawOffset));
    return addDateKeyDays(startDateKey, offset);
  }

  private getTimelineCreateTargetFromPoint(
    eventsEl: HTMLElement,
    clientX: number,
    config: ViewConfig,
    model: { startDateKey?: string; endDateKey?: string; startMinutes?: number; totalUnits: number; scale: TimelineScale },
  ): TimelineCreateTarget {
    const startDateKey = model.startDateKey || this.getTodayDateKey();
    if (model.scale !== "day") {
      const rect = eventsEl.getBoundingClientRect();
      const unitWidth = this.getTimelineUnitPixelWidth(eventsEl, model.totalUnits);
      const rawOffset = unitWidth > 0 ? Math.floor((clientX - rect.left) / unitWidth) : 0;
      const offsetUnits = Math.max(0, Math.min(Math.max(1, model.totalUnits) - 1, rawOffset));
      const spanUnits = Math.max(1, Math.min(this.getTimelineCreateSpanUnits(model), model.totalUnits - offsetUnits));
      const dateKey = addDateKeyDays(startDateKey, offsetUnits);
      return {
        dateKey,
        options: spanUnits > 1 ? { endDateKey: addDateKeyDays(dateKey, spanUnits - 1) } : {},
        offsetUnits,
        spanUnits,
        totalUnits: model.totalUnits,
      };
    }
    const rect = eventsEl.getBoundingClientRect();
    const visible = this.getTimelineVisibleMinutes(config, model);
    const unitWidth = this.getTimelineUnitPixelWidth(eventsEl, model.totalUnits);
    const rawMinutes = unitWidth > 0
      ? visible.startMinutes + ((clientX - rect.left) / unitWidth) * 60
      : visible.startMinutes;
    const startTimeMinutes = Math.max(
      visible.startMinutes,
      Math.min(visible.endMinutes - TIME_SNAP_MINUTES, this.snapTimelineMinutes(rawMinutes)),
    );
    const endTimeMinutes = Math.min(visible.endMinutes, startTimeMinutes + 60);
    const startDateTime = this.getTimelineDateTimeFromAbsolute(startDateKey, startTimeMinutes);
    const endDateTime = this.getTimelineDateTimeFromAbsolute(startDateKey, Math.max(startTimeMinutes + TIME_SNAP_MINUTES, endTimeMinutes));
    return {
      dateKey: startDateTime.dateKey,
      options: {
        startTimeMinutes: startDateTime.minutes,
        endTimeMinutes: endDateTime.minutes,
        ...(endDateTime.dateKey !== startDateTime.dateKey ? { endDateKey: endDateTime.dateKey } : {}),
      },
      offsetUnits: (startTimeMinutes - visible.startMinutes) / 60,
      spanUnits: Math.max(TIME_SNAP_MINUTES / 60, (Math.max(startTimeMinutes + TIME_SNAP_MINUTES, endTimeMinutes) - startTimeMinutes) / 60),
      totalUnits: model.totalUnits,
    };
  }

  private getTimelineCreateSpanUnits(model: { totalUnits: number; scale: TimelineScale }): number {
    if (model.scale === "quarter") return Math.min(7, Math.max(1, model.totalUnits));
    return 1;
  }

  private getTimelineSlotDuration(config: ViewConfig): 15 | 30 | 60 {
    return getCalendarSlotDuration(config);
  }

  private getTimelineRenderUnitWidth(config: ViewConfig, scale: TimelineScale): number {
    return resolveTimelineUnitWidth(config, scale);
  }

  private getTimelineViewportUnitCount(container: HTMLElement, config: ViewConfig, unitWidth: number): number | undefined {
    const rect = container.getBoundingClientRect();
    const style = window.getComputedStyle(container);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const width = getTimelineViewportContentWidth(rect.width || container.clientWidth || 0, paddingLeft, paddingRight);
    return resolveTimelineViewportUnitCount(width, unitWidth, config.timelineScale || "week");
  }

  private getTimelineViewportUnitSpan(container: HTMLElement, unitWidth: number): number | undefined {
    const rect = container.getBoundingClientRect();
    const style = window.getComputedStyle(container);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const width = getTimelineViewportContentWidth(rect.width || container.clientWidth || 0, paddingLeft, paddingRight);
    return resolveTimelineViewportUnitSpan(width, unitWidth);
  }

  private observeTimelineViewport(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
    const ResizeObserverCtor = container.ownerDocument.defaultView?.ResizeObserver || window.ResizeObserver;
    if (!ResizeObserverCtor) return;
    const unitWidth = this.getTimelineRenderUnitWidth(config, config.timelineScale || "week");
    this.timelineResizeObserver = new ResizeObserverCtor(() => {
      if (!this.timelineRoot?.isConnected) {
        this.disconnectTimelineResizeObserver();
        return;
      }
      const nextUnitCount = this.getTimelineViewportUnitCount(container, config, unitWidth);
      const nextUnitSpan = this.getTimelineViewportUnitSpan(container, unitWidth);
      if (nextUnitCount !== this.timelineObservedUnitCount || this.hasTimelineViewportUnitSpanChanged(nextUnitSpan)) {
        const leftAnchor = this.getTimelineViewportLeftAnchor(config, nextUnitCount);
        const renderConfig = leftAnchor
          ? { ...config, timelineAnchor: leftAnchor.dateKey, ...(leftAnchor.timeMinutes != null ? { timelineAnchorTimeMinutes: leftAnchor.timeMinutes } : {}) }
          : config;
        const previousScrollTop = container.scrollTop;
        const previousScrollLeft = container.scrollLeft;
        this.renderTimeline(container, renderConfig, rows);
        container.scrollTop = previousScrollTop;
        container.scrollLeft = previousScrollLeft;
      }
    });
    this.timelineResizeObserver.observe(container);
  }

  private hasTimelineViewportUnitSpanChanged(nextUnitSpan: number | undefined): boolean {
    if (this.timelineObservedUnitSpan == null || nextUnitSpan == null) return this.timelineObservedUnitSpan !== nextUnitSpan;
    return Math.abs(this.timelineObservedUnitSpan - nextUnitSpan) >= 0.01;
  }

  private disconnectTimelineResizeObserver(): void {
    this.timelineResizeObserver?.disconnect();
    this.timelineResizeObserver = null;
  }

  private getTimelineViewportLeftAnchor(config: ViewConfig, visibleUnitCount: number | undefined): { dateKey: string; timeMinutes?: number } | null {
    const renderedWindow = this.timelineFlashWindow;
    if (!renderedWindow?.startDateKey || visibleUnitCount == null) return null;
    return getTimelineViewportStartAnchor(config, renderedWindow.startDateKey, visibleUnitCount, renderedWindow.startMinutes);
  }

  private formatTimelineUnitValue(value: number): string {
    if (!Number.isFinite(value)) return "1";
    return String(Math.round(value * 1000) / 1000);
  }

  private getTimelineUnitPixelWidth(eventsEl: HTMLElement, totalUnits: number): number {
    const raw = window.getComputedStyle(eventsEl).getPropertyValue("--db-timeline-unit-width").trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const rect = eventsEl.getBoundingClientRect();
    return rect.width > 0 ? rect.width / Math.max(1, totalUnits) : 0;
  }

  private getTimelineVisibleMinutes(
    config: ViewConfig,
    model?: { startDateKey?: string; startMinutes?: number; totalUnits: number; scale?: TimelineScale },
  ): { startMinutes: number; endMinutes: number } {
    if (model?.scale === "day" && typeof model.startMinutes === "number" && Number.isFinite(model.startMinutes)) {
      const startMinutes = model.startMinutes;
      return { startMinutes, endMinutes: startMinutes + Math.max(1, model.totalUnits) * MINUTES_PER_HOUR };
    }
    const startHour = this.getDayStartHour(config);
    const rawEnd = this.getDayEndHour(config);
    const endHour = rawEnd <= startHour ? Math.min(24, startHour + 1) : rawEnd;
    return { startMinutes: startHour * MINUTES_PER_HOUR, endMinutes: endHour * MINUTES_PER_HOUR };
  }

  private getDayEndHour(config: ViewConfig): number {
    const value = config.calendarEndHour;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return 24;
    return Math.max(1, Math.min(24, Math.round(numeric)));
  }

  private snapTimelineMinutes(minutes: number): number {
    return snapMinutes(minutes);
  }

  private getTimelineDateTimeFromAbsolute(startDateKey: string, absoluteMinutes: number): { dateKey: string; minutes: number } {
    const rounded = this.snapTimelineMinutes(absoluteMinutes);
    const dayOffset = Math.floor(rounded / MINUTES_PER_DAY);
    return {
      dateKey: addDateKeyDays(startDateKey, dayOffset),
      minutes: this.minuteOfDay(rounded),
    };
  }

  private minuteOfDay(minutes: number): number {
    return minuteOfDay(minutes);
  }

  private getTimelineFallbackEndDateKey(startDateKey: string, totalUnits: number): string {
    return addDateKeyDays(startDateKey, Math.max(1, totalUnits) - 1);
  }

  private renderTimelineRangeSnap(
    eventsEl: HTMLElement,
    button: HTMLElement,
    label: string,
    renderStart: number,
    visibleStart: number,
    unit: TimelineUnit,
    unitWidth: number,
  ): void {
    const minutesPerUnit = unit === "hour" ? MINUTES_PER_HOUR : MINUTES_PER_DAY;
    this.renderTimelineSnap(eventsEl, label, {
      variant: "timed-range",
      leftPx: ((renderStart - visibleStart) / minutesPerUnit) * unitWidth,
      topPx: Math.max(4, button.offsetTop + button.offsetHeight + 2),
      widthPx: this.getTimelineSnapPreviewWidth(label),
    });
  }

  private getTimelineSnapPreviewWidth(label: string): number {
    const textWidth = Array.from(label).reduce((total, char) => {
      if (/\s/.test(char)) return total + 4;
      if (/[\u3000-\u9fff]/.test(char)) return total + 12;
      return total + 7;
    }, 18);
    return Math.max(220, Math.min(420, Math.ceil(textWidth)));
  }

  private renderTimelineSnap(
    eventsEl: HTMLElement,
    dateKey: string,
    options?: { variant?: "timed-range"; leftPx?: number; topPx?: number; widthPx?: number },
  ): void {
    let snap = eventsEl.querySelector<HTMLElement>(":scope > .db-timeline-snap-marker");
    if (!snap) snap = eventsEl.createDiv({ cls: "db-timeline-snap-marker" });
    snap.toggleClass("is-timed-range", options?.variant === "timed-range");
    const snapWidth = Number.isFinite(options?.widthPx) ? Math.max(96, options!.widthPx!) : 0;
    if (Number.isFinite(options?.leftPx)) {
      const laneWidth = eventsEl.clientWidth || eventsEl.getBoundingClientRect().width || 0;
      const maxLeft = Math.max(8, laneWidth - snapWidth - 8);
      const left = laneWidth > 0 ? Math.min(maxLeft, Math.max(8, options!.leftPx!)) : Math.max(8, options!.leftPx!);
      snap.style.setProperty("--db-timeline-snap-left", `${left}px`);
    } else {
      snap.style.removeProperty("--db-timeline-snap-left");
    }
    if (snapWidth > 0) snap.style.setProperty("--db-timeline-snap-width", `${snapWidth}px`);
    else snap.style.removeProperty("--db-timeline-snap-width");
    if (Number.isFinite(options?.topPx)) snap.style.setProperty("--db-timeline-snap-top", `${Math.max(0, options!.topPx!)}px`);
    else snap.style.removeProperty("--db-timeline-snap-top");
    snap.setText(dateKey);
  }

  private getTimelineTimedDropTarget(clientX: number, clientY: number, fallbackEventsEl: HTMLElement): HTMLElement {
    const hit = window.activeDocument.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const directLane = hit?.closest<HTMLElement>(".db-timeline-events");
    if (directLane?.dataset.timelineLaneKey) return directLane;
    const group = hit?.closest<HTMLElement>(".db-timeline-group");
    const groupLane = group?.querySelector<HTMLElement>(":scope > .db-timeline-events");
    if (groupLane?.dataset.timelineLaneKey) return groupLane;
    // 折叠分组无 .db-timeline-events 子元素，但 group 自身带 data-timeline-lane-key：
    // 返回 group 让跨组移动命中折叠分组（精确插入由 resolveTimelineReorderTarget 对折叠态返回 null → 追加）。
    if (group?.dataset.timelineLaneKey) return group;
    return fallbackEventsEl;
  }

  private syncTimelineTimedDropTarget(sourceEventsEl: HTMLElement, targetEventsEl: HTMLElement): void {
    const timeline = sourceEventsEl.closest<HTMLElement>(".db-timeline") || window.activeDocument;
    // 同时清理 events 和折叠分组上的高亮（折叠分组无 .db-timeline-events，高亮挂在 group 上）。
    timeline.querySelectorAll<HTMLElement>(".db-timeline-events.is-drop-target, .db-timeline-group.is-drop-target").forEach((el) => {
      el.removeClass("is-drop-target");
    });
    targetEventsEl.addClass("is-drop-target");
  }

  private clearAllTimelineDropTargets(): void {
    window.activeDocument.querySelectorAll(".db-timeline-events.is-drop-target, .db-timeline-group.is-drop-target").forEach((el) => {
      el.removeClass("is-drop-target");
      el.querySelector(":scope > .db-timeline-snap-marker")?.remove();
      el.querySelector(":scope > .db-timeline-reorder-line")?.remove();
    });
  }

  private canTimelineReorder(config: ViewConfig): boolean {
    if (!this.actions.reorderTimelineEvent) return false;
    if (config.timelineGroupField?.startsWith("file.")) return false;
    return !isExplicitlySorted(config);
  }

  private canMoveTimelineAcrossLane(config: ViewConfig): boolean {
    if (!this.actions.moveTimelineEventToGroup || !config.timelineGroupField) return false;
    const col = config.schema.columns.find((candidate) => candidate.key === config.timelineGroupField);
    if (!col || col.type === "computed" || col.key.startsWith("file.")) return false;
    return col.type !== "multi-select";
  }

  private updateEventDateRange(row: RowData, startField: string, endField: string | undefined, startDateKey: string, durationDays: number): void {
    void this.actions.updateEventDates?.(row, {
      startField,
      startDateKey,
      endField,
      endDateKey: endField ? addDateKeyDays(startDateKey, Math.max(1, durationDays) - 1) : undefined,
    });
  }

  private requestDateKey(defaultDateKey: string, onSelect: (dateKey: string) => void): void {
    const input = window.activeDocument.createElement("input");
    input.type = "date";
    input.value = defaultDateKey;
    input.setAttribute("aria-label", t("calendar.moveToDate"));
    input.addClass("db-hidden-date-input");
    const remove = () => window.setTimeout(() => input.remove(), 0);
    input.onchange = () => {
      const value = input.value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(value) && parseDateKeyToUtc(value)) onSelect(value);
      remove();
    };
    input.onblur = remove;
    window.activeDocument.body.appendChild(input);
    input.focus();
    if (typeof input.showPicker === "function") input.showPicker();
    else input.click();
  }

  private isPhoneLayout(): boolean {
    return window.activeDocument.body.classList.contains("is-phone");
  }

  private renderEmpty(container: HTMLElement, key: string): void {
    container.createDiv({ cls: "db-empty", text: t(key) });
  }

  private renderTimelineEmptyRange(container: HTMLElement): void {
    container.createDiv({ cls: "db-empty db-timeline-empty-range", text: t("timeline.noEventsInRange") });
  }

  private formatDateRange(start: string, end: string): string {
    return formatDateRangeDisplay(start, end, { contextYear: parseDateTimeParts(start)?.year });
  }

  private formatTimelineEventMeta(event: CalendarTimelineEvent, scale: TimelineScale, config: ViewConfig): string {
    if (scale === "day" && !this.isTimelineDateColumn(config, event) && event.startMinutes != null && event.endMinutes != null) {
      return this.formatTimelineDayTimeRange(event.startDateKey, event.startMinutes, event.endDateKey, event.endMinutes);
    }
    return this.formatDateRange(event.startDateKey, event.endDateKey);
  }

  private formatTimelineDayTimeRange(startDateKey: string, startMinutes: number, endDateKey: string, endMinutes: number): string {
    const contextYear = parseDateTimeParts(startDateKey)?.year;
    const startDate = formatDateValueDisplay(startDateKey, { contextYear });
    const start = `${startDate} ${formatCalendarTime(startMinutes)}`;
    const endTime = formatCalendarTime(endMinutes);
    const end = startDateKey === endDateKey
      ? endTime
      : `${formatDateValueDisplay(endDateKey, { contextYear })} ${endTime}`;
    return `${start} - ${end}`;
  }

  private isCurrentTimelineTick(tick: { dateKey: string; label: string }, model: { scale: TimelineScale }, now = new Date()): boolean {
    if (model.scale !== "day") return false;
    const todayKey = this.getTodayDateKey(now);
    if (tick.dateKey !== todayKey) return false;
    return Number.parseInt(tick.label, 10) === now.getHours();
  }

  private isCurrentTimelineDateTick(tick: { dateKey: string }, model: { scale: TimelineScale }, now = new Date()): boolean {
    return model.scale !== "day" && tick.dateKey === this.getTodayDateKey(now);
  }

  private getTodayDateKey(date = new Date()): string {
    return getLocalDateKey(date);
  }

  private parseDateKey(dateKey: string): Date | null {
    return parseDateKeyToUtc(dateKey);
  }

  private formatMonthTitle(year: number, monthIndex: number): string {
    return new Intl.DateTimeFormat(getEffectiveLocale(), { month: "long", year: "numeric" }).format(new Date(year, monthIndex, 1));
  }

  private getMiniCalendarYearRangeStart(year: number): number {
    return Math.floor(year / 12) * 12;
  }

  private getWeekdayLabels(weekStartsOn: number): string[] {
    return getWeekdayLabels(getEffectiveLocale(), weekStartsOn);
  }

  private getLocaleWeekStartsOn(config?: ViewConfig): number {
    return getLocaleWeekStartsOn(config);
  }
}
