import { ColumnDef, DatabaseConfig, RowData, ViewConfig } from "../data/types";
import { toChartNumber } from "../data/ChartAggregation";
import { isDateLikeColumnType, parseDateTimeParts, toDateTimestamp } from "../data/DateTimeFormat";
import { getRowFileFieldValue, isBaseFileField } from "../data/FileFields";
import { stringifyValue } from "../data/Stringify";
import { t } from "../i18n";
import { DropdownOption, openDropdownMenu } from "./DropdownField";

/** 汇总渲染选项 */
interface SummaryRenderOptions {
  placement?: "before-view" | "after-chart";
  /** 配置变更回调，传入时在汇总栏末尾显示 SUM 字段选择器 */
  onChange?: () => void;
}

type SummaryKind =
  "SUM" | "AVERAGE" | "MEDIAN" | "MIN" | "MAX" | "RANGE" | "STDDEV" |
  "COUNT" | "UNIQUE" | "EMPTY" | "FILLED" |
  "CHECKED" | "UNCHECKED" | "EARLIEST" | "LATEST";

function normalizeSummaryKind(name: string | undefined): SummaryKind | null {
  const compact = (name || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (compact) {
    case "sum": return "SUM";
    case "avg":
    case "average":
    case "mean": return "AVERAGE";
    case "median": return "MEDIAN";
    case "min": return "MIN";
    case "max": return "MAX";
    case "range": return "RANGE";
    case "stddev":
    case "stdev":
    case "standarddeviation": return "STDDEV";
    case "count":
    case "filled":
    case "countfilled":
    case "countnonempty": return compact === "filled" ? "FILLED" : "COUNT";
    case "unique":
    case "countunique": return "UNIQUE";
    case "empty":
    case "countempty": return "EMPTY";
    case "checked": return "CHECKED";
    case "unchecked": return "UNCHECKED";
    case "earliest": return "EARLIEST";
    case "latest": return "LATEST";
    default: return null;
  }
}

function getSummaryKindLabel(kind: SummaryKind): string {
  switch (kind) {
    case "SUM": return t("chart.sumAggregation");
    case "AVERAGE": return t("chart.avgAggregation");
    case "MEDIAN": return t("chart.medianAggregation");
    case "MIN": return t("chart.minAggregation");
    case "MAX": return t("chart.maxAggregation");
    case "RANGE": return t("chart.rangeAggregation");
    case "STDDEV": return t("viewConfig.summaryStddev");
    case "COUNT": return t("viewConfig.summaryCount");
    case "UNIQUE": return t("viewConfig.summaryUnique");
    case "EMPTY": return t("viewConfig.summaryEmpty");
    case "FILLED": return t("viewConfig.summaryFilled");
    case "CHECKED": return t("viewConfig.summaryChecked");
    case "UNCHECKED": return t("viewConfig.summaryUnchecked");
    case "EARLIEST": return t("viewConfig.summaryEarliest");
    case "LATEST": return t("viewConfig.summaryLatest");
  }
}

function isNumericSummaryColumn(config: ViewConfig, col: ColumnDef): boolean {
  if (col.type === "number" || col.type === "currency") return true;
  if (col.type !== "computed") return false;
  const computedKey = col.computedKey || col.key;
  return config.schema.computedFields.find((field) => field.key === computedKey)?.type === "number";
}

function getSummaryKindsForColumn(config: ViewConfig, col: ColumnDef): SummaryKind[] {
  const common: SummaryKind[] = ["COUNT", "UNIQUE", "EMPTY", "FILLED"];
  if (isNumericSummaryColumn(config, col)) return ["SUM", "AVERAGE", "MEDIAN", "MIN", "MAX", "RANGE", "STDDEV", ...common];
  if (isDateLikeColumnType(col.type)) return ["EARLIEST", "LATEST", "RANGE", ...common];
  if (col.type === "checkbox") return ["CHECKED", "UNCHECKED", ...common];
  return common;
}

function getSummaryFieldOptions(config: ViewConfig, includeNone = false): DropdownOption[] {
  const options = config.schema.columns
    .filter((col) => col.key !== "file.name")
    .map((col) => ({
      value: col.key,
      text: col.label || col.key,
    }));
  return includeNone ? [{ value: "", text: t("viewConfig.summaryFieldNone") }, ...options] : options;
}

function getSummaryAggregationOptions(config: ViewConfig, field: string, includeRemove = false): DropdownOption[] {
  const col = config.schema.columns.find((candidate) => candidate.key === field);
  if (!col) return includeRemove ? [{ value: "", text: t("viewConfig.summaryFieldNone") }] : [];
  const options = getSummaryKindsForColumn(config, col).map((kind) => ({
    value: kind,
    text: getSummaryKindLabel(kind),
  }));
  return [
    ...(includeRemove ? [{ value: "", text: t("viewConfig.summaryFieldNone") }] : []),
    ...options,
  ];
}

function setSummaryRule(config: ViewConfig, previousField: string | undefined, field: string | undefined, kind: SummaryKind | undefined): void {
  const next = { ...(config.summaryRules || {}) };
  if (previousField) delete next[previousField];
  if (field && kind) next[field] = kind;
  config.summaryRules = Object.keys(next).length > 0 ? next : undefined;
}

export class SummaryRenderer {
  render(
    containerEl: HTMLElement,
    rows: RowData[],
    config?: ViewConfig,
    database?: DatabaseConfig,
    options?: SummaryRenderOptions
  ): void {
    const existing = containerEl.querySelector(".db-summary");
    if (existing) existing.remove();
    if (config?.viewType === "calendar" || config?.viewType === "timeline") return;

    const summary = containerEl.createDiv({ cls: "db-summary" });
    if (options?.placement === "after-chart") this.placeAfterChart(containerEl, summary);
    const addItem = (label: string, value: string, style?: string) => {
      const div = summary.createDiv({ cls: "db-summary-item" });
      div.createDiv({ cls: "label", text: label });
      div.createSpan({ text: value, cls: "value", attr: style ? { style } : {} });
    };

    addItem(t("common.total"), String(rows.length));

    if (config?.summaryRules) {
      for (const [field, summaryName] of Object.entries(config.summaryRules)) {
        const col = config.schema.columns.find((candidate) => candidate.key === field);
        const values = rows.map((row) => this.getRowValue(row, field, col));
        const result = this.calculateSummary(values, summaryName, database?.summaryFormulas?.[summaryName]);
        if (result == null || result === "") continue;
        const label = col?.label || field;
        const kind = normalizeSummaryKind(summaryName);

        /* 内置汇总项可点击，触发字段 + 聚合选择菜单。 */
        if (kind && options?.onChange) {
          this.addClickableSummaryItem(summary, field, label, kind, this.formatSummaryValue(result), config, options.onChange);
        } else {
          addItem(`${label} ${kind ? getSummaryKindLabel(kind) : summaryName}`, this.formatSummaryValue(result));
        }
      }
    }

    /* 显示淡色入口，用于新增或移除一条字段汇总。 */
    if (config && options?.onChange && getSummaryFieldOptions(config).length > 0) {
      this.addSummaryEntryHint(summary, config, options.onChange);
    }
  }

  /** 渲染可点击的内置汇总值，点击弹出字段 + 聚合选择菜单。 */
  private addClickableSummaryItem(
    summary: HTMLElement,
    field: string,
    fieldLabel: string,
    kind: SummaryKind,
    value: string,
    config: ViewConfig,
    onChange: () => void
  ): void {
    const div = summary.createDiv({ cls: "db-summary-item db-summary-sum-item" });
    div.createDiv({ cls: "label", text: `${fieldLabel} ${getSummaryKindLabel(kind)}` });
    div.createSpan({ text: value, cls: "value" });
    div.onclick = (e: MouseEvent) => this.openSummaryAggregationMenu(e, config, onChange, field, field, kind, true);
  }

  /** 渲染淡色汇总新增入口。 */
  private addSummaryEntryHint(summary: HTMLElement, config: ViewConfig, onChange: () => void): void {
    const hint = summary.createDiv({ cls: "db-summary-item db-summary-sum-hint" });
    hint.createSpan({ text: t("viewConfig.summaryAdd"), cls: "value" });
    hint.onclick = (e: MouseEvent) => this.openSummaryFieldMenu(e, config, onChange);
  }

  /** 先选择字段，避免把每个字段支持的汇总操作全部铺平成一个长菜单。 */
  private openSummaryFieldMenu(
    e: MouseEvent,
    config: ViewConfig,
    onChange: () => void,
    currentField?: string,
    currentKind?: SummaryKind,
  ): void {
    const anchor = e.currentTarget instanceof HTMLElement ? e.currentTarget : e.target instanceof HTMLElement ? e.target : undefined;
    if (!anchor) return;
    openDropdownMenu({
      anchor,
      label: t("viewConfig.summaryField"),
      value: currentField || "",
      popoverClassName: "db-summary-dropdown-popover",
      searchable: true,
      options: getSummaryFieldOptions(config, Boolean(currentField)),
      onChange: (field) => {
        if (!field) {
          if (!currentField) return;
          setSummaryRule(config, currentField, undefined, undefined);
          onChange();
          return;
        }
        window.setTimeout(() => this.openSummaryAggregationMenu(anchor, config, onChange, field, currentField, currentKind), 0);
      },
    });
  }

  /** 选择指定字段支持的聚合方式，当前菜单只展示这个字段可用的操作。 */
  private openSummaryAggregationMenu(
    eOrAnchor: MouseEvent | HTMLElement,
    config: ViewConfig,
    onChange: () => void,
    field: string,
    previousField?: string,
    currentKind?: SummaryKind,
    includeRemove = false,
  ): void {
    const anchor = eOrAnchor instanceof HTMLElement
      ? eOrAnchor
      : eOrAnchor.currentTarget instanceof HTMLElement
        ? eOrAnchor.currentTarget
        : eOrAnchor.target instanceof HTMLElement
          ? eOrAnchor.target
          : undefined;
    if (!anchor) return;
    const options = getSummaryAggregationOptions(config, field, includeRemove);
    if (!options.length) return;
    openDropdownMenu({
      anchor,
      label: t("viewConfig.summaryField"),
      value: currentKind || "",
      popoverClassName: "db-summary-dropdown-popover",
      options,
      onChange: (value) => {
        const kind = normalizeSummaryKind(value);
        if (!kind && !includeRemove) return;
        if (field === previousField && kind === currentKind) return;
        setSummaryRule(config, previousField, kind ? field : undefined, kind || undefined);
        onChange();
      },
    });
  }

  private placeAfterChart(containerEl: HTMLElement, summary: HTMLElement): void {
    const anchor = containerEl.querySelector(".db-chart, .db-chart-empty");
    if (anchor?.parentElement) anchor.parentElement.insertBefore(summary, anchor.nextSibling);
  }

  private getRowValue(row: RowData, field: string, col?: ColumnDef): unknown {
    if (col?.type === "computed") return row.computed[col.computedKey || col.key] ?? row.computed[field];
    if (field.startsWith("formula.")) return row.computed[field.slice("formula.".length)];
    if (isBaseFileField(field)) return getRowFileFieldValue(row, field);
    return row.frontmatter[field];
  }

  private calculateSummary(values: unknown[], summaryName: string, customFormula?: string): unknown {
    const nonEmpty = values.filter((value) => !this.isEmpty(value));
    const numbers = nonEmpty.map((value) => toChartNumber(value)).filter((value): value is number => value != null);
    const dates = nonEmpty.map((value) => this.toTime(value)).filter((value): value is number => value != null);
    const booleans = nonEmpty.filter((value) => typeof value === "boolean");
    const name = summaryName.trim().toLowerCase();
    const compactName = name.replace(/[\s_-]+/g, "");

    if (customFormula) {
      const custom = this.calculateSupportedCustomSummary(values, nonEmpty, numbers, customFormula);
      if (custom != null) return custom;
    }
    if (name === "average" || name === "mean") return numbers.length ? this.sum(numbers) / numbers.length : "";
    if (name === "min") return numbers.length ? Math.min(...numbers) : "";
    if (name === "max") return numbers.length ? Math.max(...numbers) : "";
    if (name === "sum") return numbers.length ? this.sum(numbers) : "";
    if (name === "median") return this.median(numbers);
    if (compactName === "stddev" || compactName === "stdev" || compactName === "standarddeviation") return this.stddev(numbers);
    if (name === "checked") return booleans.filter(Boolean).length;
    if (name === "unchecked") return booleans.filter((value) => !value).length;
    if (compactName === "empty" || compactName === "countempty") return values.filter((value) => this.isEmpty(value)).length;
    if (compactName === "filled" || compactName === "count" || compactName === "countfilled" || compactName === "countnonempty") return nonEmpty.length;
    if (compactName === "countall") return values.length;
    if (compactName === "unique" || compactName === "countunique") return this.uniqueCount(nonEmpty);
    if (name === "earliest") return dates.length ? new Date(Math.min(...dates)) : "";
    if (name === "latest") return dates.length ? new Date(Math.max(...dates)) : "";
    if (name === "range") {
      if (numbers.length) return Math.max(...numbers) - Math.min(...numbers);
      if (dates.length) return Math.max(...dates) - Math.min(...dates);
    }
    return "";
  }

  private calculateSupportedCustomSummary(values: unknown[], nonEmpty: unknown[], numbers: number[], expression: string): unknown {
    const normalized = this.compactSummaryExpression(expression);
    if (/^values\.length$/i.test(normalized)) return values.length;
    if (/^values\.isEmpty\(\)$/i.test(normalized)) return values.length === 0;
    if (/^values\.unique\(\)\.length$/i.test(normalized)) return this.uniqueCount(nonEmpty);
    const uniqueJoin = normalized.match(/^values(?:\.filter\(!value\.isEmpty\(\)\))?\.unique\(\)(\.sort\(\))?\.join\((["'])(.*?)\2\)$/i);
    if (uniqueJoin) {
      const unique = this.uniqueValues(nonEmpty);
      return (uniqueJoin[1] ? unique.sort() : unique).join(uniqueJoin[3]);
    }
    if (/^values\.filter\(value\.isEmpty\(\)\)\.length$/i.test(normalized)) {
      return values.filter((value) => this.isEmpty(value)).length;
    }
    if (/^values\.filter\(!value\.isEmpty\(\)\)\.length$/i.test(normalized)) {
      return nonEmpty.length;
    }
    if (/^values\.filter\(value\.isType\(["']number["']\)\)\.length$/i.test(normalized)) {
      return numbers.length;
    }
    if (/^values\.filter\(value\.isType\(["']number["']\)\)\.reduce\(if\(acc==null\|\|value>acc,value,acc\),null\)$/i.test(normalized)) {
      return numbers.length ? Math.max(...numbers) : "";
    }
    if (/^values\.filter\(value\.isType\(["']number["']\)\)\.reduce\(if\(acc==null\|\|value<acc,value,acc\),null\)$/i.test(normalized)) {
      return numbers.length ? Math.min(...numbers) : "";
    }
    const aggregate = normalized.match(/^values(?:\.filter\((value\.isType\(["']number["']\)|!value\.isEmpty\(\))\))?\.(mean|average|sum|min|max|median|stddev)\(\)(?:\.round\((\d+)\))?$/i);
    if (!aggregate) return null;
    const sourceValues = aggregate[1]?.toLowerCase().includes("number")
      ? numbers
      : aggregate[1]?.toLowerCase().includes("isempty")
        ? nonEmpty.map((value) => toChartNumber(value)).filter((value): value is number => value != null)
        : numbers;
    if (!sourceValues.length) return null;
    let result: number | string;
    switch (aggregate[2].toLowerCase()) {
      case "mean":
      case "average":
        result = this.sum(sourceValues) / sourceValues.length;
        break;
      case "sum":
        result = this.sum(sourceValues);
        break;
      case "min":
        result = Math.min(...sourceValues);
        break;
      case "max":
        result = Math.max(...sourceValues);
        break;
      case "median":
        result = this.median(sourceValues);
        break;
      case "stddev":
        result = this.stddev(sourceValues);
        break;
      default:
        return null;
    }
    if (typeof result !== "number" || !aggregate[3]) return result;
    const factor = Math.pow(10, Number(aggregate[3]));
    return Math.round(result * factor) / factor;
  }

  private compactSummaryExpression(expression: string): string {
    let result = "";
    let quote: string | null = null;
    for (let index = 0; index < expression.length; index += 1) {
      const char = expression[index];
      if (quote) {
        result += char;
        if (char === "\\") {
          index += 1;
          if (index < expression.length) result += expression[index];
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === "\"" || char === "'") {
        quote = char;
        result += char;
        continue;
      }
      if (!/\s/.test(char)) result += char;
    }
    return result;
  }

  private formatSummaryValue(value: unknown): string {
    if (value instanceof Date) return parseDateTimeParts(value)?.dateKey ?? "";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "";
      if (Math.abs(value) >= 86400000 && value % 86400000 === 0) return `${value / 86400000}d`;
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
    }
    return stringifyValue(value);
  }

  private isEmpty(value: unknown): boolean {
    if (value == null || value === "") return true;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  private toTime(value: unknown): number | null {
    // 统一走本地墙上时间时间戳，与排序同口径；避免 Date.parse 对带时间值按 UTC 解析导致与排序差一天。
    return toDateTimestamp(value);
  }

  private sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
  }

  private median(values: number[]): number | string {
    if (!values.length) return "";
    const sorted = [...values].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private stddev(values: number[]): number | string {
    if (!values.length) return "";
    const avg = this.sum(values) / values.length;
    return Math.sqrt(this.sum(values.map((value) => Math.pow(value - avg, 2))) / values.length);
  }

  private uniqueCount(values: unknown[]): number {
    return new Set(values.map((value) => JSON.stringify(value))).size;
  }

  private uniqueValues(values: unknown[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const text = Array.isArray(value) ? value.map((item) => stringifyValue(item)).join(", ") : stringifyValue(value);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
    }
    return result;
  }
}
