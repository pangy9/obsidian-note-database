import { App, Menu, setIcon } from "obsidian";
import { getColumnOptions, isObsidianTagsKey, normalizeOptionValueForKey, toBooleanValue, toMultiSelectValuesForKey } from "../data/ColumnTypes";
import { isExplicitlySorted } from "../data/ManualOrder";
import { getColumnDisplayType } from "../data/ColumnDisplay";
import { formatDateTimeValueDisplay, formatDateValueDisplay } from "../data/DateTimeFormat";
import { getFileFieldFixedType, getRowFileFieldValue, isFileFieldKey, isReadonlyFileField } from "../data/FileFields";
import { formatGroupKeyDisplay } from "../data/GroupDisplay";
import { ColumnDef, CreateEntryPosition, NO_TITLE_FIELD, RowData, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { setFieldTooltip } from "./FieldTooltip";
import { getFileTitleDisplay, renderStackedFileTitle } from "./FileTitleDisplay";
import { isHTMLElement } from "./DomGuards";
import { safeString } from "../data/SafeString";
import { renderMobileMoveIcon } from "./MobileMoveIcon";
import { renderSpecialFileFieldValue, shouldRenderSpecialFileField } from "./FileFieldRenderer";
import { DragDropFeedbackState, resolveDropPlacement } from "./DragDropFeedback";

const ROW_MIME = "application/x-note-database-row";
const ROW_FROM_GROUP_MIME = "application/x-note-database-row-from-group";

export interface ListGroup {
  key: string;
  rows: RowData[];
  count: number;
}

export interface ListRendererActions {
  openRow(row: RowData): void;
  createEntry(defaults?: Record<string, unknown>, position?: CreateEntryPosition): void;
  isRowSelected(row: RowData): boolean;
  toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void;
  areAllRowsSelected(rows: RowData[]): boolean;
  toggleRowsSelected(rows: RowData[], selected: boolean): void;
  editCell(target: HTMLElement, row: RowData, col: ColumnDef, event?: MouseEvent): void;
  getColumns(config: ViewConfig): ColumnDef[];
  moveRowToPosition(movedPath: string, beforePath?: string, afterPath?: string): void;
  moveRowsToGroup?(row: RowData, field: string, fromGroupKey: string, toGroupKey: string): void | Promise<void>;
  moveRowToGroupAndPosition?(
    row: RowData,
    field: string,
    fromGroupKey: string,
    toGroupKey: string,
    beforePath?: string,
    afterPath?: string
  ): void | Promise<void>;
  isGroupCollapsed?(field: string, key: string): boolean;
  toggleGroupCollapsed?(field: string, key: string): void;
  showRowMenu?(event: MouseEvent, row: RowData): void;
  showColumnMenu?(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement): void;
  editFormula?(col: ColumnDef): void;
  readonly isReadOnly?: boolean;
}

interface ParsedLink {
  label: string;
  target: string;
  external: boolean;
}

export class ListRenderer {
  private rowByPath = new Map<string, RowData>();
  private draggingPath: string | undefined;
  private rowDropFeedback = new DragDropFeedbackState();

  constructor(private app: App, private actions: ListRendererActions) {}

  render(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
    this.clear(container);
    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));
    this.renderTotalHeader(container, rows);
    const list = container.createDiv({ cls: "db-list" });
    for (const row of rows) this.renderRow(list, config, row, undefined, undefined, undefined, rows);
    this.renderNewRow(list, undefined, rows);
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
      label.createSpan({ cls: "db-list-group-title", text: formatGroupKeyDisplay(config, groupField, group.key) });
      label.createSpan({ cls: "db-list-group-count", text: String(group.count) });
      if (collapsed) continue;
      const list = section.createDiv({ cls: "db-list" });
      this.setupGroupDropTarget(list, groupField, group.key);
      for (const row of group.rows) this.renderRow(list, config, row, groupField, group.key, groups, group.rows);
      this.renderNewRow(list, { [groupField]: group.key || "" }, group.rows);
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

  private renderRow(list: HTMLElement, config: ViewConfig, row: RowData, groupField?: string, groupKey?: string, groups?: ListGroup[], allRows?: RowData[]): void {
    const item = list.createDiv({
      cls: "db-list-row",
      attr: { "data-note-database-row-path": row.file.path, title: row.file.path },
    });
    this.attachRowContextMenu(item, row);
    if (allRows) {
      if (this.canManualReorder(config)) this.setupReorderDrag(item, config, row, allRows, groupField, groupKey);
      else this.setupGroupedRowDrag(item, row, groupField, groupKey);
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
    if (!this.actions.isReadOnly && this.isPhoneLayout() && (this.canManualReorder(config) || Boolean(groupField && groups?.length))) {
      this.renderMobileMoveButton(controls, config, row, allRows || [], groupField, groupKey, groups);
    }

    const columns = this.actions.getColumns(config);
    const main = item.createDiv({ cls: "db-list-row-main" });
    const titleField = this.getTitleField(config, columns);
    const titleCol = titleField ? config.schema.columns.find((col) => col.key === titleField) : undefined;
    const titleText = titleField ? this.getTitleText(config, row, titleField) : "";
    if (titleCol && titleText) {
      const title = main.createDiv({
        cls: "db-list-row-title",
        attr: { title: titleCol.key === "file.name" ? row.file.path : titleText },
      });
      if (titleCol.key === "file.name") {
        renderStackedFileTitle(title, getFileTitleDisplay(row, Array.from(this.rowByPath.values())), true);
      } else {
        title.textContent = titleText;
      }
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
      const displayType = this.getDisplayType(config, col);
      const empty = this.isEmptyValue(value) && displayType !== "checkbox";
      if (empty && config.showEmptyFields !== true) continue;
      const displayValue = empty ? this.getEmptyDisplayValue(col, displayType) : value;
      const field = meta.createDiv({ cls: "db-list-field", attr: { "data-note-database-column-key": col.key } });
      if (col.wrap) field.setCssProps({ flex: "0 0 auto" });
      else field.setCssProps({ flexBasis: `${this.getFieldWidth(config, col)}px` });
      setFieldTooltip(field, displayValue, col.label);
      if (empty) field.addClass("is-empty-field");
      if (displayType === "checkbox") field.addClass("is-checkbox-field");
      if (col.wrap) field.addClass("db-list-field-wrap");
      const label = field.createSpan({ cls: "db-list-field-label", text: col.label });
      this.attachColumnContextMenu(field, col);
      this.attachColumnContextMenu(label, col);
      this.renderValue(field, row, col, displayValue, empty, displayType);
    }
  }

  private attachRowContextMenu(el: HTMLElement, row: RowData): void {
    el.addEventListener("contextmenu", (event) => {
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button")) return;
      this.actions.showRowMenu?.(event, row);
    });
  }

  private attachColumnContextMenu(el: HTMLElement, col: ColumnDef): void {
    el.addEventListener("contextmenu", (event) => {
      if (!this.actions.showColumnMenu) return;
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button, a")) return;
      event.preventDefault();
      event.stopPropagation();
      this.actions.showColumnMenu(event, col, el);
    });
  }

  /** Phone layouts use a compact menu instead of HTML drag and drop. */
  private renderMobileMoveButton(
    item: HTMLElement,
    config: ViewConfig,
    row: RowData,
    rows: RowData[],
    groupField?: string,
    groupKey?: string,
    groups?: ListGroup[]
  ): void {
    const button = item.createEl("button", {
      cls: "db-list-mobile-move-btn",
      attr: { type: "button", title: t("mobile.moveCard"), "aria-label": t("mobile.moveCard") },
    });
    renderMobileMoveIcon(button);
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = new Menu();
      if (this.canManualReorder(config)) this.addMobilePositionItems(menu, row, rows);
      if (groupField && groupKey != null && groups?.length) {
        if (this.canManualReorder(config)) menu.addSeparator();
        for (const group of groups) {
          if (group.key === groupKey) continue;
          const groupLabel = formatGroupKeyDisplay(config, groupField, group.key);
          menu.addItem((menuItem) => menuItem
            .setTitle(`${t("mobile.moveTo")} ${groupLabel}`)
            .setIcon("folder-input")
            .onClick(() => {
              const paths = group.rows.map((candidate) => candidate.file.path).filter((path) => path !== row.file.path);
              if (this.actions.moveRowToGroupAndPosition) {
                void this.actions.moveRowToGroupAndPosition(row, groupField, groupKey, group.key, paths[paths.length - 1], undefined);
              } else {
                void this.actions.moveRowsToGroup?.(row, groupField, groupKey, group.key);
              }
            }));
        }
      }
      menu.showAtMouseEvent(event);
    };
  }

  /** Add local rank movement actions shared by grouped and ungrouped list rows. */
  private addMobilePositionItems(menu: Menu, row: RowData, rows: RowData[]): void {
    const paths = rows.map((candidate) => candidate.file.path);
    const index = paths.indexOf(row.file.path);
    const move = (targetIndex: number) => {
      const remaining = paths.filter((path) => path !== row.file.path);
      const boundedIndex = Math.max(0, Math.min(targetIndex, remaining.length));
      this.actions.moveRowToPosition(row.file.path, remaining[boundedIndex - 1], remaining[boundedIndex]);
    };
    menu.addItem((item) => item.setTitle(t("menu.moveUp")).setIcon("chevron-up").setDisabled(index <= 0).onClick(() => move(index - 1)));
    menu.addItem((item) => item.setTitle(t("menu.moveDown")).setIcon("chevron-down").setDisabled(index < 0 || index >= paths.length - 1).onClick(() => move(index + 1)));
    menu.addItem((item) => item.setTitle(t("mobile.moveTop")).setIcon("chevrons-up").setDisabled(index <= 0).onClick(() => move(0)));
    menu.addItem((item) => item.setTitle(t("mobile.moveBottom")).setIcon("chevrons-down").setDisabled(index < 0 || index >= paths.length - 1).onClick(() => move(paths.length - 1)));
  }

  private setupGroupedRowDrag(item: HTMLElement, row: RowData, groupField?: string, groupKey?: string): void {
    if (!groupField || groupKey == null || this.actions.isReadOnly || !this.actions.moveRowsToGroup) return;
    if (this.isPhoneLayout()) return;
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button")) {
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

  private setupReorderDrag(item: HTMLElement, config: ViewConfig, row: RowData, rows: RowData[], groupField?: string, groupKey?: string): void {
    if (this.actions.isReadOnly || this.isPhoneLayout() || !this.canManualReorder(config)) return;
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData(ROW_MIME, row.file.path);
      event.dataTransfer?.setData("text/plain", row.file.path);
      if (groupKey != null) event.dataTransfer?.setData(ROW_FROM_GROUP_MIME, groupKey);
      this.draggingPath = row.file.path;
      item.addClass("is-dragging");
    });
    item.addEventListener("dragend", () => {
      this.draggingPath = undefined;
      item.removeClass("is-dragging");
      this.rowDropFeedback.clear();
    });
    item.addEventListener("dragover", (event) => {
      const dragPath = this.draggingPath;
      if (!dragPath || dragPath === row.file.path) return;
      if (!this.isRowDrag(event)) return;
      event.preventDefault();
      this.rowDropFeedback.update(item, resolveDropPlacement(item, event, "vertical"));
    });
    item.addEventListener("dragleave", () => {
      this.rowDropFeedback.clearTarget(item);
    });
    item.addEventListener("drop", (event) => {
      if (!this.isRowDrag(event)) return;
      const dragPath = this.draggingPath || event.dataTransfer?.getData(ROW_MIME);
      if (!dragPath || dragPath === row.file.path) return;
      if (!this.rowByPath.has(dragPath)) return;
      event.preventDefault();
      event.stopPropagation();
      this.draggingPath = undefined;
      const placement = this.rowDropFeedback.getPlacement(item) || resolveDropPlacement(item, event, "vertical");
      this.rowDropFeedback.clear();
      const isAfter = placement === "after";
      const currentPaths = rows.map((r) => r.file.path).filter((path) => path !== dragPath);
      const targetIndex = currentPaths.indexOf(row.file.path);
      const beforePath = isAfter ? row.file.path : (targetIndex > 0 ? currentPaths[targetIndex - 1] : undefined);
      const afterPath = isAfter ? (targetIndex < currentPaths.length - 1 ? currentPaths[targetIndex + 1] : undefined) : row.file.path;
      const fromGroupKey = event.dataTransfer?.getData(ROW_FROM_GROUP_MIME) || "";
      const draggedRow = this.rowByPath.get(dragPath);
      if (groupField && groupKey != null && fromGroupKey !== groupKey && draggedRow) {
        if (this.actions.moveRowToGroupAndPosition) {
          void this.actions.moveRowToGroupAndPosition(draggedRow, groupField, fromGroupKey, groupKey, beforePath, afterPath);
        } else {
          void Promise.resolve(this.actions.moveRowsToGroup?.(draggedRow, groupField, fromGroupKey, groupKey))
            .then(() => this.actions.moveRowToPosition(dragPath, beforePath, afterPath));
        }
      } else {
        this.actions.moveRowToPosition(dragPath, beforePath, afterPath);
      }
    });
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
    return Boolean(this.draggingPath) || Array.from(event.dataTransfer?.types || []).includes(ROW_MIME);
  }

  private canManualReorder(config: ViewConfig): boolean {
    return !isExplicitlySorted(config);
  }

  private isPhoneLayout(): boolean {
    return window.activeDocument.body.classList.contains("is-phone");
  }

  private renderNewRow(list: HTMLElement, defaults?: Record<string, unknown>, rows: RowData[] = []): void {
    if (this.actions.isReadOnly) return;
    const button = list.createEl("button", { cls: "db-list-new-row", text: `+ ${t("toolbar.new")}` });
    button.onclick = () => this.createEntryNearEnd(defaults, rows);
  }

  private createEntryNearEnd(defaults: Record<string, unknown> | undefined, rows: RowData[]): void {
    this.actions.createEntry(defaults, this.getCreatePosition(rows));
  }

  private getCreatePosition(rows: RowData[]): CreateEntryPosition | undefined {
    const last = rows[rows.length - 1];
    return last ? { afterPath: last.file.path } : undefined;
  }

  private getCellValue(row: RowData, col: ColumnDef): unknown {
    if (col.key === "file.name") return getFileTitleDisplay(row, Array.from(this.rowByPath.values())).displayPath;
    if (isFileFieldKey(col.key)) return getRowFileFieldValue(row, col.key);
    if (col.type === "computed") return row.computed[col.computedKey || col.key];
    if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, row.frontmatter[col.key]);
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
    return Array.isArray(value) ? value.join(", ") : safeString(value);
  }

  private renderValue(field: HTMLElement, row: RowData, col: ColumnDef, value: unknown, empty = false, displayType: ColumnDef["type"] = col.type): void {
    const valueEl = field.createDiv({ cls: "db-list-field-value" });
    if (empty) valueEl.addClass("db-card-empty-placeholder");
    field.addEventListener("click", (event) => {
      if (this.actions.isReadOnly || isReadonlyFileField(col.key)) return;
      if (isHTMLElement(event.target) && event.target.closest("a, button, input, textarea, .db-cell-editing")) return;
      event.stopPropagation();
      this.actions.editCell(valueEl, row, col, event);
    });
    if (displayType === "checkbox") {
      valueEl.addClass("db-checkbox-cell");
      const cb = valueEl.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = toBooleanValue(value);
      if (col.type === "computed") {
        // 计算型 checkbox：点击打开公式编辑器
        cb.disabled = !!this.actions.isReadOnly;
        cb.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.actions.isReadOnly) this.actions.editFormula?.(col);
        };
      } else {
        cb.onclick = (event) => event.stopPropagation();
        cb.disabled = !!this.actions.isReadOnly;
        if (!this.actions.isReadOnly) {
          cb.onchange = () => {
            void this.actions.editCell(valueEl, row, col);
          };
        }
      }
      setFieldTooltip(valueEl, cb.checked ? t("common.true") : t("common.false"));
      return;
    }
    if (shouldRenderSpecialFileField(col) && renderSpecialFileFieldValue(valueEl, this.app, row, col, value, {
      tagsContainerClass: "db-list-badges",
      linkItemClass: "db-list-link",
    })) {
      return;
    }
    if (col.type === "select" || col.type === "status") {
      this.renderBadge(valueEl, col, String(value));
      return;
    }
    if (col.type === "multi-select") {
      const badges = valueEl.createDiv({ cls: "db-list-badges" });
      const values = toMultiSelectValuesForKey(col.key, value);
      setFieldTooltip(badges, values);
      for (const entry of values) this.renderBadge(badges, col, entry);
      return;
    }
    if (displayType === "date" || displayType === "datetime") {
      valueEl.addClass("db-date-value");
      valueEl.textContent = displayType === "datetime"
        ? formatDateTimeValueDisplay(value, { mode: "full", showTimeWhenMissing: true })
        : formatDateValueDisplay(value);
      valueEl.title = valueEl.textContent;
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

  renderRowFieldContent(row: RowData, col: ColumnDef, config: ViewConfig): HTMLElement {
    const value = this.getCellValue(row, col);
    const displayType = this.getDisplayType(config, col);
    const empty = this.isEmptyValue(value) && displayType !== "checkbox";
    const displayValue = empty ? this.getEmptyDisplayValue(col, displayType) : value;
    const field = window.activeDocument.createElement("div");
    field.className = "db-list-field";
    field.setAttribute("data-note-database-column-key", col.key);
    if (col.wrap) field.setCssProps({ flex: "0 0 auto" });
    else field.setCssProps({ flexBasis: `${this.getFieldWidth(config, col)}px` });
    setFieldTooltip(field, displayValue, col.label);
    if (empty) field.classList.add("is-empty-field");
    if (displayType === "checkbox") field.classList.add("is-checkbox-field");
    if (col.wrap) field.classList.add("db-list-field-wrap");
    const label = field.createSpan({ cls: "db-list-field-label", text: col.label });
    this.attachColumnContextMenu(field, col);
    this.attachColumnContextMenu(label, col);
    this.renderValue(field, row, col, displayValue, empty, displayType);
    return field;
  }

  private renderBadge(parent: HTMLElement, col: ColumnDef, value: string): void {
    const badge = parent.createSpan({ cls: "status-badge", text: value });
    badge.title = value;
    const option = getColumnOptions(col).find((item) => normalizeOptionValueForKey(col.key, item.value) === value);
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
    this.rowDropFeedback.clear();
    container.querySelectorAll(".db-list, .db-list-grouped, .db-list-total-header").forEach((el) => el.remove());
  }

  private getFieldWidth(config: ViewConfig, col: ColumnDef): number {
    return config.columnWidths?.[col.key] || col.width || config.defaultColumnWidth || 180;
  }

  private getDisplayType(config: ViewConfig, col: ColumnDef): ColumnDef["type"] {
    if (isFileFieldKey(col.key)) return getFileFieldFixedType(col.key);
    return getColumnDisplayType(col, config.schema.computedFields);
  }

  private isEmptyValue(value: unknown): boolean {
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  }

  private getEmptyDisplayValue(col: ColumnDef, displayType: ColumnDef["type"] = col.type): unknown {
    if (displayType === "multi-select") return [t("common.empty")];
    if (displayType === "checkbox") return false;
    return t("common.empty");
  }
}
