import { ColumnDef, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";
import { syncTableColumnLayouts } from "./TableColumnLayoutSync";

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
      if (isHTMLElement(target) && target.closest("button, .db-resize-handle")) return;
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
      const config = this.actions.getConfig();
      startWidth = Math.max(28, config?.columnWidths?.[col.key] || col.width || config?.defaultColumnWidth || 150);
      const onMouseMove = (ev: MouseEvent) => {
        this.suppressSortUntil = Date.now() + 300;
        const newWidth = Math.max(28, startWidth + (ev.clientX - startX));
        const currentConfig = this.actions.getConfig();
        if (currentConfig) {
          currentConfig.columnWidths = { ...(currentConfig.columnWidths || {}), [col.key]: newWidth };
        } else {
          col.width = newWidth;
        }
        this.syncTableColumnLayouts(th);
      };
      const onMouseUp = () => {
        window.activeDocument.removeEventListener("mousemove", onMouseMove);
        window.activeDocument.removeEventListener("mouseup", onMouseUp);
        this.suppressSortUntil = Date.now() + 300;
        this.actions.setUndoLabel(t("undo.columnWidthConfig"));
        this.actions.saveConfig();
      };
      window.activeDocument.addEventListener("mousemove", onMouseMove);
      window.activeDocument.addEventListener("mouseup", onMouseUp);
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
    if (!root || !config) return;
    syncTableColumnLayouts(root, config);
  }

  private setupDragToReorder(th: HTMLElement, col: ColumnDef): void {
    th.draggable = true;
    th.addEventListener("dragstart", (e) => {
      if (th.closest(".note-database-container.is-row-dragging")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer?.setData("text/plain", col.key);
      th.addClass("db-dragging");
    });
    th.addEventListener("dragover", (e) => {
      if (th.closest(".note-database-container.is-row-dragging")) return;
      e.preventDefault();
      th.addClass("db-drop-target");
    });
    th.addEventListener("dragleave", () => {
      th.removeClass("db-drop-target");
    });
    th.addEventListener("drop", (e) => {
      if (th.closest(".note-database-container.is-row-dragging")) return;
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
      window.activeDocument.querySelectorAll(".db-drop-target").forEach((el) => el.classList.remove("db-drop-target"));
    });
  }

  private isPhoneLayout(): boolean {
    return window.activeDocument.body.classList.contains("is-phone");
  }
}
