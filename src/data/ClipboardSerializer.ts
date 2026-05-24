import { ColumnDef, RowData } from "./types";

export interface CellAddress {
  rowPath: string;
  colKey: string;
}

/**
 * Serialize selected cells in TSV, Markdown, or CSV format.
 * Shared by Dashboard and embedded views.
 */
export function serializeSelectedCells(
  format: "tsv" | "markdown" | "csv",
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
  if (format === "markdown") {
    const headers = includedColKeys.map((key) => colByKey.get(key)?.label || key);
    const escapeMarkdown = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
    return [
      `| ${headers.map(escapeMarkdown).join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...matrix.map((row) => `| ${row.map(escapeMarkdown).join(" | ")} |`),
    ].join("\n");
  }
  if (format === "csv") {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    return matrix.map((row) => row.map(escapeCsv).join(",")).join("\n");
  }
  return matrix.map((row) => row.join("\t")).join("\n");
}

/** Get the display text for a cell value */
export function getCellDisplayText(row: RowData, col: ColumnDef): string {
  if (col.key === "file.name") return row.file.basename;
  const value =
    col.type === "computed" && col.computedKey
      ? row.computed[col.computedKey]
      : row.frontmatter[col.key];
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
