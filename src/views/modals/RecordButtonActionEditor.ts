import { Notice } from "obsidian";
import type { ColumnDef, RecordButtonAction, RecordButtonValue } from "../../data/types";
import { buttonOperations, isButtonTarget } from "../../data/RecordButton";
import { getColumnOptions } from "../../data/ColumnTypes";
import { createDropdownField } from "../DropdownField";
import { toPropertyDropdownOption } from "../PropertyTypeIcon";
import { BUTTON_STEP_ICONS, getButtonOperationIcon, renderButtonMenuIcon } from "../RecordButtonMenuIcons";
import { ButtonCardEditState, buttonAdd, buttonToggle, renderButtonCardHeading, renderButtonCardSummary } from "./RecordButtonEditorUI";
import { t } from "../../i18n";
import { buttonValueToken, composeButtonValue, parseButtonText } from "../../data/RecordButtonComposition";
import { buttonTokenOptions, renderButtonComposition, type ButtonValueFields } from "./RecordButtonValueEditor";

export function buttonRow(parent: HTMLElement, label: string): HTMLElement {
  const row = parent.createDiv({ cls: "db-modal-row" });
  row.createEl("label", { cls: "db-modal-label", text: label }); return row;
}
export function buttonSelect(parent: HTMLElement, label: string, value: string, options: Array<{ value: string; text: string; icon?: string }>, onChange: (value: string) => void): void {
  createDropdownField({ parent, label, value, options, hideLabel: true, searchable: options.length > 8, className: "db-modal-dropdown", popoverClassName: "db-button-menu-popover", renderIcon: renderButtonMenuIcon, onChange });
}
export function buttonText(parent: HTMLElement, label: string, value: string, change: (value: string) => void, multiline = false): void {
  const row = buttonRow(parent, label);
  const input = multiline ? row.createEl("textarea", { cls: "db-modal-input", attr: { rows: "3", "aria-label": label } }) : row.createEl("input", { cls: "db-modal-input", attr: { type: "text", "aria-label": label } });
  input.value = value; input.oninput = () => change(input.value);
}
export function renderButtonValue(parent: HTMLElement, value: RecordButtonValue, _rerender: () => void, columns: ButtonValueFields, variables: string[], changed?: () => void): void {
  const key = buttonValueToken(value);
  const parts = key ? parseButtonText(`{{${key}}}`) : value.source === "template" ? parseButtonText(String(value.value)) : [{ kind: "text" as const, text: String(value.value ?? "") }];
  let offsetRow: HTMLElement;
  let offsetInput: HTMLInputElement;
  renderButtonComposition(parent, t("button.value"), parts, columns, variables, next => {
    const composed = composeButtonValue(next);
    value.source = composed.source; value.value = composed.value; value.offsetDays = composed.offsetDays;
    offsetRow.hidden = value.source !== "date";
    offsetInput.value = String(value.offsetDays || 0);
    changed?.();
  });
  offsetRow = buttonRow(parent, t("button.workflow.offset"));
  offsetRow.hidden = value.source !== "date";
  offsetInput = offsetRow.createEl("input", { cls: "db-modal-input", attr: { type: "number", step: "1", min: "-365000", max: "365000", "aria-label": t("button.workflow.offset") } });
  offsetInput.value = String(value.offsetDays || 0);
  offsetInput.onchange = () => {
    if (value.source !== "date" || !offsetInput.reportValidity()) return;
    value.offsetDays = Number(offsetInput.value); _rerender();
  };
}
export function newButtonAction(column: ColumnDef): RecordButtonAction {
  return { field: column.key, fieldType: column.type, operation: "set", value: column.type === "checkbox" ? true : ["number", "currency"].includes(column.type) ? 0 : ["multi-select", "relation"].includes(column.type) ? [] : getColumnOptions(column)[0]?.value || "" };
}
export function buttonActionSummary(action: RecordButtonAction, columns: ButtonValueFields, variables: string[]): string {
  const operation = t(`button.op.${action.operation}`);
  if (["now", "clear", "toggle"].includes(action.operation)) return operation;
  let value: string;
  if (action.dynamic) {
    const dynamic = action.dynamic;
    const key = buttonValueToken(dynamic);
    const parts = key ? parseButtonText(`{{${key}}}`) : parseButtonText(String(dynamic.value ?? ""));
    const options = buttonTokenOptions(columns, variables);
    value = parts.map(part => part.kind === "text" ? part.text : options.find(option => option.value === part.key)?.text || (dynamic.source === "date" ? t("button.workflow.relativeDate", { date: t(`button.workflow.${String(dynamic.value)}`), days: String(dynamic.offsetDays || 0) }) : part.key)).join("");
  } else value = typeof action.value === "boolean" ? t(action.value ? "button.checked" : "button.unchecked") : Array.isArray(action.value) ? action.value.join(", ") : String(action.value ?? "");
  return value ? `${operation} · ${value}` : operation;
}

export function renderButtonActions(parent: HTMLElement, actions: RecordButtonAction[], columns: ColumnDef[], rerender: () => void, valueColumns: ButtonValueFields, variables: string[], editing?: ButtonCardEditState): void {
  const candidates = columns.filter(isButtonTarget);
  const list = parent.createDiv({ cls: "db-button-property-actions" });
  actions.forEach((action, index) => {
    const group = list.createDiv({ cls: "db-button-property-action" });
    renderButtonCardHeading(group, t("button.editProperty"), actions, index, rerender, false, BUTTON_STEP_ICONS.edit, editing);
    const col = candidates.find(c => c.key === action.field);
    const summary = group.querySelector<HTMLElement>(".db-button-action-title")!;
    const refreshSummary = (): void => {
      renderButtonCardSummary(summary, t("button.editProperty"), [{ text: col?.label || action.field, kind: "property" }]);
      const detail = buttonActionSummary(action, valueColumns, variables);
      summary.createSpan({ cls: "db-button-property-summary-detail", text: detail });
      summary.title += ` · ${detail}`;
    };
    refreshSummary();
    const options = candidates.map(c => toPropertyDropdownOption(c));
    if (!col) options.unshift({ value: action.field, text: t("button.missingField", { field: action.field }) });
    buttonSelect(buttonRow(group, t("filter.field")), t("filter.field"), action.field, options, key => { const next = candidates.find(c => c.key === key); if (next) { const replacement = newButtonAction(next); editing?.replace(actions, action, replacement); actions[index] = replacement; rerender(); } });
    if (!col) return;
    if (col.type !== action.fieldType) group.createDiv({ cls: "db-button-error", text: t("button.typeChanged") });
    buttonSelect(buttonRow(group, t("button.operation")), t("button.operation"), action.operation, buttonOperations(col).map(op => ({ value: op, text: t(`button.op.${op}`), icon: getButtonOperationIcon(op, col.type) })), op => {
      action.operation = op as RecordButtonAction["operation"]; action.fieldType = col.type; action.value = op === "increment" ? 1 : newButtonAction(col).value; rerender();
    });
    if (["now", "clear", "toggle"].includes(action.operation)) return;
    buttonToggle(group, t("button.workflow.dynamic"), !!action.dynamic, enabled => { action.dynamic = enabled ? { source: "trigger", value: col.key } : undefined; rerender(); });
    if (action.dynamic) { renderButtonValue(group, action.dynamic, rerender, valueColumns, variables, refreshSummary); return; }
    const row = buttonRow(group, t("button.value"));
    if (["status", "select"].includes(col.type)) {
      buttonSelect(row, t("button.value"), String(action.value || ""), getColumnOptions(col).map(o => ({ value: o.value, text: o.value })), value => { action.value = value; refreshSummary(); });
    } else if (col.type === "checkbox") {
      buttonSelect(row, t("button.value"), String(action.value), [{ value: "true", text: t("button.checked") }, { value: "false", text: t("button.unchecked") }], value => { action.value = value === "true"; refreshSummary(); });
    } else if (col.type === "multi-select" && col.key !== "tags") {
      const choices = row.createDiv({ cls: "db-button-option-list" });
      for (const option of getColumnOptions(col)) {
        const label = choices.createEl("label"); const checkbox = label.createEl("input", { attr: { type: "checkbox" } }); checkbox.checked = Array.isArray(action.value) && action.value.includes(option.value); label.createSpan({ text: option.value });
        checkbox.onchange = () => { const values = new Set(Array.isArray(action.value) ? action.value : []); if (checkbox.checked) values.add(option.value); else values.delete(option.value); action.value = [...values]; refreshSummary(); };
      }
    } else {
      const type = ["number", "currency"].includes(col.type) ? "number" : col.type === "date" ? "date" : col.type === "datetime" ? "datetime-local" : "text";
      const input = row.createEl("input", { cls: "db-modal-input", attr: { type, step: "any", "aria-label": t("button.value") } }); input.value = Array.isArray(action.value) ? action.value.join(", ") : String(action.value ?? "");
      input.oninput = () => { action.value = type === "number" ? input.value === "" ? "" : Number(input.value) : col.type === "multi-select" ? input.value.split(/[,\s]+/).filter(Boolean) : col.type === "relation" ? input.value.split(/,\s*/).filter(Boolean) : input.value; refreshSummary(); };
    }
  });
  buttonAdd(parent, t("button.editProperty"), () => {
    if (!candidates.length) { new Notice(t("button.noTargets")); return; }
    const action = newButtonAction(candidates[0]); actions.push(action); editing?.open(actions, action); rerender();
  });
}
