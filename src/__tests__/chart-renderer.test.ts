import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { ChartRenderer } from "../views/ChartRenderer";
import { ColumnDef, RowData, ViewConfig } from "../data/types";
import { ChartType } from "../data/types";

interface ChartJsTooltipContext {
  parsed: number | { x?: number; y?: number };
}

interface ChartPluginSnapshot {
  id: string;
  mode?: string;
}

interface ChartJsConfigSnapshot {
  type: string;
  data: {
    labels: Array<string | string[]>;
    datasets: Array<{
      type?: string;
      label: string;
      data: number[];
      fill?: boolean;
      backgroundColor?: string | string[];
      hoverBackgroundColor?: string | string[];
      borderColor?: string | string[];
    }>;
  };
  plugins?: ChartPluginSnapshot[];
  options: {
    indexAxis?: string;
    onClick?: (event: unknown, elements: unknown[]) => void;
    plugins: {
      tooltip: {
        callbacks: {
          label(context: ChartJsTooltipContext): string;
          title?(items: Array<{ dataIndex?: number }>): string;
        };
      };
    };
    scales: {
      x: {
        stacked?: boolean;
        min?: number;
        max?: number;
        ticks: {
          callback?(value: number, index?: number): string;
        };
      };
      y: {
        stacked?: boolean;
        min?: number;
        max?: number;
        ticks: {
          callback(value: number): string;
          precision?: number;
        };
      };
    };
  };
}

const { chartDestroy, chartResize, chartUpdate, chartCtor, observe, disconnect } = vi.hoisted(() => {
  const destroy = vi.fn();
  const resize = vi.fn();
  const update = vi.fn();
  const ctor = vi.fn(function ChartMock(_canvas: unknown, _config: unknown) {
    return {
      data: { labels: [] as string[], datasets: [{ data: [] as number[] }] },
      destroy,
      resize,
      update,
    };
  });
  (ctor as typeof ctor & { register: ReturnType<typeof vi.fn> }).register = vi.fn();
  return {
    chartDestroy: destroy,
    chartResize: resize,
    chartUpdate: update,
    chartCtor: ctor as typeof ctor & { register: ReturnType<typeof vi.fn> },
    observe: vi.fn(),
    disconnect: vi.fn(),
  };
});

vi.mock("chart.js", () => ({
  Chart: chartCtor,
  ArcElement: class {},
  BarController: class {},
  BarElement: class {},
  CategoryScale: class {},
  DoughnutController: class {},
  Filler: class {},
  Legend: class {},
  LinearScale: class {},
  LineController: class {},
  LineElement: class {},
  PieController: class {},
  PointElement: class {},
  Tooltip: class {},
}));

vi.mock("obsidian", () => ({
  setIcon: () => undefined,
  Modal: class {
    contentEl = {
      empty: () => undefined,
      addClass: () => undefined,
      createEl: () => ({ onclick: undefined }),
      createDiv: () => ({ onclick: undefined, createSpan: () => undefined }),
    };
    app: unknown = {};
    constructor(app: unknown) {
      this.app = app;
    }
    open(): void {}
    close(): void {}
  },
}));

class FakeClassList {
  private values = new Set<string>();

  add(...classes: string[]): void {
    for (const cls of classes.flatMap((item) => item.split(/\s+/).filter(Boolean))) this.values.add(cls);
  }

  contains(cls: string): boolean {
    return this.values.has(cls);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly style = new Map<string, string>();
  isConnected = true;
  textContent = "";
  parent: FakeElement | null = null;
  ownerDocument: { body: FakeElement; defaultView: Record<string, unknown> };

  constructor(readonly tagName: string, ownerDocument?: { body: FakeElement; defaultView: Record<string, unknown> }) {
    this.ownerDocument = ownerDocument || { body: this, defaultView: {} };
  }

  addClass(cls: string): void {
    this.classList.add(cls);
  }

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.createEl("div", options);
  }

  createEl(tagName: string, options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(tagName, this.ownerDocument);
    child.parent = this;
    if (options?.cls) child.addClass(options.cls);
    if (options?.text) child.textContent = options.text;
    this.children.push(child);
    return child;
  }

  get parentElement(): FakeElement | null {
    return this.parent;
  }

  insertBefore(child: FakeElement, anchor: FakeElement): void {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    const index = this.children.indexOf(anchor);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const classes = selector.split(",").map((part) => part.trim().replace(/^\./, ""));
    return this.findAll((element) => classes.some((cls) => element.classList.contains(cls)));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector.replace(/^:scope > /, ""))[0] || null;
  }

  private findAll(predicate: (element: FakeElement) => boolean): FakeElement[] {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap((child) => child.findAll(predicate)),
    ];
  }
}

function row(path: string, frontmatter: Record<string, unknown>): RowData {
  return {
    file: { path, name: path.split("/").pop() || path } as RowData["file"],
    frontmatter,
    computed: {},
  };
}

function column(): ColumnDef {
  return { key: "status", label: "Status", type: "status" };
}

function config(): ViewConfig {
  return {
    name: "Chart",
    sourceFolder: "",
    viewType: "chart",
    chartGroupField: "status",
    schema: { columns: [column()], computedFields: [] },
  };
}

describe("ChartRenderer", () => {
  it("destroys, resizes, and rebuilds chart instances across lifecycle calls", () => {
    chartCtor.mockClear();
    chartDestroy.mockClear();
    chartResize.mockClear();
    chartUpdate.mockClear();
    observe.mockClear();
    disconnect.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({
        getPropertyValue: (name: string) => name === "--interactive-accent-rgb" ? "10, 20, 30" : "",
      }),
      ResizeObserver: class {
        observe = observe;
        disconnect = disconnect;
      },
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();

    renderer.render(container as unknown as HTMLElement, config(), [
      row("a.md", { status: "todo" }),
    ], [column()]);
    renderer.resize();
    renderer.refreshTheme();
    renderer.destroy();

    expect(chartCtor).toHaveBeenCalledTimes(2);
    expect(chartResize).toHaveBeenCalledTimes(1);
    expect(chartDestroy).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("rebuilds with fresh theme colors after css-change refresh", () => {
    chartCtor.mockClear();
    chartDestroy.mockClear();
    const theme: Record<string, string> = {
      "--interactive-accent": "#111111",
      "--text-normal": "#222222",
      "--text-muted": "#666666",
      "--background-modifier-border": "#dddddd",
      "--background-primary": "#ffffff",
    };
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({
        getPropertyValue: (name: string) => theme[name] || "",
      }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();

    renderer.render(container as unknown as HTMLElement, config(), [
      row("a.md", { status: "todo" }),
    ], [column()]);
    theme["--interactive-accent"] = "#eeeeee";
    renderer.refreshTheme();

    const firstConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    const secondConfig = chartCtor.mock.calls[1]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(firstConfig?.data.datasets[0]?.backgroundColor).toBe("#111111");
    expect(secondConfig?.data.datasets[0]?.backgroundColor).toBe("#eeeeee");
    expect(chartDestroy).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".db-chart-canvas")).toHaveLength(1);
  });

  it("updates an existing chart without rebuilding or replaying bar animation on normal refresh", () => {
    chartCtor.mockClear();
    chartDestroy.mockClear();
    chartUpdate.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const cfg = config();

    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { status: "todo" }),
    ], [column()]);
    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
    ], [column()]);

    expect(chartCtor).toHaveBeenCalledTimes(1);
    expect(chartDestroy).not.toHaveBeenCalled();
    expect(chartUpdate).toHaveBeenCalledWith("none");
    expect(container.querySelectorAll(".db-chart-canvas")).toHaveLength(1);
    const chartOptions = chartCtor.mock.calls[0]?.[1] as { options: { animation: boolean } } | undefined;
    expect(chartOptions?.options.animation).toBe(false);
  });

  it("keeps rebuilt chart roots before an existing summary row", () => {
    chartCtor.mockClear();
    chartDestroy.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const cfg = config();

    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { status: "todo" }),
    ], [column()]);
    const summary = container.createDiv({ cls: "db-summary" });
    renderer.render(container as unknown as HTMLElement, { ...cfg, chartType: "number" }, [
      row("a.md", { status: "todo" }),
    ], [column()]);

    expect(container.children.indexOf(container.querySelector(".db-chart-number")!)).toBeLessThan(container.children.indexOf(summary));
  });

  it("destroys the chart and observer when a refresh moves into an empty state", () => {
    chartCtor.mockClear();
    chartDestroy.mockClear();
    observe.mockClear();
    disconnect.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
      ResizeObserver: class {
        observe = observe;
        disconnect = disconnect;
      },
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const cfg = config();

    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
    ], [column()]);
    renderer.render(container as unknown as HTMLElement, {
      ...cfg,
      chartHiddenGroups: { todo: true, done: true },
    }, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
    ], [column()]);

    expect(chartCtor).toHaveBeenCalledTimes(1);
    expect(chartDestroy).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".db-chart-canvas")).toHaveLength(0);
    expect(container.querySelectorAll(".db-chart-empty")).toHaveLength(1);
  });

  it("passes non-count aggregation data and formatted labels to Chart.js", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const cfg: ViewConfig = {
      ...config(),
      chartAggregation: "sum",
      chartValueField: "amount",
      schema: {
        columns: [column(), { key: "amount", label: "Amount", type: "currency" }],
        computedFields: [],
      },
    };

    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { status: "todo", amount: 4 }),
      row("b.md", { status: "todo", amount: 6.25 }),
    ], cfg.schema.columns);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.datasets[0].label).toBe("Sum");
    expect(chartConfig?.data.datasets[0].data).toEqual([10.25]);
    expect(chartConfig?.options.plugins.tooltip.callbacks.label({ parsed: { y: 10.256 } })).toBe("Sum: 10.26");
    expect(chartConfig?.options.scales.y.ticks.callback(10.256)).toBe("10.26");
    expect(chartConfig?.options.scales.y.ticks.precision).toBeUndefined();
  });

  it("passes option labels to Chart.js and formats category ticks from labels", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const columns: ColumnDef[] = [
      {
        key: "status",
        label: "Status",
        type: "status",
        statusOptions: [
          { value: "todo", color: "blue" },
          { value: "done", color: "green" },
        ],
      },
    ];

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      schema: { columns, computedFields: [] },
    }, [
      row("a.md", { status: 0 }),
      row("b.md", { status: 1 }),
    ], columns);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.labels).toEqual(["todo", "done"]);
    expect(chartConfig?.options.scales.x.ticks.callback?.(0, 0)).toBe("todo");
    expect(chartConfig?.options.scales.x.ticks.callback?.(1, 1)).toBe("done");
  });

  it("renders line, area, pie, and horizontal bar chart configs", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const chartTypes: Array<{ type: ChartType; chartJsType: string; fill?: boolean; indexAxis?: string }> = [
      { type: "line", chartJsType: "line", fill: false },
      { type: "area", chartJsType: "line", fill: true },
      { type: "pie", chartJsType: "pie", fill: undefined },
      { type: "horizontal-bar", chartJsType: "bar", fill: undefined, indexAxis: "y" },
    ];

    for (const item of chartTypes) {
      const container = new FakeElement("div", body.ownerDocument);
      const renderer = new ChartRenderer();
      renderer.render(container as unknown as HTMLElement, {
        ...config(),
        chartType: item.type,
      }, [
        row("a.md", { status: "todo" }),
      ], [column()]);
      const chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
      expect(chartConfig?.type).toBe(item.chartJsType);
      if (item.fill != null) expect(chartConfig?.data.datasets[0].fill).toBe(item.fill);
      if (item.indexAxis) expect(chartConfig?.options.indexAxis).toBe(item.indexAxis);
    }
  });

  it("renders stacked bar charts with multiple datasets and stacked scales", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const columns: ColumnDef[] = [column(), { key: "priority", label: "Priority", type: "select" }];

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartType: "stacked-bar",
      chartStackField: "priority",
      schema: { columns, computedFields: [] },
    }, [
      row("a.md", { status: "todo", priority: "high" }),
      row("b.md", { status: "done", priority: "low" }),
    ], columns);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.type).toBe("bar");
    expect(chartConfig?.data.datasets.map((dataset) => dataset.label)).toEqual(["high", "low"]);
    expect(chartConfig?.options.scales.x.stacked).toBe(true);
    expect(chartConfig?.options.scales.y.stacked).toBe(true);
  });

  it("renders grouped and percent stacked bar charts from series data", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const columns: ColumnDef[] = [column(), { key: "priority", label: "Priority", type: "select" }];

    const groupedContainer = new FakeElement("div", body.ownerDocument);
    new ChartRenderer().render(groupedContainer as unknown as HTMLElement, {
      ...config(),
      chartType: "grouped-bar",
      chartSeriesField: "priority",
      schema: { columns, computedFields: [] },
    }, [
      row("a.md", { status: "todo", priority: "high" }),
      row("b.md", { status: "done", priority: "low" }),
    ], columns);

    let chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.type).toBe("bar");
    expect(chartConfig?.data.datasets.map((dataset) => dataset.label)).toEqual(["high", "low"]);
    expect(chartConfig?.options.scales.x.stacked).toBe(false);
    expect(chartConfig?.options.scales.y.stacked).toBe(false);

    const percentContainer = new FakeElement("div", body.ownerDocument);
    new ChartRenderer().render(percentContainer as unknown as HTMLElement, {
      ...config(),
      chartType: "percent-stacked-bar",
      chartSeriesField: "priority",
      schema: { columns, computedFields: [] },
    }, [
      row("a.md", { status: "todo", priority: "high" }),
      row("b.md", { status: "todo", priority: "low" }),
    ], columns);

    chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.options.scales.x.stacked).toBe(true);
    expect(chartConfig?.options.scales.y.stacked).toBe(true);
    expect(chartConfig?.options.scales.y.max).toBe(100);
  });

  it("renders multi-series line charts from the series field", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const columns: ColumnDef[] = [column(), { key: "priority", label: "Priority", type: "select" }];

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartType: "line",
      chartSeriesField: "priority",
      schema: { columns, computedFields: [] },
    }, [
      row("a.md", { status: "todo", priority: "high" }),
      row("b.md", { status: "done", priority: "low" }),
    ], columns);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.type).toBe("line");
    expect(chartConfig?.data.datasets.map((dataset) => dataset.type)).toEqual(["line", "line"]);
    expect(chartConfig?.data.datasets.map((dataset) => dataset.label)).toEqual(["high", "low"]);
  });

  it("applies custom value axis range and reference line plugin", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const columns: ColumnDef[] = [
      column(),
      { key: "amount", label: "Amount", type: "number" },
    ];

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartAggregation: "sum",
      chartValueField: "amount",
      chartValueAxisRange: "custom",
      chartValueAxisMin: 5,
      chartValueAxisMax: 20,
      chartReferenceLines: [
        { id: "goal", type: "constant", value: 10, label: "Goal", color: "red", style: "dashed" },
        { id: "avg", type: "average", label: "Average" },
      ],
      schema: { columns, computedFields: [] },
    }, [
      row("a.md", { status: "todo", amount: 4 }),
      row("b.md", { status: "done", amount: 16 }),
    ], columns);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.options.scales.y.min).toBe(5);
    expect(chartConfig?.options.scales.y.max).toBe(20);
    expect(chartConfig?.plugins?.map((plugin) => plugin.id)).toContain("noteDatabaseReferenceLines");
  });

  it("shows invalid custom axis ranges for axis charts and ignores axes for donut charts", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartValueAxisRange: "custom",
      chartValueAxisMin: 20,
      chartValueAxisMax: 5,
    }, [
      row("a.md", { status: "todo" }),
    ], [column()]);

    expect(chartCtor).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".db-chart-empty-text").map((el) => el.textContent)).toEqual([
      "Enter a value-axis maximum greater than the minimum.",
    ]);

    const donutContainer = new FakeElement("div", body.ownerDocument);
    renderer.render(donutContainer as unknown as HTMLElement, {
      ...config(),
      chartType: "donut",
      chartValueAxisRange: "custom",
      chartValueAxisMin: 0,
      chartValueAxisMax: 10,
      chartReferenceLines: [{ id: "goal", type: "constant", value: 5 }],
    }, [
      row("b.md", { status: "done" }),
    ], [column()]);

    const chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.options.scales).toEqual({});
    expect(chartConfig?.plugins?.map((plugin) => plugin.id)).not.toContain("noteDatabaseReferenceLines");
  });

  it("uses status option colors when the chart palette is option-based", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const statusColumn: ColumnDef = {
      key: "status",
      label: "Status",
      type: "status",
      statusOptions: [
        { value: "todo", color: "blue" },
        { value: "done", color: "red" },
      ],
    };

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartColorPalette: "option",
      schema: { columns: [statusColumn], computedFields: [] },
    }, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
    ], [statusColumn]);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.datasets[0].backgroundColor).toEqual(["#2f6fad", "#d44c47"]);
  });

  it("uses the explicit colorful palette without replacing the first color with accent", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartColorPalette: "colorful",
    }, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
    ], [column()]);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.datasets[0].backgroundColor).toEqual(["#F9ED69", "#F08A5D"]);
  });

  it("uses preset chart palettes for grouped chart colors", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartColorPalette: "pastel",
    }, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
      row("c.md", { status: "later" }),
    ], [column()]);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.datasets[0].backgroundColor).toEqual(["#B1B2FF", "#AAC4FF", "#D2DAFF"]);
  });

  it("uses a neutral tag palette for file.tags without reading status options", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const tagColumn: ColumnDef = {
      key: "file.tags",
      label: "Tags",
      type: "multi-select",
      statusOptions: [{ value: "work", color: "red" }],
    };

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartGroupField: "file.tags",
      chartColorPalette: "option",
      schema: { columns: [tagColumn], computedFields: [] },
    }, [
      row("a.md", { tags: ["work"] }),
      row("b.md", { tags: ["life"] }),
    ], [tagColumn]);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.datasets[0].backgroundColor).toEqual(["#64748b", "#94a3b8"]);
  });

  it("uses value intensity colors for single-series bar charts", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: (name: string) => name === "--interactive-accent-rgb" ? "59, 130, 246" : "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartColorByValue: true,
    }, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "todo" }),
      row("c.md", { status: "done" }),
    ], [column()]);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.datasets[0].backgroundColor).toEqual([
      "rgba(59, 130, 246, 0.85)",
      "rgba(59, 130, 246, 0.35)",
    ]);
  });

  it("wraps long category labels while tooltip titles keep the full label", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const longLabel = "A very long customer segment name";

    renderer.render(container as unknown as HTMLElement, config(), [
      row("a.md", { status: longLabel }),
    ], [column()]);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.labels[0]).toEqual(["A very long", "customer segment", "name"]);
    expect(chartConfig?.options.plugins.tooltip.callbacks.title?.([{ dataIndex: 0 }])).toBe(longLabel);
  });

  it("truncates overlong wrapped label lines without changing tooltip titles", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const longLabel = "Priority Supercalifragilisticexpialidocious";

    renderer.render(container as unknown as HTMLElement, config(), [
      row("a.md", { status: longLabel }),
    ], [column()]);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.data.labels[0]).toEqual(["Priority", "Supercalifragi…"]);
    expect(chartConfig?.options.plugins.tooltip.callbacks.title?.([{ dataIndex: 0 }])).toBe(longLabel);
  });

  it("configures donut center modes for total, aggregation, and hidden", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const renderer = new ChartRenderer();
    const container = new FakeElement("div", body.ownerDocument);

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartType: "donut",
      chartShowDonutCenter: true,
      chartDonutCenterMode: "total",
    }, [
      row("a.md", { status: "todo" }),
    ], [column()]);
    let chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.plugins?.find((plugin) => plugin.id === "noteDatabaseDonutCenter")?.mode).toBe("total");

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartType: "donut",
      chartAggregation: "avg",
      chartValueField: "amount",
      chartDonutCenterMode: "aggregation",
      schema: { columns: [column(), { key: "amount", label: "Amount", type: "number" }], computedFields: [] },
    }, [
      row("b.md", { status: "todo", amount: 4 }),
      row("c.md", { status: "done", amount: 8 }),
    ], [column(), { key: "amount", label: "Amount", type: "number" }]);
    chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.plugins?.find((plugin) => plugin.id === "noteDatabaseDonutCenter")?.mode).toBe("aggregation");

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartType: "donut",
      chartDonutCenterMode: "hidden",
    }, [
      row("d.md", { status: "later" }),
    ], [column()]);
    chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.plugins?.find((plugin) => plugin.id === "noteDatabaseDonutCenter")?.mode).toBe("hidden");
  });

  it("renders mixed charts as bar and line datasets", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const container = new FakeElement("div", body.ownerDocument);
    const renderer = new ChartRenderer();
    const columns: ColumnDef[] = [
      column(),
      { key: "amount", label: "Amount", type: "number" },
      { key: "score", label: "Score", type: "number" },
    ];

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartType: "mixed",
      chartAggregation: "sum",
      chartValueField: "amount",
      chartSecondaryAggregation: "avg",
      chartSecondaryValueField: "score",
      schema: { columns, computedFields: [] },
    }, [
      row("a.md", { status: "todo", amount: 4, score: 2 }),
      row("b.md", { status: "todo", amount: 6, score: 6 }),
    ], columns);

    const chartConfig = chartCtor.mock.calls[0]?.[1] as ChartJsConfigSnapshot | undefined;
    expect(chartConfig?.type).toBe("bar");
    expect(chartConfig?.data.datasets.map((dataset) => dataset.label)).toEqual(["Sum", "Average"]);
    expect(chartConfig?.data.datasets.map((dataset) => dataset.data)).toEqual([[10], [4]]);
  });

  it("emits chart click filters for category and date bucket points", () => {
    chartCtor.mockClear();
    const body = new FakeElement("body");
    body.ownerDocument.defaultView = {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    };
    const renderer = new ChartRenderer();
    const onFilter = vi.fn();
    const container = new FakeElement("div", body.ownerDocument);

    renderer.render(container as unknown as HTMLElement, config(), [
      row("a.md", { status: "todo" }),
    ], [column()], { onFilter });
    let chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    chartConfig?.options.onClick?.({}, [{ index: 0 }]);
    expect(onFilter).toHaveBeenLastCalledWith([{ field: "status", op: "eq", value: "todo" }]);

    const dateRenderer = new ChartRenderer();
    const dateColumn: ColumnDef = { key: "created", label: "Created", type: "date" };
    const dateContainer = new FakeElement("div", body.ownerDocument);
    dateRenderer.render(dateContainer as unknown as HTMLElement, {
      ...config(),
      chartGroupField: "created",
      chartDateBucket: "month",
      schema: { columns: [dateColumn], computedFields: [] },
    }, [
      row("b.md", { created: "2026-02-14" }),
    ], [dateColumn], { onFilter });
    chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    chartConfig?.options.onClick?.({}, [{ index: 0 }]);
    expect(onFilter).toHaveBeenLastCalledWith([
      { field: "created", op: "gte", value: "2026-02-01" },
      { field: "created", op: "lt", value: "2026-03-01" },
    ]);

    const tagRenderer = new ChartRenderer();
    const tagColumn: ColumnDef = { key: "file.tags", label: "Tags", type: "multi-select" };
    const tagContainer = new FakeElement("div", body.ownerDocument);
    tagRenderer.render(tagContainer as unknown as HTMLElement, {
      ...config(),
      chartGroupField: "file.tags",
      schema: { columns: [tagColumn], computedFields: [] },
    }, [
      row("c.md", { tags: ["#project"] }),
    ], [tagColumn], { onFilter });
    chartConfig = chartCtor.mock.calls.at(-1)?.[1] as ChartJsConfigSnapshot | undefined;
    chartConfig?.options.onClick?.({}, [{ index: 0 }]);
    expect(onFilter).toHaveBeenLastCalledWith([
      { field: "file.tags", op: "hasTag", value: "project" },
    ]);
  });

  it("renders drilldown content as a readonly table with group and series values", () => {
    const source = readFileSync(new URL("../views/ChartRenderer.ts", import.meta.url), "utf8");

    expect(source).toContain("formatChartDrilldownCellValue");
    expect(source).toContain("primaryField: config.chartGroupField");
    expect(source).toContain("seriesField");
    expect(source).toContain("db-chart-drilldown-table");
    expect(source).toContain("db-chart-drilldown-cell-value");
    expect(source).not.toContain("db-chart-drilldown-list");
  });

  it("offers drilldown bulk exploration actions for matching rows", () => {
    const source = readFileSync(new URL("../views/ChartRenderer.ts", import.meta.url), "utf8");

    expect(source).toContain("chart.drilldownOpenAll");
    expect(source).toContain("chart.drilldownCopyLinks");
    expect(source).toContain("chart.applyFilter");
    expect(source).toContain("applyFilter: () =>");
    expect(source).toContain("copyMatchedLinks");
    expect(source).toContain("openAllRows");
    expect(source).toContain("toWikilink");
    expect(source).toContain("navigator.clipboard.writeText");
  });

  it("renders a dedicated empty state when every chart group is hidden", () => {
    chartCtor.mockClear();
    const container = new FakeElement("div");
    const renderer = new ChartRenderer();
    const cfg = {
      ...config(),
      chartHiddenGroups: { todo: true, done: true } as Record<string, true>,
    };
    const onConfigChange = vi.fn();

    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
    ], [column()], { onConfigChange });

    expect(chartCtor).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".db-chart-empty-text").map((el) => el.textContent)).toEqual([
      "All chart groups are hidden. Show at least one group in Chart options.",
    ]);
    const action = container.querySelectorAll(".db-chart-empty-action")[0] as FakeElement & { onclick?: () => void };
    expect(action.textContent).toBe("Show all groups");

    action.onclick?.();

    expect(cfg.chartHiddenGroups).toBeUndefined();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it("renders dedicated empty states without creating Chart.js canvases", () => {
    const cases: Array<{
      name: string;
      config: ViewConfig;
      rows: RowData[];
      columns: ColumnDef[];
      message: string;
    }> = [
      {
        name: "no fields",
        config: config(),
        rows: [row("a.md", {})],
        columns: [{ key: "file.name", label: "Name", type: "text" }],
        message: "No categorizable fields. Create a select, status, multi-select, or checkbox property first.",
      },
      {
        name: "no selected field",
        config: { ...config(), chartGroupField: undefined },
        rows: [row("a.md", { status: "todo" })],
        columns: [column()],
        message: "Select a grouping field in view settings.",
      },
      {
        name: "no records",
        config: config(),
        rows: [],
        columns: [column()],
        message: "No records match the current filters.",
      },
      {
        name: "no value field",
        config: { ...config(), chartAggregation: "sum" },
        rows: [row("a.md", { status: "todo" })],
        columns: [column()],
        message: "Select a numeric value field in view settings.",
      },
    ];

    for (const item of cases) {
      chartCtor.mockClear();
      const container = new FakeElement("div");
      const renderer = new ChartRenderer();

      renderer.render(container as unknown as HTMLElement, item.config, item.rows, item.columns);

      expect(chartCtor, item.name).not.toHaveBeenCalled();
      expect(container.querySelectorAll(".db-chart-canvas"), item.name).toHaveLength(0);
      expect(container.querySelectorAll(".db-chart-empty-text").map((el) => el.textContent), item.name).toEqual([item.message]);
    }
  });

  it("offers a default grouping field action when no chart field is selected", () => {
    chartCtor.mockClear();
    const container = new FakeElement("div");
    const renderer = new ChartRenderer();
    const dateColumn: ColumnDef = { key: "created", label: "Created", type: "date" };
    const cfg = {
      ...config(),
      chartGroupField: undefined,
      chartDateBucket: undefined,
      schema: { columns: [dateColumn], computedFields: [] },
    };
    const onConfigChange = vi.fn();

    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { created: "2026-01-01" }),
    ], [dateColumn], { onConfigChange });

    expect(chartCtor).not.toHaveBeenCalled();
    const action = container.querySelectorAll(".db-chart-empty-action")[0] as FakeElement & { onclick?: () => void };
    expect(action.textContent).toBe("Choose default group");

    action.onclick?.();

    expect(cfg.chartGroupField).toBe("created");
    expect(cfg.chartDateBucket).toBe("month");
    expect(cfg.chartNumberBucket).toBeUndefined();
    expect(cfg.chartHiddenGroups).toBeUndefined();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it("offers a default value field action when a value aggregation lacks a field", () => {
    chartCtor.mockClear();
    const container = new FakeElement("div");
    const renderer = new ChartRenderer();
    const statusColumn = column();
    const amountColumn: ColumnDef = { key: "amount", label: "Amount", type: "number" };
    const cfg = {
      ...config(),
      chartAggregation: "sum" as const,
      chartValueField: undefined,
      schema: { columns: [statusColumn, amountColumn], computedFields: [] },
    };
    const onConfigChange = vi.fn();

    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { status: "todo", amount: 12 }),
    ], [statusColumn, amountColumn], { onConfigChange });

    expect(chartCtor).not.toHaveBeenCalled();
    const action = container.querySelectorAll(".db-chart-empty-action")[0] as FakeElement & { onclick?: () => void };
    expect(action.textContent).toBe("Choose default value");

    action.onclick?.();

    expect(cfg.chartValueField).toBe("amount");
    expect(cfg.chartAggregation).toBe("sum");
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it("renders an actionable empty state for invalid custom value axis ranges", () => {
    chartCtor.mockClear();
    const container = new FakeElement("div");
    const renderer = new ChartRenderer();
    const cfg = {
      ...config(),
      chartValueAxisRange: "custom" as const,
      chartValueAxisMin: 20,
      chartValueAxisMax: 5,
    };
    const onConfigChange = vi.fn();

    renderer.render(container as unknown as HTMLElement, cfg, [
      row("a.md", { status: "todo" }),
    ], [column()], { onConfigChange });

    expect(chartCtor).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".db-chart-empty-text").map((el) => el.textContent)).toEqual([
      "Enter a value-axis maximum greater than the minimum.",
    ]);
    const action = container.querySelectorAll(".db-chart-empty-action")[0] as FakeElement & { onclick?: () => void };
    expect(action.textContent).toBe("Reset axis range");

    action.onclick?.();

    expect(cfg.chartValueAxisRange).toBe("auto");
    expect(cfg.chartValueAxisMin).toBeUndefined();
    expect(cfg.chartValueAxisMax).toBeUndefined();
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it("renders single-number charts without creating a Chart.js canvas", () => {
    chartCtor.mockClear();
    const container = new FakeElement("div");
    const renderer = new ChartRenderer();

    renderer.render(container as unknown as HTMLElement, {
      ...config(),
      chartType: "number",
    }, [
      row("a.md", { status: "todo" }),
      row("b.md", { status: "done" }),
    ], [column()]);

    expect(chartCtor).not.toHaveBeenCalled();
    expect(container.children.some((child) => child.classList.contains("db-chart-number"))).toBe(true);
  });

  it("is wired into dashboard, database file, and embedded view lifecycle paths", () => {
    for (const file of ["DatabaseView.ts", "EmbeddedDatabaseRenderer.ts"]) {
      const source = readFileSync(new URL(`../views/${file}`, import.meta.url), "utf8");

      expect(source).toContain("new ChartRenderer()");
      expect(source).toContain("this.chartRenderer.render");
      expect(source).toContain("this.chartRenderer.destroy()");
      expect(source).toContain("this.chartRenderer.refreshTheme()");
      expect(source).toContain("[\"table\", \"board\", \"gallery\", \"list\", \"chart\", \"calendar\", \"timeline\"]");
      expect(source).toContain("manualOrder: undefined");
    }
    const databaseFileView = readFileSync(new URL("../views/DatabaseFileView.ts", import.meta.url), "utf8");
    expect(databaseFileView).toContain("export class DatabaseFileDashboardView extends DatabaseView");
    expect(databaseFileView).toContain("await super.onOpen()");
    expect(databaseFileView).toContain("this.openViewReference(this.filePath)");
  });
});
