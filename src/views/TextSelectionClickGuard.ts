/** Suppress only the pointer click completing a new text selection in this panel. */
export function suppressClickWhileTextSelected(container: HTMLElement): void {
  let gesture: { x: number; y: number; pointerId: number; anchor: Node | null; focus: Node | null; anchorOffset: number; focusOffset: number } | undefined;
  container.addEventListener("pointerdown", (event) => {
    gesture = undefined;
    if (event.button !== 0 || !event.isPrimary) return;
    const selection = container.ownerDocument.getSelection();
    gesture = {
      x: event.clientX, y: event.clientY, pointerId: event.pointerId,
      anchor: selection?.anchorNode ?? null, focus: selection?.focusNode ?? null,
      anchorOffset: selection?.anchorOffset ?? 0, focusOffset: selection?.focusOffset ?? 0,
    };
  }, true);
  container.addEventListener("pointercancel", () => { gesture = undefined; }, true);
  container.addEventListener("click", (event) => {
    const start = gesture;
    gesture = undefined;
    if (!start || event.detail === 0) return; // Keyboard and programmatic activation.
    if ("pointerId" in event && event.pointerId !== start.pointerId) return;
    const selection = container.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return;
    if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 3;
    const changed = selection.anchorNode !== start.anchor || selection.focusNode !== start.focus ||
      selection.anchorOffset !== start.anchorOffset || selection.focusOffset !== start.focusOffset;
    if (moved && changed) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);
}
