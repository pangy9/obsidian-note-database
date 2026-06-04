import { ColumnDef, ComputedFieldDef } from "./types";

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

export function getComputedStorageKey(col: Pick<ColumnDef, "key" | "type" | "computedKey">): string {
  if (col.type !== "computed") return col.key;
  return normalizeComputedStorageKey(col.computedKey || col.key);
}

export function normalizeComputedStorageKey(key: string): string {
  return key.startsWith("formula.") ? key.slice("formula.".length) : key;
}
