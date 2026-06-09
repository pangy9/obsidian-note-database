import { describe, expect, it } from "vitest";
import {
  aggregateChart,
  aggregateMixedChart,
  aggregateSeriesChart,
  aggregateStackedChart,
  getDefaultChartValueField,
  getDefaultChartField,
  getDefaultChartNumberBucket,
  isChartCompatibleColumn,
  isChartGroupColumn,
  isChartValueColumn,
  toChartNumber,
} from "../data/ChartAggregation";
import { ColumnDef, ComputedFieldDef, RowData } from "../data/types";

function col(key: string, type: ColumnDef["type"], statusOptions?: ColumnDef["statusOptions"]): ColumnDef {
  return {
    key,
    label: key,
    type,
    statusOptions,
  };
}

function computedField(key: string, type: ComputedFieldDef["type"]): ComputedFieldDef {
  return { key, label: key, expression: "1", type };
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

describe("ChartAggregation", () => {
  it("treats text and categorical property types as chart group fields", () => {
    expect(isChartCompatibleColumn("text")).toBe(true);
    expect(isChartCompatibleColumn("select")).toBe(true);
    expect(isChartCompatibleColumn("status")).toBe(true);
    expect(isChartCompatibleColumn("multi-select")).toBe(true);
    expect(isChartCompatibleColumn("checkbox")).toBe(true);
    expect(isChartCompatibleColumn("date")).toBe(true);
    expect(isChartCompatibleColumn("number")).toBe(false);
    expect(isChartCompatibleColumn("computed")).toBe(false);
    expect(isChartGroupColumn({ ...col("summary", "computed"), computedKey: "summary" }, [computedField("summary", "text")])).toBe(true);
    expect(isChartGroupColumn({ ...col("done", "computed"), computedKey: "done" }, [computedField("done", "checkbox")])).toBe(true);
    expect(isChartGroupColumn({ ...col("created", "computed"), computedKey: "created" }, [computedField("created", "date")])).toBe(true);
    expect(isChartGroupColumn(col("amount", "number"))).toBe(true);
    expect(isChartGroupColumn(col("budget", "currency"))).toBe(true);
    expect(isChartGroupColumn({ ...col("score", "computed"), computedKey: "score" }, [computedField("score", "number")])).toBe(true);
  });

  it("uses auto buckets for numeric chart group fields by default", () => {
    expect(getDefaultChartNumberBucket([col("amount", "number")], "amount")).toBe("auto");
    expect(getDefaultChartNumberBucket([{ ...col("score", "computed"), computedKey: "score" }], "score", [computedField("score", "number")])).toBe("auto");
    expect(getDefaultChartNumberBucket([col("status", "status")], "status")).toBeUndefined();
  });
  it("only treats number, currency, and numeric computed fields as chart value fields", () => {
    expect(isChartValueColumn(col("amount", "number"))).toBe(true);
    expect(isChartValueColumn(col("budget", "currency"))).toBe(true);
    expect(isChartValueColumn({ ...col("score", "computed"), computedKey: "score" }, [computedField("score", "number")])).toBe(true);
    expect(isChartValueColumn({ ...col("summary", "computed"), computedKey: "summary" }, [computedField("summary", "text")])).toBe(false);
    expect(isChartValueColumn(col("status", "status"))).toBe(false);
    expect(isChartValueColumn(col("done", "checkbox"))).toBe(false);
  });

  it("returns the first compatible non-file.name field as the default chart field", () => {
    expect(getDefaultChartField([
      col("file.name", "text"),
      col("title", "text"),
      col("status", "status"),
      col("category", "select"),
    ])).toBe("title");
    expect(getDefaultChartField([
      col("file.name", "text"),
      { ...col("formula.summary", "computed"), computedKey: "summary" },
      col("status", "status"),
    ], [computedField("summary", "text")])).toBe("formula.summary");
  });

  it("returns the first numeric non-file.name field as the default chart value field", () => {
    expect(getDefaultChartValueField([
      col("file.name", "text"),
      col("status", "status"),
      col("amount", "currency"),
      col("score", "number"),
    ])).toBe("amount");
    expect(getDefaultChartValueField([
      { ...col("summary", "computed"), computedKey: "summary" },
      { ...col("score", "computed"), computedKey: "score" },
    ], [computedField("summary", "text"), computedField("score", "number")])).toBe("score");
  });

  it("normalizes finite numeric values for chart and summary aggregation", () => {
    expect(toChartNumber(12)).toBe(12);
    expect(toChartNumber("12.5")).toBe(12.5);
    expect(toChartNumber("")).toBeNull();
    expect(toChartNumber("abc")).toBeNull();
    expect(toChartNumber(Number.NaN)).toBeNull();
  });

  it("reports noFields when the database has no compatible chart field", () => {
    const result = aggregateChart([row("a.md", {})], undefined, [
      col("file.name", "text"),
    ]);

    expect(result).toEqual({ points: [], emptyReason: "noFields" });
  });

  it("reports noFieldSelected when a compatible field exists but no field is selected", () => {
    const result = aggregateChart([row("a.md", { status: "todo" })], undefined, [
      col("status", "status"),
    ]);

    expect(result).toEqual({ points: [], emptyReason: "noFieldSelected" });
  });

  it("reports noRecords when the selected field is valid but filtered rows are empty", () => {
    const result = aggregateChart([], "status", [col("status", "status")]);

    expect(result).toEqual({ points: [], emptyReason: "noRecords" });
  });

  it("reports allGroupsHidden when every aggregated group is hidden", () => {
    const result = aggregateChart([
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
    ], "status", [col("status", "status")], {
      hiddenGroups: { todo: true, done: true },
    });

    expect(result).toEqual({ points: [], emptyReason: "allGroupsHidden" });
  });

  it("reports allGroupsHidden when every series chart group is hidden", () => {
    const result = aggregateSeriesChart([
      row("a.md", { status: "todo", priority: "high" }),
      row("b.md", { status: "done", priority: "low" }),
    ], "status", "priority", [
      col("status", "status"),
      col("priority", "select"),
    ], {
      hiddenGroups: { todo: true, done: true },
    });

    expect(result).toEqual({ keys: [], labels: [], series: [], emptyReason: "allGroupsHidden" });
  });

  it("counts select and status values using option order before count order", () => {
    const result = aggregateChart([
      row("a.md", { status: "done" }),
      row("b.md", { status: "todo" }),
      row("c.md", { status: "done" }),
    ], "status", [
      col("status", "status", [
        { value: "todo", color: "blue" },
        { value: "done", color: "green" },
      ]),
    ]);

    expect(result.points).toEqual([
      { key: "todo", label: "todo", value: 1 },
      { key: "done", label: "done", value: 2 },
    ]);
  });

  it("resolves numeric option indices to labels for select and status charts", () => {
    const result = aggregateChart([
      row("a.md", { status: 0 }),
      row("b.md", { status: 1 }),
      row("c.md", { status: "1" }),
    ], "status", [
      col("status", "status", [
        { value: "todo", color: "blue" },
        { value: "done", color: "green" },
      ]),
    ]);

    expect(result.points).toEqual([
      { key: "todo", label: "todo", value: 1 },
      { key: "done", label: "done", value: 2 },
    ]);
  });

  it("keeps numeric string option values when they are real labels", () => {
    const result = aggregateChart([
      row("a.md", { category: "0" }),
      row("b.md", { category: 1 }),
    ], "category", [
      col("category", "select", [
        { value: "0", color: "blue" },
        { value: "1", color: "green" },
        { value: "Later", color: "yellow" },
      ]),
    ]);

    expect(result.points).toEqual([
      { key: "0", label: "0", value: 1 },
      { key: "1", label: "1", value: 1 },
    ]);
  });

  it("counts multi-select rows once for each selected value", () => {
    const result = aggregateChart([
      row("a.md", { tags: ["design", "plugin"] }),
      row("b.md", { tags: ["plugin"] }),
    ], "tags", [col("tags", "multi-select")]);

    expect(result.points).toEqual([
      { key: "plugin", label: "plugin", value: 2 },
      { key: "design", label: "design", value: 1 },
    ]);
  });

  it("groups text, computed text, and file metadata fields", () => {
    expect(aggregateChart([
      row("Projects/a.md", { merchant: "A" }),
      row("Archive/b.md", { merchant: "B" }),
      row("Projects/c.md", { merchant: "A" }),
    ], "merchant", [col("merchant", "text")]).points).toEqual([
      { key: "A", label: "A", value: 2 },
      { key: "B", label: "B", value: 1 },
    ]);

    expect(aggregateChart([
      row("a.md", {}, { kind: "book" }),
      row("b.md", {}, { kind: "movie" }),
      row("c.md", {}, { kind: "book" }),
    ], "formula.kind", [{ ...col("formula.kind", "computed"), computedKey: "kind" }], {
      computedFields: [computedField("kind", "text")],
    }).points).toEqual([
      { key: "book", label: "book", value: 2 },
      { key: "movie", label: "movie", value: 1 },
    ]);

    expect(aggregateChart([
      row("Projects/a.md", {}),
      row("Archive/b.md", {}),
      row("Projects/c.md", {}),
    ], "file.folder", [col("file.folder", "text")]).points).toEqual([
      { key: "Projects", label: "Projects", value: 2 },
      { key: "Archive", label: "Archive", value: 1 },
    ]);
  });

  it("groups computed checkbox and computed date fields", () => {
    expect(aggregateChart([
      row("a.md", {}, { done: true }),
      row("b.md", {}, { done: false }),
      row("c.md", {}, { done: true }),
    ], "formula.done", [{ ...col("formula.done", "computed"), computedKey: "done" }], {
      computedFields: [computedField("done", "checkbox")],
    }).points).toEqual([
      { key: "No", label: "No", value: 1 },
      { key: "Yes", label: "Yes", value: 2 },
    ]);

    expect(aggregateChart([
      row("a.md", {}, { created: "2026-01-01" }),
      row("b.md", {}, { created: "2026-01-20" }),
      row("c.md", {}, { created: "2026-02-02" }),
    ], "formula.created", [{ ...col("formula.created", "computed"), computedKey: "created" }], {
      computedFields: [computedField("created", "date")],
      dateBucket: "month",
    }).points).toEqual([
      { key: "2026-01", label: "2026-01", value: 2 },
      { key: "2026-02", label: "2026-02", value: 1 },
    ]);
  });

  it("groups number and currency fields into fixed buckets", () => {
    const result = aggregateChart([
      row("a.md", { amount: 4 }),
      row("b.md", { amount: 12 }),
      row("c.md", { amount: 19 }),
      row("d.md", { amount: 21 }),
      row("e.md", { amount: "" }),
    ], "amount", [col("amount", "currency")], {
      numberBucket: "fixed",
      numberBucketSize: 10,
      uncategorizedLabel: "No amount",
    });

    expect(result.points).toEqual([
      { key: "__bucket__:0:10", label: "0 - 10", value: 1 },
      { key: "__bucket__:10:20", label: "10 - 20", value: 2 },
      { key: "__bucket__:20:30", label: "20 - 30", value: 1 },
      { key: "No amount", label: "No amount", value: 1 },
    ]);
  });

  it("groups numeric computed fields into automatic buckets", () => {
    const result = aggregateChart([
      row("a.md", {}, { score: 1 }),
      row("b.md", {}, { score: 2 }),
      row("c.md", {}, { score: 9 }),
    ], "formula.score", [{ ...col("formula.score", "computed"), computedKey: "score" }], {
      computedFields: [computedField("score", "number")],
      numberBucket: "auto",
    });

    expect(result.points).toEqual([
      { key: "__bucket__:1:2", label: "1 - 2", value: 1 },
      { key: "__bucket__:2:3", label: "2 - 3", value: 1 },
      { key: "__bucket__:9:10", label: "9 - 10", value: 1 },
    ]);
  });

  it("resolves numeric option indices inside multi-select values", () => {
    const result = aggregateChart([
      row("a.md", { tags: [0, 1] }),
      row("b.md", { tags: ["1"] }),
    ], "tags", [
      col("tags", "multi-select", [
        { value: "design", color: "blue" },
        { value: "plugin", color: "green" },
      ]),
    ]);

    expect(result.points).toEqual([
      { key: "design", label: "design", value: 1 },
      { key: "plugin", label: "plugin", value: 2 },
    ]);
  });

  it("resolves numeric option indices in stacked chart group and stack fields", () => {
    const result = aggregateStackedChart([
      row("a.md", { status: 0, priority: 1 }),
      row("b.md", { status: 1, priority: 0 }),
    ], "status", "priority", [
      col("status", "status", [
        { value: "todo", color: "blue" },
        { value: "done", color: "green" },
      ]),
      col("priority", "select", [
        { value: "low", color: "gray" },
        { value: "high", color: "red" },
      ]),
    ]);

    expect(result.labels).toEqual(["todo", "done"]);
    expect(result.series).toEqual([
      { key: "low", label: "low", values: [0, 1] },
      { key: "high", label: "high", values: [1, 0] },
    ]);
  });

  it("builds a reusable series matrix for grouped bar and multi-series line charts", () => {
    const result = aggregateSeriesChart([
      row("a.md", { status: "todo", assignee: "Ada", amount: 4 }),
      row("b.md", { status: "todo", assignee: "Grace", amount: 6 }),
      row("c.md", { status: "done", assignee: "Ada", amount: 8 }),
    ], "status", "assignee", [
      col("status", "status", [
        { value: "todo", color: "blue" },
        { value: "done", color: "green" },
      ]),
      col("assignee", "text"),
      col("amount", "number"),
    ], {
      aggregation: "sum",
      valueField: "amount",
    });

    expect(result.labels).toEqual(["todo", "done"]);
    expect(result.series).toEqual([
      { key: "Ada", label: "Ada", values: [4, 8] },
      { key: "Grace", label: "Grace", values: [6, 0] },
    ]);
  });

  it("normalizes percent stacked values per primary group", () => {
    const result = aggregateSeriesChart([
      row("a.md", { status: "todo", priority: "high" }),
      row("b.md", { status: "todo", priority: "high" }),
      row("c.md", { status: "todo", priority: "low" }),
      row("d.md", { status: "done", priority: "low" }),
    ], "status", "priority", [
      col("status", "status", [
        { value: "todo", color: "blue" },
        { value: "done", color: "green" },
      ]),
      col("priority", "select", [
        { value: "high", color: "red" },
        { value: "low", color: "gray" },
      ]),
    ], {
      percentStacked: true,
    });

    expect(result.series).toEqual([
      { key: "high", label: "high", values: [66.66666666666666, 0] },
      { key: "low", label: "low", values: [33.33333333333333, 100] },
    ]);
  });

  it("groups date fields by month in chronological order", () => {
    const result = aggregateChart([
      row("a.md", { created: "2026-03-03" }),
      row("b.md", { created: "2026-01-15" }),
      row("c.md", { created: "2026-03-20" }),
      row("d.md", { created: "" }),
    ], "created", [col("created", "date")], {
      dateBucket: "month",
      uncategorizedLabel: "No date",
    });

    expect(result.points).toEqual([
      { key: "2026-01", label: "2026-01", value: 1 },
      { key: "2026-03", label: "2026-03", value: 2 },
      { key: "No date", label: "No date", value: 1 },
    ]);
  });

  it("groups date fields by week, quarter, and year", () => {
    const columns = [col("created", "date")];
    const rows = [
      row("a.md", { created: "2026-01-01" }),
      row("b.md", { created: "2026-04-10" }),
      row("c.md", { created: "2027-02-02" }),
    ];

    expect(aggregateChart(rows, "created", columns, { dateBucket: "week" }).points.map((point) => point.key)).toEqual([
      "2026-W01",
      "2026-W15",
      "2027-W05",
    ]);
    expect(aggregateChart(rows, "created", columns, { dateBucket: "quarter" }).points.map((point) => point.key)).toEqual([
      "2026-Q1",
      "2026-Q2",
      "2027-Q1",
    ]);
    expect(aggregateChart(rows, "created", columns, { dateBucket: "year" }).points).toEqual([
      { key: "2026", label: "2026", value: 2 },
      { key: "2027", label: "2027", value: 1 },
    ]);
  });

  it("aggregates stacked bar series by primary group and stack field", () => {
    const result = aggregateStackedChart([
      row("a.md", { status: "todo", priority: "high" }),
      row("b.md", { status: "todo", priority: "low" }),
      row("c.md", { status: "done", priority: "high" }),
    ], "status", "priority", [col("status", "status"), col("priority", "select")]);

    expect(result.labels).toEqual(["todo", "done"]);
    expect(result.series).toEqual([
      { key: "high", label: "high", values: [1, 1] },
      { key: "low", label: "low", values: [1, 0] },
    ]);
  });

  it("aggregates stacked numeric values by date bucket", () => {
    const result = aggregateStackedChart([
      row("a.md", { created: "2026-01-02", priority: "high", amount: 4 }),
      row("b.md", { created: "2026-01-20", priority: "low", amount: 6 }),
      row("c.md", { created: "2026-02-01", priority: "high", amount: 3 }),
    ], "created", "priority", [col("created", "date"), col("priority", "select"), col("amount", "number")], {
      aggregation: "sum",
      valueField: "amount",
      dateBucket: "month",
    });

    expect(result.labels).toEqual(["2026-01", "2026-02"]);
    expect(result.series).toEqual([
      { key: "high", label: "high", values: [4, 3] },
      { key: "low", label: "low", values: [6, 0] },
    ]);
  });

  it("aggregates mixed chart bar and line series independently", () => {
    const result = aggregateMixedChart([
      row("a.md", { status: "todo", amount: 4, score: 1 }),
      row("b.md", { status: "todo", amount: 6, score: 3 }),
      row("c.md", { status: "done", amount: 5, score: 10 }),
    ], "status", [col("status", "status"), col("amount", "number"), col("score", "number")], {
      aggregation: "sum",
      valueField: "amount",
      secondaryAggregation: "avg",
      secondaryValueField: "score",
    });

    expect(result.labels).toEqual(["todo", "done"]);
    expect(result.series).toEqual([
      { key: "bar", label: "Sum", values: [10, 5] },
      { key: "line", label: "Average", values: [2, 10] },
    ]);
  });

  it("sums numeric values for each selected group", () => {
    const result = aggregateChart([
      row("a.md", { status: "todo", amount: 4 }),
      row("b.md", { status: "todo", amount: "6" }),
      row("c.md", { status: "done", amount: 3 }),
    ], "status", [col("status", "status"), col("amount", "number")], {
      aggregation: "sum",
      valueField: "amount",
    });

    expect(result.points).toEqual([
      { key: "todo", label: "todo", value: 10 },
      { key: "done", label: "done", value: 3 },
    ]);
  });

  it("averages only finite numeric values and ignores invalid values", () => {
    const result = aggregateChart([
      row("a.md", { status: "todo", amount: 4 }),
      row("b.md", { status: "todo", amount: "not a number" }),
      row("c.md", { status: "todo", amount: 8 }),
      row("d.md", { status: "done", amount: "" }),
    ], "status", [col("status", "status"), col("amount", "number")], {
      aggregation: "avg",
      valueField: "amount",
    });

    expect(result.points).toEqual([
      { key: "todo", label: "todo", value: 6 },
      { key: "done", label: "done", value: 0 },
    ]);
  });

  it("calculates min and max numeric values for each group", () => {
    const rows = [
      row("a.md", { status: "todo", amount: 4 }),
      row("b.md", { status: "todo", amount: 8 }),
      row("c.md", { status: "done", amount: 3 }),
    ];
    const columns = [col("status", "status"), col("amount", "number")];

    expect(aggregateChart(rows, "status", columns, {
      aggregation: "min",
      valueField: "amount",
    }).points).toEqual([
      { key: "todo", label: "todo", value: 4 },
      { key: "done", label: "done", value: 3 },
    ]);
    expect(aggregateChart(rows, "status", columns, {
      aggregation: "max",
      valueField: "amount",
    }).points).toEqual([
      { key: "todo", label: "todo", value: 8 },
      { key: "done", label: "done", value: 3 },
    ]);
  });

  it("calculates median and range numeric values for each group", () => {
    const rows = [
      row("a.md", { status: "todo", amount: 4 }),
      row("b.md", { status: "todo", amount: 10 }),
      row("c.md", { status: "todo", amount: 100 }),
      row("d.md", { status: "done", amount: 3 }),
      row("e.md", { status: "done", amount: 9 }),
    ];
    const columns = [col("status", "status", [
      { value: "todo", color: "blue" },
      { value: "done", color: "green" },
    ]), col("amount", "number")];

    expect(aggregateChart(rows, "status", columns, {
      aggregation: "median",
      valueField: "amount",
    }).points).toEqual([
      { key: "todo", label: "todo", value: 10 },
      { key: "done", label: "done", value: 6 },
    ]);
    expect(aggregateChart(rows, "status", columns, {
      aggregation: "range",
      valueField: "amount",
    }).points).toEqual([
      { key: "todo", label: "todo", value: 96 },
      { key: "done", label: "done", value: 6 },
    ]);
  });


  it("counts unique values for any selected value field", () => {
    const result = aggregateChart([
      row("a.md", { status: "todo", platform: "web" }),
      row("b.md", { status: "todo", platform: "mobile" }),
      row("c.md", { status: "todo", platform: "web" }),
      row("d.md", { status: "done", platform: "" }),
    ], "status", [col("status", "status", [
      { value: "todo", color: "blue" },
      { value: "done", color: "green" },
    ]), col("platform", "text")], {
      aggregation: "unique",
      valueField: "platform",
    });

    expect(result.points).toEqual([
      { key: "todo", label: "todo", value: 2 },
      { key: "done", label: "done", value: 0 },
    ]);
  });

  it("counts empty and not-empty values by group", () => {
    const rows = [
      row("a.md", { status: "todo", platform: "web" }),
      row("b.md", { status: "todo", platform: "" }),
      row("c.md", { status: "todo" }),
      row("d.md", { status: "done", platform: "mobile" }),
    ];
    const columns = [col("status", "status", [
      { value: "todo", color: "blue" },
      { value: "done", color: "green" },
    ]), col("platform", "text")];

    expect(aggregateChart(rows, "status", columns, {
      aggregation: "empty",
      valueField: "platform",
    }).points).toEqual([
      { key: "todo", label: "todo", value: 2 },
      { key: "done", label: "done", value: 0 },
    ]);
    expect(aggregateChart(rows, "status", columns, {
      aggregation: "not-empty",
      valueField: "platform",
    }).points).toEqual([
      { key: "todo", label: "todo", value: 1 },
      { key: "done", label: "done", value: 1 },
    ]);
  });

  it("calculates empty and not-empty percentages by group", () => {
    const result = aggregateChart([
      row("a.md", { status: "todo", platform: "web" }),
      row("b.md", { status: "todo", platform: "" }),
      row("c.md", { status: "todo" }),
      row("d.md", { status: "done", platform: "mobile" }),
    ], "status", [col("status", "status", [
      { value: "todo", color: "blue" },
      { value: "done", color: "green" },
    ]), col("platform", "text")], {
      aggregation: "percent-empty",
      valueField: "platform",
    });

    expect(result.points).toEqual([
      { key: "todo", label: "todo", value: (2 / 3) * 100 },
      { key: "done", label: "done", value: 0 },
    ]);
  });

  it("calculates checked, unchecked, and percent checked by group", () => {
    const rows = [
      row("a.md", { status: "todo", done: true }),
      row("b.md", { status: "todo", done: false }),
      row("c.md", { status: "todo", done: true }),
      row("d.md", { status: "done", done: false }),
      row("e.md", { status: "done" }),
    ];
    const columns = [col("status", "status", [
      { value: "todo", color: "blue" },
      { value: "done", color: "green" },
    ]), col("done", "checkbox")];

    expect(aggregateChart(rows, "status", columns, {
      aggregation: "checked",
      valueField: "done",
    }).points).toEqual([
      { key: "todo", label: "todo", value: 2 },
      { key: "done", label: "done", value: 0 },
    ]);
    expect(aggregateChart(rows, "status", columns, {
      aggregation: "unchecked",
      valueField: "done",
    }).points).toEqual([
      { key: "todo", label: "todo", value: 1 },
      { key: "done", label: "done", value: 1 },
    ]);
    expect(aggregateChart(rows, "status", columns, {
      aggregation: "percent-checked",
      valueField: "done",
    }).points).toEqual([
      { key: "todo", label: "todo", value: (2 / 3) * 100 },
      { key: "done", label: "done", value: 0 },
    ]);
  });

  it("applies numeric aggregations once per selected multi-select group", () => {
    const result = aggregateChart([
      row("a.md", { tags: ["design", "plugin"], amount: 10 }),
      row("b.md", { tags: ["plugin"], amount: 5 }),
    ], "tags", [col("tags", "multi-select"), col("amount", "currency")], {
      aggregation: "sum",
      valueField: "amount",
    });

    expect(result.points).toEqual([
      { key: "plugin", label: "plugin", value: 15 },
      { key: "design", label: "design", value: 10 },
    ]);
  });

  it("requires a numeric value field for non-count aggregations", () => {
    expect(aggregateChart([
      row("a.md", { status: "todo", amount: 4 }),
    ], "status", [col("status", "status"), col("amount", "text")], {
      aggregation: "sum",
      valueField: "amount",
    })).toEqual({ points: [], emptyReason: "noValueFieldSelected" });
    expect(aggregateChart([
      row("a.md", { status: "todo", amount: 4 }),
    ], "status", [col("status", "status"), col("amount", "number")], {
      aggregation: "sum",
    })).toEqual({ points: [], emptyReason: "noValueFieldSelected" });
    expect(aggregateChart([
      row("a.md", { status: "todo" }, { summary: "large" }),
    ], "status", [col("status", "status"), { ...col("summary", "computed"), computedKey: "summary" }], {
      aggregation: "sum",
      valueField: "summary",
      computedFields: [computedField("summary", "text")],
    })).toEqual({ points: [], emptyReason: "noValueFieldSelected" });
  });

  it("requires value fields compatible with each aggregation family", () => {
    expect(aggregateChart([
      row("a.md", { status: "todo", platform: "web" }),
    ], "status", [col("status", "status"), col("platform", "text")], {
      aggregation: "unique",
    })).toEqual({ points: [], emptyReason: "noValueFieldSelected" });
    expect(aggregateChart([
      row("a.md", { status: "todo", platform: "web" }),
    ], "status", [col("status", "status"), col("platform", "text")], {
      aggregation: "checked",
      valueField: "platform",
    })).toEqual({ points: [], emptyReason: "noValueFieldSelected" });
  });

  it("aggregates numeric computed fields when their computed definition is numeric", () => {
    const result = aggregateChart([
      row("a.md", { status: "todo" }, { score: 4 }),
      row("b.md", { status: "todo" }, { score: 6 }),
    ], "status", [col("status", "status"), { ...col("score", "computed"), computedKey: "score" }], {
      aggregation: "sum",
      valueField: "score",
      computedFields: [computedField("score", "number")],
    });

    expect(result.points).toEqual([{ key: "todo", label: "todo", value: 10 }]);
  });

  it("maps checkbox values to true, false, and uncategorized groups", () => {
    const result = aggregateChart([
      row("a.md", { done: true }),
      row("b.md", { done: false }),
      row("c.md", {}),
    ], "done", [col("done", "checkbox")], {
      uncategorizedLabel: "Empty",
    });

    expect(result.points).toEqual([
      { key: "No", label: "No", value: 1 },
      { key: "Yes", label: "Yes", value: 1 },
      { key: "Empty", label: "Empty", value: 1 },
    ]);
  });

  it("groups empty scalar and empty array values under the uncategorized label", () => {
    const result = aggregateChart([
      row("a.md", { category: "" }),
      row("b.md", {}),
      row("c.md", { category: [] }),
    ], "category", [col("category", "multi-select")], {
      uncategorizedLabel: "Empty",
    });

    expect(result.points).toEqual([
      { key: "Empty", label: "Empty", value: 3 },
    ]);
  });

  it("limits high-cardinality fields to maxGroups and merges overflow into Other", () => {
    const rows = Array.from({ length: 35 }, (_, index) => row(`${index}.md`, {
      category: `group-${String(index).padStart(2, "0")}`,
    }));

    const result = aggregateChart(rows, "category", [col("category", "select")], {
      maxGroups: 30,
      otherLabel: "Other",
    });

    expect(result.points).toHaveLength(31);
    expect(result.points.at(-1)).toEqual({ key: "__other__", label: "Other", value: 5 });
  });

  it("merges overflow groups using weighted average for avg aggregation", () => {
    const result = aggregateChart([
      row("a.md", { category: "visible", amount: 100 }),
      row("b.md", { category: "overflow-a", amount: 10 }),
      row("c.md", { category: "overflow-a", amount: 20 }),
      row("d.md", { category: "overflow-b", amount: 40 }),
    ], "category", [col("category", "select"), col("amount", "number")], {
      aggregation: "avg",
      valueField: "amount",
      maxGroups: 1,
      otherLabel: "Other",
    });

    expect(result.points).toEqual([
      { key: "visible", label: "visible", value: 100 },
      { key: "__other__", label: "Other", value: 70 / 3 },
    ]);
  });

  it("merges overflow groups using extrema for min and max aggregation", () => {
    const rows = [
      row("a.md", { category: "visible", amount: 100 }),
      row("b.md", { category: "overflow-a", amount: 10 }),
      row("c.md", { category: "overflow-a", amount: 20 }),
      row("d.md", { category: "overflow-b", amount: 40 }),
    ];
    const columns = [col("category", "select"), col("amount", "number")];

    expect(aggregateChart(rows, "category", columns, {
      aggregation: "min",
      valueField: "amount",
      maxGroups: 1,
      otherLabel: "Other",
    }).points.at(-1)).toEqual({ key: "__other__", label: "Other", value: 10 });
    expect(aggregateChart(rows, "category", columns, {
      aggregation: "max",
      valueField: "amount",
      maxGroups: 1,
      otherLabel: "Other",
    }).points.at(-1)).toEqual({ key: "__other__", label: "Other", value: 40 });
  });

  it("merges overflow groups using raw numeric values for median and range aggregation", () => {
    const rows = [
      row("a.md", { category: "visible", amount: 100 }),
      row("b.md", { category: "overflow-a", amount: 10 }),
      row("c.md", { category: "overflow-a", amount: 20 }),
      row("d.md", { category: "overflow-b", amount: 40 }),
      row("e.md", { category: "overflow-b", amount: 90 }),
    ];
    const columns = [col("category", "select", [
      { value: "visible", color: "blue" },
      { value: "overflow-a", color: "green" },
      { value: "overflow-b", color: "red" },
    ]), col("amount", "number")];

    expect(aggregateChart(rows, "category", columns, {
      aggregation: "median",
      valueField: "amount",
      maxGroups: 1,
      otherLabel: "Other",
    }).points.at(-1)).toEqual({ key: "__other__", label: "Other", value: 30 });
    expect(aggregateChart(rows, "category", columns, {
      aggregation: "range",
      valueField: "amount",
      maxGroups: 1,
      otherLabel: "Other",
    }).points.at(-1)).toEqual({ key: "__other__", label: "Other", value: 80 });
  });


  it("merges overflow groups for unique and percent aggregations", () => {
    const rows = [
      row("a.md", { category: "visible", platform: "web" }),
      row("b.md", { category: "overflow-a", platform: "web" }),
      row("c.md", { category: "overflow-a", platform: "mobile" }),
      row("d.md", { category: "overflow-b", platform: "" }),
    ];
    const columns = [col("category", "select", [
      { value: "visible", color: "blue" },
      { value: "overflow-a", color: "green" },
      { value: "overflow-b", color: "red" },
    ]), col("platform", "text")];

    expect(aggregateChart(rows, "category", columns, {
      aggregation: "unique",
      valueField: "platform",
      maxGroups: 1,
      otherLabel: "Other",
    }).points.at(-1)).toEqual({ key: "__other__", label: "Other", value: 2 });
    expect(aggregateChart(rows, "category", columns, {
      aggregation: "percent-empty",
      valueField: "platform",
      maxGroups: 1,
      otherLabel: "Other",
    }).points.at(-1)).toEqual({ key: "__other__", label: "Other", value: (1 / 3) * 100 });
  });

  it("aggregates 1000 records within the MVP performance budget", () => {
    const rows = Array.from({ length: 1000 }, (_, index) => row(`${index}.md`, {
      category: `group-${index % 12}`,
    }));
    const start = performance.now();

    const result = aggregateChart(rows, "category", [col("category", "select")]);
    const elapsed = performance.now() - start;

    expect(result.points.reduce((sum, point) => sum + point.value, 0)).toBe(1000);
    expect(elapsed).toBeLessThan(100);
  });
});
