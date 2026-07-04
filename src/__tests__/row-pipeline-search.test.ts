import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { RowPipeline } from "../data/RowPipeline";
import { setDateDisplayMode } from "../data/DateTimeFormat";
import { NoteRecord } from "../data/DataSource";
import { ColumnDef, ViewConfig } from "../data/types";
import { DatabaseViewState } from "../views/ViewStateStore";

// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock Obsidian globals
const _g = globalThis as unknown as Record<string, unknown>;

vi.mock("obsidian", () => ({
  App: class {},
  TFile: class {},
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/"),
}));

_g.moment = Object.assign(
  (value: unknown) => {
    const date = value == null ? new Date() : new Date(value as string | number | Date);
    return {
      format: () => "2026-06-03",
      isValid: () => !Number.isNaN(date.getTime()),
      toDate: () => date,
    };
  },
  { isMoment: () => false, ISO_8601: "ISO_8601" }
);

function col(key: string, type: ColumnDef["type"], label = key): ColumnDef {
  return { key, label, type };
}

function record(path: string, frontmatter: Record<string, unknown>): NoteRecord {
  const name = path.split("/").pop() || path;
  return {
    file: {
      path,
      name,
      basename: name.replace(/\.md$/i, ""),
      extension: "md",
      parent: { path: path.includes("/") ? path.split("/").slice(0, -1).join("/") : "" },
      stat: { ctime: 0, mtime: 0, size: 0 },
    } as NoteRecord["file"],
    frontmatter,
  };
}

function config(overrides: Partial<ViewConfig> = {}): ViewConfig {
  return {
    name: "Search",
    sourceFolder: "",
    viewType: "table",
    schema: {
      columns: [
        col("file.name", "text", "Name"),
        col("status", "text", "Status"),
        col("secret", "text", "Secret"),
      ],
      computedFields: [],
    },
    ...overrides,
  };
}

function state(searchText: string, hiddenColumns: string[] = []): DatabaseViewState {
  return {
    searchText,
    statusFilter: "",
    groupByField: "",
    filters: [],
    hiddenColumns: new Set(hiddenColumns),
    filterLogic: "and",
    sortDirection: "asc",
    sortRules: [],
  };
}

function build(records: NoteRecord[], view: ViewConfig, viewState: DatabaseViewState): string[] {
  return new RowPipeline().build(records, view, viewState).map((row) => row.file.path);
}

describe("RowPipeline search", () => {
  it("searches visible schema values and skips hidden columns", () => {
    const rows = [
      record("alpha.md", { status: "Visible Match", secret: "hidden needle" }),
      record("beta.md", { status: "Other", secret: "hidden needle" }),
    ];
    const view = config();

    expect(build(rows, view, state("visible"))).toEqual(["alpha.md"]);
    expect(build(rows, view, state("needle", ["secret"]))).toEqual([]);
  });

  it("normalizes query whitespace consistently", () => {
    const rows = [record("alpha.md", { status: "Launch Brief" })];

    expect(build(rows, config(), state("  launch  "))).toEqual(["alpha.md"]);
  });

  it("searches computed date fields by their displayed date text", () => {
    setDateDisplayMode("always");
    const view = config({
      schema: {
        columns: [
          col("file.name", "text", "Name"),
          col("due", "date", "Due"),
          { ...col("formula.followup", "computed", "Follow-up"), computedKey: "followup" },
        ],
        computedFields: [{ key: "followup", label: "Follow-up", expression: "due", type: "date" }],
      },
    });
    const rows = [record("alpha.md", { due: "2026-06-04" })];

    expect(build(rows, view, state("June"))).toEqual(["alpha.md"]);
  });

  it("does not match arbitrary raw dateKey substrings for date and datetime fields", () => {
    const view = config({
      schema: {
        columns: [
          col("file.name", "text", "Name"),
          col("due", "date", "Due"),
          col("starts", "datetime", "Starts"),
        ],
        computedFields: [],
      },
    });
    const rows = [
      record("alpha.md", { due: "2026-06-17", starts: "2026-06-17T09:30" }),
      record("beta.md", { due: "2026-06-18", starts: "2026-06-18T09:30" }),
    ];

    expect(build(rows, view, state("-17"))).toEqual([]);
  });

  it("matches explicit date search forms structurally", () => {
    const view = config({
      schema: {
        columns: [
          col("file.name", "text", "Name"),
          col("due", "date", "Due"),
        ],
        computedFields: [],
      },
    });
    const rows = [
      record("june-17.md", { due: "2026-06-17" }),
      record("june-18.md", { due: "2026-06-18" }),
      record("july-17.md", { due: "2026-07-17" }),
    ];

    expect(build(rows, view, state("2026-06-17"))).toEqual(["june-17.md"]);
    expect(build(rows, view, state("2026-06"))).toEqual(["june-17.md", "june-18.md"]);
    expect(build(rows, view, state("06-17"))).toEqual(["june-17.md"]);
    expect(build(rows, view, state("6-17"))).toEqual(["june-17.md"]);
  });

  it("still matches visible formatted date text", () => {
    setDateDisplayMode("always");
    const view = config({
      schema: {
        columns: [
          col("file.name", "text", "Name"),
          col("due", "date", "Due"),
        ],
        computedFields: [],
      },
    });
    const rows = [
      record("alpha.md", { due: "2026-06-17" }),
      record("beta.md", { due: "2026-07-18" }),
    ];

    expect(build(rows, view, state("June"))).toEqual(["alpha.md"]);
    expect(build(rows, view, state("17"))).toEqual(["alpha.md"]);
  });

  it("applies explicit date search semantics to computed date fields", () => {
    const view = config({
      schema: {
        columns: [
          col("file.name", "text", "Name"),
          col("due", "date", "Due"),
          { ...col("formula.followup", "computed", "Follow-up"), computedKey: "followup" },
        ],
        computedFields: [{ key: "followup", label: "Follow-up", expression: "due", type: "date" }],
      },
    });
    const rows = [
      record("alpha.md", { due: "2026-06-17" }),
      record("beta.md", { due: "2026-07-17" }),
    ];

    expect(build(rows, view, state("-17"))).toEqual([]);
    expect(build(rows, view, state("2026-06-17"))).toEqual(["alpha.md"]);
    expect(build(rows, view, state("6-17"))).toEqual(["alpha.md"]);
  });

  it("calendar and timeline search only uses visible event title/date fields", () => {
    const view = config({
      viewType: "timeline",
      timelineStartDateField: "start",
      timelineEndDateField: "end",
      timelineTitleField: "headline",
      schema: {
        columns: [
          col("file.name", "text", "Name"),
          col("start", "date", "Start"),
          col("end", "date", "End"),
          col("headline", "text", "Headline"),
          col("secret", "text", "Secret"),
        ],
        computedFields: [],
      },
    });
    const rows = [
      record("draft-alpha.md", { start: "2026-06-04", headline: "Launch Brief", secret: "needle" }),
      record("fallback-beta.md", { start: "2026-06-05", headline: "", secret: "needle" }),
    ];

    expect(build(rows, view, state("launch"))).toEqual(["draft-alpha.md"]);
    expect(build(rows, view, state("draft-alpha"))).toEqual([]);
    expect(build(rows, view, state("fallback-beta"))).toEqual([]);
    expect(build(rows, view, state("needle"))).toEqual([]);

    const fileTitleView = { ...view, timelineTitleField: undefined };
    expect(build(rows, fileTitleView, state("fallback-beta"))).toEqual(["fallback-beta.md"]);
  });

  it("sets the full-view date display mode before building searchable rows", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const setModeIndex = source.indexOf('setDateDisplayMode(config.yearDisplayMode || "always")');
    const buildIndex = source.indexOf("this.rows = this.rowPipeline.build(records", setModeIndex);

    expect(setModeIndex).toBeGreaterThan(0);
    expect(buildIndex).toBeGreaterThan(setModeIndex);
  });
});
