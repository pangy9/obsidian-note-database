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

export const PROPERTY_TYPE_ICON_SVG: Record<string, string> = {
  "letter-case": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-letter-case">	<path stroke="none" d="M0 0h24v24H0z" fill="none" />	<path d="M14 15.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0" />	<path d="M3 19v-10.5a3.5 3.5 0 0 1 7 0v10.5" />	<path d="M3 13h7" />	<path d="M21 12v7" /></svg>`,
  "number-123": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-number-123">	<path stroke="none" d="M0 0h24v24H0z" fill="none" />	<path d="M3 10l2 -2v8" />	<path d="M9 8h3a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-2a1 1 0 0 0 -1 1v2a1 1 0 0 0 1 1h3" />	<path d="M17 8h2.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1 -1.5 1.5h-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1 -1.5 1.5h-2.5" /></svg>`,
  "calendar-event": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icon-tabler-calendar-event"><path d="M4 5m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v11a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /><path d="M16 3v4" /><path d="M8 3v4" /><path d="M4 11h16" /><path d="M8 15h2v2h-2z" /></svg>`,
  coin: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icon-tabler-coin"><path d="M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0" /><path d="M14.8 9a3 3 0 0 0 -2.8 -1.5a2.5 2.5 0 0 0 0 5a2.5 2.5 0 0 1 0 5a3 3 0 0 1 -2.8 -1.5" /><path d="M12 6v12" /></svg>`,
  "circle-dot": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icon-tabler-circle-dot"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /></svg>`,
  tags: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icon-tabler-tags"><path d="M7.5 7.5m-.5 0a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" /><path d="M3 6v5.2a2 2 0 0 0 .6 1.4l7.8 7.8a2 2 0 0 0 2.8 0l5.2 -5.2a2 2 0 0 0 0 -2.8l-7.8 -7.8a2 2 0 0 0 -1.4 -.6h-5.2a2 2 0 0 0 -2 2z" /><path d="M12 3l8.4 8.4a2 2 0 0 1 0 2.8l-4.4 4.4" /></svg>`,
  "progress-check": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-progress-check">	<path stroke="none" d="M0 0h24v24H0z" fill="none" />	<path d="M10 20.777a8.942 8.942 0 0 1 -2.48 -.969" />	<path d="M14 3.223a9.003 9.003 0 0 1 0 17.554" />	<path d="M4.579 17.093a8.961 8.961 0 0 1 -1.227 -2.592" />	<path d="M3.124 10.5c.16 -.95 .468 -1.85 .9 -2.675l.169 -.305" />	<path d="M6.907 4.579a8.954 8.954 0 0 1 3.093 -1.356" />	<path d="M9 12l2 2l4 -4" /></svg>`,
  "square-check": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icon-tabler-square-check"><path d="M3 3m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" /><path d="M9 12l2 2l4 -4" /></svg>`,
  "math-function": `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-math-function">	<path stroke="none" d="M0 0h24v24H0z" fill="none" />	<path d="M3 19a2 2 0 0 0 2 2c2 0 2 -4 3 -9s1 -9 3 -9a2 2 0 0 1 2 2" />	<path d="M5 12h6" />	<path d="M15 12l6 6" />	<path d="M15 18l6 -6" /></svg>`,
};

export function getPropertyTypeIconName(col: ColumnDef): string {
  return col.key === "file.name" ? PROPERTY_TYPE_ICON_NAMES.text : PROPERTY_TYPE_ICON_NAMES[col.type];
}

export function getPropertyTypeIconSvg(col: ColumnDef): string {
  return PROPERTY_TYPE_ICON_SVG[getPropertyTypeIconName(col)] || PROPERTY_TYPE_ICON_SVG["letter-case"];
}

export function renderPropertyTypeIcon(parent: HTMLElement, col: ColumnDef, cls = "db-property-icon"): HTMLElement {
  const icon = parent.createSpan({ cls });
  icon.setAttribute("data-icon", getPropertyTypeIconName(col));
  icon.innerHTML = getPropertyTypeIconSvg(col);
  return icon;
}
