import { ColumnDef, RowData } from "./types";
import { isObsidianTagsKey, toMultiSelectValuesForKey } from "./ColumnTypes";
import { getRowFileFieldValue, isBaseFileField } from "./FileFields";
import { stringifyValue } from "./Stringify";

export interface CellAddress {
  rowPath: string;
  colKey: string;
}

type ClipboardFormat = "tsv" | "markdown" | "csv";

/**
 * Serialize selected cells in TSV, Markdown, or CSV format.
 * Shared by Dashboard and embedded views.
 */
export function serializeSelectedCells(
  format: ClipboardFormat,
  selectedAddrs: CellAddress[],
  renderedRowPaths: string[],
  renderedColKeys: string[],
  rowByPath: Map<string, RowData>,
  colByKey: Map<string, ColumnDef>,
  getDisplayText: (row: RowData, col: ColumnDef) => string
): string {
  const selectedSet = new Set(selectedAddrs.map((cell) => `${cell.rowPath}\u0000${cell.colKey}`));
  const matrix: string[][] = [];
  const includedColKeys = renderedColKeys.filter((colKey) =>
    selectedAddrs.some((cell) => cell.colKey === colKey)
  );
  for (const rowPath of renderedRowPaths) {
    const values: string[] = [];
    for (const colKey of renderedColKeys) {
      if (!selectedSet.has(`${rowPath}\u0000${colKey}`)) continue;
      const row = rowByPath.get(rowPath);
      const col = colByKey.get(colKey);
      values.push(row && col ? getDisplayText(row, col) : "");
    }
    if (values.length > 0) matrix.push(values);
  }
  const headers = includedColKeys.map((key) => colByKey.get(key)?.label || key);
  return serializeCellMatrix(format, matrix, headers);
}

export function serializeCellMatrix(format: ClipboardFormat, matrix: string[][], headers: string[] = []): string {
  if (format === "markdown") return serializeMarkdownTable(matrix, headers);
  if (format === "csv") return serializeDelimited(matrix, ",", true);
  return serializeDelimited(matrix, "\t");
}

export function parseClipboardTable(text: string): string[][] {
  if (text === "") return [];
  const markdown = parseMarkdownTable(text);
  if (markdown) return markdown;
  if (hasUnquotedDelimiter(text, "\t")) return parseDelimited(text, "\t");
  if (isExplicitCsv(text)) return parseCsv(text);
  return splitPlainClipboardText(text).map((line) => [line]);
}

export function parseCsv(text: string): string[][] {
  return parseDelimited(text, ",");
}

export function parseMarkdownTable(text: string): string[][] | null {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = lines
    .filter((line) => /^\s*\|/.test(line))
    .map((line) => splitMarkdownTableRow(line));
  if (rows.length < 2) return null;
  const separatorIndex = rows.findIndex(isMarkdownSeparatorRow);
  if (separatorIndex < 0) return null;
  return rows
    .filter((_, index) => index > separatorIndex)
    .filter((row) => row.length > 0);
}

function serializeMarkdownTable(matrix: string[][], headers: string[]): string {
  const columnCount = Math.max(headers.length, ...matrix.map((row) => row.length), 1);
  const resolvedHeaders = Array.from({ length: columnCount }, (_, index) => headers[index] || "");
  return [
    `| ${resolvedHeaders.map(escapeMarkdownCell).join(" | ")} |`,
    `| ${resolvedHeaders.map(() => "---").join(" | ")} |`,
    ...matrix.map((row) => `| ${Array.from({ length: columnCount }, (_, index) => escapeMarkdownCell(row[index] || "")).join(" | ")} |`),
  ].join("\n");
}

function serializeDelimited(matrix: string[][], delimiter: "," | "\t", quoteAll = false): string {
  return matrix.map((row) => row.map((value) => escapeDelimitedCell(value, delimiter, quoteAll)).join(delimiter)).join("\n");
}

function escapeDelimitedCell(value: string, delimiter: "," | "\t", quoteAll = false): string {
  if (!quoteAll && !value.includes(delimiter) && !/["\r\n\t]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== "" || !text.endsWith("\n")) rows.push(row);
  return rows;
}

function isExplicitCsv(text: string): boolean {
  const withoutTrailingBreak = stripClipboardTrailingLineBreak(text);
  return /^\s*"/.test(withoutTrailingBreak);
}

function stripClipboardTrailingLineBreak(text: string): string {
  return text.replace(/\r?\n$/, "");
}

function splitPlainClipboardText(text: string): string[] {
  return stripClipboardTrailingLineBreak(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function hasUnquotedDelimiter(text: string, delimiter: "," | "\t"): boolean {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i + 1] === '"') {
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === delimiter && !quoted) return true;
  }
  return false;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const ch of trimmed) {
    if (escaped) {
      cell += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function isMarkdownSeparatorRow(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/** Get the display text for a cell value */
export function getCellDisplayText(row: RowData, col: ColumnDef): string {
  const value =
    isBaseFileField(col.key)
      ? getRowFileFieldValue(row, col.key)
      : col.type === "computed" && col.computedKey
      ? row.computed[col.computedKey]
      : row.frontmatter[col.key];
  if (value == null) return "";
  if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, value).join(", ");
  if (Array.isArray(value)) return value.map((entry) => stringifyValue(entry)).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return stringifyValue(value);
    }
  }
  return stringifyValue(value);
}
