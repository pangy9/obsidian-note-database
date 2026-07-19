import { Menu } from "obsidian";
import { ColumnDef, CreateEntryPosition, RowCreateContext, RowData, ViewConfig } from "../data/types";
import { isExplicitlySorted } from "../data/ManualOrder";
import { formatGroupKeyDisplay, isComputedGroupField, resolveGroupCreateDefaults } from "../data/GroupDisplay";
import { t } from "../i18n";
import { DragDropFeedbackState, resolveDropPlacement } from "./DragDropFeedback";
import { renderMobileMoveIcon } from "./MobileMoveIcon";
import { renderPropertyTypeIcon } from "./PropertyTypeIcon";
import { getTableColumnStyle, getTableLayout, getTableMinWidth as calculateTableMinWidth } from "./TableLayout";
import { renderGroupExpandControls } from "./GroupExpandControls";
import { getGroupVisibleCount } from "../data/GroupVisibility";

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
  setupRow(tr: HTMLElement, row: RowData, context?: RowCreateContext): void;
  renderCell(td: HTMLElement, row: RowData, col: ColumnDef): void;
  renderRecordIcon?(parent: HTMLElement, row: RowData, config: ViewConfig, compact?: boolean): HTMLElement | null;
  renderGroupSummaries?(parent: HTMLElement, rows: RowData[], config: ViewConfig): void;
  applyConditionalFormat?(element: HTMLElement, row: RowData, config: ViewConfig, targetField?: string): void;
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
  createEntry(defaults?: Record<string, unknown>, position?: CreateEntryPosition): void;
  isGroupCollapsed?(field: string, key: string): boolean;
  toggleGroupCollapsed?(field: string, key: string): void;
  expandGroup?(field: string, key: string, count: number): void;
  /** When true, the "+ 新建" row is not rendered */
  readonly hideCreateEntry?: boolean;
  /** When true, row-level data mutation controls are not rendered */
  readonly isReadOnly?: boolean;
}

export class TableRenderer {
  private rowByPath = new Map<string, RowData>();
  private draggingPath: string | undefined;
  private rowDropFeedback = new DragDropFeedbackState();

  constructor(private actions: TableRendererActions) {}

  renderTable(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
    this.clearTable(container);
    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));

    const visibleColumns = this.actions.getVisibleColumns(config, rows);
    const tableWrap = container.createDiv({ cls: "db-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "db-table" });
    table.toggleClass("is-create-entry-hidden", Boolean(this.actions.hideCreateEntry));
    const availableWidth = this.getAvailableTableWidth(tableWrap);
    this.applyTableWidth(table, config, visibleColumns, availableWidth);
    this.renderColgroup(table, config, visibleColumns, availableWidth);
    this.renderHeader(table, config, visibleColumns, rows);
    const tbody = table.createEl("tbody");
    this.renderRows(tbody, config, rows, visibleColumns);
    if (!this.actions.hideCreateEntry) {
      this.renderNewRow(tbody, visibleColumns.length + this.getUtilityColumnCount(config), undefined, rows);
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
        attr: {
          "data-note-database-group-key": group.key,
        },
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
        text: formatGroupKeyDisplay(config, groupField, group.key),
      });
      label.createSpan({ cls: "db-group-count", text: String(group.count) });
      this.actions.renderGroupSummaries?.(groupHeader, group.rows, config);

      if (collapsed) continue;

      const tableWrap = container.createDiv({ cls: "db-table-wrap" });
      tableWrap.setAttr("data-note-database-group-key", group.key);
      if (groupField) this.setupGroupDropTarget(tableWrap, groupField, group.key);
      const table = tableWrap.createEl("table", { cls: "db-table" });
      table.toggleClass("is-create-entry-hidden", Boolean(this.actions.hideCreateEntry));
      const availableWidth = this.getAvailableTableWidth(tableWrap);
      this.applyTableWidth(table, config, visibleColumns, availableWidth);
      tableWrap.style.minWidth = `${this.getTableWidth(config, visibleColumns, availableWidth)}px`;
      this.renderColgroup(table, config, visibleColumns, availableWidth);
      this.renderHeader(table, config, visibleColumns, group.rows);
      const tbody = table.createEl("tbody");
      if (groupField) this.setupGroupDropTarget(tbody, groupField, group.key);
      const visibleCount = groupField ? getGroupVisibleCount(config, groupField, group.key, group.rows.length) : group.rows.length;
      this.renderRows(tbody, config, group.rows.slice(0, visibleCount), visibleColumns, groupField, group.key, groups);
      if (!this.actions.hideCreateEntry) {
        const computedGroup = Boolean(groupField) && isComputedGroupField(config, groupField);
        const defaults = (!computedGroup && groupField) ? this.getGroupDefaults(config, groupField, group.key) : undefined;
        this.renderNewRow(tbody, visibleColumns.length + this.getUtilityColumnCount(config), defaults, group.rows, computedGroup);
      }
      if (groupField) renderGroupExpandControls(tableWrap, config, groupField, group.key, group.rows.length, this.actions);
    }
  }

  /**
   * Replace only changed rows in an ungrouped table. The caller must already
   * have rebuilt the row pipeline; this method refuses the patch unless the
   * rendered path order and visible column schema are unchanged.
   */
  patchUngroupedRows(
    container: HTMLElement,
    config: ViewConfig,
    rows: RowData[],
    changedPaths: ReadonlySet<string>
  ): boolean {
    const table = container.querySelector<HTMLElement>(":scope > .db-table-wrap > table.db-table");
    const tbody = table?.querySelector<HTMLElement>(":scope > tbody");
    if (!table || !tbody) return false;

    const renderedRows = Array.from(
      tbody.querySelectorAll<HTMLElement>(":scope > tr[data-note-database-row-path]")
    );
    const renderedPaths = renderedRows.map((row) => row.getAttribute("data-note-database-row-path") || "");
    const nextPaths = rows.map((row) => row.file.path);
    if (renderedPaths.length !== nextPaths.length ||
        renderedPaths.some((path, index) => path !== nextPaths[index])) {
      return false;
    }

    const visibleColumns = this.actions.getVisibleColumns(config, rows);
    const renderedColumnKeys = Array.from(
      table.querySelectorAll<HTMLElement>(":scope > thead [data-note-database-column-key]")
    ).map((header) => header.getAttribute("data-note-database-column-key") || "");
    if (renderedColumnKeys.length !== visibleColumns.length ||
        renderedColumnKeys.some((key, index) => key !== visibleColumns[index]?.key)) {
      return false;
    }

    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));
    const rowByPath = this.rowByPath;
    for (const oldRow of renderedRows) {
      const path = oldRow.getAttribute("data-note-database-row-path") || "";
      if (!changedPaths.has(path)) continue;
      const row = rowByPath.get(path);
      if (!row) return false;
      const replacement = this.renderRow(tbody, config, row, rows, visibleColumns);
      oldRow.replaceWith(replacement);
    }
    return true;
  }

  /**
   * Replace only changed rows in a grouped table. Group headers, counts,
   * collapsed state, visible row order, and column schemas must all still
   * match. Any structural change falls back to the normal full render.
   */
  patchGroupedRows(
    container: HTMLElement,
    config: ViewConfig,
    rows: RowData[],
    groups: TableGroup[],
    groupField: string,
    changedPaths: ReadonlySet<string>
  ): boolean {
    const grouped = container.querySelector<HTMLElement>(":scope > .db-grouped-table");
    if (!grouped) return false;
    // Group summaries depend on every row in the group. Until their DOM has a
    // dedicated patch path, prefer the normal grouped render over stale totals.
    if (config.summaryRules && config.summaryRules.length > 0) return false;

    const renderedHeaders = Array.from(
      grouped.querySelectorAll<HTMLElement>(":scope > .db-group-header")
    );
    if (renderedHeaders.length !== groups.length) return false;

    const visibleColumns = this.actions.getVisibleColumns(config, rows);
    const renderedRowsByGroup: Array<{
      tbody: HTMLElement;
      renderedRows: HTMLElement[];
      group: TableGroup;
      visibleRows: RowData[];
    }> = [];

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const header = renderedHeaders[index];
      if (header.getAttribute("data-note-database-group-key") !== group.key) return false;
      if (header.querySelector<HTMLElement>(".db-group-count")?.textContent !== String(group.count)) return false;

      const collapsed = Boolean(this.actions.isGroupCollapsed?.(groupField, group.key));
      if (header.classList.contains("is-collapsed") !== collapsed) return false;
      if (collapsed) continue;

      const tableWrap = header.nextElementSibling as HTMLElement | null;
      if (!tableWrap?.classList.contains("db-table-wrap") ||
          tableWrap.getAttribute("data-note-database-group-key") !== group.key) {
        return false;
      }
      const table = tableWrap.querySelector<HTMLElement>(":scope > table.db-table");
      const tbody = table?.querySelector<HTMLElement>(":scope > tbody");
      if (!table || !tbody) return false;

      const renderedColumnKeys = Array.from(
        table.querySelectorAll<HTMLElement>(":scope > thead [data-note-database-column-key]")
      ).map((headerEl) => headerEl.getAttribute("data-note-database-column-key") || "");
      if (renderedColumnKeys.length !== visibleColumns.length ||
          renderedColumnKeys.some((key, columnIndex) => key !== visibleColumns[columnIndex]?.key)) {
        return false;
      }

      const visibleCount = getGroupVisibleCount(config, groupField, group.key, group.rows.length);
      const visibleRows = group.rows.slice(0, visibleCount);
      const renderedRows = Array.from(
        tbody.querySelectorAll<HTMLElement>(":scope > tr[data-note-database-row-path]")
      );
      const renderedPaths = renderedRows.map((rowEl) =>
        rowEl.getAttribute("data-note-database-row-path") || ""
      );
      const nextPaths = visibleRows.map((row) => row.file.path);
      if (renderedPaths.length !== nextPaths.length ||
          renderedPaths.some((path, rowIndex) => path !== nextPaths[rowIndex])) {
        return false;
      }
      renderedRowsByGroup.push({ tbody, renderedRows, group, visibleRows });
    }

    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));
    for (const { tbody, renderedRows, group, visibleRows } of renderedRowsByGroup) {
      for (const oldRow of renderedRows) {
        const path = oldRow.getAttribute("data-note-database-row-path") || "";
        if (!changedPaths.has(path)) continue;
        const row = this.rowByPath.get(path);
        if (!row) return false;
        const replacement = this.renderRow(
          tbody,
          config,
          row,
          visibleRows,
          visibleColumns,
          groupField,
          group.key,
          groups
        );
        oldRow.replaceWith(replacement);
      }
    }
    return true;
  }

  private clearTable(container: HTMLElement): void {
    this.rowDropFeedback.clear();
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
    if (this.shouldRenderRecordIcon(config)) {
      const iconCol = colgroup.createEl("col");
      const iconWidth = this.getRecordIconColumnWidth();
      iconCol.addClass("db-record-icon-colgroup");
      iconCol.setAttr("width", String(iconWidth));
      iconCol.style.width = `${iconWidth}px`;
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
    return calculateTableMinWidth(this.getUtilityColumnsWidth(config), columns.map((col) => this.getColumnWidth(config, col)));
  }

  private getTableWidth(config: ViewConfig, columns: ColumnDef[], availableWidth = 0): number {
    return getTableLayout(this.getUtilityColumnsWidth(config), columns.map((col) => this.getColumnWidth(config, col)), availableWidth).tableWidth;
  }

  private applyTableWidth(table: HTMLElement, config: ViewConfig, columns: ColumnDef[], availableWidth = 0): void {
    const width = this.getTableWidth(config, columns, availableWidth);
    table.style.minWidth = `${width}px`;
    table.style.width = `${width}px`;
  }

  private getRenderedColumnWidths(config: ViewConfig, columns: ColumnDef[], availableWidth = 0): number[] {
    return getTableLayout(this.getUtilityColumnsWidth(config), columns.map((col) => this.getColumnWidth(config, col)), availableWidth).columnWidths;
  }

  private getColumnWidth(config: ViewConfig, col: ColumnDef): number {
    return config.columnWidths?.[col.key] || col.width || config.defaultColumnWidth || 150;
  }

  private getSelectionColumnWidth(): number {
    return this.isPhoneLayout() ? 48 : 40;
  }

  private getRecordIconColumnWidth(): number {
    return 28;
  }

  private shouldRenderRecordIcon(config: ViewConfig): boolean {
    return config.showRecordIcon === true && typeof this.actions.renderRecordIcon === "function";
  }

  private getUtilityColumnsWidth(config: ViewConfig): number {
    return (this.actions.isReadOnly ? 0 : this.getSelectionColumnWidth())
      + (this.shouldRenderRecordIcon(config) ? this.getRecordIconColumnWidth() : 0);
  }

  private getUtilityColumnCount(config: ViewConfig): number {
    return (this.actions.isReadOnly ? 0 : 1) + (this.shouldRenderRecordIcon(config) ? 1 : 0);
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
      const selectInner = selectTh.createDiv({ cls: "db-select-inner" });
      const selectAll = selectInner.createEl("input", { attr: { type: "checkbox" } });
      selectAll.checked = this.actions.areAllRowsSelected(rows);
      selectAll.onchange = () => {
        this.actions.toggleRowsSelected(rows, selectAll.checked);
      };
    }
    if (this.shouldRenderRecordIcon(config)) {
      headerRow.createEl("th", {
        cls: "db-record-icon-col",
        attr: { "aria-label": t("recordIcon.icons"), title: t("recordIcon.icons") },
      });
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
      this.renderRow(tbody, config, row, rows, columns, groupField, groupKey, groups);
    }
  }

  private renderRow(
    tbody: HTMLElement,
    config: ViewConfig,
    row: RowData,
    rows: RowData[],
    columns: ColumnDef[],
    groupField?: string,
    groupKey?: string,
    groups?: TableGroup[]
  ): HTMLElement {
    const tr = tbody.createEl("tr", {
      attr: { "data-note-database-row-path": row.file.path },
    });
    this.actions.applyConditionalFormat?.(tr, row, config);
    if (groupField && groupKey != null) {
      tr.setAttr("data-note-database-group-field", groupField);
      tr.setAttr("data-note-database-group-key", groupKey);
    }
    this.actions.setupRow(tr, row, {
      visibleRows: rows,
      groups: groupField && groupKey != null ? [{ field: groupField, key: groupKey }] : undefined,
    });
    if (!this.actions.isReadOnly) {
      const selectTd = tr.createEl("td", { cls: "db-select-col" });
      const selectInner = selectTd.createDiv({ cls: "db-select-inner" });
      // 拖拽手柄（左）与 checkbox（右）放入同一 flex 容器：先建手柄、再建 checkbox，
      // checkbox 用 margin-left:auto 贴右，使各行 checkbox 与表头 checkbox 上下对齐。
      this.setupRowDrag(selectInner, tr, row, rows, config, groupField, groupKey);
      if (this.isPhoneLayout() && (this.canManualReorder(config) || Boolean(groupField && groups?.length))) {
        this.renderMobileMoveButton(selectInner, config, row, rows, groupField, groupKey, groups);
      }
      const cb = selectInner.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = this.actions.isRowSelected(row);
      cb.onclick = (event) => {
        event.stopPropagation();
        this.actions.toggleRowSelected(row, !this.actions.isRowSelected(row), event);
      };
    }
    if (this.shouldRenderRecordIcon(config)) {
      const iconTd = tr.createEl("td", { cls: "db-record-icon-col" });
      const icon = this.actions.renderRecordIcon?.(iconTd, row, config, true);
      // Keep spreadsheet roving-tabindex authoritative: the gutter is clickable,
      // but must not become an extra Tab stop between real data cells.
      icon?.setAttr("tabindex", "-1");
    }
    for (const col of columns) {
      const td = tr.createEl("td", {
        attr: {
          "data-note-database-row-path": row.file.path,
          "data-note-database-column-key": col.key,
        },
      });
      this.actions.renderCell(td, row, col);
      this.actions.applyConditionalFormat?.(td, row, config, col.key);
      if (!this.actions.isReadOnly) this.actions.setupFillHandle?.(td, row, col);
    }
    return tr;
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
          const groupLabel = formatGroupKeyDisplay(config, groupField, group.key);
          menu.addItem((item) => item
            .setTitle(`${t("mobile.moveTo")} ${groupLabel}`)
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

  private renderNewRow(tbody: HTMLElement, colspan: number, defaults?: Record<string, unknown>, rows: RowData[] = [], computedGroup = false): void {
    const tr = tbody.createEl("tr", { cls: "db-new-row" });
    const td = tr.createEl("td", { attr: { colspan: String(Math.max(colspan, 1)) } });
    if (computedGroup) {
      td.createEl("button", { cls: "db-new-row-button is-disabled", text: t("group.computedCreateDisabled"), attr: { disabled: "true" } });
      return;
    }
    const btn = td.createEl("button", { cls: "db-new-row-button", text: `+ ${t("toolbar.new")}` });
    btn.onclick = () => this.createEntryNearEnd(defaults, rows);
  }

  private createEntryNearEnd(defaults: Record<string, unknown> | undefined, rows: RowData[]): void {
    this.actions.createEntry(defaults, this.getCreatePosition(rows));
  }

  private getCreatePosition(rows: RowData[]): CreateEntryPosition | undefined {
    const last = rows[rows.length - 1];
    return last ? { afterPath: last.file.path } : undefined;
  }

  private setupRowDrag(
    handleParent: HTMLElement | undefined,
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
    if (!handleParent) return;

    const handle = handleParent.createEl("button", {
      cls: "db-table-row-drag-handle",
      text: "⋮⋮",
      attr: { type: "button", title: t("panel.dragToSort"), "aria-label": t("panel.dragToSort") },
    });
    handle.draggable = true;
    tr.addClass("is-manual-row-draggable");
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      event.dataTransfer?.setData(ROW_MIME, row.file.path);
      event.dataTransfer?.setData("text/plain", row.file.path);
      if (groupKey != null) event.dataTransfer?.setData(ROW_FROM_GROUP_MIME, groupKey);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      // 以整行作为拖拽预览（参考列管理面板拖拽整项），避免只看到一个手柄在飞；
      // 在加 is-dragging 之前截取，保证预览是不透明的完整行。
      if (event.dataTransfer) {
        const rect = tr.getBoundingClientRect();
        event.dataTransfer.setDragImage(tr, event.clientX - rect.left, event.clientY - rect.top);
      }
      this.draggingPath = row.file.path;
      this.setRowDraggingMode(tr, true);
      tr.addClass("is-dragging");
    });

    handle.addEventListener("dragend", () => {
      this.draggingPath = undefined;
      this.setRowDraggingMode(tr, false);
      tr.removeClass("is-dragging");
      this.rowDropFeedback.clear();
    });

    if (!canReorder) return;

    tr.addEventListener("dragover", (event) => {
      const dragPath = this.draggingPath || event.dataTransfer?.getData(ROW_MIME);
      if (!dragPath || dragPath === row.file.path) return;
      if (!this.isRowDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.rowDropFeedback.update(tr, resolveDropPlacement(tr, event, "vertical"));
    });

    tr.addEventListener("dragleave", () => {
      this.rowDropFeedback.clearTarget(tr);
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

      const placement = this.rowDropFeedback.getPlacement(tr) || resolveDropPlacement(tr, event, "vertical");
      this.rowDropFeedback.clear();
      const isAfter = placement === "after";
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
    return !isExplicitlySorted(config);
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
    return resolveGroupCreateDefaults(config, groupField, groupKey);
  }

}
