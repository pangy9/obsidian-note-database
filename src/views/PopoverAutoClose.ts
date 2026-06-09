export interface PopoverAutoCloseOptions {
  panel: HTMLElement;
  anchorEl?: HTMLElement;
  close: () => void;
  delayMs?: number;
  isActiveTarget?(target: EventTarget | null): boolean;
}

export function installPopoverAutoClose(options: PopoverAutoCloseOptions): () => void {
  const delayMs = options.delayMs ?? 5000;
  let lastActivity = Date.now();
  let pointerInsidePanel = false;
  let pointerInsideLinkedSurface = false;
  let closed = false;

  const markActivity = () => {
    lastActivity = Date.now();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    cleanup();
    options.close();
  };

  const onPanelEnter = () => {
    pointerInsidePanel = true;
    markActivity();
  };
  const onPanelLeave = () => {
    pointerInsidePanel = false;
    markActivity();
  };
  const onDocumentActivity = (event: Event) => {
    if (options.isActiveTarget?.(event.target)) {
      pointerInsideLinkedSurface = true;
      markActivity();
      return;
    }
    const target = event.target;
    if (target instanceof Node && (
      options.panel.contains(target) ||
      options.anchorEl?.contains(target)
    )) {
      pointerInsideLinkedSurface = false;
      return;
    }
    pointerInsideLinkedSurface = false;
  };
  const onWindowBlur = () => close();
  const onVisibilityChange = () => {
    if (window.activeDocument.visibilityState === "hidden") close();
  };

  const timer = window.setInterval(() => {
    if (!options.panel.isConnected) {
      cleanup();
      return;
    }
    if (!pointerInsidePanel && !pointerInsideLinkedSurface && Date.now() - lastActivity >= delayMs) {
      close();
    }
  }, 500);

  options.panel.addEventListener("pointerenter", onPanelEnter);
  options.panel.addEventListener("pointerleave", onPanelLeave);
  options.panel.addEventListener("pointermove", markActivity);
  options.panel.addEventListener("mousedown", markActivity, true);
  options.panel.addEventListener("keydown", markActivity, true);
  options.panel.addEventListener("wheel", markActivity, { passive: true });
  options.anchorEl?.addEventListener("pointermove", markActivity);
  options.anchorEl?.addEventListener("mousedown", markActivity, true);
  window.activeDocument.addEventListener("pointermove", onDocumentActivity, true);
  window.activeDocument.addEventListener("pointerover", onDocumentActivity, true);
  window.activeDocument.addEventListener("mousedown", onDocumentActivity, true);
  window.activeDocument.addEventListener("keydown", onDocumentActivity, true);
  window.activeDocument.addEventListener("wheel", onDocumentActivity, { passive: true, capture: true });
  window.addEventListener("blur", onWindowBlur);
  window.activeDocument.addEventListener("visibilitychange", onVisibilityChange);

  function cleanup(): void {
    window.clearInterval(timer);
    options.panel.removeEventListener("pointerenter", onPanelEnter);
    options.panel.removeEventListener("pointerleave", onPanelLeave);
    options.panel.removeEventListener("pointermove", markActivity);
    options.panel.removeEventListener("mousedown", markActivity, true);
    options.panel.removeEventListener("keydown", markActivity, true);
    options.panel.removeEventListener("wheel", markActivity);
    options.anchorEl?.removeEventListener("pointermove", markActivity);
    options.anchorEl?.removeEventListener("mousedown", markActivity, true);
    window.activeDocument.removeEventListener("pointermove", onDocumentActivity, true);
    window.activeDocument.removeEventListener("pointerover", onDocumentActivity, true);
    window.activeDocument.removeEventListener("mousedown", onDocumentActivity, true);
    window.activeDocument.removeEventListener("keydown", onDocumentActivity, true);
    window.activeDocument.removeEventListener("wheel", onDocumentActivity, true);
    window.removeEventListener("blur", onWindowBlur);
    window.activeDocument.removeEventListener("visibilitychange", onVisibilityChange);
  }

  return cleanup;
}
