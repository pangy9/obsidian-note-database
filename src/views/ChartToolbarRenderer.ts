import { setIcon } from "obsidian";
import { getColumnOptionValues } from "../data/ColumnTypes";
import {
  getDefaultChartValueField,
  getDefaultChartNumberBucket,
  isChartAggregationValueColumn,
  isCheckboxChartAggregation,
  isChartDateGroupColumn,
  isChartGroupColumn,
  isChartNumberGroupColumn,
  isNumericChartAggregation,
  isChartSeriesColumn,
  isChartStackColumn,
  requiresChartValueField,
} from "../data/ChartAggregation";
import { getChartPalettePreviewColors } from "../data/ChartPalettes";
import { getChartAutoTitle, getDefaultChartAggregationForValueField, isChartAggregationAllowedForValueField, isChartCumulativeSupported, normalizeChartAggregationForValueField, normalizeChartConfigForType, normalizeChartSecondaryAggregationForValueField } from "../data/ChartViewModel";
import { ChartColorPalette, ChartDateBucket, ChartNumberBucket, ChartReferenceLine, ChartType, ChartValueAxisRange, ColumnDef, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { clamp, getVisiblePopoverBounds, positionToolbarPopover, setPosition } from "./PopoverPosition";
import { createDropdownField, DropdownOption } from "./DropdownField";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon } from "./PropertyTypeIcon";

export interface ChartToolbarActions {
  onChange(label?: string): void;
  onExportImage?(): void;
  onCopyPng?(): void;
}

interface SelectOption extends DropdownOption {
  value: string;
  text: string;
}

type ChartOptionIcon = string;
type ChartValueSlot = "primary" | "secondary";

interface ChildPopoverSizeOptions {
  minWidth?: number;
  preferredWidth?: number;
  maxWidth?: number;
}

const REFERENCE_LINE_COLORS = [
  { value: "", color: "#94a3b8", labelKey: "chart.referenceLineColorDefault" },
  { value: "#64748b", color: "#64748b", labelKey: "chart.referenceLineColorGray" },
  { value: "#3b82f6", color: "#3b82f6", labelKey: "chart.referenceLineColorBlue" },
  { value: "#22c55e", color: "#22c55e", labelKey: "chart.referenceLineColorGreen" },
  { value: "#f59e0b", color: "#f59e0b", labelKey: "chart.referenceLineColorAmber" },
  { value: "#ef4444", color: "#ef4444", labelKey: "chart.referenceLineColorRed" },
  { value: "#8b5cf6", color: "#8b5cf6", labelKey: "chart.referenceLineColorPurple" },
  { value: "#ec4899", color: "#ec4899", labelKey: "chart.referenceLineColorPink" },
];

function getChartGroupOptions(config: ViewConfig): SelectOption[] {
  return config.schema.columns
    .filter((col) => col.key !== "file.name" && isChartGroupColumn(col, config.schema.computedFields))
    .map(toChartFieldOption);
}

function getChartMeasureFieldOptions(config: ViewConfig): SelectOption[] {
  return [
    { value: "", text: t("chart.recordsValue"), icon: "database" },
    ...config.schema.columns
      .filter((col) => col.key !== "file.name" && isChartAggregationValueColumn(col, "unique", config.schema.computedFields))
      .map(toChartFieldOption),
  ];
}

function getChartStackOptions(config: ViewConfig): SelectOption[] {
  return config.schema.columns
    .filter((col) => col.key !== "file.name" && col.key !== config.chartGroupField && isChartStackColumn(col.type))
    .map(toChartFieldOption);
}

function getDefaultChartStackField(config: ViewConfig): string | undefined {
  return getChartStackOptions(config)[0]?.value;
}

function getChartSeriesOptions(config: ViewConfig): SelectOption[] {
  return config.schema.columns
    .filter((col) => col.key !== "file.name" && col.key !== config.chartGroupField && isChartSeriesColumn(col, config.schema.computedFields))
    .map(toChartFieldOption);
}

function toChartFieldOption(col: ColumnDef): SelectOption {
  return {
    value: col.key,
    text: col.label || col.key,
    icon: getPropertyDropdownIcon(col.type),
    section: getChartFieldSection(col),
  };
}

function getChartFieldSection(col: ColumnDef): string {
  if (col.key.startsWith("file.")) return t("chart.fieldGroup.fileMetadata");
  if (col.type === "computed" || col.key.startsWith("formula.")) return t("chart.fieldGroup.formulas");
  return t("chart.fieldGroup.properties");
}

function getSelectedSeriesField(config: ViewConfig): string | undefined {
  return config.chartSeriesField || config.chartStackField;
}

function getDefaultChartSeriesField(config: ViewConfig): string | undefined {
  return getChartSeriesOptions(config)[0]?.value || getDefaultChartStackField(config);
}

function supportsChartSeriesField(type: ChartType | undefined): boolean {
  return type === "stacked-bar" || type === "grouped-bar" || type === "percent-stacked-bar" || type === "line" || type === "area";
}

function requiresChartSeriesField(type: ChartType | undefined): boolean {
  return type === "stacked-bar" || type === "grouped-bar" || type === "percent-stacked-bar";
}

function getChartTypeOptions(): SelectOption[] {
  return [
    { value: "bar", text: t("chart.barChart"), icon: "bar-chart" },
    { value: "horizontal-bar", text: t("chart.horizontalBarChart"), icon: "bar-chart-horizontal" },
    { value: "line", text: t("chart.lineChart"), icon: "line-chart" },
    { value: "area", text: t("chart.areaChart"), icon: "chart-area" },
    { value: "donut", text: t("chart.donutChart"), icon: "pie-chart" },
    { value: "number", text: t("chart.numberChart"), icon: "hash" },
    { value: "stacked-bar", text: t("chart.stackedBarChart"), icon: "chart-column-stacked" },
    { value: "grouped-bar", text: t("chart.groupedBarChart"), icon: "bar-chart-3" },
    { value: "percent-stacked-bar", text: t("chart.percentStackedBarChart"), icon: "percent" },
    { value: "mixed", text: t("chart.mixedChart"), icon: "chart-no-axes-combined" },
  ];
}

function getDateBucketOptions(): SelectOption[] {
  return [
    { value: "day", text: t("chart.dateBucketDay") },
    { value: "week", text: t("chart.dateBucketWeek") },
    { value: "month", text: t("chart.dateBucketMonth") },
    { value: "quarter", text: t("chart.dateBucketQuarter") },
    { value: "year", text: t("chart.dateBucketYear") },
  ];
}

function getNumberBucketOptions(): SelectOption[] {
  return [
    { value: "auto", text: t("chart.numberBucketAuto") },
    { value: "fixed", text: t("chart.numberBucketFixed") },
  ];
}

function getAxisRangeOptions(): SelectOption[] {
  return [
    { value: "auto", text: t("chart.axisAuto") },
    { value: "zero-based", text: t("chart.axisZeroBased") },
    { value: "custom", text: t("chart.axisCustom") },
  ];
}

function getColorPaletteOptions(): SelectOption[] {
  return ([
    { value: "auto", text: t("chart.colorPaletteAuto") },
    { value: "accent", text: t("chart.colorPaletteAccent") },
    { value: "colorful", text: t("chart.colorPaletteColorful") },
    { value: "pastel", text: t("chart.colorPalettePastel") },
    { value: "vivid", text: t("chart.colorPaletteVivid") },
    { value: "warm", text: t("chart.colorPaletteWarm") },
    { value: "cool", text: t("chart.colorPaletteCool") },
    { value: "mono", text: t("chart.colorPaletteMono") },
    { value: "option", text: t("chart.colorPaletteOption") },
  ] as Array<{ value: ChartColorPalette; text: string }>).map((option) => ({
    ...option,
    swatches: getChartPalettePreviewColors(option.value),
  }));
}

function getDataLabelModeOptions(): SelectOption[] {
  return [
    { value: "value", text: t("chart.dataLabelValue") },
    { value: "percent", text: t("chart.dataLabelPercent") },
    { value: "label-value", text: t("chart.dataLabelLabelValue") },
  ];
}

function getDataLabelColorOptions(): SelectOption[] {
  return [
    { value: "auto", text: t("chart.dataLabelColorAuto") },
    { value: "dark", text: t("chart.dataLabelColorDark") },
    { value: "light", text: t("chart.dataLabelColorLight") },
    { value: "accent", text: t("chart.dataLabelColorAccent") },
  ];
}

function getDonutCenterModeOptions(): SelectOption[] {
  return [
    { value: "hidden", text: t("chart.donutCenterHidden") },
    { value: "total", text: t("chart.donutCenterTotal") },
    { value: "aggregation", text: t("chart.donutCenterAggregation") },
  ];
}

function getReferenceLineTypeOptions(): SelectOption[] {
  return [
    { value: "constant", text: t("chart.referenceLineConstant") },
    { value: "average", text: t("chart.referenceLineAverage") },
    { value: "median", text: t("chart.referenceLineMedian") },
    { value: "min", text: t("chart.referenceLineMin") },
    { value: "max", text: t("chart.referenceLineMax") },
  ];
}

function getReferenceLineStyleOptions(): SelectOption[] {
  return [
    { value: "solid", text: t("chart.referenceLineSolid") },
    { value: "dashed", text: t("chart.referenceLineDashed") },
    { value: "dotted", text: t("chart.referenceLineDotted") },
  ];
}

function getChartAggregationOptions(config: ViewConfig, fieldKey: string | undefined): SelectOption[] {
  return [
    { value: "count", text: t("chart.countAggregation") },
    { value: "sum", text: t("chart.sumAggregation") },
    { value: "avg", text: t("chart.avgAggregation") },
    { value: "median", text: t("chart.medianAggregation") },
    { value: "min", text: t("chart.minAggregation") },
    { value: "max", text: t("chart.maxAggregation") },
    { value: "range", text: t("chart.rangeAggregation") },
    { value: "unique", text: t("chart.uniqueAggregation") },
    { value: "empty", text: t("chart.emptyAggregation") },
    { value: "not-empty", text: t("chart.notEmptyAggregation") },
    { value: "percent-empty", text: t("chart.percentEmptyAggregation") },
    { value: "percent-not-empty", text: t("chart.percentNotEmptyAggregation") },
    { value: "checked", text: t("chart.checkedAggregation") },
    { value: "unchecked", text: t("chart.uncheckedAggregation") },
    { value: "percent-checked", text: t("chart.percentCheckedAggregation") },
  ].map((option) => {
    const aggregation = option.value as ViewConfig["chartAggregation"];
    const allowed = isChartAggregationAllowedForValueField(config, aggregation, fieldKey);
    return {
      ...option,
      disabled: !allowed,
      disabledReason: allowed ? undefined : getChartAggregationDisabledReason(aggregation, fieldKey),
    };
  });
}

function getChartAggregationDisabledReason(aggregation: ViewConfig["chartAggregation"], fieldKey: string | undefined): string {
  if (!fieldKey) return t("chart.disabledAggregationNeedsValue");
  if (isNumericChartAggregation(aggregation)) return t("chart.disabledAggregationNumericOnly");
  if (isCheckboxChartAggregation(aggregation)) return t("chart.disabledAggregationCheckboxOnly");
  return t("chart.disabledAggregationForValue");
}

function getOrderedChartAggregationOptions(config: ViewConfig, fieldKey: string | undefined): SelectOption[] {
  const options = getChartAggregationOptions(config, fieldKey);
  const enabled = options.filter((option) => !option.disabled);
  const disabled = options.filter((option) => option.disabled);
  return [...enabled, ...disabled];
}

function isAxislessChart(type: ChartType | undefined): boolean {
  const chartType = type || "bar";
  return chartType === "pie" || chartType === "donut" || chartType === "number";
}

function isSelectedGroupDateField(config: ViewConfig): boolean {
  const field = config.chartGroupField;
  const column = field ? config.schema.columns.find((col) => col.key === field) : undefined;
  return Boolean(column && isChartDateGroupColumn(column, config.schema.computedFields));
}

function isSelectedGroupNumberField(config: ViewConfig): boolean {
  const field = config.chartGroupField;
  const column = field ? config.schema.columns.find((col) => col.key === field) : undefined;
  return Boolean(column && isChartNumberGroupColumn(column, config.schema.computedFields));
}

function isSelectedChartValueFieldValid(
  config: ViewConfig,
  aggregation: ViewConfig["chartAggregation"],
  fieldKey: string | undefined,
): boolean {
  if (!fieldKey) return false;
  const column = config.schema.columns.find((col) => col.key === fieldKey);
  return Boolean(column && isChartAggregationValueColumn(column, aggregation, config.schema.computedFields));
}

export class ChartToolbarRenderer {
  private cleanupPopover?: () => void;
  private popover?: HTMLElement;
  private childCleanupPopover?: () => void;
  private childPopover?: HTMLElement;

  togglePopover(containerEl: HTMLElement, anchor: HTMLElement, config: ViewConfig | undefined, actions: ChartToolbarActions): void {
    if (!config || config.viewType !== "chart") return;
    if (this.popover?.isConnected) {
      this.closePopover();
      return;
    }
    this.openPopover(containerEl, anchor, config, actions);
  }

  isPopoverOpen(): boolean {
    return Boolean(this.popover?.isConnected);
  }

  private openPopover(containerEl: HTMLElement, anchor: HTMLElement, config: ViewConfig, actions: ChartToolbarActions): void {
    this.closePopover();
    const panel = containerEl.createDiv({ cls: "db-chart-options-popover" });
    this.popover = panel;
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("chart.options") });
    this.renderPopoverContent(panel, containerEl, config, actions);
    positionToolbarPopover(panel, anchor, { preferredWidth: 520, maxWidth: 560 });
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && this.childPopover?.isConnected) {
        if (this.childPopover.contains(target) || this.isInsideChartDropdownPopover(target)) return;
        this.closeChildPopover();
        return;
      }
      if (target && (
        panel.contains(target) ||
        anchor.contains(target) ||
        this.childPopover?.contains(target) ||
        this.isInsideChartDropdownPopover(target)
      )) return;
      this.closePopover();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (this.childPopover?.isConnected) {
        this.closeChildPopover();
        return;
      }
      this.closePopover();
    };
    const outsideTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    window.activeDocument.addEventListener("keydown", onKeyDown, true);
    this.cleanupPopover = installPopoverAutoClose({
      panel,
      anchorEl: anchor,
      delayMs: 12000,
      isActiveTarget: (target) => this.isInsideChartPopoverSurface(target),
      close: () => {
        this.closePopover();
      },
    });
    const cleanupAutoClose = this.cleanupPopover;
    this.cleanupPopover = () => {
      window.clearTimeout(outsideTimer);
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      window.activeDocument.removeEventListener("keydown", onKeyDown, true);
      cleanupAutoClose();
      this.closeChildPopover();
      panel.remove();
      this.popover = undefined;
    };
  }

  private renderPopoverContent(panel: HTMLElement, containerEl: HTMLElement, config: ViewConfig, actions: ChartToolbarActions): void {
    this.renderDataSection(panel, containerEl, config, actions);
    this.renderGroupsSection(panel, containerEl, config, actions);
    this.renderStyleEntry(panel, containerEl, config, actions);
    this.renderExportSection(panel, actions);
  }

  private refreshOpenPopover(containerEl: HTMLElement | undefined, config: ViewConfig, actions: ChartToolbarActions): void {
    const panel = this.popover;
    const host = containerEl || panel?.parentElement;
    if (!panel?.isConnected || !host) return;
    this.closeChildPopover();
    Array.from(panel.children).forEach((child) => {
      if (!isHTMLElement(child) || !child.hasClass("db-panel-header")) child.remove();
    });
    this.renderPopoverContent(panel, host, config, actions);
  }

  closePopover(): void {
    this.cleanupPopover?.();
    this.cleanupPopover = undefined;
    this.closeChildPopover();
    this.popover?.remove();
    this.popover = undefined;
  }

  private renderDataSection(panel: HTMLElement, containerEl: HTMLElement, config: ViewConfig, actions: ChartToolbarActions): void {
    const section = this.createSection(panel, t("chart.optionsData"));
    normalizeChartAggregationForValueField(config);
    if ((config.chartType || "bar") === "mixed") normalizeChartSecondaryAggregationForValueField(config);
    this.renderSelect(section, t("chart.toolbarType"), getChartTypeOptions(), config.chartType || "bar", (value) => {
      config.chartType = value as ChartType;
      normalizeChartConfigForType(config);
      normalizeChartAggregationForValueField(config);
      if ((config.chartType || "bar") === "mixed") normalizeChartSecondaryAggregationForValueField(config);
      actions.onChange(t("undo.chartTypeConfig"));
      this.refreshOpenPopover(containerEl, config, actions);
    }, "bar-chart");
    if ((config.chartType || "bar") !== "number") {
      this.renderSelect(section, t("chart.toolbarGroup"), [{ value: "", text: t("viewConfig.chartGroupFieldNone") }, ...getChartGroupOptions(config)], config.chartGroupField || "", (value) => {
        config.chartGroupField = value || undefined;
        if (config.chartStackField === config.chartGroupField || config.chartSeriesField === config.chartGroupField) {
          config.chartSeriesField = getDefaultChartSeriesField(config);
          config.chartStackField = config.chartSeriesField;
        }
        const groupColumn = config.schema.columns.find((col) => col.key === config.chartGroupField);
        config.chartDateBucket = groupColumn && isChartDateGroupColumn(groupColumn, config.schema.computedFields) ? config.chartDateBucket || "month" : undefined;
        config.chartNumberBucket = groupColumn && isChartNumberGroupColumn(groupColumn, config.schema.computedFields)
          ? config.chartNumberBucket || getDefaultChartNumberBucket(config.schema.columns, config.chartGroupField, config.schema.computedFields)
          : undefined;
        if (!config.chartNumberBucket) config.chartNumberBucketSize = undefined;
        config.chartHiddenGroups = undefined;
        actions.onChange(t("undo.chartGroupConfig"));
        this.refreshOpenPopover(containerEl, config, actions);
        }, "group", false, true);
      if (isSelectedGroupDateField(config)) {
        this.renderSelect(section, t("chart.toolbarBucket"), getDateBucketOptions(), config.chartDateBucket || "month", (value) => {
          config.chartDateBucket = value as ChartDateBucket;
          actions.onChange(t("undo.chartDateBucketConfig"));
        }, "calendar-days");
      }
      if (isSelectedGroupNumberField(config)) {
        this.renderSelect(section, t("chart.toolbarBucket"), getNumberBucketOptions(), config.chartNumberBucket || "auto", (value) => {
          config.chartNumberBucket = value as ChartNumberBucket;
          if (config.chartNumberBucket !== "fixed") config.chartNumberBucketSize = undefined;
          actions.onChange(t("undo.chartNumberBucketConfig"));
          this.refreshOpenPopover(containerEl, config, actions);
        }, "ruler");
        if ((config.chartNumberBucket || "auto") === "fixed") {
          this.renderTextInput(section, t("chart.numberBucketSize"), String(config.chartNumberBucketSize || ""), "10", (value) => {
            const size = Number(value);
            config.chartNumberBucketSize = Number.isFinite(size) && size > 0 ? size : undefined;
            actions.onChange(t("undo.chartNumberBucketSizeConfig"));
          }, "hash");
        }
      }
    if (supportsChartSeriesField(config.chartType || "bar")) {
      const type = config.chartType || "bar";
      const allowNone = !requiresChartSeriesField(type);
        const options = [
          ...(allowNone ? [{ value: "", text: t("viewConfig.chartStackFieldNone") }] : []),
          ...getChartSeriesOptions(config),
        ];
        this.renderSelect(section, t("chart.toolbarSubgroup"), options, getSelectedSeriesField(config) || "", (value) => {
          config.chartSeriesField = value || undefined;
          config.chartStackField = config.chartSeriesField;
          actions.onChange(t("undo.chartSubgroupConfig"));
        }, "layers", false, true);
      }
    }
    this.renderPopoverEntry(section, t("chart.toolbarValue"), this.getValueAggregationSummary(config, "primary"), "hash", (anchor) => {
      this.openValueAggregationPopover(containerEl, anchor, config, actions, "primary");
    });
    if ((config.chartType || "bar") === "mixed") {
      this.renderPopoverEntry(section, t("chart.toolbarLineValue"), this.getValueAggregationSummary(config, "secondary"), "line-chart", (anchor) => {
        this.openValueAggregationPopover(containerEl, anchor, config, actions, "secondary");
      });
    }
    this.renderSelect(section, t("chart.sortBy"), [
      { value: "option-order", text: t("chart.sortOptionOrder") },
      { value: "value-desc", text: t("chart.sortValueDesc") },
      { value: "value-asc", text: t("chart.sortValueAsc") },
      { value: "label-asc", text: t("chart.sortLabelAsc") },
      { value: "label-desc", text: t("chart.sortLabelDesc") },
    ], config.chartSortBy || "option-order", (value) => {
      config.chartSortBy = value as ViewConfig["chartSortBy"];
      actions.onChange(t("undo.chartSortConfig"));
    }, "arrow-up-down");
    this.renderSwitch(section, t("chart.omitZeroValues"), config.chartOmitZeroValues === true, (checked) => {
      config.chartOmitZeroValues = checked;
      actions.onChange(t("undo.chartOmitZeroValuesConfig"));
    }, "eye-off");
    const cumulativeSupported = isChartCumulativeSupported(config);
    if (!cumulativeSupported) config.chartCumulative = false;
    this.renderSwitch(section, t("chart.cumulative"), config.chartCumulative === true && cumulativeSupported, (checked) => {
      config.chartCumulative = checked && isChartCumulativeSupported(config);
      actions.onChange(t("undo.chartCumulativeConfig"));
      this.syncCumulativeSwitch(section, config);
    }, "trending-up", !cumulativeSupported, "cumulative", t("chart.disabledCumulative"));
  }

  private renderGroupsSection(panel: HTMLElement, containerEl: HTMLElement, config: ViewConfig, actions: ChartToolbarActions): void {
    const section = this.createSection(panel, t("chart.visibleGroups"));
    const column = config.chartGroupField ? config.schema.columns.find((col) => col.key === config.chartGroupField) : undefined;
    const groups = getVisibleGroupCandidates(column);
    const hiddenCount = groups.filter((group) => config.chartHiddenGroups?.[group]).length;
    this.renderPopoverEntry(section, t("chart.visibleGroupsEntry"), hiddenCount > 0 ? `${groups.length - hiddenCount}/${groups.length}` : String(groups.length), "list-checks", (anchor) => {
      this.openVisibleGroupsPopover(containerEl, anchor, config, actions, groups);
    }, groups.length === 0, t("chart.disabledNeedsGroups"));
  }

  private openValueAggregationPopover(
    containerEl: HTMLElement,
    anchor: HTMLElement,
    config: ViewConfig,
    actions: ChartToolbarActions,
    slot: ChartValueSlot,
  ): void {
    this.openChildPopover(containerEl, anchor, "db-chart-value-aggregation-popover", (panel) => {
      const header = panel.createDiv({ cls: "db-panel-header" });
      header.createDiv({ cls: "db-panel-title", text: slot === "primary" ? t("chart.toolbarValue") : t("chart.toolbarLineValue") });
      this.renderValueAggregationPopover(panel, config, actions, slot);
    });
  }

  private renderValueAggregationPopover(
    panel: HTMLElement,
    config: ViewConfig,
    actions: ChartToolbarActions,
    slot: ChartValueSlot,
  ): void {
    const section = panel.createDiv({ cls: "db-chart-options-section db-chart-options-section-plain" });
    this.renderValueAggregationControls(section, config, actions, slot);
  }

  private renderValueAggregationControls(
    section: HTMLElement,
    config: ViewConfig,
    actions: ChartToolbarActions,
    slot: ChartValueSlot,
  ): void {
    const fieldKey = slot === "primary" ? config.chartValueField : config.chartSecondaryValueField;
    this.renderSelect(section, t("chart.toolbarValue"), getChartMeasureFieldOptions(config), fieldKey || "", (value) => {
      this.setChartValueField(config, slot, value || undefined);
      if (slot === "primary") this.syncCumulativeSwitch(this.popover || section, config);
      actions.onChange(t("undo.chartValueFieldConfig"));
      this.refreshChartAggregationOptions(section, config, actions, slot);
    }, "hash", false, true);
    this.renderChartAggregationOptions(section, config, actions, slot);
  }

  private renderChartAggregationOptions(section: HTMLElement, config: ViewConfig, actions: ChartToolbarActions, slot: ChartValueSlot): void {
    const aggregation = (slot === "primary" ? config.chartAggregation : config.chartSecondaryAggregation) || "count";
    const aggregationTitle = section.createDiv({ cls: "db-chart-aggregation-title", text: t("chart.toolbarAggregation") });
    aggregationTitle.setAttr("role", "presentation");
    for (const option of getOrderedChartAggregationOptions(config, slot === "primary" ? config.chartValueField : config.chartSecondaryValueField)) {
      this.renderAggregationOption(section, option, aggregation, () => {
        this.setChartAggregation(config, slot, option.value as ViewConfig["chartAggregation"]);
        this.syncChartAggregationSelection(section, option.value);
        if (slot === "primary") this.syncCumulativeSwitch(this.popover || section, config);
        actions.onChange(t("undo.chartAggregationConfig"));
        this.refreshValueAggregationControls(section, config, actions, slot);
      });
    }
  }

  private refreshValueAggregationControls(section: HTMLElement, config: ViewConfig, actions: ChartToolbarActions, slot: ChartValueSlot): void {
    section.empty();
    this.renderValueAggregationControls(section, config, actions, slot);
  }

  private refreshChartAggregationOptions(section: HTMLElement, config: ViewConfig, actions: ChartToolbarActions, slot: ChartValueSlot): void {
    section.querySelectorAll<HTMLElement>(".db-chart-aggregation-title, .db-chart-aggregation-option").forEach((el) => el.remove());
    this.renderChartAggregationOptions(section, config, actions, slot);
  }

  private renderAggregationOption(parent: HTMLElement, option: SelectOption, currentValue: string, onClick: () => void): void {
    const selected = option.value === currentValue;
    const row = parent.createEl("button", {
      cls: `db-chart-options-row db-chart-aggregation-option${selected ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`,
      attr: { type: "button", role: "option", "aria-selected": selected ? "true" : "false" },
    });
    row.setAttr("data-value", option.value);
    row.disabled = option.disabled === true;
    if (option.disabledReason) {
      row.setAttr("title", option.disabledReason);
      row.setAttr("aria-label", `${option.text}: ${option.disabledReason}`);
    }
    const icon = row.createSpan({ cls: "db-chart-options-row-icon" });
    if (selected) setIcon(icon, "check");
    const text = row.createDiv({ cls: "db-chart-options-row-text" });
    text.createSpan({ cls: "db-chart-options-label", text: option.text });
    if (option.disabledReason) text.createSpan({ cls: "db-chart-options-value", text: option.disabledReason });
    row.createSpan();
    row.onclick = () => {
      if (row.disabled) return;
      onClick();
    };
  }

  private syncChartAggregationSelection(parent: HTMLElement, value: string): void {
    for (const row of parent.querySelectorAll<HTMLButtonElement>(".db-chart-aggregation-option")) {
      const selected = row.getAttribute("data-value") === value;
      row.toggleClass("is-selected", selected);
      row.setAttr("aria-selected", selected ? "true" : "false");
      const icon = row.querySelector<HTMLElement>(".db-chart-options-row-icon");
      icon?.replaceChildren();
      if (selected && icon) setIcon(icon, "check");
    }
  }

  private setChartValueField(config: ViewConfig, slot: ChartValueSlot, value: string | undefined): void {
    if (slot === "secondary") {
      const previousAggregation = config.chartSecondaryAggregation || "count";
      config.chartSecondaryValueField = value;
      if (!config.chartSecondaryValueField) {
        config.chartSecondaryAggregation = "count";
      } else if (previousAggregation === "count" || !isChartAggregationAllowedForValueField(config, previousAggregation, config.chartSecondaryValueField)) {
        config.chartSecondaryAggregation = getDefaultChartAggregationForValueField(config, config.chartSecondaryValueField);
      }
      normalizeChartSecondaryAggregationForValueField(config);
      return;
    }

    const previousAggregation = config.chartAggregation || "count";
    config.chartValueField = value;
    if (!config.chartValueField) {
      config.chartAggregation = "count";
    } else if (previousAggregation === "count" || !isChartAggregationAllowedForValueField(config, previousAggregation, config.chartValueField)) {
      config.chartAggregation = getDefaultChartAggregationForValueField(config, config.chartValueField);
    }
    normalizeChartAggregationForValueField(config);
    if (!isChartCumulativeSupported(config)) config.chartCumulative = false;
  }

  private setChartAggregation(config: ViewConfig, slot: ChartValueSlot, value: ViewConfig["chartAggregation"]): void {
    if (slot === "secondary") {
      config.chartSecondaryAggregation = value;
      if (!requiresChartValueField(config.chartSecondaryAggregation)) config.chartSecondaryValueField = undefined;
      if (requiresChartValueField(config.chartSecondaryAggregation) && !isSelectedChartValueFieldValid(config, config.chartSecondaryAggregation, config.chartSecondaryValueField)) {
        config.chartSecondaryValueField = getDefaultChartValueField(config.schema.columns, config.schema.computedFields, config.chartSecondaryAggregation);
      }
      normalizeChartSecondaryAggregationForValueField(config);
      return;
    }

    config.chartAggregation = value;
    if (!requiresChartValueField(config.chartAggregation)) config.chartValueField = undefined;
    if (requiresChartValueField(config.chartAggregation) && !isSelectedChartValueFieldValid(config, config.chartAggregation, config.chartValueField)) {
      config.chartValueField = getDefaultChartValueField(config.schema.columns, config.schema.computedFields, config.chartAggregation);
    }
    normalizeChartAggregationForValueField(config);
    if (!isChartCumulativeSupported(config)) config.chartCumulative = false;
  }

  private getValueAggregationSummary(config: ViewConfig, slot: ChartValueSlot): string {
    const fieldKey = slot === "primary" ? config.chartValueField : config.chartSecondaryValueField;
    const aggregation = (slot === "primary" ? config.chartAggregation : config.chartSecondaryAggregation) || "count";
    const fieldLabel = getChartMeasureFieldOptions(config).find((option) => option.value === (fieldKey || ""))?.text || t("chart.recordsValue");
    const aggregationLabel = getChartAggregationOptions(config, fieldKey).find((option) => option.value === aggregation)?.text || t("chart.countAggregation");
    return `${fieldLabel} · ${aggregationLabel}`;
  }

  private renderStyleEntry(panel: HTMLElement, containerEl: HTMLElement, config: ViewConfig, actions: ChartToolbarActions): void {
    const section = this.createSection(panel, t("chart.optionsStyle"));
    this.renderSelect(section, t("chart.colorPalette"), getColorPaletteOptions(), config.chartColorPalette || "auto", (value) => {
      config.chartColorPalette = value as ViewConfig["chartColorPalette"];
      actions.onChange(t("undo.chartColorPaletteConfig"));
    }, "palette");
    this.renderSwitch(section, t("chart.colorByValue"), config.chartColorByValue === true, (checked) => {
      config.chartColorByValue = checked;
      actions.onChange(t("undo.chartColorByValueConfig"));
    }, "paint-bucket", !["bar", "horizontal-bar"].includes(config.chartType || "bar"), undefined, t("chart.disabledBarOnly"));
    this.renderPopoverEntry(section, t("chart.optionsStyleEntry"), "", "paintbrush", (anchor) => {
      this.openStylePopover(containerEl, anchor, config, actions);
    });
    this.renderTextInput(section, t("chart.title"), config.chartTitle || "", getChartAutoTitle(config, config.schema.columns), (value) => {
      config.chartTitle = value.trim() || undefined;
      actions.onChange(t("undo.chartTitleConfig"));
    }, "text-cursor-input");
  }

  private openStylePopover(containerEl: HTMLElement, anchor: HTMLElement, config: ViewConfig, actions: ChartToolbarActions): void {
    this.openChildPopover(containerEl, anchor, "db-chart-style-popover", (panel) => {
      const header = panel.createDiv({ cls: "db-panel-header" });
      header.createDiv({ cls: "db-panel-title", text: t("chart.optionsStyle") });
      this.renderStyleSection(panel, config, actions);
    });
  }

  private renderStyleSection(panel: HTMLElement, config: ViewConfig, actions: ChartToolbarActions): void {
    const section = panel.createDiv({ cls: "db-chart-options-section db-chart-options-section-plain" });
    this.renderSelect(section, t("chart.height"), [
      { value: "small", text: t("chart.heightSmall") },
      { value: "medium", text: t("chart.heightMedium") },
      { value: "large", text: t("chart.heightLarge") },
      { value: "xlarge", text: t("chart.heightXLarge") },
    ], config.chartHeight || "medium", (value) => {
      config.chartHeight = value as ViewConfig["chartHeight"];
      actions.onChange(t("undo.chartHeightConfig"));
    }, "chart:ruler-vertical");
    this.renderSelect(section, t("viewConfig.yearDisplayMode"), [
      { value: "always", text: t("viewConfig.yearDisplayMode.always") },
      { value: "smart", text: t("viewConfig.yearDisplayMode.smart") },
      { value: "never", text: t("viewConfig.yearDisplayMode.never") },
    ], config.yearDisplayMode || "always", (value) => {
      config.yearDisplayMode = value === "always" || value === "smart" || value === "never" ? value : undefined;
      actions.onChange(t("undo.yearDisplayModeConfig"));
    }, "calendar");
    this.renderSelect(section, t("chart.gridLines"), [
      { value: "none", text: t("chart.gridNone") },
      { value: "value", text: t("chart.gridValue") },
      { value: "both", text: t("chart.gridBoth") },
    ], config.chartGridLines || "value", (value) => {
      config.chartGridLines = value as ViewConfig["chartGridLines"];
      actions.onChange(t("undo.chartGridLinesConfig"));
    }, "chart:grid-horizontal");
    this.renderSelect(section, t("chart.axisNames"), [
      { value: "none", text: t("chart.axisNone") },
      { value: "x", text: t("chart.axisX") },
      { value: "y", text: t("chart.axisY") },
      { value: "both", text: t("chart.axisBoth") },
    ], config.chartAxisNames || "none", (value) => {
      config.chartAxisNames = value as ViewConfig["chartAxisNames"];
      actions.onChange(t("undo.chartAxisNamesConfig"));
    }, "chart:axis-xy");
    if (!isAxislessChart(config.chartType)) {
      this.renderSelect(section, t("chart.valueAxisRange"), getAxisRangeOptions(), config.chartValueAxisRange || "auto", (value) => {
        config.chartValueAxisRange = value as ChartValueAxisRange;
        if (config.chartValueAxisRange !== "custom") {
          config.chartValueAxisMin = undefined;
          config.chartValueAxisMax = undefined;
        }
        actions.onChange(t("undo.chartAxisRangeConfig"));
      }, "ruler");
      if ((config.chartValueAxisRange || "auto") === "custom") {
        this.renderTextInput(section, t("chart.axisMin"), valueToInput(config.chartValueAxisMin), "0", (value) => {
          config.chartValueAxisMin = parseOptionalNumber(value);
          actions.onChange(t("undo.chartAxisMinConfig"));
        }, "minus");
        this.renderTextInput(section, t("chart.axisMax"), valueToInput(config.chartValueAxisMax), "100", (value) => {
          config.chartValueAxisMax = parseOptionalNumber(value);
          actions.onChange(t("undo.chartAxisMaxConfig"));
        }, "plus");
      }
      this.renderReferenceLinesSection(section, config, actions);
    }
    this.renderSwitch(section, t("chart.showTitle"), config.chartShowTitle !== false, (checked) => {
      config.chartShowTitle = checked;
      actions.onChange(t("undo.chartShowTitleConfig"));
    }, "heading");
    this.renderSwitch(section, t("chart.showDataLabels"), config.chartShowDataLabels === true, (checked) => {
      config.chartShowDataLabels = checked;
      actions.onChange(t("undo.chartDataLabelsConfig"));
      this.refreshOpenPopover(undefined, config, actions);
    }, "chart:data-labels");
    if (config.chartShowDataLabels === true) {
      this.renderSelect(section, t("chart.dataLabelMode"), getDataLabelModeOptions(), config.chartDataLabelMode || "value", (value) => {
        config.chartDataLabelMode = value as ViewConfig["chartDataLabelMode"];
        actions.onChange(t("undo.chartDataLabelModeConfig"));
      }, "chart:data-labels");
      this.renderSelect(section, t("chart.dataLabelColor"), getDataLabelColorOptions(), config.chartDataLabelColor || "auto", (value) => {
        config.chartDataLabelColor = value as ViewConfig["chartDataLabelColor"];
        actions.onChange(t("undo.chartDataLabelColorConfig"));
      }, "palette");
    }
    this.renderSwitch(section, t("chart.showLegend"), config.chartShowLegend !== false, (checked) => {
      config.chartShowLegend = checked;
      actions.onChange(t("undo.chartLegendConfig"));
    }, "list");
    this.renderSwitch(section, t("chart.smoothLine"), config.chartSmoothLine !== false, (checked) => {
      config.chartSmoothLine = checked;
      actions.onChange(t("undo.chartSmoothLineConfig"));
    }, "activity", !["line", "area", "mixed"].includes(config.chartType || "bar"), undefined, t("chart.disabledLineAreaMixed"));
    this.renderSwitch(section, t("chart.gradientArea"), config.chartGradientArea === true, (checked) => {
      config.chartGradientArea = checked;
      actions.onChange(t("undo.chartGradientAreaConfig"));
    }, "blend", !["line", "area", "mixed"].includes(config.chartType || "bar"), undefined, t("chart.disabledLineAreaMixed"));
    this.renderSelect(section, t("chart.donutCenter"), getDonutCenterModeOptions(), config.chartDonutCenterMode || (config.chartShowDonutCenter === true ? "total" : "hidden"), (value) => {
      config.chartDonutCenterMode = value as ViewConfig["chartDonutCenterMode"];
      config.chartShowDonutCenter = value !== "hidden";
      actions.onChange(t("undo.chartDonutCenterConfig"));
    }, "circle-dot", (config.chartType || "bar") !== "donut", false, t("chart.disabledDonutOnly"));
  }

  private renderReferenceLinesSection(parent: HTMLElement, config: ViewConfig, actions: ChartToolbarActions): void {
    const wrap = parent.createDiv({ cls: "db-chart-reference-lines-inline" });
    const render = () => {
      wrap.empty();
      const header = wrap.createDiv({ cls: "db-chart-reference-lines-header" });
      this.renderOptionIcon(header, "list-plus");
      header.createSpan({ cls: "db-chart-options-label", text: t("chart.referenceLines") });
      const count = config.chartReferenceLines?.length || 0;
      header.createSpan({ cls: "db-chart-options-value", text: String(count) });
      const lines = config.chartReferenceLines || [];
      for (const line of lines) {
        this.renderReferenceLineRow(wrap, line, config, actions, render);
      }
      const addLine = wrap.createEl("button", {
        cls: "db-chart-reference-line-add",
        text: t("chart.addReferenceLine"),
        attr: { type: "button" },
      });
      addLine.onclick = () => {
        config.chartReferenceLines = [...(config.chartReferenceLines || []), createReferenceLine("constant")];
        actions.onChange(t("undo.chartReferenceLineAddConfig"));
        render();
      };
    };
    render();
  }

  private renderReferenceLineRow(parent: HTMLElement, line: ChartReferenceLine, config: ViewConfig, actions: ChartToolbarActions, rerender: () => void): void {
    const wrap = parent.createDiv({ cls: "db-chart-reference-line-row" });
    this.renderSelect(wrap, t("chart.referenceLines"), getReferenceLineTypeOptions(), line.type, (value) => {
      line.type = value as ChartReferenceLine["type"];
      if (line.type !== "constant") line.value = undefined;
      else if (line.value == null) line.value = 0;
      actions.onChange(t("undo.chartReferenceLineTypeConfig"));
      rerender();
    }, "activity");
    this.renderTextInput(wrap, t("chart.title"), line.label || "", t(`chart.referenceLine${capitalizeReferenceType(line.type)}`), (value) => {
      line.label = value.trim() || undefined;
      actions.onChange(t("undo.chartReferenceLineTitleConfig"));
    }, "text-cursor-input");
    if (line.type === "constant") {
      this.renderTextInput(wrap, t("chart.toolbarValue"), valueToInput(line.value), "0", (value) => {
        line.value = parseOptionalNumber(value);
        actions.onChange(t("undo.chartReferenceLineValueConfig"));
      }, "hash");
    }
    this.renderSelect(wrap, t("chart.referenceLineStyle"), getReferenceLineStyleOptions(), line.style || "solid", (value) => {
      line.style = value as ChartReferenceLine["style"];
      actions.onChange(t("undo.chartReferenceLineStyleConfig"));
    }, "minus");
    this.renderReferenceLineColorPicker(wrap, line, actions);
    const remove = wrap.createEl("button", { cls: "db-chart-reference-line-remove", attr: { type: "button", "aria-label": t("toolbar.delete") } });
    this.renderOptionIcon(remove, "trash-2");
    remove.onclick = () => {
      config.chartReferenceLines = (config.chartReferenceLines || []).filter((candidate) => candidate !== line);
      if (config.chartReferenceLines.length === 0) config.chartReferenceLines = undefined;
      actions.onChange(t("undo.chartReferenceLineRemoveConfig"));
      rerender();
    };
  }

  private renderReferenceLineColorPicker(parent: HTMLElement, line: ChartReferenceLine, actions: ChartToolbarActions): void {
    const row = parent.createDiv({ cls: "db-chart-options-row db-chart-reference-line-color-row" });
    this.renderOptionIcon(row, "palette");
    const text = row.createDiv({ cls: "db-chart-options-row-text" });
    text.createSpan({ cls: "db-chart-options-label", text: t("chart.referenceLineColor") });
    const swatches = row.createDiv({ cls: "db-chart-reference-line-swatches" });
    const current = line.color || "";
    for (const option of REFERENCE_LINE_COLORS) {
      const button = swatches.createEl("button", {
        cls: `db-chart-reference-line-swatch${current === option.value ? " is-selected" : ""}`,
        attr: {
          type: "button",
          "aria-label": t(option.labelKey),
          title: t(option.labelKey),
        },
      });
      button.style.background = option.color;
      button.onclick = () => {
        line.color = option.value || undefined;
        actions.onChange(t("undo.chartReferenceLineColorConfig"));
        swatches.querySelectorAll(".db-chart-reference-line-swatch").forEach((el) => el.removeClass("is-selected"));
        button.addClass("is-selected");
      };
    }
  }

  private renderExportSection(panel: HTMLElement, actions: ChartToolbarActions): void {
    const section = this.createSection(panel, t("chart.optionsExport"));
    this.renderExportButton(section, "download", t("chart.exportImage"), () => actions.onExportImage?.());
    this.renderExportButton(section, "copy", t("chart.copyPng"), () => actions.onCopyPng?.());
  }

  private renderExportButton(section: HTMLElement, icon: ChartOptionIcon, label: string, onClick: () => void): void {
    const button = section.createEl("button", { cls: "db-chart-options-row db-chart-options-export", attr: { type: "button" } });
    this.renderOptionIcon(button, icon);
    const text = button.createDiv({ cls: "db-chart-options-row-text" });
    text.createSpan({ cls: "db-chart-options-label", text: label });
    button.createSpan();
    button.onclick = onClick;
  }

  private openVisibleGroupsPopover(
    containerEl: HTMLElement,
    anchor: HTMLElement,
    config: ViewConfig,
    actions: ChartToolbarActions,
    groups: string[]
  ): void {
    this.openChildPopover(containerEl, anchor, "db-chart-visible-groups-popover", (panel) => {
      const header = panel.createDiv({ cls: "db-panel-header" });
      header.createDiv({ cls: "db-panel-title", text: t("chart.visibleGroups") });
      const wrap = panel.createDiv({ cls: "db-chart-visible-groups-list" });
      if (groups.length === 0) {
        wrap.createDiv({ cls: "db-panel-empty", text: t("chart.noFieldSelected") });
        return;
      }
      for (const group of groups) {
        const label = this.formatVisibleGroupLabel(group);
        this.renderCheckbox(wrap, label, !config.chartHiddenGroups?.[group], (checked) => {
          config.chartHiddenGroups = config.chartHiddenGroups || {};
          if (checked) delete config.chartHiddenGroups[group];
          else config.chartHiddenGroups[group] = true;
          actions.onChange(t("undo.chartVisibleGroupsConfig"));
        });
      }
    }, { minWidth: 220, preferredWidth: 280, maxWidth: 320 });
  }

  private createSection(panel: HTMLElement, title: string): HTMLElement {
    const section = panel.createDiv({ cls: "db-chart-options-section" });
    const titleEl = section.createDiv({ cls: "db-chart-options-section-title" });
    titleEl.createSpan({ text: title });
    return section;
  }

  private renderSelect(parent: HTMLElement, label: string, options: SelectOption[], value: string, onChange: (value: string) => void, icon: ChartOptionIcon = "chevron-right", disabled = false, isFieldPicker = false, disabledReason?: string): void {
    createDropdownField({
      parent,
      label,
      options,
      value,
      onChange,
      icon,
      className: "db-chart-options-row db-chart-options-select-row",
      popoverClassName: "db-chart-dropdown-popover",
      placeholder: t("common.notSet"),
      disabled,
      disabledReason: disabled ? disabledReason : undefined,
      searchable: isFieldPicker,
      closeOnSelect: false,
      renderIcon: (target, iconName) => this.renderOptionIcon(target, iconName),
    });
  }

  private renderTextInput(parent: HTMLElement, label: string, value: string, placeholder: string, onChange: (value: string) => void, icon: ChartOptionIcon = "text"): void {
    const row = parent.createDiv({ cls: "db-chart-options-row db-chart-options-title-row" });
    this.renderOptionIcon(row, icon);
    const text = row.createDiv({ cls: "db-chart-options-row-text" });
    text.createSpan({ cls: "db-chart-options-label", text: label });
    const input = text.createEl("input", {
      cls: "db-chart-options-text-input",
      attr: { type: "text", placeholder, "aria-label": label },
    });
    input.value = value;
    input.oninput = () => onChange(input.value);
    row.createSpan();
  }

  private renderSwitch(parent: HTMLElement, label: string, checked: boolean, onChange: (checked: boolean) => void, icon: ChartOptionIcon, disabled = false, switchKey?: string, disabledReason?: string): void {
    const row = parent.createDiv({ cls: `db-chart-options-row db-chart-options-switch${disabled ? " is-disabled" : ""}` });
    if (switchKey) row.dataset.chartSwitch = switchKey;
    applyDisabledReason(row, label, disabled, disabledReason);
    this.renderOptionIcon(row, icon);
    const text = row.createDiv({ cls: "db-chart-options-row-text" });
    text.createSpan({ cls: "db-chart-options-label", text: label });
    this.renderDisabledReason(text, disabledReason, !disabled);
    const input = row.createEl("input", { cls: "db-toggle-switch", attr: { type: "checkbox", role: "switch" } });
    input.checked = checked;
    input.disabled = disabled;
    applyDisabledReason(input, label, disabled, disabledReason);
    input.onchange = () => onChange(input.checked);
  }

  private renderCheckbox(parent: HTMLElement, label: string, checked: boolean, onChange: (checked: boolean) => void): void {
    const row = parent.createEl("label", { cls: "db-chart-visible-group-row" });
    const input = row.createEl("input", { attr: { type: "checkbox" } });
    input.checked = checked;
    input.onchange = () => onChange(input.checked);
    row.createSpan({ cls: "db-chart-visible-group-label", text: label });
  }

  private renderPopoverEntry(parent: HTMLElement, label: string, value: string, icon: ChartOptionIcon, onClick: (anchor: HTMLElement) => void, disabled = false, disabledReason?: string): void {
    const row = parent.createEl("button", {
      cls: `db-chart-options-row db-chart-options-popover-entry${disabled ? " is-disabled" : ""}`,
      attr: { type: "button" },
    });
    applyDisabledReason(row, label, disabled, disabledReason);
    this.renderOptionIcon(row, icon);
    const text = row.createDiv({ cls: "db-chart-options-row-text" });
    text.createSpan({ cls: "db-chart-options-label", text: label });
    if (value) text.createSpan({ cls: "db-chart-options-value", text: value });
    if (disabled) this.renderDisabledReason(text, disabledReason);
    setIcon(row.createSpan({ cls: "db-chart-options-chevron" }), "chevron-right");
    row.disabled = disabled;
    row.onclick = () => onClick(row);
  }

  private renderOptionIcon(parent: HTMLElement, icon: ChartOptionIcon): HTMLElement {
    const wrap = parent.hasClass("db-dropdown-field-icon") ? parent : parent.createSpan({ cls: "db-chart-options-row-icon" });
    if (icon.startsWith("chart:")) {
      wrap.createSpan({ cls: `db-chart-custom-icon db-chart-icon-${icon.slice("chart:".length)}` });
    } else if (icon.startsWith("property:")) {
      renderDropdownPropertyTypeIcon(wrap, icon);
    } else {
      setIcon(wrap, icon);
    }
    return wrap;
  }

  private renderDisabledReason(parent: HTMLElement, disabledReason?: string, hidden = false): void {
    if (!disabledReason) return;
    parent.createSpan({ cls: `db-chart-options-disabled-reason${hidden ? " is-hidden" : ""}`, text: disabledReason });
  }

  private openChildPopover(
    containerEl: HTMLElement,
    anchor: HTMLElement,
    cls: string,
    render: (panel: HTMLElement) => void,
    size: ChildPopoverSizeOptions = {},
  ): void {
    this.closeChildPopover();
    const panel = containerEl.createDiv({ cls: `db-chart-options-popover db-chart-subpopover ${cls}` });
    this.childPopover = panel;
    render(panel);
    this.positionChildPopover(panel, anchor, containerEl, size);
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (panel.contains(target) || anchor.contains(target) || this.isInsideChartDropdownPopover(target))) return;
      this.closeChildPopover();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.closeChildPopover();
    };
    const outsideTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
    window.activeDocument.addEventListener("keydown", onKeyDown, true);
    const removeAutoClose = installPopoverAutoClose({
      panel,
      anchorEl: anchor,
      delayMs: 12000,
      isActiveTarget: (target) => this.isInsideChartPopoverSurface(target),
      close: () => this.closeChildPopover(),
    });
    this.childCleanupPopover = () => {
      window.clearTimeout(outsideTimer);
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      window.activeDocument.removeEventListener("keydown", onKeyDown, true);
      removeAutoClose();
      panel.remove();
      this.childPopover = undefined;
    };
  }

  private positionChildPopover(panel: HTMLElement, anchor: HTMLElement, containerEl: HTMLElement, size: ChildPopoverSizeOptions = {}): void {
    panel.addClass("db-anchored-popover");
    panel.setCssProps({
      position: "absolute",
      right: "auto",
      bottom: "auto",
      boxSizing: "border-box",
      overflowY: "auto",
      overscrollBehavior: "contain",
    });

    const place = () => {
      if (!panel.isConnected) return;
      const margin = 12;
      const gap = 8;
      const containerRect = containerEl.getBoundingClientRect();
      const bounds = getVisiblePopoverBounds(containerEl);
      const scrollLeft = containerEl.scrollLeft || 0;
      const scrollTop = containerEl.scrollTop || 0;
      const anchorRect = anchor.getBoundingClientRect();
      const minWidth = size.minWidth ?? 240;
      const preferredWidth = size.preferredWidth ?? 360;
      const maxPreferredWidth = size.maxWidth ?? 420;
      const maxWidth = Math.max(minWidth, Math.min(maxPreferredWidth, bounds.width - margin * 2));
      const width = Math.min(preferredWidth, maxWidth);
      panel.style.width = `${width}px`;
      const panelRect = panel.getBoundingClientRect();
      const naturalHeight = Math.max(panel.scrollHeight, panelRect.height || 0);
      const height = Math.min(naturalHeight, Math.max(120, bounds.height - margin * 2));
      const rightSpace = bounds.right - anchorRect.right - gap - margin;
      const leftSpace = anchorRect.left - bounds.left - gap - margin;
      const useRight = rightSpace >= width || rightSpace >= leftSpace;
      const rawLeft = useRight ? anchorRect.right + gap : anchorRect.right - width;
      const left = clamp(rawLeft, bounds.left + margin, bounds.right - width - margin);
      const top = clamp(anchorRect.top - 8, bounds.top + margin, bounds.bottom - height - margin);

      setPosition(panel, left, top, containerRect, scrollLeft, scrollTop);
      panel.style.maxHeight = `${height}px`;
    };

    place();
    window.requestAnimationFrame(place);
  }

  private isInsideChartDropdownPopover(target: Node | null): boolean {
    return isHTMLElement(target) && target.closest(".db-chart-dropdown-popover") != null;
  }

  private isInsideChartPopoverSurface(target: EventTarget | null): boolean {
    if (!isHTMLElement(target)) return false;
    return target.closest(".db-chart-options-popover, .db-chart-dropdown-popover") != null;
  }

  private closeChildPopover(): void {
    this.childCleanupPopover?.();
    this.childCleanupPopover = undefined;
    this.childPopover?.remove();
    this.childPopover = undefined;
  }

  private formatVisibleGroupLabel(group: string): string {
    return group;
  }

  private syncCumulativeSwitch(section: HTMLElement, config: ViewConfig): void {
    const row = section.querySelector<HTMLElement>("[data-chart-switch='cumulative']");
    const input = row?.querySelector<HTMLInputElement>("input.db-toggle-switch");
    if (!row || !input) return;
    const supported = isChartCumulativeSupported(config);
    if (!supported) config.chartCumulative = false;
    input.checked = config.chartCumulative === true && supported;
    input.disabled = !supported;
    row.toggleClass("is-disabled", !supported);
    const reason = row.querySelector<HTMLElement>(".db-chart-options-disabled-reason");
    if (reason) reason.toggleClass("is-hidden", supported);
  }
}

function getVisibleGroupCandidates(column: ColumnDef | undefined): string[] {
  if (!column) return [];
  if (column.type === "checkbox") return [t("common.false"), t("common.true"), t("common.uncategorized")];
  return getColumnOptionValues(column);
}

function applyDisabledReason(el: HTMLElement, label: string, disabled: boolean, disabledReason?: string): void {
  if (!disabled || !disabledReason) return;
  el.setAttr("title", disabledReason);
  el.setAttr("aria-label", `${label}: ${disabledReason}`);
}

function parseOptionalNumber(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function valueToInput(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function createReferenceLine(type: ChartReferenceLine["type"]): ChartReferenceLine {
  return {
    id: `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    value: type === "constant" ? 0 : undefined,
    style: "solid",
  };
}

function capitalizeReferenceType(type: ChartReferenceLine["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
