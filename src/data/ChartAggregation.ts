import { t } from "../i18n";
import { getColumnOptionValues, isOptionColumnType } from "./ColumnTypes";
import { isDateLikeColumnType } from "./DateTimeFormat";
import { stringifyValue } from "./Stringify";
import { ChartAggregation as ChartAggregationType, ChartDateBucket, ChartNumberBucket, ColumnDef, ComputedFieldDef, RowData } from "./types";

const CHART_COMPATIBLE_TYPES: ColumnDef["type"][] = [
  "text",
  "select",
  "status",
  "multi-select",
  "checkbox",
  "date",
  "datetime",
];

export interface ChartDataPoint {
  key: string;
  label: string;
  value: number;
}

export type ChartAggregation = ChartAggregationType;
type ChartStat = {
  groupCount: number;
  numericCount: number;
  numericValues: number[];
  sum: number;
  min: number | null;
  max: number | null;
  unique: Set<string>;
  emptyCount: number;
  notEmptyCount: number;
  checkedCount: number;
  uncheckedCount: number;
};

export type ChartEmptyReason = "noFields" | "noFieldSelected" | "noValueFieldSelected" | "noRecords" | "allGroupsHidden" | "invalidAxisRange";

export interface ChartAggregateResult {
  points: ChartDataPoint[];
  emptyReason?: ChartEmptyReason;
}

export interface ChartSeries {
  key: string;
  label: string;
  values: number[];
}

export interface ChartStackedAggregateResult {
  keys: string[];
  labels: string[];
  series: ChartSeries[];
  emptyReason?: ChartEmptyReason;
}

export interface ChartAggregateOptions {
  aggregation?: ChartAggregation;
  valueField?: string;
  secondaryAggregation?: ChartAggregation;
  secondaryValueField?: string;
  dateBucket?: ChartDateBucket;
  numberBucket?: ChartNumberBucket;
  numberBucketSize?: number;
  computedFields?: ComputedFieldDef[];
  maxGroups?: number;
  otherLabel?: string;
  uncategorizedLabel?: string;
  sortBy?: "value-desc" | "value-asc" | "label-asc" | "label-desc" | "option-order";
  hiddenGroups?: Record<string, true>;
  omitZeroValues?: boolean;
  cumulative?: boolean;
  percentStacked?: boolean;
}

export function isChartCompatibleColumn(type: ColumnDef["type"]): boolean {
  return CHART_COMPATIBLE_TYPES.includes(type);
}

export function isChartGroupColumn(column: ColumnDef, computedFields: ComputedFieldDef[] = []): boolean {
  if (column.type === "computed") {
    const computedKey = getChartComputedKey(column);
    const field = computedFields.find((item) => item.key === computedKey);
    return field?.type === "text" || field?.type === "date" || field?.type === "checkbox" || field?.type === "number";
  }
  return isChartCompatibleColumn(column.type) || column.type === "number" || column.type === "currency";
}

export function isChartDateGroupColumn(column: ColumnDef, computedFields: ComputedFieldDef[] = []): boolean {
  if (isDateLikeColumnType(column.type)) return true;
  if (column.type !== "computed") return false;
  const computedKey = getChartComputedKey(column);
  return computedFields.some((field) => field.key === computedKey && field.type === "date");
}

export function isChartNumberGroupColumn(column: ColumnDef, computedFields: ComputedFieldDef[] = []): boolean {
  if (column.type === "number" || column.type === "currency") return true;
  if (column.type !== "computed") return false;
  const computedKey = getChartComputedKey(column);
  return computedFields.some((field) => field.key === computedKey && field.type === "number");
}

export function isChartCheckboxGroupColumn(column: ColumnDef, computedFields: ComputedFieldDef[] = []): boolean {
  if (column.type === "checkbox") return true;
  if (column.type !== "computed") return false;
  const computedKey = getChartComputedKey(column);
  return computedFields.some((field) => field.key === computedKey && field.type === "checkbox");
}

export function isChartStackColumn(type: ColumnDef["type"]): boolean {
  return type === "select" || type === "status" || type === "multi-select" || type === "checkbox";
}

export function isChartSeriesColumn(column: ColumnDef, computedFields: ComputedFieldDef[] = []): boolean {
  return isChartGroupColumn(column, computedFields) &&
    !isChartDateGroupColumn(column, computedFields) &&
    !isChartNumberGroupColumn(column, computedFields);
}

export function isChartValueColumn(column: ColumnDef, computedFields: ComputedFieldDef[] = []): boolean {
  if (column.type === "number" || column.type === "currency") return true;
  if (column.type !== "computed") return false;
  const computedKey = getChartComputedKey(column);
  return computedFields.some((field) => field.key === computedKey && field.type === "number");
}

export function isNumericChartAggregation(aggregation: ChartAggregation | undefined): boolean {
  return aggregation === "sum" || aggregation === "avg" || aggregation === "median" || aggregation === "min" || aggregation === "max" || aggregation === "range";
}

export function isCheckboxChartAggregation(aggregation: ChartAggregation | undefined): boolean {
  return aggregation === "checked" || aggregation === "unchecked" || aggregation === "percent-checked";
}

export function requiresChartValueField(aggregation: ChartAggregation | undefined): boolean {
  return aggregation !== undefined && aggregation !== "count";
}

export function isChartAggregationValueColumn(
  column: ColumnDef,
  aggregation: ChartAggregation | undefined,
  computedFields: ComputedFieldDef[] = [],
): boolean {
  if (!requiresChartValueField(aggregation)) return false;
  if (isNumericChartAggregation(aggregation)) return isChartValueColumn(column, computedFields);
  if (isCheckboxChartAggregation(aggregation)) {
    if (column.type === "checkbox") return true;
    if (column.type !== "computed") return false;
    const computedKey = getChartComputedKey(column);
    return computedFields.some((field) => field.key === computedKey && field.type === "checkbox");
  }
  return true;
}

export function getDefaultChartField(columns: ColumnDef[], computedFields: ComputedFieldDef[] = []): string | undefined {
  return columns.find((col) => col.key !== "file.name" && !isChartDateGroupColumn(col, computedFields) && !isChartNumberGroupColumn(col, computedFields) && isChartGroupColumn(col, computedFields))?.key ||
    columns.find((col) => col.key !== "file.name" && isChartDateGroupColumn(col, computedFields))?.key;
}

export function getDefaultChartValueField(
  columns: ColumnDef[],
  computedFields: ComputedFieldDef[] = [],
  aggregation: ChartAggregation | undefined = "sum",
): string | undefined {
  return columns.find((col) => col.key !== "file.name" && isChartAggregationValueColumn(col, aggregation, computedFields))?.key;
}

export function getDefaultChartDateBucket(columns: ColumnDef[], fieldKey: string | undefined, computedFields: ComputedFieldDef[] = []): ChartDateBucket | undefined {
  const column = fieldKey ? columns.find((col) => col.key === fieldKey) : undefined;
  return column && isChartDateGroupColumn(column, computedFields) ? "month" : undefined;
}

export function getDefaultChartNumberBucket(columns: ColumnDef[], fieldKey: string | undefined, computedFields: ComputedFieldDef[] = []): ChartNumberBucket | undefined {
  const column = fieldKey ? columns.find((col) => col.key === fieldKey) : undefined;
  return column && isChartNumberGroupColumn(column, computedFields) ? "auto" : undefined;
}

export function toChartNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getChartFieldValue(row: RowData, fieldKey: string, column?: ColumnDef): unknown {
  const fileValue = getChartFileFieldValue(row, fieldKey);
  if (fileValue !== undefined) return fileValue;
  const computedKey = column?.type === "computed"
    ? getChartComputedKey(column)
    : fieldKey.startsWith("formula.")
      ? fieldKey.slice("formula.".length)
      : undefined;
  if (computedKey && Object.prototype.hasOwnProperty.call(row.computed, computedKey)) {
    return row.computed[computedKey];
  }
  if (Object.prototype.hasOwnProperty.call(row.computed, fieldKey)) {
    return row.computed[fieldKey];
  }
  if (Object.prototype.hasOwnProperty.call(row.frontmatter, fieldKey)) {
    return row.frontmatter[fieldKey];
  }
  return null;
}

function getChartFileFieldValue(row: RowData, fieldKey: string): unknown {
  if (!fieldKey.startsWith("file.")) return undefined;
  if (fieldKey === "file.tags") return normalizeChartTags([
    ...toArray(row.frontmatter.tags),
    ...getInlineCacheTags(row),
  ]);
  if (fieldKey === "file.name") return row.file.name;
  if (fieldKey === "file.file" || fieldKey === "file.path") return row.file.path;
  if (fieldKey === "file.basename") return row.file.basename || row.file.name.replace(/\.md$/i, "");
  if (fieldKey === "file.folder") return row.file.parent?.path || "";
  if (fieldKey === "file.ext" || fieldKey === "file.extension") return row.file.extension;
  if (fieldKey === "file.ctime" || fieldKey === "file.created") return row.file.stat?.ctime;
  if (fieldKey === "file.mtime" || fieldKey === "file.modified") return row.file.stat?.mtime;
  if (fieldKey === "file.size") return row.file.stat?.size;
  if (fieldKey === "file.links") return Array.from(new Set([
    ...((row.cache?.links || []).map((link) => link.link)),
    ...Object.values(row.cache?.frontmatterLinks || {}).map((link) => link.link),
  ].filter(Boolean)));
  if (fieldKey === "file.embeds") return Array.from(new Set((row.cache?.embeds || []).map((link) => link.link).filter(Boolean)));
  return undefined;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
}

function getInlineCacheTags(row: RowData): string[] {
  const tags = row.cache?.tags || [];
  return tags.map((item) => item.tag).filter(Boolean);
}

function normalizeChartTags(values: unknown[]): string[] {
  return Array.from(new Set(values
    .flatMap((value) => toArray(value))
    .map((value) => stringifyValue(value).trim().replace(/^#+/, ""))
    .filter((value) => value.length > 0)));
}

function toGroupKeys(value: unknown, uncategorizedLabel: string, column?: ColumnDef): string[] {
  if (Array.isArray(value)) {
    const keys = Array.from(new Set(
      value.map((item) => resolveOptionGroupKey(item, column)).filter((item) => item.length > 0)
    ));
    return keys.length > 0 ? keys : [uncategorizedLabel];
  }
  if (value == null) return [uncategorizedLabel];
  const text = resolveOptionGroupKey(value, column);
  return text ? [text] : [uncategorizedLabel];
}

function resolveOptionGroupKey(value: unknown, column?: ColumnDef): string {
  const text = stringifyValue(value).trim();
  if (!text || !column || !isOptionColumnType(column.type)) return text;
  const options = getColumnOptionValues(column);
  if (options.length === 0) return text;
  if (typeof value === "string" && options.includes(text)) return text;
  const index = typeof value === "number" ? value : Number(text);
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return text;
  return options[index] || text;
}

function toDateBucket(value: unknown, bucket: ChartDateBucket, uncategorizedLabel: string): { key: string; label: string; rank: number } {
  const date = toDateValue(value);
  if (!date) return { key: uncategorizedLabel, label: uncategorizedLabel, rank: Number.POSITIVE_INFINITY };
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (bucket === "year") {
    return { key: String(year), label: String(year), rank: year };
  }
  if (bucket === "quarter") {
    const quarter = Math.floor((month - 1) / 3) + 1;
    return { key: `${year}-Q${quarter}`, label: `${year} Q${quarter}`, rank: year * 10 + quarter };
  }
  if (bucket === "month") {
    const key = `${year}-${pad2(month)}`;
    return { key, label: key, rank: year * 100 + month };
  }
  if (bucket === "week") {
    const week = getIsoWeek(date);
    const key = `${week.year}-W${pad2(week.week)}`;
    return { key, label: key, rank: week.year * 100 + week.week };
  }
  const key = `${year}-${pad2(month)}-${pad2(day)}`;
  return { key, label: key, rank: year * 10000 + month * 100 + day };
}

function getCheckboxGroupKey(value: unknown, uncategorizedLabel: string): string {
  if (value === true) return t("common.true");
  if (value === false) return t("common.false");
  return uncategorizedLabel;
}

export interface ChartNumberBucketRange {
  key: string;
  label: string;
  start: number;
  end: number;
}

interface ChartNumberBucketContext {
  size: number;
  min: number;
  max: number;
}

function createNumberBucketContext(
  rows: RowData[],
  fieldKey: string,
  column: ColumnDef,
  options: ChartAggregateOptions | undefined,
): ChartNumberBucketContext {
  const values = rows
    .map((row) => toChartNumber(getChartFieldValue(row, fieldKey, column)))
    .filter((value): value is number => value != null);
  if (values.length === 0) return { size: 1, min: 0, max: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const fixedSize = options?.numberBucket === "fixed" ? Number(options.numberBucketSize) : Number.NaN;
  const size = Number.isFinite(fixedSize) && fixedSize > 0 ? fixedSize : getAutoNumberBucketSize(min, max);
  return {
    size,
    min: Math.floor(min / size) * size,
    max: Math.ceil(max / size) * size,
  };
}

function toNumberBucket(value: unknown, context: ChartNumberBucketContext, uncategorizedLabel: string): { key: string; label: string; rank: number } {
  const numeric = toChartNumber(value);
  if (numeric == null) return { key: uncategorizedLabel, label: uncategorizedLabel, rank: Number.POSITIVE_INFINITY };
  const start = Math.floor(numeric / context.size) * context.size;
  const end = start + context.size;
  return {
    key: formatNumberBucketKey(start, end),
    label: `${formatBucketNumber(start)} - ${formatBucketNumber(end)}`,
    rank: start,
  };
}

export function parseNumberBucketKey(key: string): ChartNumberBucketRange | null {
  const match = /^__bucket__:(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/.exec(key);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    key,
    label: `${formatBucketNumber(start)} - ${formatBucketNumber(end)}`,
    start,
    end,
  };
}

function formatNumberBucketKey(start: number, end: number): string {
  return `__bucket__:${formatBucketNumber(start)}:${formatBucketNumber(end)}`;
}

function getAutoNumberBucketSize(min: number, max: number): number {
  const span = Math.abs(max - min);
  if (span === 0) return getNiceStep(Math.max(1, Math.abs(max)));
  return getNiceStep(span / 8);
}

function getNiceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exponent);
  const fraction = rawStep / base;
  if (fraction <= 1) return base;
  if (fraction <= 2) return 2 * base;
  if (fraction <= 5) return 5 * base;
  return 10 * base;
}

function formatBucketNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString();
}

function compareByPreferredOrder(
  values: Map<string, number>,
  preferredOrder: string[],
): (left: [string, number], right: [string, number]) => number {
  const ranks = new Map(preferredOrder.map((key, index) => [key, index]));
  return ([leftKey, leftCount], [rightKey, rightCount]) => {
    const leftRank = ranks.get(leftKey);
    const rightRank = ranks.get(rightKey);
    if (leftRank != null && rightRank != null) return leftRank - rightRank;
    if (leftRank != null) return -1;
    if (rightRank != null) return 1;
    return rightCount - leftCount || leftKey.localeCompare(rightKey);
  };
}

export function aggregateChart(
  rows: RowData[],
  fieldKey: string | undefined,
  columns: ColumnDef[],
  options?: ChartAggregateOptions,
): ChartAggregateResult {
  const compatibleColumns = columns.filter(
    (col) => col.key !== "file.name" && isChartGroupColumn(col, options?.computedFields || [])
  );
  if (compatibleColumns.length === 0) {
    return { points: [], emptyReason: "noFields" };
  }
  if (!fieldKey) {
    return { points: [], emptyReason: "noFieldSelected" };
  }

  const aggregation = options?.aggregation || "count";
  const computedFields = options?.computedFields || [];
  const column = columns.find((col) => col.key === fieldKey);
  if (!column || !isChartGroupColumn(column, computedFields)) {
    return { points: [], emptyReason: "noFieldSelected" };
  }
  if (rows.length === 0) {
    return { points: [], emptyReason: "noRecords" };
  }
  const valueColumn = !requiresChartValueField(aggregation)
    ? undefined
    : columns.find((col) => col.key === options?.valueField);
  if (requiresChartValueField(aggregation) && (!valueColumn || !isChartAggregationValueColumn(valueColumn, aggregation, computedFields))) {
    return { points: [], emptyReason: "noValueFieldSelected" };
  }

  const uncategorizedLabel = options?.uncategorizedLabel || t("common.uncategorized");
  const otherLabel = options?.otherLabel || t("chart.other");
  const maxGroups = Math.max(1, Math.floor(options?.maxGroups ?? 50));
  const stats = new Map<string, ChartStat>();
  const labels = new Map<string, string>();
  const dateRanks = new Map<string, number>();
  const dateBucket = isChartDateGroupColumn(column, computedFields) ? options?.dateBucket || "month" : undefined;
  const numberBucketContext = !dateBucket && isChartNumberGroupColumn(column, computedFields)
    ? createNumberBucketContext(rows, fieldKey, column, options)
    : undefined;

  for (const row of rows) {
    const raw = getChartFieldValue(row, fieldKey, column);
    const keys = dateBucket
      ? [toDateBucket(raw, dateBucket, uncategorizedLabel).key]
      : numberBucketContext
      ? [toNumberBucket(raw, numberBucketContext, uncategorizedLabel).key]
      : isChartCheckboxGroupColumn(column, computedFields)
      ? [getCheckboxGroupKey(raw, uncategorizedLabel)]
      : toGroupKeys(raw, uncategorizedLabel, column);
    if (dateBucket) {
      const bucket = toDateBucket(raw, dateBucket, uncategorizedLabel);
      labels.set(bucket.key, bucket.label);
      dateRanks.set(bucket.key, bucket.rank);
    } else if (numberBucketContext) {
      const bucket = toNumberBucket(raw, numberBucketContext, uncategorizedLabel);
      labels.set(bucket.key, bucket.label);
      dateRanks.set(bucket.key, bucket.rank);
    }
    const aggregationValue = valueColumn ? getChartFieldValue(row, valueColumn.key, valueColumn) : undefined;
    for (const key of keys) {
      const current = stats.get(key) || emptyStat();
      addStatValue(current, aggregation, aggregationValue);
      stats.set(key, current);
    }
  }

  const values = new Map(Array.from(stats.entries()).map(([key, stat]) => [key, getStatValue(stat, aggregation)]));
  const optionOrder = isOptionColumnType(column.type)
    ? getColumnOptionValues(column)
    : isChartCheckboxGroupColumn(column, computedFields)
      ? [t("common.false"), t("common.true"), uncategorizedLabel]
      : [];
  const sorted = Array.from(stats.entries()).sort(([leftKey, leftStat], [rightKey, rightStat]) => {
    if (dateBucket || numberBucketContext) {
      const leftRank = dateRanks.get(leftKey) ?? Number.POSITIVE_INFINITY;
      const rightRank = dateRanks.get(rightKey) ?? Number.POSITIVE_INFINITY;
      return leftRank - rightRank || leftKey.localeCompare(rightKey);
    }
    const sortBy = options?.sortBy;
    if (sortBy === "value-asc") return getStatValue(leftStat, aggregation) - getStatValue(rightStat, aggregation) || leftKey.localeCompare(rightKey);
    if (sortBy === "value-desc") return getStatValue(rightStat, aggregation) - getStatValue(leftStat, aggregation) || leftKey.localeCompare(rightKey);
    if (sortBy === "label-asc") return leftKey.localeCompare(rightKey);
    if (sortBy === "label-desc") return rightKey.localeCompare(leftKey);
    return compareByPreferredOrder(values, optionOrder)(
      [leftKey, getStatValue(leftStat, aggregation)],
      [rightKey, getStatValue(rightStat, aggregation)]
    );
  });
  const filtered = sorted.filter(([key, stat]) => {
    if (options?.hiddenGroups?.[key]) return false;
    if (options?.omitZeroValues && getStatValue(stat, aggregation) === 0) return false;
    return true;
  });
  if (filtered.length === 0 && sorted.length > 0) {
    return { points: [], emptyReason: "allGroupsHidden" };
  }
  const visible = filtered.slice(0, maxGroups);
  const overflow = filtered.slice(maxGroups);
  const points = visible.map(([key, stat]) => ({ key, label: labels.get(key) || key, value: getStatValue(stat, aggregation) }));
  if (overflow.length > 0) {
    points.push({
      key: "__other__",
      label: otherLabel,
      value: getStatValue(mergeStats(overflow.map(([, stat]) => stat)), aggregation),
    });
  }
  if (options?.cumulative) {
    let running = 0;
    for (const point of points) {
      running += point.value;
      point.value = running;
    }
  }
  return { points };
}

export function aggregateStackedChart(
  rows: RowData[],
  fieldKey: string | undefined,
  stackFieldKey: string | undefined,
  columns: ColumnDef[],
  options?: ChartAggregateOptions,
): ChartStackedAggregateResult {
  return aggregateSeriesChart(rows, fieldKey, stackFieldKey, columns, options);
}

export function aggregateSeriesChart(
  rows: RowData[],
  fieldKey: string | undefined,
  seriesFieldKey: string | undefined,
  columns: ColumnDef[],
  options?: ChartAggregateOptions,
): ChartStackedAggregateResult {
  const compatibleColumns = columns.filter(
    (col) => col.key !== "file.name" && isChartGroupColumn(col, options?.computedFields || [])
  );
  if (compatibleColumns.length === 0) return { keys: [], labels: [], series: [], emptyReason: "noFields" };
  if (!fieldKey || !seriesFieldKey) return { keys: [], labels: [], series: [], emptyReason: "noFieldSelected" };
  const aggregation = options?.aggregation || "count";
  const computedFields = options?.computedFields || [];
  const column = columns.find((col) => col.key === fieldKey);
  const stackColumn = columns.find((col) => col.key === seriesFieldKey);
  if (!column || !isChartGroupColumn(column, computedFields) || !stackColumn || !isChartSeriesColumn(stackColumn, computedFields)) {
    return { keys: [], labels: [], series: [], emptyReason: "noFieldSelected" };
  }
  if (rows.length === 0) return { keys: [], labels: [], series: [], emptyReason: "noRecords" };

  const valueColumn = !requiresChartValueField(aggregation)
    ? undefined
    : columns.find((col) => col.key === options?.valueField);
  if (requiresChartValueField(aggregation) && (!valueColumn || !isChartAggregationValueColumn(valueColumn, aggregation, computedFields))) {
    return { keys: [], labels: [], series: [], emptyReason: "noValueFieldSelected" };
  }

  const uncategorizedLabel = options?.uncategorizedLabel || t("common.uncategorized");
  const maxGroups = Math.max(1, Math.floor(options?.maxGroups ?? 50));
  const maxStacks = Math.max(1, Math.floor(options?.maxGroups ?? 12));
  const primaryLabels = new Map<string, string>();
  const primaryRanks = new Map<string, number>();
  const matrix = new Map<string, Map<string, ChartStat>>();
  const primaryDateBucket = isChartDateGroupColumn(column, computedFields) ? options?.dateBucket || "month" : undefined;
  const primaryNumberBucketContext = !primaryDateBucket && isChartNumberGroupColumn(column, computedFields)
    ? createNumberBucketContext(rows, fieldKey, column, options)
    : undefined;
  const primaryOptionRanks = new Map(
    (isOptionColumnType(column.type) ? getColumnOptionValues(column) : [])
      .map((key, index) => [key, index])
  );
  const stackOptionRanks = new Map(
    (isOptionColumnType(stackColumn.type) ? getColumnOptionValues(stackColumn) : [])
      .map((key, index) => [key, index])
  );

  for (const row of rows) {
    const primary = getGroupEntries(row, column, fieldKey, primaryDateBucket, uncategorizedLabel, computedFields, primaryNumberBucketContext);
    const stacks = getGroupEntries(row, stackColumn, seriesFieldKey, undefined, uncategorizedLabel, computedFields);
    const aggregationValue = valueColumn ? getChartFieldValue(row, valueColumn.key, valueColumn) : undefined;
    for (const group of primary) {
      primaryLabels.set(group.key, group.label);
      primaryRanks.set(group.key, group.rank);
      const rowStats = matrix.get(group.key) || new Map<string, ChartStat>();
      for (const stack of stacks) {
        const current = rowStats.get(stack.key) || emptyStat();
        addStatValue(current, aggregation, aggregationValue);
        rowStats.set(stack.key, current);
      }
      matrix.set(group.key, rowStats);
    }
  }

  const primaryOrder = Array.from(matrix.keys()).filter((key) => !options?.hiddenGroups?.[key]).sort((left, right) => {
    const leftRank = primaryRanks.get(left) ?? Number.POSITIVE_INFINITY;
    const rightRank = primaryRanks.get(right) ?? Number.POSITIVE_INFINITY;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const sortBy = options?.sortBy;
    const leftTotal = getGroupTotal(matrix.get(left), aggregation);
    const rightTotal = getGroupTotal(matrix.get(right), aggregation);
    if (sortBy === "value-asc") return leftTotal - rightTotal || left.localeCompare(right);
    if (sortBy === "value-desc") return rightTotal - leftTotal || left.localeCompare(right);
    if (sortBy === "label-asc") return left.localeCompare(right);
    if (sortBy === "label-desc") return right.localeCompare(left);
    const leftOptionRank = primaryOptionRanks.get(left);
    const rightOptionRank = primaryOptionRanks.get(right);
    if (leftOptionRank != null && rightOptionRank != null) return leftOptionRank - rightOptionRank;
    if (leftOptionRank != null) return -1;
    if (rightOptionRank != null) return 1;
    return rightTotal - leftTotal || left.localeCompare(right);
  }).filter((key) => !options?.omitZeroValues || getGroupTotal(matrix.get(key), aggregation) !== 0).slice(0, maxGroups);
  const stackTotals = getStackTotals(matrix, aggregation);
  const stackOrder = Array.from(stackTotals.entries())
    .filter(([key, value]) => !options?.hiddenGroups?.[key] && (!options?.omitZeroValues || value !== 0))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const leftRank = stackOptionRanks.get(leftKey);
      const rightRank = stackOptionRanks.get(rightKey);
      if (leftRank != null && rightRank != null) return leftRank - rightRank;
      if (leftRank != null) return -1;
      if (rightRank != null) return 1;
      return rightValue - leftValue || leftKey.localeCompare(rightKey);
    })
    .slice(0, maxStacks)
    .map(([key]) => key);
  if ((primaryOrder.length === 0 || stackOrder.length === 0) && matrix.size > 0) {
    return { keys: [], labels: [], series: [], emptyReason: "allGroupsHidden" };
  }
  const series = stackOrder.map((key) => ({
    key,
    label: key,
    values: primaryOrder.map((groupKey) => getStatValue(matrix.get(groupKey)?.get(key) || emptyStat(), aggregation)),
  }));
  if (options?.percentStacked) {
    for (let index = 0; index < primaryOrder.length; index += 1) {
      const total = series.reduce((sum, item) => sum + item.values[index], 0);
      for (const item of series) {
        item.values[index] = total > 0 ? (item.values[index] / total) * 100 : 0;
      }
    }
  }
  return {
    keys: primaryOrder,
    labels: primaryOrder.map((key) => primaryLabels.get(key) || key),
    series,
  };
}

export function aggregateMixedChart(
  rows: RowData[],
  fieldKey: string | undefined,
  columns: ColumnDef[],
  options?: ChartAggregateOptions,
): ChartStackedAggregateResult {
  const primary = aggregateChart(rows, fieldKey, columns, options);
  if (primary.emptyReason) return { keys: [], labels: [], series: [], emptyReason: primary.emptyReason };
  const secondary = aggregateChart(rows, fieldKey, columns, {
    ...options,
    aggregation: options?.secondaryAggregation || "count",
    valueField: options?.secondaryValueField,
  });
  if (secondary.emptyReason) return { keys: [], labels: [], series: [], emptyReason: secondary.emptyReason };
  const labels = primary.points.map((point) => point.label);
  const primaryValues = primary.points.map((point) => point.value);
  const secondaryByKey = new Map(secondary.points.map((point) => [point.key, point.value]));
  return {
    keys: primary.points.map((point) => point.key),
    labels,
    series: [
      { key: "bar", label: getAggregationText(options?.aggregation || "count"), values: primaryValues },
      { key: "line", label: getAggregationText(options?.secondaryAggregation || "count"), values: primary.points.map((point) => secondaryByKey.get(point.key) || 0) },
    ],
  };
}

function toDateValue(value: unknown): Date | null {
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

function getGroupEntries(
  row: RowData,
  column: ColumnDef,
  fieldKey: string,
  dateBucket: ChartDateBucket | undefined,
  uncategorizedLabel: string,
  computedFields: ComputedFieldDef[] = [],
  numberBucketContext?: ChartNumberBucketContext,
): Array<{ key: string; label: string; rank: number }> {
  const raw = getChartFieldValue(row, fieldKey, column);
  if (dateBucket) return [toDateBucket(raw, dateBucket, uncategorizedLabel)];
  if (numberBucketContext) return [toNumberBucket(raw, numberBucketContext, uncategorizedLabel)];
  const keys = isChartCheckboxGroupColumn(column, computedFields)
    ? [getCheckboxGroupKey(raw, uncategorizedLabel)]
    : toGroupKeys(raw, uncategorizedLabel, column);
  return keys.map((key) => ({ key, label: key, rank: Number.POSITIVE_INFINITY }));
}

function getGroupTotal(
  stats: Map<string, ChartStat> | undefined,
  aggregation: ChartAggregation,
): number {
  if (!stats) return 0;
  return Array.from(stats.values()).reduce((total, stat) => total + getStatValue(stat, aggregation), 0);
}

function getStackTotals(
  matrix: Map<string, Map<string, ChartStat>>,
  aggregation: ChartAggregation,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const stacks of matrix.values()) {
    for (const [key, stat] of stacks.entries()) {
      totals.set(key, (totals.get(key) || 0) + getStatValue(stat, aggregation));
    }
  }
  return totals;
}

function emptyStat(): ChartStat {
  return {
    groupCount: 0,
    numericCount: 0,
    numericValues: [],
    sum: 0,
    min: null,
    max: null,
    unique: new Set<string>(),
    emptyCount: 0,
    notEmptyCount: 0,
    checkedCount: 0,
    uncheckedCount: 0,
  };
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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getChartComputedKey(column: ColumnDef): string {
  return column.computedKey || (column.key.startsWith("formula.") ? column.key.slice("formula.".length) : column.key);
}

function getStatValue(
  stat: ChartStat,
  aggregation: ChartAggregation,
): number {
  if (aggregation === "sum") return stat.sum;
  if (aggregation === "avg") return stat.numericCount > 0 ? stat.sum / stat.numericCount : 0;
  if (aggregation === "median") return getMedianValue(stat.numericValues);
  if (aggregation === "min") return stat.min ?? 0;
  if (aggregation === "max") return stat.max ?? 0;
  if (aggregation === "range") return stat.min == null || stat.max == null ? 0 : stat.max - stat.min;
  if (aggregation === "unique") return stat.unique.size;
  if (aggregation === "empty") return stat.emptyCount;
  if (aggregation === "not-empty") return stat.notEmptyCount;
  if (aggregation === "percent-empty") return stat.groupCount > 0 ? (stat.emptyCount / stat.groupCount) * 100 : 0;
  if (aggregation === "percent-not-empty") return stat.groupCount > 0 ? (stat.notEmptyCount / stat.groupCount) * 100 : 0;
  if (aggregation === "checked") return stat.checkedCount;
  if (aggregation === "unchecked") return stat.uncheckedCount;
  if (aggregation === "percent-checked") {
    const checkboxCount = stat.checkedCount + stat.uncheckedCount;
    return checkboxCount > 0 ? (stat.checkedCount / checkboxCount) * 100 : 0;
  }
  return stat.groupCount;
}

function getAggregationText(aggregation: ChartAggregation): string {
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

function addStatValue(stat: ChartStat, aggregation: ChartAggregation, value: unknown): void {
  stat.groupCount += 1;
  if (aggregation === "count") return;
  if (isNumericChartAggregation(aggregation)) {
    const numericValue = toChartNumber(value);
    if (numericValue == null) return;
    stat.numericCount += 1;
    stat.numericValues.push(numericValue);
    stat.sum += numericValue;
    stat.min = stat.min == null ? numericValue : Math.min(stat.min, numericValue);
    stat.max = stat.max == null ? numericValue : Math.max(stat.max, numericValue);
    return;
  }
  const empty = isEmptyChartAggregationValue(value);
  if (empty) stat.emptyCount += 1;
  else stat.notEmptyCount += 1;
  for (const uniqueValue of toUniqueChartValues(value)) {
    stat.unique.add(uniqueValue);
  }
  if (value === true) stat.checkedCount += 1;
  else if (value === false) stat.uncheckedCount += 1;
}

function isEmptyChartAggregationValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0 || value.every((item) => isEmptyChartAggregationValue(item));
  return false;
}

function toUniqueChartValues(value: unknown): string[] {
  if (isEmptyChartAggregationValue(value)) return [];
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((item) => toUniqueChartValues(item))));
  }
  const text = stringifyValue(value).trim();
  return text ? [text] : [];
}

function mergeStats(stats: ChartStat[]): ChartStat {
  return stats.reduce((merged, stat) => {
    merged.groupCount += stat.groupCount;
    merged.numericCount += stat.numericCount;
    merged.numericValues.push(...stat.numericValues);
    merged.sum += stat.sum;
    merged.min = stat.min == null ? merged.min : merged.min == null ? stat.min : Math.min(merged.min, stat.min);
    merged.max = stat.max == null ? merged.max : merged.max == null ? stat.max : Math.max(merged.max, stat.max);
    for (const value of stat.unique) merged.unique.add(value);
    merged.emptyCount += stat.emptyCount;
    merged.notEmptyCount += stat.notEmptyCount;
    merged.checkedCount += stat.checkedCount;
    merged.uncheckedCount += stat.uncheckedCount;
    return merged;
  }, emptyStat());
}

function getMedianValue(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
