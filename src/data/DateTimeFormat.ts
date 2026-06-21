import { stringifyValue } from "./Stringify";
import { getEffectiveLocale } from "../i18n";

export interface DateTimeParts {
  dateKey: string;
  year: number;
  month: string;
  day: string;
  time?: string;
}

export interface DateDisplayOptions {
  contextYear?: number;
  mode?: "contextual" | "full";
}

export interface DateTimeDisplayOptions extends DateDisplayOptions {
  showTimeWhenMissing?: boolean;
}

const DATE_TIME_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/;

export function isDateLikeColumnType(type: string | undefined): boolean {
  return type === "date" || type === "datetime";
}

export function hasDateTimeValue(value: unknown): boolean {
  if (value instanceof Date) {
    return value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 || value.getUTCSeconds() !== 0 || value.getUTCMilliseconds() !== 0;
  }
  const parts = parseDateTimeParts(value);
  return Boolean(parts?.time);
}

export function parseDateTimeParts(value: unknown): DateTimeParts | null {
  if (value == null || value === "") return null;
  // 毫秒时间戳（如 file.ctime）按绝对时间转本地日期分量；Obsidian/YAML Date 对象用 UTC 分量。
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const date = new Date(value);
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    return {
      dateKey: `${year}-${month}-${day}`,
      year,
      month,
      day,
      time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
    };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getUTCFullYear();
    const month = pad2(value.getUTCMonth() + 1);
    const day = pad2(value.getUTCDate());
    return {
      dateKey: `${year}-${month}-${day}`,
      year,
      month,
      day,
      time: `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}`,
    };
  }
  const text = stringifyValue(value).trim();
  const match = text.match(DATE_TIME_RE);
  if (match) {
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    const dayNumber = Number(match[3]);
    if (!isValidDateParts(year, monthNumber, dayNumber)) return null;
    const month = pad2(monthNumber);
    const day = pad2(dayNumber);
    const hour = match[4] != null ? Number(match[4]) : undefined;
    const minute = match[5] != null ? Number(match[5]) : undefined;
    const time = hour != null && minute != null && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
      ? `${pad2(hour)}:${pad2(minute)}`
      : undefined;
    return { dateKey: `${year}-${month}-${day}`, year, month, day, time };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = pad2(parsed.getMonth() + 1);
  const day = pad2(parsed.getDate());
  return {
    dateKey: `${year}-${month}-${day}`,
    year,
    month,
    day,
    time: `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`,
  };
}

export function formatDateValueDisplay(value: unknown, options: DateDisplayOptions = {}): string {
  const parts = parseDateTimeParts(value);
  if (!parts) return stringifyValue(value);
  return formatDateParts(parts, shouldShowYear(parts.year, options));
}

export function formatDateTimeValueDisplay(value: unknown, options: DateTimeDisplayOptions = {}): string {
  const parts = parseDateTimeParts(value);
  if (!parts) return stringifyValue(value);
  const date = formatDateParts(parts, shouldShowYear(parts.year, options));
  const time = parts.time || (options.showTimeWhenMissing ? "00:00" : "");
  return time ? `${date} ${time}` : date;
}

export function formatDateRangeDisplay(startValue: unknown, endValue: unknown, options: DateDisplayOptions = {}): string {
  const start = parseDateTimeParts(startValue);
  const end = parseDateTimeParts(endValue);
  if (!start && !end) return "";
  if (!start) return formatDateValueDisplay(endValue, options);
  if (!end) return formatDateValueDisplay(startValue, options);
  const showYear = start.year !== end.year || shouldShowYear(start.year, options) || shouldShowYear(end.year, options);
  const startText = formatDateParts(start, showYear);
  const endText = formatDateParts(end, showYear);
  return startText === endText ? startText : `${startText} - ${endText}`;
}

/** 当天分钟（0–1440）→ "HH:MM"。与 CalendarDateTime.formatCalendarTime 同口径。 */
function formatMinutesAsTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${pad2(hours)}:${pad2(mins)}`;
}

/**
 * 跨天事件的日期范围标签，datetime 事件附加时间部分（D1）。
 *
 * - 两端都无时间分量（纯 date 跨天）→ 纯日期范围（`6月4日 - 6月6日`）。
 * - 任一端有时间分量（datetime 跨天，被强制成 all-day 条）→ 两端各显示「日期 时间」
 *   （`6月4日 09:00 - 6月5日 10:00`），保留 datetime 的时刻信息。
 *
 * @param startTimeMinutes/endTimeMinutes 事件原有的起止时刻（分钟）；date 事件为 undefined。
 */
export function formatDateTimeRangeDisplay(
  startValue: unknown,
  endValue: unknown,
  startTimeMinutes: number | undefined,
  endTimeMinutes: number | undefined,
  options: DateDisplayOptions = {},
): string {
  // 无时间分量 → 直接走纯日期范围
  if (startTimeMinutes == null && endTimeMinutes == null) {
    return formatDateRangeDisplay(startValue, endValue, options);
  }
  const start = parseDateTimeParts(startValue);
  const end = parseDateTimeParts(endValue);
  if (!start && !end) return "";
  const showYear = (!!start && !!end && start.year !== end.year)
    || (start ? shouldShowYear(start.year, options) : false)
    || (end ? shouldShowYear(end.year, options) : false);
  const startDateText = start ? formatDateParts(start, showYear) : "";
  const endDateText = end ? formatDateParts(end, showYear) : "";
  const startFull = startTimeMinutes != null && startDateText ? `${startDateText} ${formatMinutesAsTime(startTimeMinutes)}` : startDateText;
  const endFull = endTimeMinutes != null && endDateText ? `${endDateText} ${formatMinutesAsTime(endTimeMinutes)}` : endDateText;
  if (!startFull || !endFull) return startFull || endFull;
  return startFull === endFull ? startFull : `${startFull} - ${endFull}`;
}

/** 全局日期年份显示策略：always 始终显示（默认）/ smart 当年隐藏 / never 始终隐藏。由视图渲染入口按当前视图的 yearDisplayMode 写入。 */
let dateDisplayMode: "always" | "smart" | "never" = "always";

export function setDateDisplayMode(mode: "always" | "smart" | "never"): void {
  dateDisplayMode = mode;
}

function shouldShowYear(year: number, options: DateDisplayOptions): boolean {
  if (dateDisplayMode === "always") return true;
  if (dateDisplayMode === "never") return false;
  // smart：同年隐藏（不管 mode，让 datetime 也走 yearDisplayMode）。
  const contextYear = options.contextYear ?? new Date().getFullYear();
  return year !== contextYear;
}

function formatDateParts(parts: DateTimeParts, showYear: boolean): string {
  // 人性化 locale 化日期（中文「2026年6月4日」、英文「June 4, 2026」），跟随插件语言。
  const date = new Date(parts.year, Number(parts.month) - 1, Number(parts.day));
  const options: Intl.DateTimeFormatOptions = showYear
    ? { year: "numeric", month: "long", day: "numeric" }
    : { month: "long", day: "numeric" };
  return new Intl.DateTimeFormat(getEffectiveLocale(), options).format(date);
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 把任意日期值归一化为可比较的时间戳（毫秒），供排序、筛选、分组等比较路径统一使用。
 * 时区策略：naive 日期字符串按本地墙上时间解释（纯日期=本地午夜，带时间=本地时分）；
 * 毫秒 number（如 file.ctime）是绝对时间戳直通。
 * 禁止在比较路径裸用 new Date()/Date.parse()/toISOString()。
 */
export function toDateTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const parts = parseDateTimeParts(value);
  if (parts) {
    const hour = parts.time ? Number(parts.time.slice(0, 2)) : 0;
    const minute = parts.time ? Number(parts.time.slice(3, 5)) : 0;
    return new Date(parts.year, Number(parts.month) - 1, Number(parts.day), hour, minute).getTime();
  }
  const text = stringifyValue(value).trim();
  return /^\d+$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}
