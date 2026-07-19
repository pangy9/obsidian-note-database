const dragStartedAt = new WeakMap<HTMLElement, number>();

/**
 * Drag renderers own their CSS cleanup, but a browser/window interruption can
 * occasionally swallow dragend. Never let a stale class block refresh forever.
 */
export function isRefreshBlockedByDrag(
  container: HTMLElement | null | undefined,
  now = Date.now(),
  staleAfterMs = 10_000
): boolean {
  if (!container?.querySelector(".is-dragging")) {
    if (container) dragStartedAt.delete(container);
    return false;
  }
  const startedAt = dragStartedAt.get(container) ?? now;
  dragStartedAt.set(container, startedAt);
  if (now - startedAt < staleAfterMs) return true;
  dragStartedAt.delete(container);
  return false;
}
