import { describe, expect, it, vi } from "vitest";
import { buildMiniCalendarEventIndex } from "../views/CalendarMiniCalendarRenderer";
import { ColumnDef, RowData, ViewConfig } from "../data/types";

vi.mock("obsidian", () => ({
  setIcon: vi.fn(),
}));

function col(key: string, label: string, type: ColumnDef["type"]): ColumnDef {
  return { key, label, type };
}

function config(overrides: Partial<ViewConfig> = {}): ViewConfig {
  return {
    name: "Calendar",
    sourceFolder: "",
    viewType: "calendar",
    schema: {
      columns: [
        col("file.name", "Name", "text"),
        col("start", "Start", "date"),
        col("end", "End", "date"),
      ],
      computedFields: [],
    },
    calendarStartDateField: "start",
    calendarEndDateField: "end",
    ...overrides,
  };
}

function row(path: string, frontmatter: Record<string, unknown>): RowData {
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
    computed: {},
  };
}

describe("CalendarMiniCalendarRenderer", () => {
  it("does not mark mini calendar dates, months, or years for invalid event ranges", () => {
    const index = buildMiniCalendarEventIndex({
      rows: [
        row("Projects/backwards.md", { start: "2026-06-20", end: "2026-06-18" }),
        row("Projects/valid.md", { start: "2026-07-01", end: "2026-07-02" }),
      ],
      config: config(),
      startField: "start",
      endField: "end",
    });

    expect(index.dateKeys.has("2026-06-20")).toBe(false);
    expect(index.monthKeys.has("2026-06")).toBe(false);
    expect(index.yearKeys.has("2026")).toBe(true);
    expect(index.dateKeys.has("2026-07-01")).toBe(true);
    expect(index.dateKeys.has("2026-07-02")).toBe(true);
    expect(index.monthKeys.has("2026-07")).toBe(true);
  });

  it("does not mark mini calendar dates for same-day datetime zero-width events", () => {
    const datetimeConfig = config({
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "datetime"),
        ],
        computedFields: [],
      },
    });

    const index = buildMiniCalendarEventIndex({
      rows: [
        row("Projects/zero.md", { start: "2026-06-13", end: "2026-06-13T00:00" }),
      ],
      config: datetimeConfig,
      startField: "start",
      endField: "end",
    });

    expect(index.dateKeys.has("2026-06-13")).toBe(false);
    expect(index.monthKeys.has("2026-06")).toBe(false);
    expect(index.yearKeys.has("2026")).toBe(false);
  });

  it("does not mark the exclusive midnight end date for datetime events", () => {
    const datetimeConfig = config({
      schema: {
        columns: [
          col("file.name", "Name", "text"),
          col("start", "Start", "datetime"),
          col("end", "End", "datetime"),
        ],
        computedFields: [],
      },
    });

    const index = buildMiniCalendarEventIndex({
      rows: [
        row("Projects/overnight.md", { start: "2026-06-13T20:00", end: "2026-06-14T00:00" }),
      ],
      config: datetimeConfig,
      startField: "start",
      endField: "end",
    });

    expect(index.dateKeys.has("2026-06-13")).toBe(true);
    expect(index.dateKeys.has("2026-06-14")).toBe(false);
    expect(index.monthKeys.has("2026-06")).toBe(true);
  });
});
