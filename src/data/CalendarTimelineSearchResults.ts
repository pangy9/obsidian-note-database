import {
  buildCalendarTimelineEvents,
  CalendarTimelineEvent,
  getDefaultEventDateField,
} from "./CalendarTimelineModel";
import { addDateKeyDays, dateKeyDaysBetween, MINUTES_PER_DAY } from "./CalendarDateTime";
import { formatDateTimeRangeDisplay } from "./DateTimeFormat";
import { RowData, ViewConfig } from "./types";

export interface CalendarTimelineSearchVisibleRange {
  startDateKey: string;
  endDateKey: string;
  /** Inclusive start minute on startDateKey. */
  startMinutes?: number;
  /** Exclusive end minute on endDateKey. */
  endMinutes?: number;
}

export interface CalendarTimelineSearchResultItem {
  filePath: string;
  title: string;
  startDateKey: string;
  endDateKey: string;
  startMinutes?: number;
  endMinutes?: number;
  endIsDateOnly?: boolean;
  inCurrentRange: boolean;
}

export interface CalendarTimelineSearchResults {
  totalCount: number;
  visibleCount: number;
  items: CalendarTimelineSearchResultItem[];
}

export function buildCalendarTimelineSearchResults(
  rows: RowData[],
  config: ViewConfig,
  visibleRange: CalendarTimelineSearchVisibleRange | null,
): CalendarTimelineSearchResults {
  const events = buildCalendarTimelineEvents(rows, config, {
    startField: getSearchStartField(config),
    endField: getSearchEndField(config),
    titleField: getSearchTitleField(config),
    colorField: getSearchColorField(config),
  })
    .filter((event) => !event.isInvalid)
    .sort(compareSearchEvents);

  const items = events.map((event) => toSearchResultItem(event, visibleRange));
  return {
    totalCount: items.length,
    visibleCount: items.filter((item) => item.inCurrentRange).length,
    items,
  };
}

export function formatCalendarTimelineSearchResultDate(item: CalendarTimelineSearchResultItem): string {
  return formatDateTimeRangeDisplay(
    item.startDateKey,
    item.endDateKey,
    item.startMinutes,
    item.endMinutes,
  );
}

function getSearchStartField(config: ViewConfig): string | undefined {
  return config.viewType === "timeline"
    ? config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config)
    : config.calendarStartDateField || getDefaultEventDateField(config);
}

function getSearchEndField(config: ViewConfig): string | undefined {
  return config.viewType === "timeline"
    ? config.timelineEndDateField || config.calendarEndDateField
    : config.calendarEndDateField;
}

function getSearchTitleField(config: ViewConfig): string | undefined {
  return config.viewType === "timeline"
    ? config.timelineTitleField
    : config.calendarTitleField;
}

function getSearchColorField(config: ViewConfig): string | undefined {
  return config.viewType === "timeline"
    ? config.timelineColorField || config.calendarColorField
    : config.calendarColorField;
}

function toSearchResultItem(
  event: CalendarTimelineEvent,
  visibleRange: CalendarTimelineSearchVisibleRange | null,
): CalendarTimelineSearchResultItem {
  return {
    filePath: event.filePath,
    title: event.title,
    startDateKey: event.startDateKey,
    endDateKey: event.endDateKey,
    startMinutes: event.startMinutes,
    endMinutes: event.endMinutes,
    endIsDateOnly: event.endIsDateOnly,
    inCurrentRange: visibleRange ? eventIntersectsVisibleRange(event, visibleRange) : false,
  };
}

function eventIntersectsVisibleRange(event: CalendarTimelineEvent, range: CalendarTimelineSearchVisibleRange): boolean {
  const rangeStart = range.startMinutes ?? 0;
  const rangeEndDayOffset = dateKeyDaysBetween(range.startDateKey, range.endDateKey);
  if (rangeEndDayOffset == null) return false;
  const rangeEnd = range.endMinutes != null
    ? rangeEndDayOffset * MINUTES_PER_DAY + range.endMinutes
    : (rangeEndDayOffset + 1) * MINUTES_PER_DAY;

  const eventStartDayOffset = dateKeyDaysBetween(range.startDateKey, event.startDateKey);
  const eventEndDayOffset = dateKeyDaysBetween(range.startDateKey, event.endDateKey);
  if (eventStartDayOffset == null || eventEndDayOffset == null) return false;
  const eventStart = eventStartDayOffset * MINUTES_PER_DAY + (event.startMinutes ?? 0);
  const eventEnd = event.endIsDateOnly
    ? (eventEndDayOffset + 1) * MINUTES_PER_DAY
    : eventEndDayOffset * MINUTES_PER_DAY + (event.endMinutes ?? MINUTES_PER_DAY);
  return eventStart < rangeEnd && eventEnd > rangeStart;
}

function compareSearchEvents(a: CalendarTimelineEvent, b: CalendarTimelineEvent): number {
  return a.startDateKey.localeCompare(b.startDateKey)
    || (a.startMinutes ?? -1) - (b.startMinutes ?? -1)
    || a.title.localeCompare(b.title)
    || a.filePath.localeCompare(b.filePath);
}

export function timelineHourRange(startDateKey: string, startMinutes: number, durationHours: number): CalendarTimelineSearchVisibleRange {
  const totalMinutes = startMinutes + Math.max(1, Math.round(durationHours)) * 60;
  return {
    startDateKey,
    endDateKey: addDateKeyDays(startDateKey, Math.floor(totalMinutes / MINUTES_PER_DAY)),
    startMinutes,
    endMinutes: totalMinutes % MINUTES_PER_DAY,
  };
}
