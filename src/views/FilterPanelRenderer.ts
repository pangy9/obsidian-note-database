import { getColumnOptions, isObsidianTagsKey } from "../data/ColumnTypes";
import { isImeComposing } from "../data/KeyboardUtils";
import { isDateLikeColumnType } from "../data/DateTimeFormat";
import { ColumnDef, FilterRule, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { createDropdownField } from "./DropdownField";
import { positionToolbarPopover } from "./PopoverPosition";
import { renderDropdownPropertyTypeIcon, toPropertyDropdownOption } from "./PropertyTypeIcon";
import { DatabaseViewState } from "./ViewStateStore";

export interface FilterPanelActions {
  saveState(): void;
  refresh(): void;
  close(): void;
}

export function getFilterOperatorsForColumn(col?: ColumnDef): [FilterRule["op"], string][] {
  const base: [FilterRule["op"], string][] = [
    ["eq", t("filter.eq")],
    ["neq", t("filter.neq")],
  ];
  const emptyOps: [FilterRule["op"], string][] = [
    ["empty", t("filter.empty")],
    ["notempty", t("filter.notempty")],
  ];
  if (!col) return [...base, ["contains", t("filter.contains")], ...emptyOps];
  if (col.type === "number" || col.type === "currency" || isDateLikeColumnType(col.type)) {
    return [...base, ["gt", t("filter.gt")], ["gte", t("filter.gte")], ["lt", t("filter.lt")], ["lte", t("filter.lte")], ...emptyOps];
  }
  if (col.type === "select" || col.type === "status") {
    return [...base, ["gt", t("filter.gt")], ["gte", t("filter.gte")], ["lt", t("filter.lt")], ["lte", t("filter.lte")], ...emptyOps];
  }
  if (col.type === "multi-select") {
    if (col.key === "file.tags" || isObsidianTagsKey(col.key)) return [...base, ["hasTag", t("filter.hasTag")], ["contains", t("filter.contains")], ...emptyOps];
    return [...base, ["contains", t("filter.contains")], ...emptyOps];
  }
  if (col.type === "checkbox") {
    return [["notempty", t("filter.checkboxChecked")], ["empty", t("filter.checkboxUnchecked")]];
  }
  return [...base, ["contains", t("filter.contains")], ...emptyOps];
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
      cls: "db-panel-button",
      text: `+ ${t("panel.addCondition")}`,
    });
    addBtn.onclick = () => {
      const first = this.getFilterColumns(config)[0]?.key || "file.name";
      state.filters.push({ field: first, op: "contains", value: "" });
      actions.saveState();
      this.render(containerEl, true, state, config, actions, this.anchorEl || undefined);
      actions.refresh();
    };
    positionToolbarPopover(panel, this.anchorEl || undefined);
    if (savedScroll) panel.scrollTop = savedScroll;
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
    actions: FilterPanelActions
  ): void {
    const rule = state.filters[index];
    if (!rule) return;
    const row = panel.createDiv({ cls: "db-panel-row" });

    const allCols = this.getFilterColumns(config);
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
        const nextCol = allCols.find((col) => col.key === rule.field);
        const nextOps = getFilterOperatorsForColumn(nextCol);
        if (!nextOps.some(([op]) => op === rule.op)) rule.op = nextOps[0]?.[0] || "eq";
        rule.value = "";
        actions.saveState();
        this.render(containerEl, true, state, config, actions, this.anchorEl || undefined);
        actions.refresh();
      },
    });

    // Migrate legacy checkbox eq/neq filters to empty/notempty, preserving intent
    // (eq "true" → checked/notempty, eq "false" → unchecked/empty; neq inverts). Idempotent:
    // once the op is empty/notempty this no longer triggers; it persists on the next save.
    if (currentCol?.type === "checkbox" && (rule.op === "eq" || rule.op === "neq")) {
      const wantChecked = rule.op === "eq" ? rule.value === "true" : rule.value !== "true";
      rule.op = wantChecked ? "notempty" : "empty";
      rule.value = "";
    }
    const ops = getFilterOperatorsForColumn(currentCol);
    if (!ops.some(([op]) => op === rule.op)) rule.op = ops[0]?.[0] || "eq";
    createDropdownField({
      parent: row,
      label: t("panel.operator"),
      options: ops.map(([value, label]) => ({ value, text: label })),
      value: rule.op,
      className: "db-panel-dropdown db-filter-operator-dropdown",
      hideLabel: true,
      onChange: (value) => {
        rule.op = value as FilterRule["op"];
        actions.saveState();
        this.render(containerEl, true, state, config, actions, this.anchorEl || undefined);
        actions.refresh();
      },
    });

    if (rule.op !== "empty" && rule.op !== "notempty") {
      this.renderValueInput(row, rule, currentCol, actions);
    } else {
      row.createSpan({ text: "—", cls: "db-panel-empty-value" });
    }

    const rmBtn = row.createEl("button", { cls: "db-panel-button", text: "×" });
    rmBtn.onclick = () => {
      state.filters.splice(index, 1);
      actions.saveState();
      this.render(containerEl, true, state, config, actions, this.anchorEl || undefined);
      actions.refresh();
    };
  }

  private getFilterColumns(config: ViewConfig): ColumnDef[] {
    const columns = config.schema?.columns || [];
    if (columns.some((col) => col.key === "file.name")) return columns;
    return [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" }, ...columns];
  }

  private renderValueInput(row: HTMLElement, rule: FilterRule, col: ColumnDef | undefined, actions: FilterPanelActions): void {
    if (isDateLikeColumnType(col?.type)) {
      this.renderDateInput(row, rule, actions);
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
          actions.saveState();
          actions.refresh();
        },
      });
      return;
    }
    if (col?.type === "checkbox") {
      const value = rule.value === "false" ? "false" : "true";
      if (!rule.value) rule.value = value;
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
          actions.saveState();
          actions.refresh();
        },
      });
      return;
    }
    const inp = row.createEl("input", {
      attr: {
        type: col?.type === "number" || col?.type === "currency" ? "number" : "text",
        placeholder: t("panel.value"),
      },
    });
    let committedValue = rule.value || "";
    inp.value = committedValue;
    inp.oninput = () => {
      rule.value = inp.value;
      this.scheduleRefresh(actions);
    };
    inp.onkeydown = (event) => {
      if (isImeComposing(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        this.commitDraftValue(rule, inp.value, committedValue, actions, (value) => {
          committedValue = value;
        });
        inp.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        rule.value = committedValue;
        inp.value = committedValue;
        this.clearPendingRefresh();
        actions.refresh();
        inp.blur();
      }
    };
    inp.onblur = () => {
      this.commitDraftValue(rule, inp.value, committedValue, actions, (value) => {
        committedValue = value;
      });
    };
  }

  private renderDateInput(row: HTMLElement, rule: FilterRule, actions: FilterPanelActions): void {
    const wrap = row.createDiv({ cls: "db-date-segments db-filter-date-segments" });
    const yearInp = wrap.createEl("input", { cls: "db-date-seg", attr: { maxlength: "4", placeholder: "YYYY" } });
    wrap.createSpan({ cls: "db-date-sep", text: "-" });
    const monthInp = wrap.createEl("input", { cls: "db-date-seg", attr: { maxlength: "2", placeholder: "MM" } });
    wrap.createSpan({ cls: "db-date-sep", text: "-" });
    const dayInp = wrap.createEl("input", { cls: "db-date-seg", attr: { maxlength: "2", placeholder: "DD" } });
    let committedValue = String(rule.value || "").substring(0, 10);
    const setInputsFromValue = (value: string) => {
      const parts = value.split("-");
      yearInp.value = parts[0] || "";
      monthInp.value = parts[1] || "";
      dayInp.value = parts[2] || "";
    };
    setInputsFromValue(committedValue);
    const updateValue = () => {
      const y = yearInp.value.replace(/\D/g, "");
      const m = monthInp.value.replace(/\D/g, "");
      const d = dayInp.value.replace(/\D/g, "");
      yearInp.value = y;
      monthInp.value = m;
      dayInp.value = d;
      rule.value = y && m && d ? `${y}-${this.pad2(m)}-${this.pad2(d)}` : "";
      this.scheduleRefresh(actions);
    };
    const commitValue = () => {
      this.commitDraftValue(rule, String(rule.value || ""), committedValue, actions, (value) => {
        committedValue = value;
      });
    };
    const restoreValue = () => {
      rule.value = committedValue;
      setInputsFromValue(committedValue);
      this.clearPendingRefresh();
      actions.refresh();
    };
    const keyHandler = (event: KeyboardEvent, input: HTMLInputElement, prev?: HTMLInputElement) => {
      if (isImeComposing(event)) return;
      if (event.key === "Backspace" && input.value === "" && prev) {
        event.preventDefault();
        prev.focus();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commitValue();
        input.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        restoreValue();
        input.blur();
        return;
      }
      if (["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      if (!/^\d$/.test(event.key)) event.preventDefault();
    };
    yearInp.onkeydown = (event) => keyHandler(event, yearInp);
    monthInp.onkeydown = (event) => keyHandler(event, monthInp, yearInp);
    dayInp.onkeydown = (event) => keyHandler(event, dayInp, monthInp);
    yearInp.oninput = () => {
      updateValue();
      if (yearInp.value.length === 4) monthInp.focus();
    };
    monthInp.oninput = () => {
      monthInp.value = monthInp.value.replace(/\D/g, "");
      if (monthInp.value.length === 1 && /^[2-9]$/.test(monthInp.value)) monthInp.value = `0${monthInp.value}`;
      updateValue();
      if (monthInp.value.length >= 2) dayInp.focus();
    };
    dayInp.oninput = () => {
      dayInp.value = dayInp.value.replace(/\D/g, "");
      if (dayInp.value.length === 1 && /^[4-9]$/.test(dayInp.value)) dayInp.value = `0${dayInp.value}`;
      updateValue();
    };
    wrap.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && wrap.contains(next)) return;
      commitValue();
    });
  }

  private commitDraftValue(
    rule: FilterRule,
    nextValue: string,
    committedValue: string,
    actions: FilterPanelActions,
    onCommitted: (value: string) => void
  ): void {
    this.clearPendingRefresh();
    rule.value = nextValue;
    if (nextValue !== committedValue) {
      actions.saveState();
      onCommitted(nextValue);
    }
    actions.refresh();
  }

  private pad2(value: string): string {
    return value.length === 1 ? `0${value}` : value;
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
