import { setIcon } from "obsidian";
import { addDateKeyDays, dateKeyDaysBetween } from "../data/CalendarDateTime";
import { CalendarDayModel } from "../data/CalendarTimelineModel";
import { parseDateTimeParts } from "../data/DateTimeFormat";
import { RowData, ViewConfig } from "../data/types";
import { getEffectiveLocale, t } from "../i18n";

export type MiniCalendarMode = "day" | "month" | "year";

export interface MiniCalendarEventIndex {
  dateKeys: Set<string>;
  monthKeys: Set<string>;
  yearKeys: Set<string>;
}

export interface MiniCalendarEventIndexOptions {
  rows: RowData[];
  config: ViewConfig;
  startField: string;
  endField?: string;
}

export interface MiniCalendarOptions {
  popover: HTMLElement;
  mode: MiniCalendarMode;
  monthKey: string;
  monthTitle: string;
  visibleYear: number;
  yearRangeStart: number;
  weeks: CalendarDayModel[][];
  weekdays: string[];
  todayKey: string;
  selectedKeys: Set<string>;
  eventIndex: MiniCalendarEventIndex;
  onPrevious(): void;
  onNext(): void;
  onTitleClick(): void;
  onSelectDate(dateKey: string): void;
  onSelectMonth(monthKey: string): void;
  onSelectYear(year: number): void;
  onSelectToday(todayKey: string): void;
}

export function buildMiniCalendarEventIndex(options: MiniCalendarEventIndexOptions): MiniCalendarEventIndex {
  const index: MiniCalendarEventIndex = {
    dateKeys: new Set(),
    monthKeys: new Set(),
    yearKeys: new Set(),
  };
  if (!options.startField) return index;
  for (const row of options.rows) {
    const start = parseDateTimeParts(getMiniCalendarFieldValue(row, options.startField, options.config))?.dateKey;
    if (!start) continue;
    const endValue = options.endField ? getMiniCalendarFieldValue(row, options.endField, options.config) : undefined;
    const parsedEnd = options.endField ? parseDateTimeParts(endValue)?.dateKey : undefined;
    const end = parsedEnd && parsedEnd >= start ? parsedEnd : start;
    addDateRangeToIndex(index, start, end);
  }
  return index;
}

export function renderMiniCalendar(options: MiniCalendarOptions): void {
  const { popover } = options;
  popover.empty();

  const head = popover.createDiv({ cls: "db-calendar-mini-head" });
  const prevBtn = head.createEl("button", {
    cls: "db-calendar-mini-nav",
    attr: { type: "button", "aria-label": getPreviousLabel(options.mode) },
  });
  setIcon(prevBtn, "chevron-left");
  prevBtn.onclick = (event) => {
    event.stopPropagation();
    options.onPrevious();
  };

  const title = head.createEl("button", {
    cls: "db-calendar-mini-title db-calendar-mini-title-button",
    text: getMiniCalendarTitle(options),
    attr: { type: "button" },
  });
  title.onclick = (event) => {
    event.stopPropagation();
    options.onTitleClick();
  };

  const nextBtn = head.createEl("button", {
    cls: "db-calendar-mini-nav",
    attr: { type: "button", "aria-label": getNextLabel(options.mode) },
  });
  setIcon(nextBtn, "chevron-right");
  nextBtn.onclick = (event) => {
    event.stopPropagation();
    options.onNext();
  };

  if (options.mode === "day") {
    renderMiniCalendarDayGrid(options);
  } else if (options.mode === "month") {
    renderMiniCalendarMonthGrid(options);
  } else {
    renderMiniCalendarYearGrid(options);
  }

  const footer = popover.createDiv({ cls: "db-calendar-mini-footer" });
  const todayKey = options.todayKey;
  const today = footer.createEl("button", {
    cls: "db-calendar-mini-today",
    text: t("calendar.today"),
    attr: { type: "button" },
  });
  today.onclick = (event) => {
    event.stopPropagation();
    options.onSelectToday(todayKey);
  };
}

function renderMiniCalendarDayGrid(options: MiniCalendarOptions): void {
  const weekdayRow = options.popover.createDiv({ cls: "db-calendar-mini-weekdays" });
  for (const label of options.weekdays) {
    weekdayRow.createDiv({ cls: "db-calendar-mini-weekday", text: label });
  }

  const grid = options.popover.createDiv({ cls: "db-calendar-mini-grid" });
  for (const week of options.weeks) {
    for (const day of week) {
      const hasEvents = options.eventIndex.dateKeys.has(day.dateKey) || day.events.length > 0;
      const cell = grid.createEl("button", {
        cls: [
          "db-calendar-mini-day",
          day.inCurrentMonth ? "" : "is-outside",
          day.dateKey === options.todayKey ? "is-today" : "",
          options.selectedKeys.has(day.dateKey) ? "is-selected" : "",
          hasEvents ? "has-events" : "",
        ].filter(Boolean).join(" "),
        attr: { type: "button", "data-date-key": day.dateKey, title: day.dateKey },
      });
      cell.createSpan({ cls: "db-calendar-mini-day-num", text: String(Number(day.dateKey.slice(8, 10))) });
      cell.createSpan({ cls: "db-calendar-mini-day-dot" });
      cell.onclick = (event) => {
        event.stopPropagation();
        options.onSelectDate(day.dateKey);
      };
    }
  }
}

function renderMiniCalendarMonthGrid(options: MiniCalendarOptions): void {
  const grid = options.popover.createDiv({ cls: "db-calendar-mini-view-grid is-month-grid" });
  const eventIndex = options.eventIndex;
  const selectedMonth = getSelectedMonthKey(options);
  for (let month = 0; month < 12; month++) {
    const monthKey = `${String(options.visibleYear).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
    const hasEvents = eventIndex.monthKeys.has(monthKey);
    const cell = grid.createEl("button", {
      cls: [
        "db-calendar-mini-view-cell",
        selectedMonth === monthKey ? "is-selected" : "",
        options.todayKey.startsWith(monthKey) ? "is-today" : "",
        hasEvents ? "has-events" : "",
      ].filter(Boolean).join(" "),
      attr: { type: "button", "data-month-key": monthKey, title: monthKey },
    });
    cell.createSpan({ cls: "db-calendar-mini-view-label", text: getMonthLabel(options.visibleYear, month) });
    cell.createSpan({ cls: "db-calendar-mini-view-dot" });
    cell.onclick = (event) => {
      event.stopPropagation();
      options.onSelectMonth(monthKey);
    };
  }
}

function renderMiniCalendarYearGrid(options: MiniCalendarOptions): void {
  const grid = options.popover.createDiv({ cls: "db-calendar-mini-view-grid is-year-grid" });
  const eventIndex = options.eventIndex;
  const selectedYear = getSelectedYear(options);
  for (let offset = 0; offset < 12; offset++) {
    const year = options.yearRangeStart + offset;
    const yearKey = String(year);
    const hasEvents = eventIndex.yearKeys.has(String(year));
    const cell = grid.createEl("button", {
      cls: [
        "db-calendar-mini-view-cell",
        selectedYear === year ? "is-selected" : "",
        options.todayKey.startsWith(yearKey) ? "is-today" : "",
        hasEvents ? "has-events" : "",
      ].filter(Boolean).join(" "),
      attr: { type: "button", "data-year": yearKey, title: yearKey },
    });
    cell.createSpan({ cls: "db-calendar-mini-view-label", text: yearKey });
    cell.createSpan({ cls: "db-calendar-mini-view-dot" });
    cell.onclick = (event) => {
      event.stopPropagation();
      options.onSelectYear(year);
    };
  }
}

function addDateRangeToIndex(index: MiniCalendarEventIndex, start: string, end: string): void {
  const span = dateKeyDaysBetween(start, end);
  const totalDays = span == null ? 0 : Math.max(0, Math.min(span, 3660));
  for (let offset = 0; offset <= totalDays; offset++) {
    const dateKey = addDateKeyDays(start, offset);
    addDateKeyToIndex(index, dateKey);
  }
  if (span != null && span > totalDays) addDateKeyToIndex(index, end);
}

function addDateKeyToIndex(index: MiniCalendarEventIndex, dateKey: string): void {
  index.dateKeys.add(dateKey);
  index.monthKeys.add(dateKey.slice(0, 7));
  index.yearKeys.add(dateKey.slice(0, 4));
}

function getMiniCalendarFieldValue(row: RowData, field: string, config: ViewConfig): unknown {
  switch (field) {
    case "file.ctime":
    case "file.created":
      return row.file.stat.ctime;
    case "file.mtime":
    case "file.modified":
      return row.file.stat.mtime;
    default:
      break;
  }
  const column = config.schema.columns.find((col) => col.key === field);
  if (column?.type === "computed") return row.computed[column.computedKey || column.key];
  return row.frontmatter[field];
}

function getMiniCalendarTitle(options: MiniCalendarOptions): string {
  if (options.mode === "month") return String(options.visibleYear);
  if (options.mode === "year") return `${options.yearRangeStart}–${options.yearRangeStart + 11}`;
  return options.monthTitle;
}

function getSelectedMonthKey(options: MiniCalendarOptions): string {
  const selected = Array.from(options.selectedKeys)[0];
  return selected?.slice(0, 7) || options.monthKey;
}

function getSelectedYear(options: MiniCalendarOptions): number {
  const selected = Array.from(options.selectedKeys)[0];
  const year = Number(selected?.slice(0, 4));
  return Number.isFinite(year) ? year : options.visibleYear;
}

function getMonthLabel(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat(getEffectiveLocale(), { month: "short" }).format(new Date(year, monthIndex, 1));
}

function getPreviousLabel(mode: MiniCalendarMode): string {
  if (mode === "month") return t("calendar.prevYear");
  if (mode === "year") return t("calendar.prevYearRange");
  return t("calendar.prevMonth");
}

function getNextLabel(mode: MiniCalendarMode): string {
  if (mode === "month") return t("calendar.nextYear");
  if (mode === "year") return t("calendar.nextYearRange");
  return t("calendar.nextMonth");
}
