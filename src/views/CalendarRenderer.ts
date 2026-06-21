import { Menu, setIcon } from "obsidian";
import {
	buildCalendarMonthWeekLayouts,
	buildCalendarTimedEventLayouts,
	buildCalendarWeekAllDayLayout,
	CalendarMonthSegment,
	CalendarMonthWeekLayout,
	CalendarTimedEventLayout,
	formatCalendarTime,
	getCalendarEventTiming,
	getCalendarHourHeight,
	getCalendarSlotDuration,
	getCalendarVisibleHourRange,
	EVENT_CARD_MIN_HEIGHT,
} from "../data/CalendarLayoutModel";
import { CalendarTitleParts, formatCalendarTitleParts } from "../data/CalendarTitleFormatter";
import { buildCalendarMonthModel, CalendarDayModel, CalendarTimelineEvent, getCalendarAnchorMonth, getDefaultEventDateField, shiftCalendarMonth } from "../data/CalendarTimelineModel";
import {
	CALENDAR_TIME_SNAP_MINUTES,
	addDateKeyDays,
	dateKeyDaysBetween,
	dateKeyFromUtc,
	getLocalDateKey,
	getLocaleWeekStartsOn,
	getWeekdayLabels,
	monthKeyFromLocalDate,
	parseDateKeyToUtc,
	snapMinutes,
} from "../data/CalendarDateTime";
import { CalendarEventCreateOptions, CalendarEventDateChange, resolveAllDayResizeChange, resolveDayMoveChange, resolveDayRangeResize, resolveTimedDragRange } from "../data/CalendarInteractionModel";
import { formatDateTimeRangeDisplay, formatDateValueDisplay, parseDateTimeParts } from "../data/DateTimeFormat";
import { ColumnDef, RowData, ViewConfig } from "../data/types";
import { getEffectiveLocale, t } from "../i18n";
import { openDropdownMenu } from "./DropdownField";
import { buildMiniCalendarEventIndex, MiniCalendarMode, renderMiniCalendar } from "./CalendarMiniCalendarRenderer";

const TIME_SNAP_MINUTES = CALENDAR_TIME_SNAP_MINUTES;
const TIMED_EVENT_TIME_VISIBILITY_HEIGHT = 42;

export interface CalendarRendererActions {
	openRow(row: RowData): void;
	showRowMenu?(event: MouseEvent, row: RowData): void;
	createEntryForDate?(config: ViewConfig, dateKey: string, timeRange?: CalendarCreateTimeRange): void;
	updateEventDates?(row: RowData, changes: CalendarEventDateChange): void | Promise<void>;
	updateCalendarScale?(scale: "month" | "week" | "day", anchorDateKey: string, label?: string): void;
	onConfigChange?(label?: string): void;
	getColumns(config: ViewConfig): ColumnDef[];
	/** 统计被隐藏的无效时间事件数（A2：日历也接入 invalid 修复入口）。 */
	getCalendarInvalidEventCount?(): number | Promise<number>;
	/** 打开无效时间事件修复弹窗。 */
	openCalendarInvalidEvents?(): void;
	readonly isReadOnly?: boolean;
}

export type CalendarCreateTimeRange = CalendarEventCreateOptions;

interface TimeGridMetrics {
	startMinutes: number;
	endMinutes: number;
	hourHeight: number;
	gridHeight: number;
}

type TimedDragMode = "move" | "resize-start" | "resize-end";

export class CalendarRenderer {
	private rowByPath = new Map<string, RowData>();
	private currentTimeTimer: number | null = null;
	private currentRows: RowData[] = [];
	private miniCalendarEl: HTMLElement | null = null;
	/** 最近一次 invalid 事件计数（cache miss 时沿用，避免 ⚠️ 按钮闪现）。 */
	private calendarInvalidWarningCount: number | null = null;
	private miniCalendarMonth: string | null = null;
	private miniCalendarMode: MiniCalendarMode = "day";
	private miniCalendarCleanup: (() => void) | null = null;
	private calendarScaleMenuCleanup: (() => void) | null = null;
	private pendingFlashDateKey: string | null = null;
	private calendarRoot: HTMLElement | null = null;

	constructor(private actions: CalendarRendererActions) {}

	render(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
		this.cleanupCurrentTimeTimer();
		this.closeMiniCalendar();
		this.closeCalendarScaleMenu();
		this.calendarRoot = null;
		this.currentRows = rows;
		this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));
		const scale = config.calendarScale || "month";
		if (scale === "day") {
			this.renderDay(container, config, rows);
		} else if (scale === "week") {
			this.renderWeek(container, config, rows);
		} else {
			this.renderMonth(container, config, rows);
		}
		// After a mini-calendar jump, briefly highlight the target day column.
		if (this.pendingFlashDateKey) {
			const key = this.pendingFlashDateKey;
			this.pendingFlashDateKey = null;
			window.requestAnimationFrame(() => this.flashDayColumn(key));
		}
	}

	private renderMonth(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
		const startField = config.calendarStartDateField || getDefaultEventDateField(config);
		if (!startField) {
			this.renderEmpty(container, "calendar.noDateField");
			return;
		}

		const anchor = getCalendarAnchorMonth(rows, config, startField);
		const weekStartsOn = this.getLocaleWeekStartsOn(config);
		const model = buildCalendarMonthModel(
			rows,
			{ ...config, calendarStartDateField: startField },
			anchor,
			{ weekStartsOn },
		);
		const hasEvents = model.days.some((day) => day.events.length > 0);
		if (!hasEvents && !config.calendarMonth) {
			this.renderEmpty(container, "calendar.noEvents");
			return;
		}

		const wrap = container.createDiv({ cls: "db-calendar db-calendar-month" });
		this.calendarRoot = wrap;
		this.applyMonthSizingVars(wrap, config);
		this.renderMonthHeader(wrap, config, model);
		this.renderWeekdayLabels(wrap, config, weekStartsOn);

		const grid = wrap.createDiv({ cls: "db-calendar-grid db-calendar-month-grid" });
		const layouts = buildCalendarMonthWeekLayouts(model.weeks, config);
		const todayKey = this.getTodayDateKey();
		for (const layout of layouts) {
			this.renderMonthWeek(grid, config, layout, todayKey);
		}
	}

	private renderMonthWeek(parent: HTMLElement, config: ViewConfig, layout: CalendarMonthWeekLayout, todayKey: string): void {
		const weekEl = parent.createDiv({
			cls: "db-calendar-month-week",
			attr: { "data-week-index": String(layout.weekIndex) },
		});
		const rowHeight = this.getRowHeight(config, layout.weekIndex);
		const laneLimit = this.getMonthVisibleLaneLimit(config);
		const hasOverflow = layout.segments.some((s) => s.lane >= laneLimit);
		// Reserve one lane for the "more events" button when overflowing
		const reservedLanes = hasOverflow ? laneLimit - 1 : laneLimit;
		const visibleRowCount = Math.max(1, Math.min(layout.rowCount, reservedLanes));
		// Total lane rows: visible event lanes + (overflow button row if needed)
		const totalLaneRows = visibleRowCount + (hasOverflow ? 1 : 0);

		// Single grid: heading row (28px) + lane rows (22px each)
		weekEl.style.gridTemplateRows = `28px repeat(${totalLaneRows}, minmax(22px, 1fr))`;

		const neededHeight = 30 + totalLaneRows * 24 + 10;
		weekEl.style.setProperty("--db-calendar-month-week-min-height", `${Math.max(rowHeight || 0, neededHeight, this.getCellMinHeight(config))}px`);

		const dayCells: HTMLElement[] = [];
		for (let dayIndex = 0; dayIndex < layout.days.length; dayIndex++) {
			const day = layout.days[dayIndex];
			const cell = weekEl.createDiv({
				cls: [
					"db-calendar-day",
					day.inCurrentMonth ? "" : "is-outside-month",
					day.dateKey === todayKey ? "is-today" : "",
				].filter(Boolean).join(" "),
				attr: { "data-date-key": day.dateKey },
			});
			// Explicit grid placement: column index + span all rows as background
			cell.style.gridColumn = String(dayIndex + 1);
			this.renderDayHeading(cell, config, day.dateKey);
			dayCells.push(cell);
		}

		// Segments are placed directly in the week grid (no separate overlay layer)
		this.renderMonthSegments(weekEl, config, layout, visibleRowCount);

		// Overflow buttons sit in the last lane row, inside the day cell area
		this.renderMonthOverflowButtons(weekEl, config, layout, visibleRowCount, dayCells, totalLaneRows + 1);
	}

	private renderMonthSegments(weekEl: HTMLElement, config: ViewConfig, layout: CalendarMonthWeekLayout, laneLimit: number): void {
		// Segments are direct children of the week grid, sharing the same columns as day cells
		for (const segment of layout.segments) {
			if (segment.lane >= laneLimit) continue;
			const eventEl = weekEl.createEl("button", {
				cls: [
					"db-calendar-month-segment",
					segment.isTimed ? "is-timed" : "is-all-day",
					segment.isStart ? "is-start" : "is-continuation",
					segment.isEnd ? "is-end" : "continues-after",
				].join(" "),
				attr: {
					type: "button",
					title: this.getSegmentTitle(segment),
					"data-note-database-row-path": segment.event.row.file.path,
				},
			});
			eventEl.style.setProperty("--db-calendar-segment-start", String(segment.startDayIndex + 1));
			eventEl.style.setProperty("--db-calendar-segment-span", String(segment.spanDays));
			// +2 offset: +1 for heading row, +1 for 1-based grid index
			eventEl.style.setProperty("--db-calendar-segment-lane", String(segment.lane + 2));
			this.applyEventColor(eventEl, segment.event.color);
			if (segment.isTimed) {
				eventEl.createSpan({ cls: "db-calendar-month-timed-dot" });
				if (segment.startMinutes != null) {
					eventEl.createSpan({ cls: "db-calendar-month-time", text: formatCalendarTime(segment.startMinutes) });
				}
			}
			eventEl.createSpan({ cls: "db-calendar-month-title", text: segment.event.title });
			// Show the start–end date range on multi-day all-day segments so a spanning
			// event reads as a date range rather than just a title bar.
			if (!segment.isTimed && segment.event.endDateKey > segment.event.startDateKey) {
				eventEl.createSpan({ cls: "db-calendar-month-dates", text: this.formatMonthDateRange(segment.event.startDateKey, segment.event.endDateKey, segment.event.startMinutes, segment.event.endMinutes) });
			}
			this.attachEventOpenHandlers(eventEl, segment.event);
			this.attachMonthMoveHandler(eventEl, weekEl, layout.days, segment, config, ".db-calendar-month-week", ".db-calendar-day", 7);
			// Left/right resize grab zones for month segments when an end-date field
			// exists. Only real start/end edges are resizable: a segment
			// carried over from the previous week exposes only its trailing edge, and
			// one that continues past this week only its leading edge.
			if (!this.actions.isReadOnly && this.actions.updateEventDates && config.calendarEndDateField) {
				if (segment.isStart) this.attachMonthResizeHandle(eventEl, weekEl, layout.days, segment, config, "resize-start", ".db-calendar-month-week", ".db-calendar-day", 7);
				if (segment.isEnd) this.attachMonthResizeHandle(eventEl, weekEl, layout.days, segment, config, "resize-end", ".db-calendar-month-week", ".db-calendar-day", 7);
			}
		}
	}

	private renderMonthOverflowButtons(weekEl: HTMLElement, config: ViewConfig, layout: CalendarMonthWeekLayout, laneLimit: number, dayCells: HTMLElement[], gridRow: number): void {
		for (let dayIndex = 0; dayIndex < layout.days.length; dayIndex++) {
			const day = layout.days[dayIndex];
			const hiddenEvents = layout.segments
				.filter((segment) => segment.lane >= laneLimit && segment.startDayIndex <= dayIndex && segment.endDayIndex >= dayIndex)
				.map((segment) => segment.event);
			if (hiddenEvents.length === 0) continue;
			const dayCell = dayCells[dayIndex];
			const button = weekEl.createDiv({
				cls: "db-calendar-more-events",
				text: t("calendar.moreEvents", { count: hiddenEvents.length }),
				attr: { title: t("calendar.moreEventsTitle", { count: hiddenEvents.length, date: day.dateKey }) },
			});
			// Place inside the day cell area, in the reserved last lane row
			button.style.gridColumn = String(dayIndex + 1);
			button.style.gridRow = String(gridRow);

			// Hover to show expanded popover anchored to the day cell.
			// The popover sits above the button (z-index), so the button's
			// mouseleave and the popover's hover must share one hide timer to
			// avoid a show/hide flicker loop.
			let popover: HTMLElement | null = null;
			let hideTimer: number | null = null;

			const cancelHide = () => {
				if (hideTimer != null) { window.clearTimeout(hideTimer); hideTimer = null; }
			};
			const scheduleHide = () => {
				cancelHide();
				hideTimer = window.setTimeout(() => {
					popover?.addClass("is-hidden");
				}, 160);
			};
			const showPopover = () => {
				cancelHide();
				if (popover) { popover.removeClass("is-hidden"); return; }
				popover = this.createDayPopover(dayCell, config, day, layout, cancelHide, scheduleHide);
			};

			button.addEventListener("mouseenter", showPopover);
			button.addEventListener("mouseleave", scheduleHide);
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				showPopover();
			});
		}
	}

	private createDayPopover(
		dayCell: HTMLElement,
		config: ViewConfig,
		day: CalendarDayModel,
		layout: CalendarMonthWeekLayout,
		cancelHide: () => void,
		scheduleHide: () => void,
	): HTMLElement {
		// Order the popover the same way the collapsed grid stacks events: by lane
		// (the visual top-to-bottom position). A multi-day all-day event can land in
		// a higher lane than a same-day timed event because of lane packing on its
		// earlier days, so sorting by lane keeps the expanded list consistent with
		// the collapsed cell; events outside the layout fall back to view order.
		const laneById = new Map<string, number>();
		for (const segment of layout.segments) laneById.set(segment.event.id, segment.lane);
		const allEvents = this.uniqueEventsForDay(day.events).slice().sort((a, b) => {
			const la = laneById.get(a.id);
			const lb = laneById.get(b.id);
			if (la != null && lb != null) return la - lb;
			if (la != null) return -1;
			if (lb != null) return 1;
			return a.order - b.order;
		});

		// The popover floats over the day cell as an enlarged copy of it
		const popover = dayCell.createDiv({
			cls: "db-calendar-day-popover",
			attr: { "data-date-key": day.dateKey },
		});

		// Day number heading — identical to the real day cell heading
		const heading = popover.createDiv({ cls: "db-calendar-day-heading" });
		heading.createSpan({ cls: "db-calendar-day-number", text: String(Number(day.dateKey.slice(8, 10))) });

		// Events: same visual style as the in-grid month segments, but stacked and full-width
		const list = popover.createDiv({ cls: "db-calendar-day-popover-events" });
		for (const event of allEvents) {
			const timing = getCalendarEventTiming(event, config);
			const eventEl = list.createEl("button", {
				cls: [
					"db-calendar-month-segment",
					timing.isTimed ? "is-timed" : "is-all-day",
					"is-start",
					"is-end",
				].join(" "),
				attr: {
					type: "button",
					title: event.title,
					"data-note-database-row-path": event.row.file.path,
				},
			});
			this.applyEventColor(eventEl, event.color);
			if (timing.isTimed) {
				eventEl.createSpan({ cls: "db-calendar-month-timed-dot" });
				if (timing.startMinutes != null) {
					eventEl.createSpan({ cls: "db-calendar-month-time", text: formatCalendarTime(timing.startMinutes) });
				}
			}
			eventEl.createSpan({ cls: "db-calendar-month-title", text: event.title });
			eventEl.createSpan({ cls: "db-calendar-month-dates", text: this.formatMonthDateRange(event.startDateKey, event.endDateKey, event.startMinutes, event.endMinutes) });
			this.attachEventOpenHandlers(eventEl, event);
		}

		// Hovering the popover cancels the button's pending hide; leaving schedules it.
		// This shares the single hide timer with the trigger button to avoid flicker.
		popover.addEventListener("mouseenter", cancelHide);
		popover.addEventListener("mouseleave", scheduleHide);

		// Close on outside click
		const closeOnOutside = (outsideEvent: MouseEvent) => {
			if (popover.contains(outsideEvent.target as Node)) return;
			popover.addClass("is-hidden");
			window.activeDocument.removeEventListener("click", closeOnOutside, true);
		};
		window.setTimeout(() => window.activeDocument.addEventListener("click", closeOnOutside, true), 0);

		// Keep the popover within the viewport (flip/clamp if it would overflow)
		this.positionDayPopover(popover, dayCell);

		return popover;
	}

	/**
	 * Adjust the popover so it stays inside the calendar container viewport.
	 * The popover is absolutely positioned inside the day cell; we measure after
	 * insertion and add modifier classes / inline offsets to flip or clamp it.
	 */
	private positionDayPopover(popover: HTMLElement, dayCell: HTMLElement): void {
		// Defer to next frame so layout is measurable.
		window.requestAnimationFrame(() => {
			if (!popover.isConnected) return;
			const scroller = dayCell.closest<HTMLElement>(".note-database-container") || window.activeDocument.body;
			const bounds = scroller.getBoundingClientRect();
			const rect = popover.getBoundingClientRect();

			// Horizontal: if it overflows the right edge, anchor to the cell's right side.
			if (rect.right > bounds.right) {
				const overflowRight = rect.right - bounds.right;
				const cellRect = dayCell.getBoundingClientRect();
				// Shift left but never past the container's left edge.
				const maxShift = Math.max(0, cellRect.left - bounds.left + cellRect.width - rect.width);
				popover.style.left = `${Math.min(0, -overflowRight, maxShift) - 8}px`;
			}

			// Vertical: if it overflows the bottom, anchor its bottom to the cell bottom (open upward).
			const updatedRect = popover.getBoundingClientRect();
			if (updatedRect.bottom > bounds.bottom) {
				popover.setCssProps({ top: "auto", bottom: "-1px" });
			}
		});
	}

	private renderWeek(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
		const startField = config.calendarStartDateField || getDefaultEventDateField(config);
		if (!startField) {
			this.renderEmpty(container, "calendar.noDateField");
			return;
		}

		const weekStartsOn = this.getLocaleWeekStartsOn(config);
		const model = buildCalendarMonthModel(
			rows,
			{ ...config, calendarStartDateField: startField },
			getCalendarAnchorMonth(rows, config, startField),
			{ weekStartsOn },
		);
		const weekIndex = this.resolveWeekIndex(config, model);
		const weekDays = model.weeks[weekIndex];
		if (!weekDays || weekDays.length === 0) {
			this.renderEmpty(container, "calendar.noEvents");
			return;
		}

		const wrap = container.createDiv({ cls: "db-calendar db-calendar-week" });
		this.calendarRoot = wrap;
		this.applyTimeGridSizingVars(wrap, config, weekDays.length);
		this.renderWeekHeader(wrap, config, weekDays);
		// Sticky wrapper keeps the day-name row + all-day strip pinned while the
		// time grid scrolls beneath it.
		const sticky = wrap.createDiv({ cls: "db-calendar-week-sticky" });
		this.renderTimeHeaderRow(sticky, wrap, config, weekDays);
		this.renderAllDaySection(sticky, config, weekDays);
		this.renderTimeGrid(wrap, config, weekDays);
	}

	private renderDay(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
		const startField = config.calendarStartDateField || getDefaultEventDateField(config);
		if (!startField) {
			this.renderEmpty(container, "calendar.noDateField");
			return;
		}
		const dayKey = config.calendarDay || config.calendarWeekStart || this.getTodayDateKey();
		const dayDate = parseDateKeyToUtc(dayKey) || new Date();
		const model = buildCalendarMonthModel(
			rows,
			{ ...config, calendarStartDateField: startField },
			{ year: dayDate.getUTCFullYear(), monthIndex: dayDate.getUTCMonth() },
			{ weekStartsOn: this.getLocaleWeekStartsOn(config) },
		);
		const day = model.days.find((item) => item.dateKey === dayKey) || { dateKey: dayKey, inCurrentMonth: true, events: [] };
		const wrap = container.createDiv({ cls: "db-calendar db-calendar-week db-calendar-day-view" });
		this.calendarRoot = wrap;
		this.applyTimeGridSizingVars(wrap, config, 1);
		this.renderDayHeader(wrap, config, day.dateKey);
		const sticky = wrap.createDiv({ cls: "db-calendar-week-sticky" });
		this.renderTimeHeaderRow(sticky, wrap, config, [day]);
		this.renderAllDaySection(sticky, config, [day]);
		this.renderTimeGrid(wrap, config, [day]);
	}

	private renderTimeHeaderRow(parent: HTMLElement, sizingWrap: HTMLElement, config: ViewConfig, days: CalendarDayModel[]): void {
		const row = parent.createDiv({ cls: "db-calendar-time-header-row" });
		row.createDiv({ cls: "db-calendar-time-header-gutter" });
		const daysEl = row.createDiv({ cls: "db-calendar-time-header-days" });
		daysEl.style.setProperty("--db-calendar-time-day-count", String(days.length));
		const todayKey = this.getTodayDateKey();
		for (const day of days) {
			const button = daysEl.createEl("button", {
				cls: `db-calendar-time-header-day${day.dateKey === todayKey ? " is-today" : ""}`,
				attr: { type: "button", title: day.dateKey, "data-date-key": day.dateKey },
			});
			button.createSpan({ cls: "db-calendar-week-day-name", text: this.formatWeekDayName(day.dateKey) });
			this.attachDayViewNavigation(button, config, day.dateKey);
				// Column-width drag handle mirrors the month view. Only for multi-column
				// (week) views — a single day column uses the toolbar slider instead.
			if (!this.actions.isReadOnly && this.actions.onConfigChange && days.length > 1) {
				const resizeHandle = button.createDiv({ cls: "db-calendar-col-resize-handle" });
				this.setupColumnResize(resizeHandle, config, sizingWrap);
			}
		}
	}

	private renderAllDaySection(wrap: HTMLElement, config: ViewConfig, days: CalendarDayModel[]): void {
		const layout = buildCalendarWeekAllDayLayout(days, days.flatMap((day) => day.events), config);
		const totalLanes = Math.max(1, layout.rowCount);
		// Cap visible lanes so a busy all-day strip stays compact; extra events
		// collapse into a "+N" row that expands on hover (mirrors the month view).
		const maxLanes = Math.max(1, Math.min(6, config.calendarAllDayMaxLanes ?? 2));
		const hasOverflow = totalLanes > maxLanes;
		const visibleLanes = hasOverflow ? maxLanes : totalLanes;
		const section = wrap.createDiv({ cls: "db-calendar-week-allday" });
		section.style.setProperty("--db-calendar-allday-rows", String(visibleLanes));
		// 空 gutter 占据 grid 第一列（52px），与下方时间网格的小时列对齐；
		// 不再放标签文字（标签会换行不好看）。
		section.createDiv({ cls: "db-calendar-week-allday-gutter" });

		// Single CSS grid: day columns and event segments share one grid (no overlay layer).
		// Mirrors the month view: day cells span all rows as background, segments are
		// direct children placed by explicit grid-column / grid-row.
		const stage = section.createDiv({ cls: "db-calendar-week-allday-cols" });
		stage.style.setProperty("--db-calendar-time-day-count", String(days.length));
		stage.style.gridTemplateRows = `28px repeat(${visibleLanes + (hasOverflow ? 1 : 0)}, 22px)`;
		const todayKey = this.getTodayDateKey();
		let firstAllDayCol: HTMLElement | null = null;

		for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
			const day = days[dayIndex];
			const col = stage.createDiv({
				cls: `db-calendar-week-allday-col${day.dateKey === todayKey ? " is-today" : ""}${dayIndex === days.length - 1 ? " is-last-col" : ""}`,
				attr: { "data-date-key": day.dateKey },
			});
			if (dayIndex === 0) firstAllDayCol = col;
			col.style.gridColumn = String(dayIndex + 1);
			if (!this.actions.isReadOnly && this.actions.createEntryForDate) {
				col.ondblclick = (event) => {
					if ((event.target as HTMLElement | null)?.closest(".db-calendar-month-segment")) return;
					this.actions.createEntryForDate?.(config, day.dateKey);
				};
			}

			const dateButton = stage.createEl("button", {
				cls: `db-calendar-week-allday-date${day.dateKey === todayKey ? " is-today" : ""}`,
				text: String(Number(day.dateKey.slice(8, 10))),
				attr: { type: "button", title: day.dateKey, "aria-label": day.dateKey },
			});
			dateButton.style.gridColumn = String(dayIndex + 1);
			dateButton.onclick = (event) => {
				event.stopPropagation();
			};
			dateButton.ondblclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.openDayFromTimeHeader(config, day.dateKey);
			};
			dateButton.oncontextmenu = (event) => {
				if (!this.isPhoneLayout()) return;
				event.preventDefault();
				event.stopPropagation();
				this.showDayViewNavigationMenu(event, config, day.dateKey);
			};
		}

		if (layout.segments.length === 0) {
			firstAllDayCol?.createDiv({ cls: "db-calendar-week-allday-empty", text: t("calendar.noAllDayEvents") });
		}

		// Segments are direct children of the grid (no absolute overlay layer).
		// Only the first `visibleLanes` lanes render in-grid; the rest go to overflow.
		for (const segment of layout.segments) {
			if (segment.lane >= visibleLanes) continue;
			const eventEl = stage.createEl("button", {
				cls: [
					"db-calendar-month-segment",
					"db-calendar-week-allday-segment",
					"is-all-day",
					segment.isStart ? "is-start" : "is-continuation",
					segment.isEnd ? "is-end" : "continues-after",
				].join(" "),
				attr: { type: "button", title: this.getSegmentTitle(segment), "data-note-database-row-path": segment.event.row.file.path },
			});
			eventEl.style.setProperty("--db-calendar-segment-start", String(segment.startDayIndex + 1));
			eventEl.style.setProperty("--db-calendar-segment-span", String(segment.spanDays));
			// Row 1 is reserved for the detached day number, so event lanes start at row 2.
			eventEl.style.setProperty("--db-calendar-segment-lane", String(segment.lane + 2));
			this.applyEventColor(eventEl, segment.event.color);
			eventEl.createSpan({ cls: "db-calendar-month-title", text: segment.event.title });
			if (segment.event.endDateKey > segment.event.startDateKey) {
				eventEl.createSpan({ cls: "db-calendar-month-dates", text: this.formatMonthDateRange(segment.event.startDateKey, segment.event.endDateKey, segment.event.startMinutes, segment.event.endMinutes) });
			}
			this.attachEventOpenHandlers(eventEl, segment.event);
			this.attachMonthMoveHandler(eventEl, stage, days, segment, config, ".db-calendar-week-allday-cols", ".db-calendar-week-allday-col", days.length);
			if (!this.actions.isReadOnly && this.actions.updateEventDates && config.calendarEndDateField) {
				if (segment.isStart) this.attachMonthResizeHandle(eventEl, stage, days, segment, config, "resize-start", ".db-calendar-week-allday-cols", ".db-calendar-week-allday-col", days.length);
				if (segment.isEnd) this.attachMonthResizeHandle(eventEl, stage, days, segment, config, "resize-end", ".db-calendar-week-allday-cols", ".db-calendar-week-allday-col", days.length);
			}
		}

		// Overflow: each day column with hidden events gets its own "+N" link in the
		// reserved row, expanding on hover to that day's collapsed events.
		if (hasOverflow) {
			for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
				const hiddenSegments = layout.segments.filter((segment) => segment.lane >= visibleLanes && segment.startDayIndex <= dayIndex && segment.endDayIndex >= dayIndex);
				if (hiddenSegments.length === 0) continue;
				const hiddenEvents = this.uniqueEventsForDay(hiddenSegments.map((segment) => segment.event))
					.slice().sort((a, b) => a.order - b.order);
				const day = days[dayIndex];
				const button = stage.createDiv({
					cls: "db-calendar-week-allday-more",
					text: t("calendar.moreEvents", { count: hiddenEvents.length }),
					attr: { title: t("calendar.moreEventsTitle", { count: hiddenEvents.length, date: day.dateKey }) },
				});
				button.style.gridColumn = String(dayIndex + 1);
				button.style.gridRow = String(visibleLanes + 2);

				let popover: HTMLElement | null = null;
				let hideTimer: number | null = null;
				const cancelHide = () => { if (hideTimer != null) { window.clearTimeout(hideTimer); hideTimer = null; } };
				const scheduleHide = () => {
					cancelHide();
					hideTimer = window.setTimeout(() => { popover?.addClass("is-hidden"); }, 160);
				};
				const showPopover = () => {
					cancelHide();
					if (popover) { popover.removeClass("is-hidden"); return; }
					popover = this.createAllDayOverflowPopover(button, hiddenEvents, cancelHide, scheduleHide);
				};
				button.addEventListener("mouseenter", showPopover);
				button.addEventListener("mouseleave", scheduleHide);
				button.addEventListener("click", (event) => { event.stopPropagation(); showPopover(); });
			}
		}
	}

	private createAllDayOverflowPopover(
		anchor: HTMLElement,
		events: CalendarTimelineEvent[],
		cancelHide: () => void,
		scheduleHide: () => void,
	): HTMLElement {
		// The popover floats above the "+N" link as a stacked list of all-day events.
		const popover = anchor.createDiv({ cls: "db-calendar-week-allday-popover" });
		const list = popover.createDiv({ cls: "db-calendar-day-popover-events" });
		for (const event of events) {
			const eventEl = list.createEl("button", {
				cls: "db-calendar-month-segment is-all-day is-start is-end",
				attr: { type: "button", title: event.title, "data-note-database-row-path": event.row.file.path },
			});
			this.applyEventColor(eventEl, event.color);
			eventEl.createSpan({ cls: "db-calendar-month-title", text: event.title });
			eventEl.createSpan({ cls: "db-calendar-month-dates", text: this.formatMonthDateRange(event.startDateKey, event.endDateKey, event.startMinutes, event.endMinutes) });
			this.attachEventOpenHandlers(eventEl, event);
		}
		// Hovering the popover cancels the link's pending hide; leaving schedules it.
		popover.addEventListener("mouseenter", cancelHide);
		popover.addEventListener("mouseleave", scheduleHide);
		// Close on outside click.
		const closeOnOutside = (outsideEvent: MouseEvent) => {
			if (popover.contains(outsideEvent.target as Node)) return;
			popover.addClass("is-hidden");
			window.activeDocument.removeEventListener("click", closeOnOutside, true);
		};
		window.setTimeout(() => window.activeDocument.addEventListener("click", closeOnOutside, true), 0);
		// Clamp the popover so it stays inside the calendar container viewport.
		this.positionDayPopover(popover, anchor);
		return popover;
	}

	private renderTimeGrid(wrap: HTMLElement, config: ViewConfig, days: CalendarDayModel[]): void {
		const visible = getCalendarVisibleHourRange(config);
		const hourHeight = getCalendarHourHeight(config);
		const metrics: TimeGridMetrics = {
			startMinutes: visible.startMinutes,
			endMinutes: visible.endMinutes,
			hourHeight,
			gridHeight: ((visible.endMinutes - visible.startMinutes) / 60) * hourHeight,
		};
		const dateKeys = days.map((day) => day.dateKey);
		const timedLayouts = buildCalendarTimedEventLayouts(dateKeys, days.flatMap((day) => day.events), config);
		const slotDuration = getCalendarSlotDuration(config);
		// No inner scroll area: the time grid grows to full height and the outer
		// .note-database-container (overflow: auto) scrolls it, so the all-day
		// section and the time columns share identical column widths.
		const timeGrid = wrap.createDiv({ cls: "db-calendar-week-scroll" });
		const gutter = timeGrid.createDiv({ cls: "db-calendar-week-time-gutter" });
		gutter.style.height = `${metrics.gridHeight}px`;
		const now = new Date();
		for (let hour = visible.startHour; hour <= visible.endHour; hour++) {
			const offset = (hour * 60 - visible.startMinutes) / 60 * hourHeight;
			gutter.createDiv({
				cls: `db-calendar-week-hour-label${this.isCurrentCalendarHourTick(hour, days, now) ? " is-current-time-tick" : ""}`,
				text: this.formatHourLabel(hour % 24),
				attr: { style: `top: ${offset}px` },
			});
		}

		const body = timeGrid.createDiv({ cls: "db-calendar-week-body" });
		body.style.height = `${metrics.gridHeight}px`;
		body.style.setProperty("--db-calendar-time-day-count", String(days.length));
		this.renderTimeGridLines(body, visible.startMinutes, visible.endMinutes, slotDuration, hourHeight);
		const columns = body.createDiv({ cls: "db-calendar-time-columns" });
		columns.style.setProperty("--db-calendar-time-day-count", String(days.length));
		for (const day of days) {
			const col = columns.createDiv({
				cls: `db-calendar-week-day-col${day.dateKey === this.getTodayDateKey() ? " is-today" : ""}`,
				attr: { "data-date-key": day.dateKey },
			});
			this.setupTimeRangeSelection(col, config, day.dateKey, metrics);
			for (const layout of timedLayouts.filter((item) => item.dateKey === day.dateKey)) {
				this.renderWeekTimedEvent(col, config, layout, metrics);
			}
			this.renderCurrentTimeLine(col, day.dateKey, metrics);
		}
	}

	private renderTimeGridLines(body: HTMLElement, startMinutes: number, endMinutes: number, slotDuration: number, hourHeight: number): void {
		// 不在 endMinutes（底部边界）生成 slot line，底部边界由 body 的 border-bottom 提供
		for (let minute = startMinutes; minute < endMinutes; minute += slotDuration) {
			const offset = ((minute - startMinutes) / 60) * hourHeight;
			const line = body.createDiv({
				cls: `db-calendar-week-slot-line${minute % 60 === 0 ? " is-hour" : ""}`,
				attr: { style: `top: ${offset}px` },
			});
			line.setAttribute("aria-hidden", "true");
		}
	}

	private renderWeekTimedEvent(dayCol: HTMLElement, config: ViewConfig, layout: CalendarTimedEventLayout, metrics: TimeGridMetrics): void {
		const top = ((layout.clippedStartMinutes - metrics.startMinutes) / 60) * metrics.hourHeight;
		const height = Math.max(EVENT_CARD_MIN_HEIGHT, ((layout.clippedEndMinutes - layout.clippedStartMinutes) / 60) * metrics.hourHeight);
		// Below this height the card cannot fit title + time + padding cleanly, so
		// the time range stays in the tooltip and the title keeps priority.
		const isCompact = height < TIMED_EVENT_TIME_VISIBILITY_HEIGHT;
		const left = (layout.columnIndex / layout.columnCount) * 100;
		const width = 100 / layout.columnCount;
		const eventEl = dayCol.createDiv({
			cls: `db-calendar-week-timed-event${isCompact ? " is-compact" : ""}`,
			attr: {
				style: `top: ${top}px; height: ${height}px; left: calc(${left}% + 4px); width: calc(${width}% - 8px);`,
				title: `${formatCalendarTime(layout.startMinutes)} - ${formatCalendarTime(layout.endMinutes)} ${layout.event.title}`,
				"data-note-database-row-path": layout.event.row.file.path,
			},
		});
		this.applyEventColor(eventEl, layout.event.color);
		if (!this.actions.isReadOnly && this.actions.updateEventDates && config.calendarEndDateField) {
			this.renderTimeResizeHandle(eventEl, layout, "resize-start");
		}
		const content = eventEl.createDiv({ cls: "db-calendar-week-event-content" });
		// Title first (top) so a short card still shows what the event is; the
		// time range renders below only when there's room.
		content.createDiv({ cls: "db-calendar-week-event-title", text: layout.event.title });
		if (!isCompact) {
			content.createDiv({
				cls: "db-calendar-week-event-time",
				text: `${formatCalendarTime(layout.startMinutes)} - ${formatCalendarTime(layout.endMinutes)}`,
			});
		}
		if (!this.actions.isReadOnly && this.actions.updateEventDates && config.calendarEndDateField) {
			this.renderTimeResizeHandle(eventEl, layout, "resize-end");
		}
		this.attachEventOpenHandlers(eventEl, layout.event);
		this.setupTimedEventPointerDrag(eventEl, config, layout, metrics);
	}

	private renderTimeResizeHandle(eventEl: HTMLElement, layout: CalendarTimedEventLayout, mode: "resize-start" | "resize-end"): void {
		const handle = eventEl.createSpan({
			cls: `db-calendar-time-resize-handle is-${mode === "resize-start" ? "start" : "end"}`,
			attr: {
				title: mode === "resize-start" ? t("calendar.resizeStart") : t("calendar.resizeEnd"),
				"data-calendar-drag-mode": mode,
				"data-note-database-row-path": layout.event.row.file.path,
			},
		});
		handle.addEventListener("click", (event) => event.stopPropagation());
	}

	private attachMonthResizeHandle(
		eventEl: HTMLElement,
		originGrid: HTMLElement,
		days: CalendarDayModel[],
		segment: CalendarMonthSegment,
		config: ViewConfig,
		mode: "resize-start" | "resize-end",
		gridSelector: string,
		cellSelector: string,
		colCount: number,
	): void {
		// Left/right grab zones on month all-day segments. The zone drives its own
		// pointer-based resize (see beginMonthResize) instead of piggy-backing on the
		// segment's native HTML5 drag, which could not reliably distinguish resize
		// from move and left resize effectively impossible to trigger.
		const handle = eventEl.createSpan({
			cls: `db-calendar-month-resize-handle is-${mode === "resize-start" ? "start" : "end"}`,
			attr: { "data-calendar-resize-mode": mode, "aria-hidden": "true" },
		});
		// A click on the grab zone must not open the underlying event.
		handle.addEventListener("click", (clickEvent) => clickEvent.stopPropagation());
		handle.addEventListener("mousedown", (downEvent) => {
			if (downEvent.button !== 0) return;
			downEvent.preventDefault();
			downEvent.stopPropagation();
			this.beginMonthResize(eventEl, originGrid, days, segment, config, mode, gridSelector, cellSelector, colCount);
		});
	}

	/** move 入口：segment 本体 mousedown，避开 resize 把手，启动 beginMonthMove（pointer 平移）。 */
	private attachMonthMoveHandler(
		segmentEl: HTMLElement,
		originGrid: HTMLElement,
		days: CalendarDayModel[],
		segment: CalendarMonthSegment,
		config: ViewConfig,
		gridSelector: string,
		cellSelector: string,
		colCount: number,
	): void {
		if (this.actions.isReadOnly || !this.actions.updateEventDates) return;
		segmentEl.addClass("is-draggable");
		segmentEl.addEventListener("mousedown", (downEvent) => {
			if (downEvent.button !== 0) return;
			// 避开 resize 把手（把手 mousedown 自己 stopPropagation，这里兜底，与 timed pointer drag 一致）。
			if ((downEvent.target as HTMLElement | null)?.closest(".db-calendar-month-resize-handle")) return;
			downEvent.preventDefault();
			this.beginMonthMove(segmentEl, originGrid, days, segment, config, downEvent, gridSelector, cellSelector, colCount);
		});
	}

	private beginMonthResize(
		segmentEl: HTMLElement,
		originGrid: HTMLElement,
		days: CalendarDayModel[],
		segment: CalendarMonthSegment,
		config: ViewConfig,
		mode: "resize-start" | "resize-end",
		gridSelector: string,
		cellSelector: string,
		colCount: number,
	): void {
		segmentEl.addClass("is-resizing");
		const startField = config.calendarStartDateField || getDefaultEventDateField(config) || "";
		const endField = config.calendarEndDateField;
		const originalStartKey = segment.event.startDateKey;
		const originalEndKey = segment.event.endDateKey;
		const fixedStartDay = segment.startDayIndex;
		const fixedEndDay = segment.endDayIndex;
		// Restore the segment's original grid placement when a resize is cancelled
		// (no commit, so no refresh) so it doesn't keep the previewed start/span.
		const resetSegmentGrid = (): void => {
			segmentEl.style.setProperty("--db-calendar-segment-start", String(fixedStartDay + 1));
			segmentEl.style.setProperty("--db-calendar-segment-span", String(fixedEndDay - fixedStartDay + 1));
		};
		// Scope target-cell highlighting to this calendar (several may coexist via
		// embeds on the same page).
		const container = originGrid.closest<HTMLElement>(".db-calendar-month, .db-calendar-week-allday") || originGrid.parentElement || originGrid;
		let didMove = false;
		// Swallow the synthetic click that follows a drag so releasing a resize
		// never opens the underlying note.
		const swallowClick = (clickEvent: MouseEvent): void => {
			clickEvent.stopPropagation();
			clickEvent.preventDefault();
		};

		// Cross-grid preview: month rows can span multiple weeks; week/day all-day
		// sections usually stay in one grid but use the same target resolver.
		const allGrids = Array.from(container.querySelectorAll<HTMLElement>(gridSelector));
		const ghostByGrid = new Map<HTMLElement, HTMLElement>();
		const clearGhosts = (): void => {
			for (const ghost of ghostByGrid.values()) ghost.remove();
			ghostByGrid.clear();
		};
		const ensureGhost = (targetGrid: HTMLElement): HTMLElement => {
			const existing = ghostByGrid.get(targetGrid);
			if (existing) return existing;
			const ghost = targetGrid.createDiv({ cls: "db-calendar-month-segment db-calendar-month-ghost is-all-day" });
			ghost.style.setProperty("--db-calendar-segment-lane", String(segment.lane + 2));
			this.applyEventColor(ghost, segment.event.color);
			ghost.createSpan({ cls: "db-calendar-month-title", text: segment.event.title });
			ghostByGrid.set(targetGrid, ghost);
			return ghost;
		};
		const placeGhost = (ghost: HTMLElement, startDay: number, endDay: number): void => {
			ghost.style.setProperty("--db-calendar-segment-start", String(startDay + 1));
			ghost.style.setProperty("--db-calendar-segment-span", String(endDay - startDay + 1));
		};

		// Reposition the segment's grid start/span to follow the pointer. Within the
		// current grid it tracks the cursor; across grids it clamps to this grid's
		// edge and ghosts carry the rest through every grid in between.
		const previewSpan = (target: { grid: HTMLElement; dateKey: string; dayIndex: number } | null): void => {
			if (!target) {
				clearGhosts();
				return;
			}
			const isCrossGrid = target.grid !== originGrid;
			let dayIndex = isCrossGrid ? -1 : days.findIndex((day) => day.dateKey === target.dateKey);
			if (dayIndex < 0) {
				// Crossed into another grid row: clamp the preview to this grid's edge.
				dayIndex = mode === "resize-end" ? days.length - 1 : 0;
			}
			let newStartDay = fixedStartDay;
			let newEndDay = fixedEndDay;
			if (mode === "resize-start") {
				newStartDay = Math.min(dayIndex, fixedEndDay);
			} else {
				newEndDay = Math.max(dayIndex, fixedStartDay);
			}
			segmentEl.style.setProperty("--db-calendar-segment-start", String(newStartDay + 1));
			segmentEl.style.setProperty("--db-calendar-segment-span", String(newEndDay - newStartDay + 1));

			if (!isCrossGrid) {
				clearGhosts();
				return;
			}
			const originIdx = allGrids.indexOf(originGrid);
			const targetIdx = allGrids.indexOf(target.grid);
			if (originIdx < 0 || targetIdx < 0 || originIdx === targetIdx) {
				clearGhosts();
				return;
			}
			// Walk from the origin grid toward the target grid (exclusive of origin,
			// inclusive of target), placing ghosts. Intermediate grids span fully.
			const neededGrids = new Set<HTMLElement>();
			const direction = targetIdx > originIdx ? 1 : -1;
			for (let i = originIdx + direction; ; i += direction) {
				const grid = allGrids[i];
				if (!grid) break;
				neededGrids.add(grid);
				const isTargetWeek = i === targetIdx;
				const ghostStartDay = mode === "resize-end" ? 0 : (isTargetWeek ? target.dayIndex : 0);
				const ghostEndDay = mode === "resize-end" ? (isTargetWeek ? target.dayIndex : colCount - 1) : colCount - 1;
				placeGhost(ensureGhost(grid), ghostStartDay, ghostEndDay);
				if (isTargetWeek) break;
			}
			// Drop ghosts for grids the pointer has moved back out of.
			for (const [grid, ghost] of ghostByGrid) {
				if (!neededGrids.has(grid)) {
					ghost.remove();
					ghostByGrid.delete(grid);
				}
			}
		};

		const highlightTarget = (targetKey: string | null): void => {
			container.querySelectorAll(".is-resize-target").forEach((node) => node.classList.remove("is-resize-target"));
			if (targetKey) {
				container
					.querySelectorAll(`.db-calendar-day[data-date-key="${targetKey}"]`)
					.forEach((cell) => cell.classList.add("is-resize-target"));
				container
					.querySelectorAll(`.db-calendar-week-allday-col[data-date-key="${targetKey}"]`)
					.forEach((cell) => cell.classList.add("is-resize-target"));
			}
		};

		const onMove = (moveEvent: MouseEvent): void => {
			if (!didMove) {
				didMove = true;
				window.activeDocument.addEventListener("click", swallowClick, true);
			}
			const target = this.resolveMonthMoveTarget(moveEvent.clientX, moveEvent.clientY, gridSelector, cellSelector, colCount);
			previewSpan(target);
			highlightTarget(target?.dateKey || null);
		};

		const onUp = (upEvent: MouseEvent): void => {
			const target = this.resolveMonthMoveTarget(upEvent.clientX, upEvent.clientY, gridSelector, cellSelector, colCount);
			const targetKey = target?.dateKey || null;
			window.activeDocument.removeEventListener("mousemove", onMove);
			window.activeDocument.removeEventListener("mouseup", onUp);
			if (didMove) {
				window.setTimeout(() => window.activeDocument.removeEventListener("click", swallowClick, true), 0);
			}
			segmentEl.removeClass("is-resizing");
			clearGhosts();
			highlightTarget(null);
			if (!targetKey) {
				resetSegmentGrid();
				return;
			}
			const { startDateKey: newStartDateKey, endDateKey: newEndDateKey } = resolveDayRangeResize(originalStartKey, originalEndKey, targetKey, mode);
			if (newStartDateKey === originalStartKey && newEndDateKey === originalEndKey) {
				resetSegmentGrid();
				return;
			}
			// all-day resize 保留 datetime 列的原有时间分量（E2 修复）
			const change = resolveAllDayResizeChange({
				mode,
				newStartDateKey,
				newEndDateKey,
				startField,
				endField,
				startMinutes: segment.event.startMinutes,
				endMinutes: segment.event.endMinutes,
			});
			void this.actions.updateEventDates?.(segment.event.row, change);
		};

		window.activeDocument.addEventListener("mousemove", onMove);
		window.activeDocument.addEventListener("mouseup", onUp);
	}

	/** move（整体平移）：pointer 驱动，本体沿格子实时滑动 + 按列吸附（对齐时间线手感）。
	 *  与 resize 的区别：span 守恒，只动 `--db-calendar-segment-start`；提交数学是 move（换日期保时长）。
	 *  参数化 gridSelector/cellSelector/colCount 支持月视图（week 行）和周视图 all-day（stage）。 */
	private beginMonthMove(
		segmentEl: HTMLElement,
		originGrid: HTMLElement,
		_days: CalendarDayModel[],
		segment: CalendarMonthSegment,
		config: ViewConfig,
		downEvent: MouseEvent,
		gridSelector: string,
		cellSelector: string,
		colCount: number,
	): void {
		if (this.actions.isReadOnly || !this.actions.updateEventDates) return;
		segmentEl.addClass("is-moving");
		const startField = config.calendarStartDateField || getDefaultEventDateField(config) || "";
		const endField = config.calendarEndDateField;
		const originalStartKey = segment.event.startDateKey;
		const fixedStartDay = segment.startDayIndex;
		const fixedEndDay = segment.endDayIndex;
		const spanDays = Math.max(1, fixedEndDay - fixedStartDay + 1);
		// 防御性重算 durationDays（不信任 segment.event.durationDays，buildEvents 默认 1）。
		const durationDays = Math.max(1, (dateKeyDaysBetween(segment.event.startDateKey, segment.event.endDateKey) ?? 0) + 1);
		const startClientX = downEvent.clientX;
		const startClientY = downEvent.clientY;
		// 卡片日期范围文本：跨天 segment 才有 .db-calendar-month-dates；拖拽时实时改为目标范围，
		// 取消时还原原始文本（提交则由 re-render 重建）。
		const originalDatesText = this.formatMonthDateRange(originalStartKey, segment.event.endDateKey, segment.event.startMinutes, segment.event.endMinutes);
		const segmentDatesEl = segmentEl.querySelector<HTMLElement>(":scope > .db-calendar-month-dates");
		const formatTargetRange = (targetKey: string): string => {
			const endKey = endField ? addDateKeyDays(targetKey, durationDays - 1) : targetKey;
			return this.formatMonthDateRange(targetKey, endKey, segment.event.startMinutes, segment.event.endMinutes);
		};
		const resetSegmentGrid = (): void => {
			segmentEl.style.setProperty("--db-calendar-segment-start", String(fixedStartDay + 1));
			segmentEl.style.setProperty("--db-calendar-segment-span", String(spanDays));
			if (segmentDatesEl) segmentDatesEl.setText(originalDatesText);
		};
		// 容器用于限定 highlight/ghost 范围（多个日历共存于 embeds）。
		const container = originGrid.closest<HTMLElement>(".db-calendar-month, .db-calendar-week-allday") || originGrid.parentElement || originGrid;
		let didMove = false;
		const swallowClick = (clickEvent: MouseEvent): void => {
			clickEvent.stopPropagation();
			clickEvent.preventDefault();
		};

		// 跨 grid（月视图跨周）ghost：周视图 all-day 区单 grid，allGrids 仅一个，不会跨 grid。
		const allGrids = Array.from(container.querySelectorAll<HTMLElement>(gridSelector));
		const ghostByGrid = new Map<HTMLElement, HTMLElement>();
		const clearGhosts = (): void => {
			for (const ghost of ghostByGrid.values()) ghost.remove();
			ghostByGrid.clear();
		};
		const ensureGhost = (grid: HTMLElement, label: string): HTMLElement => {
			const existing = ghostByGrid.get(grid);
			if (existing) {
				existing.querySelector<HTMLElement>(":scope > .db-calendar-month-dates")?.setText(label);
				return existing;
			}
			const ghost = grid.createDiv({ cls: "db-calendar-month-segment db-calendar-month-ghost" });
			ghost.style.setProperty("--db-calendar-segment-lane", String(segment.lane + 2));
			this.applyEventColor(ghost, segment.event.color);
			ghost.createSpan({ cls: "db-calendar-month-title", text: segment.event.title });
			ghost.createSpan({ cls: "db-calendar-month-dates", text: label });
			ghostByGrid.set(grid, ghost);
			return ghost;
		};
		const placeGhost = (ghost: HTMLElement, startDay: number, endDay: number): void => {
			ghost.style.setProperty("--db-calendar-segment-start", String(startDay + 1));
			ghost.style.setProperty("--db-calendar-segment-span", String(endDay - startDay + 1));
		};

		// move：span 守恒。同 grid 本体滑动到 target 列；跨 grid（月视图跨周）本体还原原位 + target 放 ghost。
		const previewMove = (target: { grid: HTMLElement; dateKey: string; dayIndex: number } | null): void => {
			if (!target) {
				clearGhosts();
				return;
			}
			if (target.grid === originGrid) {
				segmentEl.style.setProperty("--db-calendar-segment-start", String(target.dayIndex + 1));
				segmentEl.style.setProperty("--db-calendar-segment-span", String(spanDays));
				if (segmentDatesEl) segmentDatesEl.setText(formatTargetRange(target.dateKey));
				clearGhosts();
				return;
			}
			resetSegmentGrid();
			// 从 target week 起，逐周放 ghost 直到 span 用完（大 span 事件跨多周也完整预览）。
			const targetIdx = allGrids.indexOf(target.grid);
			if (targetIdx < 0) { clearGhosts(); return; }
			const targetLabel = formatTargetRange(target.dateKey);
			const neededGrids = new Set<HTMLElement>();
			let remaining = spanDays;
			let day = target.dayIndex;
			for (let i = targetIdx; i < allGrids.length && remaining > 0; i++) {
				const grid = allGrids[i];
				neededGrids.add(grid);
				const startDay = Math.max(0, Math.min(day, colCount - 1));
				const endDay = Math.min(startDay + remaining - 1, colCount - 1);
				placeGhost(ensureGhost(grid, targetLabel), startDay, endDay);
				remaining -= (endDay - startDay + 1);
				day = 0;
			}
			for (const [grid, ghost] of ghostByGrid) {
				if (!neededGrids.has(grid)) { ghost.remove(); ghostByGrid.delete(grid); }
			}
		};

		const highlightTarget = (targetKey: string | null): void => {
			container.querySelectorAll(".is-resize-target").forEach((node) => node.classList.remove("is-resize-target"));
			if (targetKey) {
				container
					.querySelectorAll(`.db-calendar-day[data-date-key="${targetKey}"], .db-calendar-week-allday-col[data-date-key="${targetKey}"]`)
					.forEach((cell) => cell.classList.add("is-resize-target"));
			}
		};

		const onMove = (moveEvent: MouseEvent): void => {
			if (!didMove) {
				if (Math.abs(moveEvent.clientX - startClientX) > 3 || Math.abs(moveEvent.clientY - startClientY) > 3) {
					didMove = true;
					window.activeDocument.addEventListener("click", swallowClick, true);
				}
			}
			const target = this.resolveMonthMoveTarget(moveEvent.clientX, moveEvent.clientY, gridSelector, cellSelector, colCount);
			previewMove(target);
			highlightTarget(target?.dateKey || null);
		};

		const onUp = (upEvent: MouseEvent): void => {
			const target = this.resolveMonthMoveTarget(upEvent.clientX, upEvent.clientY, gridSelector, cellSelector, colCount);
			const targetKey = target?.dateKey || null;
			window.activeDocument.removeEventListener("mousemove", onMove);
			window.activeDocument.removeEventListener("mouseup", onUp);
			if (didMove) {
				window.setTimeout(() => window.activeDocument.removeEventListener("click", swallowClick, true), 0);
			}
			segmentEl.removeClass("is-moving");
			clearGhosts();
			highlightTarget(null);
			if (!didMove || !targetKey || targetKey === originalStartKey) {
				resetSegmentGrid();
				return;
			}
			const startDateKey = targetKey;
			const endDateKey = endField ? addDateKeyDays(targetKey, durationDays - 1) : undefined;
			void this.actions.updateEventDates?.(segment.event.row, resolveDayMoveChange({
				startField,
				startDateKey,
				endField,
				endDateKey,
				// 透传原时刻分量（date 事件为 undefined，写纯日期不受影响）—— datetime 事件 move 保时间。
				startMinutes: segment.event.startMinutes,
				endMinutes: segment.event.endMinutes,
			}));
		};

		window.activeDocument.addEventListener("mousemove", onMove);
		window.activeDocument.addEventListener("mouseup", onUp);
	}

	/** 参数化指针落点解析：支持月视图 week 行和周/日视图 all-day stage。 */
	private resolveMonthMoveTarget(
		clientX: number,
		clientY: number,
		gridSelector: string,
		cellSelector: string,
		colCount: number,
	): { grid: HTMLElement; dateKey: string; dayIndex: number } | null {
		const hit = window.activeDocument.elementFromPoint(clientX, clientY) as HTMLElement | null;
		const grid = hit?.closest<HTMLElement>(gridSelector);
		if (!grid) return null;
		const rect = grid.getBoundingClientRect();
		if (rect.width === 0) return null;
		const colWidth = rect.width / colCount;
		let index = Math.floor((clientX - rect.left) / colWidth);
		index = Math.max(0, Math.min(colCount - 1, index));
		const cells = grid.querySelectorAll<HTMLElement>(cellSelector);
		const dateKey = cells[index]?.getAttribute("data-date-key");
		if (!dateKey) return null;
		return { grid, dateKey, dayIndex: index };
	}

	private renderCurrentTimeLine(dayCol: HTMLElement, dateKey: string, metrics: TimeGridMetrics): void {
		const todayKey = this.getTodayDateKey();
		if (dateKey !== todayKey) return;
		const line = dayCol.createDiv({ cls: "db-calendar-timed-current-line" });
		const update = () => {
			const now = new Date();
			const minutes = now.getHours() * 60 + now.getMinutes();
			if (minutes < metrics.startMinutes || minutes > metrics.endMinutes) {
				line.hide();
				return;
			}
			line.show();
			line.style.top = `${((minutes - metrics.startMinutes) / 60) * metrics.hourHeight}px`;
		};
		update();
		if (this.currentTimeTimer == null) {
			this.currentTimeTimer = window.setInterval(update, 60000);
		}
	}

	private setupTimeRangeSelection(dayCol: HTMLElement, config: ViewConfig, dateKey: string, metrics: TimeGridMetrics): void {
		if (this.actions.isReadOnly || !this.actions.createEntryForDate) return;
		dayCol.addEventListener("mousedown", (event) => {
			if (event.button !== 0) return;
			if ((event.target as HTMLElement | null)?.closest(".db-calendar-week-timed-event, .db-calendar-time-resize-handle")) return;
			event.preventDefault();
			const startY = event.clientY;
			// endMinutes 是时间范围边界，不让事件从边界开始
			const rawStart = this.snapTime(this.minuteFromPointer(dayCol, event.clientY, metrics));
			const start = rawStart >= metrics.endMinutes ? metrics.endMinutes - TIME_SNAP_MINUTES : rawStart;
			let end = Math.min(metrics.endMinutes, start + TIME_SNAP_MINUTES);
			const preview = dayCol.createDiv({ cls: "db-calendar-selection-preview" });
			// Suppress the click after a drag so releasing over an event doesn't open it.
			let didDrag = false;
			const swallowClick = (clickEvent: MouseEvent) => {
				clickEvent.stopPropagation();
				clickEvent.preventDefault();
			};
			const renderPreview = (from: number, to: number) => {
				const topMinute = Math.min(from, to);
				const bottomMinute = Math.max(from, to);
				preview.style.top = `${((topMinute - metrics.startMinutes) / 60) * metrics.hourHeight}px`;
				preview.style.height = `${Math.max(EVENT_CARD_MIN_HEIGHT, ((bottomMinute - topMinute) / 60) * metrics.hourHeight)}px`;
				preview.setText(`${formatCalendarTime(topMinute)} - ${formatCalendarTime(bottomMinute)}`);
			};
			renderPreview(start, end);
			const onMove = (moveEvent: MouseEvent) => {
				if (!didDrag && Math.abs(moveEvent.clientY - startY) > 3) {
					didDrag = true;
					window.activeDocument.addEventListener("click", swallowClick, true);
				}
				end = this.snapTime(this.minuteFromPointer(dayCol, moveEvent.clientY, metrics));
				if (end === start) end = Math.min(metrics.endMinutes, start + TIME_SNAP_MINUTES);
				renderPreview(start, end);
			};
			const onUp = () => {
				window.activeDocument.removeEventListener("mousemove", onMove, true);
				window.activeDocument.removeEventListener("mouseup", onUp, true);
				if (didDrag) {
					window.setTimeout(() => window.activeDocument.removeEventListener("click", swallowClick, true), 0);
				}
				const startTimeMinutes = Math.min(start, end);
				const endTimeMinutes = Math.max(start, end);
				preview.remove();
				this.actions.createEntryForDate?.(config, dateKey, {
					startTimeMinutes,
					endTimeMinutes: Math.max(startTimeMinutes + TIME_SNAP_MINUTES, endTimeMinutes),
				});
			};
			window.activeDocument.addEventListener("mousemove", onMove, true);
			window.activeDocument.addEventListener("mouseup", onUp, true);
		});
	}

	private setupTimedEventPointerDrag(eventEl: HTMLElement, config: ViewConfig, layout: CalendarTimedEventLayout, metrics: TimeGridMetrics): void {
		if (this.actions.isReadOnly || !this.actions.updateEventDates) return;
		eventEl.addEventListener("mousedown", (event) => {
			if (event.button !== 0) return;
			const mode = ((event.target as HTMLElement | null)?.closest(".db-calendar-time-resize-handle") as HTMLElement | null)
				?.dataset.calendarDragMode as TimedDragMode | undefined || "move";
			if (mode !== "move" && !config.calendarEndDateField) return;
			event.preventDefault();
			event.stopPropagation();
			const startY = event.clientY;
			const originalStart = layout.startMinutes;
			const originalEnd = layout.endMinutes;
			const dateKeys = this.getRenderedTimeGridDateKeys(eventEl);
			let targetDateKey = layout.dateKey;
			let nextStart = originalStart;
			let nextEnd = originalEnd;

			// Move the card itself in real time so the drag is "what you see is what
			// you get". Previously only a text hint followed the cursor and the card
			// jumped on release, which read as "preview != result".
			const applyLivePosition = (start: number, end: number) => {
				const clampedStart = Math.max(metrics.startMinutes, start);
				const clampedEnd = Math.min(metrics.endMinutes, end);
				const top = ((clampedStart - metrics.startMinutes) / 60) * metrics.hourHeight;
				const height = Math.max(EVENT_CARD_MIN_HEIGHT, ((clampedEnd - clampedStart) / 60) * metrics.hourHeight);
				eventEl.style.top = `${top}px`;
				eventEl.style.height = `${height}px`;
				eventEl.toggleClass("is-compact", height < TIMED_EVENT_TIME_VISIBILITY_HEIGHT);
			};

			// Shared calculation: preview (mousemove) and commit (mouseup) use the
			// exact same math, and mouseup recomputes from its own coordinates so a
			// fast release never commits a stale second-to-last mousemove value.
			// Resize keeps the date fixed (only the time changes); move may cross days.
			const computeNext = (clientY: number, clientX: number): { start: number; end: number; dateKey: string } => {
				const range = resolveTimedDragRange({
					mode,
					originalStart,
					originalEnd,
					visibleStart: metrics.startMinutes,
					visibleEnd: metrics.endMinutes,
					deltaMinutes: ((clientY - startY) / metrics.hourHeight) * 60,
				});
				if (mode !== "move") return { start: range.start, end: range.end, dateKey: layout.dateKey };
				const dateKey = this.getDateKeyFromPointer(eventEl, clientX, dateKeys) || layout.dateKey;
				return { start: range.start, end: range.end, dateKey };
			};

			// Suppress the click that follows a drag's mouseup so releasing over
			// another event doesn't open it. Only armed once the pointer actually
			// moves past a small threshold (a plain click still opens the event).
			let didDrag = false;
			const swallowClick = (clickEvent: MouseEvent) => {
				clickEvent.stopPropagation();
				clickEvent.preventDefault();
			};
			eventEl.addClass("is-dragging");
			eventEl.toggleClass("is-moving", mode === "move");
			const onMove = (moveEvent: MouseEvent) => {
				if (!didDrag && Math.abs(moveEvent.clientY - startY) > 3) {
					didDrag = true;
					window.activeDocument.addEventListener("click", swallowClick, true);
				}
				const next = computeNext(moveEvent.clientY, moveEvent.clientX);
				nextStart = next.start;
				nextEnd = next.end;
				targetDateKey = next.dateKey;
				applyLivePosition(nextStart, nextEnd);
				this.renderTimedDragPreview(eventEl, targetDateKey, nextStart, nextEnd);
				if (mode === "move") this.syncTimedDragDropTarget(eventEl, targetDateKey);
			};
			const onUp = (upEvent: MouseEvent) => {
				window.activeDocument.removeEventListener("mousemove", onMove, true);
				window.activeDocument.removeEventListener("mouseup", onUp, true);
				if (didDrag) {
					// Remove after the current task so the mouseup->click is swallowed.
					window.setTimeout(() => window.activeDocument.removeEventListener("click", swallowClick, true), 0);
				}
				const next = computeNext(upEvent.clientY, upEvent.clientX);
				nextStart = next.start;
				nextEnd = next.end;
				targetDateKey = next.dateKey;
				eventEl.removeClass("is-dragging", "is-moving");
				eventEl.querySelector(".db-calendar-timed-drag-preview")?.remove();
				if (mode === "move") this.clearAllDropTargets();
				void this.actions.updateEventDates?.(layout.event.row, {
					startField: config.calendarStartDateField || getDefaultEventDateField(config) || "",
					startDateKey: targetDateKey,
					startTimeMinutes: nextStart,
					endField: config.calendarEndDateField,
					endDateKey: config.calendarEndDateField ? targetDateKey : undefined,
					endTimeMinutes: config.calendarEndDateField ? nextEnd : undefined,
					changedEdge: mode === "resize-start" ? "start" : mode === "resize-end" ? "end" : "both",
				});
			};
			window.activeDocument.addEventListener("mousemove", onMove, true);
			window.activeDocument.addEventListener("mouseup", onUp, true);
		});
	}

	private renderTimedDragPreview(eventEl: HTMLElement, dateKey: string, startMinutes: number, endMinutes: number): void {
		let preview = eventEl.querySelector<HTMLElement>(":scope > .db-calendar-timed-drag-preview");
		if (!preview) preview = eventEl.createDiv({ cls: "db-calendar-timed-drag-preview" });
		preview.setText(`${formatCalendarTime(startMinutes)} - ${formatCalendarTime(endMinutes)}`);
	}

	private syncTimedDragDropTarget(eventEl: HTMLElement, dateKey: string): void {
		const calendar = eventEl.closest<HTMLElement>(".db-calendar") || window.activeDocument;
		this.clearDropTargets(calendar);
		const target = Array.from(calendar.querySelectorAll<HTMLElement>(".db-calendar-week-day-col"))
			.find((col) => col.dataset.dateKey === dateKey);
		if (!target) return;
		target.addClass("is-drop-target");
		this.renderDropSnap(target, dateKey);
	}

	private attachEventOpenHandlers(eventEl: HTMLElement, event: CalendarTimelineEvent): void {
		eventEl.addEventListener("click", (mouseEvent) => {
			if ((mouseEvent.target as HTMLElement | null)?.closest(".db-calendar-time-resize-handle")) return;
			mouseEvent.stopPropagation();
			this.actions.openRow(event.row);
		});
		eventEl.addEventListener("contextmenu", (mouseEvent) => {
			mouseEvent.preventDefault();
			mouseEvent.stopPropagation();
			this.actions.showRowMenu?.(mouseEvent, event.row);
		});
	}

	private getSegmentTitle(segment: CalendarMonthSegment): string {
		const time = segment.isTimed && segment.startMinutes != null ? `${formatCalendarTime(segment.startMinutes)} ` : "";
		const range = !segment.isTimed && segment.event.endDateKey > segment.event.startDateKey
			? `${this.formatMonthDateRange(segment.event.startDateKey, segment.event.endDateKey)} `
			: "";
		return `${time}${range}${segment.event.title}`;
	}

	/** Zero-padded MM-DD for a YYYY-MM-DD key. */
	private formatMonthDate(dateKey: string): string {
		const parts = parseDateTimeParts(dateKey);
		if (!parts) return "";
		return formatDateValueDisplay(dateKey, { contextYear: parts.year });
	}

	/** "MM-DD - MM-DD" for a same-year range, full dates when crossing years.
	 *  datetime 跨天事件（startMinutes/endMinutes 有值）附加时间部分（D1）。 */
	private formatMonthDateRange(
		startDateKey: string,
		endDateKey: string,
		startTimeMinutes?: number,
		endTimeMinutes?: number,
	): string {
		const start = parseDateTimeParts(startDateKey);
		const contextYear = start?.year;
		return formatDateTimeRangeDisplay(startDateKey, endDateKey, startTimeMinutes, endTimeMinutes, { contextYear });
	}

	private renderWeekHeader(wrap: HTMLElement, config: ViewConfig, weekDays: CalendarDayModel[]): void {
		const header = wrap.createDiv({ cls: "db-calendar-header" });
		this.renderCalendarTitle(header, formatCalendarTitleParts({
			scale: "week",
			startDateKey: weekDays[0]?.dateKey,
			endDateKey: weekDays[weekDays.length - 1]?.dateKey,
			locale: getEffectiveLocale(),
		}));
		const controls = header.createDiv({ cls: "db-calendar-controls" });
		this.renderCalendarScaleControl(controls, config, "week", weekDays[0]?.dateKey || this.getTodayDateKey());
		this.renderNavButton(controls, "calendar.prevWeek", () => this.shiftWeek(config, weekDays, -1), "chevron-left");
		this.renderNavButton(controls, "calendar.today", () => this.goToTodayWeek(config));
		this.renderNavButton(controls, "calendar.nextWeek", () => this.shiftWeek(config, weekDays, 1), "chevron-right");
		this.renderMiniCalendarButton(controls, header, config);
		this.renderCalendarInvalidWarning(controls);
	}

	private renderDayHeader(wrap: HTMLElement, config: ViewConfig, dateKey: string): void {
		const header = wrap.createDiv({ cls: "db-calendar-header" });
		this.renderCalendarTitle(header, formatCalendarTitleParts({
			scale: "day",
			startDateKey: dateKey,
			locale: getEffectiveLocale(),
		}));
		const controls = header.createDiv({ cls: "db-calendar-controls" });
		this.renderCalendarScaleControl(controls, config, "day", dateKey);
		this.renderNavButton(controls, "calendar.prevDay", () => this.shiftDay(config, dateKey, -1), "chevron-left");
		this.renderNavButton(controls, "calendar.today", () => this.goToTodayDay(config));
		this.renderNavButton(controls, "calendar.nextDay", () => this.shiftDay(config, dateKey, 1), "chevron-right");
		this.renderMiniCalendarButton(controls, header, config);
		this.renderCalendarInvalidWarning(controls);
	}

	private renderMiniCalendarButton(controls: HTMLElement, header: HTMLElement, config: ViewConfig): void {
		const btn = controls.createEl("button", {
			cls: "db-calendar-nav-button is-icon",
			attr: { type: "button", title: t("calendar.datePicker"), "aria-label": t("calendar.datePicker") },
		});
		setIcon(btn.createSpan({ cls: "db-calendar-nav-icon" }), "calendar-days");
		btn.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.toggleMiniCalendar(header, config);
		};
	}

	/** 导航栏 invalid 事件图标按钮（A2）：异步统计后，仅在 count > 0 时显示 ⚠️，点击打开修复弹窗。
	 *  逻辑与时间线 renderTimelineInvalidWarning 对齐（cache miss 时沿用上次计数避免闪现）。 */
	private renderCalendarInvalidWarning(controls: HTMLElement): void {
		if (!this.actions.getCalendarInvalidEventCount || !this.actions.openCalendarInvalidEvents) return;
		const result = this.actions.getCalendarInvalidEventCount();
		const initialCount = typeof result === "number" ? result : this.calendarInvalidWarningCount;
		if (typeof result === "number") this.calendarInvalidWarningCount = result;
		if (typeof result === "number" && result <= 0) return;
		const button = controls.createEl("button", {
			cls: `db-calendar-nav-button is-icon db-calendar-invalid-toggle${initialCount && initialCount > 0 ? "" : " is-hidden"}`,
			attr: { type: "button" },
		});
		setIcon(button.createSpan({ cls: "db-calendar-nav-icon" }), "alert-triangle");
		button.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.actions.openCalendarInvalidEvents?.();
		};
		const applyCount = (count: number): void => {
			this.calendarInvalidWarningCount = count;
			if (!button.isConnected) return;
			if (count <= 0) {
				button.remove();
				return;
			}
			button.removeClass("is-hidden");
			const label = t("timeline.invalidEventsConflictNotice", { count });
			button.setAttr("title", label);
			button.setAttr("aria-label", label);
		};
		if (initialCount && initialCount > 0) applyCount(initialCount);
		if (typeof result === "number") return;
		void result
			.then((count) => applyCount(count))
			.catch(() => {
				if (button.isConnected) button.remove();
			});
	}

	/** Mini month calendar that doubles as a "jump to date" picker. Days with
	 *  events show the day number inside a filled accent circle. */
	private toggleMiniCalendar(header: HTMLElement, config: ViewConfig): void {
		if (this.miniCalendarEl?.isConnected) {
			this.closeMiniCalendar();
			return;
		}
		this.closeMiniCalendar();
		const popover = header.createDiv({ cls: "db-calendar-mini-popover" });
		this.miniCalendarEl = popover;
		this.miniCalendarMonth = this.resolveMiniMonthKey(config);
		this.miniCalendarMode = "day";
		this.renderMiniMonth(popover, config);

		const onOutside = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (target && popover.contains(target)) return;
			this.closeMiniCalendar();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			this.closeMiniCalendar();
		};
		window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
		window.activeDocument.addEventListener("keydown", onKey, true);
		this.miniCalendarCleanup = () => {
			window.activeDocument.removeEventListener("mousedown", onOutside, true);
			window.activeDocument.removeEventListener("keydown", onKey, true);
			popover.remove();
			this.miniCalendarEl = null;
			this.miniCalendarMonth = null;
			this.miniCalendarMode = "day";
			this.miniCalendarCleanup = null;
		};
	}

	private closeMiniCalendar(): void {
		this.miniCalendarCleanup?.();
		this.miniCalendarCleanup = null;
	}

	private renderMiniMonth(popover: HTMLElement, config: ViewConfig): void {
		const monthKey = this.miniCalendarMonth ?? this.resolveMiniMonthKey(config);
		const [ys, ms] = monthKey.split("-");
		const year = Number(ys);
		const monthIndex = Number(ms) - 1;

		const weekStartsOn = this.getLocaleWeekStartsOn(config);
		// Reuse the month model so event markers reflect the same source/filter as
		// the main grid (events come from the currently displayed rows).
		const startField = config.calendarStartDateField || getDefaultEventDateField(config) || "";
		const model = buildCalendarMonthModel(
			this.currentRows,
			{ ...config, calendarStartDateField: startField, calendarMonth: monthKey },
			{ year, monthIndex },
			{ weekStartsOn },
		);
		const todayKey = this.getTodayDateKey();
		const selectedKeys = this.resolveSelectedKeys(config);
		const eventIndex = buildMiniCalendarEventIndex({
			rows: this.currentRows,
			config,
			startField,
			endField: config.calendarEndDateField,
		});
		renderMiniCalendar({
			popover,
			mode: this.miniCalendarMode,
			monthKey,
			monthTitle: this.formatMonthTitle(year, monthIndex),
			visibleYear: year,
			yearRangeStart: this.getMiniCalendarYearRangeStart(year),
			weeks: model.weeks,
			weekdays: this.getWeekdayLabels(weekStartsOn),
			todayKey,
			selectedKeys,
			eventIndex,
			onPrevious: () => this.shiftMiniCalendarWindow(popover, config, -1),
			onNext: () => this.shiftMiniCalendarWindow(popover, config, 1),
			onTitleClick: () => this.drillMiniCalendarUp(popover, config),
			onSelectMonth: (selectedMonthKey) => {
				this.miniCalendarMonth = selectedMonthKey;
				this.miniCalendarMode = "day";
				this.renderMiniMonth(popover, config);
			},
			onSelectYear: (selectedYear) => {
				this.miniCalendarMonth = `${String(selectedYear).padStart(4, "0")}-01`;
				this.miniCalendarMode = "month";
				this.renderMiniMonth(popover, config);
			},
			onSelectDate: (dateKey) => this.navigateViaMini(config, dateKey),
			onSelectToday: (dateKey) => this.jumpMiniCalendarToToday(popover, config, dateKey),
		});
	}

	private shiftMiniCalendarWindow(popover: HTMLElement, config: ViewConfig, direction: 1 | -1): void {
		const monthKey = this.miniCalendarMonth ?? this.resolveMiniMonthKey(config);
		const delta = this.miniCalendarMode === "day" ? direction : this.miniCalendarMode === "month" ? direction * 12 : direction * 144;
		this.miniCalendarMonth = shiftCalendarMonth(monthKey, delta);
		this.renderMiniMonth(popover, config);
	}

	private drillMiniCalendarUp(popover: HTMLElement, config: ViewConfig): void {
		if (this.miniCalendarMode === "day") {
			this.miniCalendarMode = "month";
		} else if (this.miniCalendarMode === "month") {
			this.miniCalendarMode = "year";
		}
		this.renderMiniMonth(popover, config);
	}

	private jumpMiniCalendarToToday(popover: HTMLElement, config: ViewConfig, dateKey: string): void {
		this.miniCalendarMonth = dateKey.slice(0, 7);
		this.miniCalendarMode = "day";
		this.renderMiniMonth(popover, config);
	}

	private navigateViaMini(config: ViewConfig, dateKey: string): void {
		// Mirror shiftDay: set all three anchors so month/week/day each jump to it.
		config.calendarDay = dateKey;
		config.calendarWeekStart = dateKey;
		config.calendarMonth = dateKey.slice(0, 7);
		this.requestCalendarDateFlash(dateKey);
		this.actions.onConfigChange?.(t("undo.calendarMonthConfig"));
		this.closeMiniCalendar();
	}

	private requestCalendarDateFlash(dateKey: string): void {
		this.pendingFlashDateKey = dateKey;
	}

	/** Date keys that make up the active selection in the main view (the current
	 *  week for week view, the current day for day view; empty for month). */
	private resolveSelectedKeys(config: ViewConfig): Set<string> {
		const keys = new Set<string>();
		const scale = config.calendarScale || "month";
		if (scale === "day") {
			if (config.calendarDay) keys.add(config.calendarDay);
		} else if (scale === "week") {
			const weekStartsOn = this.getLocaleWeekStartsOn(config);
			const start = parseDateKeyToUtc(config.calendarWeekStart || config.calendarDay || "");
			if (start) {
				start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() - weekStartsOn + 7) % 7));
				for (let i = 0; i < 7; i++) {
					const d = new Date(start);
					d.setUTCDate(start.getUTCDate() + i);
					keys.add(this.dateKeyFromDate(d));
				}
			}
		}
		return keys;
	}

	private flashDayColumn(dateKey: string): void {
		// Flash the whole vertical column — weekday header + all-day strip + time
		// grid lane — so the highlight reads as one continuous column instead of a
		// truncated swimlane.
		const root = this.calendarRoot ?? window.activeDocument;
		const monthCells = Array.from(root.querySelectorAll<HTMLElement>(`.db-calendar-day[data-date-key="${dateKey}"]`));
		const overlays: HTMLElement[] = [];
		for (const cell of monthCells) {
			const week = cell.closest<HTMLElement>(".db-calendar-month-week");
			if (!week) continue;
			const overlay = week.createDiv({
				cls: "db-calendar-month-flash-column is-flash",
				attr: { "data-date-key": dateKey },
			});
			overlay.style.setProperty("--db-calendar-month-flash-column", cell.style.gridColumn || "1");
			overlays.push(overlay);
		}

		const selector = `.db-calendar-week-day-col[data-date-key="${dateKey}"], .db-calendar-week-allday-col[data-date-key="${dateKey}"], .db-calendar-time-header-day[data-date-key="${dateKey}"]`;
		const cols = Array.from(root.querySelectorAll<HTMLElement>(selector));
		if (cols.length === 0 && overlays.length === 0) return;
		cols.forEach((col) => col.addClass("is-flash"));
		window.setTimeout(() => {
			cols.forEach((col) => col.removeClass("is-flash"));
			overlays.forEach((overlay) => overlay.remove());
		}, 1300);
	}

	private resolveMiniMonthKey(config: ViewConfig): string {
		const key = config.calendarMonth || config.calendarDay || config.calendarWeekStart;
		if (key && /^\d{4}-\d{2}/.test(key)) return key.slice(0, 7);
		return this.monthKeyFromDate(new Date());
	}

	private resolveWeekIndex(config: ViewConfig, model: { weeks: { dateKey: string }[][] }): number {
		const targetKey = config.calendarWeekStart || config.calendarDay;
		if (targetKey) {
			for (let i = 0; i < model.weeks.length; i++) {
				if (model.weeks[i].some((day) => day.dateKey === targetKey)) return i;
			}
		}
		const monthStr = config.calendarMonth;
		if (monthStr) {
			const firstDayKey = `${monthStr}-01`;
			for (let i = 0; i < model.weeks.length; i++) {
				if (model.weeks[i].some((day) => day.dateKey === firstDayKey)) return i;
			}
		}
		return 0;
	}

	private shiftWeek(config: ViewConfig, weekDays: CalendarDayModel[], direction: 1 | -1): void {
		if (weekDays.length === 0) return;
		const referenceDay = direction === -1 ? weekDays[0] : weekDays[weekDays.length - 1];
		const targetDate = parseDateKeyToUtc(referenceDay.dateKey);
		if (!targetDate) return;
		targetDate.setUTCDate(targetDate.getUTCDate() + direction * 7);
		config.calendarWeekStart = this.dateKeyFromDate(targetDate);
		config.calendarDay = config.calendarWeekStart;
		config.calendarMonth = this.monthKeyFromDate(targetDate);
		this.actions.onConfigChange?.(t("undo.calendarMonthConfig"));
	}

	private goToTodayWeek(config: ViewConfig): void {
		const today = new Date();
		config.calendarWeekStart = this.getTodayDateKey(today);
		config.calendarDay = config.calendarWeekStart;
		config.calendarMonth = this.monthKeyFromDate(today);
		this.requestCalendarDateFlash(config.calendarWeekStart);
		this.actions.onConfigChange?.(t("undo.calendarMonthConfig"));
	}

	private shiftDay(config: ViewConfig, dateKey: string, direction: 1 | -1): void {
		const date = parseDateKeyToUtc(dateKey);
		if (!date) return;
		date.setUTCDate(date.getUTCDate() + direction);
		config.calendarDay = this.dateKeyFromDate(date);
		config.calendarWeekStart = config.calendarDay;
		config.calendarMonth = this.monthKeyFromDate(date);
		this.actions.onConfigChange?.(t("undo.calendarMonthConfig"));
	}

	private goToTodayDay(config: ViewConfig): void {
		const today = new Date();
		config.calendarDay = this.getTodayDateKey(today);
		config.calendarWeekStart = config.calendarDay;
		config.calendarMonth = this.monthKeyFromDate(today);
		this.requestCalendarDateFlash(config.calendarDay);
		this.actions.onConfigChange?.(t("undo.calendarMonthConfig"));
	}

	private renderMonthHeader(wrap: HTMLElement, config: ViewConfig, model: { year: number; monthIndex: number }): void {
		const header = wrap.createDiv({ cls: "db-calendar-header" });
		this.renderCalendarTitle(header, formatCalendarTitleParts({
			scale: "month",
			startDateKey: `${String(model.year).padStart(4, "0")}-${String(model.monthIndex + 1).padStart(2, "0")}-01`,
			locale: getEffectiveLocale(),
		}));
		const controls = header.createDiv({ cls: "db-calendar-controls" });
		this.renderCalendarScaleControl(controls, config, "month", `${String(model.year).padStart(4, "0")}-${String(model.monthIndex + 1).padStart(2, "0")}-01`);
		this.renderNavButton(controls, "calendar.prevMonth", () => this.shiftMonth(config, model, -1), "chevron-left");
		this.renderNavButton(controls, "calendar.today", () => this.setMonth(config, new Date()));
		this.renderNavButton(controls, "calendar.nextMonth", () => this.shiftMonth(config, model, 1), "chevron-right");
		this.renderMiniCalendarButton(controls, header, config);
		this.renderCalendarInvalidWarning(controls);
	}

	private renderWeekdayLabels(wrap: HTMLElement, config: ViewConfig, weekStartsOn: number): void {
		const weekdaysRow = wrap.createDiv({ cls: "db-calendar-weekdays" });
		for (const weekday of this.getWeekdayLabels(weekStartsOn)) {
			const wdDiv = weekdaysRow.createDiv({ cls: "db-calendar-weekday" });
			wdDiv.createSpan({ text: weekday });
			if (!this.actions.isReadOnly && this.actions.onConfigChange) {
				const resizeHandle = wdDiv.createDiv({ cls: "db-calendar-col-resize-handle" });
				this.setupColumnResize(resizeHandle, config, wrap);
			}
		}
	}

	private renderDayHeading(cell: HTMLElement, config: ViewConfig, dateKey: string): void {
		const heading = cell.createDiv({ cls: "db-calendar-day-heading" });
		heading.createSpan({ cls: "db-calendar-day-number", text: String(Number(dateKey.slice(8, 10))) });
		if (!this.actions.isReadOnly && this.actions.createEntryForDate) {
			const addButton = heading.createEl("button", {
				cls: "db-calendar-add-button",
				text: "+",
				attr: { type: "button", title: t("toolbar.new"), "aria-label": t("toolbar.new") },
			});
			addButton.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.actions.createEntryForDate?.(config, dateKey);
			};
			cell.ondblclick = (event) => {
				if ((event.target as HTMLElement | null)?.closest(".db-calendar-month-segment, .db-calendar-add-button, .db-calendar-more-events")) return;
				this.actions.createEntryForDate?.(config, dateKey);
			};
		}
	}

	private renderDropSnap(cell: HTMLElement, dateKey: string): void {
		let snap = cell.querySelector<HTMLElement>(":scope > .db-calendar-drop-snap");
		if (!snap) snap = cell.createDiv({ cls: "db-calendar-drop-snap" });
		snap.setText(dateKey);
	}

	private clearDropTargets(scope: ParentNode): void {
		scope.querySelectorAll<HTMLElement>(".db-calendar-day.is-drop-target, .db-calendar-week-day-col.is-drop-target, .db-calendar-week-allday-col.is-drop-target").forEach((el) => {
			el.removeClass("is-drop-target");
			el.querySelector(":scope > .db-calendar-drop-snap")?.remove();
		});
	}

	private clearAllDropTargets(): void {
		this.clearDropTargets(window.activeDocument);
	}

	private cleanupCurrentTimeTimer(): void {
		if (this.currentTimeTimer != null) {
			window.clearInterval(this.currentTimeTimer);
			this.currentTimeTimer = null;
		}
	}

	private setupColumnResize(handle: HTMLElement, config: ViewConfig, wrap: HTMLElement): void {
		handle.addEventListener("mousedown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const startX = event.clientX;
			const startWidth = this.getColumnWidth(config);
			let dragged = false;
			const onMove = (moveEvent: MouseEvent) => {
				dragged = true;
				const next = Math.max(60, Math.min(300, startWidth + moveEvent.clientX - startX));
				config.calendarColumnSizeMode = "custom";
				config.calendarCustomColumnWidth = next;
				wrap.style.setProperty("--db-calendar-col-width", `${next}px`);
			};
			// Week/day day headers are <button>s that open the day view; swallow the
			// synthetic click following a real drag so resizing never navigates.
			const swallowClick = (clickEvent: MouseEvent) => {
				clickEvent.stopPropagation();
				clickEvent.preventDefault();
				window.activeDocument.removeEventListener("click", swallowClick, true);
			};
			const onUp = () => {
				window.activeDocument.removeEventListener("mousemove", onMove, true);
				window.activeDocument.removeEventListener("mouseup", onUp, true);
				if (dragged) {
					window.activeDocument.addEventListener("click", swallowClick, true);
					// Fallback cleanup in case no click follows the drag.
					window.setTimeout(() => {
						window.activeDocument.removeEventListener("click", swallowClick, true);
					}, 300);
				}
				this.actions.onConfigChange?.(t("undo.columnWidthConfig"));
			};
			window.activeDocument.addEventListener("mousemove", onMove, true);
			window.activeDocument.addEventListener("mouseup", onUp, true);
		});
	}

	private applyMonthSizingVars(wrap: HTMLElement, config: ViewConfig): void {
		if (config.calendarColumnSizeMode === "custom") wrap.style.setProperty("--db-calendar-col-width", `${this.getColumnWidth(config)}px`);
		wrap.style.setProperty("--db-calendar-day-min-height", `${this.getCellMinHeight(config)}px`);
	}

	private applyTimeGridSizingVars(wrap: HTMLElement, config: ViewConfig, dayCount: number): void {
		const visible = getCalendarVisibleHourRange(config);
		const hourHeight = getCalendarHourHeight(config);
		wrap.style.setProperty("--db-calendar-time-day-count", String(dayCount));
		if (config.calendarColumnSizeMode === "custom") {
			// Mirror month view: a fixed column width lets users widen day columns.
			// All three time grids (header / all-day / time columns) consume this var,
			// and because they share one scroll container they stay aligned on overflow.
			wrap.style.setProperty("--db-calendar-col-width", `${this.getColumnWidth(config)}px`);
		}
		wrap.style.setProperty("--db-calendar-hour-height", `${hourHeight}px`);
		wrap.style.setProperty("--db-calendar-visible-hours", String(visible.endHour - visible.startHour));
	}

	private getColumnWidth(config: ViewConfig): number {
		// 日视图单列：宽范围 300–1900，接近 Obsidian 全宽
		// 月/周 7 列：保持 80–320 上限防止过宽
		const colMin = config.calendarScale === "day" ? 300 : 80;
		const colMax = config.calendarScale === "day" ? 1900 : 320;
		if (config.calendarColumnSizeMode === "custom" && config.calendarCustomColumnWidth) return Math.max(colMin, Math.min(colMax, config.calendarCustomColumnWidth));
		return Math.max(colMin, Math.min(240, this.getDefaultColumnWidth(config)));
	}

	private getRowHeight(config: ViewConfig, _weekIndex: number): number | undefined {
		if (config.calendarRowSizeMode !== "custom") return undefined;
		return this.getCellMinHeight(config);
	}

	private getCellMinHeight(config: ViewConfig): number {
		const value = config.calendarCellMinHeight ?? 112;
		return Math.max(72, Math.min(400, Math.round(value)));
	}

	private getMonthVisibleLaneLimit(config: ViewConfig): number {
		const hardMax = 15;
		// The row-height guardrail only applies to a CUSTOM row height: an explicit
		// "events per day" value must not exceed what that fixed height fits, or the
		// grid would stretch past the chosen height. Under ADAPTIVE row height the
		// row grows to fit, so the explicit setting is honored up to the hard cap —
		// that is the point of adaptive (otherwise a tall setting would be silently
		// capped by the default height and never take effect).
		if (config.calendarRowSizeMode === "custom") {
			const byRowHeight = Math.max(1, Math.floor((this.getCellMinHeight(config) - 36) / 24));
			const cap = Math.min(hardMax, byRowHeight);
			if (config.calendarMonthVisibleLanes != null) {
				return Math.max(1, Math.min(cap, Math.floor(config.calendarMonthVisibleLanes)));
			}
			return Math.max(1, cap);
		}
		if (config.calendarMonthVisibleLanes != null) {
			return Math.max(1, Math.min(hardMax, Math.floor(config.calendarMonthVisibleLanes)));
		}
		// Adaptive, no explicit setting: fall back to what the default height fits.
		return Math.max(1, Math.min(hardMax, Math.floor((this.getCellMinHeight(config) - 36) / 24)));
	}

	private getDefaultColumnWidth(config: ViewConfig): number {
		const fallback = 150;
		const value = config.defaultColumnWidth || fallback;
		return Number.isFinite(value) ? value : fallback;
	}

	private renderCalendarScaleControl(parent: HTMLElement, config: ViewConfig, currentScale: "month" | "week" | "day", anchorDateKey: string): void {
		const options: Array<{ value: "month" | "week" | "day"; text: string }> = [
			{ value: "day", text: t("calendar.scaleDay") },
			{ value: "week", text: t("calendar.scaleWeek") },
			{ value: "month", text: t("calendar.scaleMonth") },
		];
		const activeScale = config.calendarScale || currentScale;
		const control = parent.createDiv({
			cls: "db-calendar-scale-control",
			attr: { role: "group" },
		});
		const segment = control.createDiv({ cls: "db-calendar-scale-segment" });
		for (const option of options) {
			const active = option.value === activeScale;
			const button = segment.createEl("button", {
				cls: `db-calendar-scale-button${active ? " is-active" : ""}`,
				text: option.text,
				attr: { type: "button", "aria-pressed": active ? "true" : "false" },
			});
			button.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.setCalendarScale(config, option.value, anchorDateKey);
			};
		}
		const activeText = options.find((option) => option.value === activeScale)?.text || t("calendar.scaleMonth");
		const menuButton = control.createEl("button", {
			cls: "db-calendar-scale-menu db-calendar-nav-button is-text",
			attr: {
				type: "button",
				"aria-haspopup": "listbox",
			},
		});
		menuButton.createSpan({ cls: "db-calendar-scale-menu-label", text: activeText });
		setIcon(menuButton.createSpan({ cls: "db-calendar-nav-icon db-calendar-scale-menu-chevron" }), "chevron-down");
		menuButton.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.closeCalendarScaleMenu();
			this.calendarScaleMenuCleanup = openDropdownMenu({
				anchor: menuButton,
				label: t("viewConfig.calendarScale"),
				options,
				value: activeScale,
				popoverClassName: "db-calendar-scale-popover",
				onChange: (value) => {
					this.setCalendarScale(config, value === "day" || value === "week" ? value : "month", anchorDateKey);
					this.closeCalendarScaleMenu();
				},
			});
		};
	}

	private setCalendarScale(config: ViewConfig, scale: "month" | "week" | "day", anchorDateKey: string): void {
		this.closeCalendarScaleMenu();
		if ((config.calendarScale || "month") === scale) return;
		const anchor = this.normalizeCalendarScaleAnchor(anchorDateKey)
			|| this.normalizeCalendarScaleAnchor(config.calendarDay || "")
			|| this.normalizeCalendarScaleAnchor(config.calendarWeekStart || "")
			|| this.normalizeCalendarScaleAnchor(config.calendarMonth || "")
			|| this.getTodayDateKey();
		if (this.actions.updateCalendarScale) {
			this.actions.updateCalendarScale(scale, anchor, t("undo.calendarScaleConfig"));
			return;
		}
		config.calendarScale = scale;
		config.calendarMonth = anchor.slice(0, 7);
		config.calendarWeekStart = anchor;
		config.calendarDay = anchor;
		this.actions.onConfigChange?.(t("undo.calendarScaleConfig"));
	}

	private closeCalendarScaleMenu(): void {
		this.calendarScaleMenuCleanup?.();
		this.calendarScaleMenuCleanup = null;
	}

	private normalizeCalendarScaleAnchor(value: string): string | null {
		if (/^\d{4}-\d{2}-\d{2}$/.test(value) && parseDateKeyToUtc(value)) return value;
		if (/^\d{4}-\d{2}$/.test(value) && parseDateKeyToUtc(`${value}-01`)) return `${value}-01`;
		return null;
	}

	private renderNavButton(parent: HTMLElement, labelKey: string, onClick: () => void, icon?: string): void {
		const button = parent.createEl("button", {
			cls: `db-calendar-nav-button${icon ? " is-icon" : " is-text"}`,
			attr: { type: "button", title: t(labelKey), "aria-label": t(labelKey) },
		});
		if (icon) {
			setIcon(button.createSpan({ cls: "db-calendar-nav-icon" }), icon);
		} else {
			button.setText(t(labelKey));
		}
		button.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		};
	}

	private attachDayViewNavigation(button: HTMLElement, config: ViewConfig, dateKey: string): void {
		button.onclick = (event) => {
			event.stopPropagation();
		};
		button.ondblclick = (event) => {
			if (this.isColumnResizeHandleEvent(event)) return;
			event.preventDefault();
			event.stopPropagation();
			this.openDayFromTimeHeader(config, dateKey);
		};
		button.oncontextmenu = (event) => {
			if (this.isColumnResizeHandleEvent(event)) return;
			if (!this.isPhoneLayout()) return;
			event.preventDefault();
			event.stopPropagation();
			this.showDayViewNavigationMenu(event, config, dateKey);
		};
	}

	private isColumnResizeHandleEvent(event: MouseEvent): boolean {
		return !!(event.target as HTMLElement | null)?.closest(".db-calendar-col-resize-handle");
	}

	private showDayViewNavigationMenu(event: MouseEvent, config: ViewConfig, dateKey: string): void {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(t("calendar.openDayView"))
			.setIcon("calendar-days")
			.onClick(() => this.openDayFromTimeHeader(config, dateKey)));
		menu.showAtMouseEvent(event);
	}

	private isPhoneLayout(): boolean {
		return window.activeDocument.body.classList.contains("is-phone");
	}

	private openDayFromTimeHeader(config: ViewConfig, dateKey: string): void {
		if (config.calendarScale === "week") {
			config.calendarScale = "day";
		}
		config.calendarDay = dateKey;
		this.actions.onConfigChange?.(t("undo.calendarScaleConfig"));
	}

	private shiftMonth(config: ViewConfig, model: { year: number; monthIndex: number }, delta: number): void {
		config.calendarMonth = shiftCalendarMonth(`${String(model.year).padStart(4, "0")}-${String(model.monthIndex + 1).padStart(2, "0")}`, delta);
		this.actions.onConfigChange?.(t("undo.calendarMonthConfig"));
	}

	private setMonth(config: ViewConfig, date: Date): void {
		config.calendarMonth = this.monthKeyFromDate(date);
		config.calendarDay = this.getTodayDateKey(date);
		config.calendarWeekStart = config.calendarDay;
		this.requestCalendarDateFlash(config.calendarDay);
		this.actions.onConfigChange?.(t("undo.calendarMonthConfig"));
	}

	private renderCalendarTitle(parent: HTMLElement, parts: CalendarTitleParts): void {
		const title = parent.createDiv({
			cls: "db-calendar-title",
			attr: { title: parts.ariaLabel, "aria-label": parts.ariaLabel },
		});
		title.createSpan({ cls: "db-calendar-title-main", text: parts.main });
		if (parts.year) title.createSpan({ cls: "db-calendar-title-year", text: parts.year });
	}

	private formatMonthTitle(year: number, monthIndex: number): string {
		return new Intl.DateTimeFormat(getEffectiveLocale(),{ month: "long", year: "numeric" }).format(new Date(year, monthIndex, 1));
	}

	private getMiniCalendarYearRangeStart(year: number): number {
		return Math.floor(year / 12) * 12;
	}

	private formatWeekDayName(dateKey: string): string {
		const date = parseDateKeyToUtc(dateKey);
		if (!date) return "";
		return new Intl.DateTimeFormat(getEffectiveLocale(),{ weekday: "short", timeZone: "UTC" }).format(date);
	}

	private formatHourLabel(hour: number): string {
		// 统一使用双位数字格式，避免中文 locale 追加"时"字
		return String(hour % 24).padStart(2, "0");
	}

	private isCurrentCalendarHourTick(hour: number, days: CalendarDayModel[], now = new Date()): boolean {
		if (hour !== now.getHours()) return false;
		const todayKey = this.getTodayDateKey(now);
		return days.some((day) => day.dateKey === todayKey);
	}

	private dateKeyFromDate(date: Date): string {
		return dateKeyFromUtc(date);
	}

	private monthKeyFromDate(date: Date): string {
		return monthKeyFromLocalDate(date);
	}

	private getWeekdayLabels(weekStartsOn: number): string[] {
		return getWeekdayLabels(getEffectiveLocale(), weekStartsOn);
	}

	private getLocaleWeekStartsOn(config?: ViewConfig): number {
		return getLocaleWeekStartsOn(config);
	}

	private getTodayDateKey(date = new Date()): string {
		return getLocalDateKey(date);
	}

	private getTitleField(config: ViewConfig): string | undefined {
		return config.calendarTitleField || config.titleField;
	}

	private applyEventColor(element: HTMLElement, color: string | undefined): void {
		if (!color) return;
		element.style.setProperty("--card-accent", `var(--status-color-fg-${color})`);
		element.style.setProperty("--card-bg", `var(--status-color-bg-${color})`);
		element.style.setProperty("--db-calendar-event-accent", `var(--status-color-fg-${color})`);
		element.style.setProperty("--db-calendar-event-bg", `var(--status-color-bg-${color})`);
	}

	private uniqueEventsForDay(events: CalendarTimelineEvent[]): CalendarTimelineEvent[] {
		const seen = new Set<string>();
		return events.filter((event) => {
			if (seen.has(event.id)) return false;
			seen.add(event.id);
			return true;
		});
	}

	private minuteFromPointer(dayCol: HTMLElement, clientY: number, metrics: TimeGridMetrics): number {
		const rect = dayCol.getBoundingClientRect();
		const y = Math.max(0, Math.min(metrics.gridHeight, clientY - rect.top));
		return Math.max(metrics.startMinutes, Math.min(metrics.endMinutes, metrics.startMinutes + (y / metrics.hourHeight) * 60));
	}

	private snapTime(minutes: number): number {
		return snapMinutes(minutes);
	}

	private snapDeltaMinutes(minutes: number): number {
		return snapMinutes(minutes);
	}

	private getRenderedTimeGridDateKeys(eventEl: HTMLElement): string[] {
		const columns = eventEl.closest<HTMLElement>(".db-calendar-time-columns");
		return Array.from(columns?.querySelectorAll<HTMLElement>(".db-calendar-week-day-col") || [])
			.map((col) => col.dataset.dateKey || "")
			.filter(Boolean);
	}

	private getDateKeyFromPointer(eventEl: HTMLElement, clientX: number, dateKeys: string[]): string | null {
		const columns = eventEl.closest<HTMLElement>(".db-calendar-time-columns");
		const dayCols = Array.from(columns?.querySelectorAll<HTMLElement>(".db-calendar-week-day-col") || []);
		for (let index = 0; index < dayCols.length; index++) {
			const rect = dayCols[index].getBoundingClientRect();
			if (clientX >= rect.left && clientX <= rect.right) return dateKeys[index] || null;
		}
		return null;
	}

	private renderEmpty(container: HTMLElement, key: string): void {
		container.createDiv({ cls: "db-empty", text: t(key) });
	}
}
