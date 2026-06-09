import { getComputedStorageKey } from "./ColumnDisplay";
import { ColumnDef } from "./types";

export interface ComputedFrontmatterCleanupOption {
  key: string;
  label: string;
  columnKey: string;
}

export function getComputedFrontmatterCleanupOptions(columns: ColumnDef[]): ComputedFrontmatterCleanupOption[] {
  const seen = new Set<string>();
  const options: ComputedFrontmatterCleanupOption[] = [];
  for (const col of columns) {
    if (col.type !== "computed") continue;
    const key = getComputedStorageKey(col).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({
      key,
      label: col.label || key,
      columnKey: col.key,
    });
  }
  return options;
}
