import { describe, expect, it } from "vitest";
import {
  addDateKeyDays,
  dateKeyDaysBetween,
  formatTimeRange,
  getLocalDateKey,
  getWeekdayLabels,
  normalizeVisibleHourRange,
  parseDateKeyToUtc,
  snapMinutes,
} from "../data/CalendarDateTime";
import {
  resolveDayMoveChange,
  resolveDayRangeResize,
  resolveTimedDragRange,
  resolveUnitDragOffset,
} from "../data/CalendarInteractionModel";
import { resolveEventAbsoluteScale } from "../data/CalendarTimelineModel";

describe("calendar shared date/time core", () => {
  it("parses strict date keys and rejects impossible dates", () => {
    expect(parseDateKeyToUtc("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(parseDateKeyToUtc("2026-02-30")).toBeNull();
    expect(parseDateKeyToUtc("2026-2-3")).toBeNull();
  });

  it("adds days and calculates differences across month and year boundaries", () => {
    expect(addDateKeyDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDateKeyDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(dateKeyDaysBetween("2025-12-31", "2026-01-02")).toBe(2);
    expect(dateKeyDaysBetween("invalid", "2026-01-02")).toBeNull();
  });

  it("formats local dates and snapped time ranges consistently", () => {
    expect(getLocalDateKey(new Date(2026, 5, 16, 9, 30))).toBe("2026-06-16");
    expect(snapMinutes(67)).toBe(60);
    expect(snapMinutes(68)).toBe(75);
    expect(formatTimeRange(9 * 60, 10 * 60 + 15)).toBe("09:00 - 10:15");
  });

  it("normalizes visible hour ranges with a minimum one-hour window", () => {
    expect(normalizeVisibleHourRange(8, 18)).toEqual({ startHour: 8, endHour: 18, startMinutes: 480, endMinutes: 1080 });
    expect(normalizeVisibleHourRange(23, 5)).toEqual({ startHour: 23, endHour: 24, startMinutes: 1380, endMinutes: 1440 });
  });

  it("builds weekday labels from an explicit locale and week start", () => {
    expect(getWeekdayLabels("en-US", 1)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("calendar shared interaction core", () => {
  it("keeps the opposite edge fixed while resizing timed ranges", () => {
    const startResize = resolveTimedDragRange({
      mode: "resize-start",
      originalStart: 9 * 60,
      originalEnd: 11 * 60,
      visibleStart: 8 * 60,
      visibleEnd: 18 * 60,
      deltaMinutes: 60,
    });
    const endResize = resolveTimedDragRange({
      mode: "resize-end",
      originalStart: 9 * 60,
      originalEnd: 11 * 60,
      visibleStart: 8 * 60,
      visibleEnd: 18 * 60,
      deltaMinutes: -30,
    });

    expect(startResize).toMatchObject({ start: 10 * 60, end: 11 * 60, label: "10:00 - 11:00" });
    expect(endResize).toMatchObject({ start: 9 * 60, end: 10 * 60 + 30, label: "09:00 - 10:30" });
  });

  it("moves timed ranges by translating start+end together (整体平移, 不夹到 visible)", () => {
    // 同天事件拖动：start/end 同 delta、保持时长，不夹到可见时段（可拖出 visible 跨天）。
    const moved = resolveTimedDragRange({
      mode: "move",
      originalStart: 9 * 60,
      originalEnd: 11 * 60,
      visibleStart: 8 * 60,
      visibleEnd: 18 * 60,
      deltaMinutes: 8 * 60,
    });
    expect(moved).toMatchObject({ start: 17 * 60, end: 19 * 60, duration: 120 });

    // 跨天事件（duration > 可见时段）拖动：start 不被夹到 visibleStart，保持原始起始 + delta。
    // 这是修复「跨天事件拖拽被改写起始日 / 丢时间变全天条」的关键回归用例。
    const crossDay = resolveTimedDragRange({
      mode: "move",
      originalStart: 0,
      originalEnd: 30 * 60,
      visibleStart: 8 * 60,
      visibleEnd: 18 * 60,
      deltaMinutes: 60,
    });
    expect(crossDay).toMatchObject({ start: 60, end: 31 * 60, duration: 30 * 60 });
  });

  it("does not apply resize endMaxMinutes to timed move duration", () => {
    const moved = resolveTimedDragRange({
      mode: "move",
      originalStart: 0,
      originalEnd: 88 * 24 * 60,
      visibleStart: 0,
      visibleEnd: 24 * 60,
      deltaMinutes: 60,
      endMaxMinutes: 8 * 24 * 60,
    });

    expect(moved.start).toBe(60);
    expect(moved.end).toBe(88 * 24 * 60 + 60);
    expect(moved.duration).toBe(88 * 24 * 60);
  });

  it("resizes day ranges by fixing the opposite date edge", () => {
    expect(resolveDayRangeResize("2026-06-10", "2026-06-12", "2026-06-08", "resize-start")).toEqual({
      startDateKey: "2026-06-08",
      endDateKey: "2026-06-12",
    });
    expect(resolveDayRangeResize("2026-06-10", "2026-06-12", "2026-06-15", "resize-start")).toEqual({
      startDateKey: "2026-06-12",
      endDateKey: "2026-06-12",
    });
    expect(resolveDayRangeResize("2026-06-10", "2026-06-12", "2026-06-09", "resize-end")).toEqual({
      startDateKey: "2026-06-10",
      endDateKey: "2026-06-10",
    });
  });

  it("builds day-move changes that preserve datetime clock parts", () => {
    const change = resolveDayMoveChange({
      startField: "start",
      startDateKey: "2026-06-19",
      endField: "end",
      endDateKey: "2026-06-20",
      startMinutes: 9 * 60 + 30,
      endMinutes: 17 * 60 + 45,
    });

    expect(change).toEqual({
      startField: "start",
      startDateKey: "2026-06-19",
      startTimeMinutes: 570,
      endField: "end",
      endDateKey: "2026-06-20",
      endTimeMinutes: 1065,
      changedEdge: "both",
    });
  });

  it("builds pure date day-move changes without time parts", () => {
    const change = resolveDayMoveChange({
      startField: "start",
      startDateKey: "2026-06-19",
      endField: "end",
      endDateKey: "2026-06-20",
    });

    expect(change.startTimeMinutes).toBeUndefined();
    expect(change.endTimeMinutes).toBeUndefined();
    expect(change.changedEdge).toBe("both");
  });

  it("lets resize-end cross midnight when endMaxMinutes exceeds visibleEnd", () => {
    // 默认不传 endMaxMinutes：end 仍 clamp 到 visibleEnd（日历 resize 不跨天，行为不变）。
    const clamped = resolveTimedDragRange({
      mode: "resize-end",
      originalStart: 22 * 60,
      originalEnd: 23 * 60,
      visibleStart: 0,
      visibleEnd: 24 * 60,
      deltaMinutes: 4 * 60,
    });
    expect(clamped.end).toBe(24 * 60);
    // 传 endMaxMinutes = visibleEnd + 1 天：end 可越过 24:00 跨天（23:00 → 次日 03:00）。
    const crossed = resolveTimedDragRange({
      mode: "resize-end",
      originalStart: 22 * 60,
      originalEnd: 23 * 60,
      visibleStart: 0,
      visibleEnd: 24 * 60,
      deltaMinutes: 4 * 60,
      endMaxMinutes: 48 * 60,
    });
    expect(crossed.end).toBe(27 * 60);
  });

  it("does not clamp an existing long resize-end target to the visible seven-day cap", () => {
    const originalEnd = 31 * 24 * 60;
    const range = resolveTimedDragRange({
      mode: "resize-end",
      originalStart: 0,
      originalEnd,
      visibleStart: 0,
      visibleEnd: 17 * 60,
      deltaMinutes: 0,
      endMaxMinutes: 17 * 60 + 7 * 24 * 60,
    });

    expect(range.end).toBe(originalEnd);
  });
});

describe("resolveUnitDragOffset (timeline move 按天 unit 夹取)", () => {
  it("正常平移不夹取", () => {
    expect(resolveUnitDragOffset({ deltaUnits: 3, originalOffset: 2, span: 2, totalUnits: 30 }))
      .toEqual({ offsetUnits: 5, clamped: false });
  });
  it("左界夹取（raw < 0）", () => {
    expect(resolveUnitDragOffset({ deltaUnits: -5, originalOffset: 2, span: 2, totalUnits: 30 }))
      .toEqual({ offsetUnits: 0, clamped: true });
  });
  it("右界夹取（raw > totalUnits - span）", () => {
    expect(resolveUnitDragOffset({ deltaUnits: 40, originalOffset: 2, span: 2, totalUnits: 30 }))
      .toEqual({ offsetUnits: 28, clamped: true });
  });
  it("span == totalUnits 时恒为 0", () => {
    expect(resolveUnitDragOffset({ deltaUnits: 5, originalOffset: 0, span: 30, totalUnits: 30 }))
      .toEqual({ offsetUnits: 0, clamped: true });
  });
  it("span > totalUnits 时恒为 0", () => {
    expect(resolveUnitDragOffset({ deltaUnits: 3, originalOffset: 0, span: 40, totalUnits: 30 }))
      .toEqual({ offsetUnits: 0, clamped: true });
  });
  it("负 delta 落在窗口内不夹取", () => {
    expect(resolveUnitDragOffset({ deltaUnits: -1, originalOffset: 5, span: 2, totalUnits: 30 }))
      .toEqual({ offsetUnits: 4, clamped: false });
  });
});

describe("resolveEventAbsoluteScale (统一两端绝对刻度，相对 windowStartKey 分钟)", () => {
  const ev = (startKey: string, endKey: string, startMin?: number, endMin?: number) => ({
    startDateKey: startKey, endDateKey: endKey, startMinutes: startMin, endMinutes: endMin,
  }) as any;
  it("有 time 同天：真实区间", () => {
    expect(resolveEventAbsoluteScale(ev("2026-06-06", "2026-06-06", 15, 960), "2026-06-06"))
      .toEqual({ start: 15, end: 960 });
  });
  it("有 time 跨天：end 用 endDateKey 偏移", () => {
    expect(resolveEventAbsoluteScale(ev("2026-06-06", "2026-06-08", 1380, 960), "2026-06-06"))
      .toEqual({ start: 1380, end: 2 * 1440 + 960 });
  });
  it("有 time 但缺 endMinutes：end 默认 start+60", () => {
    expect(resolveEventAbsoluteScale(ev("2026-06-06", "2026-06-06", 600, undefined), "2026-06-06"))
      .toEqual({ start: 600, end: 660 });
  });
  it("无 time 单天：当日0:00 → 次日0:00（24h）", () => {
    expect(resolveEventAbsoluteScale(ev("2026-06-06", "2026-06-06"), "2026-06-06"))
      .toEqual({ start: 0, end: 1440 });
  });
  it("无 time 跨天：startDateKey0:00 → endDateKey次日0:00", () => {
    expect(resolveEventAbsoluteScale(ev("2026-06-06", "2026-06-08"), "2026-06-06"))
      .toEqual({ start: 0, end: 3 * 1440 });
  });
  it("无 time 且 start 在窗口前（6/8 窗口看 6/6 事件）", () => {
    expect(resolveEventAbsoluteScale(ev("2026-06-06", "2026-06-06"), "2026-06-08"))
      .toEqual({ start: -2 * 1440, end: -1 * 1440 });
  });
  it("date 结束端含末天 +1 天（endIsDateOnly=true），即便 mixed 下被 coerce 成 minutes=0", () => {
    // Q2：start=datetime 06-04 00:00、end=date 06-05（含末天）→ 2 天跨度（与拖拽的 durationDays 一致）。
    expect(resolveEventAbsoluteScale({ startDateKey: "2026-06-04", endDateKey: "2026-06-05", startMinutes: 0, endMinutes: 0, endIsDateOnly: true } as any, "2026-06-04"))
      .toEqual({ start: 0, end: 2 * 1440 });
    // datetime 结束端（endIsDateOnly=false）按精确时刻，不加 1 天。
    expect(resolveEventAbsoluteScale({ startDateKey: "2026-06-04", endDateKey: "2026-06-05", startMinutes: 0, endMinutes: 480, endIsDateOnly: false } as any, "2026-06-04"))
      .toEqual({ start: 0, end: 1440 + 480 });
  });
});
