import { describe, expect, it, vi } from "vitest";
import { QueryEngine } from "../data/QueryEngine";
import type { ColumnDef, ComputedFieldDef, FilterOperator, RowData, ViewConfig } from "../data/types";
import { setLocale } from "../i18n";

vi.mock("../data/FileFieldObsidian", () => ({
  getRowFileFieldValue: vi.fn(),
}));

setLocale("en");
const engine = new QueryEngine();
const column: ColumnDef = { key: "formula.day", label: "Day", type: "computed", computedKey: "day" };
const field: ComputedFieldDef = { key: "day", label: "Day", expression: "time", type: "date" };
const config: ViewConfig = { name: "Test", sourceFolder: "", schema: { columns: [column], computedFields: [field] } };
const queryColumn: ColumnDef = { ...column, type: "date" };

function row(value: unknown, rank = 0): RowData {
  return { file: { path: String(rank) } as RowData["file"], frontmatter: { rank }, computed: { day: value } };
}

const rows = [row("2026-10-19T18:30", 0), row("2026-10-19T09:00", 1), row("2026-10-20T09:00", 2)];

describe("date field queries", () => {
  it("groups computed date results by the displayed day", () => {
    const groups = engine.groupBy(rows, column.key, [], column, config);
    expect(groups.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: "2026-10-19", count: 2 }, { key: "2026-10-20", count: 1 },
    ]);
  });

  it("keeps datetime groups separate unless grouping by day is selected", () => {
    const datetimeConfig: ViewConfig = { ...config, schema: { columns: [column], computedFields: [{ ...field, type: "datetime" }] } };
    expect(engine.groupBy(rows, column.key, [], column, datetimeConfig)).toHaveLength(3);
    datetimeConfig.dateGroupModes = { [column.key]: "date" };
    expect(engine.groupBy(rows, column.key, [], column, datetimeConfig)).toHaveLength(2);
  });

  it.each<[FilterOperator, number[]]>([
    ["eq", [0, 1]], ["neq", [2]], ["gt", [2]], ["gte", [0, 1, 2]], ["lt", []], ["lte", [0, 1]],
  ])("compares dates at day precision for %s", (op, ranks) => {
    const filtered = engine.applyFilters(rows, [{ field: column.key, op, value: "2026-10-19" }], "and", [queryColumn]);
    expect(filtered.map((entry) => entry.frontmatter.rank)).toEqual(ranks);
  });

  it("normalizes original date objects and numeric timestamps before filtering", () => {
    const mixed = [row(new Date("2026-10-19T23:30Z")), row(new Date(2026, 9, 19, 12).getTime())];
    expect(engine.applyFilters(mixed, [{ field: column.key, op: "eq", value: "2026-10-19" }], "and", [queryColumn])).toHaveLength(2);
  });

  it("retains datetime precision in filters", () => {
    const datetimeColumn: ColumnDef = { ...queryColumn, type: "datetime" };
    expect(engine.applyFilters(rows, [{ field: column.key, op: "eq", value: "2026-10-19T09:00" }], "and", [datetimeColumn])).toEqual([rows[1]]);
  });

  it("keeps stable order within a day for single-column date sorting", () => {
    expect(engine.sort(rows, queryColumn, "asc")).toEqual(rows);
    expect(engine.sort(rows, queryColumn, "desc")).toEqual([rows[2], rows[0], rows[1]]);
  });

  it("applies secondary sorting when displayed dates are equal", () => {
    const sorted = engine.sortByRules(rows, [queryColumn, { key: "rank", label: "Rank", type: "number" }], [
      { field: column.key, direction: "asc" }, { field: "rank", direction: "asc" },
    ]);
    expect(sorted).toEqual(rows);
    expect(engine.sort(rows, { ...queryColumn, type: "datetime" }, "asc")).toEqual([rows[1], rows[0], rows[2]]);
  });

  it("preserves empty and invalid values without matching them as valid dates", () => {
    const mixed = [row(null), row(""), row("invalid"), ...rows];
    expect(engine.applyFilters(mixed, [{ field: column.key, op: "empty" }], "and", [queryColumn])).toHaveLength(2);
    expect(engine.applyFilters(mixed, [{ field: column.key, op: "eq", value: "2026-10-19" }], "and", [queryColumn])).toHaveLength(2);
  });

  it("resolves a column whose formula storage key differs from its column key", () => {
    const aliased: ColumnDef = { ...column, key: "result", computedKey: "formula.day" };
    const aliasedConfig: ViewConfig = { ...config, schema: { ...config.schema, columns: [aliased] } };
    expect(engine.groupBy(rows, aliased.key, [], aliased, aliasedConfig).map((group) => group.count)).toEqual([2, 1]);
    expect(engine.applyFilters(rows, [{ field: aliased.key, op: "eq", value: "2026-10-19" }], "and", [{ ...aliased, type: "date" }])).toHaveLength(2);
  });
});
