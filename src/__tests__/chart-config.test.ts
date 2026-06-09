import { describe, expect, it, vi } from "vitest";
import { updateColumnKeyReferences } from "../data/ColumnConfig";
import { DataSource } from "../data/DataSource";
import { ViewConfig } from "../data/types";

vi.mock("obsidian", () => ({
  App: class {},
  TFile: class {},
  EventRef: class {},
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
  stringifyYaml: (value: unknown) => JSON.stringify(value),
}));

function createDataSourceForParsing(): DataSource {
  return Object.create(DataSource.prototype) as DataSource;
}

function baseView(): ViewConfig {
  return {
    id: "view-1",
    name: "Chart",
    viewType: "table",
    sourceFolder: "",
    schema: {
      columns: [
        { key: "status", label: "Status", type: "status" },
        { key: "kind", label: "Kind", type: "select" },
      ],
      computedFields: [],
    },
  };
}

describe("chart view configuration", () => {
  it("parses persisted chart views without falling back to table", () => {
    const dataSource = createDataSourceForParsing();

    const config = dataSource.parseDatabaseConfig({
      db_view: true,
      database: {
        id: "db",
        name: "DB",
        columns: baseView().schema.columns,
        computedFields: [],
        views: [{
          id: "chart-view",
          name: "By status",
          viewType: "chart",
          chartType: "pie",
          chartGroupField: "status",
          chartDateBucket: "quarter",
          chartNumberBucket: "fixed",
          chartNumberBucketSize: 25,
          chartStackField: "kind",
          chartSeriesField: "kind",
          chartAggregation: "sum",
          chartValueField: "amount",
          chartSecondaryAggregation: "avg",
          chartSecondaryValueField: "score",
          chartTitle: "Custom chart",
          chartDonutCenterMode: "aggregation",
          chartValueAxisRange: "custom",
          chartValueAxisMin: 0,
          chartValueAxisMax: 100,
          chartReferenceLines: [
            { id: "goal", type: "constant", value: 75, label: "Goal", color: "blue", style: "dashed" },
            { id: "avg", type: "average", label: "Average" },
          ],
        }],
      },
    });

    expect(config?.views[0].viewType).toBe("chart");
    expect(config?.views[0].chartType).toBe("pie");
    expect(config?.views[0].chartGroupField).toBe("status");
    expect(config?.views[0].chartDateBucket).toBe("quarter");
    expect(config?.views[0].chartNumberBucket).toBe("fixed");
    expect(config?.views[0].chartNumberBucketSize).toBe(25);
    expect(config?.views[0].chartStackField).toBe("kind");
    expect(config?.views[0].chartSeriesField).toBe("kind");
    expect(config?.views[0].chartAggregation).toBe("sum");
    expect(config?.views[0].chartValueField).toBe("amount");
    expect(config?.views[0].chartSecondaryAggregation).toBe("avg");
    expect(config?.views[0].chartSecondaryValueField).toBe("score");
    expect(config?.views[0].chartTitle).toBe("Custom chart");
    expect(config?.views[0].chartDonutCenterMode).toBe("aggregation");
    expect(config?.views[0].chartValueAxisRange).toBe("custom");
    expect(config?.views[0].chartValueAxisMin).toBe(0);
    expect(config?.views[0].chartValueAxisMax).toBe(100);
    expect(config?.views[0].chartReferenceLines).toEqual([
      { id: "goal", type: "constant", value: 75, label: "Goal", color: "blue", style: "dashed" },
      { id: "avg", type: "average", label: "Average", style: "solid" },
    ]);
  });

  it("serializes chart view fields into the database payload", () => {
    const dataSource = createDataSourceForParsing();
    const view = {
      ...baseView(),
      viewType: "chart",
      chartType: "line",
      chartGroupField: "kind",
      chartDateBucket: "month",
      chartNumberBucket: "auto",
      chartNumberBucketSize: 10,
      chartStackField: "status",
      chartSeriesField: "status",
      chartAggregation: "avg",
      chartValueField: "amount",
      chartSecondaryAggregation: "max",
      chartSecondaryValueField: "score",
      chartTitle: "Revenue trend",
      chartDonutCenterMode: "total",
      chartValueAxisRange: "zero-based",
      chartValueAxisMin: 0,
      chartValueAxisMax: 500,
      chartReferenceLines: [
        { id: "target", type: "constant", value: 300, label: "Target", color: "green", style: "solid" },
      ],
    } satisfies ViewConfig;

    const payload = (dataSource as unknown as {
      toViewPayload(view: ViewConfig): Record<string, unknown>;
    }).toViewPayload(view);

    expect(payload).toMatchObject({
      viewType: "chart",
      chartType: "line",
      chartGroupField: "kind",
      chartDateBucket: "month",
      chartNumberBucket: "auto",
      chartNumberBucketSize: 10,
      chartStackField: "status",
      chartSeriesField: "status",
      chartAggregation: "avg",
      chartValueField: "amount",
      chartSecondaryAggregation: "max",
      chartSecondaryValueField: "score",
      chartTitle: "Revenue trend",
      chartDonutCenterMode: "total",
      chartValueAxisRange: "zero-based",
      chartValueAxisMin: 0,
      chartValueAxisMax: 500,
      chartReferenceLines: [
        { id: "target", type: "constant", value: 300, label: "Target", color: "green", style: "solid" },
      ],
    });
  });

  it("parses and serializes extended chart aggregations", () => {
    const dataSource = createDataSourceForParsing();
    const config = dataSource.parseDatabaseConfig({
      db_view: true,
      database: {
        id: "db",
        name: "DB",
        columns: baseView().schema.columns,
        computedFields: [],
        views: [{
          id: "chart-view",
          name: "By status",
          viewType: "chart",
          chartAggregation: "range",
          chartValueField: "kind",
          chartSecondaryAggregation: "median",
          chartSecondaryValueField: "done",
        }],
      },
    });

    expect(config?.views[0].chartAggregation).toBe("range");
    expect(config?.views[0].chartSecondaryAggregation).toBe("median");

    const payload = (dataSource as unknown as {
      toViewPayload(view: ViewConfig): Record<string, unknown>;
    }).toViewPayload({
      ...baseView(),
      viewType: "chart",
      chartAggregation: "unique",
      chartValueField: "kind",
      chartSecondaryAggregation: "checked",
      chartSecondaryValueField: "done",
    });

    expect(payload.chartAggregation).toBe("unique");
    expect(payload.chartSecondaryAggregation).toBe("checked");
  });

  it("maps legacy donut center visibility to total mode", () => {
    const dataSource = createDataSourceForParsing();
    const config = dataSource.parseDatabaseConfig({
      db_view: true,
      database: {
        id: "db",
        name: "DB",
        columns: baseView().schema.columns,
        computedFields: [],
        views: [{
          id: "chart-view",
          name: "Donut",
          viewType: "chart",
          chartType: "donut",
          chartShowDonutCenter: true,
        }],
      },
    });

    expect(config?.views[0].chartShowDonutCenter).toBe(true);
    expect(config?.views[0].chartDonutCenterMode).toBe("total");
  });

  it("updates chartGroupField when a column key is renamed", () => {
    const view = {
      ...baseView(),
      viewType: "chart",
      chartGroupField: "status",
    } satisfies ViewConfig;

    const changed = updateColumnKeyReferences(view, undefined, "status", "state");

    expect(changed).toBe(true);
    expect(view.chartGroupField).toBe("state");
  });

  it("updates chartValueField when a numeric column key is renamed", () => {
    const view = {
      ...baseView(),
      viewType: "chart",
      chartGroupField: "status",
      chartAggregation: "sum",
      chartValueField: "amount",
    } satisfies ViewConfig;

    const changed = updateColumnKeyReferences(view, undefined, "amount", "budget");

    expect(changed).toBe(true);
    expect(view.chartValueField).toBe("budget");
  });

  it("updates chartSecondaryValueField when a secondary numeric column key is renamed", () => {
    const view = {
      ...baseView(),
      viewType: "chart",
      chartGroupField: "status",
      chartSecondaryAggregation: "sum",
      chartSecondaryValueField: "amount",
    } satisfies ViewConfig;

    const changed = updateColumnKeyReferences(view, undefined, "amount", "budget");

    expect(changed).toBe(true);
    expect(view.chartSecondaryValueField).toBe("budget");
  });

  it("updates chartStackField when a stack column key is renamed", () => {
    const view = {
      ...baseView(),
      viewType: "chart",
      chartGroupField: "status",
      chartStackField: "kind",
    } satisfies ViewConfig;

    const changed = updateColumnKeyReferences(view, undefined, "kind", "type");

    expect(changed).toBe(true);
    expect(view.chartStackField).toBe("type");
  });

  it("updates chartSeriesField when a series column key is renamed", () => {
    const view = {
      ...baseView(),
      viewType: "chart",
      chartGroupField: "status",
      chartSeriesField: "kind",
    } satisfies ViewConfig;

    const changed = updateColumnKeyReferences(view, undefined, "kind", "type");

    expect(changed).toBe(true);
    expect(view.chartSeriesField).toBe("type");
  });
});
