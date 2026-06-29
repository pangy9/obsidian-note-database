import {
  DateTimeParts,
  formatDateTimeValueDisplay,
  formatDateValueDisplay,
  isDateLikeColumnType,
} from "./DateTimeFormat";
import { getEffectiveLocale } from "../i18n";

export function normalizeSearchQuery(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function getSearchHighlightTerms(query: string | undefined): string[] {
  const q = normalizeSearchQuery(query);
  if (!q) return [];
  const terms = new Set<string>([q]);
  for (const term of getDateSearchHighlightTerms(q)) {
    const normalized = term.trim();
    if (normalized) terms.add(normalized);
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

export function getDateSearchDisplayText(value: unknown, displayType: string | undefined): string {
  if (displayType === "datetime") return formatDateTimeValueDisplay(value);
  if (displayType === "date") return formatDateValueDisplay(value);
  return "";
}

export function matchesDateSearch(parts: DateTimeParts | null | undefined, query: string): boolean {
  if (!parts) return false;
  const q = normalizeSearchQuery(query);
  if (!q) return false;

  const fullDate = q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (fullDate) {
    return isValidDateQuery(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]))
      && parts.dateKey === q;
  }

  const yearMonth = q.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    const month = Number(yearMonth[2]);
    return month >= 1 && month <= 12 && parts.dateKey.slice(0, 7) === q;
  }

  const monthDay = q.match(/^(\d{1,2})-(\d{1,2})$/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    return isValidMonthDayQuery(month, day)
      && parts.month === pad2(month)
      && parts.day === pad2(day);
  }

  return false;
}

export function isDateSearchColumn(displayType: string | undefined, value: unknown): boolean {
  return value instanceof Date || isDateLikeColumnType(displayType);
}

function isValidDateQuery(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !isValidMonthDayQuery(month, day)) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isValidMonthDayQuery(month: number, day: number): boolean {
  return Number.isInteger(month)
    && Number.isInteger(day)
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= 31;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getDateSearchHighlightTerms(query: string): string[] {
  const fullDate = query.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (fullDate) {
    const year = Number(fullDate[1]);
    const month = Number(fullDate[2]);
    const day = Number(fullDate[3]);
    if (!isValidDateQuery(year, month, day)) return [];
    return [
      formatDateValueDisplay(query),
      formatDateTimeValueDisplay(query, { mode: "full" }),
      formatMonthDayDisplay(month, day),
    ];
  }

  const yearMonth = query.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    if (month < 1 || month > 12) return [];
    return [formatMonthDisplay(year, month), formatMonthInDateDisplay(year, month)];
  }

  const monthDay = query.match(/^(\d{1,2})-(\d{1,2})$/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (!isValidMonthDayQuery(month, day)) return [];
    return [formatMonthDayDisplay(month, day)];
  }

  return [];
}

function formatMonthDisplay(year: number, month: number): string {
  return new Intl.DateTimeFormat(getEffectiveLocale(), { month: "long" }).format(new Date(year, month - 1, 1));
}

function formatMonthInDateDisplay(year: number, month: number): string {
  const parts = new Intl.DateTimeFormat(getEffectiveLocale(), { month: "long", day: "numeric" })
    .formatToParts(new Date(year, month - 1, 21));
  const dayIndex = parts.findIndex((part) => part.type === "day");
  const monthIndex = parts.findIndex((part) => part.type === "month");
  if (monthIndex === -1) return "";
  const monthPrefix = dayIndex > monthIndex
    ? parts.slice(monthIndex, dayIndex).map((part) => part.value).join("")
    : parts[monthIndex].value;
  return monthPrefix.trim();
}

function formatMonthDayDisplay(month: number, day: number): string {
  return new Intl.DateTimeFormat(getEffectiveLocale(), { month: "long", day: "numeric" }).format(new Date(2000, month - 1, day));
}
