import type { ColumnDef, RecordButtonAction, RecordButtonConfig, RecordButtonOperation, RecordButtonStep } from "./types";
import { getColumnOptionValues, getInvalidObsidianTagValues, toBooleanValue, toMultiSelectValuesForKey } from "./ColumnTypes";
import { parseDateTimeParts } from "./DateTimeFormat";
import { t } from "../i18n";

/** Display-only changes preserve the workflow, label, confirmation and icon. */
export function updateRecordButtonStyle(column: ColumnDef, style: NonNullable<RecordButtonConfig["style"]>): boolean {
  if (column.type !== "button" || (column.buttonConfig?.style ?? "default") === style) return false;
  column.buttonConfig = { label: column.label, actions: [], ...column.buttonConfig, style };
  return true;
}

/** An empty icon is intentional: the picker can remove a button's icon. */
export function updateRecordButtonIcon(column: ColumnDef, icon: string | null | undefined): boolean {
  const next = icon || "";
  if (column.type !== "button" || (column.buttonConfig?.icon || "") === next) return false;
  column.buttonConfig = { label: column.label, actions: [], ...column.buttonConfig, icon: next };
  return true;
}

const writableTypes = new Set(["text", "number", "currency", "date", "datetime", "checkbox", "status", "select", "multi-select", "relation"]);
const reservedKeys = new Set(["__proto__", "prototype", "constructor", "db_view", "database"]);

export function isButtonTarget(column: ColumnDef): boolean {
  return writableTypes.has(column.type) && !column.key.startsWith("file.") && !reservedKeys.has(column.key);
}

export function buttonOperations(column: ColumnDef): RecordButtonOperation[] {
  if (!isButtonTarget(column)) return [];
  const operations: RecordButtonOperation[] = ["set", "clear"];
  if (column.type === "number" || column.type === "currency") operations.push("increment");
  if (column.type === "checkbox") operations.push("toggle");
  if (column.type === "date" || column.type === "datetime") operations.push("now");
  if (column.type === "multi-select" || column.type === "relation") operations.push("add", "remove");
  return operations;
}

function invalid(field: string): never { throw new Error(t("button.invalidAction", { field })); }

function normalizedValue(action: RecordButtonAction, column: ColumnDef): unknown {
  const value = action.value;
  if (action.operation === "increment" || column.type === "number" || column.type === "currency") {
    if (typeof value !== "number" || !Number.isFinite(value)) return invalid(column.label);
    return value;
  }
  if (column.type === "checkbox") {
    if (typeof value !== "boolean") return invalid(column.label);
    return value;
  }
  if (column.type === "relation") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !/^\[\[[^\]\n]+\]\]$/.test(item))) return invalid(column.label);
    return [...new Set(value)];
  }
  if (column.type === "multi-select") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return invalid(column.label);
    const values = [...new Set(toMultiSelectValuesForKey(column.key, value))];
    if (column.key === "tags") {
      if (getInvalidObsidianTagValues(values).length) return invalid(column.label);
    } else if (values.some((item) => !getColumnOptionValues(column).includes(item))) return invalid(column.label);
    return values;
  }
  if (typeof value !== "string") return invalid(column.label);
  if ((column.type === "status" || column.type === "select") && !getColumnOptionValues(column).includes(value)) return invalid(column.label);
  if (column.type === "date" || column.type === "datetime") {
    const pattern = column.type === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
    if (!pattern.test(value) || !parseDateTimeParts(value) || (column.type === "datetime" && (!parseDateTimeParts(value)?.time || Number(value.slice(17) || "0") > 59))) return invalid(column.label);
  }
  return value;
}

export function validateRecordButton(button: RecordButtonConfig | undefined, columns: ColumnDef[]): void {
  if (button?.steps) {
    if (!button.label.trim() || !button.steps.length || button.steps.length > 50) throw new Error(t("button.configureFirst"));
    for (const step of button.steps) {
      if (!["edit", "create", "duplicate", "variable", "open", "confirm"].includes(step.kind)) throw new Error(t("button.configureFirst"));
      if (step.kind === "edit" && step.target === "database" && !step.filters?.length && !step.allRecords) throw new Error(t("button.workflow.filterRequired"));
      if ((step.kind === "create" || step.kind === "duplicate" || (step.kind === "edit" && step.target === "database")) && !step.databaseId) throw new Error(t("button.workflow.databaseRequired"));
      if (step.kind === "variable" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(step.name)) throw new Error(t("button.workflow.invalidVariable"));
      if ((step.kind === "create" || step.kind === "duplicate") && !step.title.trim()) throw new Error(t("button.configureFirst"));
      if (step.kind === "open" && step.target === "link" && !step.link?.trim()) throw new Error(t("button.configureFirst"));
      if (step.kind === "edit" && !step.actions.length) throw new Error(t("button.configureFirst"));
      if (step.kind === "edit" && step.target === "trigger") {
        for (const action of step.actions) {
          const column = columns.find(c => c.key === action.field);
          if (!column || column.type !== action.fieldType || !buttonOperations(column).includes(action.operation)) invalid(action.field);
          if (!action.dynamic && ["set", "increment", "add", "remove"].includes(action.operation)) normalizedValue(action, column);
        }
      }
    }
    return;
  }
  if (!button || typeof button.label !== "string" || !button.label.trim() || !Array.isArray(button.actions) || !button.actions.length) {
    throw new Error(t("button.configureFirst"));
  }
  for (const action of button.actions) {
    const column = action && columns.find((candidate) => candidate.key === action.field);
    if (!column) throw new Error(t("button.missingField", { field: action?.field || "?" }));
    if (column.type !== action.fieldType || !buttonOperations(column).includes(action.operation)) invalid(column.label);
    if (["set", "increment", "add", "remove"].includes(action.operation)) normalizedValue(action, column);
  }
}

export interface RecordButtonConfigurationIssue { message: string; step?: RecordButtonStep; action?: RecordButtonAction }

/** Preserve the shared validators while attaching an editable location to their first error. */
export function findRecordButtonConfigurationIssue(button: RecordButtonConfig, columns: ColumnDef[], schemaFor: (step: RecordButtonStep, created: ColumnDef[]) => ColumnDef[]): RecordButtonConfigurationIssue | undefined {
  let step: RecordButtonStep | undefined;
  let action: RecordButtonAction | undefined;
  try {
    if (!button.steps || !button.label.trim() || !button.steps.length || button.steps.length > 50) {
      validateRecordButton(button, columns); return;
    }
    let created: ColumnDef[] = [];
    for (step of button.steps) {
      const schema = schemaFor(step, created);
      if ("actions" in step) {
        for (action of step.actions) {
          const column = schema.find(c => c.key === action!.field);
          if (!column || column.type !== action.fieldType || !isButtonTarget(column)) throw new Error(t("button.missingField", { field: action.field }));
          if (!buttonOperations(column).includes(action.operation)) invalid(column.label);
          if (!action.dynamic) validateRecordButton({ label: button.label, actions: [action] }, schema);
        }
      }
      action = undefined;
      validateRecordButton({ ...button, steps: [step] }, columns);
      if (step.kind === "create" || step.kind === "duplicate") created = schema;
    }
  } catch (error) { return { message: error instanceof Error ? error.message : String(error), step, action }; }
}

/** Evaluate sequentially against a draft, then commit the resulting patch once.
 * null means delete the key, as in the existing frontmatter/history adapters. */
export function planRecordButton(button: RecordButtonConfig, columns: ColumnDef[], frontmatter: Record<string, unknown>, now = new Date()): Record<string, unknown> {
  validateRecordButton(button, columns);
  const draft = { ...frontmatter };
  const updates: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timestamp = `${today}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  for (const action of button.actions) {
    const column = columns.find((candidate) => candidate.key === action.field)!;
    let value: unknown;
    switch (action.operation) {
      case "clear": value = null; break;
      case "now": value = column.type === "date" ? today : timestamp; break;
      case "toggle": value = !toBooleanValue(draft[column.key]); break;
      case "increment": {
        const current = draft[column.key];
        const number = current == null || current === "" ? 0 : typeof current === "number" ? current : typeof current === "string" && current.trim() ? Number(current) : NaN;
        value = number + (action.value as number);
        if (!Number.isFinite(value)) invalid(column.label);
        break;
      }
      case "add": case "remove": {
        const current = toMultiSelectValuesForKey(column.key, draft[column.key]);
        const selected = normalizedValue(action, column) as string[];
        value = action.operation === "add" ? [...new Set([...current, ...selected])] : current.filter((item) => !selected.includes(item));
        break;
      }
      default: value = normalizedValue(action, column);
    }
    updates[column.key] = value;
    if (value === null) delete draft[column.key]; else draft[column.key] = value;
  }
  return updates;
}
