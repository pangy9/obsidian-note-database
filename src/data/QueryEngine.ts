import { getColumnOptionValues, hasObsidianTagValue, isObsidianAliasesKey, isObsidianTagsKey, normalizeObsidianTagValue, toBooleanValue, toMultiSelectValues, toObsidianTagValues } from "./ColumnTypes";
import { getColumnDisplayType } from "./ColumnDisplay";
import { isDateLikeColumnType, parseDateTimeParts, toDateTimestamp } from "./DateTimeFormat";
import { getDateGroupMode } from "./GroupDisplay";
import { getRowFileFieldValue, isBaseFileField } from "./FileFields";
import { compareMultiSelect } from "./MultiSelect";
import { stringifyValue } from "./Stringify";
import { ColumnDef, DateGroupMode, RowData, FilterRule, SortRule, ViewConfig } from "./types";
import { t } from "../i18n";

export type SortDirection = "asc" | "desc";

export class QueryEngine {
  /**
   * Sort rows by a column.
   */
  sort(
    rows: RowData[],
    column: ColumnDef,
    direction: SortDirection
  ): RowData[] {
    return [...rows].sort((a, b) => {
      const cmp = this.compareRowsByColumn(a, b, column);
      return direction === "asc" ? cmp : -cmp;
    });
  }

  sortByRules(rows: RowData[], columns: ColumnDef[], rules: SortRule[]): RowData[] {
    if (rules.length === 0) return rows;
    const columnMap = new Map(columns.map((col) => [col.key, col]));
    return [...rows].sort((a, b) => {
      for (const rule of rules) {
        const col = columnMap.get(rule.field);
        if (col?.type === "select" || col?.type === "status" || col?.type === "multi-select") {
          const cmp = this.compareRowsByColumn(a, b, col);
          if (cmp !== 0) return rule.direction === "asc" ? cmp : -cmp;
          continue;
        }
        const va = col ? this.getSortValue(a, col) : this.getFieldValue(a, rule.field);
        const vb = col ? this.getSortValue(b, col) : this.getFieldValue(b, rule.field);
        const left = va == null ? "" : va as number | string;
        const right = vb == null ? "" : vb as number | string;
        const cmp = left < right ? -1 : left > right ? 1 : 0;
        if (cmp !== 0) return rule.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }

  private compareRowsByColumn(a: RowData, b: RowData, column: ColumnDef): number {
    if (column.type === "select" || column.type === "status") {
      return this.compareOptionValues(
        stringifyValue(this.getFieldValue(a, column.key)),
        stringifyValue(this.getFieldValue(b, column.key)),
        this.getComparableOptionValues(column)
      );
    }
    if (column.type === "multi-select") {
      return compareMultiSelect(
        this.getFieldValue(a, column.key),
        this.getFieldValue(b, column.key),
        this.getComparableOptionValues(column)
      );
    }
    const va = this.getSortValue(a, column);
    const vb = this.getSortValue(b, column);
    return va < vb ? -1 : va > vb ? 1 : 0;
  }

  /**
   * Apply multiple filter rules with configurable logic.
   * @param logic "and" = all rules must match, "or" = any rule matches
   */
  applyFilters(
    rows: RowData[],
    filters: FilterRule[],
    logic: "and" | "or" = "and",
    columns: ColumnDef[] = []
  ): RowData[] {
    if (filters.length === 0) return rows;
    const columnMap = new Map(columns.map((col) => [col.key, col]));
    return rows.filter((row) => {
      if (logic === "or") {
        return filters.some(rule => this.matchesFilter(row, rule, columnMap.get(rule.field)));
      }
      // AND logic: all rules must match
      return filters.every(rule => this.matchesFilter(row, rule, columnMap.get(rule.field)));
    });
  }

  private matchesFilter(row: RowData, rule: FilterRule, column?: ColumnDef): boolean {
    const val = this.getFieldValue(row, rule.field);
    const values = this.getComparableValues(val);
    const ruleValue = column && isObsidianTagsKey(column.key)
      ? normalizeObsidianTagValue(rule.value || "")
      : rule.value || "";

    switch (rule.op) {
      case "eq":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) === 0);
      case "neq":
        return values.every((value) => this.compareFilterValue(value, ruleValue, column) !== 0);
      case "contains":
        return values.some((value) => value.toLowerCase().includes(ruleValue.toLowerCase()));
      case "hasTag":
        return hasObsidianTagValue(values, ruleValue);
      case "gt":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) > 0);
      case "lt":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) < 0);
      case "gte":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) >= 0);
      case "lte":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) <= 0);
      case "empty":
        // checkbox: "empty" = unchecked. Boolean-aware so false / "" / null / missing key
        // all count as unchecked (previously `false` was stringified to "false" and counted
        // as not-empty, splitting two equally-unchecked notes into different buckets).
        if (column?.type === "checkbox") return this.toBooleanRank(stringifyValue(val)) === 0;
        return values.length === 0;
      case "notempty":
        if (column?.type === "checkbox") return this.toBooleanRank(stringifyValue(val)) === 1;
        return values.length > 0;
      default:
        return true;
    }
  }

  /**
   * Group rows by a field value.
   */
  groupBy(
    rows: RowData[],
    field: string,
    order: string[] = [],
    column?: ColumnDef,
    config?: ViewConfig
  ): { key: string; rows: RowData[]; count: number }[] {
    const dateGroupMode = config ? getDateGroupMode(config, field) : undefined;
    const groups = new Map<string, RowData[]>();
    for (const row of rows) {
      const raw = this.getFieldValue(row, field);
      const keys = this.getGroupKeys(raw, column, dateGroupMode, config);
      for (const key of keys) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }
    }
    const result = Array.from(groups.entries())
      .map(([key, items]) => ({ key, rows: items, count: items.length }));
    return this.sortGroups(result, order);
  }

  sortGroups<T extends { key: string; count: number }>(groups: T[], order: string[] = []): T[] {
    const orderMap = new Map(order.map((key, index) => [key, index]));
    return [...groups].sort((a, b) => {
      const ai = orderMap.get(a.key);
      const bi = orderMap.get(b.key);
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return b.count - a.count || a.key.localeCompare(b.key);
    });
  }

  private getSortValue(row: RowData, col: ColumnDef): number | string {
    const val = this.getFieldValue(row, col.key);
    if (val == null) return "";
    if (col.type === "number" || col.type === "currency") {
      return typeof val === "number" ? val : parseFloat(stringifyValue(val)) || 0;
    }
    if (isDateLikeColumnType(col.type)) {
      // 统一用本地墙上时间时间戳排序（带时间值与纯日期同口径），空值/非法回退 ""排最前。
      if (val == null || val === "") return "";
      return toDateTimestamp(val) ?? "";
    }
    if (col.type === "checkbox") {
      return val === true ? 1 : 0;
    }
    if (Array.isArray(val)) {
      return val.map((item) => stringifyValue(item)).join(", ");
    }
    return stringifyValue(val);
  }

  private compareFilterValue(left: string, right: string, column?: ColumnDef): number {
    if (column?.type === "number" || column?.type === "currency") {
      return this.compareNumbers(left, right);
    }
    if (isDateLikeColumnType(column?.type)) {
      return this.compareDates(left, right);
    }
    if (column?.type === "select" || column?.type === "status") {
      return this.compareOptionValues(left, right, this.getComparableOptionValues(column));
    }
    if (column?.type === "checkbox") {
      return this.toBooleanRank(left) - this.toBooleanRank(right);
    }

    const numCompare = this.compareNumbers(left, right);
    if (!Number.isNaN(numCompare)) return numCompare;
    return left.localeCompare(right);
  }

  private compareNumbers(left: string, right: string): number {
    const leftText = stringifyValue(left).replace(/[^0-9.-]/g, "");
    const rightText = stringifyValue(right).replace(/[^0-9.-]/g, "");
    if (!/[0-9]/.test(leftText) || !/[0-9]/.test(rightText)) return Number.NaN;
    const a = Number(leftText);
    const b = Number(rightText);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
    return a - b;
  }

  private compareDates(left: string, right: string): number {
    const a = this.parseDateValue(left);
    const b = this.parseDateValue(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
    return a - b;
  }

  private compareOptionValues(left: string, right: string, options: string[]): number {
    const ranks = new Map(options.map((value, index) => [value, index]));
    const a = ranks.get(left);
    const b = ranks.get(right);
    if (a != null && b != null) return a - b;
    if (a != null) return -1;
    if (b != null) return 1;
    return left.localeCompare(right);
  }

  private parseDateValue(value: string): number {
    // 统一走 toDateTimestamp：纯日期/带时间都按本地墙上时间，毫秒 number（file.ctime）直通。
    const ts = toDateTimestamp(value);
    return ts == null ? Number.NaN : ts;
  }

  private toBooleanRank(value: string): number {
    return ["true", "1", "yes", "y", "✓", "checked"].includes(stringifyValue(value).trim().toLowerCase()) ? 1 : 0;
  }

  private getComparableValues(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => stringifyValue(item)).filter((item) => item.length > 0);
    }
    if (value == null || value === "") return [];
    return [stringifyValue(value)];
  }

  private getGroupKeys(
    value: unknown,
    column?: ColumnDef,
    dateGroupMode?: DateGroupMode,
    config?: ViewConfig,
  ): string[] {
    const displayType = column && config?.schema
      ? getColumnDisplayType(column, config.schema.computedFields || [])
      : column?.type;
    // Checkbox is semantically binary even when the frontmatter key is absent. All falsy,
    // empty, or missing values belong to the unchecked group instead of "Uncategorized".
    if (displayType === "checkbox") return [toBooleanValue(value) ? "true" : "false"];
    // date 列总按 dateKey 归一化；datetime 列在 "date" 模式也按 dateKey（忽略时刻），清理"同日不同
    // 时间/带时间脏值"造成的分裂分组。归一化必须对原始值做（parseDateTimeParts 已支持毫秒 number），
    // 不能在 getComparableValues(stringify) 之后做，否则 number 会被当年份解析。
    if (column?.type === "date" || (column?.type === "datetime" && dateGroupMode === "date")) {
      const parts = parseDateTimeParts(value);
      if (parts) return [parts.dateKey];
      if (value == null || value === "") return [t("common.uncategorized")];
      return [stringifyValue(value)];
    }
    const keys = this.getComparableValues(value);
    if (keys.length === 0) return [t("common.uncategorized")];
    return Array.from(new Set(keys));
  }

  private getFieldValue(row: RowData, field: string): unknown {
    if (isBaseFileField(field)) return getRowFileFieldValue(row, field);
    // Computed fields first (they override frontmatter)
    if (field.startsWith("formula.") && field.slice("formula.".length) in row.computed) return row.computed[field.slice("formula.".length)];
    if (field in row.computed) return row.computed[field];
    if (isObsidianTagsKey(field) && field in row.frontmatter) return toObsidianTagValues(row.frontmatter[field]);
    // aliases is a built-in multitext/list property: normalize comma-strings to a list so
    // filtering/grouping use list semantics instead of treating "alpha, beta" as one scalar.
    if (isObsidianAliasesKey(field) && field in row.frontmatter) return toMultiSelectValues(row.frontmatter[field]);
    if (field in row.frontmatter) return row.frontmatter[field];
    return null;
  }

  private getComparableOptionValues(column: ColumnDef): string[] {
    const values = getColumnOptionValues(column);
    if (!isObsidianTagsKey(column.key)) return values;
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const tag = normalizeObsidianTagValue(value);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      normalized.push(tag);
    }
    return normalized;
  }
}
