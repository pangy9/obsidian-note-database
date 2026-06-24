import { ColumnDef, RowData, ViewConfig } from "../data/types";
import { toMultiSelectValuesForKey } from "../data/ColumnTypes";

/** Resolved width (px) for a column: explicit columnWidths > col.width > defaultColumnWidth > fallback. */
export function getFieldWidth(config: ViewConfig, col: ColumnDef, fallback = 150): number {
  return config.columnWidths?.[col.key] || col.width || config.defaultColumnWidth || fallback;
}

/** Clamp a card field width so it stays strictly below the card width (value column must not fill the card). */
export function clampCardFieldWidth(fieldWidth: number, cardWidth: number): number {
  return Math.min(fieldWidth, Math.max(0, cardWidth - 1));
}

let measureContext: CanvasRenderingContext2D | null | undefined;
let cachedFontFamily = "";

export function estimateAutoColumnWidth(
  col: ColumnDef,
  rows: RowData[],
  getDisplayText: (row: RowData, col: ColumnDef) => string
): number {
  const label = col.label || col.key;
  const headerWidth = Math.ceil(measureHeaderText(label) + 46);
  if (col.type === "checkbox") return Math.max(42, Math.min(headerWidth, 220));
  if (col.wrap) return Math.max(36, Math.min(headerWidth, 360));

  const valueWidth = rows.reduce((max, row) => {
    return Math.max(max, estimateCellContentWidth(col, row, getDisplayText));
  }, 0);
  return Math.max(36, Math.min(Math.max(headerWidth, valueWidth), 800));
}

function estimateCellContentWidth(
  col: ColumnDef,
  row: RowData,
  getDisplayText: (row: RowData, col: ColumnDef) => string
): number {
  if (col.type === "select" || col.type === "status") {
    const text = normalizeInlineText(getDisplayText(row, col));
    return text ? Math.ceil(measureBadgeText(text) + 34) : 0;
  }
  if (col.type === "multi-select") {
    const values = toMultiSelectValuesForKey(col.key, row.frontmatter[col.key]);
    if (values.length === 0) return 0;
    const badges = values.reduce((total, value) => total + measureBadgeText(value) + 14, 0);
    const gaps = Math.max(0, values.length - 1) * 4;
    return Math.ceil(Math.min(badges + gaps + 20, 560));
  }
  const text = normalizeInlineText(getDisplayText(row, col));
  return text ? Math.ceil(measureBodyText(text) + 24) : 0;
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function measureHeaderText(text: string): number {
  return measureText(text, 13, 500);
}

function measureBodyText(text: string): number {
  return measureText(text, 13, 400);
}

function measureBadgeText(text: string): number {
  return measureText(text, 12, 500);
}

function measureText(text: string, fontSize: number, fontWeight: number): number {
  if (!text) return 0;
  const context = getMeasureContext();
  if (!context) return estimateTextFallback(text, fontSize);
  context.font = `${fontWeight} ${fontSize}px ${getFontFamily()}`;
  return context.measureText(text).width;
}

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext !== undefined) return measureContext;
  if (typeof window === "undefined" || !window.activeDocument) {
    measureContext = null;
    return measureContext;
  }
  measureContext = window.activeDocument.createElement("canvas").getContext("2d");
  return measureContext;
}

function getFontFamily(): string {
  if (cachedFontFamily) return cachedFontFamily;
  if (typeof window === "undefined" || !window.activeDocument) {
    cachedFontFamily = "system-ui, sans-serif";
    return cachedFontFamily;
  }
  cachedFontFamily = window.getComputedStyle(window.activeDocument.body).fontFamily || "system-ui, sans-serif";
  return cachedFontFamily;
}

function estimateTextFallback(text: string, fontSize: number): number {
  return Array.from(text).reduce((total, char) => {
    const code = char.codePointAt(0) || 0;
    if (code >= 0x2e80) return total + fontSize;
    if (/[A-ZMW@#%&]/.test(char)) return total + fontSize * 0.72;
    if (/[il.,'`:;|!]/.test(char)) return total + fontSize * 0.32;
    return total + fontSize * 0.54;
  }, 0);
}
