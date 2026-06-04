export interface PopoverAutoCloseOptions {
  panel: HTMLElement;
  anchorEl?: HTMLElement;
  close: () => void;
  delayMs?: number;
}

export function installPopoverAutoClose(options: PopoverAutoCloseOptions): () => void {
  const delayMs = options.delayMs ?? 5000;
  let lastActivity = Date.now();
  let pointerInsidePanel = false;
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
  const onWindowBlur = () => close();
  const onVisibilityChange = () => {
    if (window.activeDocument.visibilityState === "hidden") close();
  };

  const timer = window.setInterval(() => {
    if (!options.panel.isConnected) {
      cleanup();
      return;
    }
    if (!pointerInsidePanel && Date.now() - lastActivity >= delayMs) {
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
    window.removeEventListener("blur", onWindowBlur);
    window.activeDocument.removeEventListener("visibilitychange", onVisibilityChange);
  }

  return cleanup;
}
