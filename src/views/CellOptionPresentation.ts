import type { StatusOptionDef } from "../data/types";

/** Presentation shared by the full cell editor and the value-only status picker. */
export function renderCellOptionLabel(parent: HTMLElement, option: Pick<StatusOptionDef, "value" | "color">) {
  const dot = parent.createSpan({ cls: "db-option-color-dot", attr: { "aria-hidden": "true" } });
  const updateDot = () => { dot.className = `db-option-color-dot db-option-color-${option.color}`; };
  updateDot();
  const label = parent.createSpan({ text: option.value, cls: "db-option-label" });
  return { dot, updateDot, label };
}

export function renderCellOptionCheck(parent: HTMLElement, selected: boolean): HTMLSpanElement {
  return parent.createSpan({ text: selected ? "✓" : "", cls: "db-option-check", attr: { "aria-hidden": "true" } });
}
