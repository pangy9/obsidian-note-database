import { ColumnDef, RowData, ViewConfig } from "../data/types";
import { toBooleanValue } from "../data/ColumnTypes";
import { t } from "../i18n";
import { renderPropertyTypeIcon } from "./PropertyTypeIcon";

const ROW_MIME = "application/x-note-database-row";
const ROW_FROM_GROUP_MIME = "application/x-note-database-row-from-group";

export interface TableGroup {
  key: string;
  rows: RowData[];
  count: number;
}

export interface TableRendererActions {
  getVisibleColumns(config: ViewConfig, rows: RowData[]): ColumnDef[];
  isRowSelected(row: RowData): boolean;
  toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void;
  areAllRowsSelected(rows: RowData[]): boolean;
  toggleRowsSelected(rows: RowData[], selected: boolean): void;
  setupColumnHeader(th: HTMLElement, col: ColumnDef): void;
  setupRow(tr: HTMLElement, row: RowData): void;
  renderCell(td: HTMLElement, row: RowData, col: ColumnDef): void;
  setupFillHandle?(td: HTMLElement, row: RowData, col: ColumnDef): void;
  moveRowsToGroup?(row: RowData, field: string, fromGroupKey: string, toGroupKey: string): void | Promise<void>;
  createEntry(defaults?: Record<string, unknown>): void;
  isGroupCollapsed?(field: string, key: string): boolean;
  toggleGroupCollapsed?(field: string, key: string): void;
  /** When true, the "+ 新建" row is not rendered */
  readonly hideCreateEntry?: boolean;
  /** When true, row-level data mutation controls are not rendered */
  readonly isReadOnly?: boolean;
}

export class TableRenderer {
  private rowByPath = new Map<string, RowData>();

  constructor(private actions: TableRendererActions) {}

  renderTable(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
    this.clearTable(container);
    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));

    const visibleColumns = this.actions.getVisibleColumns(config, rows);
    const tableWrap = container.createDiv({ cls: "db-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "db-table" });
    this.applyTableWidth(table, config, visibleColumns);
    this.renderColgroup(table, config, visibleColumns);
    this.renderHeader(table, config, visibleColumns, rows);
    const tbody = table.createEl("tbody");
    this.renderRows(tbody, config, rows, visibleColumns);
    if (!this.actions.hideCreateEntry) {
      this.renderNewRow(tbody, visibleColumns.length + 1);
    }
  }

  renderGroupedTable(
    containerEl: HTMLElement,
    config: ViewConfig,
    rows: RowData[],
    groups: TableGroup[],
    groupField?: string
  ): void {
    this.clearTable(containerEl);
    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));

    if (rows.length === 0) {
      containerEl.createDiv({
        cls: "db-empty",
        text: t("common.noMatchingData"),
      });
      return;
    }

    const container = containerEl.createDiv({ cls: "db-grouped-table" });
    const visibleColumns = this.actions.getVisibleColumns(config, rows);
    const tableMinWidth = this.getTableMinWidth(config, visibleColumns);

    for (const group of groups) {
      const groupHeader = container.createEl("div", {
        cls: "db-group-header",
      });
      if (groupField) this.setupGroupDropTarget(groupHeader, groupField, group.key);
      groupHeader.style.minWidth = `${tableMinWidth}px`;
      const collapsed = Boolean(groupField && this.actions.isGroupCollapsed?.(groupField, group.key));
      groupHeader.toggleClass("is-collapsed", collapsed);
      const label = groupHeader.createSpan({ cls: "db-group-header-label" });
      if (groupField) {
        const toggle = label.createEl("button", {
          cls: `db-group-collapse-toggle${collapsed ? " is-collapsed" : ""}`,
          attr: { type: "button", "aria-label": collapsed ? t("group.expand") : t("group.collapse") },
        });
        toggle.createSpan({ cls: "db-collapse-triangle" });
        toggle.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.actions.toggleGroupCollapsed?.(groupField, group.key);
        };
      }
      label.createSpan({
        cls: "db-group-title-text",
        text: group.key || t("common.uncategorized"),
      });
      label.createSpan({ cls: "db-group-count", text: String(group.count) });

      if (collapsed) continue;

      const tableWrap = container.createDiv({ cls: "db-table-wrap" });
      if (groupField) this.setupGroupDropTarget(tableWrap, groupField, group.key);
      const table = tableWrap.createEl("table", { cls: "db-table" });
      this.applyTableWidth(table, config, visibleColumns);
      tableWrap.style.minWidth = `${this.getTableMinWidth(config, visibleColumns)}px`;
      this.renderColgroup(table, config, visibleColumns);
      this.renderHeader(table, config, visibleColumns, group.rows);
      const tbody = table.createEl("tbody");
      if (groupField) this.setupGroupDropTarget(tbody, groupField, group.key);
      this.renderRows(tbody, config, group.rows, visibleColumns, groupField, group.key);
      if (!this.actions.hideCreateEntry) {
        const defaults = groupField ? this.getGroupDefaults(config, groupField, group.key) : undefined;
        this.renderNewRow(tbody, visibleColumns.length + 1, defaults);
      }
    }
  }

  private clearTable(container: HTMLElement): void {
    container.querySelectorAll(".db-table-wrap, .db-grouped-table, .db-empty").forEach((el) => el.remove());
  }

  private renderColgroup(table: HTMLElement, config: ViewConfig, columns: ColumnDef[]): void {
    const colgroup = table.createEl("colgroup");
    const renderedWidths = this.getRenderedColumnWidths(config, columns);
    if (!this.actions.isReadOnly) {
      const selectionCol = colgroup.createEl("col");
      selectionCol.addClass("db-select-colgroup");
      selectionCol.setAttr("width", "34");
      selectionCol.style.width = "34px";
    }
    columns.forEach((col, index) => {
      const colEl = colgroup.createEl("col");
      colEl.setAttr("data-note-database-column-key", col.key);
      colEl.style.width = `${renderedWidths[index]}px`;
    });
  }

  private getTableMinWidth(config: ViewConfig, columns: ColumnDef[]): number {
    const selectionWidth = this.actions.isReadOnly ? 0 : 34;
    const columnWidth = columns.reduce((total, col) => total + this.getColumnWidth(config, col), 0);
    return Math.max(720, selectionWidth + columnWidth);
  }

  private applyTableWidth(table: HTMLElement, config: ViewConfig, columns: ColumnDef[]): void {
    const width = this.getTableMinWidth(config, columns);
    table.style.width = `${width}px`;
    table.style.minWidth = `${width}px`;
  }

  private getRenderedColumnWidths(config: ViewConfig, columns: ColumnDef[]): number[] {
    const widths = columns.map((col) => this.getColumnWidth(config, col));
    if (widths.length === 0) return widths;
    const selectionWidth = this.actions.isReadOnly ? 0 : 34;
    const baseWidth = widths.reduce((total, width) => total + width, 0);
    const extraWidth = this.getTableMinWidth(config, columns) - selectionWidth - baseWidth;
    if (extraWidth <= 0) return widths;
    const extraPerColumn = extraWidth / widths.length;
    return widths.map((width) => width + extraPerColumn);
  }

  private getColumnWidth(config: ViewConfig, col: ColumnDef): number {
    return col.width || config.defaultColumnWidth || 150;
  }

  private renderHeader(table: HTMLElement, config: ViewConfig, columns: ColumnDef[], rows: RowData[]): void {
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    if (!this.actions.isReadOnly) {
      const selectTh = headerRow.createEl("th", { cls: "db-select-col" });
      const selectAll = selectTh.createEl("input", { attr: { type: "checkbox" } });
      selectAll.checked = this.actions.areAllRowsSelected(rows);
      selectAll.onchange = () => {
        this.actions.toggleRowsSelected(rows, selectAll.checked);
      };
    }
    for (const col of columns) {
      const th = headerRow.createEl("th");
      th.setAttr("data-note-database-column-key", col.key);
      th.toggleClass("is-narrow", this.isHeaderNarrow(config, col));
      const content = th.createDiv({ cls: "db-th-content" });
      renderPropertyTypeIcon(content, col);
      content.createSpan({ cls: "db-th-label", text: col.label || col.key, attr: { title: col.label || col.key } });
      const sort = this.getColumnSortState(config, col);
      if (sort) {
        const arrow = sort.direction === "asc" ? "▲" : "▼";
        const suffix = sort.total > 1 ? String(sort.index + 1) : "";
        content.createSpan({ text: `${arrow}${suffix}`, cls: "sort-indicator" });
      }
      this.actions.setupColumnHeader(th, col);
    }
  }

  private getColumnSortState(config: ViewConfig, col: ColumnDef): { direction: "asc" | "desc"; index: number; total: number } | null {
    const rules = (config.sortRules || []).filter((rule) => rule.field && rule.direction);
    const index = rules.findIndex((rule) => rule.field === col.key);
    if (index >= 0) return { direction: rules[index].direction, index, total: rules.length };
    if (rules.length === 0 && config.sortColumn === col.key) {
      return { direction: config.sortDirection || "asc", index: 0, total: 1 };
    }
    return null;
  }

  private isHeaderNarrow(config: ViewConfig, col: ColumnDef): boolean {
    const width = this.getColumnWidth(config, col);
    const labelLength = (col.label || col.key).length;
    return width < Math.min(180, Math.max(96, labelLength * 7 + 54));
  }

  private renderRows(
    tbody: HTMLElement,
    config: ViewConfig,
    rows: RowData[],
    columns: ColumnDef[],
    groupField?: string,
    groupKey?: string
  ): void {
    for (const row of rows) {
      const tr = tbody.createEl("tr", {
        attr: { "data-note-database-row-path": row.file.path },
      });
      this.actions.setupRow(tr, row);
      if (groupField && groupKey != null) this.setupGroupedRowDrag(tr, row, groupField, groupKey);
      if (!this.actions.isReadOnly) {
        const selectTd = tr.createEl("td", { cls: "db-select-col" });
        const cb = selectTd.createEl("input", { attr: { type: "checkbox" } });
        cb.checked = this.actions.isRowSelected(row);
        cb.onclick = (event) => {
          event.stopPropagation();
          this.actions.toggleRowSelected(row, !this.actions.isRowSelected(row), event);
        };
      }
      for (const col of columns) {
        const td = tr.createEl("td", {
          attr: {
            "data-note-database-row-path": row.file.path,
            "data-note-database-column-key": col.key,
          },
        });
        this.actions.renderCell(td, row, col);
        if (!this.actions.isReadOnly) this.actions.setupFillHandle?.(td, row, col);
      }
    }
  }

  private renderNewRow(tbody: HTMLElement, colspan: number, defaults?: Record<string, unknown>): void {
    const tr = tbody.createEl("tr", { cls: "db-new-row" });
    const td = tr.createEl("td", { attr: { colspan: String(Math.max(colspan, 1)) } });
    const btn = td.createEl("button", { cls: "db-new-row-button", text: `+ ${t("toolbar.new")}` });
    btn.onclick = () => this.actions.createEntry(defaults);
  }

  private setupGroupedRowDrag(tr: HTMLElement, row: RowData, groupField: string, groupKey: string): void {
    if (this.actions.isReadOnly || !this.actions.moveRowsToGroup) return;
    if (this.isPhoneLayout()) return;
    tr.draggable = true;
    tr.addEventListener("dragstart", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, button, .db-cell-fill-handle")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData(ROW_MIME, row.file.path);
      event.dataTransfer?.setData("text/plain", row.file.path);
      event.dataTransfer?.setData(ROW_FROM_GROUP_MIME, groupKey);
      tr.addClass("is-dragging");
    });
    tr.addEventListener("dragend", () => tr.removeClass("is-dragging"));
  }

  private setupGroupDropTarget(target: HTMLElement, groupField: string, groupKey: string): void {
    if (this.actions.isReadOnly || !this.actions.moveRowsToGroup) return;
    target.addEventListener("dragover", (event) => {
      if (!this.isRowDrag(event)) return;
      event.preventDefault();
      this.setGroupDropTarget(target, true);
    });
    target.addEventListener("dragleave", () => this.setGroupDropTarget(target, false));
    target.addEventListener("drop", (event) => {
      if (!this.isRowDrag(event)) return;
      const path = event.dataTransfer?.getData(ROW_MIME) || event.dataTransfer?.getData("text/plain");
      const row = path ? this.rowByPath.get(path) : undefined;
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      this.setGroupDropTarget(target, false);
      const fromGroupKey = event.dataTransfer?.getData(ROW_FROM_GROUP_MIME) || "";
      void this.actions.moveRowsToGroup?.(row, groupField, fromGroupKey, groupKey);
    });
  }

  private setGroupDropTarget(target: HTMLElement, active: boolean): void {
    target.toggleClass("is-drop-target", active);
    const tableWrap = target.closest<HTMLElement>(".db-table-wrap");
    if (tableWrap && target !== tableWrap) tableWrap.toggleClass("is-drop-target", active);
  }

  private isRowDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types || []).includes(ROW_MIME);
  }

  private isPhoneLayout(): boolean {
    return document.body.classList.contains("is-phone");
  }

  private getGroupDefaults(config: ViewConfig, groupField: string, groupKey: string): Record<string, unknown> {
    if (groupKey === t("common.uncategorized")) return { [groupField]: "" };
    const col = config.schema.columns.find((candidate) => candidate.key === groupField);
    if (col?.type === "multi-select") return { [groupField]: [groupKey] };
    if (col?.type === "checkbox") return { [groupField]: toBooleanValue(groupKey) };
    return { [groupField]: groupKey };
  }

}
