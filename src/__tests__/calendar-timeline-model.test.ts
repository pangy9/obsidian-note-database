import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCalendarMonthWeekLayouts, buildCalendarTimedEventLayouts, buildCalendarWeekAllDayLayout } from "../data/CalendarLayoutModel";
import { buildCalendarMonthModel, buildTimelineModel, buildTimelineTicks, extractTimelineEndpointMinutes, getCalendarAnchorMonth, getDefaultEventDateField, getTimelineAnchor, getTimelineColumnWidthSpec, getTimelineDayNonDateTimeColumns, getTimelineNavigationShiftUnits, getTimelineShortNavigationShiftUnits, getTimelineTitleWindow, getTimelineViewportContentWidth, getTimelineViewportStartAnchor, getTimelineViewportWindow, getTimelineWindow, normalizeTimelineDayScale, resolveTimelineUnitWidth, resolveTimelineJumpAnchor, resolveTimelineViewportUnitCount, resolveTimelineViewportUnitSpan, shiftCalendarMonth, shiftTimelineAnchor } from "../data/CalendarTimelineModel";
import { ColumnDef, RowData, ViewConfig } from "../data/types";

function col(key: string, label: string, type: ColumnDef["type"], statusOptions?: ColumnDef["statusOptions"]): ColumnDef {
  return { key, label, type, statusOptions };
}

function config(overrides: Partial<ViewConfig> = {}): ViewConfig {
  const columns = [
    col("file.name", "Name", "text"),
    col("start", "Start", "date"),
    col("end", "End", "date"),
    col("status", "Status", "status", [
      { value: "Active", color: "green" },
      { value: "Done", color: "blue" },
      { value: "Later", color: "orange" },
    ]),
    { ...col("formula.followup", "Follow-up", "computed"), computedKey: "followup" },
  ];
  return {
    name: "Calendar",
    sourceFolder: "",
    viewType: "calendar",
    schema: {
      columns,
      computedFields: [{ key: "followup", label: "Follow-up", expression: "", type: "date" }],
    },
    calendarStartDateField: "start",
    calendarEndDateField: "end",
    timelineStartDateField: "start",
    timelineEndDateField: "end",
    timelineGroupField: "status",
    timelineScale: "month",
    timelineAnchor: "2026-06-10",
    ...overrides,
  };
}

function row(path: string, frontmatter: Record<string, unknown>, computed: Record<string, unknown> = {}): RowData {
  return {
    file: {
      path,
      name: path.split("/").pop() || path,
      basename: (path.split("/").pop() || path).replace(/\.md$/i, ""),
      extension: "md",
      parent: { path: path.includes("/") ? path.split("/").slice(0, -1).join("/") : "" },
      stat: { ctime: 0, mtime: 0, size: 0 },
    } as RowData["file"],
    frontmatter,
    computed,
  };
}

describe("CalendarTimelineModel", () => {
  it("selects the first usable date field, including computed date fields", () => {
    expect(getDefaultEventDateField(config({ calendarStartDateField: undefined }))).toBe("start");
    expect(getDefaultEventDateField(config({
      calendarStartDateField: undefined,
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          { ...col("formula.followup", "Follow-up", "computed"), computedKey: "followup" },
        ],
        computedFields: [{ key: "followup", label: "Follow-up", expression: "", type: "date" }],
      },
    }))).toBe("formula.followup");
  });

  it("identifies non-datetime start/end fields that block timeline day scale", () => {
    const base = config({
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "date"),
          { ...col("formula.followup", "Follow-up", "computed"), computedKey: "followup" },
        ],
        computedFields: [{ key: "followup", label: "Follow-up", expression: "", type: "date" }],
      },
      timelineStartDateField: "start",
      timelineEndDateField: "end",
    });

    expect(getTimelineDayNonDateTimeColumns(base).map((column) => column.key)).toEqual(["end"]);
    expect(getTimelineDayNonDateTimeColumns({
      ...base,
      timelineStartDateField: "formula.followup",
      timelineEndDateField: "end",
    }).map((column) => column.key)).toEqual(["formula.followup", "end"]);
    expect(getTimelineDayNonDateTimeColumns({
      ...base,
      schema: { ...base.schema, columns: base.schema.columns.map((column) => column.key === "end" ? { ...column, type: "datetime" } : column) },
      timelineStartDateField: "start",
      timelineEndDateField: "end",
    })).toEqual([]);
  });

  it("normalizes invalid day-scale timeline configs back to week scale", () => {
    const invalidDayConfig = config({
      viewType: "timeline",
      timelineScale: "day",
      timelineAnchorTimeMinutes: 8 * 60,
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "date"),
        ],
        computedFields: [],
      },
      timelineStartDateField: "start",
      timelineEndDateField: "end",
    });

    expect(normalizeTimelineDayScale(invalidDayConfig)).toBe(true);
    expect(invalidDayConfig.timelineScale).toBe("week");
    expect(invalidDayConfig.timelineAnchorTimeMinutes).toBeUndefined();

    expect(normalizeTimelineDayScale({
      ...invalidDayConfig,
      timelineScale: "day",
      schema: {
        ...invalidDayConfig.schema,
        columns: invalidDayConfig.schema.columns.map((column) => column.key === "end" ? { ...column, type: "datetime" } : column),
      },
      timelineAnchorTimeMinutes: 8 * 60,
    })).toBe(false);
  });

  it("places single-day and multi-day events into a month grid", () => {
    const rows = [
      row("Projects/kickoff.md", { start: "2026-06-10", end: "2026-06-12", status: "Active" }),
      row("Projects/review.md", { start: "2026-06-30", status: "Done" }),
      row("Projects/invalid.md", { start: "not a date", status: "Later" }),
    ];

    const model = buildCalendarMonthModel(rows, config(), { year: 2026, monthIndex: 5 });
    const eventDays = model.days
      .filter((day) => day.events.length > 0)
      .map((day) => [day.dateKey, day.events.map((event) => event.title)]);

    expect(model.weeks).toHaveLength(5);
    expect(eventDays).toEqual([
      ["2026-06-10", ["kickoff"]],
      ["2026-06-11", ["kickoff"]],
      ["2026-06-12", ["kickoff"]],
      ["2026-06-30", ["review"]],
    ]);
  });

  it("sets durationDays to the real day span for month events (move drag math)", () => {
    const rows = [
      row("Projects/long.md", { start: "2026-06-10", end: "2026-06-14", status: "Active" }),
    ];
    const model = buildCalendarMonthModel(rows, config(), { year: 2026, monthIndex: 5 });
    const event = model.days.flatMap((d) => d.events).find((e) => e.filePath === "Projects/long.md");
    // durationDays 必须是真实跨度（5），否则 move 拖拽的 endDateKey 计算会把跨天事件塌缩成单天。
    expect(event?.durationDays).toBe(5);
  });

  it("keeps calendar event order from the sorted row pipeline", () => {
    const rows = [
      row("Projects/beta.md", { start: "2026-06-10", end: "2026-06-10" }),
      row("Projects/alpha.md", { start: "2026-06-10", end: "2026-06-10" }),
    ];

    const model = buildCalendarMonthModel(rows, config(), { year: 2026, monthIndex: 5 });
    const day = model.days.find((item) => item.dateKey === "2026-06-10");

    expect(day?.events.map((event) => event.title)).toEqual(["beta", "alpha"]);
  });

  it("resolves calendar event colors from a configured option field", () => {
    const rows = [
      row("Projects/kickoff.md", { start: "2026-06-10", status: "Active" }),
      row("Projects/review.md", { start: "2026-06-11", status: ["Done", "Later"] }),
    ];

    const model = buildCalendarMonthModel(rows, config({ calendarColorField: "status" }), { year: 2026, monthIndex: 5 });
    const colors = model.days
      .flatMap((day) => day.events)
      .map((event) => [event.title, event.color]);

    expect(colors).toEqual([
      ["kickoff", "green"],
      ["review", "blue"],
    ]);
  });

  it("can align calendar grids to a locale week start", () => {
    const model = buildCalendarMonthModel([], config(), { year: 2026, monthIndex: 5 }, { weekStartsOn: 1 });

    expect(model.days[0].dateKey).toBe("2026-06-01");
    expect(model.days[6].dateKey).toBe("2026-06-07");
    expect(model.days[model.days.length - 1].dateKey).toBe("2026-07-05");
    expect(model.weeks).toHaveLength(5);
  });

  it("uses a configured calendar month and can shift it by month", () => {
    const rows = [
      row("Projects/kickoff.md", { start: "2026-06-10", status: "Active" }),
    ];

    expect(getCalendarAnchorMonth(rows, config({ calendarMonth: "2026-08" }), "start")).toEqual({ year: 2026, monthIndex: 7 });
    expect(getCalendarAnchorMonth(rows, config({ calendarMonth: "bad-value" }), "start")).toEqual({ year: 2026, monthIndex: 5 });
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
  });

  it("hides backwards date ranges (start after end) as invalid instead of clamping", () => {
    const rows = [
      row("Projects/a.md", { start: "2026-06-20", end: "2026-06-18", status: "Active" }),
      row("Projects/b.md", { start: "2026-06-10", end: "2026-06-12", status: "Active" }),
      row("Projects/c.md", { start: "2026-06-11" }),
      row("Projects/d.md", { start: "" }),
    ];

    const model = buildTimelineModel(rows, config());

    // 反向 date 区间（a: 06-20 → 06-18，开始日期晚于结束日期）现在判为无效：隐藏、不进 lane、不计行，
    // 并计入 invalidEventCount 供修复弹窗提示（旧实现会把它折叠成同天 06-20-06-20 渲染出来）。
    expect(model.invalidEventCount).toBe(1);
    expect(model.lanes.map((lane) => [lane.key, lane.events.map((event) => `${event.title}:${event.startDateKey}-${event.endDateKey}`)])).toEqual([
      ["Active", ["b:2026-06-10-2026-06-12"]],
      ["Done", []],
      ["Later", []],
      ["__uncategorized__", ["c:2026-06-11-2026-06-11"]],
    ]);
  });

  it("treats Date objects in date columns as all-day values without local-time leakage", () => {
    const rows = [
      row("Projects/date-object.md", {
        start: new Date(Date.UTC(2026, 10, 25, 0, 0)),
        end: new Date(Date.UTC(2026, 10, 25, 0, 0)),
        status: "Active",
      }),
    ];

    const model = buildTimelineModel(rows, config({ viewType: "timeline", timelineScale: "day", timelineAnchor: "2026-11-25" }));
    const event = model.lanes.flatMap((lane) => lane.events)[0];

    expect(model.invalidEventCount).toBe(0);
    expect(event).toMatchObject({
      startDateKey: "2026-11-25",
      endDateKey: "2026-11-25",
      startMinutes: undefined,
      endMinutes: undefined,
    });
  });

  it("reads Date objects in datetime columns using UTC date and time fields", () => {
    const datetimeConfig = config({
      viewType: "timeline",
      timelineScale: "day",
      timelineAnchor: "2026-11-25",
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "datetime"),
          col("status", "Status", "status", [{ value: "Active", color: "green" }]),
        ],
        computedFields: [],
      },
    });
    const rows = [
      row("Projects/datetime-object.md", {
        start: new Date(Date.UTC(2026, 10, 25, 0, 0)),
        end: new Date(Date.UTC(2026, 10, 25, 1, 30)),
        status: "Active",
      }),
    ];

    const model = buildTimelineModel(rows, datetimeConfig);
    const event = model.lanes.flatMap((lane) => lane.events)[0];

    expect(model.invalidEventCount).toBe(0);
    expect(event).toMatchObject({
      startDateKey: "2026-11-25",
      endDateKey: "2026-11-25",
      startMinutes: 0,
      endMinutes: 90,
    });
  });

  it("treats date-only strings in datetime columns as midnight so zero-width intervals are invalid", () => {
    const datetimeConfig = config({
      viewType: "timeline",
      timelineScale: "day",
      timelineAnchor: "2026-06-13",
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "datetime"),
          col("status", "Status", "status", [{ value: "Active", color: "green" }]),
        ],
        computedFields: [],
      },
    });
    const model = buildTimelineModel([
      row("Projects/zero.md", { start: "2026-06-13", end: "2026-06-13T00:00", status: "Active" }),
    ], datetimeConfig);

    expect(model.invalidEventCount).toBe(1);
    expect(model.lanes.flatMap((lane) => lane.events)).toHaveLength(0);
  });

  it("treats mixed date and datetime endpoints at midnight as invalid zero-width intervals", () => {
    const mixedConfig = config({
      viewType: "timeline",
      timelineScale: "month",
      timelineAnchor: "2026-06-13",
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "date"),
          col("end", "End", "datetime"),
          col("status", "Status", "status", [{ value: "Active", color: "green" }]),
        ],
        computedFields: [],
      },
    });
    const model = buildTimelineModel([
      row("Projects/mixed-zero.md", { start: "2026-06-13", end: "2026-06-13T00:00", status: "Active" }),
    ], mixedConfig);

    expect(model.invalidEventCount).toBe(1);
    expect(model.lanes.flatMap((lane) => lane.events)).toHaveLength(0);
  });

  it("keeps same-day pure date intervals valid as all-day timeline events", () => {
    const model = buildTimelineModel([
      row("Projects/all-day.md", { start: "2026-06-13", end: "2026-06-13", status: "Active" }),
    ], config({ viewType: "timeline", timelineScale: "month", timelineAnchor: "2026-06-13" }));

    expect(model.invalidEventCount).toBe(0);
    expect(model.lanes.flatMap((lane) => lane.events)).toHaveLength(1);
  });

  it("hides events whose end date is earlier than start date even when end time is later", () => {
    // 结束日期靠前（06-14 < 06-15），即使结束时间（08:00）晚于开始时间（04:00），也是负区间。
    // 修复前 buildEvents 的 endDateKey fallback 把它折叠成同天、误判合法；修复后用原始 parsedEndDateKey 判定。
    const rows = [
      row("Projects/x.md", { start: "2026-06-15T04:00", end: "2026-06-14T08:00", status: "Active" }),
    ];
    const model = buildTimelineModel(rows, config({ viewType: "timeline", timelineScale: "month", timelineAnchor: "2026-06-10" }));
    expect(model.invalidEventCount).toBe(1);
    expect(model.lanes.flatMap((lane) => lane.events)).toHaveLength(0);
  });

  it("uses a provided timeline uncategorized lane label", () => {
    const model = buildTimelineModel([
      row("Projects/c.md", { start: "2026-06-11" }),
    ], config(), { uncategorizedLabel: "No group" });

    expect(model.lanes[0]).toMatchObject({
      key: "__uncategorized__",
      label: "No group",
    });
  });

  it("computes timeline window offsets and durations for visual bars", () => {
    const model = buildTimelineModel([
      row("Projects/a.md", { start: "2026-06-10", end: "2026-06-12", status: "Active" }),
      row("Projects/b.md", { start: "2026-06-20", status: "Active" }),
    ], config());

    // month-scale window spans all of June 2026; events offset from June 1.
    expect(model.startDateKey).toBe("2026-06-01");
    expect(model.endDateKey).toBe("2026-06-30");
    expect(model.totalUnits).toBe(30);
    expect(model.lanes[0].events.map((event) => [event.title, event.offsetUnits, event.durationUnits])).toEqual([
      ["a", 9, 3],
      ["b", 19, 1],
    ]);
  });

  it("keeps window metadata when the active timeline range has no visible events", () => {
    const model = buildTimelineModel([
      row("Projects/a.md", { start: "2026-06-10", end: "2026-06-12", status: "Active" }),
    ], config({ timelineAnchor: "2026-07-10" }));

    expect(model.startDateKey).toBe("2026-07-01");
    expect(model.endDateKey).toBe("2026-07-31");
    expect(model.eventCount).toBe(1);
    expect(model.visibleEventCount).toBe(0);
    expect(model.lanes.map((lane) => [lane.key, lane.events.map((event) => [event.title, event.timelineRow, event.windowPosition])])).toEqual([
      ["Active", [["a", 1, "before"]]],
      ["Done", []],
      ["Later", []],
    ]);
  });

  it("renders configured timeline lanes even when some groups have no visible events", () => {
    const model = buildTimelineModel([
      row("Projects/a.md", { start: "2026-06-10", end: "2026-06-12", status: "Active" }),
      row("Projects/b.md", { start: "2026-06-14", status: "Later" }),
    ], config());

    expect(model.visibleEventCount).toBe(2);
    expect(model.lanes.map((lane) => [lane.key, lane.events.map((event) => event.title)])).toEqual([
      ["Active", ["a"]],
      ["Done", []],
      ["Later", ["b"]],
    ]);
  });

  it("treats cross-day timed events as timed (not all-day) in day scale", () => {
    const model = buildTimelineModel([
      row("Projects/x.md", { start: "2026-06-20T23:00", end: "2026-06-21T12:15", status: "Active" }),
    ], config({ viewType: "timeline", timelineScale: "day", timelineAnchor: "2026-06-20" }));
    const event = model.lanes.flatMap((lane) => lane.events).find((e) => e.startDateKey === "2026-06-20");
    expect(event).toBeTruthy();
    // 跨天带时间事件按 timed 定位（绝对刻度保留 startMinutes/endMinutes），不再有 isAllDay 双轨；
    // endMinutes 是结束日当天分钟（12:15 < 23:00，靠 endDateKey 区分跨天）。
    expect(event?.endDateKey).toBe("2026-06-21");
    expect(event?.startMinutes).toBe(23 * 60);
    expect(event?.endMinutes).toBe(12 * 60 + 15);
  });

  it("keeps every timeline event on its own stable visual row", () => {
    const model = buildTimelineModel([
      row("Projects/a.md", { start: "2026-06-10", end: "2026-06-12", status: "Active" }),
      row("Projects/b.md", { start: "2026-06-11", end: "2026-06-13", status: "Active" }),
      row("Projects/c.md", { start: "2026-06-14", status: "Active" }),
    ], config());

    expect(model.lanes[0].rowCount).toBe(3);
    expect(model.lanes[0].events.map((event) => [event.title, event.timelineRow, event.windowPosition])).toEqual([
      ["a", 1, "visible"],
      ["b", 2, "visible"],
      ["c", 3, "visible"],
    ]);
  });

  it("does not reuse rows for adjacent non-overlapping timeline events", () => {
    const rows = [
      row("Projects/a.md", { start: "2026-06-10", end: "2026-06-10", status: "Active" }),
      row("Projects/b.md", { start: "2026-06-11", end: "2026-06-12", status: "Active" }),
      row("Projects/c.md", { start: "2026-06-14", end: "2026-06-14", status: "Active" }),
    ];

    const model = buildTimelineModel(rows, config());

    // Notion-style timelines keep a stable row per event instead of packing non-overlapping bars together.
    expect(model.lanes[0].rowCount).toBe(3);
    expect(model.lanes[0].events.map((event) => [event.title, event.timelineRow])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("preserves row-pipeline order for timeline rows when a toolbar sort is active", () => {
    const model = buildTimelineModel([
      row("Projects/c.md", { start: "2026-06-12", status: "Active" }),
      row("Projects/a.md", { start: "2026-06-10", status: "Active" }),
      row("Projects/b.md", { start: "2026-06-11", status: "Active" }),
    ], config({ sortRules: [{ field: "file.name", direction: "desc" }] }));

    expect(model.lanes[0].events.map((event) => [event.title, event.timelineRow])).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("keeps off-window timeline events in their rows with a jump direction", () => {
    const model = buildTimelineModel([
      row("Projects/before.md", { start: "2026-05-10", end: "2026-05-12", status: "Active" }),
      row("Projects/visible.md", { start: "2026-06-10", end: "2026-06-12", status: "Active" }),
      row("Projects/after.md", { start: "2026-07-10", end: "2026-07-12", status: "Active" }),
    ], config());

    expect(model.visibleEventCount).toBe(1);
    expect(model.lanes[0].rowCount).toBe(3);
    expect(model.lanes[0].events.map((event) => [event.title, event.timelineRow, event.windowPosition])).toEqual([
      ["before", 1, "before"],
      ["visible", 2, "visible"],
      ["after", 3, "after"],
    ]);
  });

  it("orders timeline lanes with the configured toolbar group order", () => {
    const model = buildTimelineModel([
      row("Projects/b.md", { start: "2026-06-10", end: "2026-06-10", status: "Beta" }),
      row("Projects/a.md", { start: "2026-06-12", end: "2026-06-12", status: "Alpha" }),
      row("Projects/c.md", { start: "2026-06-11", end: "2026-06-11", status: "Gamma" }),
    ], config({
      groupOrders: { status: ["Alpha", "Beta", "Gamma"] },
    }));

    expect(model.lanes.map((lane) => lane.key)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("hides empty option lanes without hiding the real uncategorized lane", () => {
    const model = buildTimelineModel([
      row("Projects/a.md", { start: "2026-06-10", end: "2026-06-10", status: "Active" }),
      row("Projects/b.md", { start: "2026-06-11", end: "2026-06-11" }),
    ], config({
      showEmptyGroups: { status: false },
    }));

    expect(model.lanes.map((lane) => lane.key)).toEqual(["Active", "__uncategorized__"]);
  });

  it("orders timeline file-name lanes with toolbar group order keys", () => {
    const model = buildTimelineModel([
      row("Projects/Beta.md", { start: "2026-06-10", end: "2026-06-10" }),
      row("Projects/Alpha.md", { start: "2026-06-12", end: "2026-06-12" }),
    ], config({
      timelineGroupField: "file.name",
      groupOrders: { "file.name": ["Alpha", "Beta"] },
    }));

    expect(model.lanes.map((lane) => lane.key)).toEqual(["Alpha", "Beta"]);
  });

  it("builds hourly ticks for day scale and daily/weekly ticks for other scales", () => {
    // day: one tick per hour across the visible hour range
    const dayTicks = buildTimelineTicks({ startDateKey: "2026-06-29", endDateKey: "2026-06-29", totalUnits: 24, unit: "hour" }, "day", config());
    expect(dayTicks).toHaveLength(24);
    expect(dayTicks.slice(0, 3).map((tick) => [tick.label, tick.offsetUnits])).toEqual([["00", 0], ["01", 1], ["02", 2]]);

    // week: one tick per day
    const weekTicks = buildTimelineTicks({ startDateKey: "2026-06-29", endDateKey: "2026-07-05", totalUnits: 7, unit: "day" }, "week", config(), "en");
    expect(weekTicks.map((tick) => [tick.dateKey, tick.offsetUnits, tick.label])).toEqual([
      ["2026-06-29", 0, "Mon 29"],
      ["2026-06-30", 1, "Tue 30"],
      ["2026-07-01", 2, "Wed 1"],
      ["2026-07-02", 3, "Thu 2"],
      ["2026-07-03", 4, "Fri 3"],
      ["2026-07-04", 5, "Sat 4"],
      ["2026-07-05", 6, "Sun 5"],
    ]);

    // month: daily ticks
    const monthTicks = buildTimelineTicks({ startDateKey: "2026-06-01", endDateKey: "2026-06-03", totalUnits: 3, unit: "day" }, "month", config(), "en");
    expect(monthTicks.map((tick) => [tick.dateKey, tick.offsetUnits, tick.label])).toEqual([
      ["2026-06-01", 0, "1"],
      ["2026-06-02", 1, "2"],
      ["2026-06-03", 2, "3"],
    ]);

    // quarter: weekly visible ticks on a daily interaction grid
    const quarterTicks = buildTimelineTicks({ startDateKey: "2026-07-01", endDateKey: "2026-07-22", totalUnits: 22, unit: "day" }, "quarter", config());
    expect(quarterTicks.map((tick) => [tick.dateKey, tick.offsetUnits, tick.label])).toEqual([
      ["2026-07-01", 0, "1"],
      ["2026-07-08", 7, "8"],
      ["2026-07-15", 14, "15"],
      ["2026-07-22", 21, "22"],
    ]);
  });

  it("formats week ticks with compact localized weekdays without changing month ticks", () => {
    const window = { startDateKey: "2026-06-19", endDateKey: "2026-06-19", totalUnits: 1, unit: "day" as const };

    expect(buildTimelineTicks(window, "week", config(), "en")[0].label).toBe("Fri 19");
    expect(buildTimelineTicks(window, "week", config(), "zh-CN")[0].label).toBe("五 19");
    expect(buildTimelineTicks(window, "week", config(), "zh-TW")[0].label).toBe("五 19");
    expect(buildTimelineTicks(window, "month", config(), "zh-CN")[0].label).toBe("19");
  });

  it("uses scale-specific timeline column clamps consistently", () => {
    expect(getTimelineColumnWidthSpec("day")).toEqual({ defaultWidth: 48, min: 60, max: 180 });
    expect(resolveTimelineUnitWidth(config({ timelineScale: "day" }), "day")).toBe(60);
    expect(resolveTimelineUnitWidth(config({ timelineScale: "day", timelineColumnSizeMode: "custom", timelineCustomUnitWidth: 24 }), "day")).toBe(60);

    expect(getTimelineColumnWidthSpec("week")).toEqual({ defaultWidth: 100, min: 100, max: 360 });
    expect(resolveTimelineUnitWidth(config({ timelineScale: "week" }), "week")).toBe(100);
    expect(resolveTimelineUnitWidth(config({ timelineScale: "week", timelineColumnSizeMode: "custom", timelineCustomUnitWidth: 48 }), "week")).toBe(100);

    expect(getTimelineColumnWidthSpec("month")).toEqual({ defaultWidth: 80, min: 48, max: 360 });
    expect(resolveTimelineUnitWidth(config({ timelineScale: "month", timelineColumnSizeMode: "custom", timelineCustomUnitWidth: 48 }), "month")).toBe(48);
    expect(getTimelineColumnWidthSpec("quarter")).toEqual({ defaultWidth: 15, min: 15, max: 40 });
  });

  it("counts only fully visible hour columns for the timeline day viewport", () => {
    expect(getTimelineViewportContentWidth(999, 24, 24)).toBe(951);
    expect(resolveTimelineViewportUnitSpan(725, 100)).toBe(7.25);
    expect(resolveTimelineViewportUnitCount(999, 60, "day")).toBe(16);
    expect(resolveTimelineViewportUnitCount(getTimelineViewportContentWidth(999, 24, 24), 60, "day")).toBe(15);
    expect(resolveTimelineViewportUnitCount(1020, 60, "day")).toBe(17);
    expect(resolveTimelineViewportUnitCount(1, 60, "day")).toBe(1);
    expect(resolveTimelineViewportUnitCount(999, 100, "week")).toBe(10);
    expect(resolveTimelineViewportUnitCount(0, 60, "day")).toBeUndefined();
  });

  it("keeps minute-level offsets for timed day-scale timeline events", () => {
    const model = buildTimelineModel([
      row("Projects/checkin.md", { start: "2026-06-10T09:30", end: "2026-06-10T10:45", status: "Active" }),
    ], config({ timelineScale: "day", timelineAnchor: "2026-06-10" }));

    const event = model.lanes[0].events[0];
    expect(event.offsetUnits).toBe(9.5);
    expect(event.durationUnits).toBe(1.25);
    expect(event.gridOffsetUnits).toBe(9);
    expect(event.gridDurationUnits).toBe(2);
    expect(event.startMinutes).toBe(570);
    expect(event.endMinutes).toBe(645);
  });

  it("keeps day-scale events visible inside the fractional viewport tail", () => {
    const model = buildTimelineModel([
      row("Projects/tail.md", { start: "2026-06-20T15:05", end: "2026-06-20T15:10", status: "Active" }),
    ], config({ timelineScale: "day", timelineAnchor: "2026-06-20", timelineAnchorTimeMinutes: 8 * 60 }), {
      visibleUnitCount: 7,
      visibleUnitSpan: 7.25,
    });

    const event = model.lanes.flatMap((lane) => lane.events).find((candidate) => candidate.title === "tail");
    expect(model.totalUnits).toBe(7);
    expect(model.visibleEventCount).toBe(1);
    expect(event?.windowPosition).toBe("visible");
    expect(event?.offsetUnits).toBeCloseTo(7 + 5 / 60);
  });

  it("aligns week and quarter windows to Monday boundaries and shifts the anchor", () => {
    // 2026-07-01 is a Wednesday; the week window starts on Monday 2026-06-29.
    const weekWindow = getTimelineWindow(config({ timelineScale: "week" }), "2026-07-01");
    expect(weekWindow.startDateKey).toBe("2026-06-29");
    expect(weekWindow.endDateKey).toBe("2026-07-05");
    expect(weekWindow.totalUnits).toBe(7);
    expect(weekWindow.unit).toBe("day");

    // Quarter window grid starts on the Monday of the quarter's first day, but columns remain day-based.
    const quarterWindow = getTimelineWindow(config({ timelineScale: "quarter" }), "2026-07-15");
    expect(quarterWindow.unit).toBe("day");
    expect(quarterWindow.startDateKey).toBe("2026-06-29");
    expect(quarterWindow.endDateKey).toBe("2026-09-30");
    expect(quarterWindow.totalUnits).toBe(94);
    expect(getTimelineTitleWindow(config({ timelineScale: "quarter" }), "2026-07-15")).toEqual({
      startDateKey: "2026-07-01",
      endDateKey: "2026-09-30",
    });

    // Anchor shifts by window-sized steps per scale.
    expect(shiftTimelineAnchor("2026-07-01", "week", 1)).toBe("2026-07-08");
    expect(shiftTimelineAnchor("2026-07-15", "month", -1)).toBe("2026-06-15");
    expect(shiftTimelineAnchor("2026-07-15", "quarter", 1)).toBe("2026-10-15");
    expect(getTimelineAnchor(config({ timelineAnchor: "2026-08-20" }))).toBe("2026-08-20");

    const source = readFileSync(new URL("../data/CalendarTimelineModel.ts", import.meta.url), "utf8");
    expect(source).toContain("assertNever(scale)");
  });

  it("can build viewport-sized centered timeline windows for pseudo-infinite navigation", () => {
    const weekWindow = getTimelineViewportWindow(config({ timelineScale: "week" }), "2026-07-15", 12);
    expect(weekWindow).toEqual({
      startDateKey: "2026-07-10",
      endDateKey: "2026-07-21",
      totalUnits: 12,
      unit: "day",
    });

    const monthWindow = getTimelineViewportWindow(config({ timelineScale: "month" }), "2026-07-15", 18);
    expect(monthWindow.startDateKey).toBe("2026-07-07");
    expect(monthWindow.endDateKey).toBe("2026-07-24");
    expect(monthWindow.totalUnits).toBe(18);

    const quarterWindow = getTimelineViewportWindow(config({ timelineScale: "quarter" }), "2026-07-15", 75);
    expect(quarterWindow.startDateKey).toBe("2026-06-08");
    expect(quarterWindow.endDateKey).toBe("2026-08-21");
    expect(quarterWindow.unit).toBe("day");
  });

  it("can build day-scale viewport windows that continue across day boundaries", () => {
    const window = getTimelineViewportWindow(config({
      timelineScale: "day",
      timelineAnchor: "2026-07-15",
      timelineAnchorTimeMinutes: 20 * 60,
    }), "2026-07-15", 10);

    expect(window).toEqual({
      startDateKey: "2026-07-15",
      endDateKey: "2026-07-16",
      totalUnits: 10,
      unit: "hour",
      startMinutes: 1200,
    });
  });

  it("computes resize anchors that keep the viewport window left edge fixed", () => {
    const monthAnchor = getTimelineViewportStartAnchor(config({ timelineScale: "month" }), "2026-07-10", 16);
    expect(monthAnchor).toEqual({ dateKey: "2026-07-17" });
    expect(getTimelineViewportWindow(config({ timelineScale: "month", timelineAnchor: monthAnchor.dateKey }), monthAnchor.dateKey, 16)).toMatchObject({
      startDateKey: "2026-07-10",
      endDateKey: "2026-07-25",
    });

    const dayAnchor = getTimelineViewportStartAnchor(config({ timelineScale: "day" }), "2026-07-15", 10, 20 * 60);
    expect(dayAnchor).toEqual({ dateKey: "2026-07-15", timeMinutes: 20 * 60 });
    expect(getTimelineViewportWindow(config({
      timelineScale: "day",
      timelineAnchor: dayAnchor.dateKey,
      timelineAnchorTimeMinutes: dayAnchor.timeMinutes,
    }), dayAnchor.dateKey, 10)).toMatchObject({
      startDateKey: "2026-07-15",
      startMinutes: 20 * 60,
    });
  });

  it("normalizes day-scale viewport starts to whole-hour tick boundaries", () => {
    const window = getTimelineViewportWindow(config({
      timelineScale: "day",
      timelineAnchor: "2026-06-15",
      timelineAnchorTimeMinutes: 11 * 60 + 10,
    }), "2026-06-15", 24);

    expect(window.startMinutes).toBe(11 * 60);
  });

  it("uses overlapping navigation shifts for viewport-sized timeline windows", () => {
    expect(getTimelineNavigationShiftUnits(10)).toBe(8);
    expect(getTimelineNavigationShiftUnits(4)).toBe(3);
    expect(getTimelineNavigationShiftUnits(1)).toBe(1);
  });

  it("uses one-column short navigation for week/month and one-week short navigation for quarter", () => {
    expect(getTimelineShortNavigationShiftUnits("day")).toBe(1);
    expect(getTimelineShortNavigationShiftUnits("week")).toBe(1);
    expect(getTimelineShortNavigationShiftUnits("month")).toBe(1);
    expect(getTimelineShortNavigationShiftUnits("quarter")).toBe(7);
  });

  it("places jump-to-end anchors inside the viewport instead of on the exclusive end boundary", () => {
    const dateOnlyEvent = {
      startDateKey: "2026-06-06",
      endDateKey: "2026-06-08",
      startMinutes: undefined,
      endMinutes: undefined,
    };

    expect(resolveTimelineJumpAnchor({
      event: dateOnlyEvent,
      target: "end",
      scale: "day",
      totalUnits: 24,
    })).toEqual({ dateKey: "2026-06-08", timeMinutes: 60 });

    expect(resolveTimelineJumpAnchor({
      event: { ...dateOnlyEvent, endDateKey: "2026-06-06", endMinutes: 0 },
      target: "end",
      scale: "day",
      totalUnits: 24,
    })).toEqual({ dateKey: "2026-06-05", timeMinutes: 60 });

    const weekAnchor = resolveTimelineJumpAnchor({
      event: dateOnlyEvent,
      target: "end",
      scale: "week",
      totalUnits: 7,
    });
    expect(weekAnchor).toEqual({ dateKey: "2026-06-07" });
    expect(getTimelineViewportWindow(config({ timelineScale: "week" }), weekAnchor.dateKey, 7)).toMatchObject({
      startDateKey: "2026-06-04",
      endDateKey: "2026-06-10",
    });
  });

  it("places timed events and ticks inside day-scale windows that cross midnight", () => {
    const view = config({
      timelineScale: "day",
      timelineAnchor: "2026-07-15",
      timelineAnchorTimeMinutes: 20 * 60,
    });
    const model = buildTimelineModel([
      row("Projects/before.md", { start: "2026-07-15T19:00", end: "2026-07-15T19:30", status: "Active" }),
      row("Projects/overnight.md", { start: "2026-07-16T01:00", end: "2026-07-16T02:00", status: "Active" }),
      row("Projects/after.md", { start: "2026-07-16T07:00", end: "2026-07-16T08:00", status: "Active" }),
    ], view, { visibleUnitCount: 10 });

    expect(model.startDateKey).toBe("2026-07-15");
    expect(model.endDateKey).toBe("2026-07-16");
    expect(model.startMinutes).toBe(20 * 60);
    expect(model.visibleEventCount).toBe(1);
    expect(Object.fromEntries(model.lanes[0].events.map((event) => [event.title, [event.windowPosition, event.offsetUnits, event.durationUnits]]))).toEqual({
      before: ["before", 0, 1],
      overnight: ["visible", 5, 1],
      after: ["after", 9, 1],
    });

    expect(buildTimelineTicks({
      startDateKey: model.startDateKey!,
      endDateKey: model.endDateKey!,
      totalUnits: model.totalUnits,
      unit: model.unit,
      startMinutes: model.startMinutes,
    }, "day", view).map((tick) => [tick.dateKey, tick.label, tick.offsetUnits])).toEqual([
      ["2026-07-15", "20", 0],
      ["2026-07-15", "21", 1],
      ["2026-07-15", "22", 2],
      ["2026-07-15", "23", 3],
      ["2026-07-16", "00", 4],
      ["2026-07-16", "01", 5],
      ["2026-07-16", "02", 6],
      ["2026-07-16", "03", 7],
      ["2026-07-16", "04", 8],
      ["2026-07-16", "05", 9],
    ]);
  });

  it("uses viewport-sized windows when building timeline models with a visible unit count", () => {
    const model = buildTimelineModel([
      row("Projects/a.md", { start: "2026-07-14", end: "2026-07-15", status: "Active" }),
      row("Projects/b.md", { start: "2026-07-30", status: "Active" }),
    ], config({ timelineScale: "month", timelineAnchor: "2026-07-15" }), {
      visibleUnitCount: 12,
    });

    expect(model.startDateKey).toBe("2026-07-10");
    expect(model.endDateKey).toBe("2026-07-21");
    expect(model.totalUnits).toBe(12);
    expect(model.visibleEventCount).toBe(1);
    expect(model.lanes[0].events.map((event) => [event.title, event.offsetUnits, event.durationUnits, event.windowPosition])).toEqual([
      ["a", 4, 2, "visible"],
      ["b", 11, 1, "after"],
    ]);
  });

  it("emits at least one tick for very short windows", () => {
    const ticks = buildTimelineTicks({ startDateKey: "2026-07-01", endDateKey: "2026-07-01", totalUnits: 1, unit: "day" }, "week", config());

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ dateKey: "2026-07-01", offsetUnits: 0 });
  });

  it("builds month week segments that span days and use collision lanes", () => {
    const rows = [
      row("Projects/retreat.md", { start: "2026-06-05", end: "2026-06-09", status: "Active" }),
      row("Projects/sprint.md", { start: "2026-06-06", end: "2026-06-07", status: "Done" }),
      row("Projects/checkin.md", { start: "2026-06-08T09:30", status: "Later" }),
    ];

    // checkin 需要 datetime 字段才能进入时间网格
    const datetimeConfig = config({
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "datetime"),
          col("status", "Status", "status", [
            { value: "Active", color: "green" },
            { value: "Done", color: "blue" },
            { value: "Later", color: "orange" },
          ]),
          { ...col("formula.followup", "Follow-up", "computed"), computedKey: "followup" },
        ],
        computedFields: [{ key: "followup", label: "Follow-up", expression: "", type: "date" }],
      },
    });

    const model = buildCalendarMonthModel(rows, datetimeConfig, { year: 2026, monthIndex: 5 }, { weekStartsOn: 1 });
    const layouts = buildCalendarMonthWeekLayouts(model.weeks, datetimeConfig);

    expect(layouts[0].segments.map((segment) => [
      segment.event.title,
      segment.startDayIndex,
      segment.spanDays,
      segment.lane,
      segment.isTimed,
    ])).toEqual([
      ["retreat", 4, 3, 0, false],
      ["sprint", 5, 2, 1, false],
    ]);
    expect(layouts[0].rowCount).toBe(2);
    expect(layouts[1].segments.map((segment) => [
      segment.event.title,
      segment.startDayIndex,
      segment.spanDays,
      segment.lane,
      segment.isTimed,
      segment.startMinutes,
    ])).toEqual([
      ["retreat", 0, 2, 0, false, undefined],
      ["checkin", 0, 1, 1, true, 570],
    ]);
  });

  it("builds all-day week segments that span across columns", () => {
    const rows = [
      row("Projects/launch.md", { start: "2026-06-09", end: "2026-06-12" }),
      row("Projects/offsite.md", { start: "2026-06-11", end: "2026-06-13" }),
    ];

    const model = buildCalendarMonthModel(rows, config(), { year: 2026, monthIndex: 5 }, { weekStartsOn: 1 });
    const week = model.weeks[1];
    const layout = buildCalendarWeekAllDayLayout(week, week.flatMap((day) => day.events), config());

    expect(layout.segments.map((segment) => [
      segment.event.title,
      segment.startDayIndex,
      segment.spanDays,
      segment.lane,
    ])).toEqual([
      ["launch", 1, 4, 0],
      ["offsite", 3, 3, 1],
    ]);
    expect(layout.rowCount).toBe(2);
  });

  it("builds timed week layouts with overlap columns and visible-hour clipping", () => {
    const rows = [
      row("Projects/design.md", { start: "2026-06-10T09:00", end: "2026-06-10T10:30" }),
      row("Projects/review.md", { start: "2026-06-10T09:30", end: "2026-06-10T11:00" }),
      row("Projects/lunch.md", { start: "2026-06-10T12:00", end: "2026-06-10T13:00" }),
      row("Projects/early.md", { start: "2026-06-10T07:30", end: "2026-06-10T08:30" }),
    ];

    // timed 事件需要 datetime 字段
    const datetimeConfig = config({
      calendarStartHour: 8,
      calendarEndHour: 18,
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "datetime"),
          col("status", "Status", "status", [
            { value: "Active", color: "green" },
            { value: "Done", color: "blue" },
            { value: "Later", color: "orange" },
          ]),
          { ...col("formula.followup", "Follow-up", "computed"), computedKey: "followup" },
        ],
        computedFields: [{ key: "followup", label: "Follow-up", expression: "", type: "date" }],
      },
    });

    const model = buildCalendarMonthModel(rows, datetimeConfig, { year: 2026, monthIndex: 5 }, { weekStartsOn: 1 });
    const week = model.weeks[1];
    const layouts = buildCalendarTimedEventLayouts(
      week.map((day) => day.dateKey),
      week.flatMap((day) => day.events),
      datetimeConfig,
    );

    expect(layouts.map((layout) => [
      layout.event.title,
      layout.dateKey,
      layout.startMinutes,
      layout.endMinutes,
      layout.clippedStartMinutes,
      layout.clippedEndMinutes,
      layout.columnIndex,
      layout.columnCount,
    ])).toEqual([
      ["early", "2026-06-10", 450, 510, 480, 510, 0, 1],
      ["design", "2026-06-10", 540, 630, 540, 630, 0, 2],
      ["review", "2026-06-10", 570, 660, 570, 660, 1, 2],
      ["lunch", "2026-06-10", 720, 780, 720, 780, 0, 1],
    ]);
  });

  it("keeps calendar layout Date-object timing aligned with date and datetime column types", () => {
    const dateModel = buildCalendarMonthModel([
      row("Projects/date-object.md", {
        start: new Date(Date.UTC(2026, 5, 10, 0, 0)),
        end: new Date(Date.UTC(2026, 5, 10, 0, 0)),
      }),
    ], config(), { year: 2026, monthIndex: 5 }, { weekStartsOn: 1 });
    const dateWeek = dateModel.weeks[1];
    expect(buildCalendarTimedEventLayouts(dateWeek.map((day) => day.dateKey), dateWeek.flatMap((day) => day.events), config({
      calendarStartHour: 0,
      calendarEndHour: 4,
    }))).toEqual([]);

    const datetimeConfig = config({
      calendarStartHour: 0,
      calendarEndHour: 4,
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "datetime"),
        ],
        computedFields: [],
      },
    });
    const datetimeModel = buildCalendarMonthModel([
      row("Projects/datetime-object.md", {
        start: new Date(Date.UTC(2026, 5, 10, 0, 0)),
        end: new Date(Date.UTC(2026, 5, 10, 1, 30)),
      }),
    ], datetimeConfig, { year: 2026, monthIndex: 5 }, { weekStartsOn: 1 });
    const datetimeWeek = datetimeModel.weeks[1];
    expect(buildCalendarTimedEventLayouts(
      datetimeWeek.map((day) => day.dateKey),
      datetimeWeek.flatMap((day) => day.events),
      datetimeConfig,
    ).map((layout) => [layout.event.title, layout.startMinutes, layout.endMinutes])).toEqual([
      ["datetime-object", 0, 90],
    ]);
  });

  it("extracts timeline endpoint minutes from number timestamps like file.ctime (#8)", () => {
    // 本地 2026-06-20 09:30 的毫秒时间戳：构造与解析都用本地分量，断言与时区无关。
    const ms = new Date(2026, 5, 20, 9, 30).getTime();
    expect(extractTimelineEndpointMinutes(ms, { includeDateObjectTime: true, dateOnlyAsMidnight: false })).toBe(9 * 60 + 30);
    // date 字段（includeDateObjectTime=false）：dateOnlyAsMidnight 时按 00:00，否则视为无时间。
    expect(extractTimelineEndpointMinutes(ms, { includeDateObjectTime: false, dateOnlyAsMidnight: true })).toBe(0);
    expect(extractTimelineEndpointMinutes(ms, { includeDateObjectTime: false, dateOnlyAsMidnight: false })).toBeUndefined();
    expect(extractTimelineEndpointMinutes(Number.NaN, { includeDateObjectTime: true, dateOnlyAsMidnight: false })).toBeUndefined();
  });
});
