import { ColumnDef, ViewConfig } from "../data/types";
import { t } from "../i18n";

export interface ColumnHeaderActions {
  getConfig(): ViewConfig | undefined;
  ensureColumnOrder(config: ViewConfig): void;
  showContextMenu(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement): void;
  sortByColumn(col: ColumnDef): void;
  saveConfig(): void;
  setUndoLabel(label: string): void;
  refresh(): void;
}

export class ColumnHeaderController {
  private suppressSortUntil = 0;

  constructor(private actions: ColumnHeaderActions) {}

  setup(th: HTMLElement, col: ColumnDef): void {
    th.addEventListener("click", (event) => {
      if (Date.now() < this.suppressSortUntil) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, .db-resize-handle")) return;
      this.actions.sortByColumn(col);
    });
    th.addEventListener("contextmenu", (e) => this.actions.showContextMenu(e, col, th));
    this.setupMenuTrigger(th, col);
    if (!this.isPhoneLayout()) {
      this.setupResizeHandle(th, col);
      this.setupDragToReorder(th, col);
    }
  }

  private setupMenuTrigger(th: HTMLElement, col: ColumnDef): void {
    const button = th.createEl("button", {
      cls: "db-column-menu-trigger",
      text: "...",
      attr: { "aria-label": t("column.openMenu", { label: col.label }) },
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.showContextMenu(event, col, button);
    });
  }

  private setupResizeHandle(th: HTMLElement, col: ColumnDef): void {
    const handle = th.createEl("div", { cls: "db-resize-handle" });
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.suppressSortUntil = Date.now() + 300;
      startX = e.clientX;
      startWidth = Math.max(28, col.width || this.actions.getConfig()?.defaultColumnWidth || 150);
      const onMouseMove = (ev: MouseEvent) => {
        this.suppressSortUntil = Date.now() + 300;
        const newWidth = Math.max(28, startWidth + (ev.clientX - startX));
        col.width = newWidth;
        this.syncTableColumnLayouts(th);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        this.suppressSortUntil = Date.now() + 300;
        this.actions.setUndoLabel(t("undo.columnWidthConfig"));
        this.actions.saveConfig();
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
    handle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.suppressSortUntil = Date.now() + 300;
    });
  }

  private syncTableColumnLayouts(th: HTMLElement): void {
    const root = th.closest(".note-database-container");
    const config = this.actions.getConfig();
    if (!root || !config || typeof CSS === "undefined" || !CSS.escape) return;

    const columnByKey = new Map(config.schema.columns.map((column) => [column.key, column]));
    root.querySelectorAll<HTMLTableElement>("table.db-table").forEach((table) => {
      const colgroup = table.querySelector("colgroup");
      if (!colgroup) return;

      const dataCols = Array.from(colgroup.querySelectorAll<HTMLElement>("col[data-note-database-column-key]"));
      if (dataCols.length === 0) return;

      const keys = dataCols.map((colEl) => colEl.getAttribute("data-note-database-column-key") || "");
      const baseWidths = keys.map((key) => this.getColumnWidth(columnByKey.get(key), config));
      const selectionCol = colgroup.querySelector<HTMLElement>("col.db-select-colgroup");
      const selectionWidth = selectionCol ? 34 : 0;
      const baseWidth = baseWidths.reduce((total, width) => total + width, 0);
      const tableWidth = Math.max(720, selectionWidth + baseWidth);
      const extraWidth = Math.max(0, tableWidth - selectionWidth - baseWidth);
      const extraPerColumn = extraWidth / dataCols.length;

      table.style.width = `${tableWidth}px`;
      table.style.minWidth = `${tableWidth}px`;
      if (selectionCol) {
        selectionCol.setAttr("width", "34");
        selectionCol.style.width = "34px";
      }

      dataCols.forEach((colEl, index) => {
        const width = baseWidths[index] + extraPerColumn;
        colEl.style.width = `${width}px`;
      });
    });

    for (const col of columnByKey.values()) {
      const escaped = CSS.escape(col.key);
      root.querySelectorAll<HTMLElement>(`th[data-note-database-column-key="${escaped}"]`).forEach((el) => {
        const renderedWidth = this.getRenderedHeaderWidth(el, col, config);
        el.style.width = `${renderedWidth}px`;
        el.toggleClass("is-narrow", this.isHeaderNarrow(renderedWidth, col.key));
      });
    }
  }

  private getRenderedHeaderWidth(th: HTMLElement, col: ColumnDef, config: ViewConfig): number {
    const table = th.closest("table.db-table");
    const colEl = table?.querySelector<HTMLElement>(`col[data-note-database-column-key="${CSS.escape(col.key)}"]`);
    const parsedWidth = colEl ? parseFloat(colEl.style.width || "") : Number.NaN;
    return Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : this.getColumnWidth(col, config);
  }

  private getColumnWidth(col: ColumnDef | undefined, config: ViewConfig): number {
    return col?.width || config.defaultColumnWidth || 150;
  }

  private isHeaderNarrow(width: number, key: string): boolean {
    const config = this.actions.getConfig();
    const col = config?.schema.columns.find((candidate) => candidate.key === key);
    const labelLength = (col?.label || col?.key || key).length;
    return width < Math.min(180, Math.max(96, labelLength * 7 + 54));
  }

  private setupDragToReorder(th: HTMLElement, col: ColumnDef): void {
    th.draggable = true;
    th.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", col.key);
      th.addClass("db-dragging");
    });
    th.addEventListener("dragover", (e) => {
      e.preventDefault();
      th.addClass("db-drop-target");
    });
    th.addEventListener("dragleave", () => {
      th.removeClass("db-drop-target");
    });
    th.addEventListener("drop", (e) => {
      e.preventDefault();
      th.removeClass("db-drop-target");
      const draggedKey = e.dataTransfer?.getData("text/plain");
      if (!draggedKey || draggedKey === col.key) return;
      const config = this.actions.getConfig();
      if (!config) return;
      this.actions.ensureColumnOrder(config);
      const fromIdx = config.columnOrder!.indexOf(draggedKey);
      const toIdx = config.columnOrder!.indexOf(col.key);
      if (fromIdx < 0 || toIdx < 0) return;
      const [removed] = config.columnOrder!.splice(fromIdx, 1);
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx;
      config.columnOrder!.splice(adjustedTo, 0, removed);
      this.actions.setUndoLabel(t("undo.columnOrderConfig"));
      this.actions.saveConfig();
      this.actions.refresh();
    });
    th.addEventListener("dragend", () => {
      th.removeClass("db-dragging");
      document.querySelectorAll(".db-drop-target").forEach((el) => el.classList.remove("db-drop-target"));
    });
  }

  private isPhoneLayout(): boolean {
    return document.body.classList.contains("is-phone");
  }
}
