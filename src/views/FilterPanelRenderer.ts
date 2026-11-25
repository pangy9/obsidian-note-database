import { getFilterEditorOperators, getFilterOperatorsForColumn, getPresentedFilterOperator } from "../data/FilterRules";
export { getFilterOperatorsForColumn } from "../data/FilterRules";
import { getColumnDisplayType } from "../data/ColumnDisplay";
import { getColumnOptions, toBooleanValue } from "../data/ColumnTypes";
import { isImeComposing } from "../data/KeyboardUtils";
import { isDateLikeColumnType } from "../data/DateTimeFormat";
import { ColumnDef, FilterRule, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { createDropdownField } from "./DropdownField";
import { positionToolbarPopover } from "./PopoverPosition";
import { renderDropdownPropertyTypeIcon, toPropertyDropdownOption } from "./PropertyTypeIcon";
import { DatabaseViewState } from "./ViewStateStore";
import { getViewRuleColumns, removeFilterRuleAt } from "./ViewRuleOperations";
import { closeActiveDateValuePicker, renderDateValuePicker } from "./DateValuePicker";

export interface FilterPanelActions {
  saveState(): void;
  refresh(): void;
  close(): void;
}

export class FilterPanelRenderer {
  private panelEl: HTMLElement | null = null;
  private anchorEl: HTMLElement | null = null;
  private refreshTimer: number | null = null;

  render(
    containerEl: HTMLElement,
    visible: boolean,
    state: DatabaseViewState,
    config: ViewConfig,
    actions: FilterPanelActions,
    anchorEl?: HTMLElement
  ): void {
    const savedScroll = this.panelEl?.scrollTop ?? 0;
    closeActiveDateValuePicker(containerEl.ownerDocument);
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
    if (!visible) {
      this.anchorEl = null;
      this.clearPendingRefresh();
      return;
    }
    if (anchorEl?.isConnected) this.anchorEl = anchorEl;

    const panel = containerEl.createDiv({
      cls: "db-filter-panel",
    });
    const header = containerEl.querySelector(".db-header") || containerEl.querySelector(".db-toolbar");
    if (header?.parentElement) {
      header.parentElement.insertBefore(panel, header.nextSibling);
    }
    this.panelEl = panel;

    this.renderHeader(panel, containerEl, state, config, actions);
    if (state.filters.length === 0) {
      panel.createDiv({
        cls: "db-panel-empty",
        text: t("panel.emptyFilters"),
      });
    } else {
      for (let i = 0; i < state.filters.length; i++) {
        this.renderFilterRow(panel, i, containerEl, state, config, actions);
      }
    }

    const addBtn = panel.createEl("button", {
      cls: "db-panel-button db-add-entry",
      text: `+ ${t("panel.addCondition")}`,
    });
    addBtn.onclick = () => {
      const first = getViewRuleColumns(config)[0];
      const operators = getFilterOperatorsForColumn(first, config.schema.computedFields);
      const op = operators.some(([value]) => value === "contains") ? "contains" : operators[0]?.[0] || "eq";
      state.filters.push({ field: first?.key || "file.name", op, value: "", comparison: "typed" });
      actions.saveState();
      this.render(containerEl, true, state, config, actions, this.anchorEl || undefined);
      actions.refresh();
    };
    positionToolbarPopover(panel, this.anchorEl || undefined);
    if (savedScroll) panel.scrollTop = savedScroll;
  }

  renderSingleRuleEditor(
    parent: HTMLElement,
    containerEl: HTMLElement,
    index: number,
    state: DatabaseViewState,
    config: ViewConfig,
    actions: FilterPanelActions
  ): void {
    closeActiveDateValuePicker(containerEl.ownerDocument);
    parent.empty();
    if (!state.filters[index]) return;
    this.renderFilterRow(parent, index, containerEl, state, config, actions, {
      compact: true,
      showRemove: false,
      rerender: () => this.renderSingleRuleEditor(parent, containerEl, index, state, config, actions),
    });
  }

  private renderHeader(
    panel: HTMLElement,
    containerEl: HTMLElement,
    state: DatabaseViewState,
    config: ViewConfig,
    actions: FilterPanelActions
  ): void {
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createSpan({ cls: "db-panel-title", text: t("toolbar.filter") });
    const right = header.createDiv({ cls: "db-panel-header-actions" });
    const logicBtn = header.createEl("button", {
      cls: "db-panel-button",
      text: state.filterLogic === "and" ? t("panel.and") : t("panel.or"),
    });
    right.appendChild(logicBtn);
    logicBtn.onclick = () => {
      state.filterLogic = state.filterLogic === "and" ? "or" : "and";
      actions.saveState();
      actions.refresh();
      this.render(containerEl, true, state, config, actions, this.anchorEl || undefined);
    };
  }

  private renderFilterRow(
    panel: HTMLElement,
    index: number,
    containerEl: HTMLElement,
    state: DatabaseViewState,
    config: ViewConfig,
    actions: FilterPanelActions,
    options?: {
      compact?: boolean;
      showRemove?: boolean;
      rerender?: () => void;
    }
  ): void {
    const rule = state.filters[index];
    if (!rule) return;
    const row = panel.createDiv({ cls: "db-panel-row" });
    if (options?.compact) row.addClass("db-active-rule-editor-row");
    const rerender = options?.rerender || (() => {
      this.render(containerEl, true, state, config, actions, this.anchorEl || undefined);
    });

    const allCols = getViewRuleColumns(config);
    const firstKey = allCols[0]?.key || "status";
    const currentField = rule.field || firstKey;
    const currentCol = allCols.find((col) => col.key === currentField) || allCols[0];
    createDropdownField({
      parent: row,
      label: t("panel.field"),
      options: allCols.map((col) => toPropertyDropdownOption(col)),
      value: currentField,
      className: "db-panel-dropdown db-filter-field-dropdown",
      hideLabel: true,
      renderIcon: renderDropdownPropertyTypeIcon,
      onChange: (value) => {
        rule.field = value;
        rule.comparison = "typed";
        const nextCol = allCols.find((col) => col.key === rule.field);
        const nextOps = getFilterOperatorsForColumn(nextCol, config.schema.computedFields);
        if (!nextOps.some(([op]) => op === rule.op)) rule.op = nextOps[0]?.[0] || "eq";
        rule.value = "";
        actions.saveState();
        rerender();
        actions.refresh();
      },
    });

    const valueColumn = currentCol
      ? { ...currentCol, type: getColumnDisplayType(currentCol, config.schema.computedFields) }
      : undefined;

    const operator = getPresentedFilterOperator(rule, currentCol, config.schema.computedFields);
    const ops = getFilterEditorOperators(currentCol, config.schema.computedFields, operator);
    createDropdownField({
      parent: row,
      label: t("panel.operator"),
      options: ops.map(([value, label]) => ({ value, text: label })),
      value: operator,
      className: "db-panel-dropdown db-filter-operator-dropdown",
      hideLabel: true,
      onChange: (value) => {
        rule.op = value as FilterRule["op"];
        rule.comparison = "typed";
        if (rule.op === "empty" || rule.op === "notempty") rule.value = "";
        actions.saveState();
        rerender();
        actions.refresh();
      },
    });

    if (operator !== "empty" && operator !== "notempty") {
      // Legacy substring/tag values remain editable as text, independent of their column type.
      const inputColumn = operator === "contains" || operator === "hasTag" ? undefined : valueColumn;
      this.renderValueInput(row, rule, inputColumn, actions);
    } else {
      row.createSpan({ text: "—", cls: "db-panel-empty-value" });
    }

    if (options?.showRemove !== false) {
      const rmBtn = row.createEl("button", { cls: "db-panel-button", text: "×" });
      rmBtn.onclick = () => {
        removeFilterRuleAt(state, index);
        actions.saveState();
        rerender();
        actions.refresh();
      };
    }
  }

  private renderValueInput(row: HTMLElement, rule: FilterRule, col: ColumnDef | undefined, actions: FilterPanelActions): void {
    if (isDateLikeColumnType(col?.type)) {
      renderDateValuePicker({
        parent: row,
        value: rule.value || "",
        placeholder: t("panel.value"),
        includeTime: col?.type === "datetime",
        className: "db-panel-date-value db-filter-value-control",
        onChange: (value) => {
          rule.value = value;
          rule.comparison = "typed";
          actions.saveState();
          actions.refresh();
        },
      });
      return;
    }
    if (col?.type === "select" || col?.type === "status") {
      createDropdownField({
        parent: row,
        label: t("panel.value"),
        options: [
          { value: "", text: t("panel.value") },
          ...getColumnOptions(col).map((option) => ({ value: option.value, text: option.value })),
        ],
        value: rule.value || "",
        className: "db-panel-dropdown db-filter-value-dropdown",
        hideLabel: true,
        onChange: (value) => {
          rule.value = value;
          rule.comparison = "typed";
          actions.saveState();
          actions.refresh();
        },
      });
      return;
    }
    // Older rules may deliberately use a different truth table. Display the
    // saved literal until the user explicitly changes the operator or value.
    if (col?.type === "checkbox" && rule.comparison !== "legacy") {
      const value = String(toBooleanValue(rule.value));
      createDropdownField({
        parent: row,
        label: t("panel.value"),
        options: [
          { value: "true", text: t("common.true") },
          { value: "false", text: t("common.false") },
        ],
        value,
        className: "db-panel-dropdown db-filter-value-dropdown",
        hideLabel: true,
        onChange: (nextValue) => {
          rule.value = nextValue;
          rule.comparison = "typed";
          actions.saveState();
          actions.refresh();
        },
      });
      return;
    }
    // A previously saved formula filter can contain a formatted numeric literal.
    // Native number inputs discard values like "$12" before any user interaction.
    const numeric = col?.type === "number" || col?.type === "currency";
    const supportsNumberInput = !rule.value || /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rule.value);
    const inp = row.createEl("input", {
      attr: {
        type: numeric && supportsNumberInput ? "number" : "text",
        placeholder: t("panel.value"),
      },
    });
    let committedValue = rule.value || "";
    let committedComparison = rule.comparison;
    let edited = false;
    inp.value = committedValue;
    inp.oninput = () => {
      edited = true;
      rule.value = inp.value;
      rule.comparison = "typed";
      this.scheduleRefresh(actions);
    };
    inp.onkeydown = (event) => {
      if (isImeComposing(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (edited) {
          this.commitDraftValue(rule, inp.value, committedValue, committedComparison, actions, (value) => {
            committedValue = value; committedComparison = rule.comparison;
          });
          edited = false;
        }
        inp.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (edited) { rule.value = committedValue; rule.comparison = committedComparison; }
        edited = false;
        inp.value = committedValue;
        this.clearPendingRefresh();
        actions.refresh();
        inp.blur();
      }
    };
    inp.onblur = () => {
      if (!edited) return;
      this.commitDraftValue(rule, inp.value, committedValue, committedComparison, actions, (value) => {
        committedValue = value; committedComparison = rule.comparison;
      });
      edited = false;
    };
  }

  private commitDraftValue(
    rule: FilterRule,
    nextValue: string,
    committedValue: string,
    committedComparison: FilterRule["comparison"],
    actions: FilterPanelActions,
    onCommitted: (value: string) => void
  ): void {
    this.clearPendingRefresh();
    if (nextValue !== committedValue) {
      rule.value = nextValue;
      rule.comparison = "typed";
      actions.saveState();
      onCommitted(nextValue);
    } else rule.comparison = committedComparison;
    actions.refresh();
  }

  private scheduleRefresh(actions: FilterPanelActions): void {
    this.clearPendingRefresh();
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      actions.refresh();
    }, 220);
  }

  private clearPendingRefresh(): void {
    if (this.refreshTimer === null) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
