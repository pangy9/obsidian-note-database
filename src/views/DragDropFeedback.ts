export type DropPlacement = "before" | "after";
export type DropAxis = "vertical" | "horizontal";

const DROP_BEFORE_CLASS = "is-drop-before";
const DROP_AFTER_CLASS = "is-drop-after";

export class DragDropFeedbackState {
  private target: HTMLElement | null = null;
  private placement: DropPlacement | null = null;

  update(target: HTMLElement, placement: DropPlacement): void {
    if (this.target === target && this.placement === placement) return;
    this.clear();
    this.target = target;
    this.placement = placement;
    target.classList.add(getPlacementClass(placement));
  }

  clear(): void {
    if (!this.target) return;
    if (this.placement) this.target.classList.remove(getPlacementClass(this.placement));
    this.target = null;
    this.placement = null;
  }

  clearTarget(target: HTMLElement): void {
    if (this.target !== target) return;
    this.clear();
  }

  getPlacement(target: HTMLElement): DropPlacement | null {
    if (this.target !== target) return null;
    return this.placement;
  }
}

export function resolveDropPlacement(target: HTMLElement, event: DragEvent, axis: DropAxis): DropPlacement {
  const rect = target.getBoundingClientRect();
  if (axis === "horizontal") {
    return event.clientX > rect.left + rect.width / 2 ? "after" : "before";
  }
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

function getPlacementClass(placement: DropPlacement): string {
  return placement === "after" ? DROP_AFTER_CLASS : DROP_BEFORE_CLASS;
}
