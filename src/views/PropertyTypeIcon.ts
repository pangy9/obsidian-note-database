import { ColumnDef } from "../data/types";
import type { DropdownOption } from "./DropdownField";

const SVG_NS = "http://www.w3.org/2000/svg";
const PROPERTY_DROPDOWN_ICON_PREFIX = "property:";

export const PROPERTY_TYPE_ICON_NAMES: Record<ColumnDef["type"], string> = {
  text: "letter-case",
  number: "number-123",
  date: "calendar",
  datetime: "clock",
  currency: "coin",
  select: "circle-dot",
  "multi-select": "tags",
  status: "progress-check",
  checkbox: "square-check",
  computed: "math-function",
};

interface SvgPathDef {
  d: string;
  attrs?: Record<string, string>;
}

interface PropertyTypeIconDef {
  paths: SvgPathDef[];
}

export const PROPERTY_TYPE_ICON_DEFS: Record<string, PropertyTypeIconDef> = {
  "letter-case": {
    paths: [
      { d: "M0 0h24v24H0z", attrs: { stroke: "none", fill: "none" } },
      { d: "M14 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0" },
      { d: "M3 19v-10.5a3.5 3.5 0 0 1 7 0v10.5" },
      { d: "M3 13h7" },
      { d: "M21 12v7" },
    ],
  },
  "number-123": {
    paths: [
      { d: "M0 0h24v24H0z", attrs: { stroke: "none", fill: "none" } },
      { d: "M3 10l2 -2v8" },
      { d: "M9 8h3a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-2a1 1 0 0 0 -1 1v2a1 1 0 0 0 1 1h3" },
      { d: "M17 8h2.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1 -1.5 1.5h-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1 -1.5 1.5h-2.5" },
    ],
  },
  // date：纯日历，对齐 Obsidian 原生 Date 类型图标（lucide calendar）
  "calendar": {
    paths: [
      { d: "M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" },
      { d: "M16 3v4" },
      { d: "M8 3v4" },
      { d: "M4 11h16" },
    ],
  },
  // datetime：纯时钟，对齐 Obsidian 原生 Date & time 类型图标（lucide clock）
  "clock": {
    paths: [
      { d: "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" },
      { d: "M12 7v5l3 3" },
    ],
  },
  coin: {
    paths: [
      { d: "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0" },
      { d: "M14.8 9a3 3 0 0 0 -2.8 -1.5a2.5 2.5 0 0 0 0 5a2.5 2.5 0 0 1 0 5a3 3 0 0 1 -2.8 -1.5" },
      { d: "M12 6v12" },
    ],
  },
  "circle-dot": {
    paths: [
      { d: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" },
      { d: "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" },
    ],
  },
  tags: {
    paths: [
      { d: "M7.5 7.5m-.5 0a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" },
      { d: "M3 6v5.2a2 2 0 0 0 .6 1.4l7.8 7.8a2 2 0 0 0 2.8 0l5.2 -5.2a2 2 0 0 0 0 -2.8l-7.8 -7.8a2 2 0 0 0 -1.4 -.6h-5.2a2 2 0 0 0 -2 2z" },
      { d: "M12 3l8.4 8.4a2 2 0 0 1 0 2.8l-4.4 4.4" },
    ],
  },
  "progress-check": {
    paths: [
      { d: "M0 0h24v24H0z", attrs: { stroke: "none", fill: "none" } },
      { d: "M10 20.777a8.942 8.942 0 0 1 -2.48 -.969" },
      { d: "M14 3.223a9.003 9.003 0 0 1 0 17.554" },
      { d: "M4.579 17.093a8.961 8.961 0 0 1 -1.227 -2.592" },
      { d: "M3.124 10.5c.16 -.95 .468 -1.85 .9 -2.675l.169 -.305" },
      { d: "M6.907 4.579a8.954 8.954 0 0 1 3.093 -1.356" },
      { d: "M9 12l2 2l4 -4" },
    ],
  },
  "square-check": {
    paths: [
      { d: "M3 3m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" },
      { d: "M9 12l2 2l4 -4" },
    ],
  },
  "math-function": {
    paths: [
      { d: "M0 0h24v24H0z", attrs: { stroke: "none", fill: "none" } },
      { d: "M3 19a2 2 0 0 0 2 2c2 0 2 -4 3 -9s1 -9 3 -9a2 2 0 0 1 2 2" },
      { d: "M5 12h6" },
      { d: "M15 12l6 6" },
      { d: "M15 18l6 -6" },
    ],
  },
};

export function getPropertyTypeIconName(col: ColumnDef): string {
  return col.key === "file.name" ? PROPERTY_TYPE_ICON_NAMES.text : PROPERTY_TYPE_ICON_NAMES[col.type];
}

export function getPropertyTypeIconDef(col: ColumnDef): PropertyTypeIconDef {
  return PROPERTY_TYPE_ICON_DEFS[getPropertyTypeIconName(col)] || PROPERTY_TYPE_ICON_DEFS["letter-case"];
}

export function getPropertyDropdownIcon(type: ColumnDef["type"]): string {
  return `${PROPERTY_DROPDOWN_ICON_PREFIX}${type}`;
}

export function isPropertyDropdownIcon(icon: string | undefined): boolean {
  return Boolean(icon?.startsWith(PROPERTY_DROPDOWN_ICON_PREFIX));
}

export function toPropertyDropdownOption(col: ColumnDef, text = col.label || col.key): DropdownOption {
  return {
    value: col.key,
    text,
    icon: getPropertyDropdownIcon(col.type),
  };
}

export function renderDropdownPropertyTypeIcon(parent: HTMLElement, icon: string): boolean {
  if (!icon.startsWith(PROPERTY_DROPDOWN_ICON_PREFIX)) return false;
  const type = icon.slice(PROPERTY_DROPDOWN_ICON_PREFIX.length) as ColumnDef["type"];
  renderPropertyTypeIcon(parent, { key: "", label: "", type }, "db-dropdown-option-type-icon");
  return true;
}

export function renderPropertyTypeIcon(parent: HTMLElement, col: ColumnDef, cls = "db-property-icon"): HTMLElement {
  const icon = parent.createSpan({ cls });
  const iconName = getPropertyTypeIconName(col);
  const doc = parent.ownerDocument || window.activeDocument;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon", "icon-tabler", "icons-tabler-outline", `icon-tabler-${iconName}`);

  for (const pathDef of getPropertyTypeIconDef(col).paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathDef.d);
    if (pathDef.attrs) {
      for (const [name, value] of Object.entries(pathDef.attrs)) {
        path.setAttribute(name, value);
      }
    }
    svg.appendChild(path);
  }

  icon.setAttribute("data-icon", iconName);
  icon.appendChild(svg);
  return icon;
}
