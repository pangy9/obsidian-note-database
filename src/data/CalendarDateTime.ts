import { ViewConfig } from "./types";

export const CALENDAR_TIME_SNAP_MINUTES = 15;
export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const MS_PER_DAY = 86400000;

interface LocaleWithWeekInfo {
  weekInfo?: { firstDay?: number };
  getWeekInfo?: () => { firstDay?: number };
}

export interface VisibleMinuteRange {
  startHour: number;
  endHour: number;
  startMinutes: number;
  endMinutes: number;
}

export function parseDateKeyToUtc(dateKey: string): Date | null {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

export function dateKeyFromUtc(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function makeUtcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function addUtcDays(date: Date, days: number): Date {
  return makeUtcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}

export function startOfNextUtcMonth(date: Date): Date {
  return makeUtcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function daysBetweenUtc(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

export function getLocalDateKey(date = new Date()): string {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function monthKeyFromLocalDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function addDateKeyDays(dateKey: string, days: number): string {
  const base = parseDateKeyToUtc(dateKey);
  if (!base) return dateKey;
  return dateKeyFromUtc(addUtcDays(base, days));
}

export function dateKeyDaysBetween(startKey: string, endKey: string): number | null {
  const start = parseDateKeyToUtc(startKey);
  const end = parseDateKeyToUtc(endKey);
  if (!start || !end) return null;
  return daysBetweenUtc(start, end);
}

export function snapMinutes(minutes: number, step = CALENDAR_TIME_SNAP_MINUTES): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : CALENDAR_TIME_SNAP_MINUTES;
  return Math.round(minutes / safeStep) * safeStep;
}

export function minuteOfDay(minutes: number): number {
  return ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function formatCalendarTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const hours = Math.floor(clamped / MINUTES_PER_HOUR);
  const mins = clamped % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function formatTimeRange(startMinutes: number, endMinutes: number): string {
  return `${formatCalendarTime(startMinutes)} - ${formatCalendarTime(endMinutes)}`;
}

export function normalizeVisibleHourRange(
  startValue: unknown,
  endValue: unknown,
  fallbackStart = 0,
  fallbackEnd = 24,
): VisibleMinuteRange {
  const startHour = clampInteger(startValue, 0, 23, fallbackStart);
  const rawEnd = clampInteger(endValue, 1, 24, fallbackEnd);
  const endHour = rawEnd <= startHour ? Math.min(24, startHour + 1) : rawEnd;
  return {
    startHour,
    endHour,
    startMinutes: startHour * MINUTES_PER_HOUR,
    endMinutes: endHour * MINUTES_PER_HOUR,
  };
}

export function getLocaleWeekStartsOn(config?: Pick<ViewConfig, "calendarFirstDayOfWeek">): number {
  const override = config?.calendarFirstDayOfWeek;
  if (override === 0 || override === 1 || override === 6) return override;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const LocaleCtor = (Intl as unknown as { Locale?: new (locale: string) => LocaleWithWeekInfo }).Locale;
  if (!LocaleCtor) return 0;
  const localeInfo = new LocaleCtor(locale);
  const weekInfo = typeof localeInfo.getWeekInfo === "function" ? localeInfo.getWeekInfo() : localeInfo.weekInfo;
  const firstDay = weekInfo?.firstDay;
  return typeof firstDay === "number" && Number.isInteger(firstDay) ? firstDay % 7 : 0;
}

export function getWeekdayLabels(locale: string, weekStartsOn: number): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const sundayUtc = Date.UTC(2026, 5, 7);
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(sundayUtc + ((weekStartsOn + index) % 7) * MS_PER_DAY)));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}
