import { t } from "../i18n";
import { getDefaultChartValueField, isChartAggregationValueColumn, isChartCheckboxGroupColumn, isChartDateGroupColumn, isChartNumberGroupColumn, isChartSeriesColumn, isChartValueColumn, parseNumberBucketKey, requiresChartValueField, toChartNumber } from "./ChartAggregation";
import { isObsidianTagsKey, normalizeObsidianTagValue } from "./ColumnTypes";
import { isDateLikeColumnType } from "./DateTimeFormat";
import { stringifyValue } from "./Stringify";
import { ChartDateBucket, ColumnDef, ComputedFieldDef, FilterRule, RowData, ViewConfig } from "./types";

export function getChartAutoTitle(config: ViewConfig, columns: ColumnDef[]): string {
  const aggregation = config.chartAggregation || "count";
  const group = getChartGroupLabel(config, columns);
  if ((config.chartType || "bar") === "number") {
    return aggregation === "count"
      ? t("chart.autoTitleCount")
      : t("chart.autoTitleValue", { aggregation: getAggregationTitle(aggregation), value: getValueLabel(config.chartValueField, columns) });
  }
  if ((config.chartType || "bar") === "mixed") {
    return t("chart.autoTitleMixed", {
      primary: getAggregationTitle(config.chartAggregation || "count"),
      secondary: getAggregationTitle(config.chartSecondaryAggregation || "count"),
      group,
    });
  }
  if (aggregation === "count") {
    return t("chart.autoTitleCountBy", { group });
  }
  return t("chart.autoTitleValueBy", {
    aggregation: getAggregationTitle(aggregation),
    value: getValueLabel(config.chartValueField, columns),
    group,
  });
}

export function getChartTitle(config: ViewConfig, columns: ColumnDef[]): string {
  const customTitle = typeof config.chartTitle === "string" ? config.chartTitle.trim() : "";
  return customTitle || getChartAutoTitle(config, columns);
}

export function getAggregationTitle(aggregation: ViewConfig["chartAggregation"]): string {
  if (aggregation === "sum") return t("chart.sumAggregation");
  if (aggregation === "avg") return t("chart.avgAggregation");
  if (aggregation === "median") return t("chart.medianAggregation");
  if (aggregation === "min") return t("chart.minAggregation");
  if (aggregation === "max") return t("chart.maxAggregation");
  if (aggregation === "range") return t("chart.rangeAggregation");
  if (aggregation === "unique") return t("chart.uniqueAggregation");
  if (aggregation === "empty") return t("chart.emptyAggregation");
  if (aggregation === "not-empty") return t("chart.notEmptyAggregation");
  if (aggregation === "percent-empty") return t("chart.percentEmptyAggregation");
  if (aggregation === "percent-not-empty") return t("chart.percentNotEmptyAggregation");
  if (aggregation === "checked") return t("chart.checkedAggregation");
  if (aggregation === "unchecked") return t("chart.uncheckedAggregation");
  if (aggregation === "percent-checked") return t("chart.percentCheckedAggregation");
  return t("chart.countAggregation");
}

export function getChartGroupLabel(config: ViewConfig, columns: ColumnDef[]): string {
  const column = config.chartGroupField ? columns.find((col) => col.key === config.chartGroupField) : undefined;
  if (!column) return t("viewConfig.chartGroupFieldNone");
  if (isDateLikeColumnType(column.type) && config.chartDateBucket) {
    return t("chart.autoTitleDateGroup", {
      bucket: getDateBucketTitle(config.chartDateBucket),
      field: column.label || column.key,
    });
  }
  if (isChartNumberGroupColumn(column, config.schema.computedFields) && config.chartNumberBucket) {
    return t("chart.autoTitleNumberBucketGroup", { field: column.label || column.key });
  }
  return column.label || column.key;
}

export function getValueLabel(fieldKey: string | undefined, columns: ColumnDef[]): string {
  if (!fieldKey) return t("viewConfig.chartValueFieldNone");
  const column = columns.find((col) => col.key === fieldKey);
  return column?.label || fieldKey;
}

export function isChartCumulativeSupported(config: ViewConfig): boolean {
  const chartType = config.chartType || "bar";
  const aggregation = config.chartAggregation || "count";
  return (chartType === "bar" || chartType === "horizontal-bar" || chartType === "line" || chartType === "area") &&
    (aggregation === "count" || aggregation === "sum");
}

export function isChartAggregationAllowedForValueField(
  config: ViewConfig,
  aggregation: ViewConfig["chartAggregation"],
  fieldKey: string | undefined,
): boolean {
  if ((aggregation || "count") === "count") return true;
  if (!fieldKey) return false;
  const column = config.schema.columns.find((col) => col.key === fieldKey);
  if (!column) return false;
  if (isChartValueColumn(column, config.schema.computedFields)) {
    return aggregation === "sum" ||
      aggregation === "avg" ||
      aggregation === "median" ||
      aggregation === "min" ||
      aggregation === "max" ||
      aggregation === "range" ||
      aggregation === "unique" ||
      aggregation === "empty" ||
      aggregation === "not-empty" ||
      aggregation === "percent-empty" ||
      aggregation === "percent-not-empty";
  }
  if (isChartCheckboxGroupColumn(column, config.schema.computedFields)) {
    return aggregation === "checked" ||
      aggregation === "unchecked" ||
      aggregation === "percent-checked" ||
      aggregation === "unique" ||
      aggregation === "empty" ||
      aggregation === "not-empty" ||
      aggregation === "percent-empty" ||
      aggregation === "percent-not-empty";
  }
  return aggregation === "unique" ||
    aggregation === "empty" ||
    aggregation === "not-empty" ||
    aggregation === "percent-empty" ||
    aggregation === "percent-not-empty";
}

export function getDefaultChartAggregationForValueField(
  config: ViewConfig,
  fieldKey: string | undefined,
): ViewConfig["chartAggregation"] {
  if (!fieldKey) return "count";
  const column = config.schema.columns.find((col) => col.key === fieldKey);
  if (!column) return "count";
  if (isChartValueColumn(column, config.schema.computedFields)) return "sum";
  if (isChartCheckboxGroupColumn(column, config.schema.computedFields)) return "percent-checked";
  return "count";
}

export function normalizeChartAggregationForValueField(
  config: ViewConfig,
  fieldKey: string | undefined = config.chartValueField,
): void {
  config.chartValueField = hasChartColumn(config, fieldKey) ? fieldKey : undefined;
  if (!config.chartValueField) {
    config.chartAggregation = "count";
  } else if (!isChartAggregationAllowedForValueField(config, config.chartAggregation || "count", config.chartValueField)) {
    config.chartAggregation = getDefaultChartAggregationForValueField(config, config.chartValueField);
  }
  if (!isChartCumulativeSupported(config)) config.chartCumulative = false;
}

export function normalizeChartSecondaryAggregationForValueField(
  config: ViewConfig,
  fieldKey: string | undefined = config.chartSecondaryValueField,
): void {
  config.chartSecondaryValueField = hasChartColumn(config, fieldKey) ? fieldKey : undefined;
  if (!config.chartSecondaryValueField) {
    config.chartSecondaryAggregation = "count";
  } else if (!isChartAggregationAllowedForValueField(config, config.chartSecondaryAggregation || "count", config.chartSecondaryValueField)) {
    config.chartSecondaryAggregation = getDefaultChartAggregationForValueField(config, config.chartSecondaryValueField);
  }
}

function hasChartColumn(config: ViewConfig, fieldKey: string | undefined): fieldKey is string {
  return Boolean(fieldKey && config.schema.columns.some((col) => col.key === fieldKey));
}

export function normalizeChartConfigForType(config: ViewConfig): void {
  const chartType = config.chartType || "bar";
  const axisless = chartType === "number" || chartType === "pie" || chartType === "donut";
  const supportsSeries = chartType === "stacked-bar" ||
    chartType === "grouped-bar" ||
    chartType === "percent-stacked-bar" ||
    chartType === "line" ||
    chartType === "area";

  if (chartType === "number") {
    config.chartGroupField = undefined;
    config.chartDateBucket = undefined;
    config.chartNumberBucket = undefined;
    config.chartNumberBucketSize = undefined;
    config.chartHiddenGroups = undefined;
  }
  if (!supportsSeries) {
    config.chartSeriesField = undefined;
    config.chartStackField = undefined;
  } else if (!getSelectedSeriesField(config) && requiresChartSeriesField(chartType)) {
    const fallback = getDefaultSeriesField(config);
    config.chartSeriesField = fallback;
    config.chartStackField = fallback;
  }
  if (chartType !== "mixed") {
    config.chartSecondaryAggregation = undefined;
    config.chartSecondaryValueField = undefined;
  } else {
    config.chartSecondaryAggregation = config.chartSecondaryAggregation || "sum";
    if (
      requiresChartValueField(config.chartSecondaryAggregation) &&
      !isSelectedValueFieldValid(config, config.chartSecondaryAggregation, config.chartSecondaryValueField)
    ) {
      config.chartSecondaryValueField = getDefaultValueField(config, config.chartSecondaryAggregation);
    }
  }
  if (axisless) {
    config.chartValueAxisRange = undefined;
    config.chartValueAxisMin = undefined;
    config.chartValueAxisMax = undefined;
    config.chartReferenceLines = undefined;
  }
  if (chartType !== "donut") {
    config.chartDonutCenterMode = undefined;
    config.chartShowDonutCenter = false;
  }
  if (!isChartCumulativeSupported(config)) config.chartCumulative = false;
}

export function getChartHeightClass(config: ViewConfig): string {
  const height = config.chartHeight || "medium";
  return `db-chart-height-${height}`;
}

function requiresChartSeriesField(chartType: ViewConfig["chartType"]): boolean {
  return chartType === "stacked-bar" || chartType === "grouped-bar" || chartType === "percent-stacked-bar";
}

function getSelectedSeriesField(config: ViewConfig): string | undefined {
  return config.chartSeriesField || config.chartStackField;
}

function getDefaultSeriesField(config: ViewConfig): string | undefined {
  return config.schema.columns.find((col) => col.key !== "file.name" && col.key !== config.chartGroupField && isChartSeriesColumn(col, config.schema.computedFields))?.key;
}

function getDefaultValueField(config: ViewConfig, aggregation: ViewConfig["chartAggregation"]): string | undefined {
  return getDefaultChartValueField(config.schema.columns, config.schema.computedFields, aggregation);
}

function isSelectedValueFieldValid(config: ViewConfig, aggregation: ViewConfig["chartAggregation"], fieldKey: string | undefined): boolean {
  const column = fieldKey ? config.schema.columns.find((col) => col.key === fieldKey) : undefined;
  return Boolean(column && isChartAggregationValueColumn(column, aggregation, config.schema.computedFields));
}

export function getDrilldownRows(rows: RowData[], field: string, key: string, column: ColumnDef | undefined, bucket?: ChartDateBucket, computedFields: ComputedFieldDef[] = []): RowData[] {
  if (!field || key === "__other__") return [];
  return rows.filter((row) => rowMatchesChartGroup(row, field, key, column, bucket, computedFields));
}

export function formatChartDrilldownCellValue(row: RowData, field: string, column?: ColumnDef): string {
  return stringifyValue(getRowChartValue(row, field, column));
}

export function getChartFilterRules(
  field: string,
  key: string,
  column: ColumnDef | undefined,
  dateBucket?: ChartDateBucket,
  computedFields: ComputedFieldDef[] = [],
): FilterRule[] {
  if (key === t("common.uncategorized")) return [{ field, op: "empty" }];
  const numberBucket = parseNumberBucketKey(key);
  if (numberBucket) {
    return [
      { field, op: "gte", value: String(numberBucket.start) },
      { field, op: "lt", value: String(numberBucket.end) },
    ];
  }
  if (column && isChartDateGroupColumn(column, computedFields)) return getDateBucketFilterRules(field, key, dateBucket || "month");
  if (column && isChartCheckboxGroupColumn(column, computedFields)) {
    if (key === t("common.true")) return [{ field, op: "eq", value: "true" }];
    if (key === t("common.false")) return [{ field, op: "eq", value: "false" }];
  }
  if (field === "file.tags" || isObsidianTagsKey(field)) {
    return [{ field, op: "hasTag", value: normalizeObsidianTagValue(key) }];
  }
  return [{ field, op: "eq", value: key }];
}

export function rowMatchesChartGroup(row: RowData, field: string, key: string, column: ColumnDef | undefined, bucket?: ChartDateBucket, computedFields: ComputedFieldDef[] = []): boolean {
  const value = getRowChartValue(row, field, column);
  if (key === t("common.uncategorized")) return isEmptyChartValue(value);
  const numberBucket = parseNumberBucketKey(key);
  if (numberBucket) {
    const numeric = toChartNumber(value);
    return numeric != null && numeric >= numberBucket.start && numeric < numberBucket.end;
  }
  if (column && isChartDateGroupColumn(column, computedFields)) return getDateBucketKey(value, bucket || "month") === key;
  if (column && isChartCheckboxGroupColumn(column, computedFields)) {
    if (key === t("common.true")) return value === true;
    if (key === t("common.false")) return value === false;
  }
  if (Array.isArray(value)) return value.map((item) => stringifyValue(item).trim()).includes(key);
  return stringifyValue(value).trim() === key;
}

function getDateBucketTitle(bucket: ChartDateBucket): string {
  if (bucket === "day") return t("chart.dateBucketDay");
  if (bucket === "week") return t("chart.dateBucketWeek");
  if (bucket === "quarter") return t("chart.dateBucketQuarter");
  if (bucket === "year") return t("chart.dateBucketYear");
  return t("chart.dateBucketMonth");
}

function getDateBucketFilterRules(field: string, key: string, bucket: ChartDateBucket): FilterRule[] {
  const range = getDateBucketRange(key, bucket);
  if (!range) return [{ field, op: "eq", value: key }];
  return [
    { field, op: "gte", value: formatDateKey(range.start) },
    { field, op: "lt", value: formatDateKey(range.end) },
  ];
}

function getDateBucketRange(key: string, bucket: ChartDateBucket): { start: Date; end: Date } | null {
  if (bucket === "year") {
    const year = Number(key);
    if (!Number.isFinite(year)) return null;
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }
  if (bucket === "quarter") {
    const match = /^(\d{4})-Q([1-4])$/.exec(key);
    if (!match) return null;
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const month = (quarter - 1) * 3;
    return { start: new Date(year, month, 1), end: new Date(year, month + 3, 1) };
  }
  if (bucket === "month") {
    const match = /^(\d{4})-(\d{2})$/.exec(key);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    return { start: new Date(year, month, 1), end: new Date(year, month + 1, 1) };
  }
  if (bucket === "week") {
    const match = /^(\d{4})-W(\d{2})$/.exec(key);
    if (!match) return null;
    const start = getIsoWeekStart(Number(match[1]), Number(match[2]));
    return { start, end: addDays(start, 7) };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return { start, end: addDays(start, 1) };
}

function getIsoWeekStart(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const monday = addDays(jan4, 1 - day);
  return addDays(monday, (week - 1) * 7);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getRowChartValue(row: RowData, field: string, column?: ColumnDef): unknown {
  const fileValue = getRowFileChartValue(row, field);
  if (fileValue !== undefined) return fileValue;
  const computedKey = column?.type === "computed"
    ? column.computedKey || (column.key.startsWith("formula.") ? column.key.slice("formula.".length) : column.key)
    : field.startsWith("formula.")
      ? field.slice("formula.".length)
      : undefined;
  if (computedKey && Object.prototype.hasOwnProperty.call(row.computed, computedKey)) return row.computed[computedKey];
  if (Object.prototype.hasOwnProperty.call(row.computed, field)) return row.computed[field];
  if (Object.prototype.hasOwnProperty.call(row.frontmatter, field)) return row.frontmatter[field];
  return null;
}

function getRowFileChartValue(row: RowData, field: string): unknown {
  if (!field.startsWith("file.")) return undefined;
  if (field === "file.tags") return normalizeChartTags([
    ...toArray(row.frontmatter.tags),
    ...((row.cache?.tags || []).map((item) => item.tag)),
  ]);
  if (field === "file.name") return row.file.name;
  if (field === "file.path" || field === "file.file") return row.file.path;
  if (field === "file.basename") return row.file.basename || row.file.name.replace(/\.md$/i, "");
  if (field === "file.folder") return row.file.parent?.path || "";
  if (field === "file.ext" || field === "file.extension") return row.file.extension;
  if (field === "file.ctime" || field === "file.created") return row.file.stat?.ctime;
  if (field === "file.mtime" || field === "file.modified") return row.file.stat?.mtime;
  if (field === "file.size") return row.file.stat?.size;
  return undefined;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
}

function normalizeChartTags(values: unknown[]): string[] {
  return Array.from(new Set(values
    .flatMap((value) => toArray(value))
    .map((value) => stringifyValue(value).trim().replace(/^#+/, ""))
    .filter((value) => value.length > 0)));
}

function isEmptyChartValue(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function getDateBucketKey(value: unknown, bucket: ChartDateBucket): string {
  const date = toDate(value);
  if (!date) return t("common.uncategorized");
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (bucket === "year") return String(year);
  if (bucket === "quarter") return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  if (bucket === "week") {
    const week = getIsoWeek(date);
    return `${week.year}-W${String(week.week).padStart(2, "0")}`;
  }
  if (bucket === "day") return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function getIsoWeek(date: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return {
    year: target.getUTCFullYear(),
    week: Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7),
  };
}
