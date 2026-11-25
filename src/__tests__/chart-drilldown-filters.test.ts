import { expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { aggregateChart } from "../data/ChartAggregation";
import { getChartFilterRules, getDrilldownRows } from "../data/ChartViewModel";
import { copyPersistedFilters } from "../data/FilterRules";
import { QueryEngine } from "../data/QueryEngine";
import type { ColumnDef, RowData } from "../data/types";

vi.mock("obsidian", () => ({}));
setLocale("en");

it.each(["text", "multi-select"] as const)("matches chart labels consistently for %s", (type) => {
  const column: ColumnDef = { key: "code", label: "Code", type };
  const rows = [["Plain", "123"], ["Padded", " 123 "], ["Zero", "0123"], ["Prefix", "A123"]].map(([name, code]) => ({
    file: { path: name + ".md" } as RowData["file"],
    frontmatter: { code: type === "text" ? code : [code] }, computed: {},
  }));
  const points = aggregateChart(rows, column.key, [column], { aggregation: "count" }).points;
  const query = new QueryEngine();
  for (const [label, expected] of [["123", [rows[0], rows[1]]], ["0123", [rows[2]]], ["A123", [rows[3]]]] as const) {
    const generated = getChartFilterRules(column.key, label, column);
    const filters = copyPersistedFilters(JSON.parse(JSON.stringify(generated.map(rule => ({ comparison: "typed", ...rule })))))!;
    expect(points.find(point => point.key === label)?.value).toBe(expected.length);
    expect(getDrilldownRows(rows, column.key, label, column)).toEqual(expected);
    expect(query.applyFilters(rows, filters, "and", [column])).toEqual(expected);
  }
  expect(query.applyFilters(rows, [{ field: column.key, op: "eq", value: "123", comparison: "typed" }], "and", [column])).toEqual([rows[0]]);
});
