import { setIcon } from "obsidian";
import { ColumnDef, SortRule, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { DatabaseViewState } from "./ViewStateStore";
import { positionToolbarPopover } from "./PopoverPosition";
import { createDropdownField } from "./DropdownField";
import { isHTMLElement } from "./DomGuards";

export interface SortPanelActions {
  save(): void;
  refresh(): void;
  close(): void;
}

export class SortPanelRenderer {
  private panelEl: HTMLElement | null = null;
  private anchorEl: HTMLElement | null = null;
  private draggedRuleIndex: number | null = null;

  render(
    containerEl: HTMLElement,
    visible: boolean,
    config: ViewConfig,
    state: DatabaseViewState,
    actions: SortPanelActions,
    anchorEl?: HTMLElement
  ): void {
    const savedScroll = this.panelEl?.scrollTop ?? 0;
    this.panelEl?.remove();
    this.panelEl = null;
    if (!visible) {
      this.anchorEl = null;
      return;
    }
    if (anchorEl?.isConnected) this.anchorEl = anchorEl;

    const panel = containerEl.createDiv({ cls: "db-sort-panel db-filter-panel" });
    const header = containerEl.querySelector(".db-header") || containerEl.querySelector(".db-toolbar");
    if (header?.parentElement) header.parentElement.insertBefore(panel, header.nextSibling);
    this.panelEl = panel;

    const top = panel.createDiv({ cls: "db-panel-header" });
    top.createSpan({ cls: "db-panel-title", text: t("toolbar.sort") });
    // Calendar layouts reserve lanes/columns for spanning, all-day, and
    // overlapping timed events before applying user sort as a layout tiebreak.
    if (config.viewType === "calendar") {
      panel.createDiv({ cls: "db-panel-hint", text: t("sortPanel.calendarHint") });
    }

    const rules = state.sortRules || [];
    if (rules.length === 0) {
      panel.createDiv({ cls: "db-panel-empty", text: t("panel.emptySorts") });
    } else {
      rules.forEach((rule, index) => this.renderRule(panel, config, state, rule, index, actions));
    }

    panel.createEl("button", { cls: "db-panel-button", text: `+ ${t("panel.addSort")}` }).onclick = () => {
      const first = this.getSortColumns(config)[0]?.key || "file.name";
      state.sortColumn = undefined;
      state.sortDirection = "asc";
      state.sortRules = [...rules, { field: first, direction: "asc" }];
      actions.save();
      this.render(containerEl, true, config, state, actions, this.anchorEl || undefined);
      actions.refresh();
    };
    positionToolbarPopover(panel, this.anchorEl || undefined);
    if (savedScroll) panel.scrollTop = savedScroll;
  }

  private renderRule(
    panel: HTMLElement,
    config: ViewConfig,
    state: DatabaseViewState,
    rule: SortRule,
    index: number,
    actions: SortPanelActions
  ): void {
    const row = panel.createDiv({ cls: "db-panel-row db-sort-rule-row" });
    row.draggable = true;
    row.ondragstart = (event) => {
      if (this.shouldIgnoreRuleDrag(event)) {
        event.preventDefault();
        return;
      }
      this.startDrag(event, index, row);
    };
    row.ondragover = (event) => {
      event.preventDefault();
      row.addClass("is-drop-target");
    };
    row.ondragleave = () => row.removeClass("is-drop-target");
    row.ondrop = (event) => this.dropRuleOn(event, index, row, panel, config, state, actions);
    row.ondragend = () => this.finishDrag();

    const drag = row.createSpan({ cls: "db-panel-drag", text: "⋮⋮" });
    drag.title = t("panel.dragToSort");

    const moveControls = row.createSpan({ cls: "db-mobile-reorder-controls" });
    const upBtn = moveControls.createEl("button", {
      attr: { type: "button", title: t("menu.moveUp"), "aria-label": t("menu.moveUp") },
    });
    setIcon(upBtn, "arrow-up");
    upBtn.disabled = index === 0;
    upBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.moveRule(panel, config, state, actions, index, index - 1);
    };
    const downBtn = moveControls.createEl("button", {
      attr: { type: "button", title: t("menu.moveDown"), "aria-label": t("menu.moveDown") },
    });
    setIcon(downBtn, "arrow-down");
    downBtn.disabled = index >= (state.sortRules || []).length - 1;
    downBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.moveRule(panel, config, state, actions, index, index + 1);
    };

    const columns = this.getSortColumns(config);
    createDropdownField({
      parent: row,
      label: t("panel.field"),
      options: columns.map((col) => ({ value: col.key, text: col.label })),
      value: rule.field,
      className: "db-panel-dropdown db-sort-field-dropdown",
      hideLabel: true,
      onChange: (value) => {
        state.sortColumn = undefined;
        state.sortDirection = "asc";
        rule.field = value;
        actions.save();
        actions.refresh();
      },
    });

    createDropdownField({
      parent: row,
      label: t("panel.sortDirection"),
      options: [
        { value: "asc", text: t("common.asc") },
        { value: "desc", text: t("common.desc") },
      ],
      value: rule.direction,
      className: "db-panel-dropdown db-sort-direction-dropdown",
      hideLabel: true,
      onChange: (value) => {
        state.sortColumn = undefined;
        state.sortDirection = "asc";
        rule.direction = value as SortRule["direction"];
        actions.save();
        actions.refresh();
      },
    });

    row.createEl("button", { cls: "db-panel-button", text: "×" }).onclick = () => {
      state.sortRules.splice(index, 1);
      if (state.sortRules.length === 0) {
        state.sortColumn = undefined;
        state.sortDirection = "asc";
      }
      actions.save();
      this.render(panel.parentElement as HTMLElement, true, config, state, actions, this.anchorEl || undefined);
      actions.refresh();
    };
  }

  private startDrag(event: DragEvent, index: number, row: HTMLElement): void {
    this.draggedRuleIndex = index;
    row.addClass("is-dragging");
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  private dropRuleOn(
    event: DragEvent,
    targetIndex: number,
    row: HTMLElement,
    panel: HTMLElement,
    config: ViewConfig,
    state: DatabaseViewState,
    actions: SortPanelActions
  ): void {
    event.preventDefault();
    row.removeClass("is-drop-target");
    const from = this.draggedRuleIndex;
    if (from === null || from === targetIndex) {
      this.finishDrag();
      return;
    }

    const rect = row.getBoundingClientRect();
    let insertIndex = event.clientY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
    if (from < insertIndex) insertIndex -= 1;
    this.finishDrag();
    this.moveRule(panel, config, state, actions, from, insertIndex);
  }

  private moveRule(
    panel: HTMLElement,
    config: ViewConfig,
    state: DatabaseViewState,
    actions: SortPanelActions,
    from: number,
    to: number
  ): void {
    if (from < 0 || from >= state.sortRules.length || to < 0 || to >= state.sortRules.length) return;
    state.sortColumn = undefined;
    state.sortDirection = "asc";
    const [rule] = state.sortRules.splice(from, 1);
    state.sortRules.splice(to, 0, rule);
    actions.save();
    this.render(panel.parentElement as HTMLElement, true, config, state, actions, this.anchorEl || undefined);
    actions.refresh();
  }

  private finishDrag(): void {
    this.draggedRuleIndex = null;
    this.panelEl?.querySelectorAll(".db-sort-rule-row").forEach((row) => {
      row.removeClass("is-dragging", "is-drop-target");
    });
  }

  private getSortColumns(config: ViewConfig): ColumnDef[] {
    const columns = config.schema?.columns || [];
    if (columns.some((col) => col.key === "file.name")) return columns;
    return [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" }, ...columns];
  }

  private shouldIgnoreRuleDrag(event: DragEvent): boolean {
    return isHTMLElement(event.target)
      && event.target.closest("input, select, textarea, button, .db-dropdown-field, .db-mobile-reorder-controls") != null;
  }
}
