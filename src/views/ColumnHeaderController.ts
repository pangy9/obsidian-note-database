import { ColumnDef, ViewConfig } from "../data/types";
import { t } from "../i18n";

export interface ColumnHeaderActions {
  getConfig(): ViewConfig | undefined;
  ensureColumnOrder(config: ViewConfig): void;
  showContextMenu(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement): void;
  sortByColumn(col: ColumnDef): void;
  saveConfig(): void;
  refresh(): void;
}

export class ColumnHeaderController {
  constructor(private actions: ColumnHeaderActions) {}

  setup(th: HTMLElement, col: ColumnDef): void {
    if (col.width) {
      th.style.width = `${col.width}px`;
    }

    th.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, .db-resize-handle")) return;
      this.actions.sortByColumn(col);
    });
    th.addEventListener("contextmenu", (e) => this.actions.showContextMenu(e, col, th));
    this.setupMenuTrigger(th, col);
    this.setupResizeHandle(th, col);
    this.setupDragToReorder(th, col);
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
    const handle = th.createEl("div", {
      cls: "db-resize-handle",
      attr: { style: "position: absolute; right: 0; top: 0; bottom: 0; width: 4px; cursor: col-resize; z-index: 1;" },
    });
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      startX = e.clientX;
      startWidth = col.width || th.offsetWidth;
      // Find the corresponding <col> element in colgroup
      const colIdx = (th as HTMLTableCellElement).cellIndex;
      const colEl = th.closest("table")?.querySelector("colgroup")?.children[colIdx] as HTMLElement | undefined;
      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.max(40, startWidth + (ev.clientX - startX));
        col.width = newWidth;
        th.style.width = `${newWidth}px`;
        if (colEl) colEl.style.width = `${newWidth}px`;
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        this.actions.saveConfig();
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
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
      this.actions.saveConfig();
      this.actions.refresh();
    });
    th.addEventListener("dragend", () => {
      th.removeClass("db-dragging");
      document.querySelectorAll(".db-drop-target").forEach((el) => el.classList.remove("db-drop-target"));
    });
  }
}
