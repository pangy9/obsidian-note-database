import { ColumnDef, RowData } from "../data/types";

export function estimateAutoColumnWidth(
  col: ColumnDef,
  rows: RowData[],
  getDisplayText: (row: RowData, col: ColumnDef) => string
): number {
  const label = col.label || col.key;
  const headerWidth = Math.ceil(label.length * 7.2 + 76);
  if (col.type === "checkbox") return Math.max(54, Math.min(headerWidth, 220));
  if (col.wrap) return Math.max(36, Math.min(headerWidth, 360));

  const longestValue = rows.reduce((max, row) => {
    const text = getDisplayText(row, col).replace(/\s+/g, " ");
    return Math.max(max, text.length);
  }, 0);
  const valueWidth = Math.ceil(longestValue * 7.2 + 48);
  return Math.max(36, Math.min(Math.max(headerWidth, valueWidth), 800));
}
