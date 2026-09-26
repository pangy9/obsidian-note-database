import { setIcon } from "obsidian";
import {
  getLocaleWeekStartsOn,
  getLocalDateKey,
  getWeekdayLabels,
  parseDateKeyToUtc,
} from "../data/CalendarDateTime";
import { getEffectiveLocale, t } from "../i18n";
import { isImeComposing } from "../data/KeyboardUtils";
import { MiniCalendarEventIndex, MiniCalendarMode, renderMiniCalendar } from "./CalendarMiniCalendarRenderer";
import {
  buildDatePickerWeeks,
  composeDatePickerValue,
  formatDatePickerMonthTitle,
  getDatePickerYearRangeStart,
  normalizeDatePickerValue,
  shiftDatePickerMonth,
} from "./DatePickerModel";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { positionToolbarPopover } from "./PopoverPosition";
import { isHTMLElement } from "./DomGuards";
import { createFormPopoverPortal } from "./FormPopoverPortal";

export interface DateValuePickerOptions {
  parent: HTMLElement;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  includeTime?: boolean;
  displayText?: string;
  footerAction?: {
    label: string;
    onSelect(): void;
  };
  className?: string;
  onChange(value: string): void;
}

interface ActiveDateValuePicker {
  anchor: HTMLElement;
  close(commit: boolean): void;
}

const activePickers = new WeakMap<Document, ActiveDateValuePicker>();

export function closeActiveDateValuePicker(doc: Document = window.activeDocument, commit = false): void {
  activePickers.get(doc)?.close(commit);
}

export function renderDateValuePicker(options: DateValuePickerOptions): HTMLButtonElement {
  const trigger = options.parent.createEl("button", {
    cls: ["db-date-value-field", options.className || ""].filter(Boolean).join(" "),
    attr: {
      type: "button",
      "aria-label": options.placeholder || t("filter.value"),
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
    },
  });
  trigger.disabled = Boolean(options.disabled);
  const icon = trigger.createSpan({ cls: "db-date-value-field-icon" });
  setIcon(icon, options.includeTime ? "calendar-clock" : "calendar-days");
  const label = trigger.createSpan({ cls: "db-date-value-field-text" });
  const syncLabel = () => {
    const current = normalizeDatePickerValue(options.value, Boolean(options.includeTime));
    label.setText(options.displayText || current.replace("T", " ") || options.placeholder || t("filter.value"));
    trigger.toggleClass("is-empty", !options.displayText && !current);
  };
  syncLabel();

  trigger.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (trigger.disabled) return;
    openDateValuePicker(trigger, options, syncLabel);
  };
  return trigger;
}

function openDateValuePicker(
  trigger: HTMLButtonElement,
  options: DateValuePickerOptions,
  syncLabel: () => void,
): void {
  const doc = trigger.ownerDocument;
  const ownerWindow = doc.defaultView || window;
  const active = activePickers.get(doc);
  if (active?.anchor === trigger) {
    active.close(true);
    return;
  }
  active?.close(true);

  const formPortal = trigger.closest(".db-form") ? createFormPopoverPortal(doc) : null;
  const rawContainer = trigger.closest(".note-database-container");
  const host = formPortal || (isHTMLElement(rawContainer) ? rawContainer : doc.body);
  const includeTime = Boolean(options.includeTime);
  const originalValue = normalizeDatePickerValue(options.value, includeTime);
  const originalDisplayText = options.displayText;
  let committedValue = originalValue;
  const todayKey = getLocalDateKey();
  let pickerMonthKey = (originalValue || todayKey).slice(0, 7);
  let pickerMode: MiniCalendarMode = "day";
  let closed = false;
  let cleanupAutoClose: (() => void) | undefined;

  const popover = host.createDiv({
    cls: "db-cell-edit-popover db-date-edit-popover db-date-value-popover",
    attr: { role: "dialog", "aria-label": options.placeholder || t("filter.value") },
  });
  if (includeTime) popover.addClass("is-datetime");
  const segments = popover.createDiv({ cls: "db-date-segments" });
  const yearInput = segments.createEl("input", {
    cls: "db-date-seg",
    attr: { maxlength: "4", inputmode: "numeric", placeholder: "YYYY", "aria-label": "YYYY" },
  });
  segments.createSpan({ cls: "db-date-sep", text: "-" });
  const monthInput = segments.createEl("input", {
    cls: "db-date-seg",
    attr: { maxlength: "2", inputmode: "numeric", placeholder: "MM", "aria-label": "MM" },
  });
  segments.createSpan({ cls: "db-date-sep", text: "-" });
  const dayInput = segments.createEl("input", {
    cls: "db-date-seg",
    attr: { maxlength: "2", inputmode: "numeric", placeholder: "DD", "aria-label": "DD" },
  });
  let hourInput: HTMLInputElement | undefined;
  let minuteInput: HTMLInputElement | undefined;
  if (includeTime) {
    segments.createSpan({ cls: "db-date-sep db-time-sep", text: " " });
    hourInput = segments.createEl("input", {
      cls: "db-date-seg db-time-seg db-hour-seg",
      attr: { maxlength: "2", inputmode: "numeric", placeholder: "HH", "aria-label": "HH" },
    });
    segments.createSpan({ cls: "db-date-sep db-time-colon", text: ":" });
    minuteInput = segments.createEl("input", {
      cls: "db-date-seg db-time-seg db-minute-seg",
      attr: {
        maxlength: "2",
        inputmode: "numeric",
        placeholder: t("calendar.minutePlaceholder"),
        "aria-label": "Minute",
      },
    });
  }
  const inputs = [yearInput, monthInput, dayInput, hourInput, minuteInput]
    .filter((input): input is HTMLInputElement => Boolean(input));
  setInputs(originalValue);

  const eventIndex: MiniCalendarEventIndex = {
    dateKeys: new Set(),
    monthKeys: new Set(),
    yearKeys: new Set(),
  };
  const calendar = popover.createDiv({ cls: "db-calendar-mini-popover db-cell-date-picker" });
  calendar.addEventListener("mousedown", (event) => event.preventDefault());

  const readDraftDateKey = (): string | null => {
    const year = yearInput.value.replace(/\D/g, "");
    const rawMonth = monthInput.value.replace(/\D/g, "");
    const rawDay = dayInput.value.replace(/\D/g, "");
    if (!year && !rawMonth && !rawDay) return "";
    const month = rawMonth.padStart(2, "0");
    const day = rawDay.padStart(2, "0");
    const dateKey = `${year}-${month}-${day}`;
    return parseDateKeyToUtc(dateKey) ? dateKey : null;
  };

  const readDraft = (): string | null => {
    const dateKey = readDraftDateKey();
    if (!includeTime || dateKey == null || dateKey === "") return dateKey;
    return composeDatePickerValue(dateKey, hourInput?.value || "", minuteInput?.value || "", true);
  };

  const commitDraft = () => {
    const draft = readDraft();
    if (draft == null || draft === committedValue) return;
    options.value = draft;
    options.displayText = undefined;
    committedValue = draft;
    syncLabel();
    options.onChange(draft);
  };

  const syncDraftLabel = () => {
    const draft = readDraft();
    if (draft == null) return;
    options.value = draft;
    options.displayText = undefined;
    syncLabel();
  };

  const close = (commit: boolean) => {
    if (closed) return;
    closed = true;
    if (commit) commitDraft();
    else {
      options.value = committedValue;
      options.displayText = originalDisplayText;
      syncLabel();
    }
    cleanupAutoClose?.();
    popover.remove();
    formPortal?.remove();
    trigger.setAttribute("aria-expanded", "false");
    if (activePickers.get(doc)?.anchor === trigger) activePickers.delete(doc);
  };
  activePickers.set(doc, { anchor: trigger, close });
  trigger.setAttribute("aria-expanded", "true");
  popover.addEventListener("keydown", (event) => {
    if (isImeComposing(event)) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(false);
    trigger.focus();
  });

  const chooseDate = (dateKey: string) => {
    setDateInputs(dateKey);
    if (includeTime) {
      if (!hourInput?.value) hourInput!.value = "00";
      if (!minuteInput?.value) minuteInput!.value = "00";
      syncDraftLabel();
      pickerMonthKey = dateKey.slice(0, 7);
      pickerMode = "day";
      renderPicker();
      hourInput?.focus();
      hourInput?.select();
      return;
    }
    syncDraftLabel();
    close(true);
  };

  const chooseToday = (dateKey: string) => {
    setDateInputs(dateKey);
    if (!includeTime) {
      chooseDate(dateKey);
      return;
    }
    const now = new Date();
    hourInput!.value = String(now.getHours()).padStart(2, "0");
    minuteInput!.value = String(now.getMinutes()).padStart(2, "0");
    syncDraftLabel();
    pickerMonthKey = dateKey.slice(0, 7);
    pickerMode = "day";
    renderPicker();
    hourInput?.focus();
    hourInput?.select();
  };

  const rerenderPickerWithFocus = (target: "previous" | "next" | "title") => {
    renderPicker();
    ownerWindow.requestAnimationFrame(() => {
      if (target === "title") {
        calendar.querySelector<HTMLButtonElement>(".db-calendar-mini-title-button")?.focus();
        return;
      }
      const navButtons = calendar.querySelectorAll<HTMLButtonElement>(".db-calendar-mini-nav");
      navButtons[target === "previous" ? 0 : navButtons.length - 1]?.focus();
    });
  };

  const renderPicker = () => {
    const [yearText, monthText] = pickerMonthKey.split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const weekStartsOn = getLocaleWeekStartsOn();
    const selected = readDraftDateKey();
    renderMiniCalendar({
      popover: calendar,
      mode: pickerMode,
      monthKey: pickerMonthKey,
      monthTitle: formatDatePickerMonthTitle(year, monthIndex, getEffectiveLocale()),
      visibleYear: year,
      yearRangeStart: getDatePickerYearRangeStart(year),
      weeks: buildDatePickerWeeks(year, monthIndex, weekStartsOn),
      weekdays: getWeekdayLabels(getEffectiveLocale(), weekStartsOn),
      todayKey,
      selectedKeys: selected ? new Set([selected]) : new Set(),
      eventIndex,
      onPrevious: () => {
        pickerMonthKey = shiftDatePickerMonth(
          pickerMonthKey,
          pickerMode === "day" ? -1 : pickerMode === "month" ? -12 : -144,
        );
        rerenderPickerWithFocus("previous");
      },
      onNext: () => {
        pickerMonthKey = shiftDatePickerMonth(
          pickerMonthKey,
          pickerMode === "day" ? 1 : pickerMode === "month" ? 12 : 144,
        );
        rerenderPickerWithFocus("next");
      },
      onTitleClick: () => {
        if (pickerMode === "day") pickerMode = "month";
        else if (pickerMode === "month") pickerMode = "year";
        rerenderPickerWithFocus("title");
      },
      onSelectDate: chooseDate,
      onSelectMonth: (monthKey) => {
        pickerMonthKey = monthKey;
        pickerMode = "day";
        renderPicker();
      },
      onSelectYear: (selectedYear) => {
        pickerMonthKey = `${String(selectedYear).padStart(4, "0")}-01`;
        pickerMode = "month";
        renderPicker();
      },
      onSelectToday: chooseToday,
      footerAction: options.footerAction,
    });
  };

  inputs.forEach((input, index) => {
    input.oninput = () => {
      input.value = input.value.replace(/\D/g, "");
      if (index === 0 && input.value.length === 4) inputs[1].focus();
      if (index === 1 && input.value.length === 2) inputs[2].focus();
      if (index === 2 && input.value.length === 2 && hourInput) hourInput.focus();
      if (index === 3 && input.value.length === 2 && minuteInput) minuteInput.focus();
      if (index <= 2) renderPicker();
      syncDraftLabel();
    };
    input.onkeydown = (event) => {
      if (isImeComposing(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        close(true);
      } else if (event.key === "Backspace" && !input.value && index > 0) {
        event.preventDefault();
        inputs[index - 1].focus();
      }
    };
  });

  renderPicker();
  positionToolbarPopover(popover, trigger, {
    minWidth: 252,
    preferredWidth: 252,
    maxWidth: 252,
    align: "left",
  });
  cleanupAutoClose = installPopoverAutoClose({
    panel: popover,
    anchorEl: trigger,
    close: () => close(true),
    closeOnOutsidePointerDown: true,
    closeOnEscape: true,
    isActiveTarget: (target) => target instanceof ownerWindow.Node && popover.contains(target),
  });
  ownerWindow.requestAnimationFrame(() => {
    yearInput.focus();
    yearInput.select();
  });

  function setDateInputs(value: string): void {
    const [year = "", month = "", day = ""] = value.slice(0, 10).split("-");
    yearInput.value = year;
    monthInput.value = month;
    dayInput.value = day;
  }

  function setInputs(value: string): void {
    setDateInputs(value);
    if (!includeTime || !hourInput || !minuteInput) return;
    const time = value.slice(11, 16);
    hourInput.value = time.slice(0, 2);
    minuteInput.value = time.slice(3, 5);
  }
}
