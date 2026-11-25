export interface PopoverAutoCloseOptions {
  panel: HTMLElement;
  anchorEl?: HTMLElement;
  close: () => void;
  delayMs?: number;
  closeOnOutsidePointerDown?: boolean;
  closeOnEscape?: boolean;
  isActiveTarget?(target: EventTarget | null): boolean;
}

export function installPopoverAutoClose(options: PopoverAutoCloseOptions): () => void {
  // Keep listeners and target checks tied to the surface's renderer, even
  // when a different Obsidian window becomes active before cleanup.
  const doc = options.panel.ownerDocument;
  const host = doc.defaultView ?? window;
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
    if (target instanceof host.Node && (
      options.panel.contains(target) ||
      options.anchorEl?.contains(target)
    )) {
      pointerInsideLinkedSurface = false;
      return;
    }
    pointerInsideLinkedSurface = false;
    if (options.closeOnOutsidePointerDown && event.type === "mousedown") close();
  };
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (options.isActiveTarget?.(event.target)) {
      onDocumentActivity(event);
      return;
    }
    if (options.closeOnEscape && event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    onDocumentActivity(event);
  };
  const onWindowBlur = () => close();
  const onVisibilityChange = () => {
    if (doc.visibilityState === "hidden") close();
  };

  const timer = host.setInterval(() => {
    if (!options.panel.isConnected) {
      cleanup();
      return;
    }
    // :hover 实时命中兜底：range 拖拽的指针捕获会让 panel 的 pointerenter/leave
    // 边界事件失真（pointerInsidePanel 不同步），导致「鼠标始终在面板内却被
    // 空闲计时关闭」。浏览器的 :hover 状态不受捕获影响，指针真在面板内就不关。
    const pointerOverPanel = pointerInsidePanel || pointerInsideLinkedSurface || options.panel.matches(":hover");
    if (!pointerOverPanel && Date.now() - lastActivity >= delayMs) {
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
  doc.addEventListener("pointermove", onDocumentActivity, true);
  doc.addEventListener("pointerover", onDocumentActivity, true);
  doc.addEventListener("mousedown", onDocumentActivity, true);
  doc.addEventListener("keydown", onDocumentKeydown, true);
  doc.addEventListener("wheel", onDocumentActivity, { passive: true, capture: true });
  host.addEventListener("blur", onWindowBlur);
  doc.addEventListener("visibilitychange", onVisibilityChange);

  function cleanup(): void {
    host.clearInterval(timer);
    options.panel.removeEventListener("pointerenter", onPanelEnter);
    options.panel.removeEventListener("pointerleave", onPanelLeave);
    options.panel.removeEventListener("pointermove", markActivity);
    options.panel.removeEventListener("mousedown", markActivity, true);
    options.panel.removeEventListener("keydown", markActivity, true);
    options.panel.removeEventListener("wheel", markActivity);
    options.anchorEl?.removeEventListener("pointermove", markActivity);
    options.anchorEl?.removeEventListener("mousedown", markActivity, true);
    doc.removeEventListener("pointermove", onDocumentActivity, true);
    doc.removeEventListener("pointerover", onDocumentActivity, true);
    doc.removeEventListener("mousedown", onDocumentActivity, true);
    doc.removeEventListener("keydown", onDocumentKeydown, true);
    doc.removeEventListener("wheel", onDocumentActivity, true);
    host.removeEventListener("blur", onWindowBlur);
    doc.removeEventListener("visibilitychange", onVisibilityChange);
  }

  return cleanup;
}
