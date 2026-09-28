import type { RowCreateContext, ViewConfig } from "../data/types";
import { getMoveTargetNeighbors } from "../data/MovePosition";

const contexts = new WeakMap<HTMLElement, RowCreateContext>();

/** Store the rendered occurrence, including its exact main group and subgroup. */
export function setRecordReorderContext(element: HTMLElement, context: RowCreateContext): void {
  contexts.set(element, context);
}

export function getRecordReorderContext(element: Element | null): RowCreateContext | undefined {
  for (let current = element; current; current = current.parentElement) {
    const context = contexts.get(current as HTMLElement);
    if (context) return context;
  }
  return undefined;
}

export function planRecordReorder(
  config: ViewConfig, source: RowCreateContext, target: RowCreateContext,
  movedPath: string, targetPath: string, placement: "before" | "after",
) {
  const sourceGroups = source.groups || [];
  const targetGroups = target.groups || [];
  if (sourceGroups.length !== targetGroups.length) return null;
  const updates: Array<{ field: string; fromGroupKey: string; toGroupKey: string }> = [];
  for (const group of targetGroups) {
    const from = sourceGroups.find((candidate) => candidate.field === group.field);
    if (!from) return null;
    if (from.key === group.key) continue;
    const col = config.schema.columns.find((candidate) => candidate.key === group.field);
    // Derived/file groups cannot be edited. Date buckets and relation groups
    // also need type-specific conversion rather than writing their label back.
    if (!col || col.key.startsWith("file.") ||
      !["text", "number", "currency", "select", "multi-select", "status", "checkbox"].includes(col.type)) return null;
    updates.push({ field: group.field, fromGroupKey: from.key, toGroupKey: group.key });
  }
  const neighbors = getMoveTargetNeighbors(
    (target.visibleRows || []).map((row) => row.file.path), movedPath, targetPath, placement,
  );
  return neighbors ? { ...neighbors, updates } : null;
}
