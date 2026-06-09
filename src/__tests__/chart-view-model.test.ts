import { describe, expect, it } from "vitest";
import { aggregateChart } from "../data/ChartAggregation";
import { formatChartDrilldownCellValue, getChartAutoTitle, getChartFilterRules, getChartTitle, getDrilldownRows, getDefaultChartAggregationForValueField, isChartAggregationAllowedForValueField, normalizeChartAggregationForValueField, normalizeChartConfigForType } from "../data/ChartViewModel";
import { ColumnDef, RowData, ViewConfig } from "../data/types";

function col(key: string, label: string, type: ColumnDef["type"]): ColumnDef {
  return { key, label, type };
}

function config(overrides: Partial<ViewConfig> = {}): ViewConfig {
  const columns = [
    col("status", "Status", "status"),
    col("amount", "Amount", "number"),
    col("created", "Created", "date"),
  ];
  return {
    name: "Chart",
    sourceFolder: "",
    viewType: "chart",
    chartGroupField: "status",
    chartAggregation: "count",
    schema: { columns, computedFields: [] },
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

function computedRow(path: string, frontmatter: Record<string, unknown>, computed: Record<string, unknown>): RowData {
  return { ...row(path, frontmatter), computed };
}

describe("ChartViewModel", () => {
  it("generates Notion-style automatic chart titles", () => {
    const columns = config().schema.columns;

    expect(getChartAutoTitle(config(), columns)).toBe("Count by Status");
    expect(getChartAutoTitle(config({ chartAggregation: "sum", chartValueField: "amount" }), columns)).toBe("Sum of Amount by Status");
    expect(getChartAutoTitle(config({ chartGroupField: "created", chartDateBucket: "month" }), columns)).toBe("Count by Month of Created");
    expect(getChartAutoTitle(config({ chartGroupField: "amount", chartNumberBucket: "auto" }), columns)).toBe("Count by Amount buckets");
    expect(getChartAutoTitle(config({ chartType: "number", chartAggregation: "avg", chartValueField: "amount" }), columns)).toBe("Average of Amount");
    expect(getChartAutoTitle(config({ chartType: "mixed", chartAggregation: "sum", chartSecondaryAggregation: "avg" }), columns)).toBe("Sum and Average by Status");
  });

  it("uses a custom chart title when one is configured", () => {
    const columns = config().schema.columns;

    expect(getChartTitle(config({ chartTitle: "Budget by status" }), columns)).toBe("Budget by status");
    expect(getChartTitle(config({ chartTitle: "   " }), columns)).toBe("Count by Status");
  });

  it("limits chart aggregations based on the selected value field", () => {
    const view = config({
      schema: {
        columns: [
          col("status", "Status", "status"),
          col("amount", "Amount", "number"),
          col("done", "Done", "checkbox"),
          col("owner", "Owner", "text"),
        ],
        computedFields: [],
      },
    });

    expect(isChartAggregationAllowedForValueField(view, "count", undefined)).toBe(true);
    expect(isChartAggregationAllowedForValueField(view, "sum", undefined)).toBe(false);
    expect(getDefaultChartAggregationForValueField(view, undefined)).toBe("count");

    expect(isChartAggregationAllowedForValueField(view, "sum", "amount")).toBe(true);
    expect(isChartAggregationAllowedForValueField(view, "avg", "amount")).toBe(true);
    expect(isChartAggregationAllowedForValueField(view, "checked", "amount")).toBe(false);
    expect(getDefaultChartAggregationForValueField(view, "amount")).toBe("sum");

    expect(isChartAggregationAllowedForValueField(view, "percent-checked", "done")).toBe(true);
    expect(isChartAggregationAllowedForValueField(view, "sum", "done")).toBe(false);
    expect(getDefaultChartAggregationForValueField(view, "done")).toBe("percent-checked");

    expect(isChartAggregationAllowedForValueField(view, "unique", "owner")).toBe(true);
    expect(isChartAggregationAllowedForValueField(view, "empty", "owner")).toBe(true);
    expect(isChartAggregationAllowedForValueField(view, "sum", "owner")).toBe(false);
    expect(getDefaultChartAggregationForValueField(view, "owner")).toBe("count");
  });

  it("clears stale chart value fields when normalizing aggregation choices", () => {
    const view = config({ chartAggregation: "sum", chartValueField: "deleted" });

    normalizeChartAggregationForValueField(view);

    expect(view.chartValueField).toBeUndefined();
    expect(view.chartAggregation).toBe("count");
  });

  it("filters drilldown rows for scalar, list, checkbox, and date bucket groups", () => {
    const rows = [
      row("a.md", { status: "todo", tags: ["plugin"], done: true, created: "2026-01-10" }),
      row("b.md", { status: "done", tags: ["design"], done: false, created: "2026-02-02" }),
      row("c.md", { status: "todo", tags: ["plugin", "design"], done: true, created: "" }),
    ];

    expect(getDrilldownRows(rows, "status", "todo", col("status", "Status", "status"))).toHaveLength(2);
    expect(getDrilldownRows(rows, "tags", "plugin", col("tags", "Tags", "multi-select"))).toHaveLength(2);
    expect(getDrilldownRows(rows, "done", "Yes", col("done", "Done", "checkbox"))).toHaveLength(2);
    expect(getDrilldownRows(rows, "created", "2026-01", col("created", "Created", "date"), "month")).toHaveLength(1);
  });

  it("filters drilldown rows for computed and file metadata groups", () => {
    const rows = [
      computedRow("Projects/a.md", {}, { kind: "book", done: true, created: "2026-01-10" }),
      computedRow("Archive/b.md", {}, { kind: "movie", done: false, created: "2026-02-02" }),
      computedRow("Projects/c.md", {}, { kind: "book", done: true, created: "" }),
    ];

    expect(getDrilldownRows(rows, "formula.kind", "book", { ...col("formula.kind", "Kind", "computed"), computedKey: "kind" }, undefined, [
      { key: "kind", label: "Kind", expression: "kind", type: "text" },
    ])).toHaveLength(2);
    expect(getDrilldownRows(rows, "formula.done", "Yes", { ...col("formula.done", "Done", "computed"), computedKey: "done" }, undefined, [
      { key: "done", label: "Done", expression: "done", type: "checkbox" },
    ])).toHaveLength(2);
    expect(getDrilldownRows(rows, "formula.created", "2026-01", { ...col("formula.created", "Created", "computed"), computedKey: "created" }, "month", [
      { key: "created", label: "Created", expression: "created", type: "date" },
    ])).toHaveLength(1);
    expect(getDrilldownRows(rows, "file.folder", "Projects", col("file.folder", "Folder", "text"))).toHaveLength(2);
  });

  it("filters drilldown rows for numeric bucket groups", () => {
    const rows = [
      row("a.md", { amount: 4 }),
      row("b.md", { amount: 12 }),
      row("c.md", { amount: 19 }),
      row("d.md", { amount: 21 }),
    ];

    expect(getDrilldownRows(rows, "amount", "__bucket__:10:20", col("amount", "Amount", "number"))).toHaveLength(2);
  });

  it("formats drilldown table values for frontmatter, computed, arrays, and file tags", () => {
    const valueRow = computedRow("Projects/a.md", { status: "todo", tags: ["plugin", "chart"], links: ["A", "B"] }, { score: 12 });
    valueRow.cache = { tags: [{ tag: "#inline" }] } as RowData["cache"];

    expect(formatChartDrilldownCellValue(valueRow, "status", col("status", "Status", "status"))).toBe("todo");
    expect(formatChartDrilldownCellValue(valueRow, "links", col("links", "Links", "multi-select"))).toBe("A, B");
    expect(formatChartDrilldownCellValue(valueRow, "formula.score", { ...col("formula.score", "Score", "computed"), computedKey: "score" })).toBe("12");
    expect(formatChartDrilldownCellValue(valueRow, "file.tags", col("file.tags", "Tags", "multi-select"))).toBe("plugin, chart, inline");
  });

  it("creates dedicated drilldown filter rules for tags, multi-select values, and buckets", () => {
    expect(getChartFilterRules("file.tags", "project", col("file.tags", "Tags", "multi-select"))).toEqual([
      { field: "file.tags", op: "hasTag", value: "project" },
    ]);
    expect(getChartFilterRules("tags", "#project", col("tags", "Tags", "multi-select"))).toEqual([
      { field: "tags", op: "hasTag", value: "project" },
    ]);
    expect(getChartFilterRules("category", "design", col("category", "Category", "multi-select"))).toEqual([
      { field: "category", op: "eq", value: "design" },
    ]);
    expect(getChartFilterRules("amount", "__bucket__:10:20", col("amount", "Amount", "number"))).toEqual([
      { field: "amount", op: "gte", value: "10" },
      { field: "amount", op: "lt", value: "20" },
    ]);
  });

  it("applies chart sorting, hidden groups, zero omission, and cumulative values", () => {
    const rows = [
      row("a.md", { status: "todo", amount: 1 }),
      row("b.md", { status: "todo", amount: 2 }),
      row("c.md", { status: "done", amount: 0 }),
      row("d.md", { status: "later", amount: 4 }),
    ];
    const columns = [col("status", "Status", "status"), col("amount", "Amount", "number")];

    expect(aggregateChart(rows, "status", columns, {
      aggregation: "sum",
      valueField: "amount",
      sortBy: "value-desc",
      hiddenGroups: { later: true },
      omitZeroValues: true,
      cumulative: true,
    }).points).toEqual([
      { key: "todo", label: "todo", value: 3 },
    ]);
  });

  it("cleans incompatible chart options when switching to number charts", () => {
    const view = config({
      chartType: "number",
      chartGroupField: "status",
      chartDateBucket: "month",
      chartNumberBucket: "fixed",
      chartNumberBucketSize: 10,
      chartSeriesField: "amount",
      chartStackField: "amount",
      chartHiddenGroups: { todo: true },
      chartCumulative: true,
      chartValueAxisRange: "custom",
      chartValueAxisMin: 0,
      chartValueAxisMax: 100,
      chartReferenceLines: [{ id: "goal", type: "constant", value: 50 }],
      chartDonutCenterMode: "total",
      chartShowDonutCenter: true,
    });

    normalizeChartConfigForType(view);

    expect(view.chartGroupField).toBeUndefined();
    expect(view.chartDateBucket).toBeUndefined();
    expect(view.chartNumberBucket).toBeUndefined();
    expect(view.chartNumberBucketSize).toBeUndefined();
    expect(view.chartSeriesField).toBeUndefined();
    expect(view.chartStackField).toBeUndefined();
    expect(view.chartHiddenGroups).toBeUndefined();
    expect(view.chartCumulative).toBe(false);
    expect(view.chartValueAxisRange).toBeUndefined();
    expect(view.chartValueAxisMin).toBeUndefined();
    expect(view.chartValueAxisMax).toBeUndefined();
    expect(view.chartReferenceLines).toBeUndefined();
    expect(view.chartDonutCenterMode).toBeUndefined();
    expect(view.chartShowDonutCenter).toBe(false);
  });

  it("keeps donut center but clears axis and series settings for donut charts", () => {
    const view = config({
      chartType: "donut",
      chartSeriesField: "amount",
      chartStackField: "amount",
      chartCumulative: true,
      chartValueAxisRange: "zero-based",
      chartValueAxisMin: 0,
      chartValueAxisMax: 100,
      chartReferenceLines: [{ id: "avg", type: "average" }],
      chartDonutCenterMode: "aggregation",
      chartShowDonutCenter: true,
    });

    normalizeChartConfigForType(view);

    expect(view.chartGroupField).toBe("status");
    expect(view.chartSeriesField).toBeUndefined();
    expect(view.chartStackField).toBeUndefined();
    expect(view.chartCumulative).toBe(false);
    expect(view.chartValueAxisRange).toBeUndefined();
    expect(view.chartValueAxisMin).toBeUndefined();
    expect(view.chartValueAxisMax).toBeUndefined();
    expect(view.chartReferenceLines).toBeUndefined();
    expect(view.chartDonutCenterMode).toBe("aggregation");
    expect(view.chartShowDonutCenter).toBe(true);
  });

  it("clears mixed secondary fields when switching away from mixed charts", () => {
    const view = config({
      chartType: "bar",
      chartSecondaryAggregation: "avg",
      chartSecondaryValueField: "amount",
    });

    normalizeChartConfigForType(view);

    expect(view.chartSecondaryAggregation).toBeUndefined();
    expect(view.chartSecondaryValueField).toBeUndefined();
  });
});
