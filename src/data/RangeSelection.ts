export interface RangeSelectionOptions {
  orderedIds: readonly string[];
  selectedIds: Set<string>;
  anchorId: string | null | undefined;
  targetId: string;
  selected: boolean;
  range?: boolean;
}

export function applyRangeSelection(options: RangeSelectionOptions): string | null {
  const ids = getSelectionTargetIds(options.orderedIds, options.anchorId, options.targetId, Boolean(options.range));
  setIdsSelected(ids, options.selectedIds, options.selected);
  return options.selectedIds.size > 0 ? options.targetId : null;
}

export function selectAll(orderedIds: readonly string[], selectedIds: Set<string>): void {
  selectedIds.clear();
  setIdsSelected(orderedIds, selectedIds, true);
}

export function clearSelection(orderedIds: readonly string[], selectedIds: Set<string>): void {
  setIdsSelected(orderedIds, selectedIds, false);
}

export function invertSelection(orderedIds: readonly string[], selectedIds: Set<string>): void {
  for (const id of orderedIds) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
  }
}

function getSelectionTargetIds(
  orderedIds: readonly string[],
  anchorId: string | null | undefined,
  targetId: string,
  range: boolean
): readonly string[] {
  if (!range || !anchorId || anchorId === targetId) return [targetId];
  const anchorIndex = orderedIds.indexOf(anchorId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return orderedIds.slice(start, end + 1);
}

function setIdsSelected(ids: readonly string[], selectedIds: Set<string>, selected: boolean): void {
  for (const id of ids) {
    if (selected) selectedIds.add(id);
    else selectedIds.delete(id);
  }
}
