import { CalendarDayModel, CalendarTimelineEvent, extractTimelineEndpointMinutes, getDefaultEventDateField } from "./CalendarTimelineModel";
import { formatCalendarTime, normalizeVisibleHourRange } from "./CalendarDateTime";
import { getColumnDisplayType } from "./ColumnDisplay";
import { ColumnDef, RowData, ViewConfig } from "./types";

export interface CalendarMonthSegment {
  event: CalendarTimelineEvent;
  weekIndex: number;
  startDayIndex: number;
  endDayIndex: number;
  spanDays: number;
  lane: number;
  isStart: boolean;
  isEnd: boolean;
  isTimed: boolean;
  startMinutes?: number;
  endMinutes?: number;
}

export interface CalendarMonthWeekLayout {
  weekIndex: number;
  days: CalendarDayModel[];
  segments: CalendarMonthSegment[];
  rowCount: number;
}

export interface CalendarTimedEventLayout {
  event: CalendarTimelineEvent;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  clippedStartMinutes: number;
  clippedEndMinutes: number;
  columnIndex: number;
  columnCount: number;
}

export interface CalendarEventTiming {
  isTimed: boolean;
  startMinutes?: number;
  endMinutes?: number;
}

export interface CalendarVisibleHourRange {
  startHour: number;
  endHour: number;
  startMinutes: number;
  endMinutes: number;
}

interface MutableTimedLayout extends CalendarTimedEventLayout {
  columnIndex: number;
  columnCount: number;
}

export function buildCalendarMonthWeekLayouts(weeks: CalendarDayModel[][], config: ViewConfig): CalendarMonthWeekLayout[] {
  return weeks.map((week, weekIndex) => buildCalendarSegmentLayout(week, getUniqueWeekEvents(week), config, weekIndex));
}

export function buildCalendarWeekAllDayLayout(
  week: CalendarDayModel[],
  events: CalendarTimelineEvent[],
  config: ViewConfig,
): CalendarMonthWeekLayout {
  const allDayEvents = uniqueEvents(events).filter((event) => !getCalendarEventTiming(event, config).isTimed);
  return buildCalendarSegmentLayout(week, allDayEvents, config, 0);
}

export function buildCalendarTimedEventLayouts(
  dateKeys: string[],
  events: CalendarTimelineEvent[],
  config: ViewConfig,
): CalendarTimedEventLayout[] {
  const dateKeySet = new Set(dateKeys);
  const visible = getCalendarVisibleHourRange(config);
  const layouts: MutableTimedLayout[] = [];

  for (const event of uniqueEvents(events)) {
    if (!dateKeySet.has(event.startDateKey)) continue;
    const timing = getCalendarEventTiming(event, config);
    if (!timing.isTimed || timing.startMinutes == null || timing.endMinutes == null) continue;
    if (timing.endMinutes <= visible.startMinutes || timing.startMinutes >= visible.endMinutes) continue;
    layouts.push({
      event,
      dateKey: event.startDateKey,
      startMinutes: timing.startMinutes,
      endMinutes: timing.endMinutes,
      clippedStartMinutes: Math.max(visible.startMinutes, timing.startMinutes),
      clippedEndMinutes: Math.min(visible.endMinutes, timing.endMinutes),
      columnIndex: 0,
      columnCount: 1,
    });
  }

  const byDay = new Map<string, MutableTimedLayout[]>();
  for (const layout of layouts) {
    const bucket = byDay.get(layout.dateKey) || [];
    bucket.push(layout);
    byDay.set(layout.dateKey, bucket);
  }

  for (const dayLayouts of byDay.values()) {
    assignTimedColumns(dayLayouts);
  }

  return layouts.sort(compareTimedLayouts);
}

export function getCalendarEventTiming(event: CalendarTimelineEvent, config: ViewConfig): CalendarEventTiming {
  if (event.startDateKey !== event.endDateKey) return { isTimed: false };
  const startField = config.calendarStartDateField || getDefaultEventDateField(config);
  if (!startField) return { isTimed: false };

  // timed 判定：两端字段都必须是 datetime 类型才允许进时间网格
  // 避免 mixed date/datetime 或 date 列脏值被错误放进时间网格
  const startIsDateTime = isCalendarDateTimeField(config, startField);
  const endField = config.calendarEndDateField;
  const endIsDateTime = endField ? isCalendarDateTimeField(config, endField) : false;

  // 如果有结束字段，则两端都必须是 datetime；如果没有结束字段，只需开始是 datetime
  if (endField && (!startIsDateTime || !endIsDateTime)) return { isTimed: false };
  if (!endField && !startIsDateTime) return { isTimed: false };

  const startValue = getCalendarRowFieldValue(event.row, startField, config);
  const startMinutes = extractTimeMinutes(startValue, startIsDateTime);
  const hasStartTime = startMinutes != null;
  const endValue = endField ? getCalendarRowFieldValue(event.row, endField, config) : undefined;
  const endMinutes = extractTimeMinutes(endValue, endIsDateTime);
  const hasEndTime = endMinutes != null;
  if (!hasStartTime && !hasEndTime) return { isTimed: false };
  const resolvedStart = startMinutes ?? 0;
  const resolvedEnd = endMinutes != null && endMinutes > resolvedStart
    ? endMinutes
    : Math.min(1440, resolvedStart + 60);
  return {
    isTimed: true,
    startMinutes: resolvedStart,
    endMinutes: Math.max(resolvedStart + 15, resolvedEnd),
  };
}

export function getCalendarVisibleHourRange(config: ViewConfig): CalendarVisibleHourRange {
  return normalizeVisibleHourRange(config.calendarStartHour, config.calendarEndHour);
}

// 事件卡片紧凑模式下的最小高度（px）。小时高度必须 ≥ 4 × 此值，
// 保证 15 分钟粒度的 4 个紧凑事件卡片不会溢出 1 小时行。
export const EVENT_CARD_MIN_HEIGHT = 14;
export const HOUR_HEIGHT_MIN = EVENT_CARD_MIN_HEIGHT * 4; // 56

export function getCalendarHourHeight(config: ViewConfig): number {
  return clampInteger(config.calendarHourHeight, HOUR_HEIGHT_MIN, 96, Math.max(HOUR_HEIGHT_MIN, 48));
}

export function getCalendarSlotDuration(config: ViewConfig): 15 | 30 | 60 {
  const value = config.calendarWeekSlotDuration;
  return value === 15 || value === 60 ? value : 30;
}

export { formatCalendarTime };

function buildCalendarSegmentLayout(
  week: CalendarDayModel[],
  events: CalendarTimelineEvent[],
  config: ViewConfig,
  weekIndex: number,
): CalendarMonthWeekLayout {
  const dateKeys = week.map((day) => day.dateKey);
  const segments = events
    .map((event) => toWeekSegment(event, dateKeys, config, weekIndex))
    .filter((segment): segment is CalendarMonthSegment => Boolean(segment))
    .sort(compareMonthSegments);
  assignSegmentLanes(segments);
  return {
    weekIndex,
    days: week,
    segments,
    rowCount: segments.reduce((max, segment) => Math.max(max, segment.lane + 1), 0),
  };
}

function toWeekSegment(
  event: CalendarTimelineEvent,
  dateKeys: string[],
  config: ViewConfig,
  weekIndex: number,
): CalendarMonthSegment | null {
  const firstKey = dateKeys[0];
  const lastKey = dateKeys[dateKeys.length - 1];
  if (!firstKey || !lastKey || event.endDateKey < firstKey || event.startDateKey > lastKey) return null;
  const startDayIndex = dateKeys.findIndex((dateKey) => dateKey >= event.startDateKey && dateKey <= event.endDateKey);
  const endDayIndex = findLastIndex(dateKeys, (dateKey) => dateKey >= event.startDateKey && dateKey <= event.endDateKey);
  if (startDayIndex < 0 || endDayIndex < startDayIndex) return null;
  const timing = getCalendarEventTiming(event, config);
  return {
    event,
    weekIndex,
    startDayIndex,
    endDayIndex,
    spanDays: endDayIndex - startDayIndex + 1,
    lane: 0,
    isStart: event.startDateKey >= firstKey,
    isEnd: event.endDateKey <= lastKey,
    isTimed: timing.isTimed,
    startMinutes: timing.startMinutes,
    endMinutes: timing.endMinutes,
  };
}

function assignSegmentLanes(segments: CalendarMonthSegment[]): void {
  const lanes: CalendarMonthSegment[][] = [];
  for (const segment of segments) {
    let lane = 0;
    while (lanes[lane]?.some((placed) => segmentsOverlap(placed, segment))) {
      lane += 1;
    }
    segment.lane = lane;
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(segment);
  }
}

function assignTimedColumns(layouts: MutableTimedLayout[]): void {
  layouts.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes || a.event.title.localeCompare(b.event.title));
  let cluster: MutableTimedLayout[] = [];
  let clusterEnd = -1;
  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    for (const layout of cluster) {
      let column = columnEnds.findIndex((end) => end <= layout.startMinutes);
      if (column < 0) column = columnEnds.length;
      layout.columnIndex = column;
      columnEnds[column] = layout.endMinutes;
    }
    const columnCount = Math.max(1, columnEnds.length);
    for (const layout of cluster) {
      layout.columnCount = columnCount;
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const layout of layouts) {
    if (cluster.length > 0 && layout.startMinutes >= clusterEnd) {
      flush();
    }
    cluster.push(layout);
    clusterEnd = Math.max(clusterEnd, layout.endMinutes);
  }
  flush();
}

function getUniqueWeekEvents(week: CalendarDayModel[]): CalendarTimelineEvent[] {
  return uniqueEvents(week.flatMap((day) => day.events));
}

function uniqueEvents(events: CalendarTimelineEvent[]): CalendarTimelineEvent[] {
  const seen = new Set<string>();
  const unique: CalendarTimelineEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    unique.push(event);
  }
  return unique;
}

function compareMonthSegments(a: CalendarMonthSegment, b: CalendarMonthSegment): number {
  // Longer/multi-day spans get the low lanes. A spanning event anchored low stays
  // visible across every day it covers — otherwise it could be pushed to a high
  // lane by competition on its start day and then hidden (folded) on quiet days
  // where it is the only event. Start-day and view order are deterministic
  // tiebreaks. The day popover sorts by lane, so collapsed and expanded orders
  // stay consistent regardless of this comparator.
  return b.spanDays - a.spanDays ||
    a.startDayIndex - b.startDayIndex ||
    a.event.order - b.event.order;
}

function compareTimedLayouts(a: CalendarTimedEventLayout, b: CalendarTimedEventLayout): number {
  return a.dateKey.localeCompare(b.dateKey) ||
    a.startMinutes - b.startMinutes ||
    a.endMinutes - b.endMinutes ||
    a.event.title.localeCompare(b.event.title) ||
    a.event.filePath.localeCompare(b.event.filePath);
}

function segmentsOverlap(a: CalendarMonthSegment, b: CalendarMonthSegment): boolean {
  return a.startDayIndex <= b.endDayIndex && b.startDayIndex <= a.endDayIndex;
}

function getCalendarRowFieldValue(row: RowData, field: string, config: ViewConfig): unknown {
  if (field === "file.name") return row.file.name;
  if (field === "file.path") return row.file.path;
  if (field === "file.folder") return row.file.parent?.path || "";
  if (field === "file.ctime") return new Date(row.file.stat.ctime);
  if (field === "file.mtime") return new Date(row.file.stat.mtime);
  const col = config.schema.columns.find((candidate) => candidate.key === field);
  if (col?.type === "computed") return row.computed[col.computedKey || col.key];
  return row.frontmatter[field];
}

function isCalendarDateTimeField(config: ViewConfig, field: string): boolean {
  const column = config.schema.columns.find((candidate) => candidate.key === field);
  return getCalendarFieldDisplayType(column, config) === "datetime";
}

function getCalendarFieldDisplayType(column: ColumnDef | undefined, config: ViewConfig): ColumnDef["type"] | undefined {
  return column ? getColumnDisplayType(column, config.schema.computedFields) : undefined;
}

// 委托给共享的 extractTimelineEndpointMinutes（C1：消除分叉副本，避免日历/时间线两套
// 口径随时间漂移）。dateOnlyAsMidnight=false 保持日历语义：纯日期字符串 / number 值
// 不 coerce 成 00:00，仍按「无时间分量」处理——否则 datetime 列纯日期值会被判成
// 0:00 timed，在月视图时间网格被可见时段过滤后「消失」。
function extractTimeMinutes(value: unknown, includeDateObjectTime: boolean): number | undefined {
  return extractTimelineEndpointMinutes(value, { includeDateObjectTime, dateOnlyAsMidnight: false });
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index;
  }
  return -1;
}
