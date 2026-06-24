import { ColumnDef, ComputedFieldDef, NumberDisplayStyle } from "./types";

export type ColumnDisplayType = Exclude<ColumnDef["type"], "computed">;

export function getComputedFieldForColumn(
  col: ColumnDef,
  computedFields?: ComputedFieldDef[]
): ComputedFieldDef | undefined {
  if (col.type !== "computed") return undefined;
  const key = getComputedStorageKey(col);
  return computedFields?.find((field) => field.key === key);
}

export function getColumnDisplayType(
  col: ColumnDef,
  computedFields?: ComputedFieldDef[]
): ColumnDisplayType {
  if (col.type !== "computed") return col.type;
  return getComputedFieldForColumn(col, computedFields)?.type || "text";
}

/** Number display style for a column; defaults to "plain" when unset. */
export function getNumberDisplayStyle(col: ColumnDef): NumberDisplayStyle {
  return col.numberDisplayStyle ?? "plain";
}

/** True when a column renders as a number — a plain number column, or a computed
 *  column whose formula result type is number. Used to gate the rating/progress
 *  display-style selector (currency is intentionally excluded). */
export function isNumberDisplayColumn(col: ColumnDef, computedFields?: ComputedFieldDef[]): boolean {
  return getColumnDisplayType(col, computedFields) === "number";
}

export function getComputedStorageKey(col: Pick<ColumnDef, "key" | "type" | "computedKey">): string {
  if (col.type !== "computed") return col.key;
  return normalizeComputedStorageKey(col.computedKey || col.key);
}

export function normalizeComputedStorageKey(key: string): string {
  return key.startsWith("formula.") ? key.slice("formula.".length) : key;
}
