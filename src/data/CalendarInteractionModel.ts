import { CALENDAR_TIME_SNAP_MINUTES, formatTimeRange, snapMinutes } from "./CalendarDateTime";

export type CalendarDragMode = "move" | "resize-start" | "resize-end";
export type CalendarResizeMode = "resize-start" | "resize-end";

export interface CalendarEventDateChange {
  startField: string;
  startDateKey: string;
  startTimeMinutes?: number;
  endField?: string;
  endDateKey?: string;
  endTimeMinutes?: number;
  changedEdge?: "start" | "end" | "both";
}

export interface CalendarEventCreateOptions {
  startTimeMinutes?: number;
  endTimeMinutes?: number;
  endDateKey?: string;
  groupField?: string;
  groupKey?: string;
}

export interface TimedDragRangeInput {
  mode: CalendarDragMode;
  originalStart: number;
  originalEnd: number;
  visibleStart: number;
  visibleEnd: number;
  deltaMinutes: number;
  snapStepMinutes?: number;
  /** end 的上限分钟数。默认 visibleEnd（日历 resize 不跨天）；时间线传
   *  visibleEnd + N 天启用 resize-end 跨天（如 23:00 → 次日 12:15）。 */
  endMaxMinutes?: number;
}

export interface TimedDragRangeResult {
  start: number;
  end: number;
  duration: number;
  label: string;
}

export function resolveTimedDragRange(input: TimedDragRangeInput): TimedDragRangeResult {
  const snapStep = input.snapStepMinutes ?? CALENDAR_TIME_SNAP_MINUTES;
  // end 上限：默认 visibleEnd（日历 resize 不跨天）；时间线传 endMaxMinutes 启用跨天。
  const endMax = input.endMaxMinutes ?? input.visibleEnd;
  const originalStart = Math.max(input.visibleStart, Math.min(input.visibleEnd - snapStep, input.originalStart));
  const originalEnd = Math.max(input.originalStart + snapStep, input.originalEnd);
  const effectiveEndMax = Math.max(endMax, originalEnd);
  const delta = snapMinutes(input.deltaMinutes, snapStep);

  let start: number;
  let end: number;
  if (input.mode === "resize-start") {
    start = Math.max(input.visibleStart, Math.min(originalEnd - snapStep, snapMinutes(originalStart + delta, snapStep)));
    end = originalEnd;
  } else if (input.mode === "resize-end") {
    start = originalStart;
    end = Math.min(effectiveEndMax, Math.max(input.originalStart + snapStep, snapMinutes(originalEnd + delta, snapStep)));
  } else {
    // move 整体平移、保持时长：start = 原始 start + delta（用 input 原值，不夹到 visibleStart），
    // 否则窗口外起始的跨天事件 start 会被夹到 visibleStart、平移改写起始日（且若夹到 0:00 可能
    // 被写入当作无时间 → 丢时间变全天条）。move 必须忽略 endMaxMinutes，避免长事件 duration 被裁掉。
    const moveDuration = Math.max(snapStep, input.originalEnd - input.originalStart);
    start = snapMinutes(input.originalStart + delta, snapStep);
    end = start + moveDuration;
  }

  return {
    start,
    end,
    duration: Math.max(snapStep, end - start),
    label: formatTimeRange(start, end),
  };
}

export function resolveDayRangeResize(
  originalStartKey: string,
  originalEndKey: string,
  targetKey: string,
  mode: CalendarResizeMode,
): { startDateKey: string; endDateKey: string } {
  if (mode === "resize-start") {
    return {
      startDateKey: targetKey <= originalEndKey ? targetKey : originalEndKey,
      endDateKey: originalEndKey,
    };
  }
  return {
    startDateKey: originalStartKey,
    endDateKey: targetKey >= originalStartKey ? targetKey : originalStartKey,
  };
}

export interface AllDayResizeChangeInput {
  /** 哪一端被拖动：resize-start 改开始日期、resize-end 改结束日期。 */
  mode: CalendarResizeMode;
  /** resolveDayRangeResize 计算出的新开始/结束日期。 */
  newStartDateKey: string;
  newEndDateKey: string;
  startField: string;
  endField?: string;
  /** 事件原有的开始时间分量（分钟，仅 datetime 事件有；date 事件为 undefined）。 */
  startMinutes?: number;
  /** 事件原有的结束时间分量（分钟）。 */
  endMinutes?: number;
}

export interface DayMoveChangeInput {
  startField: string;
  startDateKey: string;
  endField?: string;
  endDateKey?: string;
  /** 事件原有的开始时间分量（分钟，仅 datetime 事件有；date 事件为 undefined）。 */
  startMinutes?: number;
  /** 事件原有的结束时间分量（分钟）。 */
  endMinutes?: number;
}

/**
 * 构建按天整体平移的日期变更 payload，并保留 datetime 列的原有时间分量。
 *
 * 周/月/季时间线和日历 month/week all-day 区都把横向拖拽解释为“只改日期、不改时刻”。
 * 因此 datetime 事件必须把原 start/end minutes 带回写入；date 事件没有 minutes，仍写纯日期。
 */
export function resolveDayMoveChange(input: DayMoveChangeInput): CalendarEventDateChange {
  const change: CalendarEventDateChange = {
    startField: input.startField,
    startDateKey: input.startDateKey,
    endField: input.endField,
    endDateKey: input.endDateKey,
    changedEdge: "both",
  };
  if (input.startMinutes != null) change.startTimeMinutes = input.startMinutes;
  if (input.endMinutes != null && input.endField) change.endTimeMinutes = input.endMinutes;
  return change;
}

/**
 * 构建 all-day resize 的日期变更 payload，并保留 datetime 列的原有时间分量（E2）。
 *
 * updateCalendarTimelineDates 在 changedEdge="start" 时只写开始端、"end" 时只写结束端，
 * 另一端不会被触碰、其 datetime 值自然保留。因此只需给「正在写入的那一端」带上原有
 * 时间即可；否则 datetime 列会被写成纯日期、静默丢失时刻
 * （如 06-16T15:00 拖宽到 06-17 后变成纯 06-17）。
 */
export function resolveAllDayResizeChange(input: AllDayResizeChangeInput): CalendarEventDateChange {
  const change: CalendarEventDateChange = {
    startField: input.startField,
    startDateKey: input.newStartDateKey,
    endField: input.endField,
    endDateKey: input.newEndDateKey,
    changedEdge: input.mode === "resize-start" ? "start" : "end",
  };
  // resize-start 写开始端 → 带开始时间；resize-end 写结束端 → 带结束时间。
  if (input.mode === "resize-start" && input.startMinutes != null) {
    change.startTimeMinutes = input.startMinutes;
  }
  if (input.mode === "resize-end" && input.endMinutes != null && input.endField) {
    change.endTimeMinutes = input.endMinutes;
  }
  return change;
}

export interface UnitDragOffsetInput {
  /** 水平位移换算的 unit 数（round((clientX - startClientX) / unitWidth)）。 */
  deltaUnits: number;
  /** 事件当前 unit 偏移（0 基，即 gridOffsetUnits ?? offsetUnits）。 */
  originalOffset: number;
  /** 事件跨度（天，>=1）。 */
  span: number;
  /** 窗口总 unit 数（天数）。 */
  totalUnits: number;
}

export interface UnitDragOffsetResult {
  /** 夹取后的 unit 偏移（0 基）。 */
  offsetUnits: number;
  /** 是否被边界夹取。 */
  clamped: boolean;
}

/**
 * 周/月/季 move 拖拽：把水平位移换算成夹取后的 unit 偏移（unit = 天，0 基）。
 * 本体沿轨道滑动时用：offset = originalOffset + deltaUnits，夹取到可见窗口
 * [0, totalUnits - span] 内，防止事件拖出窗口。返回值用于设置
 * `--db-timeline-offset`（CSS 用 offsetUnits + 1）。
 */
export function resolveUnitDragOffset(input: UnitDragOffsetInput): UnitDragOffsetResult {
  // span 至少为 1 天；maxOffset 为事件能在窗口内平移的最大起始偏移。
  const span = Math.max(1, input.span);
  const maxOffset = Math.max(0, input.totalUnits - span);
  // 原始位移目标。
  const raw = input.originalOffset + input.deltaUnits;
  // 夹取到 [0, maxOffset] 区间。
  const offsetUnits = Math.max(0, Math.min(maxOffset, raw));
  return { offsetUnits, clamped: offsetUnits !== raw };
}
