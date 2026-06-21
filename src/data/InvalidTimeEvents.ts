import { extractTimelineEndpointMinutes, isInvalidEventRange } from "./CalendarTimelineModel";
import { getColumnDisplayType } from "./ColumnDisplay";
import { parseDateTimeParts } from "./DateTimeFormat";
import { RowData, ViewConfig } from "./types";

/** 一个需要修复的无效时间事件（开始 datetime >= 结束 datetime）。 */
export interface InvalidTimeEventOption {
  row: RowData;
  fileName: string;
  startField: string;
  endField: string;
  /** 当前 frontmatter 值（原始）。 */
  startValue: unknown;
  endValue: unknown;
  /** 对应列是否为纯 date 列（非 datetime）。Modal 据此用 date 输入，避免让用户给 date 列填无意义的时间。 */
  startIsDateOnly: boolean;
  endIsDateOnly: boolean;
}

interface InvalidTimelineScanDeadline {
  timeRemaining(): number;
  didTimeout: boolean;
}

interface InvalidTimelineScanScheduler {
  schedule(callback: (deadline: InvalidTimelineScanDeadline) => void): number;
  cancel(handle: number): void;
  chunkSize?: number;
}

interface InvalidTimelineScanCache {
  key: string;
  options: InvalidTimeEventOption[];
}

interface InvalidTimelinePendingScan {
  key: string;
  runId: number;
  handle: number | null;
  promise: Promise<InvalidTimeEventOption[]>;
  resolve(options: InvalidTimeEventOption[]): void;
}

export interface InvalidTimeEventQuickFix {
  startValue: string;
  endValue: string;
}

/** 判断一对开始/结束值是否构成无效时间区间（复用 isInvalidEventRange 保持单一判定源）。 */
function isNegativeInterval(startValue: unknown, endValue: unknown, startIsDateTime: boolean, endIsDateTime: boolean): boolean {
  const start = parseDateTimeParts(startValue);
  const end = parseDateTimeParts(endValue);
  if (!start || !end) return false;
  const coerceDateOnlyEndpoints = startIsDateTime || endIsDateTime;
  const startMinutes = extractTimelineEndpointMinutes(startValue, { includeDateObjectTime: startIsDateTime, dateOnlyAsMidnight: coerceDateOnlyEndpoints });
  const endMinutes = extractTimelineEndpointMinutes(endValue, { includeDateObjectTime: endIsDateTime, dateOnlyAsMidnight: coerceDateOnlyEndpoints });
  // 委托给 isInvalidEventRange：跨天反向（含纯 date 列）即无效，同天再比时间。
  return isInvalidEventRange({
    startDateKey: start.dateKey,
    endDateKey: end.dateKey,
    startMinutes,
    endMinutes,
  });
}

function isConfiguredDateTimeField(config: ViewConfig, field: string): boolean {
  const column = config.schema.columns.find((candidate) => candidate.key === field);
  if (!column) return false;
  return getColumnDisplayType(column, config.schema.computedFields) === "datetime";
}

/** Convert any supported date/datetime value into a valid datetime-local value. */
export function toTimelineDateTimeInputValue(value: unknown): string {
  const parts = parseDateTimeParts(value);
  if (!parts) return "";
  return `${parts.dateKey}T${parts.time || "00:00"}`;
}

export function getTimelineDateTimeSpanMinutes(startValue: unknown, endValue: unknown): number | null {
  const start = parseDateTimeInput(toTimelineDateTimeInputValue(startValue));
  const end = parseDateTimeInput(toTimelineDateTimeInputValue(endValue));
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

export function getInvalidTimeEventQuickFix(startValue: unknown, endValue: unknown): InvalidTimeEventQuickFix | null {
  const startInput = toTimelineDateTimeInputValue(startValue);
  const endInput = toTimelineDateTimeInputValue(endValue);
  const start = parseDateTimeInput(startInput);
  const end = parseDateTimeInput(endInput);
  if (!start || !end) return null;
  if (start.getTime() > end.getTime()) {
    return { startValue: endInput, endValue: startInput };
  }
  if (start.getTime() < end.getTime()) return null;
  const startParts = parseDateTimeParts(startValue);
  const endParts = parseDateTimeParts(endValue);
  const hasExplicitTime = Boolean(startParts?.time && endParts?.time);
  const fixedEnd = new Date(start.getTime());
  if (hasExplicitTime) fixedEnd.setHours(fixedEnd.getHours() + 1);
  else fixedEnd.setDate(fixedEnd.getDate() + 1);
  return {
    startValue: startInput,
    endValue: formatDateTimeInput(fixedEnd),
  };
}

function parseDateTimeInput(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateTimeInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 收集当前时间线来源范围内、开始 datetime >= 结束 datetime 的无效时间事件。
 * 供 InvalidTimeEventsModal 列出并修复。仅在同时配置了 startField 和 endField 时检测。
 */
export function collectInvalidTimelineEvents(rows: RowData[], config: ViewConfig): InvalidTimeEventOption[] {
  const startField = config.timelineStartDateField || config.calendarStartDateField;
  const endField = config.timelineEndDateField || config.calendarEndDateField;
  if (!startField || !endField) return [];
  const startIsDateTime = isConfiguredDateTimeField(config, startField);
  const endIsDateTime = isConfiguredDateTimeField(config, endField);
  const result: InvalidTimeEventOption[] = [];
  for (const row of rows) {
    const startValue = row.frontmatter[startField];
    const endValue = row.frontmatter[endField];
    if (isNegativeInterval(startValue, endValue, startIsDateTime, endIsDateTime)) {
      result.push({
        row,
        fileName: row.file.name,
        startField,
        endField,
        startValue,
        endValue,
        startIsDateOnly: !startIsDateTime,
        endIsDateOnly: !endIsDateTime,
      });
    }
  }
  return result;
}

export class InvalidTimelineEventsScanner {
  private cache: InvalidTimelineScanCache | null = null;
  private pending: InvalidTimelinePendingScan | null = null;
  private nextRunId = 1;
  private readonly chunkSize: number;

  constructor(private scheduler: InvalidTimelineScanScheduler = createDefaultInvalidTimelineScheduler()) {
    this.chunkSize = Math.max(1, Math.round(scheduler.chunkSize ?? 100));
  }

  getCachedOptions(rows: RowData[], config: ViewConfig, rowsVersion: number): InvalidTimeEventOption[] | null {
    const key = getInvalidTimelineScanKey(config, rowsVersion);
    return this.cache?.key === key ? this.cache.options : null;
  }

  getOptions(rows: RowData[], config: ViewConfig, rowsVersion: number): Promise<InvalidTimeEventOption[]> {
    const key = getInvalidTimelineScanKey(config, rowsVersion);
    if (this.cache?.key === key) return Promise.resolve(this.cache.options);
    if (this.pending?.key === key) return this.pending.promise;
    this.cancelPending();

    const startField = config.timelineStartDateField || config.calendarStartDateField;
    const endField = config.timelineEndDateField || config.calendarEndDateField;
    if (!startField || !endField) {
      const options: InvalidTimeEventOption[] = [];
      this.cache = { key, options };
      return Promise.resolve(options);
    }

    const startIsDateTime = isConfiguredDateTimeField(config, startField);
    const endIsDateTime = isConfiguredDateTimeField(config, endField);
    const runId = this.nextRunId++;
    let resolvePromise!: (options: InvalidTimeEventOption[]) => void;
    const promise = new Promise<InvalidTimeEventOption[]>((resolve) => {
      resolvePromise = resolve;
    });
    const pending: InvalidTimelinePendingScan = {
      key,
      runId,
      handle: null,
      promise,
      resolve: resolvePromise,
    };
    this.pending = pending;

    const options: InvalidTimeEventOption[] = [];
    let index = 0;
    const finish = () => {
      if (this.pending?.runId !== runId) return;
      this.cache = { key, options };
      this.pending = null;
      pending.resolve(options);
    };
    const scan = (deadline: InvalidTimelineScanDeadline) => {
      if (this.pending?.runId !== runId) return;
      pending.handle = null;
      let processed = 0;
      while (index < rows.length) {
        const row = rows[index++];
        if (row) {
          const startValue = row.frontmatter[startField];
          const endValue = row.frontmatter[endField];
          if (isNegativeInterval(startValue, endValue, startIsDateTime, endIsDateTime)) {
            options.push({
              row,
              fileName: row.file.name,
              startField,
              endField,
              startValue,
              endValue,
              startIsDateOnly: !startIsDateTime,
              endIsDateOnly: !endIsDateTime,
            });
          }
        }
        processed += 1;
        if (processed >= this.chunkSize) break;
        if (!deadline.didTimeout && deadline.timeRemaining() <= 1) break;
      }
      if (index >= rows.length) {
        finish();
        return;
      }
      pending.handle = this.scheduler.schedule(scan);
    };

    pending.handle = this.scheduler.schedule(scan);
    return promise;
  }

  clear(): void {
    this.cancelPending();
    this.cache = null;
  }

  private cancelPending(): void {
    const pending = this.pending;
    if (!pending) return;
    if (pending.handle != null) this.scheduler.cancel(pending.handle);
    this.pending = null;
    pending.resolve([]);
  }
}

function getInvalidTimelineScanKey(config: ViewConfig, rowsVersion: number): string {
  const startField = config.timelineStartDateField || config.calendarStartDateField || "";
  const endField = config.timelineEndDateField || config.calendarEndDateField || "";
  return [
    config.id || config.name || "",
    rowsVersion,
    startField,
    endField,
    getTimelineFieldDisplayType(config, startField),
    getTimelineFieldDisplayType(config, endField),
  ].join("\u0000");
}

function getTimelineFieldDisplayType(config: ViewConfig, field: string): string {
  if (!field) return "";
  const column = config.schema.columns.find((candidate) => candidate.key === field);
  return column ? getColumnDisplayType(column, config.schema.computedFields) : "";
}

function createDefaultInvalidTimelineScheduler(): InvalidTimelineScanScheduler {
  const requestIdle = window.requestIdleCallback?.bind(window);
  const cancelIdle = window.cancelIdleCallback?.bind(window);
  if (requestIdle && cancelIdle) {
    return {
      schedule: (callback) => requestIdle(callback, { timeout: 120 }),
      cancel: (handle) => cancelIdle(handle),
    };
  }
  // requestIdleCallback 不可用时退化为 setTimeout（Obsidian 运行在 window 环境，无需 globalThis 兜底）
  return {
    schedule: (callback) => window.setTimeout(() => callback({ timeRemaining: () => 0, didTimeout: true }), 0),
    cancel: (handle) => window.clearTimeout(handle),
  };
}
