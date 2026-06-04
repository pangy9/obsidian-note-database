import { ColumnDef, DatabaseConfig, RowData, ViewConfig } from "../data/types";
import { getRowFileFieldValue, isBaseFileField } from "../data/FileFields";
import { t } from "../i18n";

export class SummaryRenderer {
  render(containerEl: HTMLElement, rows: RowData[], config?: ViewConfig, database?: DatabaseConfig): void {
    const existing = containerEl.querySelector(".db-summary");
    if (existing) existing.remove();

    const summary = containerEl.createDiv({ cls: "db-summary" });
    const addItem = (label: string, value: string, style?: string) => {
      const div = summary.createDiv({ cls: "db-summary-item" });
      div.createDiv({ cls: "label", text: label });
      div.createSpan({ text: value, cls: "value", attr: style ? { style } : {} });
    };

    addItem(t("common.total"), String(rows.length));
    if (!config?.summaryRules) return;

    for (const [field, summaryName] of Object.entries(config.summaryRules)) {
      const col = config.schema.columns.find((candidate) => candidate.key === field);
      const values = rows.map((row) => this.getRowValue(row, field, col));
      const result = this.calculateSummary(values, summaryName, database?.summaryFormulas?.[summaryName]);
      if (result == null || result === "") continue;
      const label = col?.label || field;
      addItem(`${label} ${summaryName}`, this.formatSummaryValue(result));
    }
  }

  private getRowValue(row: RowData, field: string, col?: ColumnDef): unknown {
    if (col?.type === "computed") return row.computed[col.computedKey || col.key] ?? row.computed[field];
    if (field.startsWith("formula.")) return row.computed[field.slice("formula.".length)];
    if (isBaseFileField(field)) return getRowFileFieldValue(row, field);
    return row.frontmatter[field];
  }

  private calculateSummary(values: unknown[], summaryName: string, customFormula?: string): unknown {
    const nonEmpty = values.filter((value) => !this.isEmpty(value));
    const numbers = nonEmpty.map((value) => Number(value)).filter((value) => Number.isFinite(value));
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
        ? nonEmpty.map((value) => Number(value)).filter((value) => Number.isFinite(value))
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
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "";
      if (Math.abs(value) >= 86400000 && value % 86400000 === 0) return `${value / 86400000}d`;
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
    }
    return String(value ?? "");
  }

  private isEmpty(value: unknown): boolean {
    if (value == null || value === "") return true;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  private toTime(value: unknown): number | null {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
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
      const text = Array.isArray(value) ? value.map((item) => String(item ?? "")).join(", ") : String(value ?? "");
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
    }
    return result;
  }
}
