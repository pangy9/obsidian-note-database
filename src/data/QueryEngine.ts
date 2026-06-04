import { getColumnOptionValues, isObsidianTagsKey, normalizeObsidianTagValue, toObsidianTagValues } from "./ColumnTypes";
import { getRowFileFieldValue, isBaseFileField } from "./FileFields";
import { compareMultiSelect } from "./MultiSelect";
import { ColumnDef, RowData, FilterRule, SortRule } from "./types";
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
        String(this.getFieldValue(a, column.key) ?? ""),
        String(this.getFieldValue(b, column.key) ?? ""),
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
      case "gt":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) > 0);
      case "lt":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) < 0);
      case "gte":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) >= 0);
      case "lte":
        return values.some((value) => this.compareFilterValue(value, ruleValue, column) <= 0);
      case "empty":
        return values.length === 0;
      case "notempty":
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
    order: string[] = []
  ): { key: string; rows: RowData[]; count: number }[] {
    const groups = new Map<string, RowData[]>();
    for (const row of rows) {
      const raw = this.getFieldValue(row, field);
      const keys = this.getGroupKeys(raw);
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
      return typeof val === "number" ? val : parseFloat(String(val)) || 0;
    }
    if (col.type === "date") {
      if (typeof val === "string") return val;
      return String(val);
    }
    if (col.type === "checkbox") {
      return val === true ? 1 : 0;
    }
    if (Array.isArray(val)) {
      return val.map((item) => String(item)).join(", ");
    }
    return String(val);
  }

  private compareFilterValue(left: string, right: string, column?: ColumnDef): number {
    if (column?.type === "number" || column?.type === "currency") {
      return this.compareNumbers(left, right);
    }
    if (column?.type === "date") {
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
    const a = Number(String(left).replace(/[^0-9.-]/g, ""));
    const b = Number(String(right).replace(/[^0-9.-]/g, ""));
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
    const text = String(value || "").trim();
    if (!text) return Number.NaN;
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match) {
      const [, y, m, d] = match;
      return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
    }
    return Date.parse(text);
  }

  private toBooleanRank(value: string): number {
    return ["true", "1", "yes", "y", "✓", "checked"].includes(String(value).trim().toLowerCase()) ? 1 : 0;
  }

  private getComparableValues(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter((item) => item.length > 0);
    }
    if (value == null || value === "") return [];
    return [String(value)];
  }

  private getGroupKeys(value: unknown): string[] {
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
