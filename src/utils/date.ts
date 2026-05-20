/**
 * Date utility functions using moment.js (available globally in Obsidian).
 * Declare moment to avoid import issues with esbuild bundling.
 */
declare const moment: any;

export function parseDate(value: unknown): moment.Moment | null {
  if (!value) return null;
  if (typeof value === "string") {
    const m = moment(value, moment.ISO_8601, true);
    if (m.isValid()) return m;
    // Try other common formats
    const m2 = moment(value, ["YYYY-MM-DD", "YYYY/MM/DD", "YYYY年M月D日"]);
    if (m2.isValid()) return m2;
    return null;
  }
  if (typeof value === "number") {
    return moment(value);
  }
  return null;
}

export function formatDate(value: unknown, format = "YYYY-MM-DD"): string {
  const d = parseDate(value);
  return d ? d.format(format) : "";
}

export function daysBetween(a: unknown, b: unknown): number | null {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return null;
  return Math.abs(db.diff(da, "days"));
}

export function daysFromToday(value: unknown): number | null {
  const d = parseDate(value);
  if (!d) return null;
  return Math.round(d.diff(moment(), "days", true));
}

export function todayISO(): string {
  return moment().format("YYYY-MM-DD");
}

export function addMonths(value: unknown, months: number): string {
  const d = parseDate(value);
  if (!d) return "";
  return d.add(months, "months").format("YYYY-MM-DD");
}

export function addYears(value: unknown, years: number): string {
  const d = parseDate(value);
  if (!d) return "";
  return d.add(years, "years").format("YYYY-MM-DD");
}
