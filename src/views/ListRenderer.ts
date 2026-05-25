import { App, Menu, setIcon, TFile } from "obsidian";
import { getColumnOptions, toBooleanValue, toMultiSelectValues } from "../data/ColumnTypes";
import { ColumnDef, NO_TITLE_FIELD, RowData, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { setFieldTooltip } from "./FieldTooltip";

const ROW_MIME = "application/x-note-database-row";
const ROW_FROM_GROUP_MIME = "application/x-note-database-row-from-group";

export interface ListGroup {
  key: string;
  rows: RowData[];
  count: number;
}

export interface ListRendererActions {
  openRow(row: RowData): void;
  createEntry(defaults?: Record<string, unknown>): void;
  isRowSelected(row: RowData): boolean;
  toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void;
  areAllRowsSelected(rows: RowData[]): boolean;
  toggleRowsSelected(rows: RowData[], selected: boolean): void;
  editCell(target: HTMLElement, row: RowData, col: ColumnDef, event?: MouseEvent): void;
  getColumns(config: ViewConfig): ColumnDef[];
  moveRowsToGroup?(row: RowData, field: string, fromGroupKey: string, toGroupKey: string): void | Promise<void>;
  isGroupCollapsed?(field: string, key: string): boolean;
  toggleGroupCollapsed?(field: string, key: string): void;
  showRowMenu?(event: MouseEvent, row: RowData): void;
  showColumnMenu?(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement): void;
  readonly isReadOnly?: boolean;
}

interface ParsedLink {
  label: string;
  target: string;
  external: boolean;
}

export class ListRenderer {
  private rowByPath = new Map<string, RowData>();

  constructor(private app: App, private actions: ListRendererActions) {}

  render(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
    this.clear(container);
    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));
    this.renderTotalHeader(container, rows);
    const list = container.createDiv({ cls: "db-list" });
    for (const row of rows) this.renderRow(list, config, row);
    this.renderNewRow(list);
  }

  renderGrouped(container: HTMLElement, config: ViewConfig, groups: ListGroup[], groupField: string): void {
    this.clear(container);
    this.rowByPath = new Map(groups.flatMap((group) => group.rows.map((row) => [row.file.path, row] as const)));
    const grouped = container.createDiv({ cls: "db-list-grouped" });
    for (const group of groups) {
      const section = grouped.createDiv({ cls: "db-list-group" });
      const header = section.createDiv({ cls: "db-list-group-header" });
      this.setupGroupDropTarget(header, groupField, group.key);
      const collapsed = Boolean(this.actions.isGroupCollapsed?.(groupField, group.key));
      section.toggleClass("is-collapsed", collapsed);
      const label = header.createSpan({ cls: "db-list-group-header-label" });
      const toggle = label.createEl("button", {
        cls: `db-list-group-toggle${collapsed ? " is-collapsed" : ""}`,
        attr: { type: "button", "aria-label": collapsed ? t("group.expand") : t("group.collapse") },
      });
      toggle.createSpan({ cls: "db-collapse-triangle" });
      toggle.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.actions.toggleGroupCollapsed?.(groupField, group.key);
      };
      this.renderGroupCheckbox(label, group.rows);
      label.createSpan({ cls: "db-list-group-title", text: group.key || t("common.uncategorized") });
      label.createSpan({ cls: "db-list-group-count", text: String(group.count) });
      if (collapsed) continue;
      const list = section.createDiv({ cls: "db-list" });
      this.setupGroupDropTarget(list, groupField, group.key);
      for (const row of group.rows) this.renderRow(list, config, row, groupField, group.key, groups);
      this.renderNewRow(list, { [groupField]: group.key || "" });
    }
  }

  private renderTotalHeader(container: HTMLElement, rows: RowData[]): void {
    const header = container.createDiv({ cls: "db-list-total-header" });
    const label = header.createSpan({ cls: "db-list-group-header-label" });
    this.renderGroupCheckbox(label, rows);
    label.createSpan({ cls: "db-list-group-title", text: t("common.total") });
    label.createSpan({ cls: "db-list-group-count", text: String(rows.length) });
  }

  private renderGroupCheckbox(parent: HTMLElement, rows: RowData[]): void {
    if (this.actions.isReadOnly) return;
    const checkbox = parent.createEl("input", { cls: "db-list-group-checkbox", attr: { type: "checkbox" } });
    checkbox.checked = this.actions.areAllRowsSelected(rows);
    checkbox.indeterminate = rows.some((row) => this.actions.isRowSelected(row)) && !checkbox.checked;
    checkbox.onclick = (event) => event.stopPropagation();
    checkbox.onchange = () => this.actions.toggleRowsSelected(rows, checkbox.checked);
  }

  private renderRow(list: HTMLElement, config: ViewConfig, row: RowData, groupField?: string, groupKey?: string, groups?: ListGroup[]): void {
    const item = list.createDiv({
      cls: "db-list-row",
      attr: { "data-note-database-row-path": row.file.path },
    });
    this.attachRowContextMenu(item, row);
    this.setupGroupedRowDrag(item, row, groupField, groupKey);
    if (!this.actions.isReadOnly && this.isPhoneLayout() && groupField && groupKey != null && groups?.length) {
      this.renderMobileMoveButton(item, row, groupField, groupKey, groups);
    }

    const controls = item.createDiv({ cls: "db-list-row-controls" });
    if (!this.actions.isReadOnly) {
      const checkbox = controls.createEl("input", { cls: "db-list-row-checkbox", attr: { type: "checkbox" } });
      checkbox.checked = this.actions.isRowSelected(row);
      checkbox.onclick = (event) => {
        event.stopPropagation();
        this.actions.toggleRowSelected(row, !this.actions.isRowSelected(row), event);
      };
    }
    const openBtn = controls.createEl("button", {
      cls: "db-list-row-open",
      attr: { title: t("menu.openNote"), "aria-label": t("menu.openNote") },
    });
    setIcon(openBtn, "maximize-2");
    openBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.openRow(row);
    };

    const columns = this.actions.getColumns(config);
    const main = item.createDiv({ cls: "db-list-row-main" });
    const titleField = this.getTitleField(config, columns);
    const titleCol = titleField ? config.schema.columns.find((col) => col.key === titleField) : undefined;
    const titleText = titleField ? this.getTitleText(config, row, titleField) : "";
    if (titleCol && titleText) {
      const title = main.createDiv({ cls: "db-list-row-title", text: titleText, attr: { title: titleText } });
      title.onclick = (event) => {
        if (this.actions.isReadOnly) return;
        event.stopPropagation();
        this.actions.editCell(title, row, titleCol, event);
      };
    }

    const meta = main.createDiv({ cls: "db-list-row-meta" });
    const fields = columns.filter((col) => col.key !== titleField);
    for (const col of fields) {
      const value = this.getCellValue(row, col);
      const empty = this.isEmptyValue(value);
      if (empty && config.showEmptyFields !== true) continue;
      const displayValue = empty ? this.getEmptyDisplayValue(col) : value;
      const field = meta.createDiv({ cls: "db-list-field" });
      if (col.wrap) field.style.flex = "0 0 auto";
      else field.style.flexBasis = `${col.width || config.defaultColumnWidth || 180}px`;
      setFieldTooltip(field, displayValue, col.label);
      if (empty) field.addClass("is-empty-field");
      if (col.wrap) field.addClass("db-list-field-wrap");
      const label = field.createSpan({ cls: "db-list-field-label", text: col.label });
      this.attachColumnContextMenu(field, col);
      this.attachColumnContextMenu(label, col);
      this.renderValue(field, row, col, displayValue, empty);
    }
  }

  private attachRowContextMenu(el: HTMLElement, row: RowData): void {
    el.addEventListener("contextmenu", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, button")) return;
      this.actions.showRowMenu?.(event, row);
    });
  }

  private attachColumnContextMenu(el: HTMLElement, col: ColumnDef): void {
    el.addEventListener("contextmenu", (event) => {
      if (!this.actions.showColumnMenu) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, button, a")) return;
      event.preventDefault();
      event.stopPropagation();
      this.actions.showColumnMenu(event, col, el);
    });
  }

  private renderMobileMoveButton(item: HTMLElement, row: RowData, groupField: string, groupKey: string, groups: ListGroup[]): void {
    if (!this.actions.moveRowsToGroup) return;
    const button = item.createEl("button", {
      cls: "db-list-mobile-move-btn",
      attr: { type: "button", title: t("mobile.moveToGroup"), "aria-label": t("mobile.moveToGroup") },
    });
    setIcon(button, "folder-input");
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      for (const group of groups) {
        if (group.key === groupKey) continue;
        menu.addItem((menuItem) => menuItem
          .setTitle(group.key || t("common.uncategorized"))
          .setIcon("folder-input")
          .onClick(() => void this.actions.moveRowsToGroup?.(row, groupField, groupKey, group.key)));
      }
      menu.showAtMouseEvent(event);
    };
  }

  private setupGroupedRowDrag(item: HTMLElement, row: RowData, groupField?: string, groupKey?: string): void {
    if (!groupField || groupKey == null || this.actions.isReadOnly || !this.actions.moveRowsToGroup) return;
    if (this.isPhoneLayout()) return;
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, button")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData(ROW_MIME, row.file.path);
      event.dataTransfer?.setData("text/plain", row.file.path);
      event.dataTransfer?.setData(ROW_FROM_GROUP_MIME, groupKey);
      item.addClass("is-dragging");
    });
    item.addEventListener("dragend", () => item.removeClass("is-dragging"));
  }

  private setupGroupDropTarget(target: HTMLElement, groupField: string, groupKey: string): void {
    if (this.actions.isReadOnly || !this.actions.moveRowsToGroup) return;
    target.addEventListener("dragover", (event) => {
      if (!this.isRowDrag(event)) return;
      event.preventDefault();
      target.addClass("is-drop-target");
    });
    target.addEventListener("dragleave", () => target.removeClass("is-drop-target"));
    target.addEventListener("drop", (event) => {
      if (!this.isRowDrag(event)) return;
      const path = event.dataTransfer?.getData(ROW_MIME) || event.dataTransfer?.getData("text/plain");
      const row = path ? this.rowByPath.get(path) : undefined;
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      target.removeClass("is-drop-target");
      const fromGroupKey = event.dataTransfer?.getData(ROW_FROM_GROUP_MIME) || "";
      void this.actions.moveRowsToGroup?.(row, groupField, fromGroupKey, groupKey);
    });
  }

  private isRowDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types || []).includes(ROW_MIME);
  }

  private isPhoneLayout(): boolean {
    return document.body.classList.contains("is-phone");
  }

  private renderNewRow(list: HTMLElement, defaults?: Record<string, unknown>): void {
    if (this.actions.isReadOnly) return;
    const button = list.createEl("button", { cls: "db-list-new-row", text: `+ ${t("toolbar.new")}` });
    button.onclick = () => this.actions.createEntry(defaults);
  }

  private getCellValue(row: RowData, col: ColumnDef): unknown {
    if (col.key === "file.name") return row.file.name.replace(/\.md$/, "");
    if (col.type === "computed") return row.computed[col.computedKey || col.key];
    return row.frontmatter[col.key];
  }

  private getTitleField(config: ViewConfig, visibleColumns: ColumnDef[]): string | undefined {
    if (config.titleField === NO_TITLE_FIELD) return undefined;
    if (config.titleField) return config.titleField;
    return visibleColumns.some((col) => col.key === "file.name") ? "file.name" : undefined;
  }

  private getTitleText(config: ViewConfig, row: RowData, field: string): string {
    const col = config.schema.columns.find((candidate) => candidate.key === field);
    if (!col) return "";
    const value = this.getCellValue(row, col);
    if (value == null) return "";
    return Array.isArray(value) ? value.join(", ") : String(value);
  }

  private renderValue(field: HTMLElement, row: RowData, col: ColumnDef, value: unknown, empty = false): void {
    const valueEl = field.createDiv({ cls: "db-list-field-value" });
    if (empty) valueEl.addClass("db-card-empty-placeholder");
    field.addEventListener("click", (event) => {
      if (this.actions.isReadOnly) return;
      if (event.target instanceof HTMLElement && event.target.closest("a, button, input, textarea, .db-cell-editing")) return;
      event.stopPropagation();
      this.actions.editCell(valueEl, row, col, event);
    });
    if (col.type === "checkbox") {
      valueEl.textContent = toBooleanValue(value) ? t("common.true") : t("common.false");
      setFieldTooltip(valueEl, valueEl.textContent);
      return;
    }
    if (col.type === "select" || col.type === "status") {
      this.renderBadge(valueEl, col, String(value));
      return;
    }
    if (col.type === "multi-select") {
      const badges = valueEl.createDiv({ cls: "db-list-badges" });
      const values = toMultiSelectValues(value);
      setFieldTooltip(badges, values);
      for (const entry of values) this.renderBadge(badges, col, entry);
      return;
    }

    const values = Array.isArray(value) ? value : [value];
    const links = values
      .map((entry) => this.parseLink(entry))
      .filter((entry): entry is ParsedLink => entry !== null);
    if (links.length > 0) {
      for (const link of links) this.renderLink(valueEl, row, link);
      return;
    }

    valueEl.textContent = Array.isArray(value) ? value.join(", ") : String(value);
    valueEl.title = valueEl.textContent;
  }

  private renderBadge(parent: HTMLElement, col: ColumnDef, value: string): void {
    const badge = parent.createSpan({ cls: "status-badge", text: value });
    badge.title = value;
    const option = getColumnOptions(col).find((item) => item.value === value);
    badge.addClass(`status-color-${option?.color || "gray"}`);
  }

  private renderLink(parent: HTMLElement, row: RowData, link: ParsedLink): void {
    const anchor = parent.createEl("a", { cls: "db-list-link", text: link.label, attr: { title: link.label } });
    anchor.href = link.external ? link.target : "#";
    anchor.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openTarget(row, link.target, link.external);
    };
  }

  private parseLink(value: unknown): ParsedLink | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text) return null;

    const markdownLink = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (markdownLink) return this.toParsedLink(markdownLink[2], markdownLink[1]);

    const wikiLink = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (wikiLink) return this.toParsedLink(wikiLink[1], wikiLink[2] || wikiLink[1]);

    if (this.isExternalUrl(text)) return this.toParsedLink(text, text);
    if (text.endsWith(".md") || text.includes("/")) return this.toParsedLink(text, text);
    return null;
  }

  private toParsedLink(target: string, label: string): ParsedLink {
    const cleanTarget = target.trim();
    return {
      label: label.trim() || cleanTarget,
      target: cleanTarget,
      external: this.isExternalUrl(cleanTarget),
    };
  }

  private async openTarget(row: RowData, target: string, external: boolean): Promise<void> {
    if (external) {
      window.open(target);
      return;
    }
    await this.app.workspace.openLinkText(target, row.file.path);
  }

  private isExternalUrl(target: string): boolean {
    return /^https?:\/\//i.test(target);
  }

  private clear(container: HTMLElement): void {
    container.querySelectorAll(".db-list, .db-list-grouped, .db-list-total-header").forEach((el) => el.remove());
  }

  private isEmptyValue(value: unknown): boolean {
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  }

  private getEmptyDisplayValue(col: ColumnDef): unknown {
    if (col.type === "multi-select") return [t("common.empty")];
    if (col.type === "checkbox") return false;
    return t("common.empty");
  }
}
