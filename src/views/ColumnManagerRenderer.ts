import { setIcon, setTooltip } from "obsidian";
import { applyRangeSelection } from "../data/RangeSelection";
import { ColumnDef, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { getFileFieldFixedType, QUICK_ADD_FILE_FIELDS } from "../data/FileFields";
import { positionToolbarPopover } from "./PopoverPosition";
import { getPropertyDropdownIcon, renderPropertyTypeIcon } from "./PropertyTypeIcon";
import { DatabaseViewState } from "./ViewStateStore";
import { isHTMLElement } from "./DomGuards";
import { openDropdownMenu } from "./DropdownField";

export interface ColumnManagerActions {
  close(): void;
  setColumnVisible(col: ColumnDef, visible: boolean): void;
  setColumnsVisible?(changes: Array<{ col: ColumnDef; visible: boolean }>): void;
  setAllColumnsVisible(visible: boolean): void;
  moveColumn(key: string, offset: -1 | 1): void;
  moveColumnTo(key: string, targetKey: string, placement: "before" | "after"): void;
  toggleColumnWrap(col: ColumnDef): void;
  editColumn(col: ColumnDef): void;
  addColumn(): void;
  addFileFieldColumn?(key: string): void;
  deleteColumn(col: ColumnDef): void;
  /** When true, edit/delete/add buttons are hidden (used by embedded/read-only views) */
  isReadOnly?: boolean;
}

export class ColumnManagerRenderer {
  private draggedKey: string | null = null;
  private lastSelectedColumnVisibilityKey: string | null = null;

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
    const savedScroll = (existing as HTMLElement | null)?.scrollTop ?? 0;
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
      this.renderColumnRow(panel, col, config, state, actions, columns, index, columns.length);
    });

    if (!actions.isReadOnly) {
      const addRow = panel.createDiv({ cls: "db-column-manager-add-row" });
      const addColumnBtn = addRow.createEl("button", {
        cls: "db-panel-button db-column-manager-add-button",
        attr: { type: "button" },
      });
      addColumnBtn.createSpan({ cls: "db-panel-button-label", text: `+ ${t("panel.addColumn")}` });
      addColumnBtn.onclick = () => actions.addColumn();

      if (actions.addFileFieldColumn) {
        const existingKeys = new Set(columns.map((col) => col.key));
        const available = QUICK_ADD_FILE_FIELDS.filter((f) => !existingKeys.has(f.key));
        if (available.length > 0) {
          const addFileBtn = addRow.createEl("button", {
            cls: "db-panel-button db-column-manager-add-button",
            attr: { type: "button" },
          });
          addFileBtn.createSpan({ cls: "db-panel-button-label", text: `+ ${t("fileField.addFileProperty")}` });
          addFileBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            openDropdownMenu({
              anchor: addFileBtn,
              label: t("fileField.addFileProperty"),
              options: available.map((f) => {
                const type = f.key === "aliases" ? "multi-select" : getFileFieldFixedType(f.key);
                return {
                  value: f.key,
                  text: f.key,
                  icon: getPropertyDropdownIcon(type),
                };
              }),
              value: "",
              onChange: (value: string) => {
                actions.addFileFieldColumn?.(value);
              },
              closeOnSelect: true,
              popoverClassName: "db-column-manager-file-property-dropdown",
              renderIcon: (parent, icon) => {
                const type = icon.startsWith("property:") ? icon.slice("property:".length) : icon;
                parent.addClass("db-column-type-option-icon");
                renderPropertyTypeIcon(parent, { type } as ColumnDef);
              },
            });
          };
        }
      }
    }
    positionToolbarPopover(panel, anchorEl);
    if (savedScroll) panel.scrollTop = savedScroll;
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
    toggleAll.onchange = () => {
      actions.setAllColumnsVisible(toggleAll.checked);
      const selectableKeys = this.getColumnVisibilityKeys(columns, config, state);
      this.lastSelectedColumnVisibilityKey = toggleAll.checked ? selectableKeys[selectableKeys.length - 1] || null : null;
    };
    toggleLabel.createSpan({ text: t("panel.all") });
  }

  private renderColumnRow(
    panel: HTMLElement,
    col: ColumnDef,
    config: ViewConfig,
    state: DatabaseViewState,
    actions: ColumnManagerActions,
    columns: ColumnDef[],
    index: number,
    total: number
  ): void {
    const row = panel.createDiv({ cls: "db-column-manager-row" });
    row.draggable = true;
    row.ondragstart = (event) => {
      if (this.shouldIgnoreColumnDrag(event)) {
        event.preventDefault();
        return;
      }
      this.draggedKey = col.key;
      event.dataTransfer?.setData("text/plain", col.key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.addClass("is-dragging");
    };
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
    row.ondragend = () => {
      this.draggedKey = null;
      row.removeClass("is-dragging");
      panel.querySelectorAll(".db-column-manager-row").forEach((el) => el.removeClass("is-drop-target"));
    };

    const drag = row.createSpan({ cls: "db-column-drag", text: "⋮⋮" });
    drag.title = t("panel.dragToSort");

    const moveControls = row.createSpan({ cls: "db-mobile-reorder-controls" });
    const upBtn = moveControls.createEl("button", {
      attr: { type: "button" },
    });
    setIcon(upBtn, "arrow-up");
    setTooltip(upBtn, t("menu.moveUp"), { delay: 100 });
    upBtn.disabled = index === 0;
    upBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      actions.moveColumn(col.key, -1);
    };
    const downBtn = moveControls.createEl("button", {
      attr: { type: "button" },
    });
    setIcon(downBtn, "arrow-down");
    setTooltip(downBtn, t("menu.moveDown"), { delay: 100 });
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
    cb.onclick = (event) => {
      const selectedKeys = new Set(columns.filter((candidate) => !state.hiddenColumns.has(candidate.key)).map((candidate) => candidate.key));
      if (requiredReason) selectedKeys.add(col.key);
      this.lastSelectedColumnVisibilityKey = applyRangeSelection({
        orderedIds: this.getColumnVisibilityKeys(columns, config, state),
        selectedIds: selectedKeys,
        anchorId: this.lastSelectedColumnVisibilityKey,
        targetId: col.key,
        selected: cb.checked,
        range: event.shiftKey,
      });
      this.syncColumnVisibility(columns, config, state, actions, selectedKeys);
    };

    const typeEl = row.createSpan({
      cls: "db-column-type",
      attr: { title: col.type },
    });
    renderPropertyTypeIcon(typeEl, col, "db-column-type-icon");

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
    const wrapBtn = row.createEl("button", {
      cls: `clickable-icon db-column-wrap-toggle${col.wrap ? " is-active" : ""}`,
      attr: {},
    });
    setIcon(wrapBtn, "wrap-text");
    setTooltip(wrapBtn, t("panel.wrap"), { delay: 100 });
    wrapBtn.onclick = () => actions.toggleColumnWrap(col);

    if (!actions.isReadOnly) {
      const editBtn = row.createEl("button", { cls: "clickable-icon" });
      setIcon(editBtn, "edit");
      editBtn.onclick = () => actions.editColumn(col);

      const deleteBtn = row.createEl("button", {
        cls: "clickable-icon db-column-delete-btn",
        attr: {},
      });
      setIcon(deleteBtn, "trash");
      setTooltip(deleteBtn, t("common.delete"), { delay: 100 });
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
      if (colBtn.instanceOf(HTMLElement)) {
        const visibleCount = Math.max(0, columns.length - state.hiddenColumns.size);
        if (visibleCount > 0) colBtn.createSpan({ cls: "db-toolbar-badge", text: String(visibleCount) });
      }
    }
  }

  private shouldIgnoreColumnDrag(event: DragEvent): boolean {
    return isHTMLElement(event.target)
      && event.target.closest("input, select, textarea, button, .db-dropdown-field, .db-mobile-reorder-controls") != null;
  }

  private getColumnVisibilityKeys(columns: ColumnDef[], config: ViewConfig, state: DatabaseViewState): string[] {
    return columns
      .filter((candidate) => this.getRequiredColumnReason(config, state, candidate) == null)
      .map((candidate) => candidate.key);
  }

  private syncColumnVisibility(
    columns: ColumnDef[],
    config: ViewConfig,
    state: DatabaseViewState,
    actions: ColumnManagerActions,
    selectedKeys: Set<string>
  ): void {
    const changes: Array<{ col: ColumnDef; visible: boolean }> = [];
    for (const candidate of columns) {
      if (this.getRequiredColumnReason(config, state, candidate) != null) continue;
      const visible = selectedKeys.has(candidate.key);
      if (visible === !state.hiddenColumns.has(candidate.key)) continue;
      changes.push({ col: candidate, visible });
    }
    if (changes.length === 0) return;
    if (actions.setColumnsVisible) actions.setColumnsVisible(changes);
    else for (const change of changes) actions.setColumnVisible(change.col, change.visible);
  }
}
