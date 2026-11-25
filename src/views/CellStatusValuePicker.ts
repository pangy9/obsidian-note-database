import type { StatusOptionDef } from "../data/types";
import { t } from "../i18n";
import { isImeComposing } from "../data/KeyboardUtils";
import { renderCellOptionCheck, renderCellOptionLabel } from "./CellOptionPresentation";
import { positionToolbarPopover } from "./PopoverPosition";

export function openCellStatusValuePicker(opts: {
  host: HTMLElement;
  anchor: HTMLButtonElement;
  label: string;
  options: ReadonlyArray<Pick<StatusOptionDef, "value" | "color">>;
  value: string;
  onSelect(value: string): void;
  onClose(): void;
}): (restoreFocus?: boolean) => void {
  const { host, anchor } = opts;
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const panel = host.createDiv({ cls: "db-cell-option-popover db-cell-status-value-picker",
    attr: { role: "dialog", "aria-label": opts.label, tabindex: "-1" } });
  let closed = false;
  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", onOutside, true);
    win?.removeEventListener("resize", reposition);
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    opts.onClose();
  };
  const onOutside = (event: PointerEvent) => {
    const path = event.composedPath();
    if (!path.includes(panel) && !path.includes(anchor)) close(false);
  };
  const reposition = () => positionToolbarPopover(panel, anchor, {
    preferredWidth: doc.body.classList.contains("is-phone") ? 310 : 220,
    maxHeight: 260,
  });

  const rows = opts.options.map(option => {
    const selected = option.value === opts.value;
    const row = panel.createEl("button", { cls: "db-cell-option-item",
      attr: { type: "button", "aria-pressed": String(selected), title: option.value } });
    renderCellOptionLabel(row, option);
    renderCellOptionCheck(row, selected);
    row.onclick = () => {
      close();
      if (!selected) opts.onSelect(option.value);
    };
    return row;
  });
  if (rows.length === 0) panel.createDiv({ cls: "db-panel-empty", text: t("cell.noOptions") });
  panel.onkeydown = event => {
    if (isImeComposing(event)) return;
    if (event.key === "Tab") { close(); return; }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const i = rows.indexOf(doc.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) :
      event.key === "ArrowUp" ? Math.max(0, i - 1) :
        event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : -1;
    if (next >= 0 && rows[next]) {
      event.preventDefault();
      rows[next].focus();
    }
  };

  anchor.setAttribute("aria-expanded", "true");
  doc.addEventListener("pointerdown", onOutside, true);
  win?.addEventListener("resize", reposition);
  reposition();
  (rows[opts.options.findIndex(option => option.value === opts.value)] ?? rows[0] ?? panel).focus();
  return close;
}
