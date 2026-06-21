import { App, Modal } from "obsidian";
import {
  getInvalidTimeEventQuickFix,
  getTimelineDateTimeSpanMinutes,
  InvalidTimeEventOption,
  toTimelineDateTimeInputValue,
} from "../../data/InvalidTimeEvents";
import { RowData } from "../../data/types";
import { t } from "../../i18n";

/** 用户在 Modal 里确认的修复：每个事件的开始/结束新值（datetime-local 格式 "YYYY-MM-DDTHH:mm"）。 */
export interface InvalidTimeEventEdit {
  row: RowData;
  startField: string;
  endField: string;
  startValue: string;
  endValue: string;
}

interface InvalidTimeEventDraft {
  selected: boolean;
  start: string;
  end: string;
  originalStartValue: unknown;
  originalEndValue: unknown;
  /** 对应列是否为纯 date 列：决定输入用 date 还是 datetime-local，以及写回时是否裁掉时间。 */
  startIsDateOnly: boolean;
  endIsDateOnly: boolean;
  dirty: boolean;
  rowEl?: HTMLElement;
  checkbox?: HTMLInputElement;
  startInput?: HTMLInputElement;
  endInput?: HTMLInputElement;
  spanEl?: HTMLElement;
}

/**
 * 列出开始 datetime >= 结束 datetime 的无效事件，让用户逐条修改开始/结束时间，确认后写回。
 * 骨架参照 ComputedFrontmatterCleanupModal（extends Modal + onConfirm 回调）。
 */
export class InvalidTimeEventsModal extends Modal {
  private readonly edits = new Map<string, InvalidTimeEventDraft>();
  private selectAllInput?: HTMLInputElement;
  private selectedCountEl?: HTMLElement;
  private resizeObserver?: ResizeObserver;

  constructor(
    app: App,
    private options: InvalidTimeEventOption[],
    private onConfirm: (edits: InvalidTimeEventEdit[]) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass("invalid-events-modal-host");
    contentEl.addClass("note-database-modal", "db-invalid-events-modal");
    contentEl.createEl("h3", { text: t("timeline.invalidEventsTitleWithCount", { count: this.options.length }) });
    contentEl.createDiv({ cls: "db-modal-help", text: t("timeline.invalidEventsDesc") });

    const grid = contentEl.createDiv({ cls: "db-invalid-event-grid" });
    const header = grid.createDiv({ cls: "db-invalid-event-grid-header" });
    const selectAll = header.createEl("input", {
      cls: "db-invalid-event-select",
      attr: { type: "checkbox", "aria-label": t("timeline.invalidEventsSelectAll") },
    });
    this.selectAllInput = selectAll;
    selectAll.checked = true;
    selectAll.onchange = () => this.setAllSelected(selectAll.checked);
    header.createDiv({ cls: "db-invalid-event-col-note", text: t("timeline.invalidEventsNote") });
    header.createDiv({ cls: "db-invalid-event-col-time", text: t("timeline.invalidEventsStart") });
    header.createDiv({ cls: "db-invalid-event-col-time", text: t("timeline.invalidEventsEnd") });
    header.createDiv({ cls: "db-invalid-event-col-span", text: t("timeline.invalidEventsSpan") });

    for (const option of this.options) {
      const key = option.row.file.path;
      const row = grid.createDiv({ cls: "db-invalid-event-row" });
      const draft: InvalidTimeEventDraft = {
        selected: true,
        start: InvalidTimeEventsModal.clipForDateInput(toTimelineDateTimeInputValue(option.startValue), option.startIsDateOnly),
        end: InvalidTimeEventsModal.clipForDateInput(toTimelineDateTimeInputValue(option.endValue), option.endIsDateOnly),
        originalStartValue: option.startValue,
        originalEndValue: option.endValue,
        startIsDateOnly: option.startIsDateOnly,
        endIsDateOnly: option.endIsDateOnly,
        dirty: false,
        rowEl: row,
      };
      const checkbox = row.createEl("input", {
        cls: "db-invalid-event-select",
        attr: { type: "checkbox", "aria-label": t("timeline.invalidEventsSelectRow", { name: option.fileName }) },
      });
      checkbox.checked = true;
      checkbox.onchange = () => {
        draft.selected = checkbox.checked;
        this.updateSelectionSummary();
      };
      draft.checkbox = checkbox;
      row.createDiv({ cls: "db-invalid-event-name", text: option.fileName, attr: { title: option.row.file.path } });
      draft.startInput = this.createDateTimeInput(row, t("timeline.invalidEventsStart"), draft.start, "start", draft.startIsDateOnly);
      draft.endInput = this.createDateTimeInput(row, t("timeline.invalidEventsEnd"), draft.end, "end", draft.endIsDateOnly);
      const spanCell = row.createDiv({ cls: "db-invalid-event-span-cell" });
      draft.spanEl = spanCell.createSpan({ cls: "db-invalid-event-span" });
      const quickFix = spanCell.createEl("button", {
        cls: "db-invalid-event-row-fix",
        text: t("timeline.invalidEventsQuickFixShort"),
        attr: { type: "button", title: t("timeline.invalidEventsQuickFix") },
      });
      quickFix.onclick = () => this.applyQuickFix(key);
      this.edits.set(key, draft);
      draft.startInput.oninput = () => {
        draft.start = draft.startInput?.value ?? "";
        draft.dirty = true;
        this.renderSpan(draft);
      };
      draft.endInput.oninput = () => {
        draft.end = draft.endInput?.value ?? "";
        draft.dirty = true;
        this.renderSpan(draft);
      };
      this.renderSpan(draft);
    }

    const actions = contentEl.createDiv({ cls: "db-invalid-event-actions" });
    const bulk = actions.createDiv({ cls: "db-invalid-event-bulk-actions" });
    bulk.createEl("button", {
      text: t("timeline.invalidEventsQuickFix"),
      attr: { type: "button" },
    }).onclick = () => this.applyQuickFixToSelected();
    this.selectedCountEl = bulk.createSpan({ cls: "db-invalid-event-selected-count" });
    const buttons = actions.createDiv({ cls: "db-modal-actions" });
    buttons.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" },
    }).onclick = () => this.close();
    const confirm = buttons.createEl("button", {
      cls: "mod-warning",
      text: t("timeline.invalidEventsConfirm"),
      attr: { type: "button" },
    });
    confirm.onclick = async () => {
      const edits: InvalidTimeEventEdit[] = this.options.map((option) => {
        const e = this.edits.get(option.row.file.path);
        return {
          row: option.row,
          startField: option.startField,
          endField: option.endField,
          startValue: e?.start ?? "",
          endValue: e?.end ?? "",
        };
      });
      await this.onConfirm(edits);
      this.close();
    };
    this.updateSelectionSummary();
    this.setupResponsiveLayout();
  }

  onClose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.contentEl.empty();
  }

  private createDateTimeInput(parent: HTMLElement, label: string, initialValue: string, placement: "start" | "end", isDateOnly: boolean): HTMLInputElement {
    const field = parent.createDiv({ cls: `db-invalid-event-time-field is-${placement}` });
    field.createSpan({ cls: "db-invalid-event-time-label", text: label });
    const input = field.createEl("input", {
      // 纯 date 列用 date 输入：用户无法给 date 列填无意义的时间，避免「填了时间→写回被截→刷新后又 invalid」的假修复。
      cls: `db-invalid-event-datetime${isDateOnly ? " is-date-only" : ""}`,
      attr: { type: isDateOnly ? "date" : "datetime-local", "aria-label": label },
    });
    input.value = initialValue;
    return input;
  }

  /** date 列只保留 YYYY-MM-DD：给 date 输入塞带时间的值会被浏览器视为非法并清空。 */
  private static clipForDateInput(value: string, isDateOnly: boolean): string {
    return isDateOnly ? value.slice(0, 10) : value;
  }

  private applyQuickFixToSelected(): void {
    for (const [key, draft] of this.edits.entries()) {
      if (draft.selected) this.applyQuickFix(key);
    }
  }

  private applyQuickFix(key: string): void {
    const draft = this.edits.get(key);
    if (!draft) return;
    const fix = draft.dirty
      ? getInvalidTimeEventQuickFix(draft.start, draft.end)
      : getInvalidTimeEventQuickFix(draft.originalStartValue, draft.originalEndValue);
    if (!fix) return;
    draft.start = InvalidTimeEventsModal.clipForDateInput(fix.startValue, draft.startIsDateOnly);
    draft.end = InvalidTimeEventsModal.clipForDateInput(fix.endValue, draft.endIsDateOnly);
    draft.dirty = true;
    if (draft.startInput) draft.startInput.value = draft.start;
    if (draft.endInput) draft.endInput.value = draft.end;
    this.renderSpan(draft);
  }

  private renderSpan(draft: InvalidTimeEventDraft): void {
    const spanMinutes = getTimelineDateTimeSpanMinutes(draft.start, draft.end);
    const invalid = spanMinutes == null;
    draft.rowEl?.toggleClass("is-invalid", invalid);
    draft.endInput?.toggleClass("is-invalid", invalid);
    if (!draft.spanEl) return;
    draft.spanEl.toggleClass("is-invalid", invalid);
    draft.spanEl.textContent = invalid
      ? t("timeline.invalidEventsStillInvalid")
      : this.formatSpan(spanMinutes);
  }

  private formatSpan(minutes: number): string {
    if (minutes % 1440 === 0) return t("timeline.invalidEventsSpanDays", { count: minutes / 1440 });
    if (minutes % 60 === 0) return t("timeline.invalidEventsSpanHours", { count: minutes / 60 });
    if (minutes > 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return t("timeline.invalidEventsSpanHoursMinutes", { hours, minutes: rest });
    }
    return t("timeline.invalidEventsSpanMinutes", { count: minutes });
  }

  private setAllSelected(selected: boolean): void {
    for (const draft of this.edits.values()) {
      draft.selected = selected;
      if (draft.checkbox) draft.checkbox.checked = selected;
    }
    this.updateSelectionSummary();
  }

  private updateSelectionSummary(): void {
    const selected = Array.from(this.edits.values()).filter((draft) => draft.selected).length;
    if (this.selectedCountEl) {
      this.selectedCountEl.textContent = t("timeline.invalidEventsSelected", { count: selected });
    }
    if (this.selectAllInput) {
      this.selectAllInput.checked = selected === this.edits.size;
      this.selectAllInput.indeterminate = selected > 0 && selected < this.edits.size;
    }
  }

  private setupResponsiveLayout(): void {
    const update = () => {
      const width = this.modalEl.getBoundingClientRect().width || this.contentEl.getBoundingClientRect().width;
      this.contentEl.toggleClass("is-invalid-events-compact", width > 0 && width < 1040);
      this.contentEl.toggleClass("is-invalid-events-narrow", width > 0 && width < 680);
    };
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(update);
    this.resizeObserver.observe(this.modalEl);
    update();
  }
}
