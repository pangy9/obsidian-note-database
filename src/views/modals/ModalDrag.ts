import { Modal, Platform, setIcon } from "obsidian";
import { isElement } from "../DomGuards";

/**
 * 让插件 Modal 可拖动（功能级优化，参照新版 Obsidian 设置面板的交互）。
 *
 * Obsidian 未公开 Modal 拖动 API（设置面板为内部实现），此处自实现：
 *   - 手柄 = contentEl 内首个 h3/h2（或 .modal-title），也可显式传入；
 *   - pointerdown（主键、非交互元素）→ setPointerCapture → pointermove
 *     累计偏移，以 transform: translate() 作用到 modalEl——不与 flex 居中
 *     布局冲突，无需改 position；pointerup/cancel 结束；
 *   - 双击手柄复位居中；拖动期间 grab 光标 + 禁止文本选择；
 *   - 移动端跳过（modal 为全屏 sheet，拖动无意义且易误触）。
 */
const DRAGGING_CLASS = "db-modal-is-dragging";

export function makeModalDraggable(modal: Modal, handleOverride?: HTMLElement | null): void {
  // 单点锚点：所有经此接线的 modal 统一打 db-modal 类，CSS 以此启用文字选择
  // （覆盖主题可能对 .modal 的禁选）。
  modal.modalEl.addClass("db-modal");
  if (Platform.isMobile) return;
  // 手柄 = 标题内嵌的小拖动柄（grip），而非标题本身——标题文字可正常拖选复制，
  // 拖动的 preventDefault 只作用于 grip。
  const title = handleOverride
    ?? modal.contentEl.querySelector<HTMLElement>("h3, h2, .modal-title")
    ?? modal.titleEl;
  if (!title) return;
  let handle = title.querySelector<HTMLElement>(":scope > .db-modal-drag-grip");
  if (!handle) {
    handle = title.ownerDocument.createElement("span");
    handle.className = "db-modal-drag-grip";
    setIcon(handle, "grip-vertical");
    title.insertBefore(handle, title.firstChild);
  }
  if (handle.dataset.dbDraggable === "true") return;
  handle.dataset.dbDraggable = "true";
  const doc = handle.ownerDocument;
  const win = doc.defaultView!;

  let baseX = 0;
  let baseY = 0;
  let activePointerId: number | null = null;

  const isInteractive = (target: EventTarget | null): boolean =>
    isElement(target) &&
    Boolean(target.closest("a, button, input, select, textarea, label, [contenteditable], [role='button']"));

  /**
   * 视口约束：手柄至少留 24px 在窗口内（顶边留 8px 即可抓住；其余边至少露出一
   * 条），否则标题被拖出后无法再抓、双击复位也点不到。窗口缩小后重新约束由
   * window resize 时对已记录的原始位置再 clamp 达成。
   */
  const VIEWPORT_MARGIN = 24;
  const clampOffset = (dx: number, dy: number): { dx: number; dy: number } => {
    const current = new DOMMatrixReadOnly(win.getComputedStyle(modal.modalEl).transform);
    const handleRect = handle.getBoundingClientRect();
    // 减去当前实际 transform，得到稳定原点；不能减去尚未应用的鼠标位移。
    const minX = VIEWPORT_MARGIN - (handleRect.right - current.m41) - baseX;
    const maxX = win.innerWidth - VIEWPORT_MARGIN - (handleRect.left - current.m41) - baseX;
    const minY = 8 - (handleRect.top - current.m42) - baseY;
    const maxY = win.innerHeight - VIEWPORT_MARGIN - (handleRect.top - current.m42) - baseY;
    return {
      dx: Math.min(Math.max(dx, minX), Math.max(minX, maxX)),
      dy: Math.min(Math.max(dy, minY), Math.max(minY, maxY)),
    };
  };

  let lastDx = 0;
  let lastDy = 0;
  let onResize: (() => void) | null = null;

  const applyOffset = (dx: number, dy: number): void => {
    const clamped = clampOffset(dx, dy);
    lastDx = clamped.dx;
    lastDy = clamped.dy;
    modal.modalEl.setCssProps({
      transform: `translate(${baseX + clamped.dx}px, ${baseY + clamped.dy}px)`,
    });
  };

  const stopTrackingResize = (): void => {
    if (!onResize) return;
    win.removeEventListener("resize", onResize);
    onResize = null;
  };

  let endDrag: (() => void) | null = null;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isInteractive(event.target)) return;
    // 只跟踪发起拖动的指针，其他指针（触摸/第二鼠标）不干扰。
    if (activePointerId !== null) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    // 以 modalEl 现有 transform 为基准累计（双击复位后从 0 重新开始）。
    const current = new DOMMatrixReadOnly(win.getComputedStyle(modal.modalEl).transform);
    baseX = current.m41;
    baseY = current.m42;
    lastDx = 0;
    lastDy = 0;
    handle.addClass(DRAGGING_CLASS);
    modal.modalEl.addClass(DRAGGING_CLASS);
    let captured = false;
    try {
      handle.setPointerCapture(event.pointerId);
      captured = true;
    } catch {
      // 捕获失败仍可拖动：统一结束路径覆盖释放场景（见 onEnd 的兜底监听）。
    }
    const startX = event.clientX;
    const startY = event.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      if (activePointerId !== moveEvent.pointerId) return;
      applyOffset(moveEvent.clientX - startX, moveEvent.clientY - startY);
    };
    // 统一结束函数：pointerup / pointercancel / lostpointercapture 全走这里；modal
    // 关闭（元素脱离文档）也经 listeners 自动回收，残留样式由 modal 销毁带走。
    const onEnd = (endEvent?: Event) => {
      if (endEvent && "pointerId" in endEvent && activePointerId !== endEvent.pointerId) return;
      const pointerId = activePointerId;
      activePointerId = null;
      endDrag = null;
      handle.removeClass(DRAGGING_CLASS);
      modal.modalEl.removeClass(DRAGGING_CLASS);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      handle.removeEventListener("lostpointercapture", onEnd);
      if (!captured) {
        // 无捕获时手柄外释放收不到事件：文档级一次性兜底。
        doc.removeEventListener("pointerup", onEnd);
        doc.removeEventListener("pointercancel", onEnd);
        doc.removeEventListener("pointermove", onMove);
      }
      win.removeEventListener("blur", onEnd);
      if (pointerId !== null && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    endDrag = () => onEnd();
    win.addEventListener("blur", onEnd);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
    handle.addEventListener("lostpointercapture", onEnd);
    if (!captured) {
        doc.addEventListener("pointerup", onEnd);
        doc.addEventListener("pointercancel", onEnd);
        doc.addEventListener("pointermove", onMove);
    }
    // 窗口缩小后重新约束已拖出的位置。
    stopTrackingResize();
    onResize = () => applyOffset(lastDx, lastDy);
    win.addEventListener("resize", onResize);
  });

  handle.addEventListener("dblclick", (event) => {
    if (isInteractive(event.target)) return;
    stopTrackingResize();
    modal.modalEl.setCssProps({ transform: "" });
  });

  // onClose 由各 Modal 自己实现；观察 DOM 移除也覆盖内容重建、更换手柄。
  let wasConnected = handle.isConnected;
  const observer = new MutationObserver(() => {
    if (handle.isConnected) { wasConnected = true; return; }
    if (!wasConnected) return;
    endDrag?.();
    stopTrackingResize();
    observer.disconnect();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
}

/**
 * 弹窗/popover 文字可复制的配套守卫：拖选结束后浏览器仍可能对选项触发 click
 * （插入内容/关闭列表）。由独立模块跟踪本次指针选择，只拦截对应的 click。
 */
export { suppressClickWhileTextSelected } from "../TextSelectionClickGuard";
