import { setIcon } from "obsidian";
import { ColumnDef, ViewConfig } from "../data/types";
import { COLUMN_TYPE_LABELS } from "../data/ColumnTypes";
import { t } from "../i18n";
import { positionToolbarPopover } from "./PopoverPosition";
import { renderPropertyTypeIcon } from "./PropertyTypeIcon";
import { DatabaseViewState } from "./ViewStateStore";

export interface ColumnManagerActions {
  close(): void;
  setColumnVisible(col: ColumnDef, visible: boolean): void;
  setAllColumnsVisible(visible: boolean): void;
  moveColumn(key: string, offset: -1 | 1): void;
  moveColumnTo(key: string, targetKey: string, placement: "before" | "after"): void;
  toggleColumnWrap(col: ColumnDef): void;
  editColumn(col: ColumnDef): void;
  addColumn(): void;
  deleteColumn(col: ColumnDef): void;
  /** When true, edit/delete/add buttons are hidden (used by embedded/read-only views) */
  isReadOnly?: boolean;
}

export class ColumnManagerRenderer {
  private draggedKey: string | null = null;

  render(
    containerEl: HTMLElement,
    visible: boolean,
    config: ViewConfig,
    state: DatabaseViewState,
    columns: ColumnDef[],
    actions: ColumnManagerActions,
    anchorEl?: HTMLElement
  ): void {
    const existing = containerEl.querySelector(".db-column-manager");
    if (existing) existing.remove();
    if (!visible) return;

    const panel = containerEl.createDiv({
      cls: "db-column-manager",
    });
    const header = containerEl.querySelector(".db-header") || containerEl.querySelector(".db-toolbar");
    if (header?.parentElement) {
      header.parentElement.insertBefore(panel, header.nextSibling);
    }

    this.renderHeader(panel, columns, config, state, actions);
    columns.forEach((col, index) => {
      this.renderColumnRow(panel, col, config, state, actions, index, columns.length);
    });

    if (!actions.isReadOnly) {
      const addColumnBtn = panel.createEl("button", {
        cls: "db-panel-button",
        text: `+ ${t("panel.addColumn")}`,
      });
      addColumnBtn.onclick = () => actions.addColumn();
    }
    positionToolbarPopover(panel, anchorEl);
    this.updateToolbarButton(containerEl, state, columns);
  }

  private renderHeader(
    panel: HTMLElement,
    columns: ColumnDef[],
    config: ViewConfig,
    state: DatabaseViewState,
    actions: ColumnManagerActions
  ): void {
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createSpan({ text: t("toolbar.properties"), cls: "db-panel-title" });
    const right = header.createDiv({ cls: "db-panel-header-actions" });
    const toggleLabel = right.createEl("label", { cls: "db-column-manager-toggle-all" });
    const toggleAll = toggleLabel.createEl("input", { attr: { type: "checkbox" } });
    const visibleCount = columns.filter((col) => !state.hiddenColumns.has(col.key)).length;
    toggleAll.checked = visibleCount === columns.length;
    toggleAll.indeterminate = visibleCount > 0 && visibleCount < columns.length;
    toggleAll.onchange = () => actions.setAllColumnsVisible(toggleAll.checked);
    toggleLabel.createSpan({ text: t("panel.all") });
  }

  private renderColumnRow(
    panel: HTMLElement,
    col: ColumnDef,
    config: ViewConfig,
    state: DatabaseViewState,
    actions: ColumnManagerActions,
    index: number,
    total: number
  ): void {
    const row = panel.createDiv({ cls: "db-column-manager-row" });
    row.ondragover = (event) => {
      if (!this.draggedKey || this.draggedKey === col.key) return;
      event.preventDefault();
      row.addClass("is-drop-target");
    };
    row.ondragleave = () => row.removeClass("is-drop-target");
    row.ondrop = (event) => {
      if (!this.draggedKey || this.draggedKey === col.key) return;
      event.preventDefault();
      row.removeClass("is-drop-target");
      const rect = row.getBoundingClientRect();
      const placement = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
      actions.moveColumnTo(this.draggedKey, col.key, placement);
      this.draggedKey = null;
    };

    const drag = row.createSpan({ cls: "db-column-drag", text: "⋮⋮" });
    drag.draggable = true;
    drag.title = t("panel.dragToSort");
    drag.ondragstart = (event) => {
      this.draggedKey = col.key;
      event.dataTransfer?.setData("text/plain", col.key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.addClass("is-dragging");
    };
    drag.ondragend = () => {
      this.draggedKey = null;
      row.removeClass("is-dragging");
      panel.querySelectorAll(".db-column-manager-row").forEach((el) => el.removeClass("is-drop-target"));
    };

    const moveControls = row.createSpan({ cls: "db-mobile-reorder-controls" });
    const upBtn = moveControls.createEl("button", {
      attr: { type: "button", title: t("menu.moveUp"), "aria-label": t("menu.moveUp") },
    });
    setIcon(upBtn, "arrow-up");
    upBtn.disabled = index === 0;
    upBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      actions.moveColumn(col.key, -1);
    };
    const downBtn = moveControls.createEl("button", {
      attr: { type: "button", title: t("menu.moveDown"), "aria-label": t("menu.moveDown") },
    });
    setIcon(downBtn, "arrow-down");
    downBtn.disabled = index >= total - 1;
    downBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      actions.moveColumn(col.key, 1);
    };

    const requiredReason = this.getRequiredColumnReason(config, state, col);
    const cb = row.createEl("input", { attr: { type: "checkbox" } });
    cb.checked = !state.hiddenColumns.has(col.key);
    if (requiredReason) {
      cb.checked = true;
      cb.disabled = true;
    }
    cb.onchange = () => actions.setColumnVisible(col, cb.checked);

    const nameWrap = row.createDiv({ cls: "db-column-name-wrap" });
    const nameEl = nameWrap.createSpan({
      text: `${col.label} [${col.key}]`,
      cls: "db-column-name",
    });
    nameEl.title = t("panel.doubleClickEdit");
    nameEl.addEventListener("dblclick", () => actions.editColumn(col));
    if (requiredReason) {
      nameWrap.createDiv({
        cls: "db-column-group-hint",
        text: requiredReason,
        attr: { title: requiredReason },
      });
    }
    const typeEl = row.createSpan({
      cls: "db-column-type",
      attr: { title: COLUMN_TYPE_LABELS()[col.type] },
    });
    renderPropertyTypeIcon(typeEl, col, "db-column-type-icon");
    typeEl.createSpan({ text: COLUMN_TYPE_LABELS()[col.type] });
    const wrapBtn = row.createEl("button", {
      cls: `clickable-icon db-column-wrap-toggle${col.wrap ? " is-active" : ""}`,
      attr: { title: t("panel.wrap"), "aria-label": t("panel.wrap") },
    });
    setIcon(wrapBtn, "wrap-text");
    wrapBtn.onclick = () => actions.toggleColumnWrap(col);

    if (!actions.isReadOnly) {
      const editBtn = row.createEl("button", { cls: "clickable-icon" });
      setIcon(editBtn, "edit");
      editBtn.onclick = () => actions.editColumn(col);

      const deleteBtn = row.createEl("button", {
        cls: "clickable-icon db-column-delete-btn",
        attr: { title: t("common.delete"), "aria-label": t("common.delete") },
      });
      setIcon(deleteBtn, "trash");
      deleteBtn.onclick = () => actions.deleteColumn(col);
    }
  }

  /** Returns the reason a column must stay visible, or null if it can be freely hidden. */
  private getRequiredColumnReason(config: ViewConfig, state: DatabaseViewState, col: ColumnDef): string | null {
    if (config.viewType === "table") return null;
    // Title field
    if (config.titleField && col.key === config.titleField) {
      return t("panel.titleFieldHint");
    }
    return null;
  }

  private updateToolbarButton(containerEl: HTMLElement, state: DatabaseViewState, columns: ColumnDef[]): void {
    const colBtn = containerEl.querySelector(".db-col-manager-btn");
    if (colBtn) {
      colBtn.querySelector(".db-toolbar-badge")?.remove();
      if (colBtn instanceof HTMLElement) {
        const visibleCount = Math.max(0, columns.length - state.hiddenColumns.size);
        if (visibleCount > 0) colBtn.createSpan({ cls: "db-toolbar-badge", text: String(visibleCount) });
      }
    }
  }
}
