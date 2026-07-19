export interface TableCellAddress {
  rowPath: string;
  colKey: string;
}

export interface TableGridPosition {
  rowIndex: number;
  colIndex: number;
}

export type TableCellNavigationIntent =
  | "stay"
  | "up"
  | "down"
  | "left"
  | "right"
  | "previous"
  | "next"
  | "row-start"
  | "row-end"
  | "column-start"
  | "column-end"
  | "grid-start"
  | "grid-end";

const clampIndex = (index: number, length: number): number =>
  Math.min(Math.max(index, 0), Math.max(0, length - 1));

/**
 * Resolves spreadsheet-style movement against the currently rendered grid.
 * Horizontal movement wraps across rows; vertical and edge movement clamp.
 * `fallback` preserves a useful intersection when an edit changes filters,
 * sorting, or grouping and the original row is no longer rendered.
 */
export function resolveTableCellNavigation(
  rowPaths: string[],
  colKeys: string[],
  current: TableCellAddress,
  intent: TableCellNavigationIntent,
  fallback?: TableGridPosition | null,
): TableCellAddress | null {
  if (rowPaths.length === 0 || colKeys.length === 0) return null;

  const currentRow = rowPaths.indexOf(current.rowPath);
  const currentCol = colKeys.indexOf(current.colKey);
  let rowIndex = currentRow >= 0
    ? currentRow
    : clampIndex(fallback?.rowIndex ?? 0, rowPaths.length);
  let colIndex = currentCol >= 0
    ? currentCol
    : clampIndex(fallback?.colIndex ?? 0, colKeys.length);

  if (intent === "up") rowIndex = Math.max(0, rowIndex - 1);
  else if (intent === "down") rowIndex = Math.min(rowPaths.length - 1, rowIndex + 1);
  else if (intent === "right") colIndex = Math.min(colKeys.length - 1, colIndex + 1);
  else if (intent === "left") colIndex = Math.max(0, colIndex - 1);
  else if (intent === "previous") {
    if (colIndex > 0) colIndex -= 1;
    else if (rowIndex > 0) {
      rowIndex -= 1;
      colIndex = colKeys.length - 1;
    }
  } else if (intent === "next") {
    if (colIndex < colKeys.length - 1) colIndex += 1;
    else if (rowIndex < rowPaths.length - 1) {
      rowIndex += 1;
      colIndex = 0;
    }
  } else if (intent === "row-start") colIndex = 0;
  else if (intent === "row-end") colIndex = colKeys.length - 1;
  else if (intent === "column-start") rowIndex = 0;
  else if (intent === "column-end") rowIndex = rowPaths.length - 1;
  else if (intent === "grid-start") {
    rowIndex = 0;
    colIndex = 0;
  } else if (intent === "grid-end") {
    rowIndex = rowPaths.length - 1;
    colIndex = colKeys.length - 1;
  }

  return { rowPath: rowPaths[rowIndex], colKey: colKeys[colIndex] };
}

export function moveTableCellByRowOffset(
  rowPaths: string[],
  colKeys: string[],
  current: TableCellAddress,
  offset: number,
  fallback?: TableGridPosition | null,
): TableCellAddress | null {
  const resolved = resolveTableCellNavigation(rowPaths, colKeys, current, "stay", fallback);
  if (!resolved) return null;
  const rowIndex = clampIndex(rowPaths.indexOf(resolved.rowPath) + Math.trunc(offset), rowPaths.length);
  return { rowPath: rowPaths[rowIndex], colKey: resolved.colKey };
}

export function isTableCellAtGridEdge(
  rowPaths: string[],
  colKeys: string[],
  current: TableCellAddress,
  edge: "start" | "end",
): boolean {
  if (rowPaths.length === 0 || colKeys.length === 0) return false;
  const expectedRow = edge === "start" ? rowPaths[0] : rowPaths[rowPaths.length - 1];
  const expectedCol = edge === "start" ? colKeys[0] : colKeys[colKeys.length - 1];
  return current.rowPath === expectedRow && current.colKey === expectedCol;
}

export function cycleTableSelectionActiveCell(
  rowPaths: string[],
  colKeys: string[],
  anchor: TableCellAddress,
  focus: TableCellAddress,
  active: TableCellAddress,
  direction: "next" | "previous",
): TableCellAddress | null {
  const anchorRow = rowPaths.indexOf(anchor.rowPath);
  const focusRow = rowPaths.indexOf(focus.rowPath);
  const anchorCol = colKeys.indexOf(anchor.colKey);
  const focusCol = colKeys.indexOf(focus.colKey);
  if (anchorRow < 0 || focusRow < 0 || anchorCol < 0 || focusCol < 0) return null;

  const cells: TableCellAddress[] = [];
  for (let rowIndex = Math.min(anchorRow, focusRow); rowIndex <= Math.max(anchorRow, focusRow); rowIndex++) {
    for (let colIndex = Math.min(anchorCol, focusCol); colIndex <= Math.max(anchorCol, focusCol); colIndex++) {
      cells.push({ rowPath: rowPaths[rowIndex], colKey: colKeys[colIndex] });
    }
  }
  if (cells.length === 0) return null;
  const currentIndex = cells.findIndex((cell) => cell.rowPath === active.rowPath && cell.colKey === active.colKey);
  const startIndex = currentIndex >= 0 ? currentIndex : direction === "next" ? -1 : 0;
  const offset = direction === "next" ? 1 : -1;
  const nextIndex = (startIndex + offset + cells.length) % cells.length;
  return cells[nextIndex];
}

export interface TableSelectionFillStep {
  source: TableCellAddress;
  target: TableCellAddress;
}

export function planTableSelectionFill(
  rowPaths: string[],
  colKeys: string[],
  anchor: TableCellAddress,
  focus: TableCellAddress,
  direction: "down" | "right",
): TableSelectionFillStep[] {
  const anchorRow = rowPaths.indexOf(anchor.rowPath);
  const focusRow = rowPaths.indexOf(focus.rowPath);
  const anchorCol = colKeys.indexOf(anchor.colKey);
  const focusCol = colKeys.indexOf(focus.colKey);
  if (anchorRow < 0 || focusRow < 0 || anchorCol < 0 || focusCol < 0) return [];

  const rowStart = Math.min(anchorRow, focusRow);
  const rowEnd = Math.max(anchorRow, focusRow);
  const colStart = Math.min(anchorCol, focusCol);
  const colEnd = Math.max(anchorCol, focusCol);
  const steps: TableSelectionFillStep[] = [];

  if (direction === "down") {
    for (let rowIndex = rowStart + 1; rowIndex <= rowEnd; rowIndex++) {
      for (let colIndex = colStart; colIndex <= colEnd; colIndex++) {
        steps.push({
          source: { rowPath: rowPaths[rowStart], colKey: colKeys[colIndex] },
          target: { rowPath: rowPaths[rowIndex], colKey: colKeys[colIndex] },
        });
      }
    }
    return steps;
  }

  for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex++) {
    for (let colIndex = colStart + 1; colIndex <= colEnd; colIndex++) {
      steps.push({
        source: { rowPath: rowPaths[rowIndex], colKey: colKeys[colStart] },
        target: { rowPath: rowPaths[rowIndex], colKey: colKeys[colIndex] },
      });
    }
  }
  return steps;
}
