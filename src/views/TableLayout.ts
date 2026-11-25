export interface TableColumnStyle {
  width?: string;
  minWidth?: string;
}

export interface TableLayout {
  tableWidth: number;
  columnWidths: number[];
}

export const MAX_FROZEN_COLUMNS = 5;

export function normalizeFrozenColumnCount(value: number | undefined, columnCount = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_FROZEN_COLUMNS, Math.floor(value as number), columnCount));
}

export interface FrozenColumnOffsets {
  leading: number[];
  data: number[];
}

/** Calculate sticky left offsets for leading utility columns and data columns. */
export function getFrozenColumnOffsets(
  leadingWidths: number[],
  dataWidths: number[],
  frozenColumnCount: number,
): FrozenColumnOffsets {
  const leading: number[] = [];
  let left = 0;
  for (const width of leadingWidths) {
    leading.push(left);
    left += width;
  }
  const data: number[] = [];
  for (let index = 0; index < dataWidths.length; index += 1) {
    data.push(left);
    if (index < frozenColumnCount) left += dataWidths[index];
  }
  return { leading, data };
}

export interface FrozenTableLayout {
  frozenCount: number;
  iconOffset: number | undefined;
  dataOffsets: number[];
}

/** The record icon belongs to the first data column's frozen region, not to the selection gutter. */
export function getFrozenTableLayout(
  selectionWidth: number, iconWidth: number, dataWidths: number[], requestedCount: number | undefined,
): FrozenTableLayout {
  const frozenCount = normalizeFrozenColumnCount(requestedCount, dataWidths.length);
  const iconOffset = frozenCount > 0 && iconWidth > 0 ? selectionWidth : undefined;
  const leadingWidths = [selectionWidth, iconOffset === undefined ? 0 : iconWidth];
  const { data } = getFrozenColumnOffsets(leadingWidths, dataWidths, frozenCount);
  return { frozenCount, iconOffset, dataOffsets: data };
}

export function getTableMinWidth(selectionWidth: number, columnWidths: number[]): number {
  return selectionWidth + columnWidths.reduce((total, width) => total + width, 0);
}

export function getTableLayout(selectionWidth: number, columnWidths: number[], availableWidth = 0): TableLayout {
  const baseWidth = getTableMinWidth(selectionWidth, columnWidths);
  const rendered = [...columnWidths];
  const extra = Math.max(0, Math.floor(availableWidth) - baseWidth);
  if (extra > 0 && rendered.length > 0) {
    rendered[rendered.length - 1] += extra;
  }
  return {
    tableWidth: baseWidth + extra,
    columnWidths: rendered,
  };
}

export function getTableColumnStyle(width: number, _index: number, _total: number): TableColumnStyle {
  return { width: `${width}px` };
}
