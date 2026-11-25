import { expect, it, vi } from "vitest";
import { installPopoverAutoClose } from "../views/PopoverAutoClose";

function documentFixture() {
  const handlers = new Map<string, (event: Event) => void>();
  return {
    handlers,
    addEventListener: (type: string, handler: (event: Event) => void) => handlers.set(type, handler),
    removeEventListener: (type: string, handler: (event: Event) => void) => {
      if (handlers.get(type) === handler) handlers.delete(type);
    },
  };
}
function fixture() {
  class MainNode {}
  class PopupNode {
    isConnected = true;
    matches() { return false; }
    contains(node: unknown) { return node === this; }
    addEventListener() {}
    removeEventListener() {}
  }
  const popup = documentFixture();
  const main = documentFixture();
  const win = {
    activeDocument: popup,
    setInterval: () => 1, clearInterval: () => {},
    addEventListener() {}, removeEventListener() {},
  };
  const popupWindow = {
    ...win,
    Node: PopupNode,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.assign(popup, { defaultView: popupWindow });
  const trigger = new PopupNode();
  const panel = Object.assign(new PopupNode(), { ownerDocument: popup });
  vi.stubGlobal("Node", MainNode);
  vi.stubGlobal("window", win);
  const close = vi.fn();
  const cleanup = installPopoverAutoClose({
    panel: panel as unknown as HTMLElement,
    anchorEl: trigger as unknown as HTMLElement,
    close, closeOnOutsidePointerDown: true,
    isActiveTarget: target => target instanceof PopupNode && panel.contains(target),
  });
  return { popup, main, win, popupWindow, trigger, close, cleanup };
}
it("does not auto-commit on the date picker's own trigger in a detached window", () => {
  const { popup, trigger, close, cleanup } = fixture();
  try {
    popup.handlers.get("mousedown")?.({ type: "mousedown", target: trigger } as unknown as Event);
    expect(close).not.toHaveBeenCalled();
  } finally { cleanup(); vi.unstubAllGlobals(); }
});
it("removes the date picker listeners from their originating popup after window activation changes", () => {
  const { popup, main, win, popupWindow, cleanup } = fixture();
  try {
    win.activeDocument = main;
    cleanup();
    expect(popup.handlers.size).toBe(0);
    expect(popupWindow.removeEventListener).toHaveBeenCalledWith("blur", expect.any(Function));
  } finally { vi.unstubAllGlobals(); }
});
