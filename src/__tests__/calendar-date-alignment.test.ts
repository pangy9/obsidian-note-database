import { describe, it, expect } from "vitest";
import {
  buildCalendarMonthModel,
  CalendarTimelineEvent,
  isInvalidEventRange,
} from "../data/CalendarTimelineModel";
import { getCalendarEventTiming } from "../data/CalendarLayoutModel";
import { resolveAllDayResizeChange } from "../data/CalendarInteractionModel";
import { ColumnDef, ViewConfig, RowData } from "../data/types";
import { TFile } from "obsidian";

// Mock TFile
const mockFile = (path: string): TFile => ({
  path,
  basename: path.replace(/\.md$/, ""),
  name: path,
  extension: "md",
  stat: { ctime: Date.now(), mtime: Date.now(), size: 0 },
  parent: null,
} as unknown as TFile);

const createMockRow = (path: string, frontmatter: Record<string, unknown>): RowData => ({
  file: mockFile(path),
  frontmatter,
  computed: {},
});

const createBaseConfig = (columns: ColumnDef[]): ViewConfig => ({
  id: "test-view",
  name: "Test View",
  sourceFolder: "",
  schema: {
    columns,
    computedFields: [],
  },
  calendarStartDateField: "start_date",
  calendarEndDateField: "end_date",
});

describe("Calendar date/datetime alignment with timeline", () => {
  describe("A1: Filter invalid events", () => {
    it("should hide invalid events (start > end) from calendar month model", () => {
      const columns: ColumnDef[] = [
        { key: "start_date", label: "Start", type: "datetime" },
        { key: "end_date", label: "End", type: "datetime" },
      ];
      const config = createBaseConfig(columns);

      const rows = [
        // 有效事件：2026-06-10T09:00 → 2026-06-10T17:00
        createMockRow("valid.md", {
          start_date: "2026-06-10T09:00",
          end_date: "2026-06-10T17:00",
        }),
        // 无效事件：结束早于开始（同天，end < start）
        createMockRow("invalid-same-day.md", {
          start_date: "2026-06-11T15:00",
          end_date: "2026-06-11T10:00",
        }),
        // 无效事件：结束日期早于开始日期
        createMockRow("invalid-reverse.md", {
          start_date: "2026-06-15T09:00",
          end_date: "2026-06-14T17:00",
        }),
      ];

      const model = buildCalendarMonthModel(rows, config, { year: 2026, monthIndex: 5 });

      // 检查 2026-06-10：应该只有 valid.md
      const day10 = model.days.find((d) => d.dateKey === "2026-06-10");
      expect(day10?.events).toHaveLength(1);
      expect(day10?.events[0].filePath).toBe("valid.md");

      // 检查 2026-06-11：应该没有 invalid-same-day.md
      const day11 = model.days.find((d) => d.dateKey === "2026-06-11");
      expect(day11?.events.every((e) => e.filePath !== "invalid-same-day.md")).toBe(true);

      // 检查 2026-06-14 和 2026-06-15：应该都没有 invalid-reverse.md
      const day14 = model.days.find((d) => d.dateKey === "2026-06-14");
      const day15 = model.days.find((d) => d.dateKey === "2026-06-15");
      expect(day14?.events.every((e) => e.filePath !== "invalid-reverse.md")).toBe(true);
      expect(day15?.events.every((e) => e.filePath !== "invalid-reverse.md")).toBe(true);
    });

    it("isInvalidEventRange should correctly identify invalid ranges", () => {
      // 有效：跨天事件
      expect(
        isInvalidEventRange({
          startDateKey: "2026-06-10",
          endDateKey: "2026-06-12",
          startMinutes: 540,
          endMinutes: 600,
        })
      ).toBe(false);

      // 有效：同天，end > start
      expect(
        isInvalidEventRange({
          startDateKey: "2026-06-10",
          endDateKey: "2026-06-10",
          startMinutes: 540,
          endMinutes: 1020,
        })
      ).toBe(false);

      // 无效：同天，end <= start
      expect(
        isInvalidEventRange({
          startDateKey: "2026-06-10",
          endDateKey: "2026-06-10",
          startMinutes: 1020,
          endMinutes: 540,
        })
      ).toBe(true);

      // 无效：结束日期早于开始日期
      expect(
        isInvalidEventRange({
          startDateKey: "2026-06-15",
          endDateKey: "2026-06-14",
          startMinutes: 540,
          endMinutes: 1020,
        })
      ).toBe(true);

      // 有效：纯 date 同天（无时间分量）
      expect(
        isInvalidEventRange({
          startDateKey: "2026-06-10",
          endDateKey: "2026-06-10",
          startMinutes: undefined,
          endMinutes: undefined,
        })
      ).toBe(false);
    });
  });

  describe("E1: End date inclusivity aligned with timeline", () => {
    it("should not include datetime midnight end date (2026-06-14T09:00 → 2026-06-15T00:00)", () => {
      const columns: ColumnDef[] = [
        { key: "start_date", label: "Start", type: "datetime" },
        { key: "end_date", label: "End", type: "datetime" },
      ];
      const config = createBaseConfig(columns);

      const rows = [
        // datetime 事件：06-14 09:00 → 06-15 00:00（午夜结束）
        createMockRow("midnight-end.md", {
          start_date: "2026-06-14T09:00",
          end_date: "2026-06-15T00:00",
        }),
      ];

      const model = buildCalendarMonthModel(rows, config, { year: 2026, monthIndex: 5 });

      // 检查 2026-06-14：应该包含事件
      const day14 = model.days.find((d) => d.dateKey === "2026-06-14");
      expect(day14?.events.some((e) => e.filePath === "midnight-end.md")).toBe(true);

      // 检查 2026-06-15：不应该包含事件（午夜结束 = 不含 06-15）
      const day15 = model.days.find((d) => d.dateKey === "2026-06-15");
      expect(day15?.events.some((e) => e.filePath === "midnight-end.md")).toBe(false);
    });

    it("should include date-only end date (2026-06-14 → 2026-06-16, date columns)", () => {
      const columns: ColumnDef[] = [
        { key: "start_date", label: "Start", type: "date" },
        { key: "end_date", label: "End", type: "date" },
      ];
      const config = createBaseConfig(columns);

      const rows = [
        // date 列事件：06-14 → 06-16（含末天）
        createMockRow("date-range.md", {
          start_date: "2026-06-14",
          end_date: "2026-06-16",
        }),
      ];

      const model = buildCalendarMonthModel(rows, config, { year: 2026, monthIndex: 5 });

      // 检查 2026-06-14、06-15、06-16：都应该包含事件
      const day14 = model.days.find((d) => d.dateKey === "2026-06-14");
      const day15 = model.days.find((d) => d.dateKey === "2026-06-15");
      const day16 = model.days.find((d) => d.dateKey === "2026-06-16");

      expect(day14?.events.some((e) => e.filePath === "date-range.md")).toBe(true);
      expect(day15?.events.some((e) => e.filePath === "date-range.md")).toBe(true);
      expect(day16?.events.some((e) => e.filePath === "date-range.md")).toBe(true);

      // 检查 2026-06-17：不应该包含事件
      const day17 = model.days.find((d) => d.dateKey === "2026-06-17");
      expect(day17?.events.some((e) => e.filePath === "date-range.md")).toBe(false);
    });

    it("should include datetime end date with non-zero time (2026-06-15T10:00)", () => {
      const columns: ColumnDef[] = [
        { key: "start_date", label: "Start", type: "datetime" },
        { key: "end_date", label: "End", type: "datetime" },
      ];
      const config = createBaseConfig(columns);

      const rows = [
        // datetime 事件：06-14 09:00 → 06-15 10:00
        createMockRow("time-end.md", {
          start_date: "2026-06-14T09:00",
          end_date: "2026-06-15T10:00",
        }),
      ];

      const model = buildCalendarMonthModel(rows, config, { year: 2026, monthIndex: 5 });

      // 检查 2026-06-14 和 06-15：都应该包含事件
      const day14 = model.days.find((d) => d.dateKey === "2026-06-14");
      const day15 = model.days.find((d) => d.dateKey === "2026-06-15");

      expect(day14?.events.some((e) => e.filePath === "time-end.md")).toBe(true);
      expect(day15?.events.some((e) => e.filePath === "time-end.md")).toBe(true);
    });
  });

  describe("B1/B3: Timed event requires both datetime fields", () => {
    it("should not allow mixed date/datetime same-day event into time grid", () => {
      const columns: ColumnDef[] = [
        { key: "start_date", label: "Start", type: "date" },
        { key: "end_date", label: "End", type: "datetime" },
      ];
      const config = createBaseConfig(columns);

      const mockEvent: CalendarTimelineEvent = {
        id: "mixed.md",
        title: "Mixed",
        filePath: "mixed.md",
        row: createMockRow("mixed.md", {
          start_date: "2026-06-14",
          end_date: "2026-06-14T10:00",
        }),
        startDateKey: "2026-06-14",
        endDateKey: "2026-06-14",
        offsetUnits: 0,
        durationUnits: 1,
        durationDays: 1,
        windowPosition: "visible",
        order: 0,
      };

      const timing = getCalendarEventTiming(mockEvent, config);

      // mixed date/datetime 不应该进入时间网格
      expect(timing.isTimed).toBe(false);
    });

    it("should not allow date column with dirty time value into time grid", () => {
      const columns: ColumnDef[] = [
        { key: "start_date", label: "Start", type: "date" },
        { key: "end_date", label: "End", type: "date" },
      ];
      const config = createBaseConfig(columns);

      const mockEvent: CalendarTimelineEvent = {
        id: "dirty.md",
        title: "Dirty",
        filePath: "dirty.md",
        row: createMockRow("dirty.md", {
          start_date: "2026-06-14T09:30", // date 列中的脏时间值
          end_date: "2026-06-14T17:00",
        }),
        startDateKey: "2026-06-14",
        endDateKey: "2026-06-14",
        offsetUnits: 0,
        durationUnits: 1,
        durationDays: 1,
        windowPosition: "visible",
        order: 0,
      };

      const timing = getCalendarEventTiming(mockEvent, config);

      // date 列即使有时间值也不应该进入时间网格
      expect(timing.isTimed).toBe(false);
    });

    it("should allow both datetime fields same-day event into time grid", () => {
      const columns: ColumnDef[] = [
        { key: "start_date", label: "Start", type: "datetime" },
        { key: "end_date", label: "End", type: "datetime" },
      ];
      const config = createBaseConfig(columns);

      const mockEvent: CalendarTimelineEvent = {
        id: "valid.md",
        title: "Valid",
        filePath: "valid.md",
        row: createMockRow("valid.md", {
          start_date: "2026-06-14T09:00",
          end_date: "2026-06-14T17:00",
        }),
        startDateKey: "2026-06-14",
        endDateKey: "2026-06-14",
        offsetUnits: 0,
        durationUnits: 1,
        durationDays: 1,
        windowPosition: "visible",
        order: 0,
      };

      const timing = getCalendarEventTiming(mockEvent, config);

      // 两端都是 datetime 应该进入时间网格
      expect(timing.isTimed).toBe(true);
      expect(timing.startMinutes).toBeDefined();
      expect(timing.endMinutes).toBeDefined();
    });

    it("should not allow multi-day event into time grid", () => {
      const columns: ColumnDef[] = [
        { key: "start_date", label: "Start", type: "datetime" },
        { key: "end_date", label: "End", type: "datetime" },
      ];
      const config = createBaseConfig(columns);

      const mockEvent: CalendarTimelineEvent = {
        id: "multiday.md",
        title: "Multi-day",
        filePath: "multiday.md",
        row: createMockRow("multiday.md", {
          start_date: "2026-06-14T09:00",
          end_date: "2026-06-15T17:00",
        }),
        startDateKey: "2026-06-14",
        endDateKey: "2026-06-15",
        offsetUnits: 0,
        durationUnits: 2,
        durationDays: 2,
        windowPosition: "visible",
        order: 0,
      };

      const timing = getCalendarEventTiming(mockEvent, config);

      // 跨天事件不应该进入时间网格
      expect(timing.isTimed).toBe(false);
    });
  });

  describe("E2: all-day resize preserves datetime time component", () => {
    it("resize-end should preserve end time (06-16T15:00 dragged to 06-17)", () => {
      // datetime 跨天事件 06-14T09:00 → 06-16T15:00，拖右端延长到 06-17
      const change = resolveAllDayResizeChange({
        mode: "resize-end",
        newStartDateKey: "2026-06-14",
        newEndDateKey: "2026-06-17",
        startField: "start",
        endField: "end",
        startMinutes: 540, // 09:00
        endMinutes: 900, // 15:00
      });

      // resize-end 写结束端：必须带 endTimeMinutes，否则结束变成纯日期丢失 15:00
      expect(change.changedEdge).toBe("end");
      expect(change.endDateKey).toBe("2026-06-17");
      expect(change.endTimeMinutes).toBe(900);
      // 开始端 changedEdge=end 不会被写，不需要 startTimeMinutes
      expect(change.startTimeMinutes).toBeUndefined();
    });

    it("resize-start should preserve start time (06-14 dragged to 06-15)", () => {
      // datetime 跨天事件 06-14T09:00 → 06-16T15:00，拖左端缩短到 06-15
      const change = resolveAllDayResizeChange({
        mode: "resize-start",
        newStartDateKey: "2026-06-15",
        newEndDateKey: "2026-06-16",
        startField: "start",
        endField: "end",
        startMinutes: 540, // 09:00
        endMinutes: 900, // 15:00
      });

      // resize-start 写开始端：必须带 startTimeMinutes，否则开始变成纯日期丢失 09:00
      expect(change.changedEdge).toBe("start");
      expect(change.startDateKey).toBe("2026-06-15");
      expect(change.startTimeMinutes).toBe(540);
      // 结束端 changedEdge=start 不会被写，不需要 endTimeMinutes
      expect(change.endTimeMinutes).toBeUndefined();
    });

    it("date-only event resize should not carry time component", () => {
      // date 列事件没有时间分量，resize 不应设置 startTimeMinutes/endTimeMinutes
      const change = resolveAllDayResizeChange({
        mode: "resize-end",
        newStartDateKey: "2026-06-14",
        newEndDateKey: "2026-06-17",
        startField: "start",
        endField: "end",
        startMinutes: undefined,
        endMinutes: undefined,
      });

      expect(change.changedEdge).toBe("end");
      expect(change.startTimeMinutes).toBeUndefined();
      expect(change.endTimeMinutes).toBeUndefined();
    });

    it("resize-end without end field should not set endTimeMinutes", () => {
      // 没有结束字段时，resize-end 不应设置 endTimeMinutes
      const change = resolveAllDayResizeChange({
        mode: "resize-end",
        newStartDateKey: "2026-06-14",
        newEndDateKey: "2026-06-17",
        startField: "start",
        endField: undefined,
        startMinutes: 540,
        endMinutes: 900,
      });

      expect(change.endTimeMinutes).toBeUndefined();
    });
  });
});
