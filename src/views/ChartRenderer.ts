import { App, Modal, Notice, setIcon } from "obsidian";
import type { ChartDataset, ChartType as ChartJsType, Plugin } from "chart.js";
import { Chart } from "../data/ChartJsSetup";
import {
  aggregateChart,
  aggregateMixedChart,
  aggregateSeriesChart,
  ChartAggregateResult,
  ChartEmptyReason,
  ChartStackedAggregateResult,
  getDefaultChartDateBucket,
  getDefaultChartField,
  getDefaultChartNumberBucket,
  getDefaultChartValueField,
  isChartAggregationValueColumn,
  isNumericChartAggregation,
  requiresChartValueField,
  toChartNumber,
} from "../data/ChartAggregation";
import { CHART_PRESET_PALETTES } from "../data/ChartPalettes";
import { formatChartDrilldownCellValue, getChartFilterRules, getChartTitle, getChartHeightClass, getDrilldownRows, isChartCumulativeSupported, normalizeChartAggregationForValueField } from "../data/ChartViewModel";
import { ChartColorPalette, ChartReferenceLine, ChartType, ColumnDef, FilterRule, RowData, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";

interface ThemeColors {
  text: string;
  muted: string;
  grid: string;
  accent: string;
  accentHover: string;
  background: string;
}

interface ChartRenderSnapshot {
  container: HTMLElement;
  config: ViewConfig;
  rows: RowData[];
  columns: ColumnDef[];
  actions?: ChartRendererActions;
}

interface ChartImageCapture {
  dataUrl: string;
  width: number;
  height: number;
  title: string;
}

type ChartRenderResult = ChartAggregateResult | ChartStackedAggregateResult;

export interface ChartRendererActions {
  onFilter?(rules: FilterRule[]): void;
  onConfigChange?(label?: string): void;
}

interface ChartResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

type ChartResizeObserverCtor = new (callback: () => void) => ChartResizeObserver;

interface WindowWithChartResizeObserver extends Window {
  ResizeObserver?: ChartResizeObserverCtor;
  ClipboardItem?: typeof ClipboardItem;
}

function getOwnerWindow(container: HTMLElement): WindowWithChartResizeObserver | undefined {
  return container.ownerDocument?.defaultView ||
    (typeof window !== "undefined" ? window : undefined);
}

function getCssValue(container: HTMLElement, name: string): string {
  const ownerWindow = getOwnerWindow(container);
  const body = container.ownerDocument?.body;
  if (!ownerWindow || !body) return "";
  return ownerWindow.getComputedStyle(body).getPropertyValue(name).trim();
}

function getThemeColors(container: HTMLElement): ThemeColors {
  const accentRgb = getCssValue(container, "--interactive-accent-rgb");
  const accent = getCssValue(container, "--interactive-accent") ||
    (accentRgb ? `rgb(${accentRgb})` : "#3b82f6");
  return {
    text: getCssValue(container, "--text-normal") || "#1f2937",
    muted: getCssValue(container, "--text-muted") || "#64748b",
    grid: getCssValue(container, "--background-modifier-border") || "rgba(148, 163, 184, 0.35)",
    accent,
    accentHover: accentRgb ? `rgba(${accentRgb}, 0.95)` : accent,
    background: getCssValue(container, "--background-primary") || "#ffffff",
  };
}

function getEmptyMessage(reason: ChartEmptyReason): string {
  switch (reason) {
    case "noFields":
      return t("chart.noFields");
    case "noFieldSelected":
      return t("chart.noFieldSelected");
    case "noValueFieldSelected":
      return t("chart.noValueFieldSelected");
    case "noRecords":
      return t("chart.noRecords");
    case "allGroupsHidden":
      return t("chart.allGroupsHidden");
    case "invalidAxisRange":
      return t("chart.invalidAxisRange");
  }
}

function hasInvalidCustomAxisRange(config: ViewConfig | undefined): boolean {
  if (!config || config.chartValueAxisRange !== "custom") return false;
  const chartType = config.chartType || "bar";
  if (chartType === "number" || chartType === "pie" || chartType === "donut") return false;
  const min = config.chartValueAxisMin;
  const max = config.chartValueAxisMax;
  if (typeof min !== "number" || typeof max !== "number") return false;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
  return min >= max;
}

function getAggregationLabel(config: ViewConfig | undefined): string {
  switch (config?.chartAggregation || "count") {
    case "sum":
      return t("chart.sumAggregation");
    case "avg":
      return t("chart.avgAggregation");
    case "median":
      return t("chart.medianAggregation");
    case "min":
      return t("chart.minAggregation");
    case "max":
      return t("chart.maxAggregation");
    case "range":
      return t("chart.rangeAggregation");
    case "unique":
      return t("chart.uniqueAggregation");
    case "empty":
      return t("chart.emptyAggregation");
    case "not-empty":
      return t("chart.notEmptyAggregation");
    case "percent-empty":
      return t("chart.percentEmptyAggregation");
    case "percent-not-empty":
      return t("chart.percentNotEmptyAggregation");
    case "checked":
      return t("chart.checkedAggregation");
    case "unchecked":
      return t("chart.uncheckedAggregation");
    case "percent-checked":
      return t("chart.percentCheckedAggregation");
    case "count":
    default:
      return t("chart.countAggregation");
  }
}

function getChartTypeLabel(type: ChartType | undefined): string {
  switch (type || "bar") {
    case "horizontal-bar":
      return t("chart.horizontalBarChart");
    case "stacked-bar":
      return t("chart.stackedBarChart");
    case "grouped-bar":
      return t("chart.groupedBarChart");
    case "percent-stacked-bar":
      return t("chart.percentStackedBarChart");
    case "line":
      return t("chart.lineChart");
    case "area":
      return t("chart.areaChart");
    case "pie":
      return t("chart.pieChart");
    case "donut":
      return t("chart.donutChart");
    case "number":
      return t("chart.numberChart");
    case "mixed":
      return t("chart.mixedChart");
    case "bar":
    default:
      return t("chart.barChart");
  }
}

function formatChartNumber(value: number | null | undefined, config: ViewConfig | undefined, columns: ColumnDef[]): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const valueColumn = config?.chartValueField
    ? columns.find((col) => col.key === config.chartValueField)
    : undefined;
  const aggregation = config?.chartAggregation || "count";
  if (config?.chartType === "percent-stacked-bar" || aggregation === "percent-empty" || aggregation === "percent-not-empty" || aggregation === "percent-checked") {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  }
  const maximumFractionDigits = valueColumn?.type === "currency" ? 2 : 6;
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString(undefined, { maximumFractionDigits });
}

function getCategoryTickLabel(labels: unknown, value: string | number, index?: number): string {
  const labelItems: unknown[] = Array.isArray(labels) ? labels : [];
  const labelIndex = typeof index === "number" ? index : Number(value);
  const label = Number.isInteger(labelIndex) ? labelItems[labelIndex] : undefined;
  if (Array.isArray(label)) {
    return label.map((item) => formatCategoryLabelItem(item)).filter(Boolean).join(" ");
  }
  const text = formatCategoryLabelItem(label);
  if (text) return text;
  return String(value);
}

function formatCategoryLabelItem(label: unknown): string {
  if (typeof label === "string") return label;
  if (typeof label === "number" || typeof label === "boolean" || typeof label === "bigint") return label.toString();
  return "";
}

export class ChartRenderer {
  private chartInstance: Chart | null = null;
  private chartContainer: HTMLElement | null = null;
  private resizeObserver: ChartResizeObserver | null = null;
  private lastRender: ChartRenderSnapshot | null = null;
  private currentResult: ChartRenderResult | null = null;
  private structuralSignature = "";

  render(container: HTMLElement, config: ViewConfig, rows: RowData[], columns: ColumnDef[], actions?: ChartRendererActions): void {
    this.lastRender = { container, config, rows, columns, actions };

    const result = this.aggregate(config, rows, columns);
    this.currentResult = result;
    if (result.emptyReason) {
      this.clear(container);
      this.renderEmptyState(container, result.emptyReason);
      return;
    }
    if (hasInvalidCustomAxisRange(config)) {
      this.clear(container);
      this.renderEmptyState(container, "invalidAxisRange");
      return;
    }
    if ((config.chartType || "bar") === "number") {
      this.clear(container);
      this.renderNumber(container, result as ChartAggregateResult);
      return;
    }
    const nextSignature = getChartStructuralSignature(config);
    if (this.chartInstance && this.chartContainer?.isConnected && this.structuralSignature === nextSignature) {
      this.updateChart(result);
      return;
    }
    this.clear(container);
    this.structuralSignature = nextSignature;
    this.renderChart(container, result);
  }

  clear(container?: HTMLElement): void {
    this.destroyChart();
    container?.querySelectorAll(".db-chart, .db-chart-empty, .db-chart-number").forEach((el) => el.remove());
  }

  destroy(): void {
    this.lastRender = null;
    this.currentResult = null;
    this.destroyChart();
  }

  resize(): void {
    this.chartInstance?.resize();
  }

  exportPng(filename: string): boolean {
    const capture = this.captureChartImage();
    if (capture) {
      this.downloadDataUrl(this.lastRender?.container, capture.dataUrl, `${filename}.png`);
      return true;
    }
    new Notice(t("chart.exportUnavailable"));
    return false;
  }

  async copyPng(): Promise<boolean> {
    const capture = this.captureChartImage();
    if (!capture) {
      new Notice(t("chart.exportUnavailable"));
      return false;
    }
    try {
      const container = this.lastRender?.container;
      const win = container ? getOwnerWindow(container) : undefined;
      const clipboard = win?.navigator.clipboard;
      const ClipboardItemCtor = win?.ClipboardItem;
      if (!clipboard?.write || !ClipboardItemCtor) throw new Error("Image clipboard unavailable");
      const blob = dataUrlToBlob(capture.dataUrl);
      await clipboard.write([new ClipboardItemCtor({ [blob.type]: blob })]);
      new Notice(t("chart.copiedPng"));
      return true;
    } catch {
      new Notice(t("errors.clipboardFailed"));
      return false;
    }
  }

  refreshTheme(): void {
    const snapshot = this.lastRender;
    if (snapshot?.container.isConnected === false) return;
    if (snapshot) {
      this.renderRebuilt(snapshot.container, snapshot.config, snapshot.rows, snapshot.columns);
    }
  }

  private renderRebuilt(container: HTMLElement, config: ViewConfig, rows: RowData[], columns: ColumnDef[]): void {
    this.lastRender = { container, config, rows, columns, actions: this.lastRender?.actions };
    this.clear(container);
    const result = this.aggregate(config, rows, columns);
    this.currentResult = result;
    if (result.emptyReason) {
      this.renderEmptyState(container, result.emptyReason);
      return;
    }
    if (hasInvalidCustomAxisRange(config)) {
      this.renderEmptyState(container, "invalidAxisRange");
      return;
    }
    if ((config.chartType || "bar") === "number") {
      this.renderNumber(container, result as ChartAggregateResult);
      return;
    }
    this.renderChart(container, result);
  }

  private renderChart(container: HTMLElement, result: ChartRenderResult): void {
    const colors = getThemeColors(container);
    const wrap = this.createChartRoot(container, "db-chart");
    const canvas = wrap.createEl("canvas", { cls: "db-chart-canvas" });
    const config = this.lastRender?.config;
    const columns = this.lastRender?.columns || [];
    const datasetLabel = getAggregationLabel(config);
    const isCountAggregation = (config?.chartAggregation || "count") === "count";
    const formatValue = (value: number | null | undefined) => formatChartNumber(value, config, columns);
    const chartType = config?.chartType || "bar";
    const chartJsType = getChartJsType(chartType);
    const isHorizontal = chartType === "horizontal-bar";
    const isPie = chartType === "pie";
    const isDonut = chartType === "donut";
    const isSeries = isStackedResult(result);
    const isStacked = isStackedChartType(chartType) && isSeries;
    const isMixed = chartType === "mixed" && isStackedResult(result);
    const isPercentStacked = chartType === "percent-stacked-bar" && isSeries;
    const valueAxis = getValueAxisOptions(config, isPercentStacked);
    const valueAxisGrace = config?.chartShowDataLabels === true && valueAxis.max == null ? "12%" : undefined;
    const referenceLines = resolveReferenceLines(result, config?.chartReferenceLines || [], formatValue);
    const rawChartLabels = isStackedResult(result) ? result.labels : result.points.map((point) => point.label);
    const chartLabels = rawChartLabels.map((label) => wrapCategoryLabel(label));
    const categoryTickLabel = (value: string | number, index?: number) => {
      const liveLabels = this.chartInstance?.data.labels;
      const labels = Array.isArray(liveLabels) && liveLabels.length > 0 ? liveLabels : chartLabels;
      return getCategoryTickLabel(labels, value, index);
    };

    const effectiveConfig = config || createFallbackChartConfig(columns);
    const chartTitle = getChartTitle(effectiveConfig, columns);
    wrap.addClass(getChartHeightClass(effectiveConfig));
    const showTitle = config?.chartShowTitle !== false;
    if (showTitle) {
      wrap.addClass("has-chart-title");
      wrap.createDiv({ cls: "db-chart-title", text: chartTitle });
    }
    this.chartContainer = wrap;
    this.observeContainer(wrap);
    this.chartInstance = new Chart(canvas, {
      type: chartJsType,
      data: {
        labels: chartLabels,
        datasets: isMixed
          ? this.createMixedDatasets(result, colors)
          : isSeries
          ? this.createSeriesDatasets(chartType, result, colors)
          : [this.createDataset(chartType, result, datasetLabel, colors)],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: showTitle ? (config?.chartShowDataLabels === true ? 52 : 42) : (config?.chartShowDataLabels === true ? 28 : 18),
            left: 8,
            right: 10,
            bottom: 0,
          },
        },
        plugins: {
          legend: {
            display: config?.chartShowLegend !== false && (isPie || isDonut || isSeries || isMixed),
            position: "bottom",
            onClick: (_event, item) => this.toggleLegendGroup(item.text || ""),
            labels: {
              color: colors.text,
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
            },
          },
          tooltip: {
            backgroundColor: colors.background,
            titleColor: colors.text,
            bodyColor: colors.text,
            borderColor: colors.grid,
            borderWidth: 1,
            displayColors: false,
            callbacks: {
              title: (items) => {
                const item = items[0];
                const dataIndex = typeof item?.dataIndex === "number" ? item.dataIndex : undefined;
                return dataIndex == null ? "" : rawChartLabels[dataIndex] || "";
              },
              label: (context) => {
                const value = getTooltipNumericValue(context.parsed, isHorizontal);
                return `${context.dataset?.label || datasetLabel}: ${formatValue(value)}`;
              },
            },
          },
        },
        onClick: (_event, elements) => this.handleChartClick(elements),
        indexAxis: isHorizontal ? "y" : "x",
        scales: (isPie || isDonut) ? {} : {
          x: {
            ticks: {
              color: colors.text,
              maxRotation: 45,
              minRotation: 0,
              padding: 10,
              callback: isHorizontal
                ? (value) => formatValue(typeof value === "number" ? value : Number(value))
                : categoryTickLabel,
            },
            grid: { display: shouldShowGrid(config, isHorizontal ? "value" : "category"), color: colors.grid },
            border: { color: colors.grid },
            title: {
              display: shouldShowAxisTitle(config, "x"),
              text: isHorizontal ? getAggregationLabel(config) : chartTitle,
              color: colors.muted,
            },
            stacked: isStacked,
            beginAtZero: isHorizontal ? valueAxis.beginAtZero : undefined,
            min: isHorizontal ? valueAxis.min : undefined,
            max: isHorizontal ? valueAxis.max : undefined,
            grace: isHorizontal ? valueAxisGrace : undefined,
          },
          y: {
            beginAtZero: !isHorizontal ? valueAxis.beginAtZero : undefined,
            ticks: {
              color: isHorizontal ? colors.text : colors.muted,
              padding: 8,
              callback: isHorizontal ? categoryTickLabel : (value) => formatValue(typeof value === "number" ? value : Number(value)),
              ...(isCountAggregation ? { precision: 0 } : {}),
            },
            grid: { display: shouldShowGrid(config, isHorizontal ? "category" : "value"), color: colors.grid },
            border: { color: colors.grid },
            title: {
              display: shouldShowAxisTitle(config, "y"),
              text: isHorizontal ? chartTitle : getAggregationLabel(config),
              color: colors.muted,
            },
            stacked: isStacked,
            min: !isHorizontal ? valueAxis.min : undefined,
            max: !isHorizontal ? valueAxis.max : undefined,
            grace: !isHorizontal ? valueAxisGrace : undefined,
          },
        },
      },
      plugins: [
        createDataLabelsPlugin(formatValue, isDonut, config?.chartShowDataLabels === true, config?.chartDataLabelMode || "value", config?.chartDataLabelColor || "auto", colors, {
          placeInsideBars: isStacked || isPercentStacked,
          isHorizontal,
        }),
        createDonutCenterPlugin(formatValue, isDonut ? getDonutCenterMode(config) : "hidden", getDonutCenterValue(result, config)),
        ...(referenceLines.length > 0 && !isPie && !isDonut ? [createReferenceLinesPlugin(referenceLines, isHorizontal, colors)] : []),
      ],
    });
  }

  private updateChart(result: ChartRenderResult): void {
    if (!this.chartInstance) return;
    this.currentResult = result;
    const chartType = this.lastRender?.config.chartType || "bar";
    const colors = this.chartContainer ? getThemeColors(this.chartContainer) : getFallbackThemeColors();
    this.chartInstance.data.labels = isStackedResult(result) ? result.labels : result.points.map((point) => point.label);
    this.chartInstance.data.datasets = isSeriesChartType(chartType) && isStackedResult(result)
      ? this.createSeriesDatasets(chartType, result, colors)
      : chartType === "mixed" && isStackedResult(result)
        ? this.createMixedDatasets(result, colors)
      : [this.createDataset(chartType, result as ChartAggregateResult, getAggregationLabel(this.lastRender?.config), colors)];
    this.chartInstance.update("none");
  }

  private aggregate(config: ViewConfig, rows: RowData[], columns: ColumnDef[]): ChartRenderResult {
    if ((config.chartType || "bar") === "number") {
      return aggregateSingleNumber(rows, config, columns);
    }
    if (shouldUseSeriesAggregation(config)) {
      const seriesField = getConfigSeriesField(config);
      return aggregateSeriesChart(rows, config.chartGroupField, seriesField, columns, {
        aggregation: config.chartAggregation || "count",
        valueField: config.chartValueField,
        dateBucket: config.chartDateBucket,
        numberBucket: config.chartNumberBucket,
        numberBucketSize: config.chartNumberBucketSize,
        computedFields: config.schema.computedFields,
        sortBy: config.chartSortBy,
        hiddenGroups: config.chartHiddenGroups,
        omitZeroValues: config.chartOmitZeroValues,
        percentStacked: config.chartType === "percent-stacked-bar",
        maxGroups: 50,
      });
    }
    if ((config.chartType || "bar") === "mixed") {
      return aggregateMixedChart(rows, config.chartGroupField, columns, {
        aggregation: config.chartAggregation || "count",
        valueField: config.chartValueField,
        secondaryAggregation: config.chartSecondaryAggregation || "count",
        secondaryValueField: config.chartSecondaryValueField,
        dateBucket: config.chartDateBucket,
        numberBucket: config.chartNumberBucket,
        numberBucketSize: config.chartNumberBucketSize,
        computedFields: config.schema.computedFields,
        sortBy: config.chartSortBy,
        hiddenGroups: config.chartHiddenGroups,
        omitZeroValues: config.chartOmitZeroValues,
        maxGroups: 50,
      });
    }
    return aggregateChart(rows, config.chartGroupField, columns, {
      aggregation: config.chartAggregation || "count",
      valueField: config.chartValueField,
      dateBucket: config.chartDateBucket,
      numberBucket: config.chartNumberBucket,
      numberBucketSize: config.chartNumberBucketSize,
      computedFields: config.schema.computedFields,
      sortBy: config.chartSortBy,
      hiddenGroups: config.chartHiddenGroups,
      omitZeroValues: config.chartOmitZeroValues,
      cumulative: config.chartCumulative && isChartCumulativeSupported(config),
      maxGroups: 50,
    });
  }

  private renderEmptyState(container: HTMLElement, reason: ChartEmptyReason): void {
    const empty = this.createChartRoot(container, "db-chart-empty");
    const icon = empty.createDiv({ cls: "db-chart-empty-icon" });
    setIcon(icon, "bar-chart");
    empty.createDiv({ cls: "db-chart-empty-text", text: getEmptyMessage(reason) });
    this.renderEmptyAction(empty, reason);
  }

  private renderEmptyAction(empty: HTMLElement, reason: ChartEmptyReason): void {
    const config = this.lastRender?.config;
    const actions = this.lastRender?.actions;
    if (!config || !actions?.onConfigChange) return;
    if (reason === "allGroupsHidden") {
      const button = empty.createEl("button", { cls: "db-chart-empty-action", text: t("chart.showAllGroups"), attr: { type: "button" } });
      button.onclick = () => {
        config.chartHiddenGroups = undefined;
        actions.onConfigChange?.(t("undo.chartVisibleGroupsConfig"));
      };
      return;
    }
    if (reason === "noFieldSelected") {
      const defaultField = getDefaultChartField(config.schema.columns, config.schema.computedFields);
      if (!defaultField) return;
      const button = empty.createEl("button", { cls: "db-chart-empty-action", text: t("chart.chooseDefaultGroup"), attr: { type: "button" } });
      button.onclick = () => {
        config.chartGroupField = defaultField;
        config.chartDateBucket = getDefaultChartDateBucket(config.schema.columns, defaultField, config.schema.computedFields);
        config.chartNumberBucket = getDefaultChartNumberBucket(config.schema.columns, defaultField, config.schema.computedFields);
        if (!config.chartNumberBucket) config.chartNumberBucketSize = undefined;
        config.chartHiddenGroups = undefined;
        actions.onConfigChange?.(t("undo.chartGroupConfig"));
      };
      return;
    }
    if (reason === "noValueFieldSelected") {
      const defaultField = getDefaultChartValueField(config.schema.columns, config.schema.computedFields, config.chartAggregation || "sum");
      if (!defaultField) return;
      const button = empty.createEl("button", { cls: "db-chart-empty-action", text: t("chart.chooseDefaultValue"), attr: { type: "button" } });
      button.onclick = () => {
        config.chartValueField = defaultField;
        normalizeChartAggregationForValueField(config, defaultField);
        actions.onConfigChange?.(t("undo.chartValueFieldConfig"));
      };
      return;
    }
    if (reason === "invalidAxisRange") {
      const button = empty.createEl("button", { cls: "db-chart-empty-action", text: t("chart.resetAxisRange"), attr: { type: "button" } });
      button.onclick = () => {
        config.chartValueAxisRange = "auto";
        config.chartValueAxisMin = undefined;
        config.chartValueAxisMax = undefined;
        actions.onConfigChange?.(t("undo.chartAxisRangeConfig"));
      };
    }
  }

  private handleChartClick(elements: unknown): void {
    const config = this.lastRender?.config;
    const result = this.currentResult;
    if (!config || !result || !config.chartGroupField) return;
    const index = getClickedElementIndex(elements);
    if (index == null) return;
    const key = isStackedResult(result)
      ? result.keys[index]
      : result.points[index]?.key;
    if (!key || key === "__other__") return;
    const column = this.lastRender?.columns.find((col) => col.key === config.chartGroupField);
    let rows = getDrilldownRows(this.lastRender?.rows || [], config.chartGroupField, key, column, config.chartDateBucket, config.schema.computedFields);
    const datasetIndex = getClickedElementDatasetIndex(elements);
    const seriesField = getConfigSeriesField(config);
    const series = isStackedResult(result) && config.chartType !== "mixed" && datasetIndex != null
      ? result.series[datasetIndex]
      : undefined;
    let rules = getChartFilterRules(config.chartGroupField, key, column, config.chartDateBucket, config.schema.computedFields);
    if (seriesField && series?.key && series.key !== "__other__") {
      const seriesColumn = this.lastRender?.columns.find((col) => col.key === seriesField);
      rows = getDrilldownRows(rows, seriesField, series.key, seriesColumn, undefined, config.schema.computedFields);
      rules = [
        ...rules,
        ...getChartFilterRules(seriesField, series.key, seriesColumn, undefined, config.schema.computedFields),
      ];
    }
    const app = rows[0]?.app || this.lastRender?.rows[0]?.app;
    if (app) {
      new ChartDrilldownModal(app, {
        title: getChartTitle(config, this.lastRender?.columns || []),
        groupLabel: isStackedResult(result) ? result.labels[index] || key : result.points[index]?.label || key,
        primaryField: config.chartGroupField,
        primaryColumn: column,
        seriesField,
        seriesColumn: seriesField ? this.lastRender?.columns.find((col) => col.key === seriesField) : undefined,
        rows,
        applyFilter: () => {
          if (rules.length > 0) this.lastRender?.actions?.onFilter?.(rules);
        },
      }).open();
      return;
    }
    if (rules.length > 0) this.lastRender?.actions?.onFilter?.(rules);
  }

  private toggleLegendGroup(key: string): void {
    const config = this.lastRender?.config;
    if (!config || !key) return;
    config.chartHiddenGroups = config.chartHiddenGroups || {};
    if (config.chartHiddenGroups[key]) delete config.chartHiddenGroups[key];
    else config.chartHiddenGroups[key] = true;
    this.lastRender?.actions?.onConfigChange?.(t("undo.chartVisibleGroupsConfig"));
  }

  private renderNumber(container: HTMLElement, result: ChartAggregateResult): void {
    const config = this.lastRender?.config;
    const columns = this.lastRender?.columns || [];
    const point = result.points[0];
    const wrap = this.createChartRoot(container, "db-chart-number");
    const effectiveConfig = config || createFallbackChartConfig(columns);
    wrap.addClass(getChartHeightClass(effectiveConfig));
    if (config?.chartShowTitle !== false) {
      wrap.createDiv({ cls: "db-chart-number-label", text: getChartTitle(effectiveConfig, columns) });
    } else {
      wrap.createDiv({ cls: "db-chart-number-label", text: getAggregationLabel(config) });
    }
    wrap.createDiv({ cls: "db-chart-number-value", text: formatChartNumber(point?.value ?? 0, config, columns) });
    wrap.createDiv({ cls: "db-chart-number-caption", text: getChartTypeLabel(config?.chartType) });
  }

  private createChartRoot(container: HTMLElement, cls: string): HTMLElement {
    const root = container.createDiv({ cls });
    const summary = container.querySelector(":scope > .db-summary");
    if (summary?.parentElement) summary.parentElement.insertBefore(root, summary);
    return root;
  }

  private createDataset(
    chartType: ChartType,
    result: ChartAggregateResult,
    label: string,
    colors: ThemeColors,
  ): ChartDataset {
    const config = this.lastRender?.config;
    const columns = this.lastRender?.columns || [];
    const data = result.points.map((point) => point.value);
    if (chartType === "line" || chartType === "area") {
      return {
        type: "line",
        label,
        data,
        borderColor: colors.accent,
        backgroundColor: chartType === "area" || config?.chartGradientArea ? transparentize(colors.accent, 0.18) : colors.accent,
        borderWidth: 2,
        pointBackgroundColor: colors.accent,
        pointBorderColor: colors.background,
        pointBorderWidth: 1,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: chartType === "area" || config?.chartGradientArea === true,
        tension: config?.chartSmoothLine === false ? 0 : 0.28,
      };
    }
    if (chartType === "pie" || chartType === "donut") {
      const palette = this.getPointColors(result, colors);
      return {
        type: chartType === "donut" ? "doughnut" : "pie",
        label,
        data,
        backgroundColor: palette,
        hoverBackgroundColor: palette.map((color) => transparentize(color, 0.9)),
        borderColor: colors.background,
        borderWidth: 2,
      };
    }
    return {
      type: "bar",
      label,
      data,
      backgroundColor: getSingleSeriesBarColors(chartType, result, config, columns, colors),
      hoverBackgroundColor: getSingleSeriesBarHoverColors(chartType, result, config, columns, colors),
      borderColor: getSingleSeriesBarColors(chartType, result, config, columns, colors),
      borderWidth: 0,
      borderRadius: 4,
      maxBarThickness: 80,
    };
  }

  private createSeriesDatasets(chartType: ChartType, result: ChartStackedAggregateResult, colors: ThemeColors): ChartDataset[] {
    const palette = this.getSeriesColors(result, colors);
    return result.series.map((series, index) => {
      if (chartType === "line" || chartType === "area") {
        return {
          type: "line",
          label: series.label,
          data: series.values,
          borderColor: palette[index],
          backgroundColor: chartType === "area" ? transparentize(palette[index], 0.18) : palette[index],
          borderWidth: 2,
          pointBackgroundColor: palette[index],
          pointBorderColor: colors.background,
          pointBorderWidth: 1,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: chartType === "area",
          tension: this.lastRender?.config.chartSmoothLine === false ? 0 : 0.28,
        };
      }
      return {
        type: "bar",
        label: series.label,
        data: series.values,
        backgroundColor: palette[index],
        hoverBackgroundColor: transparentize(palette[index], 0.9),
        borderColor: colors.background,
        borderWidth: 1,
        borderRadius: 3,
        maxBarThickness: chartType === "grouped-bar" ? 52 : 80,
      };
    });
  }

  private getPointColors(result: ChartAggregateResult, colors: ThemeColors): string[] {
    const config = this.lastRender?.config;
    const columns = this.lastRender?.columns || [];
    if (config?.chartColorByValue && isSingleSeriesBarChart(config.chartType || "bar")) {
      return createValueIntensityColors(result.points.map((point) => point.value), colors.accent);
    }
    const optionColors = getOptionPointColors(result, config, columns);
    if (optionColors && (config?.chartColorPalette === "option" || config?.chartColorPalette === "auto" || !config?.chartColorPalette)) return optionColors;
    if (config?.chartColorPalette === "accent") return Array.from({ length: result.points.length }, () => colors.accent);
    return createPaletteForConfig(config?.chartColorPalette, colors.accent, result.points.length);
  }

  private getSeriesColors(result: ChartStackedAggregateResult, colors: ThemeColors): string[] {
    const config = this.lastRender?.config;
    const columns = this.lastRender?.columns || [];
    const optionColors = getOptionSeriesColors(result, config, columns);
    if (optionColors && (config?.chartColorPalette === "option" || config?.chartColorPalette === "auto" || !config?.chartColorPalette)) return optionColors;
    if (config?.chartColorPalette === "accent") return Array.from({ length: result.series.length }, () => colors.accent);
    return createPaletteForConfig(config?.chartColorPalette, colors.accent, result.series.length);
  }

  private createMixedDatasets(result: ChartStackedAggregateResult, colors: ThemeColors): ChartDataset[] {
    const bar = result.series[0] || { label: t("chart.barChart"), values: [] };
    const line = result.series[1] || { label: t("chart.lineChart"), values: [] };
    return [
      {
        type: "bar",
        order: 2,
        label: bar.label,
        data: bar.values,
        backgroundColor: transparentize(colors.accent, 0.72),
        hoverBackgroundColor: colors.accentHover,
        borderColor: colors.accent,
        borderWidth: 0,
        borderRadius: 4,
        maxBarThickness: 72,
      },
      {
        type: "line",
        order: 1,
        label: line.label,
        data: line.values,
        borderColor: "#f59e0b",
        backgroundColor: "#f59e0b",
        borderWidth: 2,
        pointBackgroundColor: "#f59e0b",
        pointBorderColor: colors.background,
        pointBorderWidth: 1,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: false,
        tension: 0.28,
      },
    ];
  }

  private observeContainer(container: HTMLElement): void {
    this.resizeObserver?.disconnect();
    const ResizeObserverCtor = getOwnerWindow(container)?.ResizeObserver;
    if (!ResizeObserverCtor) return;
    const observer = new ResizeObserverCtor(() => this.resize());
    observer.observe(container);
    this.resizeObserver = observer;
  }

  private destroyChart(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.chartInstance?.destroy();
    this.chartInstance = null;
    this.chartContainer = null;
    this.structuralSignature = "";
  }

  private captureChartImage(): ChartImageCapture | null {
    const snapshot = this.lastRender;
    const container = snapshot?.container;
    if (!snapshot || !container?.isConnected) return null;
    const title = getChartTitle(snapshot.config, snapshot.config.schema.columns);
    const canvas = container.querySelector(".db-chart-canvas");
    if (isCanvasElement(canvas)) {
      return {
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width || Math.round(canvas.getBoundingClientRect().width) || 960,
        height: canvas.height || Math.round(canvas.getBoundingClientRect().height) || 540,
        title,
      };
    }
    const numberCard = container.querySelector(".db-chart-number");
    if (isHTMLElement(numberCard)) {
      const dataUrl = this.renderNumberCardToPng(numberCard);
      if (!dataUrl) return null;
      return {
        dataUrl,
        width: 960,
        height: 540,
        title,
      };
    }
    return null;
  }

  private downloadDataUrl(container: HTMLElement | undefined, dataUrl: string, filename: string): void {
    const doc = container?.ownerDocument || window.activeDocument;
    const link = doc.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();
  }

  private renderNumberCardToPng(card: HTMLElement): string | null {
    const doc = card.ownerDocument;
    const canvas = doc.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const colors = getThemeColors(card);
    const label = card.querySelector(".db-chart-number-label")?.textContent || "";
    const value = card.querySelector(".db-chart-number-value")?.textContent || "";
    const caption = card.querySelector(".db-chart-number-caption")?.textContent || "";
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.fillStyle = colors.muted;
    ctx.font = "600 28px sans-serif";
    ctx.fillText(label, canvas.width / 2, 150);
    ctx.fillStyle = colors.text;
    ctx.font = "700 92px sans-serif";
    ctx.fillText(value, canvas.width / 2, 285);
    ctx.fillStyle = colors.muted;
    ctx.font = "600 24px sans-serif";
    ctx.fillText(caption, canvas.width / 2, 370);
    return canvas.toDataURL("image/png");
  }
}

interface ChartDrilldownOptions {
  title: string;
  groupLabel: string;
  primaryField: string;
  primaryColumn?: ColumnDef;
  seriesField?: string;
  seriesColumn?: ColumnDef;
  rows: RowData[];
  applyFilter(): void;
}

class ChartDrilldownModal extends Modal {
  constructor(app: App, private readonly options: ChartDrilldownOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("db-chart-drilldown-modal");
    const header = contentEl.createDiv({ cls: "db-chart-drilldown-header" });
    header.createEl("h2", { text: this.options.title });
    header.createDiv({ cls: "db-chart-drilldown-group", text: this.options.groupLabel });
    contentEl.createDiv({ cls: "db-chart-drilldown-summary", text: t("chart.drilldownSummary", { count: String(this.options.rows.length) }) });
    const tableWrap = contentEl.createDiv({ cls: "db-chart-drilldown-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "db-chart-drilldown-table" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: t("chart.drilldownFile") });
    headerRow.createEl("th", { text: t("chart.drilldownPath") });
    headerRow.createEl("th", { text: this.options.primaryColumn?.label || this.options.primaryField });
    if (this.options.seriesField) {
      headerRow.createEl("th", { text: this.options.seriesColumn?.label || this.options.seriesField });
    }
    const tbody = table.createEl("tbody");
    for (const row of this.options.rows.slice(0, 100)) {
      const item = tbody.createEl("tr", { cls: "db-chart-drilldown-row" });
      const name = item.createEl("td", { cls: "db-chart-drilldown-name", text: row.file.basename || row.file.name.replace(/\.md$/i, "") });
      item.createEl("td", { cls: "db-chart-drilldown-path", text: row.file.path });
      item.createEl("td", { cls: "db-chart-drilldown-cell-value", text: formatChartDrilldownCellValue(row, this.options.primaryField, this.options.primaryColumn) });
      if (this.options.seriesField) {
        item.createEl("td", { cls: "db-chart-drilldown-cell-value", text: formatChartDrilldownCellValue(row, this.options.seriesField, this.options.seriesColumn) });
      }
      name.onclick = () => {
        void this.app.workspace.openLinkText(row.file.path, "", false);
        this.close();
      };
    }
    if (this.options.rows.length > 100) {
      contentEl.createDiv({ cls: "db-chart-drilldown-more", text: t("chart.drilldownMore", { count: String(this.options.rows.length - 100) }) });
    }
    const actions = contentEl.createDiv({ cls: "db-chart-drilldown-actions" });
    const filterButton = actions.createEl("button", { cls: "mod-cta", text: t("chart.applyFilter") });
    filterButton.onclick = () => {
      this.options.applyFilter();
      this.close();
    };
    const openAllButton = actions.createEl("button", { text: t("chart.drilldownOpenAll") });
    openAllButton.onclick = () => {
      this.openAllRows();
      this.close();
    };
    const copyLinksButton = actions.createEl("button", { text: t("chart.drilldownCopyLinks") });
    copyLinksButton.onclick = () => {
      void this.copyMatchedLinks();
    };
  }

  private openAllRows(): void {
    for (const row of this.options.rows) {
      void this.app.workspace.openLinkText(row.file.path, "", true);
    }
  }

  private async copyMatchedLinks(): Promise<void> {
    const links = this.options.rows.map((row) => toWikilink(row.file.path)).join("\n");
    try {
      await navigator.clipboard.writeText(links);
      new Notice(t("chart.drilldownCopiedLinks", { count: String(this.options.rows.length) }));
    } catch {
      new Notice(t("errors.clipboardFailed"));
    }
  }
}

function toWikilink(path: string): string {
  const target = path.replace(/\.md$/i, "").replace(/\|/g, "\\|");
  return `[[${target}]]`;
}

function getChartStructuralSignature(config: ViewConfig): string {
  return [
    config.chartType || "bar",
    config.chartStackField || "",
    config.chartSeriesField || "",
    config.chartShowLegend === false ? "legend-off" : "legend-on",
    config.chartShowDataLabels === true ? "labels-on" : "labels-off",
    config.chartDataLabelMode || "",
    config.chartDataLabelColor || "",
    getDonutCenterMode(config),
    config.chartGridLines || "",
    config.chartAxisNames || "",
    config.chartHeight || "",
    config.chartShowTitle === false ? "title-off" : "title-on",
    config.chartTitle || "",
    config.chartValueAxisRange || "",
    config.chartValueAxisMin ?? "",
    config.chartValueAxisMax ?? "",
    JSON.stringify(config.chartReferenceLines || []),
  ].join("|");
}

function shouldShowGrid(config: ViewConfig | undefined, axis: "value" | "category"): boolean {
  const mode = config?.chartGridLines || "value";
  if (mode === "none") return false;
  if (mode === "both") return true;
  return axis === "value";
}

function shouldShowAxisTitle(config: ViewConfig | undefined, axis: "x" | "y"): boolean {
  const mode = config?.chartAxisNames || "none";
  return mode === "both" || mode === axis;
}

function createFallbackChartConfig(columns: ColumnDef[]): ViewConfig {
  return {
    name: "Chart",
    sourceFolder: "",
    viewType: "chart",
    schema: { columns, computedFields: [] },
  };
}

function createDataLabelsPlugin(
  formatValue: (value: number | null | undefined) => string,
  isDonut: boolean,
  enabled: boolean,
  mode: ViewConfig["chartDataLabelMode"],
  colorMode: NonNullable<ViewConfig["chartDataLabelColor"]>,
  colors: ThemeColors,
  options: { placeInsideBars?: boolean; isHorizontal?: boolean } = {},
): Plugin {
  return {
    id: "noteDatabaseDataLabels",
    afterDatasetsDraw(chart) {
      if (!enabled) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "11px sans-serif";
      for (const dataset of chart.data.datasets) {
        const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(dataset));
        const values = Array.isArray(dataset.data)
          ? dataset.data.map((item) => Number(item)).filter((item) => Number.isFinite(item))
          : [];
        const total = values.reduce((sum, item) => sum + item, 0);
        meta.data.forEach((element, index) => {
          const value = Array.isArray(dataset.data) ? Number(dataset.data[index]) : Number.NaN;
          if (!Number.isFinite(value)) return;
          const position = element.tooltipPosition(true);
          if (typeof position.x !== "number" || typeof position.y !== "number") return;
          const label = toFullCategoryLabel(Array.isArray(chart.data.labels) ? chart.data.labels[index] : "");
          const text = formatDataLabelText(value, label, total, mode, formatValue);
          const point = getDataLabelPoint(element, chart.chartArea, {
            isDonut,
            placeInsideBars: options.placeInsideBars === true,
            isHorizontal: options.isHorizontal === true,
          });
          if (!point) return;
          const labelBackground = point.isInsideMark ? getDatasetBackgroundColor(dataset, index) : colors.background;
          ctx.fillStyle = getDataLabelColor(colorMode, colors, labelBackground);
          ctx.fillText(text, point.x, point.y);
        });
      }
      ctx.restore();
    },
  };
}

interface ChartAreaLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getDataLabelPoint(
  element: unknown,
  area: ChartAreaLike,
  options: { isDonut: boolean; placeInsideBars: boolean; isHorizontal: boolean },
): { x: number; y: number; isInsideMark: boolean } | null {
  const position = (element as { tooltipPosition?: (useFinalPosition?: boolean) => { x?: number; y?: number } }).tooltipPosition?.(true);
  if (!position || typeof position.x !== "number" || typeof position.y !== "number") return null;
  if (options.isDonut) return { x: position.x, y: position.y, isInsideMark: true };

  const bar = getBarElementGeometry(element);
  if (bar && options.placeInsideBars) {
    return options.isHorizontal
      ? { x: (bar.x + bar.base) / 2, y: bar.y, isInsideMark: true }
      : { x: bar.x, y: (bar.y + bar.base) / 2, isInsideMark: true };
  }

  if (options.isHorizontal) {
    return { x: Math.min(area.right - 8, position.x + 12), y: position.y, isInsideMark: false };
  }
  return { x: position.x, y: Math.max(area.top + 8, position.y - 12), isInsideMark: false };
}

function getDataLabelColor(
  mode: NonNullable<ViewConfig["chartDataLabelColor"]>,
  colors: ThemeColors,
  background: string | null,
): string {
  if (mode === "dark") return colors.text;
  if (mode === "light") return "#ffffff";
  if (mode === "accent") return colors.accent;
  const luminance = background ? getRelativeLuminance(background) : null;
  if (luminance == null) return "#ffffff";
  return luminance > 0.58 ? "#111827" : "#ffffff";
}

function getDatasetBackgroundColor(dataset: ChartDataset, index: number): string | null {
  const background = dataset.backgroundColor;
  if (typeof background === "string") return background;
  if (Array.isArray(background)) {
    const colors: unknown[] = background;
    const color = colors[index % colors.length];
    return typeof color === "string" ? color : null;
  }
  return null;
}

function getRelativeLuminance(color: string): number | null {
  const rgb = parseRgbColor(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseRgbColor(color: string): [number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = color.trim().match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (!rgb) return null;
  const parts = rgb.split(",").slice(0, 3).map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return [
    Math.max(0, Math.min(255, parts[0])),
    Math.max(0, Math.min(255, parts[1])),
    Math.max(0, Math.min(255, parts[2])),
  ];
}

function getBarElementGeometry(element: unknown): { x: number; y: number; base: number; width: number; height: number } | null {
  const candidate = element as {
    x?: number;
    y?: number;
    base?: number;
    width?: number;
    height?: number;
    getProps?: (props: string[], final?: boolean) => Record<string, unknown>;
  };
  const props = candidate.getProps?.(["x", "y", "base", "width", "height"], true) || candidate;
  const x = Number(props.x);
  const y = Number(props.y);
  const base = Number(props.base);
  const width = Number(props.width);
  const height = Number(props.height);
  if (![x, y, base, width, height].every(Number.isFinite)) return null;
  return { x, y, base, width, height };
}

function formatDataLabelText(
  value: number,
  label: string,
  total: number,
  mode: ViewConfig["chartDataLabelMode"],
  formatValue: (value: number | null | undefined) => string,
): string {
  if (mode === "percent") {
    return total > 0 ? `${((value / total) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : "0%";
  }
  if (mode === "label-value") {
    return label ? `${label} ${formatValue(value)}` : formatValue(value);
  }
  return formatValue(value);
}

type DonutCenterPlugin = Plugin & { mode: NonNullable<ViewConfig["chartDonutCenterMode"]> };

function createDonutCenterPlugin(
  formatValue: (value: number | null | undefined) => string,
  mode: NonNullable<ViewConfig["chartDonutCenterMode"]>,
  value: number | null,
): DonutCenterPlugin {
  return {
    id: "noteDatabaseDonutCenter",
    mode,
    afterDraw(chart) {
      if (mode === "hidden" || value == null) return;
      const area = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "600 18px sans-serif";
      ctx.fillText(formatValue(value), (area.left + area.right) / 2, (area.top + area.bottom) / 2);
      ctx.restore();
    },
  };
}

function getDonutCenterMode(config: ViewConfig | undefined): NonNullable<ViewConfig["chartDonutCenterMode"]> {
  if (config?.chartDonutCenterMode === "total" || config?.chartDonutCenterMode === "aggregation" || config?.chartDonutCenterMode === "hidden") {
    return config.chartDonutCenterMode;
  }
  return config?.chartShowDonutCenter === true ? "total" : "hidden";
}

function getDonutCenterValue(result: ChartRenderResult, config: ViewConfig | undefined): number | null {
  const values = getResultValues(result);
  if (values.length === 0) return null;
  const mode = getDonutCenterMode(config);
  if (mode === "hidden") return null;
  if (mode === "total") return values.reduce((sum, value) => sum + value, 0);
  return getCenterAggregationValue(values, config?.chartAggregation);
}

function getCenterAggregationValue(values: number[], aggregation: ViewConfig["chartAggregation"]): number {
  if (aggregation === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "median") return getMedian(values);
  if (aggregation === "min") return Math.min(...values);
  if (aggregation === "max") return Math.max(...values);
  if (aggregation === "range") return Math.max(...values) - Math.min(...values);
  return values.reduce((sum, value) => sum + value, 0);
}

interface ValueAxisOptions {
  beginAtZero?: boolean;
  min?: number;
  max?: number;
}

interface ResolvedReferenceLine {
  id: string;
  value: number;
  label: string;
  color?: string;
  style?: ChartReferenceLine["style"];
}

function getValueAxisOptions(config: ViewConfig | undefined, isPercentStacked: boolean): ValueAxisOptions {
  if (isPercentStacked) return { beginAtZero: true, min: 0, max: 100 };
  if (!config) return {};
  if (config.chartValueAxisRange === "zero-based") return { beginAtZero: true, min: 0 };
  if (config.chartValueAxisRange !== "custom") return {};
  const min = typeof config.chartValueAxisMin === "number" && Number.isFinite(config.chartValueAxisMin)
    ? config.chartValueAxisMin
    : undefined;
  const max = typeof config.chartValueAxisMax === "number" && Number.isFinite(config.chartValueAxisMax)
    ? config.chartValueAxisMax
    : undefined;
  if (min != null && max != null && min >= max) return {};
  return { min, max };
}

function resolveReferenceLines(
  result: ChartRenderResult,
  lines: ChartReferenceLine[],
  formatValue: (value: number | null | undefined) => string,
): ResolvedReferenceLine[] {
  const values = getResultValues(result);
  return lines
    .map((line): ResolvedReferenceLine | null => {
      const value = getReferenceLineValue(line, values);
      if (value == null) return null;
      const label = line.label?.trim() || getReferenceLineDefaultLabel(line, value, formatValue);
      return {
        id: line.id,
        value,
        label,
        color: line.color,
        style: line.style || "solid",
      };
    })
    .filter((line): line is ResolvedReferenceLine => line != null);
}

function getResultValues(result: ChartRenderResult): number[] {
  const values = isStackedResult(result)
    ? result.series.flatMap((series) => series.values)
    : result.points.map((point) => point.value);
  return values.filter((value) => Number.isFinite(value));
}

function getReferenceLineValue(line: ChartReferenceLine, values: number[]): number | null {
  if (line.type === "constant") return typeof line.value === "number" && Number.isFinite(line.value) ? line.value : null;
  if (values.length === 0) return null;
  if (line.type === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (line.type === "median") return getMedian(values);
  if (line.type === "min") return Math.min(...values);
  if (line.type === "max") return Math.max(...values);
  return null;
}

function getMedian(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getReferenceLineDefaultLabel(
  line: ChartReferenceLine,
  value: number,
  formatValue: (value: number | null | undefined) => string,
): string {
  const formatted = formatValue(value);
  if (line.type === "average") return `${t("chart.referenceLineAverage")} ${formatted}`;
  if (line.type === "median") return `${t("chart.referenceLineMedian")} ${formatted}`;
  if (line.type === "min") return `${t("chart.referenceLineMin")} ${formatted}`;
  if (line.type === "max") return `${t("chart.referenceLineMax")} ${formatted}`;
  return `${t("chart.referenceLineConstant")} ${formatted}`;
}

function createReferenceLinesPlugin(lines: ResolvedReferenceLine[], isHorizontal: boolean, colors: ThemeColors): Plugin {
  return {
    id: "noteDatabaseReferenceLines",
    afterDatasetsDraw(chart) {
      const scale = isHorizontal ? chart.scales.x : chart.scales.y;
      const categoryScale = isHorizontal ? chart.scales.y : chart.scales.x;
      if (!scale || !categoryScale) return;
      const area = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "11px sans-serif";
      ctx.textBaseline = "middle";
      for (const line of lines) {
        const pixel = scale.getPixelForValue(line.value);
        if (!Number.isFinite(pixel)) continue;
        ctx.strokeStyle = line.color || colors.muted;
        ctx.fillStyle = line.color || colors.muted;
        ctx.lineWidth = 1;
        ctx.setLineDash(getReferenceLineDash(line.style));
        ctx.beginPath();
        if (isHorizontal) {
          ctx.moveTo(pixel, area.top);
          ctx.lineTo(pixel, area.bottom);
          ctx.stroke();
          ctx.textAlign = "left";
          ctx.fillText(line.label, pixel + 6, area.top + 12);
        } else {
          ctx.moveTo(area.left, pixel);
          ctx.lineTo(area.right, pixel);
          ctx.stroke();
          ctx.textAlign = "right";
          ctx.fillText(line.label, area.right - 6, pixel - 8);
        }
      }
      ctx.restore();
    },
  };
}

function getReferenceLineDash(style: ChartReferenceLine["style"]): number[] {
  if (style === "dashed") return [6, 4];
  if (style === "dotted") return [2, 4];
  return [];
}

function getChartJsType(chartType: ChartType): ChartJsType {
  if (chartType === "line" || chartType === "area") return "line";
  if (chartType === "donut") return "doughnut";
  if (chartType === "pie") return "pie";
  return "bar";
}

function isSeriesChartType(chartType: ChartType): boolean {
  return chartType === "stacked-bar" ||
    chartType === "grouped-bar" ||
    chartType === "percent-stacked-bar" ||
    chartType === "line" ||
    chartType === "area";
}

function isStackedChartType(chartType: ChartType): boolean {
  return chartType === "stacked-bar" || chartType === "percent-stacked-bar";
}

function shouldUseSeriesAggregation(config: ViewConfig): boolean {
  const chartType = config.chartType || "bar";
  if (chartType === "stacked-bar" || chartType === "grouped-bar" || chartType === "percent-stacked-bar") return true;
  return (chartType === "line" || chartType === "area") && Boolean(getConfigSeriesField(config));
}

function getConfigSeriesField(config: ViewConfig): string | undefined {
  return config.chartSeriesField || config.chartStackField;
}

function isStackedResult(result: ChartRenderResult): result is ChartStackedAggregateResult {
  return "series" in result;
}

function getTooltipNumericValue(parsed: unknown, isHorizontal: boolean): number {
  if (typeof parsed === "number") return parsed;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const value = isHorizontal ? record.x : record.y;
    return typeof value === "number" ? value : Number(value);
  }
  return Number(parsed);
}

function isCanvasElement(value: unknown): value is HTMLCanvasElement {
  return Boolean(value && typeof (value as { toDataURL?: unknown }).toDataURL === "function");
}

function getClickedElementIndex(elements: unknown): number | undefined {
  if (!Array.isArray(elements) || elements.length === 0) return undefined;
  const first = elements[0] as { index?: unknown };
  return typeof first.index === "number" ? first.index : undefined;
}

function getClickedElementDatasetIndex(elements: unknown): number | undefined {
  if (!Array.isArray(elements) || elements.length === 0) return undefined;
  const first = elements[0] as { datasetIndex?: unknown };
  return typeof first.datasetIndex === "number" ? first.datasetIndex : undefined;
}

function aggregateSingleNumber(rows: RowData[], config: ViewConfig, columns: ColumnDef[]): ChartAggregateResult {
  if (rows.length === 0) return { points: [], emptyReason: "noRecords" };
  const aggregation = config.chartAggregation || "count";
  const valueColumn = !requiresChartValueField(aggregation)
    ? undefined
    : columns.find((col) => col.key === config.chartValueField);
  if (requiresChartValueField(aggregation) && (!valueColumn || !isChartAggregationValueColumn(valueColumn, aggregation, config.schema.computedFields))) {
    return { points: [], emptyReason: "noValueFieldSelected" };
  }
  const rawValues = rows.map((row) => valueColumn ? getChartValue(row, valueColumn.key, valueColumn) : 1);
  const value = getSingleNumberValue(rawValues, aggregation);
  return { points: [{ key: "__total__", label: t("chart.total"), value }] };
}

function getSingleNumberValue(values: unknown[], aggregation: ViewConfig["chartAggregation"]): number {
  if (!aggregation || aggregation === "count") return values.length;
  if (isNumericChartAggregation(aggregation)) {
    const numericValues = values
      .map((value) => toChartNumber(value))
      .filter((value): value is number => value != null);
    if (numericValues.length === 0) return 0;
    const sum = numericValues.reduce((total, value) => total + value, 0);
    if (aggregation === "sum") return sum;
    if (aggregation === "avg") return sum / numericValues.length;
    if (aggregation === "median") return getSingleNumberMedian(numericValues);
    if (aggregation === "min") return Math.min(...numericValues);
    if (aggregation === "max") return Math.max(...numericValues);
    if (aggregation === "range") return Math.max(...numericValues) - Math.min(...numericValues);
  }
  const emptyCount = values.filter((value) => isEmptySingleNumberValue(value)).length;
  const notEmptyCount = values.length - emptyCount;
  if (aggregation === "empty") return emptyCount;
  if (aggregation === "not-empty") return notEmptyCount;
  if (aggregation === "percent-empty") return values.length > 0 ? (emptyCount / values.length) * 100 : 0;
  if (aggregation === "percent-not-empty") return values.length > 0 ? (notEmptyCount / values.length) * 100 : 0;
  if (aggregation === "unique") return new Set(values.flatMap((value) => toSingleNumberUniqueValues(value))).size;
  const checkedCount = values.filter((value) => value === true).length;
  const uncheckedCount = values.filter((value) => value === false).length;
  if (aggregation === "checked") return checkedCount;
  if (aggregation === "unchecked") return uncheckedCount;
  if (aggregation === "percent-checked") {
    const checkboxCount = checkedCount + uncheckedCount;
    return checkboxCount > 0 ? (checkedCount / checkboxCount) * 100 : 0;
  }
  return values.length;
}

function isEmptySingleNumberValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0 || value.every((item) => isEmptySingleNumberValue(item));
  return false;
}

function toSingleNumberUniqueValues(value: unknown): string[] {
  if (isEmptySingleNumberValue(value)) return [];
  if (Array.isArray(value)) return Array.from(new Set(value.flatMap((item) => toSingleNumberUniqueValues(item))));
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return [value.toString()];
  return [String(value)];
}

function getSingleNumberMedian(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getChartValue(row: RowData, fieldKey: string, column?: ColumnDef): unknown {
  const fileValue = getChartFileValue(row, fieldKey);
  if (fileValue !== undefined) return fileValue;
  const computedKey = column?.type === "computed"
    ? column.computedKey || (column.key.startsWith("formula.") ? column.key.slice("formula.".length) : column.key)
    : fieldKey.startsWith("formula.")
      ? fieldKey.slice("formula.".length)
      : undefined;
  if (computedKey && Object.prototype.hasOwnProperty.call(row.computed, computedKey)) return row.computed[computedKey];
  if (Object.prototype.hasOwnProperty.call(row.computed, fieldKey)) return row.computed[fieldKey];
  if (Object.prototype.hasOwnProperty.call(row.frontmatter, fieldKey)) return row.frontmatter[fieldKey];
  return null;
}

function getChartFileValue(row: RowData, fieldKey: string): unknown {
  if (!fieldKey.startsWith("file.")) return undefined;
  if (fieldKey === "file.name") return row.file.name;
  if (fieldKey === "file.file" || fieldKey === "file.path") return row.file.path;
  if (fieldKey === "file.basename") return row.file.basename || row.file.name.replace(/\.md$/i, "");
  if (fieldKey === "file.folder") return row.file.parent?.path || "";
  if (fieldKey === "file.ext" || fieldKey === "file.extension") return row.file.extension;
  if (fieldKey === "file.ctime" || fieldKey === "file.created") return row.file.stat?.ctime;
  if (fieldKey === "file.mtime" || fieldKey === "file.modified") return row.file.stat?.mtime;
  if (fieldKey === "file.size") return row.file.stat?.size;
  return undefined;
}

function getFallbackThemeColors(): ThemeColors {
  return {
    text: "#1f2937",
    muted: "#64748b",
    grid: "rgba(148, 163, 184, 0.35)",
    accent: "#3b82f6",
    accentHover: "#2563eb",
    background: "#ffffff",
  };
}

const STATUS_COLOR_HEX: Record<string, string> = {
  gray: "#787774",
  brown: "#8f5d45",
  orange: "#b65f00",
  yellow: "#8f6a00",
  green: "#448361",
  blue: "#2f6fad",
  purple: "#6940a5",
  pink: "#a83272",
  red: "#d44c47",
  slate: "#64748b",
  cyan: "#0891b2",
  teal: "#0f766e",
  lime: "#65a30d",
  indigo: "#4f46e5",
  violet: "#7c3aed",
  rose: "#e11d48",
};
const FILE_TAG_CHART_COLORS = ["#64748b", "#94a3b8", "#475569", "#cbd5e1"];

function getSingleSeriesBarColors(
  chartType: ChartType,
  result: ChartAggregateResult,
  config: ViewConfig | undefined,
  columns: ColumnDef[],
  colors: ThemeColors,
): string | string[] {
  if (config?.chartColorByValue && isSingleSeriesBarChart(chartType)) {
    return createValueIntensityColors(result.points.map((point) => point.value), colors.accent);
  }
  const optionColors = getOptionPointColors(result, config, columns);
  if (optionColors && (config?.chartColorPalette === "option" || config?.chartColorPalette === "auto" || !config?.chartColorPalette)) return optionColors;
  if (config?.chartColorPalette === "accent") return colors.accent;
  if (result.points.length <= 1 && (!config?.chartColorPalette || config.chartColorPalette === "auto")) return colors.accent;
  return createPaletteForConfig(config?.chartColorPalette, colors.accent, result.points.length);
}

function getSingleSeriesBarHoverColors(
  chartType: ChartType,
  result: ChartAggregateResult,
  config: ViewConfig | undefined,
  columns: ColumnDef[],
  colors: ThemeColors,
): string | string[] {
  const background = getSingleSeriesBarColors(chartType, result, config, columns, colors);
  return Array.isArray(background)
    ? background.map((color) => transparentize(color, 0.9))
    : colors.accentHover;
}

function getOptionPointColors(result: ChartAggregateResult, config: ViewConfig | undefined, columns: ColumnDef[]): string[] | null {
  const column = config?.chartGroupField ? columns.find((col) => col.key === config.chartGroupField) : undefined;
  if (column?.key === "file.tags") return createFileTagChartColors(result.points.length);
  const colorMap = getOptionColorMap(column);
  if (!colorMap) return null;
  return result.points.map((point) => colorMap.get(point.key) || STATUS_COLOR_HEX.gray);
}

function getOptionSeriesColors(result: ChartStackedAggregateResult, config: ViewConfig | undefined, columns: ColumnDef[]): string[] | null {
  const seriesField = config ? getConfigSeriesField(config) : undefined;
  const column = seriesField ? columns.find((col) => col.key === seriesField) : undefined;
  if (column?.key === "file.tags") return createFileTagChartColors(result.series.length);
  const colorMap = getOptionColorMap(column);
  if (!colorMap) return null;
  return result.series.map((series) => colorMap.get(series.key) || STATUS_COLOR_HEX.gray);
}

function createFileTagChartColors(count: number): string[] {
  return Array.from({ length: count }, (_, index) => FILE_TAG_CHART_COLORS[index % FILE_TAG_CHART_COLORS.length]);
}

function getOptionColorMap(column: ColumnDef | undefined): Map<string, string> | null {
  if (!column?.statusOptions?.length) return null;
  const entries = column.statusOptions
    .filter((option) => option.value)
    .map((option) => [option.value, STATUS_COLOR_HEX[option.color] || STATUS_COLOR_HEX.gray] as const);
  return entries.length > 0 ? new Map(entries) : null;
}

function isSingleSeriesBarChart(chartType: ChartType): boolean {
  return chartType === "bar" || chartType === "horizontal-bar";
}

function createValueIntensityColors(values: number[], accent: string): string[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return values.map(() => transparentize(accent, 0.5));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  return values.map((value) => {
    const ratio = span > 0 ? (value - min) / span : 1;
    return transparentize(accent, Number((0.35 + ratio * 0.5).toFixed(3)));
  });
}

function wrapCategoryLabel(label: string): string | string[] {
  if (label.length <= 18) return label;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return truncateLabel(label, 28);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > 16 && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length === 2 && current.length > 0) break;
  }
  if (current) lines.push(current);
  const consumed = lines.join(" ");
  if (consumed.length < label.length && lines.length > 0) {
    lines[lines.length - 1] = truncateLabel(lines[lines.length - 1], 13);
  }
  return lines.slice(0, 3).map((line) => truncateWrappedLabelLine(line));
}

function truncateWrappedLabelLine(label: string): string {
  return /\s/.test(label) ? truncateLabel(label, 18) : truncateLabel(label, 15);
}

function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, Math.max(0, maxLength - 1))}…` : label;
}

function toFullCategoryLabel(label: unknown): string {
  if (Array.isArray(label)) return label.map((item) => String(item)).join(" ");
  if (typeof label === "string") return label;
  return "";
}

function transparentize(color: string, alpha: number): string {
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  if (color.startsWith("rgba(")) return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = Number.parseInt(color.slice(1, 3), 16);
    const g = Number.parseInt(color.slice(3, 5), 16);
    const b = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function createPaletteForConfig(palette: ChartColorPalette | undefined, accent: string, count: number): string[] {
  if (count <= 0) return [];
  if (palette === "accent") return Array.from({ length: count }, () => accent || CHART_PRESET_PALETTES.colorful[0]);
  if (!palette || palette === "auto" || palette === "option") {
    const fallback = CHART_PRESET_PALETTES.colorful;
    return Array.from({ length: count }, (_, index) => {
      if (index === 0 && accent) return accent;
      return fallback[index % fallback.length];
    });
  }
  const preset = palette;
  const colors = CHART_PRESET_PALETTES[preset] || CHART_PRESET_PALETTES.colorful;
  return Array.from({ length: count }, (_, index) => colors[index % colors.length]);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",", 2);
  const mime = header.match(/^data:([^;]+);base64$/)?.[1] || "image/png";
  const binary = atob(payload || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
