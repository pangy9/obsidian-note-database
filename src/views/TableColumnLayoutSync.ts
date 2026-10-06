import { ColumnDef, ViewConfig } from "../data/types";
import { getFrozenColumnOffsets, getTableColumnStyle, getTableLayout, normalizeFrozenColumnCount } from "./TableLayout";

export function syncTableColumnLayouts(root: ParentNode, config: ViewConfig): void {
  if (typeof CSS === "undefined" || !CSS.escape) return;

  const columnByKey = new Map(config.schema.columns.map((column) => [column.key, column]));
  root.querySelectorAll<HTMLTableElement>("table.db-table").forEach((table) => {
    const colgroup = table.querySelector("colgroup");
    if (!colgroup) return;

    const dataCols = Array.from(colgroup.querySelectorAll<HTMLElement>("col[data-note-database-column-key]"));
    if (dataCols.length === 0) return;

    const keys = dataCols.map((colEl) => colEl.getAttribute("data-note-database-column-key") || "");
    const baseWidths = keys.map((key) => getColumnWidth(columnByKey.get(key), config));
    const selectionCol = colgroup.querySelector<HTMLElement>("col.db-select-colgroup");
    const selectionWidth = selectionCol ? getSelectionColumnWidth(selectionCol) : 0;
    const iconCol = colgroup.querySelector<HTMLElement>("col.db-record-icon-colgroup");
    const iconWidth = iconCol ? getSelectionColumnWidth(iconCol) : 0;
    const layout = getTableLayout(selectionWidth + iconWidth, baseWidths, getAvailableTableWidth(table));

    table.style.width = `${layout.tableWidth}px`;
    table.style.minWidth = `${layout.tableWidth}px`;
    const tableWrap = table.closest<HTMLElement>(".db-table-wrap");
    if (tableWrap) tableWrap.style.minWidth = `${layout.tableWidth}px`;

    if (selectionCol) {
      selectionCol.setAttr("width", String(selectionWidth));
      selectionCol.setCssProps({ width: `${selectionWidth}px` });
    }

    dataCols.forEach((colEl, index) => {
      const style = getTableColumnStyle(layout.columnWidths[index], index, dataCols.length);
      colEl.style.width = style.width || "";
      colEl.style.minWidth = style.minWidth || "";
    });

    applyFrozenCells(table, config, layout.columnWidths, selectionWidth, iconWidth);
  });

  for (const col of columnByKey.values()) {
    const escaped = CSS.escape(col.key);
    root.querySelectorAll<HTMLElement>(`th[data-note-database-column-key="${escaped}"]`).forEach((el) => {
      const renderedWidth = getRenderedHeaderWidth(el, col, config);
      el.style.width = `${renderedWidth}px`;
      el.toggleClass("is-narrow", isHeaderNarrow(renderedWidth, col));
    });
  }
}

function applyFrozenCells(
  table: HTMLTableElement,
  config: ViewConfig,
  dataWidths: number[],
  selectionWidth: number,
  iconWidth: number,
): void {
  const leadingWidths = [selectionWidth, iconWidth].filter((width) => width > 0);
  const frozenCount = normalizeFrozenColumnCount(config.frozenColumnCount, dataWidths.length);
  const offsets = getFrozenColumnOffsets(leadingWidths, dataWidths, frozenCount);
  const leadingSelectors = [
    selectionWidth > 0 ? ".db-select-col" : "",
    iconWidth > 0 ? ".db-record-icon-col" : "",
  ].filter(Boolean);
  let leadingIndex = 0;
  for (const selector of leadingSelectors) {
    // 工具列常驻钉住但不画冻结边界：未冻结数据列时 checkbox 列右侧的加粗
    // 分隔线是噪音；边界只画在最后一个被冻结的数据列上（下方 keys 循环）。
    table.querySelectorAll<HTMLElement>(selector).forEach((cell) => {
      cell.addClass("db-frozen-cell");
      cell.style.left = `${offsets.leading[leadingIndex] || 0}px`;
      cell.removeClass("db-frozen-boundary");
    });
    leadingIndex += 1;
  }
  const keys = Array.from(table.querySelectorAll<HTMLElement>("col[data-note-database-column-key]"))
    .map((col) => col.getAttribute("data-note-database-column-key") || "");
  keys.forEach((key, index) => {
    const frozen = index < frozenCount;
    table.querySelectorAll<HTMLElement>(`th[data-note-database-column-key="${CSS.escape(key)}"], td[data-note-database-column-key="${CSS.escape(key)}"]`)
      .forEach((cell) => {
        cell.toggleClass("db-frozen-cell", frozen);
        cell.toggleClass("db-frozen-boundary", frozen && index === frozenCount - 1);
        if (frozen) cell.style.left = `${offsets.data[index] || 0}px`;
        else cell.style.removeProperty("left");
      });
  });
}

function getColumnWidth(col: ColumnDef | undefined, config: ViewConfig): number {
  return (col ? config.columnWidths?.[col.key] : undefined) || col?.width || config.defaultColumnWidth || 150;
}

function getRenderedHeaderWidth(th: HTMLElement, col: ColumnDef, config: ViewConfig): number {
  const table = th.closest("table.db-table");
  const colEl = table?.querySelector<HTMLElement>(`col[data-note-database-column-key="${CSS.escape(col.key)}"]`);
  const parsedWidth = colEl ? parseFloat(colEl.style.width || "") : Number.NaN;
  return Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : getColumnWidth(col, config);
}

function isHeaderNarrow(width: number, col: ColumnDef): boolean {
  const labelLength = (col.label || col.key).length;
  return width < Math.min(180, Math.max(96, labelLength * 7 + 54));
}

function getAvailableTableWidth(table: HTMLTableElement): number {
  const wrap = table.closest(".db-table-wrap");
  const parent = wrap?.parentElement;
  if (!parent) return 0;
  const cs = getComputedStyle(parent);
  const paddingLeft = parseFloat(cs.paddingLeft) || 0;
  const paddingRight = parseFloat(cs.paddingRight) || 0;
  return Math.max(0, Math.floor(parent.getBoundingClientRect().width - paddingLeft - paddingRight));
}

function getSelectionColumnWidth(selectionCol: HTMLElement): number {
  const styleWidth = parseFloat(selectionCol.style.width || "");
  if (Number.isFinite(styleWidth) && styleWidth > 0) return styleWidth;
  const attrWidth = Number(selectionCol.getAttribute("width"));
  if (Number.isFinite(attrWidth) && attrWidth > 0) return attrWidth;
  return 40;
}
