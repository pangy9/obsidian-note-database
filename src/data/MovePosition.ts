/** Resolve the neighbors for a one-based destination within the current ordered list. */
export function getMovePositionNeighbors(
  paths: readonly string[],
  movedPath: string,
  position: number
): { previousPath?: string; nextPath?: string } | null {
  if (!paths.includes(movedPath) || !Number.isInteger(position) || position < 1 || position > paths.length) return null;
  const remaining = paths.filter((path) => path !== movedPath);
  const index = position - 1;
  return { previousPath: remaining[index - 1], nextPath: remaining[index] };
}

/** Preview immediate neighbors after moving a one-based source to a one-based destination. */
export function getMovePositionPreview<T>(
  items: readonly T[],
  current: number,
  position: number
): { previous?: T; moved: T; next?: T } | null {
  if (!Number.isInteger(current) || current < 1 || current > items.length
    || !Number.isInteger(position) || position < 1 || position > items.length) return null;
  const moved = items[current - 1];
  const remaining = items.filter((_, index) => index !== current - 1);
  const index = position - 1;
  return { previous: remaining[index - 1], moved, next: remaining[index] };
}

/** Resolve insertion around a chosen target, excluding the moving item itself. */
export function getMoveTargetNeighbors(
  paths: readonly string[],
  movedPath: string,
  targetPath: string,
  placement: "before" | "after"
): { previousPath?: string; nextPath?: string } | null {
  // The moved item may be in another group, so it need not occur in `paths`.
  if (movedPath === targetPath) return null;
  const remaining = paths.filter((path) => path !== movedPath);
  const target = remaining.indexOf(targetPath);
  if (target < 0) return null;
  const index = target + (placement === "after" ? 1 : 0);
  return { previousPath: remaining[index - 1], nextPath: remaining[index] };
}
