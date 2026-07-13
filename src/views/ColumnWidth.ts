import { ColumnDef, RowData, ViewConfig } from "../data/types";
import { toMultiSelectValuesForKey } from "../data/ColumnTypes";
import { InlineMarkdownNode, parseInlineMarkdown, inlineMarkdownToPlainText } from "../data/InlineMarkdown";
import { parseTextLink } from "../data/TextLink";

/** Resolved width (px) for a column: explicit columnWidths > col.width > defaultColumnWidth > fallback. */
export function getFieldWidth(config: ViewConfig, col: ColumnDef, fallback = 150): number {
  return config.columnWidths?.[col.key] || col.width || config.defaultColumnWidth || fallback;
}

/** Clamp a card field width so it stays strictly below the card width (value column must not fill the card). */
export function clampCardFieldWidth(fieldWidth: number, cardWidth: number): number {
  return Math.min(fieldWidth, Math.max(0, cardWidth - 1));
}

/** For auto-fit width: return the text a text column actually displays after
 *  `textRenderMode` rendering. `link` shows only the label, `markdown` strips
 *  markers — both shorter than the raw value, so measuring the raw value
 *  (`[label](url)`, `**bold**`) over-estimates the column width. Plain text and
 *  non-text columns return the input unchanged. */
export function resolveRenderedDisplayText(text: string, col: ColumnDef): string {
  if (col.textRenderMode === "link") {
    const link = parseTextLink(text);
    if (link) return link.label;
  }
  if (col.textRenderMode === "markdown") {
    const nodes = parseInlineMarkdown(text);
    if (nodes) return inlineMarkdownToPlainText(nodes);
  }
  return text;
}

let measureContext: CanvasRenderingContext2D | null | undefined;
let cachedFontFamily = "";

export function estimateAutoColumnWidth(
  col: ColumnDef,
  rows: RowData[],
  getDisplayText: (row: RowData, col: ColumnDef) => string,
  createRenderedTextMeasurer?: () => RenderedTextWidthMeasurer | null,
): number {
  const label = col.label || col.key;
  const headerWidth = Math.ceil(measureHeaderText(label) + 46);
  if (col.type === "checkbox") return Math.max(42, Math.min(headerWidth, 220));
  if (col.wrap) return Math.max(36, Math.min(headerWidth, 360));

  const renderedTextMeasurer = col.textRenderMode === "markdown" || col.textRenderMode === "link"
    ? createRenderedTextMeasurer?.() ?? null
    : null;
  try {
    const valueWidth = rows.reduce((max, row) => {
      return Math.max(max, estimateCellContentWidth(col, row, getDisplayText, renderedTextMeasurer));
    }, 0);
    return Math.max(36, Math.min(Math.max(headerWidth, valueWidth), 800));
  } finally {
    renderedTextMeasurer?.dispose();
  }
}

export interface RenderedTextWidthMeasurer {
  measure(raw: string, mode: "markdown" | "link"): number | null;
  dispose(): void;
}

function estimateCellContentWidth(
  col: ColumnDef,
  row: RowData,
  getDisplayText: (row: RowData, col: ColumnDef) => string,
  renderedTextMeasurer: RenderedTextWidthMeasurer | null,
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
  const raw = getDisplayText(row, col);
  if (col.textRenderMode === "markdown") {
    const domWidth = renderedTextMeasurer?.measure(raw, "markdown") ?? null;
    if (domWidth !== null) return domWidth;
    const nodes = parseInlineMarkdown(raw);
    if (nodes) return Math.ceil(measureMarkdownNodes(nodes) + 24);
  }
  if (col.textRenderMode === "link") {
    const domWidth = renderedTextMeasurer?.measure(raw, "link") ?? null;
    if (domWidth !== null) return domWidth;
    const link = parseTextLink(raw);
    if (link) return Math.ceil(measureBodyText(normalizeInlineText(link.label)) + 24 + (link.external ? 16 : 0));
  }
  const display = resolveRenderedDisplayText(raw, col);
  const text = normalizeInlineText(display);
  if (!text) return 0;
  return Math.ceil(measureBodyText(text) + 24);
}

interface MarkdownTextStyle {
  fontWeight: number;
  italic: boolean;
}

function measureMarkdownNodes(
  nodes: InlineMarkdownNode[],
  style: MarkdownTextStyle = { fontWeight: 400, italic: false },
): number {
  return nodes.reduce((total, node) => total + measureMarkdownNode(node, style), 0);
}

/** Canvas/fallback estimator for tests and the rare case where DOM layout is unavailable. */
function measureMarkdownNode(node: InlineMarkdownNode, style: MarkdownTextStyle): number {
  switch (node.type) {
    case "text":
      return measureStyledText(normalizeInlineText(node.text), 13, style.fontWeight, style.italic);
    case "bold":
      return measureMarkdownNodes(node.children, { ...style, fontWeight: 700 });
    case "italic":
      return measureMarkdownNodes(node.children, { ...style, italic: true });
    case "strike":
      return measureMarkdownNodes(node.children, style);
    case "highlight":
      return 2 + measureMarkdownNodes(node.children, style);
    case "code":
      return measureStyledText(node.text, 13 * 0.88, 400, false, getMonospaceFontFamily()) + 13 * 0.7;
    case "math":
      return estimateMathWidth(node.text);
    case "link":
      return measureMarkdownNodes(node.label, style) + (node.external ? 16 : 0);
    case "wikilink":
      return measureStyledText(node.label, 13, style.fontWeight, style.italic);
    case "image":
      return 20;
    case "br":
      return 0;
  }
}

function estimateMathWidth(tex: string): number {
  const commandGlyphs: Record<string, string> = {
    sum: "∑", prod: "∏", int: "∫", sqrt: "√", times: "×", cdot: "·",
    le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", infty: "∞",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ",
    mu: "μ", pi: "π", sigma: "σ", phi: "φ", omega: "ω",
  };
  const visible = tex
    .replace(/\\(left|right)\b/g, "")
    .replace(/\\([A-Za-z]+)/g, (_match, command: string) => commandGlyphs[command] ?? "")
    .replace(/[{}_^]/g, "")
    .replace(/\\([{}_^])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const text = visible || "x";
  return measureStyledText(text, 13, 400, false) * 1.08 + 4;
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function measureHeaderText(text: string): number {
  return measureText(text, 13, 500);
}

function measureBodyText(text: string): number {
  return measureStyledText(text, 13, 400, false);
}

function measureBadgeText(text: string): number {
  return measureStyledText(text, 12, 500, false);
}

function measureText(text: string, fontSize: number, fontWeight: number): number {
  return measureStyledText(text, fontSize, fontWeight, false);
}

function measureStyledText(
  text: string,
  fontSize: number,
  fontWeight: number,
  italic: boolean,
  fontFamily?: string,
): number {
  if (!text) return 0;
  const context = getMeasureContext();
  if (!context) return estimateTextFallback(text, fontSize, fontWeight, italic);
  context.font = `${italic ? "italic " : ""}${fontWeight} ${fontSize}px ${fontFamily || getFontFamily()}`;
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

function getMonospaceFontFamily(): string {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function" || !window.activeDocument?.body) return "monospace";
  return window.getComputedStyle(window.activeDocument.body).getPropertyValue("--font-monospace").trim() || "monospace";
}

function estimateTextFallback(text: string, fontSize: number, fontWeight = 400, italic = false): number {
  const base = Array.from(text).reduce((total, char) => {
    const code = char.codePointAt(0) || 0;
    if (code >= 0x2e80) return total + fontSize;
    if (/[A-ZMW@#%&]/.test(char)) return total + fontSize * 0.72;
    if (/[il.,'`:;|!]/.test(char)) return total + fontSize * 0.32;
    return total + fontSize * 0.54;
  }, 0);
  const weightScale = fontWeight >= 600 ? 1.08 : 1;
  return base * weightScale * (italic ? 1.02 : 1);
}
