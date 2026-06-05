import { App, Menu, setIcon, TFile } from "obsidian";
import { getColumnOptions, isObsidianTagsKey, normalizeOptionValueForKey, toBooleanValue, toMultiSelectValuesForKey } from "../data/ColumnTypes";
import { getColumnDisplayType } from "../data/ColumnDisplay";
import { getRowFileFieldValue, isBaseFileField } from "../data/FileFields";
import { ColumnDef, NO_TITLE_FIELD, RowData, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";
import { setFieldTooltip } from "./FieldTooltip";
import { getFileTitleDisplay, renderStackedFileTitle } from "./FileTitleDisplay";
import { renderMobileMoveIcon } from "./MobileMoveIcon";

const ROW_MIME = "application/x-note-database-row";
const ROW_FROM_GROUP_MIME = "application/x-note-database-row-from-group";

export interface GalleryGroup {
  key: string;
  rows: RowData[];
  count: number;
}

export interface GalleryRendererActions {
  openRow(row: RowData): void;
  createEntry(defaults?: Record<string, unknown>): void;
  isRowSelected(row: RowData): boolean;
  toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void;
  areAllRowsSelected(rows: RowData[]): boolean;
  toggleRowsSelected(rows: RowData[], selected: boolean): void;
  editCell(target: HTMLElement, row: RowData, col: ColumnDef, event?: MouseEvent): void;
  getColumns(config: ViewConfig): ColumnDef[];
  updateCardSize(width: number): void;
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
  readonly isReadOnly?: boolean;
}

interface ParsedLink {
  label: string;
  target: string;
  external: boolean;
}

interface ParsedImage {
  alt: string;
  label: string;
  target: string;
  src: string;
  external: boolean;
}

export class GalleryRenderer {
  private resizeState?: { startX: number; startWidth: number; gallery: HTMLElement };
  private rowByPath = new Map<string, RowData>();
  private draggingPath: string | undefined;

  constructor(private app: App, private actions: GalleryRendererActions) {}

  render(container: HTMLElement, config: ViewConfig, rows: RowData[]): void {
    this.clear(container);
    this.rowByPath = new Map(rows.map((row) => [row.file.path, row]));
    this.renderTotalHeader(container, rows);
    const gallery = this.createGallery(container, config);
    for (const row of rows) this.renderCard(gallery, config, row, undefined, undefined, undefined, rows);
    this.renderNewCard(gallery);
  }

  renderGrouped(container: HTMLElement, config: ViewConfig, groups: GalleryGroup[], groupField: string): void {
    this.clear(container);
    this.rowByPath = new Map(groups.flatMap((group) => group.rows.map((row) => [row.file.path, row] as const)));
    const grouped = container.createDiv({ cls: "db-gallery-grouped" });
    for (const group of groups) {
      const section = grouped.createDiv({ cls: "db-gallery-group" });
      const header = section.createDiv({ cls: "db-gallery-group-header" });
      this.setupGroupDropTarget(header, groupField, group.key);
      const collapsed = Boolean(this.actions.isGroupCollapsed?.(groupField, group.key));
      section.toggleClass("is-collapsed", collapsed);
      const toggle = header.createEl("button", {
        cls: `db-gallery-group-toggle${collapsed ? " is-collapsed" : ""}`,
        attr: { type: "button", "aria-label": collapsed ? t("group.expand") : t("group.collapse") },
      });
      toggle.createSpan({ cls: "db-collapse-triangle" });
      toggle.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.actions.toggleGroupCollapsed?.(groupField, group.key);
      };
      this.renderGroupCheckbox(header, group.rows);
      header.createSpan({ cls: "db-gallery-group-title", text: group.key || t("common.uncategorized") });
      header.createSpan({ cls: "db-gallery-group-count", text: String(group.count) });
      if (collapsed) continue;
      const gallery = this.createGallery(section, config);
      this.setupGroupDropTarget(gallery, groupField, group.key);
      for (const row of group.rows) this.renderCard(gallery, config, row, groupField, group.key, groups, group.rows);
      this.renderNewCard(gallery, { [groupField]: group.key || "" });
    }
  }

  private renderTotalHeader(container: HTMLElement, rows: RowData[]): void {
    const header = container.createDiv({ cls: "db-gallery-total-header" });
    this.renderGroupCheckbox(header, rows);
    header.createSpan({ cls: "db-gallery-group-title", text: t("common.total") });
    header.createSpan({ cls: "db-gallery-group-count", text: String(rows.length) });
  }

  private renderGroupCheckbox(parent: HTMLElement, rows: RowData[]): void {
    if (this.actions.isReadOnly) return;
    const checkbox = parent.createEl("input", { cls: "db-gallery-group-checkbox", attr: { type: "checkbox" } });
    checkbox.checked = this.actions.areAllRowsSelected(rows);
    checkbox.indeterminate = rows.some((row) => this.actions.isRowSelected(row)) && !checkbox.checked;
    checkbox.onclick = (event) => event.stopPropagation();
    checkbox.onchange = () => this.actions.toggleRowsSelected(rows, checkbox.checked);
  }

  private createGallery(container: HTMLElement, config: ViewConfig): HTMLElement {
    const gallery = container.createDiv({ cls: "db-gallery" });
    gallery.style.setProperty("--db-gallery-card-width", `${this.getCardSize(config)}px`);
    gallery.style.setProperty("--db-gallery-cover-ratio", String(this.getCoverRatio(config)));
    return gallery;
  }

  private renderCard(gallery: HTMLElement, config: ViewConfig, row: RowData, groupField?: string, groupKey?: string, groups?: GalleryGroup[], allRows?: RowData[]): void {
    const card = gallery.createDiv({
      cls: "db-gallery-card",
      attr: { "data-note-database-row-path": row.file.path, title: row.file.path },
    });
    this.attachRowContextMenu(card, row);
    if (allRows) {
      if (this.canManualReorder(config)) this.setupReorderDrag(card, config, row, allRows, groupField, groupKey);
      else this.setupGroupedCardDrag(card, row, groupField, groupKey);
    }
    if (!this.isPhoneLayout()) {
      const resizeHandle = card.createDiv({ cls: "db-gallery-card-resize-handle" });
      resizeHandle.addEventListener("mousedown", (event) => this.startCardResize(event, gallery, config));
      resizeHandle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    if (config.galleryImageField) this.renderCover(card, config, row);

    const body = card.createDiv({ cls: "db-gallery-card-body" });
    const controls = body.createDiv({ cls: "db-gallery-card-controls" });
    if (!this.actions.isReadOnly) {
      const checkbox = controls.createEl("input", { cls: "db-gallery-card-checkbox", attr: { type: "checkbox" } });
      checkbox.checked = this.actions.isRowSelected(row);
      checkbox.onclick = (event) => {
        event.stopPropagation();
        this.actions.toggleRowSelected(row, !this.actions.isRowSelected(row), event);
      };
    }
    const openBtn = controls.createEl("button", {
      cls: "db-gallery-card-open",
      attr: { "aria-label": t("menu.openNote"), title: t("menu.openNote") },
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
    const titleField = this.getTitleField(config, columns);
    const titleCol = titleField ? columns.find((col) => col.key === titleField) : undefined;
    const title = titleField ? this.getTitleText(config, row, titleField) : "";
    if (title && titleCol) {
      const titleEl = body.createDiv({
        cls: "db-gallery-card-title",
        attr: { title: titleCol.key === "file.name" ? row.file.path : title },
      });
      if (titleCol.key === "file.name") {
        renderStackedFileTitle(titleEl, getFileTitleDisplay(row, Array.from(this.rowByPath.values())), true);
      } else {
        titleEl.textContent = title;
      }
    }
    const meta = body.createDiv({ cls: "db-gallery-meta" });
    const fields = columns.filter((col) => col.key !== titleField);
    for (const col of fields) {
      const value = this.getCellValue(row, col);
      const displayType = this.getDisplayType(config, col);
      const empty = this.isEmptyValue(value) && displayType !== "checkbox";
      if (empty && !this.shouldShowEmptyField(config, col)) continue;
      const displayValue = empty ? this.getEmptyDisplayValue(col, displayType) : value;
      const item = meta.createDiv({ cls: "db-gallery-field", attr: { "data-note-database-column-key": col.key } });
      item.style.setProperty("--db-card-field-width", `${this.getFieldWidth(config, col)}px`);
      setFieldTooltip(item, displayValue, col.label);
      if (empty) item.addClass("is-empty-field");
      if (displayType === "checkbox") item.addClass("is-checkbox-field");
      if (col.wrap) item.addClass("db-gallery-field-wrap");
      const label = item.createSpan({ cls: "db-gallery-field-label", text: col.label });
      this.attachColumnContextMenu(item, col);
      this.attachColumnContextMenu(label, col);
      this.renderValue(item, row, col, displayValue, empty, displayType);
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
    card: HTMLElement,
    config: ViewConfig,
    row: RowData,
    rows: RowData[],
    groupField?: string,
    groupKey?: string,
    groups?: GalleryGroup[]
  ): void {
    const button = card.createEl("button", {
      cls: "db-card-mobile-move-btn",
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
          menu.addItem((item) => item
            .setTitle(`${t("mobile.moveTo")} ${group.key || t("common.uncategorized")}`)
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

  /** Add local rank movement actions shared by grouped and ungrouped cards. */
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

  private setupGroupedCardDrag(card: HTMLElement, row: RowData, groupField?: string, groupKey?: string): void {
    if (!groupField || groupKey == null || this.actions.isReadOnly || !this.actions.moveRowsToGroup) return;
    if (this.isPhoneLayout()) return;
    card.draggable = true;
    card.addEventListener("dragstart", (event) => {
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button, .db-gallery-card-resize-handle")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData(ROW_MIME, row.file.path);
      event.dataTransfer?.setData("text/plain", row.file.path);
      event.dataTransfer?.setData(ROW_FROM_GROUP_MIME, groupKey);
      card.addClass("is-dragging");
    });
    card.addEventListener("dragend", () => card.removeClass("is-dragging"));
  }

  private setupReorderDrag(card: HTMLElement, config: ViewConfig, row: RowData, rows: RowData[], groupField?: string, groupKey?: string): void {
    if (this.actions.isReadOnly || this.isPhoneLayout() || !this.canManualReorder(config)) return;
    card.draggable = true;
    card.addEventListener("dragstart", (event) => {
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button, .db-gallery-card-resize-handle")) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData(ROW_MIME, row.file.path);
      event.dataTransfer?.setData("text/plain", row.file.path);
      if (groupKey != null) event.dataTransfer?.setData(ROW_FROM_GROUP_MIME, groupKey);
      this.draggingPath = row.file.path;
      card.addClass("is-dragging");
    });
    card.addEventListener("dragend", () => {
      this.draggingPath = undefined;
      card.removeClass("is-dragging");
      this.clearDropTargets(card.parentElement);
    });
    card.addEventListener("dragover", (event) => {
      const dragPath = this.draggingPath;
      if (!dragPath || dragPath === row.file.path) return;
      if (!this.isRowDrag(event)) return;
      event.preventDefault();
      const rect = card.getBoundingClientRect();
      const isAfter = event.clientX > rect.left + rect.width / 2;
      card.toggleClass("is-drop-after", isAfter);
      card.toggleClass("is-drop-before", !isAfter);
    });
    card.addEventListener("dragleave", () => {
      card.removeClass("is-drop-before", "is-drop-after");
    });
    card.addEventListener("drop", (event) => {
      if (!this.isRowDrag(event)) return;
      const dragPath = this.draggingPath || event.dataTransfer?.getData(ROW_MIME);
      if (!dragPath || dragPath === row.file.path) return;
      if (!this.rowByPath.has(dragPath)) return;
      event.preventDefault();
      event.stopPropagation();
      this.draggingPath = undefined;
      this.clearDropTargets(card.parentElement);
      const rect = card.getBoundingClientRect();
      const isAfter = event.clientX > rect.left + rect.width / 2;
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

  private clearDropTargets(parent: HTMLElement | null): void {
    if (!parent) return;
    parent.querySelectorAll(".is-drop-before, .is-drop-after").forEach((el) => {
      el.classList.remove("is-drop-before", "is-drop-after");
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
    if (config.sortColumn) return false;
    return !((config.sortRules || []).some((rule) => rule.field && rule.direction));
  }

  private isPhoneLayout(): boolean {
    return window.activeDocument.body.classList.contains("is-phone");
  }

  private renderCover(card: HTMLElement, config: ViewConfig, row: RowData): void {
    const cover = card.createDiv({ cls: "db-gallery-cover" });
    cover.style.setProperty("--db-gallery-image-fit", config.galleryImageFit || "cover");
    const image = this.getCoverImage(config, row);
    if (!image) {
      cover.addClass("is-empty");
      setIcon(cover.createSpan({ cls: "db-gallery-cover-placeholder" }), "image");
      return;
    }
    const button = cover.createEl("button", { cls: "db-gallery-cover-button", attr: { title: image.label } });
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openTarget(row, image.target, image.external);
    };
    button.createEl("img", { attr: { src: image.src, alt: image.alt } });
  }

  private renderNewCard(gallery: HTMLElement, defaults?: Record<string, unknown>): void {
    if (this.actions.isReadOnly) return;
    const button = gallery.createEl("button", { cls: "db-gallery-new-card", text: `+ ${t("toolbar.new")}` });
    button.onclick = () => this.actions.createEntry(defaults);
  }

  private getCoverImage(config: ViewConfig, row: RowData): ParsedImage | null {
    const field = config.galleryImageField;
    if (!field) return null;
    const value = row.frontmatter[field];
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      const image = this.parseImage(entry, row);
      if (image) return image;
    }
    return null;
  }

  private getCellValue(row: RowData, col: ColumnDef): unknown {
    if (col.key === "file.name") return getFileTitleDisplay(row, Array.from(this.rowByPath.values())).displayPath;
    if (isBaseFileField(col.key)) return getRowFileFieldValue(row, col.key);
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
    return Array.isArray(value) ? value.join(", ") : String(value);
  }

  private renderValue(item: HTMLElement, row: RowData, col: ColumnDef, value: unknown, empty = false, displayType: ColumnDef["type"] = col.type): void {
    const valueEl = item.createDiv({ cls: "db-gallery-field-value" });
    if (empty) valueEl.addClass("db-card-empty-placeholder");
    item.addEventListener("click", (event) => {
      if (this.actions.isReadOnly) return;
      if (isHTMLElement(event.target) && event.target.closest("a, button, input, textarea, .db-cell-editing")) return;
      event.stopPropagation();
      this.actions.editCell(valueEl, row, col, event);
    });
    if (displayType === "checkbox") {
      valueEl.addClass("db-checkbox-cell");
      const cb = valueEl.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = toBooleanValue(value);
      cb.onclick = (event) => event.stopPropagation();
      cb.disabled = this.actions.isReadOnly || col.type === "computed";
      if (!this.actions.isReadOnly && col.type !== "computed") {
        cb.onchange = () => {
          void this.actions.editCell(valueEl, row, col);
        };
      }
      setFieldTooltip(valueEl, cb.checked ? t("common.true") : t("common.false"));
      return;
    }
    if (col.type === "select" || col.type === "status") {
      this.renderBadge(valueEl, col, String(value));
      return;
    }
    if (col.type === "multi-select") {
      valueEl.addClass("has-badges");
      const wrap = valueEl.createDiv({ cls: "db-gallery-badges" });
      const values = toMultiSelectValuesForKey(col.key, value);
      setFieldTooltip(wrap, values);
      for (const entry of values) this.renderBadge(wrap, col, entry);
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
    setFieldTooltip(valueEl, valueEl.textContent);
  }

  renderCardFieldContent(row: RowData, col: ColumnDef, config: ViewConfig): HTMLElement {
    const value = this.getCellValue(row, col);
    const displayType = this.getDisplayType(config, col);
    const empty = this.isEmptyValue(value) && displayType !== "checkbox";
    const displayValue = empty ? this.getEmptyDisplayValue(col, displayType) : value;
    const item = window.activeDocument.createElement("div");
    item.className = "db-gallery-field";
    item.setAttribute("data-note-database-column-key", col.key);
    item.style.setProperty("--db-card-field-width", `${this.getFieldWidth(config, col)}px`);
    setFieldTooltip(item, displayValue, col.label);
    if (empty) item.classList.add("is-empty-field");
    if (displayType === "checkbox") item.classList.add("is-checkbox-field");
    if (col.wrap) item.classList.add("db-gallery-field-wrap");
    const label = item.createSpan({ cls: "db-gallery-field-label", text: col.label });
    this.attachColumnContextMenu(item, col);
    this.attachColumnContextMenu(label, col);
    this.renderValue(item, row, col, displayValue, empty, displayType);
    return item;
  }

  private isEmptyValue(value: unknown): boolean {
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  }

  private shouldShowEmptyField(config: ViewConfig, col: ColumnDef): boolean {
    return config.showEmptyFields === true;
  }

  private getEmptyDisplayValue(col: ColumnDef, displayType: ColumnDef["type"] = col.type): unknown {
    if (displayType === "multi-select") return [t("common.empty")];
    if (displayType === "checkbox") return false;
    return t("common.empty");
  }

  private renderBadge(parent: HTMLElement, col: ColumnDef, value: string): void {
    const badge = parent.createSpan({ cls: "status-badge", text: value });
    badge.title = value;
    const option = getColumnOptions(col).find((item) => normalizeOptionValueForKey(col.key, item.value) === value);
    badge.addClass(`status-color-${option?.color || "gray"}`);
  }

  private renderLink(parent: HTMLElement, row: RowData, link: ParsedLink): void {
    const anchor = parent.createEl("a", { cls: "db-gallery-link", text: link.label, attr: { title: link.label } });
    anchor.href = link.external ? link.target : "#";
    anchor.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openTarget(row, link.target, link.external);
    };
  }

  private parseImage(value: unknown, row: RowData): ParsedImage | null {
    if (typeof value !== "string") return null;
    const link = this.parseLink(value);
    const target = link?.target || value.trim();
    if (!this.isImageTarget(target)) return null;
    const src = link?.external ? target : this.resolveImageSrc(target, row);
    if (!src) return null;
    return {
      alt: link?.label || target,
      label: link?.label || target,
      target,
      src,
      external: link?.external || this.isExternalUrl(target),
    };
  }

  private parseLink(value: unknown): ParsedLink | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text) return null;

    const markdownImage = text.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (markdownImage) return this.toParsedLink(markdownImage[2], markdownImage[1] || markdownImage[2]);

    const markdownLink = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (markdownLink) return this.toParsedLink(markdownLink[2], markdownLink[1]);

    const wikiImage = text.match(/^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (wikiImage) return this.toParsedLink(wikiImage[1], wikiImage[2] || wikiImage[1]);

    const wikiLink = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (wikiLink) return this.toParsedLink(wikiLink[1], wikiLink[2] || wikiLink[1]);

    if (this.isExternalUrl(text)) return this.toParsedLink(text, text);
    if (this.isLikelyLocalTarget(text)) return this.toParsedLink(text, text);
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

  private resolveImageSrc(target: string, row: RowData): string | null {
    const file = this.app.metadataCache.getFirstLinkpathDest(target, row.file.path);
    if (file instanceof TFile) return this.app.vault.getResourcePath(file);
    return this.isExternalUrl(target) ? target : null;
  }

  private async openTarget(row: RowData, target: string, external: boolean): Promise<void> {
    if (external) {
      window.open(target);
      return;
    }
    await this.app.workspace.openLinkText(target, row.file.path);
  }

  private isImageTarget(target: string): boolean {
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#].*)?$/i.test(target);
  }

  private isExternalUrl(target: string): boolean {
    return /^https?:\/\//i.test(target);
  }

  private isLikelyLocalTarget(target: string): boolean {
    return target.endsWith(".md") || target.includes("/") || this.isImageTarget(target);
  }

  private getCardSize(config: ViewConfig): number {
    return Math.max(160, Math.min(420, Math.round(config.galleryCardSize || 250)));
  }

  private startCardResize(event: MouseEvent, gallery: HTMLElement, config: ViewConfig): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizeState = {
      startX: event.clientX,
      startWidth: this.getCardSize(config),
      gallery,
    };
    window.activeDocument.addEventListener("mousemove", this.handleCardResize);
    window.activeDocument.addEventListener("mouseup", this.finishCardResize);
  }

  private readonly handleCardResize = (event: MouseEvent): void => {
    if (!this.resizeState) return;
    event.preventDefault();
    event.stopPropagation();
    const width = this.clampCardSize(this.resizeState.startWidth + event.clientX - this.resizeState.startX);
    this.resizeState.gallery.style.setProperty("--db-gallery-card-width", `${width}px`);
  };

  private readonly finishCardResize = (event: MouseEvent): void => {
    if (!this.resizeState) return;
    event.preventDefault();
    event.stopPropagation();
    const width = this.clampCardSize(this.resizeState.startWidth + event.clientX - this.resizeState.startX);
    window.activeDocument.removeEventListener("mousemove", this.handleCardResize);
    window.activeDocument.removeEventListener("mouseup", this.finishCardResize);
    this.resizeState = undefined;
    this.actions.updateCardSize(width);
  };

  private clampCardSize(width: number): number {
    return Math.max(160, Math.min(420, Math.round(width)));
  }

  private getCoverRatio(config: ViewConfig): number {
    return Math.max(0.35, Math.min(2.5, config.galleryImageAspectRatio || 0.75));
  }

  private getFieldWidth(config: ViewConfig, col: ColumnDef): number {
    return config.columnWidths?.[col.key] || col.width || config.defaultColumnWidth || 150;
  }

  private getDisplayType(config: ViewConfig, col: ColumnDef): ColumnDef["type"] {
    return getColumnDisplayType(col, config.schema.computedFields);
  }

  private clear(container: HTMLElement): void {
    container.querySelectorAll(".db-gallery, .db-gallery-grouped, .db-gallery-total-header").forEach((el) => el.remove());
  }
}
