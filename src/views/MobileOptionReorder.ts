import { setIcon } from "obsidian";
import { t } from "../i18n";

/** Keep option reordering inside its popover instead of opening a native mobile sheet. */
export function renderMobileOptionMoveControls(
  parent: HTMLElement,
  index: number,
  count: number,
  move: (targetIndex: number) => void,
  hidden = false,
): HTMLElement {
  const controls = parent.createSpan({ cls: "db-mobile-reorder-controls db-option-mobile-reorder-controls" });
  if (hidden) controls.addClass("is-hidden");
  for (const [direction, icon, label] of [
    [-1, "arrow-up", t("menu.moveUp")],
    [1, "arrow-down", t("menu.moveDown")],
  ] as const) {
    const button = controls.createEl("button", {
      cls: "db-option-mobile-move-button",
      attr: { type: "button", title: label, "aria-label": label },
    });
    setIcon(button, icon);
    button.disabled = hidden || index + direction < 0 || index + direction >= count;
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!button.disabled) move(index + direction);
    };
  }
  return controls;
}
