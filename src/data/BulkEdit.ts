import {
  normalizeOptionValueForKey,
  getInvalidObsidianTagInputValues,
  toMultiSelectValuesForKey,
  toValidObsidianTagInputValues,
} from "./ColumnTypes";
import { OptionRegistrationPlan, planOptionRegistration } from "./OptionRegistration";
import { ColumnDef } from "./types";
import { stringifyValue } from "./Stringify";

export type BulkEditMode = "replace" | "add" | "remove" | "clear";

export interface BulkEditTarget {
  path: string;
  oldValue: unknown;
  oldExists?: boolean;
}

export interface BulkEditValueChange {
  path: string;
  oldValue: unknown;
  oldExists: boolean;
  newValue: unknown;
}

export interface BulkEditPlan {
  column: ColumnDef;
  mode: BulkEditMode;
  normalizedValue: unknown;
  changes: BulkEditValueChange[];
  skippedNoops: number;
  optionPlan?: OptionRegistrationPlan;
}

export type BulkEditConfirmationReason =
  | "clear"
  | "remove"
  | "moves-group"
  | "leaves-view"
  | "leaves-database"
  | "large";

export interface BulkEditImpact {
  changed: number;
  noops: number;
  missingPaths: string[];
  leavesDatabasePaths: string[];
  leavesCurrentViewPaths: string[];
  movesGroupPaths: string[];
  requiresConfirmation: boolean;
  confirmationReasons: BulkEditConfirmationReason[];
}

export interface BulkEditImpactInput {
  missingPaths?: string[];
  databasePathsAfter: Set<string>;
  viewPathsAfter: Set<string>;
  isGroupingField?: boolean;
  largeThreshold?: number;
}

export function buildBulkEditImpact(plan: BulkEditPlan, input: BulkEditImpactInput): BulkEditImpact {
  const changedPaths = plan.changes.map((change) => change.path);
  const missing = new Set(input.missingPaths || []);
  const effectivePaths = changedPaths.filter((path) => !missing.has(path));
  const leavesDatabasePaths = effectivePaths.filter((path) => !input.databasePathsAfter.has(path));
  const leavesCurrentViewPaths = effectivePaths.filter((path) => !input.viewPathsAfter.has(path));
  const movesGroupPaths = input.isGroupingField ? [...effectivePaths] : [];
  const confirmationReasons: BulkEditConfirmationReason[] = [];
  if (plan.mode === "clear") confirmationReasons.push("clear");
  if (plan.mode === "remove") confirmationReasons.push("remove");
  if (movesGroupPaths.length > 0) confirmationReasons.push("moves-group");
  if (leavesCurrentViewPaths.length > 0) confirmationReasons.push("leaves-view");
  if (leavesDatabasePaths.length > 0) confirmationReasons.push("leaves-database");
  if (effectivePaths.length >= (input.largeThreshold ?? 20)) confirmationReasons.push("large");
  return {
    changed: effectivePaths.length,
    noops: plan.skippedNoops,
    missingPaths: Array.from(missing),
    leavesDatabasePaths,
    leavesCurrentViewPaths,
    movesGroupPaths,
    requiresConfirmation: confirmationReasons.length > 0,
    confirmationReasons,
  };
}

export function getBulkEditableColumns(columns: ColumnDef[]): ColumnDef[] {
  return columns.filter((column) => {
    if (column.type === "computed" || column.type === "rollup" || column.key === "file.name") return false;
    if (!column.key.startsWith("file.")) return true;
    return column.key === "file.tags";
  });
}

export interface BulkEditInitialValue {
  mixed: boolean;
  value: unknown;
}

export interface BulkEditorRequest {
  columnKey: string;
  mode: "replace" | "clear";
  value: unknown;
}

// Resolves the initial editor state across several selected records: a normalized common
// value when every target agrees, or an empty mixed state (with a type-correct fallback)
// when they differ. Reuses the module's existing normalization/equality helpers so the
// definition of "equal" stays identical to buildBulkEditPlan's no-op detection.
export function resolveBulkEditInitialValue(column: ColumnDef, values: unknown[]): BulkEditInitialValue {
  const normalized = values.map((value) => normalizeComparable(column, value));
  const fallback = column.type === "multi-select" || column.key === "file.tags" || column.key === "tags" ? [] : "";
  if (normalized.length === 0) return { mixed: false, value: fallback };
  const first = cloneValue(normalized[0]);
  return normalized.every((value) => valuesEqual(first, value))
    ? { mixed: false, value: first }
    : { mixed: true, value: fallback };
}

// Native CellRenderer editors only emit a final value; map empty commits (cleared text,
// emptied multi-select) onto the existing "clear" mode so impact prediction/confirmation
// semantics are reused without a separate bulk UI.
export function resolveBulkEditorRequest(column: ColumnDef, value: unknown): BulkEditorRequest {
  const listEmpty = Array.isArray(value) && value.length === 0;
  const scalarEmpty = value == null || value === "";
  return listEmpty || scalarEmpty
    ? { columnKey: column.key, mode: "clear", value: null }
    : { columnKey: column.key, mode: "replace", value };
}

/** A blank mixed date represents an explicit bulk clear, unlike an unchanged common blank date. */
export function shouldCommitEmptyBulkDateClear(mixed: boolean, currentValue: unknown): boolean {
  return mixed || stringifyValue(currentValue).substring(0, 10).length > 0;
}

export function buildBulkEditPlan(
  column: ColumnDef,
  mode: BulkEditMode,
  value: unknown,
  targets: BulkEditTarget[]
): BulkEditPlan {
  if (!getBulkEditableColumns([column]).length) throw new Error("Column is not bulk editable");
  const isList = column.type === "multi-select" || column.key === "file.tags" || column.key === "tags";
  if ((mode === "add" || mode === "remove") && !isList) {
    throw new Error(`Unsupported bulk edit mode for ${column.type}`);
  }
  const normalizedValue = mode === "clear" ? null : normalizeBulkValue(column, value);
  if (mode !== "clear") {
    if ((column.type === "select" || column.type === "status") && normalizedValue === "") {
      throw new Error("A value is required");
    }
    if (isList && (normalizedValue as string[]).length === 0) {
      throw new Error("At least one value is required");
    }
  }
  const editValues = isList && mode !== "clear" ? normalizedValue as string[] : [];
  const changes: BulkEditValueChange[] = [];
  let skippedNoops = 0;

  for (const target of targets) {
    const oldExists = target.oldExists ?? true;
    const oldValue = cloneValue(target.oldValue);
    let newValue: unknown;
    if (mode === "clear") {
      newValue = null;
    } else if (isList) {
      const current = toMultiSelectValuesForKey(column.key === "file.tags" ? "tags" : column.key, oldValue);
      if (mode === "replace") newValue = [...editValues];
      else if (mode === "add") newValue = appendUnique(current, editValues);
      else newValue = current.filter((item) => !editValues.includes(item));
    } else {
      newValue = cloneValue(normalizedValue);
    }

    const noChange = mode === "clear"
      ? !oldExists
      : valuesEqual(normalizeComparable(column, oldValue), newValue);
    if (noChange) {
      skippedNoops += 1;
      continue;
    }
    changes.push({ path: target.path, oldValue, oldExists, newValue });
  }

  const optionPlan = mode === "replace" || mode === "add"
    ? planOptionRegistration(column, normalizedValue)
    : undefined;
  return {
    column,
    mode,
    normalizedValue,
    changes,
    skippedNoops,
    optionPlan: optionPlan?.participates && optionPlan.addedOptions.length > 0 ? optionPlan : undefined,
  };
}

function normalizeBulkValue(column: ColumnDef, value: unknown): unknown {
  if (column.key === "file.tags" || column.key === "tags") {
    const invalid = getInvalidObsidianTagInputValues(value);
    if (invalid.length) throw new Error(`Invalid tag: ${invalid[0]}`);
    return toValidObsidianTagInputValues(value);
  }
  if (column.type === "multi-select") {
    return unique(toMultiSelectValuesForKey(column.key === "file.tags" ? "tags" : column.key, value));
  }
  if (column.type === "select" || column.type === "status") {
    return normalizeOptionValueForKey(column.key, value);
  }
  if (column.type === "number" || column.type === "currency") {
    const number = typeof value === "number" ? value : Number(stringifyValue(value).trim());
    if (!Number.isFinite(number)) throw new Error("Invalid number");
    return number;
  }
  if (column.type === "checkbox") {
    if (typeof value !== "boolean") throw new Error("Invalid checkbox value");
    return value;
  }
  if (column.type === "date") return normalizeDate(value, false);
  if (column.type === "datetime") return normalizeDate(value, true);
  return value == null ? "" : stringifyValue(value);
}

function normalizeDate(value: unknown, includeTime: boolean): string {
  const text = stringifyValue(value ?? "").trim().replace(" ", "T");
  const pattern = includeTime ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(text)) throw new Error("Invalid date");
  const [dateKey, timeKey = "00:00"] = text.split("T");
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeKey.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Error("Invalid date");
  }
  return text;
}

function normalizeComparable(column: ColumnDef, value: unknown): unknown {
  if (column.key === "file.tags" || column.key === "tags" || column.type === "multi-select") {
    return unique(toMultiSelectValuesForKey(column.key === "file.tags" ? "tags" : column.key, value));
  }
  if (column.type === "select" || column.type === "status") {
    return normalizeOptionValueForKey(column.key, value);
  }
  return value;
}

function appendUnique(current: string[], additions: string[]): string[] {
  const next = [...current];
  for (const value of additions) if (!next.includes(value)) next.push(value);
  return next;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return (value as unknown[]).map((item) => item);
  if (value && typeof value === "object") return JSON.parse(JSON.stringify(value));
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right) || (left && typeof left === "object") || (right && typeof right === "object")) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }
  return (left ?? null) === (right ?? null);
}
