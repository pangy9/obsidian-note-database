import { LocaleCode } from "../i18n";
import { addUtcDays, daysBetweenUtc, makeUtcDate, parseDateKeyToUtc, startOfNextUtcMonth } from "./CalendarDateTime";
import { TimelineScale } from "./types";

type CalendarTitleScale = "day" | "week" | "month" | TimelineScale;
type EffectiveLocale = Exclude<LocaleCode, "system">;

export interface CalendarTitleParts {
  main: string;
  year: string;
  ariaLabel: string;
}

export interface TimelineMonthBand {
  label: string;
  span: number;
  offset: number;
}

interface CalendarTitleInput {
  scale: CalendarTitleScale;
  startDateKey?: string;
  endDateKey?: string;
  locale: EffectiveLocale;
}

interface TimelineMonthBandInput {
  scale: TimelineScale;
  startDateKey?: string;
  endDateKey?: string;
  locale: EffectiveLocale;
}

interface TimelineAxisBandInput extends TimelineMonthBandInput {
  startMinutes?: number;
  totalUnits?: number;
}

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const ZH_MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const ZH_DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const RANGE_DASH = "—";
const COMPACT_RANGE_SEPARATOR = RANGE_DASH;

export function formatCalendarTitleParts(input: CalendarTitleInput): CalendarTitleParts {
  const start = parseDateKeyToUtc(input.startDateKey || "");
  if (!start) return makeTitle(input.startDateKey || "", "");
  const end = parseDateKeyToUtc(input.endDateKey || input.startDateKey || "") || start;
  const locale = input.locale;
  const main = isChineseLocale(locale)
    ? formatChineseTitleMain(input.scale, start, end)
    : formatEnglishTitleMain(input.scale, start, end);
  const year = formatTitleYear(start, end);
  return makeTitle(main, year);
}

function formatEnglishTitleMain(scale: CalendarTitleScale, start: Date, end: Date): string {
  if (scale === "day" && sameUtcDay(start, end)) return `${englishMonth(start)} ${start.getUTCDate()}`;
  if (scale === "month") {
    if (sameUtcMonth(start, end) && sameUtcYear(start, end)) return englishMonth(start);
    return `${englishMonth(start)} ${RANGE_DASH} ${englishMonth(end)}`;
  }
  if (scale === "quarter") return `${englishMonth(start)} ${RANGE_DASH} ${englishMonth(end)}`;
  if (sameUtcMonth(start, end) && sameUtcYear(start, end)) {
    return `${englishMonth(start)} ${start.getUTCDate()} ${COMPACT_RANGE_SEPARATOR} ${end.getUTCDate()}`;
  }
  return `${englishMonth(start)} ${start.getUTCDate()} ${RANGE_DASH} ${englishMonth(end)} ${end.getUTCDate()}`;
}

function formatChineseTitleMain(scale: CalendarTitleScale, start: Date, end: Date): string {
  if (scale === "day" && sameUtcDay(start, end)) return chineseMonthDay(start);
  if (scale === "month") {
    if (sameUtcMonth(start, end) && sameUtcYear(start, end)) return chineseMonth(start);
    return `${chineseMonth(start)} ${RANGE_DASH} ${chineseMonth(end)}`;
  }
  if (scale === "quarter") return `${chineseMonth(start)} ${RANGE_DASH} ${chineseMonth(end)}`;
  if (sameUtcMonth(start, end) && sameUtcYear(start, end)) {
    return `${chineseMonthDay(start)} ${COMPACT_RANGE_SEPARATOR} ${chineseDay(end.getUTCDate())}`;
  }
  return `${chineseMonthDay(start)} ${RANGE_DASH} ${chineseMonthDay(end)}`;
}

function formatTitleYear(start: Date, end: Date): string {
  const startYear = String(start.getUTCFullYear());
  const endYear = String(end.getUTCFullYear());
  return startYear === endYear ? startYear : `${startYear} ${RANGE_DASH} ${endYear}`;
}

export function buildTimelineMonthBands(input: TimelineMonthBandInput): TimelineMonthBand[] {
  if (input.scale === "day" || input.scale === "month") return [];
  return buildTimelineMonthBoundaryBands(input, false);
}

export function buildTimelineAxisBands(input: TimelineAxisBandInput): TimelineMonthBand[] {
  if (input.scale === "day") return buildTimelineDayBoundaryBands(input);
  return buildTimelineMonthBoundaryBands(input, true);
}

function buildTimelineMonthBoundaryBands(input: TimelineMonthBandInput, includeStartBoundary: boolean): TimelineMonthBand[] {
  const start = parseDateKeyToUtc(input.startDateKey || "");
  const end = parseDateKeyToUtc(input.endDateKey || input.startDateKey || "");
  if (!start || !end || start.getTime() > end.getTime()) return [];
  if (!includeStartBoundary && input.scale === "week" && sameUtcMonth(start, end) && sameUtcYear(start, end)) return [];

  const bands: TimelineMonthBand[] = [];
  const shouldIncludeStartBoundary = includeStartBoundary || input.scale === "quarter";
  let groupStart = shouldIncludeStartBoundary && start.getUTCDate() === 1
    ? makeUtcDate(start.getUTCFullYear(), start.getUTCMonth(), 1)
    : startOfNextUtcMonth(start);
  while (groupStart.getTime() <= end.getTime()) {
    const monthEnd = makeUtcDate(groupStart.getUTCFullYear(), groupStart.getUTCMonth() + 1, 0);
    const groupEnd = monthEnd.getTime() < end.getTime() ? monthEnd : end;
    bands.push({
      label: formatBandMonthLabel(groupStart, input.locale),
      span: daysBetweenUtc(groupStart, groupEnd) + 1,
      offset: daysBetweenUtc(start, groupStart),
    });
    groupStart = addUtcDays(groupEnd, 1);
  }
  return bands;
}

function buildTimelineDayBoundaryBands(input: TimelineAxisBandInput): TimelineMonthBand[] {
  const start = parseDateKeyToUtc(input.startDateKey || "");
  if (!start) return [];
  const totalUnits = Math.max(0, Math.round(input.totalUnits || 0));
  if (totalUnits <= 0) return [];
  const startMinutes = Number.isFinite(input.startMinutes) ? Math.round(input.startMinutes || 0) : 0;
  const bands: TimelineMonthBand[] = [];
  for (let offset = 0; offset < totalUnits; offset++) {
    const absoluteMinutes = startMinutes + offset * 60;
    if (positiveModulo(absoluteMinutes, 24 * 60) !== 0) continue;
    const dayOffset = Math.floor(absoluteMinutes / (24 * 60));
    const date = addUtcDays(start, dayOffset);
    const nextOffset = findNextDayBoundaryOffset(startMinutes, totalUnits, offset);
    bands.push({
      label: formatDayBandLabel(date, input.locale),
      span: Math.max(1, nextOffset - offset),
      offset,
    });
  }
  return bands;
}

function findNextDayBoundaryOffset(startMinutes: number, totalUnits: number, currentOffset: number): number {
  for (let offset = currentOffset + 1; offset < totalUnits; offset++) {
    if (positiveModulo(startMinutes + offset * 60, 24 * 60) === 0) return offset;
  }
  return totalUnits;
}

function makeTitle(main: string, year: string): CalendarTitleParts {
  const ariaLabel = [main, year].filter(Boolean).join(" ");
  return { main, year, ariaLabel };
}

function englishMonth(date: Date): string {
  return EN_MONTHS[date.getUTCMonth()] || "";
}

function chineseMonth(date: Date): string {
  return ZH_MONTHS[date.getUTCMonth()] || "";
}

function formatBandMonthLabel(date: Date, locale: EffectiveLocale): string {
  return isChineseLocale(locale) ? chineseMonth(date) : englishMonth(date);
}

function formatDayBandLabel(date: Date, locale: EffectiveLocale): string {
  return isChineseLocale(locale) ? chineseMonthDay(date) : `${englishMonth(date)} ${date.getUTCDate()}`;
}

function chineseMonthDay(date: Date): string {
  return `${chineseMonth(date)}${chineseDay(date.getUTCDate())}`;
}

function chineseDay(day: number): string {
  if (day <= 0 || day > 31) return `${day}日`;
  if (day <= 10) return `${day === 10 ? "十" : ZH_DIGITS[day]}日`;
  if (day < 20) return `十${ZH_DIGITS[day - 10]}日`;
  if (day === 20) return "二十日";
  if (day < 30) return `二十${ZH_DIGITS[day - 20]}日`;
  if (day === 30) return "三十日";
  return "三十一日";
}

function isChineseLocale(locale: EffectiveLocale): boolean {
  return locale === "zh-CN" || locale === "zh-TW";
}

function sameUtcMonth(a: Date, b: Date): boolean {
  return a.getUTCMonth() === b.getUTCMonth();
}

function sameUtcYear(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear();
}

function sameUtcDay(a: Date, b: Date): boolean {
  return sameUtcYear(a, b) && sameUtcMonth(a, b) && a.getUTCDate() === b.getUTCDate();
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
