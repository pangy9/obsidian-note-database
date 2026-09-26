import type { ColumnDef } from "./types";
import { toBooleanValue, toMultiSelectValuesForKey } from "./ColumnTypes";
import { isEmptyGroupId, moveMultiSelectGroupValue } from "./MultiSelect";

/** Preserve the other memberships when dragging out of one multi-select group. */
export function planEmbeddedGroupWrite(col: ColumnDef, current: unknown, from: string | undefined, to: string): { key: string; value: unknown } | null {
  if (!canEditEmbeddedColumn(col) || col.type === "computed" || col.type === "rollup" ||
      (col.key.startsWith("file.") && col.key !== "file.tags")) return null;
  return {
    key: col.key === "file.tags" ? "tags" : col.key,
    value: col.type === "multi-select"
      ? moveMultiSelectGroupValue(toMultiSelectValuesForKey(col.key, current), from, to, col.statusOptions)
      : isEmptyGroupId(to) ? null : col.type === "checkbox" ? toBooleanValue(to)
      : col.type === "number" || col.type === "currency" ? Number(to) : to,
  };
}

/** Field types that use the shared CellRenderer editor in editable embeds. */
export function canEditEmbeddedColumn(col: Pick<ColumnDef, "type" | "key">): boolean {
  if (col.key.startsWith("file.")) return col.key === "file.tags" || col.key === "file.name";
  return col.type === "text" || col.type === "number" || col.type === "currency" ||
    col.type === "date" || col.type === "datetime" || col.type === "checkbox" ||
    col.type === "select" || col.type === "status" || col.type === "multi-select" ||
    col.type === "relation" || col.type === "computed" || col.type === "rollup";
}
