import { getComputedStorageKey } from "./ColumnDisplay";
import { ColumnDef } from "./types";

interface FrontmatterRecord {
  frontmatter: Record<string, unknown>;
}

export interface ComputedFrontmatterCleanupOption {
  key: string;
  label: string;
  columnKey: string;
  recordCount: number;
}

export function getComputedFrontmatterCleanupOptions(columns: ColumnDef[], rows?: FrontmatterRecord[]): ComputedFrontmatterCleanupOption[] {
  const seen = new Set<string>();
  const options: ComputedFrontmatterCleanupOption[] = [];
  const shouldFilterByFrontmatter = Array.isArray(rows);
  for (const col of columns) {
    if (col.type !== "computed") continue;
    const key = getComputedStorageKey(col).trim();
    if (!key || seen.has(key)) continue;
    const recordCount = (rows ?? []).filter((row) => Object.prototype.hasOwnProperty.call(row.frontmatter, key)).length;
    if (shouldFilterByFrontmatter && recordCount === 0) continue;
    seen.add(key);
    options.push({
      key,
      label: col.label || key,
      columnKey: col.key,
      recordCount,
    });
  }
  return options;
}
