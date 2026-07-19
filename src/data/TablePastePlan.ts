import type { TableCellAddress } from "./TableKeyboardNavigation";

export interface TablePasteLayout {
  startRow: number;
  startCol: number;
  fillRows: number;
  fillCols: number;
  existingRows: number;
  usableCols: number;
  newRows: number;
}

/**
 * Resolve the spreadsheet paste rectangle without mutating data.
 *
 * A one-cell clipboard value fills the current selection. A matrix always starts at the
 * selection's top-left cell. Rows may extend beyond the current record grid (the caller can
 * create records); columns remain bounded because a paste must never create schema implicitly.
 */
export function planTablePasteLayout(
  rowPaths: string[],
  colKeys: string[],
  selected: TableCellAddress[],
  matrix: string[][],
): TablePasteLayout | null {
  const selectedRowIndexes = selected
    .map((cell) => rowPaths.indexOf(cell.rowPath))
    .filter((index) => index >= 0);
  const selectedColIndexes = selected
    .map((cell) => colKeys.indexOf(cell.colKey))
    .filter((index) => index >= 0);
  if (selectedRowIndexes.length === 0 || selectedColIndexes.length === 0 || matrix.length === 0) {
    return null;
  }

  const startRow = Math.min(...selectedRowIndexes);
  const startCol = Math.min(...selectedColIndexes);
  const isSingleValue = matrix.length === 1 && matrix[0]?.length === 1;
  const selectedRows = Math.max(1, new Set(selected.map((cell) => cell.rowPath)).size);
  const selectedCols = Math.max(1, new Set(selected.map((cell) => cell.colKey)).size);
  const fillRows = isSingleValue ? selectedRows : matrix.length;
  const fillCols = isSingleValue
    ? selectedCols
    : Math.max(0, ...matrix.map((row) => row.length));
  const existingRows = Math.max(0, Math.min(fillRows, rowPaths.length - startRow));
  const usableCols = Math.max(0, Math.min(fillCols, colKeys.length - startCol));

  return {
    startRow,
    startCol,
    fillRows,
    fillCols,
    existingRows,
    usableCols,
    newRows: Math.max(0, fillRows - existingRows),
  };
}

export function getTablePasteValue(
  matrix: string[][],
  rowOffset: number,
  colOffset: number,
): string {
  if (matrix.length === 1 && matrix[0]?.length === 1) return matrix[0][0];
  return matrix[rowOffset]?.[colOffset] ?? "";
}
