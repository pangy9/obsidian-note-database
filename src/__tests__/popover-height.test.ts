import { afterEach, describe, expect, it, vi } from "vitest";
import { positionToolbarPopover } from "../views/PopoverPosition";
vi.mock("../views/DomGuards", () => ({ isHTMLElement: () => false }));
class Rect {
  constructor(public x: number, public y: number, public width: number, public height: number) {}
  get left() { return this.x; } get top() { return this.y; }
  get right() { return this.x + this.width; } get bottom() { return this.y + this.height; }
}
function position(anchorTop: number, viewportHeight: number, maxHeight?: number, placement?: "vertical" | "submenu", anchorLeft = 400) {
  vi.stubGlobal("DOMRect", Rect);
  const frames: Array<() => void> = [];
  vi.stubGlobal("window", { innerWidth: 900, innerHeight: viewportHeight,
    activeDocument: { querySelector: () => null, body: { classList: { contains: () => false } } },
    requestAnimationFrame: (cb: () => void) => frames.push(cb),
  });
  const panel = { isConnected: true, scrollTop: 17, scrollHeight: 1000, style: {} as Record<string, string>,
    closest: () => null, addClass: vi.fn(),
    setCssProps(props: Record<string, string>) { Object.assign(this.style, props); },
    getBoundingClientRect: () => new Rect(0, 0, 280, 360),
  };
  const anchor = { isConnected: true, getBoundingClientRect: () => new Rect(anchorLeft, anchorTop, 200, 30) };
  positionToolbarPopover(panel as unknown as HTMLElement, anchor as HTMLElement, { preferredWidth: 280, maxHeight, placement });
  frames.forEach(cb => cb());
  return panel;
}
afterEach(() => vi.unstubAllGlobals());
describe("popover height limits", () => {
  it("places submenus beside the menu and flips left near the viewport edge", () => {
    const right = position(100, 1000, 360, "submenu");
    expect(right.style.left).toBe("606px"); expect(right.style.top).toBe("100px");
    const left = position(800, 1000, 360, "submenu", 600);
    expect(left.style.left).toBe("314px"); expect(left.style.top).toBe("628px");
    expect(left.style.maxHeight).toBe("360px"); expect(left.scrollTop).toBe(17);
  });
  it("caps long menus below the anchor after both layout passes", () => {
    const panel = position(100, 1000, 360);
    expect(panel.style.maxHeight).toBe("360px"); expect(panel.style.top).toBe("136px");
    expect(panel.scrollTop).toBe(17);
  });
  it("positions an above-anchor menu using its capped height", () => {
    const panel = position(850, 1000, 360);
    expect(panel.style.maxHeight).toBe("360px"); expect(panel.style.top).toBe("484px");
  });
  it("fits a shorter viewport and preserves uncapped callers", () => {
    expect(position(100, 300, 360).style.maxHeight).toBe("152px");
    expect(position(100, 1000).style.maxHeight).toBe("852px");
  });
});
