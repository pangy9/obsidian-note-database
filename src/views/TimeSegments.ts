import { t } from "../i18n";

export function createTimeSegments(parent: HTMLElement): { hour: HTMLInputElement; minute: HTMLInputElement } {
  const hour = parent.createEl("input", {
    cls: "db-date-seg db-time-seg db-hour-seg",
    attr: { type: "text", maxlength: "2", inputmode: "numeric", placeholder: "HH", "aria-label": t("calendar.timeHour") },
  });
  parent.createSpan({ cls: "db-date-sep db-time-colon", text: ":", attr: { "aria-hidden": "true" } });
  const minute = parent.createEl("input", {
    cls: "db-date-seg db-time-seg db-minute-seg",
    attr: { type: "text", maxlength: "2", inputmode: "numeric", placeholder: t("calendar.minutePlaceholder"), "aria-label": t("calendar.timeMinute") },
  });
  return { hour, minute };
}

/** A first digit beyond the tens limit is already a complete one-digit segment. */
export function readTimeSegmentInput(value: string, segment: "hour" | "minute"): { text: string; complete: boolean } {
  const digits = value.replace(/\D/g, "").slice(0, 2);
  const maxTens = segment === "hour" ? 2 : 5;
  const text = digits.length === 1 && Number(digits) > maxTens ? digits.padStart(2, "0") : digits;
  return { text, complete: text.length === 2 };
}
