import { setIcon } from "obsidian";
import { getTimelineColumnWidthSpec, normalizeTimelineDayScale } from "../data/CalendarTimelineModel";
import { getColumnDisplayType } from "../data/ColumnDisplay";
import { isDateLikeColumnType } from "../data/DateTimeFormat";
import { ColumnDef, DatabaseConfig, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { createDropdownField, DropdownOption } from "./DropdownField";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { positionToolbarPopover } from "./PopoverPosition";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon } from "./PropertyTypeIcon";
import { getOrderedRecordIconColumns, getRecordIconFieldLabel, resolveRecordIconField } from "../data/RecordIcon";

export interface CalendarTimelineToolbarActions {
  onChange(label?: string): void;
  database?: DatabaseConfig;
  createRecordIconField?(): void;
  updateTimelineScale?(scale: NonNullable<ViewConfig["timelineScale"]>, label?: string): boolean | Promise<boolean> | void;
  /** Async count of hidden invalid events; the notice shows "calculating..." until it resolves. */
  getInvalidEventCount?: () => number | Promise<number>;
  /** Open the modal to review/fix negative-interval events. */
  openInvalidEvents?: () => void;
}

export class CalendarTimelineToolbarRenderer {
  private cleanupPopover?: () => void;
  private popover?: HTMLElement;
  private popoverContent?: HTMLElement;

  togglePopover(containerEl: HTMLElement, anchor: HTMLElement, config: ViewConfig | undefined, actions: CalendarTimelineToolbarActions): void {
    if (!config || config.viewType !== "timeline") return;
    if (this.popover?.isConnected) {
      this.closePopover();
      return;
    }
    this.openPopover(containerEl, anchor, config, actions);
  }

  closePopover(): void {
    this.cleanupPopover?.();
    this.cleanupPopover = undefined;
  }

  private openPopover(containerEl: HTMLElement, anchor: HTMLElement, config: ViewConfig, actions: CalendarTimelineToolbarActions): void {
    this.closePopover();
    const panel = containerEl.createDiv({ cls: "db-calendar-timeline-options-popover db-chart-options-popover" });
    this.popover = panel;
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("timeline.options") });
    const content = panel.createDiv({ cls: "db-calendar-timeline-options-content" });
    this.popoverContent = content;
    this.renderTimelineOptions(content, config, actions);
    positionToolbarPopover(panel, anchor, { preferredWidth: 420, maxWidth: 480 });

    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (panel.contains(target) || anchor.contains(target) || this.isInsideDropdown(target))) return;
      this.closePopover();
    };
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

  private renderTimelineOptions(panel: HTMLElement, config: ViewConfig, actions: CalendarTimelineToolbarActions): void {
    panel.empty();
    const data = this.createSection(panel, t("chart.optionsData"));
    this.renderSelect(data, t("viewConfig.eventStartDateField"), this.getDateFieldOptions(config), config.timelineStartDateField || "", (value) => {
      config.timelineStartDateField = value || undefined;
      normalizeTimelineDayScale(config);
      actions.onChange(t("undo.timelineStartFieldConfig"));
      if (this.popoverContent) this.renderTimelineOptions(this.popoverContent, config, actions);
    }, "calendar-days");
    this.renderSelect(data, t("viewConfig.eventEndDateField"), this.getDateFieldOptions(config), config.timelineEndDateField || "", (value) => {
      config.timelineEndDateField = value || undefined;
      normalizeTimelineDayScale(config);
      actions.onChange(t("undo.timelineEndFieldConfig"));
      if (this.popoverContent) this.renderTimelineOptions(this.popoverContent, config, actions);
    }, "calendar-range");
    this.renderSameDateFieldWarning(data, config.timelineStartDateField, config.timelineEndDateField);
    this.renderInvalidEventsNotice(data, actions);
    this.renderSelect(data, t("viewConfig.eventTitleField"), this.getAnyFieldOptions(config), config.timelineTitleField || "", (value) => {
      config.timelineTitleField = value || undefined;
      actions.onChange(t("undo.timelineTitleFieldConfig"));
    }, "text-cursor-input", true);
    this.renderSelect(data, t("viewConfig.timelineScale"), [
      { value: "day", text: t("viewConfig.timelineScale.day") },
      { value: "week", text: t("viewConfig.timelineScale.week") },
      { value: "month", text: t("viewConfig.timelineScale.month") },
      { value: "quarter", text: t("viewConfig.timelineScale.quarter") },
    ], config.timelineScale || "week", (value) => {
      const nextScale = this.normalizeTimelineScale(value);
      if (actions.updateTimelineScale) {
        void Promise.resolve(actions.updateTimelineScale(nextScale, t("undo.timelineScaleConfig"))).then((changed) => {
          if (changed !== false) this.refreshTimelineScaleDependentOptions(config, actions);
        });
        return;
      }
      config.timelineScale = nextScale;
      actions.onChange(t("undo.timelineScaleConfig"));
      this.refreshTimelineScaleDependentOptions(config, actions);
    }, "ruler");

    this.renderSelect(data, t("viewConfig.yearDisplayMode"), [
      { value: "always", text: t("viewConfig.yearDisplayMode.always") },
      { value: "smart", text: t("viewConfig.yearDisplayMode.smart") },
      { value: "never", text: t("viewConfig.yearDisplayMode.never") },
    ], config.yearDisplayMode || "always", (value) => {
      config.yearDisplayMode = value === "always" || value === "smart" || value === "never" ? value : undefined;
      actions.onChange(t("undo.yearDisplayModeConfig"));
    }, "calendar");

    this.renderSwitch(data, t("viewConfig.showEmptyFields"), config.showEmptyFields === true, (value) => {
      config.showEmptyFields = value || undefined;
      actions.onChange(t("undo.showEmptyFieldsConfig"));
    }, "rows-3");

    const layout = this.createSection(panel, t("timeline.layoutSection"));
    this.renderLayoutContent(layout, config, actions);

    const style = this.createSection(panel, t("chart.optionsStyle"));
    this.renderSelect(style, t("viewConfig.eventColorField"), this.getColorFieldOptions(config), config.timelineColorField || "", (value) => {
      config.timelineColorField = value || undefined;
      actions.onChange(t("undo.timelineColorFieldConfig"));
    }, "palette");
    this.renderRecordIconSettings(style, config, actions);
  }

  private renderRecordIconSettings(parent: HTMLElement, config: ViewConfig, actions: CalendarTimelineToolbarActions): void {
    const database = actions.database;
    if (!database) return;
    this.renderSwitch(parent, t("recordIcon.show"), config.showRecordIcon === true, (value) => {
      config.showRecordIcon = value || undefined;
      if (value && !resolveRecordIconField(database, config) && !database.recordIconField) config.recordIconFieldOverrideEnabled = true;
      actions.onChange(t("recordIcon.show"));
      if (this.popoverContent) this.renderTimelineOptions(this.popoverContent, config, actions);
    }, "smile-plus");
    if (config.showRecordIcon !== true) return;
    this.renderSwitch(parent, t("recordIcon.override"), config.recordIconFieldOverrideEnabled === true, (value) => {
      config.recordIconFieldOverrideEnabled = value || undefined;
      actions.onChange(t("recordIcon.override"));
      if (this.popoverContent) this.renderTimelineOptions(this.popoverContent, config, actions);
    }, "replace");
    if (config.recordIconFieldOverrideEnabled !== true) {
      const key = database.recordIconField || "";
      const column = key ? config.schema.columns.find((c) => c.key === key) : undefined;
      this.renderSelect(parent, t("recordIcon.field"), [{ value: key, text: getRecordIconFieldLabel(database, config) || t("common.notSet"), icon: column ? getPropertyDropdownIcon(getColumnDisplayType(column, config.schema.computedFields)) : undefined }], key, () => {}, "", false, true);
      return;
    }
    const options: DropdownOption[] = [
      { value: "", text: t("common.notSet") },
      ...getOrderedRecordIconColumns(config, config.recordIconField).map((column) => ({ value: column.key, text: column.label || column.key, icon: getPropertyDropdownIcon(getColumnDisplayType(column, config.schema.computedFields)) })),
      ...(actions.createRecordIconField ? [{ value: "__create_record_icon_field__", text: t("recordIcon.createField"), icon: "plus", preserveValueOnSelect: true }] : []),
    ];
    this.renderSelect(parent, t("recordIcon.field"), options, config.recordIconField || "", (value) => {
      if (value === "__create_record_icon_field__") { actions.createRecordIconField?.(); return; }
      config.recordIconField = value || undefined;
      actions.onChange(t("recordIcon.field"));
    }, "", true);
  }

  /** layout section 内容：自定义列宽开关 + 列宽滑块 + (day)时段粒度。开关列宽只重建本 section，
   *  不重建 data section（含 invalid 事件提示），避免无效事件提示「calculating→count」闪烁。 */
  private renderLayoutContent(layout: HTMLElement, config: ViewConfig, actions: CalendarTimelineToolbarActions): void {
    layout.empty();
    this.renderSwitch(layout, t("viewConfig.customColumnWidth"), config.timelineColumnSizeMode === "custom", (checked) => {
      config.timelineColumnSizeMode = checked ? "custom" : undefined;
      actions.onChange(t("undo.timelineColumnWidthConfig"));
      // 只重建 layout section（让列宽滑块行立即出现/消失），不重建 data section 以免 invalid 提示闪烁
      this.renderLayoutContent(layout, config, actions);
    }, "columns");
    if (config.timelineColumnSizeMode === "custom") {
      this.renderRange(layout, t("timeline.columnWidth"), config.timelineCustomUnitWidth ?? this.defaultUnitWidth(config), this.unitWidthMin(config), this.unitWidthMax(config), 1, (value) => {
        config.timelineCustomUnitWidth = value;
        actions.onChange(t("undo.timelineColumnWidthConfig"));
      });
    }
    if (config.timelineScale === "day") {
      this.renderSelect(layout, t("viewConfig.calendarWeekSlotDuration"), [
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

  private normalizeTimelineScale(value: string): NonNullable<ViewConfig["timelineScale"]> {
    return value === "day" || value === "month" || value === "quarter" ? value : "week";
  }

  private refreshTimelineScaleDependentOptions(config: ViewConfig, actions: CalendarTimelineToolbarActions): void {
    // 重建 popover：scale 影响 day 档「时段粒度」行是否显示，以及列宽滑块的 min/max/default 范围。
    if (this.popoverContent) this.renderTimelineOptions(this.popoverContent, config, actions);
  }

  private renderSameDateFieldWarning(parent: HTMLElement, startField: string | undefined, endField: string | undefined): void {
    if (!startField || !endField || startField !== endField) return;
    parent.createDiv({ cls: "db-calendar-same-date-warning", text: t("calendar.sameDateFieldWarning") });
  }

  /** 无效时间事件提示 + 修复入口（popover 内完整 warning）：⚠️ + 冲突数 + [修复]。 */
  private renderInvalidEventsNotice(parent: HTMLElement, actions: CalendarTimelineToolbarActions): void {
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
    // 让出主线程先渲染「计算中」，再异步统计；popover 在此期间已关闭则放弃更新。
    void result
      .then((count) => {
        renderCount(count);
      })
      .catch(() => { if (row.isConnected) row.remove(); });
  }

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
    searchable = options.length > 8,
    disabled = false,
  ): void {
    createDropdownField({
      parent,
      label,
      options,
      value,
      onChange,
      icon,
      className: "db-chart-options-dropdown",
      popoverClassName: "db-calendar-timeline-options-dropdown",
      searchable,
      disabled,
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

  private renderRange(parent: HTMLElement, label: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void): void {
    const row = parent.createDiv({ cls: "db-chart-options-row db-calendar-range-row db-calendar-timeline-range-row" });
    setIcon(row.createSpan({ cls: "db-chart-options-row-icon" }), "ruler");
    const text = row.createDiv({ cls: "db-chart-options-row-text" });
    text.createSpan({ cls: "db-chart-options-label", text: label });
    const control = row.createDiv({ cls: "db-view-config-range" });
    const slider = control.createEl("input", {
      attr: { type: "range", min: String(min), max: String(max), step: String(step) },
    });
    const number = control.createEl("input", {
      cls: "db-view-config-number",
      attr: { type: "number", min: String(min), max: String(max), step: String(step) },
    });
    const clamp = (next: number): number => Math.max(min, Math.min(max, Math.round(next)));
    const initial = clamp(value);
    slider.value = String(initial);
    number.value = String(initial);
    slider.addEventListener("input", () => {
      const next = clamp(Number(slider.value));
      number.value = String(next);
      onChange(next);
    });
    number.addEventListener("input", () => {
      const raw = Number(number.value);
      if (!Number.isFinite(raw)) return;
      const next = clamp(raw);
      slider.value = String(next);
      onChange(next);
    });
    number.addEventListener("change", () => {
      const next = clamp(Number(number.value) || initial);
      number.value = String(next);
      slider.value = String(next);
      onChange(next);
    });
  }

  private defaultUnitWidth(config: ViewConfig): number {
    return getTimelineColumnWidthSpec(config.timelineScale || "week").defaultWidth;
  }

  private unitWidthMin(config: ViewConfig): number {
    return getTimelineColumnWidthSpec(config.timelineScale || "week").min;
  }

  private unitWidthMax(config: ViewConfig): number {
    return getTimelineColumnWidthSpec(config.timelineScale || "week").max;
  }

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
