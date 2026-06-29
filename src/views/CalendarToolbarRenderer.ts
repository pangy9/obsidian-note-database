import { setIcon } from "obsidian";
import { getColumnDisplayType } from "../data/ColumnDisplay";
import { isDateLikeColumnType } from "../data/DateTimeFormat";
import { ColumnDef, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { HOUR_HEIGHT_MIN } from "../data/CalendarLayoutModel";
import { createDropdownField, DropdownOption } from "./DropdownField";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { positionToolbarPopover } from "./PopoverPosition";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon } from "./PropertyTypeIcon";

/** Actions exposed by the calendar toolbar settings panel. */
export interface CalendarToolbarActions {
	onChange(label?: string): void;
	/** Async count of hidden invalid events; the notice shows "calculating..." until it resolves. */
	getInvalidEventCount?: () => number | Promise<number>;
	/** Open the modal to review/fix negative-interval events. */
	openInvalidEvents?: () => void;
}

/**
 * Renders a dedicated settings popover for the calendar view.
 *
 * Sections:
 *   Data   - start/end date field, title field
 *   Style  - color field, show field labels toggle
 *   Sizing - custom column/row width, week slot duration
 *
 * Reuses the same popover patterns (CSS classes, auto-close, dropdown integration)
 * as CalendarTimelineToolbarRenderer.
 */
export class CalendarToolbarRenderer {
	private cleanupPopover?: () => void;
	private popover?: HTMLElement;
	private popoverContent?: HTMLElement;

	/** Toggle the calendar settings popover open or closed. */
	togglePopover(containerEl: HTMLElement, anchor: HTMLElement, config: ViewConfig | undefined, actions: CalendarToolbarActions): void {
		if (!config || config.viewType !== "calendar") return;
		if (this.popover?.isConnected) {
			this.closePopover();
			return;
		}
		this.openPopover(containerEl, anchor, config, actions);
	}

	/** Close and clean up the calendar settings popover. */
	closePopover(): void {
		this.cleanupPopover?.();
		this.cleanupPopover = undefined;
	}

	// ── Private helpers ──

	private openPopover(containerEl: HTMLElement, anchor: HTMLElement, config: ViewConfig, actions: CalendarToolbarActions): void {
		this.closePopover();

		const panel = containerEl.createDiv({ cls: "db-calendar-options-popover db-chart-options-popover" });
		this.popover = panel;

		// Panel header
		const header = panel.createDiv({ cls: "db-panel-header" });
		header.createDiv({ cls: "db-panel-title", text: t("calendar.options") });

		// Sections render into a content wrapper so a scale change can rebuild them
		// in place (week/day expose different settings than month) without reopening.
		const content = panel.createDiv({ cls: "db-calendar-options-content" });
		this.popoverContent = content;
		this.renderSections(content, config, actions);

		positionToolbarPopover(panel, anchor, { preferredWidth: 420, maxWidth: 480 });

		// Outside-click handler
		const onOutside = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (target && (panel.contains(target) || anchor.contains(target) || this.isInsideDropdown(target))) return;
			this.closePopover();
		};

		// Escape key handler
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			this.closePopover();
		};

		const outsideTimer = window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
		window.activeDocument.addEventListener("keydown", onKeyDown, true);

		const cleanupAutoClose = installPopoverAutoClose({
			panel,
			anchorEl: anchor,
			delayMs: 12000,
			isActiveTarget: (target) => target instanceof Node && (panel.contains(target) || this.isInsideDropdown(target)),
			close: () => this.closePopover(),
		});

		this.cleanupPopover = () => {
			window.clearTimeout(outsideTimer);
			window.activeDocument.removeEventListener("mousedown", onOutside, true);
			window.activeDocument.removeEventListener("keydown", onKeyDown, true);
			cleanupAutoClose();
			panel.remove();
			this.popover = undefined;
			this.popoverContent = undefined;
		};
	}

	// ── Data section: scale, start date, end date, title field ──

	private renderSections(content: HTMLElement, config: ViewConfig, actions: CalendarToolbarActions): void {
		content.empty();
		this.renderDataSection(content, config, actions);
		this.renderLayoutSection(content, config, actions);
		// The time grid (visible hours / hour height) only exists in week & day views,
		// so hide the whole Time section in month view to avoid dead controls.
		if (config.calendarScale === "week" || config.calendarScale === "day") {
			this.renderTimeSection(content, config, actions);
		}
		this.renderAppearanceSection(content, config, actions);
	}

	private renderDataSection(panel: HTMLElement, config: ViewConfig, actions: CalendarToolbarActions): void {
		const data = this.createSection(panel, t("chart.optionsData"));

		// 顺序与时间线 popover 对齐：start → end → 同字段警告 → invalid 提示 → title → scale → year。
		this.renderSelect(data, t("viewConfig.eventStartDateField"), this.getDateFieldOptions(config), config.calendarStartDateField || "", (value) => {
			config.calendarStartDateField = value || undefined;
			actions.onChange(t("undo.calendarStartFieldConfig"));
			if (this.popoverContent) this.renderSections(this.popoverContent, config, actions);
		}, "calendar-days");

		this.renderSelect(data, t("viewConfig.eventEndDateField"), this.getDateFieldOptions(config), config.calendarEndDateField || "", (value) => {
			config.calendarEndDateField = value || undefined;
			actions.onChange(t("undo.calendarEndFieldConfig"));
			if (this.popoverContent) this.renderSections(this.popoverContent, config, actions);
		}, "calendar-range");

		this.renderSameDateFieldWarning(data, config.calendarStartDateField, config.calendarEndDateField);
		this.renderInvalidEventsNotice(data, actions);

		this.renderSelect(data, t("viewConfig.eventTitleField"), this.getAnyFieldOptions(config), config.calendarTitleField || "", (value) => {
			config.calendarTitleField = value || undefined;
			actions.onChange(t("undo.calendarTitleFieldConfig"));
		}, "text-cursor-input");

		// Calendar scale dropdown (Issue 9: moved from header buttons)
		this.renderSelect(data, t("viewConfig.calendarScale"), [
			{ value: "month", text: t("calendar.scaleMonth") },
			{ value: "week", text: t("calendar.scaleWeek") },
			{ value: "day", text: t("calendar.scaleDay") },
		], config.calendarScale || "month", (value) => {
			config.calendarScale = value === "day" || value === "week" ? value : "month";
			actions.onChange(t("undo.calendarScaleConfig"));
			// Rebuild the panel so week/day-specific sections (Time, all-day lanes)
			// appear immediately instead of requiring a reopen.
			if (this.popoverContent) this.renderSections(this.popoverContent, config, actions);
		}, "layout-grid");

		this.renderSelect(data, t("viewConfig.yearDisplayMode"), [
			{ value: "always", text: t("viewConfig.yearDisplayMode.always") },
			{ value: "smart", text: t("viewConfig.yearDisplayMode.smart") },
			{ value: "never", text: t("viewConfig.yearDisplayMode.never") },
		], config.yearDisplayMode || "always", (value) => {
			config.yearDisplayMode = value === "always" || value === "smart" || value === "never" ? value : undefined;
			actions.onChange(t("undo.yearDisplayModeConfig"));
		}, "calendar");
	}

	private renderSameDateFieldWarning(parent: HTMLElement, startField: string | undefined, endField: string | undefined): void {
		if (!startField || !endField || startField !== endField) return;
		parent.createDiv({ cls: "db-calendar-same-date-warning", text: t("calendar.sameDateFieldWarning") });
	}

	/** 无效时间事件提示 + 修复入口（A2：popover 内完整 warning，对齐时间线）：⚠️ + 冲突数 + [修复]。 */
	private renderInvalidEventsNotice(parent: HTMLElement, actions: CalendarToolbarActions): void {
		if (!actions.getInvalidEventCount || !actions.openInvalidEvents) return;
		const row = parent.createDiv({ cls: "db-calendar-same-date-warning db-calendar-invalid-events-row" });
		const renderCount = (count: number) => {
			if (!row.isConnected) return;
			if (count <= 0) { row.remove(); return; }
			row.empty();
			setIcon(row.createSpan({ cls: "db-calendar-invalid-events-icon" }), "alert-triangle");
			row.createSpan({ cls: "db-calendar-invalid-events-text", text: t("timeline.invalidEventsConflictNotice", { count }) });
			const btn = row.createEl("button", { cls: "db-calendar-invalid-events-btn", text: t("timeline.fixInvalidEvents") });
			btn.onclick = () => actions.openInvalidEvents?.();
		};
		const result = actions.getInvalidEventCount();
		if (typeof result === "number") {
			renderCount(result);
			return;
		}
		row.createSpan({ text: t("timeline.invalidEventsCalculating") });
		void result
			.then((count) => renderCount(count))
			.catch(() => { if (row.isConnected) row.remove(); });
	}

	// ── Layout section: column width and month row height ──

	private renderLayoutSection(panel: HTMLElement, config: ViewConfig, actions: CalendarToolbarActions): void {
		const sizing = this.createSection(panel, t("calendar.layout"));
		this.renderSizingRows(sizing, config, actions);
	}

	// ── Time section: visible hours, hour height, slot duration ──

	private renderTimeSection(panel: HTMLElement, config: ViewConfig, actions: CalendarToolbarActions): void {
		const time = this.createSection(panel, t("calendar.time"));
		this.renderRange(time, t("viewConfig.calendarStartHour"), config.calendarStartHour ?? 0, 0, 23, 1, (value) => {
			config.calendarStartHour = Math.max(0, Math.min(23, Math.round(value)));
			if ((config.calendarEndHour ?? 24) <= config.calendarStartHour) config.calendarEndHour = Math.min(24, config.calendarStartHour + 1);
			actions.onChange(t("undo.calendarTimeWindowConfig"));
		}, (value) => {
			config.calendarStartHour = Math.max(0, Math.min(23, Math.round(value)));
		});
		this.renderRange(time, t("viewConfig.calendarEndHour"), config.calendarEndHour ?? 24, 1, 24, 1, (value) => {
			config.calendarEndHour = Math.max(1, Math.min(24, Math.round(value)));
			if (config.calendarEndHour <= (config.calendarStartHour ?? 0)) config.calendarStartHour = Math.max(0, config.calendarEndHour - 1);
			actions.onChange(t("undo.calendarTimeWindowConfig"));
		}, (value) => {
			config.calendarEndHour = Math.max(1, Math.min(24, Math.round(value)));
		});
		this.renderRange(time, t("viewConfig.calendarHourHeight"), config.calendarHourHeight ?? HOUR_HEIGHT_MIN, HOUR_HEIGHT_MIN, 96, 2, (value) => {
			config.calendarHourHeight = Math.max(HOUR_HEIGHT_MIN, Math.min(96, Math.round(value)));
			actions.onChange(t("undo.calendarHourHeightConfig"));
		}, (value) => {
			config.calendarHourHeight = Math.max(HOUR_HEIGHT_MIN, Math.min(96, Math.round(value)));
		});
		if (config.calendarScale === "week" || config.calendarScale === "day") {
			this.renderSelect(time, t("viewConfig.calendarWeekSlotDuration"), [
				{ value: "15", text: t("viewConfig.calendarWeekSlotDuration.15") },
				{ value: "30", text: t("viewConfig.calendarWeekSlotDuration.30") },
				{ value: "60", text: t("viewConfig.calendarWeekSlotDuration.60") },
			], String(config.calendarWeekSlotDuration || 30), (value) => {
				const num = Number(value);
				if (num === 15 || num === 30 || num === 60) config.calendarWeekSlotDuration = num;
				actions.onChange(t("undo.calendarSlotDurationConfig"));
			}, "clock");
		}
	}

	// ── Appearance section: color field, show field labels ──

	private renderAppearanceSection(panel: HTMLElement, config: ViewConfig, actions: CalendarToolbarActions): void {
		const style = this.createSection(panel, t("calendar.appearance"));
		this.renderSelect(style, t("viewConfig.eventColorField"), this.getColorFieldOptions(config), config.calendarColorField || "", (value) => {
			config.calendarColorField = value || undefined;
			actions.onChange(t("undo.calendarColorFieldConfig"));
		}, "palette");
	}

	/** Render the sizing rows (used by renderSizingSection and refreshSizingRows). */
	private renderSizingRows(sizing: HTMLElement, config: ViewConfig, actions: CalendarToolbarActions): void {
		// Column width applies to all scales (month / week / day).
			// Column width mode dropdown (Issue 7: replace switch with dropdown)
			this.renderSelect(sizing, t("viewConfig.calendarColumnSizeMode"), [
				{ value: "adaptive", text: t("viewConfig.calendarColumnSizeMode.adaptive") },
				{ value: "custom", text: t("viewConfig.calendarColumnSizeMode.custom") },
			], config.calendarColumnSizeMode || "adaptive", (value) => {
				config.calendarColumnSizeMode = value === "custom" ? "custom" : "adaptive";
				if (value === "custom") {
					config.calendarCustomColumnWidth = config.calendarCustomColumnWidth || 120;
				} else {
					config.calendarCustomColumnWidth = undefined;
				}
				this.refreshSizingRows(sizing, config, actions);
				actions.onChange(t("undo.calendarColumnSizeConfig"));
			}, "columns-3");

			// Column width range slider (only when custom mode is active)
			if (config.calendarColumnSizeMode === "custom") {
					const colMin = config.calendarScale === "day" ? 300 : 60;
					const colMax = config.calendarScale === "day" ? 1900 : 300;
					const setColumnWidth = (value: number) => {
						config.calendarCustomColumnWidth = Math.max(colMin, Math.min(colMax, Math.round(value)));
					};
					this.renderRange(sizing, t("viewConfig.calendarColumnWidthValue"), config.calendarCustomColumnWidth || colMin, colMin, colMax, 4, (value) => {
						setColumnWidth(value);
						actions.onChange(t("undo.calendarColumnSizeConfig"));
					}, setColumnWidth);

			}
		// First day of the week applies to every scale (month weekday rows + week/day
		// columns), so it is always shown. "" = follow the system locale.
		this.renderSelect(sizing, t("viewConfig.calendarFirstDayOfWeek"), [
			{ value: "", text: t("viewConfig.calendarFirstDayOfWeek.auto") },
			{ value: "0", text: t("viewConfig.calendarFirstDayOfWeek.0") },
			{ value: "1", text: t("viewConfig.calendarFirstDayOfWeek.1") },
			{ value: "6", text: t("viewConfig.calendarFirstDayOfWeek.6") },
		], config.calendarFirstDayOfWeek == null ? "" : String(config.calendarFirstDayOfWeek), (value) => {
			const num = Number(value);
			config.calendarFirstDayOfWeek = num === 0 || num === 1 || num === 6 ? num : undefined;
			actions.onChange(t("undo.calendarFirstDayOfWeekConfig"));
		}, "calendar-days");

		// Row height only affects the month grid (in week/day, row height == hour
		// height, which has its own setting). Hide it outside month so the Layout
		// section never offers a control that does nothing for the current scale.
		if (config.calendarScale !== "week" && config.calendarScale !== "day") {
			// Row height mode dropdown (Issue 7: replace switch with dropdown)
			this.renderSelect(sizing, t("viewConfig.calendarRowSizeMode"), [
				{ value: "adaptive", text: t("viewConfig.calendarRowSizeMode.adaptive") },
				{ value: "custom", text: t("viewConfig.calendarRowSizeMode.custom") },
			], config.calendarRowSizeMode || "adaptive", (value) => {
				config.calendarRowSizeMode = value === "custom" ? "custom" : "adaptive";
				if (value !== "custom") {
					config.calendarCustomRowHeights = undefined;
					config.calendarCellMinHeight = undefined;
				}
				this.refreshSizingRows(sizing, config, actions);
				actions.onChange(t("undo.calendarRowSizeConfig"));
			}, "rows-3");

			// Row height range slider (Issue 10: uniform row height for all rows)
			if (config.calendarRowSizeMode === "custom") {
				const setRowHeight = (value: number) => {
					config.calendarCellMinHeight = Math.max(72, Math.min(400, Math.round(value)));
				};
				this.renderRange(sizing, t("viewConfig.calendarRowHeightValue"), config.calendarCellMinHeight ?? 104, 72, 400, 4, (value) => {
					setRowHeight(value);
					// Rebuild the sizing rows so the "events per day" slider's max tracks
					// the new row height (a smaller row must cap the lane count lower).
					this.refreshSizingRows(sizing, config, actions);
					actions.onChange(t("undo.calendarRowSizeConfig"));
				}, setRowHeight);
			}

			// Max events shown per month day before "+N". Unset derives from row height,
			// so the slider starts at the current effective value. Under a custom row
			// height the max is capped at what that height fits, so a high setting can't
			// stretch the grid taller than the chosen row height.
			const derivedMonthLanes = Math.max(1, Math.floor(((config.calendarCellMinHeight ?? 112) - 36) / 24));
			const monthLanesMax = config.calendarRowSizeMode === "custom" ? derivedMonthLanes : 15;
			const monthLanesValue = Math.min(config.calendarMonthVisibleLanes ?? derivedMonthLanes, monthLanesMax);
			this.renderRange(sizing, t("viewConfig.calendarMonthVisibleLanes"), monthLanesValue, 1, monthLanesMax, 1, (value) => {
				config.calendarMonthVisibleLanes = Math.max(1, Math.min(monthLanesMax, Math.round(value)));
				actions.onChange(t("undo.calendarMonthLanesConfig"));
			}, (value) => {
				config.calendarMonthVisibleLanes = Math.max(1, Math.min(monthLanesMax, Math.round(value)));
			});
		}

		// All-day strip max lanes only exists in week/day views.
		if (config.calendarScale === "week" || config.calendarScale === "day") {
			this.renderRange(sizing, t("viewConfig.calendarAllDayMaxLanes"), config.calendarAllDayMaxLanes ?? 2, 1, 6, 1, (value) => {
				config.calendarAllDayMaxLanes = Math.max(1, Math.min(6, Math.round(value)));
				actions.onChange(t("undo.calendarAllDayLanesConfig"));
			}, (value) => {
				config.calendarAllDayMaxLanes = Math.max(1, Math.min(6, Math.round(value)));
			});
		}

	}

	/**
	 * Refresh the sizing section rows in-place when toggling mode dropdowns.
	 */
	private refreshSizingRows(sizingEl: HTMLElement, config: ViewConfig, actions: CalendarToolbarActions): void {
		sizingEl.empty();
		sizingEl.createDiv({ cls: "db-chart-options-section-title", text: t("calendar.layout") });
		this.renderSizingRows(sizingEl, config, actions);
	}

	// ── Shared UI helpers (same pattern as CalendarTimelineToolbarRenderer) ──

	private createSection(panel: HTMLElement, title: string): HTMLElement {
		const section = panel.createDiv({ cls: "db-chart-options-section" });
		section.createDiv({ cls: "db-chart-options-section-title", text: title });
		return section;
	}

	private renderSelect(
		parent: HTMLElement,
		label: string,
		options: DropdownOption[],
		value: string,
		onChange: (value: string) => void,
		icon: string,
	): void {
		createDropdownField({
			parent,
			label,
			options,
			value,
			onChange,
			icon,
			className: "db-chart-options-dropdown",
			popoverClassName: "db-calendar-options-dropdown",
			searchable: options.length > 8,
			renderIcon: (iconEl, iconName) => {
				if (!renderDropdownPropertyTypeIcon(iconEl, iconName)) setIcon(iconEl, iconName);
			},
		});
	}

	private renderSwitch(parent: HTMLElement, label: string, value: boolean, onChange: (value: boolean) => void, icon: string): void {
		const row = parent.createEl("label", { cls: "db-chart-options-row db-chart-options-switch-row" });
		setIcon(row.createSpan({ cls: "db-chart-options-row-icon" }), icon);
		row.createDiv({ cls: "db-chart-options-row-text" }).createSpan({ cls: "db-chart-options-label", text: label });
		const input = row.createEl("input", { cls: "db-toggle-switch", attr: { type: "checkbox", role: "switch" } });
		input.checked = value;
		input.onchange = () => onChange(input.checked);
	}

	private renderRange(
		parent: HTMLElement,
		label: string,
		value: number,
		min: number,
		max: number,
		step: number,
		onChange: (value: number) => void,
		onInput?: (value: number) => void,
	): void {
		const row = parent.createDiv({ cls: "db-chart-options-row db-calendar-range-row" });
		setIcon(row.createSpan({ cls: "db-chart-options-row-icon" }), "ruler");
		const text = row.createDiv({ cls: "db-chart-options-row-text" });
		text.createSpan({ cls: "db-chart-options-label", text: label });
		const controls = row.createDiv({ cls: "db-view-config-range" });
		const range = controls.createEl("input", {
			attr: { type: "range", min: String(min), max: String(max), step: String(step) },
		});
		const number = controls.createEl("input", {
			cls: "db-view-config-number",
			attr: { type: "number", min: String(min), max: String(max), step: String(step) },
		});
		const clamp = (next: number): number => Math.max(min, Math.min(max, Math.round(next)));
		const initial = clamp(value);
		range.value = String(initial);
		number.value = String(initial);
		range.oninput = () => {
			const next = clamp(Number(range.value));
			number.value = String(next);
			onInput?.(next);
		};
		range.onchange = () => onChange(clamp(Number(range.value)));
		number.oninput = () => {
			const raw = Number(number.value);
			if (!Number.isFinite(raw)) return;
			const next = clamp(raw);
			range.value = String(next);
			onInput?.(next);
		};
		number.onchange = () => {
			const next = clamp(Number(number.value) || value);
			number.value = String(next);
			range.value = String(next);
			onChange(next);
		};
	}

	// ── Field option builders (same logic as CalendarTimelineToolbarRenderer) ──

	private getDateFieldOptions(config: ViewConfig): DropdownOption[] {
		return [
			{ value: "", text: t("common.notSet") },
			...config.schema.columns
				.filter((col) => col.key !== "file.name" && isDateLikeColumnType(getColumnDisplayType(col, config.schema.computedFields)))
				.map((col) => {
					const type = getColumnDisplayType(col, config.schema.computedFields);
					return { value: col.key, text: col.label || col.key, icon: getPropertyDropdownIcon(type) };
				}),
		];
	}

	private getAnyFieldOptions(config: ViewConfig): DropdownOption[] {
		return [
			{ value: "", text: t("viewConfig.titleAuto") },
			...config.schema.columns.map((col) => ({
				value: col.key,
				text: col.label || col.key,
				icon: getPropertyDropdownIcon(getColumnDisplayType(col, config.schema.computedFields)),
			})),
		];
	}

	private getColorFieldOptions(config: ViewConfig): DropdownOption[] {
		const colorTypes = new Set<ColumnDef["type"]>(["status", "select", "multi-select"]);
		return [
			{ value: "", text: t("viewConfig.noColorField") },
			...config.schema.columns
				.filter((col) => colorTypes.has(getColumnDisplayType(col, config.schema.computedFields)))
				.map((col) => ({
					value: col.key,
					text: col.label || col.key,
					icon: getPropertyDropdownIcon(getColumnDisplayType(col, config.schema.computedFields)),
				})),
		];
	}

	private isInsideDropdown(target: Node): boolean {
		return target.instanceOf(HTMLElement) && Boolean(target.closest(".db-dropdown-popover"));
	}
}
