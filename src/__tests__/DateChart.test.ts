import { describe, expect, it } from "vitest";
import { aggregateChart, aggregateMixedChart, aggregateStackedChart } from "../data/ChartAggregation";
import type { ColumnDef, ComputedFieldDef, RowData } from "../data/types";
import { setLocale } from "../i18n";

setLocale("en");
const columns: ColumnDef[] = [
  { key: "category", label: "Category", type: "text" },
  { key: "series", label: "Series", type: "text" },
  { key: "result", label: "Date", type: "computed", computedKey: "day" },
];
const computedFields: ComputedFieldDef[] = [{ key: "day", label: "Date", expression: "time", type: "date" }];
const values = ["2026-10-19T09:00", "2026-10-19T18:30", "2026-10-20T09:00", null];
const rows: RowData[] = values.map((day) => ({ file: {} as RowData["file"], frontmatter: { category: "A", series: "S" }, computed: { day } }));
const options = { aggregation: "unique" as const, valueField: "result", computedFields };

describe("chart unique dates", () => {
  it("counts unique days in a single-series chart", () => {
    expect(aggregateChart(rows, "category", columns, options).points[0].value).toBe(2);
  });

  it("counts unique days in stacked charts", () => {
    expect(aggregateStackedChart(rows, "category", "series", columns, options).series[0].values).toEqual([2]);
  });

  it("normalizes both aggregations in mixed charts", () => {
    const mixed = aggregateMixedChart(rows, "category", columns, { ...options, secondaryAggregation: "unique", secondaryValueField: "result" });
    expect(mixed.series.map((series) => series.values)).toEqual([[2], [2]]);
  });

  it("preserves distinct datetimes and text values", () => {
    for (const type of ["datetime", "text"] as const) {
      expect(aggregateChart(rows, "category", columns, { ...options, computedFields: [{ ...computedFields[0], type }] }).points[0].value).toBe(3);
    }
  });

  it("also normalizes ordinary date properties", () => {
    const directRows = rows.map((row) => ({ ...row, frontmatter: { ...row.frontmatter, result: row.computed.day } }));
    const directColumns: ColumnDef[] = columns.map((col) => col.key === "result" ? { ...col, type: "date" } : col);
    expect(aggregateChart(directRows, "category", directColumns, options).points[0].value).toBe(2);
  });

  it("does not change raw formula results", () => {
    aggregateChart(rows, "category", columns, options);
    expect(rows.map((row) => row.computed.day)).toEqual(values);
  });
});
