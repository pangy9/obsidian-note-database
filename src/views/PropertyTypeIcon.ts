import { setIcon } from "obsidian";
import { ColumnDef } from "../data/types";

export const PROPERTY_TYPE_ICON_NAMES: Record<ColumnDef["type"], string> = {
  text: "letter-case",
  number: "number-123",
  date: "calendar-event",
  currency: "coin",
  select: "circle-dot",
  "multi-select": "tags",
  status: "progress-check",
  checkbox: "square-check",
  computed: "math-function",
};

export function getPropertyTypeIconName(col: ColumnDef): string {
  return col.key === "file.name" ? PROPERTY_TYPE_ICON_NAMES.text : PROPERTY_TYPE_ICON_NAMES[col.type];
}

export function renderPropertyTypeIcon(parent: HTMLElement, col: ColumnDef, cls = "db-property-icon"): HTMLElement {
  const icon = parent.createSpan({ cls });
  setIcon(icon, getPropertyTypeIconName(col));
  return icon;
}
