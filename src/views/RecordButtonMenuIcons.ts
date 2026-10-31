import { setIcon } from "obsidian";
import type { ColumnDef, RecordButtonOperation, RecordButtonStep } from "../data/types";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon } from "./PropertyTypeIcon";
import { renderDatabaseDropdownIcon } from "./RecordIconRenderer";

export const BUTTON_STEP_ICONS: Record<RecordButtonStep["kind"], string> = {
  edit: "edit", create: "file-plus-2", duplicate: "copy", variable: "tabler:variable", confirm: "message-square", open: "external-link",
};
export const BUTTON_TARGET_ICONS: Record<string, string> = {
  trigger: "file-text", created: BUTTON_STEP_ICONS.create, database: "list-filter", link: "link",
};
const OPERATION_ICONS: Record<Exclude<RecordButtonOperation, "now">, string> = {
  set: BUTTON_STEP_ICONS.edit, clear: "eraser", increment: "diff", toggle: "toggle-left", add: "list-plus", remove: "list-minus",
};
export function getButtonOperationIcon(operation: RecordButtonOperation, type: ColumnDef["type"]): string {
  return operation === "now" ? getPropertyDropdownIcon(type === "datetime" ? "datetime" : "date") : OPERATION_ICONS[operation];
}
export const BUTTON_FILE_VALUE_ICONS: Record<string, string> = {
  "file.basename": getPropertyDropdownIcon("text"), "file.body": "file-text", "file.link": getPropertyDropdownIcon("relation"), "file.path": "folder",
};

/** Keep dropdown fields and their option rows on the same shared renderers. */
export function renderButtonMenuIcon(parent: HTMLElement, icon: string): void {
  if (icon === BUTTON_STEP_ICONS.variable) {
    // Tabler outline/variable (MIT): https://github.com/tabler/tabler-icons/blob/main/icons/outline/variable.svg
    const doc = parent.ownerDocument;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({ width: "24", height: "24", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
    svg.classList.add("svg-icon", "icon-tabler", "icon-tabler-variable");
    for (const d of ["M5 4c-2.5 5 -2.5 10 0 16m14 -16c2.5 5 2.5 10 0 16m-10 -11h1c1 0 1 1 2.016 3.527c.984 2.473 .984 3.473 1.984 3.473h1", "M8 16c1.5 0 3 -2 4 -3.5s2.5 -3.5 4 -3.5"]) {
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d); svg.appendChild(path);
    }
    parent.appendChild(svg);
    return;
  }
  if (!renderDropdownPropertyTypeIcon(parent, icon) && !renderDatabaseDropdownIcon(parent, icon)) setIcon(parent, icon);
}
