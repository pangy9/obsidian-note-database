import { setIcon } from "obsidian";
import { getValidRecordIconIds, renderRecordIcon } from "./RecordIconRenderer";
import { t } from "../i18n";

/** Legacy configurations store bare Lucide IDs; the shared picker uses icon tokens. */
export function buttonPickerToken(icon: string | undefined): string | undefined {
  if (!icon || !/^[a-z0-9-]+$/.test(icon)) return icon || undefined;
  const ids = getValidRecordIconIds();
  const id = ids.includes(icon) ? icon : ids.includes(`lucide-${icon}`) ? `lucide-${icon}` : icon;
  return `lucide:${id}`;
}

export function renderRecordButtonIcon(parent: HTMLElement, icon: string): void {
  if (/^[a-z0-9-]+$/.test(icon)) setIcon(parent, icon);
  else renderRecordIcon(parent, icon, { compact: true, defaultIcon: "mouse-pointer-2" });
}

/** A non-interactive miniature, safe to render inside dropdown option buttons. */
export function renderButtonStyleSample(parent: HTMLElement, style: string): void {
  const sample = parent.createSpan({ cls: `db-button-style-sample is-${style}`, attr: { "aria-hidden": "true" } });
  sample.createSpan({ text: t("button.appearance.sample") });
}

export function buttonIconRecommendations(): Array<{ value: string; label: string }> {
  return [
    ...["mouse-pointer-2", "check", "play", "plus", "book-open", "archive", "rotate-ccw"].map(icon => ({ value: buttonPickerToken(icon)!, label: t(`button.icon.${icon}`) })),
    ...[["✅", "check"], ["▶️", "play"], ["➕", "plus"], ["📝", "edit"], ["📋", "clipboard"], ["📦", "archive"], ["🔄", "rotate-ccw"]].map(([value, label]) => ({ value, label: t(`button.icon.${label}`) })),
  ];
}
