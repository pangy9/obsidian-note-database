import { Menu } from "obsidian";
import { ColumnDef, RowData, ViewConfig } from "../data/types";
import { toBooleanValue } from "../data/ColumnTypes";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";
import { renderMobileMoveIcon } from "./MobileMoveIcon";
import { renderPropertyTypeIcon } from "./PropertyTypeIcon";
import { getTableColumnStyle, getTableLayout, getTableMinWidth as calculateTableMinWidth } from "./TableLayout";

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
  moveRowToPosition?(movedPath: string, beforePath?: string, afterPath?: string): void;
  moveRowsToGroup?(row: RowData, field: string, fromGroupKey: string, toGroupKey: string): void | Promise<void>;
  moveRowToGroupAndPosition?(
    row: RowData,
    field: string,
    fromGroupKey: string,
    toGroupKey: string,
    beforePath?: string,
    afterPath?: string
  ): void | Promise<void>;
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
  private draggingPath: string | undefined;

  constructor(private actions: TableRendererActions) {}

  renderTable(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
    this.clearTable(container);
    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));

    const visibleColumns = this.actions.getVisibleColumns(config, rows);
    const tableWrap = container.createDiv({ cls: "db-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "db-table" });
    const availableWidth = this.getAvailableTableWidth(tableWrap);
    this.applyTableWidth(table, config, visibleColumns, availableWidth);
    this.renderColgroup(table, config, visibleColumns, availableWidth);
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
      const availableWidth = this.getAvailableTableWidth(tableWrap);
      this.applyTableWidth(table, config, visibleColumns, availableWidth);
      tableWrap.style.minWidth = `${this.getTableWidth(config, visibleColumns, availableWidth)}px`;
      this.renderColgroup(table, config, visibleColumns, availableWidth);
      this.renderHeader(table, config, visibleColumns, group.rows);
      const tbody = table.createEl("tbody");
      if (groupField) this.setupGroupDropTarget(tbody, groupField, group.key);
      this.renderRows(tbody, config, group.rows, visibleColumns, groupField, group.key, groups);
      if (!this.actions.hideCreateEntry) {
        const defaults = groupField ? this.getGroupDefaults(config, groupField, group.key) : undefined;
        this.renderNewRow(tbody, visibleColumns.length + 1, defaults);
      }
    }
  }

  private clearTable(container: HTMLElement): void {
    container.querySelectorAll(".db-table-wrap, .db-grouped-table, .db-empty").forEach((el) => el.remove());
  }

  private renderColgroup(table: HTMLElement, config: ViewConfig, columns: ColumnDef[], availableWidth = 0): void {
    const colgroup = table.createEl("colgroup");
    const renderedWidths = this.getRenderedColumnWidths(config, columns, availableWidth);
    if (!this.actions.isReadOnly) {
      const selectionCol = colgroup.createEl("col");
      const selectionWidth = this.getSelectionColumnWidth();
      selectionCol.addClass("db-select-colgroup");
      selectionCol.setAttr("width", String(selectionWidth));
      selectionCol.style.width = `${selectionWidth}px`;
    }
    columns.forEach((col, index) => {
      const colEl = colgroup.createEl("col");
      colEl.setAttr("data-note-database-column-key", col.key);
      const style = getTableColumnStyle(renderedWidths[index], index, columns.length);
      if (style.width) colEl.style.width = style.width;
      if (style.minWidth) colEl.style.minWidth = style.minWidth;
    });
  }

  private getTableMinWidth(config: ViewConfig, columns: ColumnDef[]): number {
    const selectionWidth = this.actions.isReadOnly ? 0 : this.getSelectionColumnWidth();
    return calculateTableMinWidth(selectionWidth, columns.map((col) => this.getColumnWidth(config, col)));
  }

  private getTableWidth(config: ViewConfig, columns: ColumnDef[], availableWidth = 0): number {
    const selectionWidth = this.actions.isReadOnly ? 0 : this.getSelectionColumnWidth();
    return getTableLayout(selectionWidth, columns.map((col) => this.getColumnWidth(config, col)), availableWidth).tableWidth;
  }

  private applyTableWidth(table: HTMLElement, config: ViewConfig, columns: ColumnDef[], availableWidth = 0): void {
    const width = this.getTableWidth(config, columns, availableWidth);
    table.style.minWidth = `${width}px`;
    table.style.width = `${width}px`;
  }

  private getRenderedColumnWidths(config: ViewConfig, columns: ColumnDef[], availableWidth = 0): number[] {
    const selectionWidth = this.actions.isReadOnly ? 0 : this.getSelectionColumnWidth();
    return getTableLayout(selectionWidth, columns.map((col) => this.getColumnWidth(config, col)), availableWidth).columnWidths;
  }

  private getColumnWidth(config: ViewConfig, col: ColumnDef): number {
    return config.columnWidths?.[col.key] || col.width || config.defaultColumnWidth || 150;
  }

  private getSelectionColumnWidth(): number {
    return this.isPhoneLayout() ? 62 : 34;
  }

  private getAvailableTableWidth(tableWrap: HTMLElement): number {
    const parent = tableWrap.parentElement;
    if (!parent) return 0;
    const cs = getComputedStyle(parent);
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;
    const paddingRight = parseFloat(cs.paddingRight) || 0;
    return Math.max(0, Math.floor(parent.getBoundingClientRect().width - paddingLeft - paddingRight));
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
    groupKey?: string,
    groups?: TableGroup[]
  ): void {
    for (const row of rows) {
      const tr = tbody.createEl("tr", {
        attr: { "data-note-database-row-path": row.file.path },
      });
      this.actions.setupRow(tr, row);
      this.setupRowDrag(tr, row, rows, config, groupField, groupKey);
      if (!this.actions.isReadOnly) {
        const selectTd = tr.createEl("td", { cls: "db-select-col" });
        const cb = selectTd.createEl("input", { attr: { type: "checkbox" } });
        cb.checked = this.actions.isRowSelected(row);
        cb.onclick = (event) => {
          event.stopPropagation();
          this.actions.toggleRowSelected(row, !this.actions.isRowSelected(row), event);
        };
        if (this.isPhoneLayout() && (this.canManualReorder(config) || Boolean(groupField && groups?.length))) {
          this.renderMobileMoveButton(selectTd, config, row, rows, groupField, groupKey, groups);
        }
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

  /** Phone layouts use a compact menu instead of HTML drag and drop. */
  private renderMobileMoveButton(
    parent: HTMLElement,
    config: ViewConfig,
    row: RowData,
    rows: RowData[],
    groupField?: string,
    groupKey?: string,
    groups?: TableGroup[]
  ): void {
    const button = parent.createEl("button", {
      cls: "db-table-mobile-move-btn",
      attr: { type: "button", title: t("mobile.moveCard"), "aria-label": t("mobile.moveCard") },
    });
    renderMobileMoveIcon(button);
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      if (this.canManualReorder(config)) this.addMobilePositionItems(menu, row, rows);
      if (groupField && groupKey != null && groups?.length && this.actions.moveRowToGroupAndPosition) {
        if (this.canManualReorder(config)) menu.addSeparator();
        for (const group of groups) {
          if (group.key === groupKey) continue;
          menu.addItem((item) => item
            .setTitle(`${t("mobile.moveTo")} ${group.key || t("common.uncategorized")}`)
            .setIcon("folder-input")
            .onClick(() => {
              const paths = group.rows.map((candidate) => candidate.file.path).filter((path) => path !== row.file.path);
              void this.actions.moveRowToGroupAndPosition?.(
                row,
                groupField,
                groupKey,
                group.key,
                paths[paths.length - 1],
                undefined
              );
            }));
        }
      }
      menu.showAtMouseEvent(event);
    };
  }

  /** Add local rank movement actions shared by grouped and ungrouped table rows. */
  private addMobilePositionItems(menu: Menu, row: RowData, rows: RowData[]): void {
    const paths = rows.map((candidate) => candidate.file.path);
    const index = paths.indexOf(row.file.path);
    const move = (targetIndex: number) => {
      const remaining = paths.filter((path) => path !== row.file.path);
      const boundedIndex = Math.max(0, Math.min(targetIndex, remaining.length));
      this.actions.moveRowToPosition?.(row.file.path, remaining[boundedIndex - 1], remaining[boundedIndex]);
    };
    menu.addItem((item) => item.setTitle(t("menu.moveUp")).setIcon("chevron-up").setDisabled(index <= 0).onClick(() => move(index - 1)));
    menu.addItem((item) => item.setTitle(t("menu.moveDown")).setIcon("chevron-down").setDisabled(index < 0 || index >= paths.length - 1).onClick(() => move(index + 1)));
    menu.addItem((item) => item.setTitle(t("mobile.moveTop")).setIcon("chevrons-up").setDisabled(index <= 0).onClick(() => move(0)));
    menu.addItem((item) => item.setTitle(t("mobile.moveBottom")).setIcon("chevrons-down").setDisabled(index < 0 || index >= paths.length - 1).onClick(() => move(paths.length - 1)));
  }

  private renderNewRow(tbody: HTMLElement, colspan: number, defaults?: Record<string, unknown>): void {
    const tr = tbody.createEl("tr", { cls: "db-new-row" });
    const td = tr.createEl("td", { attr: { colspan: String(Math.max(colspan, 1)) } });
    const btn = td.createEl("button", { cls: "db-new-row-button", text: `+ ${t("toolbar.new")}` });
    btn.onclick = () => this.actions.createEntry(defaults);
  }

  private setupRowDrag(
    tr: HTMLElement,
    row: RowData,
    rows: RowData[],
    config: ViewConfig,
    groupField?: string,
    groupKey?: string
  ): void {
    const canMoveGroup = Boolean(groupField && groupKey != null && typeof this.actions.moveRowsToGroup === "function");
    const canReorder = this.canManualReorder(config);
    if (this.actions.isReadOnly || (!canMoveGroup && !canReorder)) return;
    if (this.isPhoneLayout()) return;

    tr.draggable = true;
    tr.addClass("is-manual-row-draggable");
    tr.addEventListener("dragstart", (event) => {
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button, .db-cell-fill-handle")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData(ROW_MIME, row.file.path);
      event.dataTransfer?.setData("text/plain", row.file.path);
      if (groupKey != null) event.dataTransfer?.setData(ROW_FROM_GROUP_MIME, groupKey);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      this.draggingPath = row.file.path;
      this.setRowDraggingMode(tr, true);
      tr.addClass("is-dragging");
    });

    tr.addEventListener("dragend", () => {
      this.draggingPath = undefined;
      this.setRowDraggingMode(tr, false);
      tr.removeClass("is-dragging");
      this.clearRowDropTargets(tr.closest(".db-table-wrap") || tr.parentElement);
    });

    if (!canReorder) return;

    tr.addEventListener("dragover", (event) => {
      const dragPath = this.draggingPath || event.dataTransfer?.getData(ROW_MIME);
      if (!dragPath || dragPath === row.file.path) return;
      if (!this.isRowDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.clearRowDropTargets(tr.parentElement, tr);
      const rect = tr.getBoundingClientRect();
      const isAfter = event.clientY > rect.top + rect.height / 2;
      tr.toggleClass("is-drop-after", isAfter);
      tr.toggleClass("is-drop-before", !isAfter);
    });

    tr.addEventListener("dragleave", () => {
      tr.removeClass("is-drop-before", "is-drop-after");
    });

    tr.addEventListener("drop", (event) => {
      if (!this.isRowDrag(event)) return;
      const dragPath = this.draggingPath || event.dataTransfer?.getData(ROW_MIME) || event.dataTransfer?.getData("text/plain");
      const draggedRow = dragPath ? this.rowByPath.get(dragPath) : undefined;
      if (!dragPath || dragPath === row.file.path || !draggedRow) return;
      event.preventDefault();
      event.stopPropagation();
      this.draggingPath = undefined;
      this.setRowDraggingMode(tr, false);
      this.clearRowDropTargets(tr.parentElement);

      const rect = tr.getBoundingClientRect();
      const isAfter = event.clientY > rect.top + rect.height / 2;
      const position = this.getDropPosition(rows, dragPath, row.file.path, isAfter);
      void this.moveRowToDropPosition(draggedRow, dragPath, groupField, groupKey, event, position.beforePath, position.afterPath);
    });
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
    return Boolean(this.draggingPath) || Array.from(event.dataTransfer?.types || []).includes(ROW_MIME);
  }

  private canManualReorder(config: ViewConfig): boolean {
    if (!this.actions.moveRowToPosition) return false;
    if (config.sortColumn) return false;
    return !((config.sortRules || []).some((rule) => rule.field && rule.direction));
  }

  private getDropPosition(
    rows: RowData[],
    dragPath: string,
    targetPath: string,
    isAfter: boolean
  ): { beforePath?: string; afterPath?: string } {
    const paths = rows.map((candidate) => candidate.file.path).filter((path) => path !== dragPath);
    const targetIndex = paths.indexOf(targetPath);
    if (targetIndex < 0) return {};
    if (isAfter) {
      return {
        beforePath: targetPath,
        afterPath: targetIndex < paths.length - 1 ? paths[targetIndex + 1] : undefined,
      };
    }
    return {
      beforePath: targetIndex > 0 ? paths[targetIndex - 1] : undefined,
      afterPath: targetPath,
    };
  }

  private async moveRowToDropPosition(
    row: RowData,
    dragPath: string,
    groupField: string | undefined,
    groupKey: string | undefined,
    event: DragEvent,
    beforePath?: string,
    afterPath?: string
  ): Promise<void> {
    const fromGroupKey = event.dataTransfer?.getData(ROW_FROM_GROUP_MIME) || "";
    if (groupField && groupKey != null && fromGroupKey !== groupKey) {
      if (this.actions.moveRowToGroupAndPosition) {
        await this.actions.moveRowToGroupAndPosition(row, groupField, fromGroupKey, groupKey, beforePath, afterPath);
        return;
      }
      await this.actions.moveRowsToGroup?.(row, groupField, fromGroupKey, groupKey);
    }
    this.actions.moveRowToPosition?.(dragPath, beforePath, afterPath);
  }

  private clearRowDropTargets(scope: Element | null, except?: HTMLElement): void {
    if (!scope) return;
    scope.querySelectorAll(".is-drop-before, .is-drop-after").forEach((el) => {
      if (el !== except) el.classList.remove("is-drop-before", "is-drop-after");
    });
  }

  private setRowDraggingMode(rowEl: HTMLElement, active: boolean): void {
    const container = rowEl.closest<HTMLElement>(".note-database-container");
    container?.toggleClass("is-row-dragging", active);
    if (!active) {
      container?.querySelectorAll(".db-table th.db-drop-target, .db-table th.db-dragging").forEach((el) => {
        el.classList.remove("db-drop-target", "db-dragging");
      });
    }
  }

  private isPhoneLayout(): boolean {
    return window.activeDocument.body.classList.contains("is-phone");
  }

  private getGroupDefaults(config: ViewConfig, groupField: string, groupKey: string): Record<string, unknown> {
    if (groupKey === t("common.uncategorized")) return { [groupField]: "" };
    const col = config.schema.columns.find((candidate) => candidate.key === groupField);
    if (col?.type === "multi-select") return { [groupField]: [groupKey] };
    if (col?.type === "checkbox") return { [groupField]: toBooleanValue(groupKey) };
    return { [groupField]: groupKey };
  }

}
