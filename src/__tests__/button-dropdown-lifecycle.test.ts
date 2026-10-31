import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDropdownForRoot, openDropdownMenu } from "../views/DropdownField";
vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../views/modals/ModalDrag", () => ({ suppressClickWhileTextSelected: vi.fn() }));
vi.mock("../views/PopoverAutoClose", () => ({ installPopoverAutoClose: () => vi.fn() }));
vi.mock("../views/PopoverPosition", () => ({ positionToolbarPopover: vi.fn() }));

class Element {
  parentElement: Element | null = null;
  isConnected = true;
  focus = vi.fn();
  constructor(public ownerDocument: Doc) {}
  createDiv(options?: { cls?: string }): Element { const el = this.createEl(); if (options?.cls?.startsWith("db-dropdown-popover ")) this.ownerDocument.panels.push(el); return el; }
  createEl(): Element { const el = new Element(this.ownerDocument); el.parentElement = this; return el; }
  createSpan(): Element { return this.createEl(); }
  closest(): null { return null; }
  contains(el: Element): boolean { return el === this || !!el.parentElement && this.contains(el.parentElement); }
  setAttr(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  remove(): void { this.ownerDocument.panels = this.ownerDocument.panels.filter(el => el !== this); this.isConnected = false; }
}
class Doc {
  panels: Element[] = [];
  createElement(): Element { return new Element(this); }
  querySelectorAll(): Element[] { return this.panels; }
  removeEventListener(): void {}
}
afterEach(() => vi.unstubAllGlobals());

describe("button modal dropdown ownership", () => {
  it("closes only the latest dropdown belonging to this modal and restores its anchor", () => {
    const doc = new Doc();
    vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("window", { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), activeDocument: doc });
    const modal = new Element(doc); const foreign = new Element(doc);
    const anchor = modal.createEl(); const other = foreign.createEl();
    const closed = vi.fn(); const otherClosed = vi.fn();
    openDropdownMenu({ anchor: anchor as unknown as HTMLElement, label: "Values", options: [{ value: "today", text: "Today" }], value: "", onChange: vi.fn(), onClose: closed });
    const closeOther = openDropdownMenu({ anchor: other as unknown as HTMLElement, label: "Other", options: [], value: "", onChange: vi.fn(), onClose: otherClosed });
    expect(closeDropdownForRoot(modal as unknown as HTMLElement)).toBe(true);
    expect(closed).toHaveBeenCalledOnce(); expect(anchor.focus).toHaveBeenCalledOnce();
    expect(otherClosed).not.toHaveBeenCalled(); expect(doc.panels).toHaveLength(1);
    expect(closeDropdownForRoot(modal as unknown as HTMLElement)).toBe(false);
    closeOther(); expect(doc.panels).toHaveLength(0);
  });
  it("cleans up flyouts without restoring focus when the modal closes", () => {
    const doc = new Doc(); vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("window", { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), activeDocument: doc });
    const modal = new Element(doc); const anchor = modal.createEl();
    openDropdownMenu({ anchor: anchor as unknown as HTMLElement, label: "Values", options: [], value: "", onChange: vi.fn() });
    expect(closeDropdownForRoot(modal as unknown as HTMLElement, false)).toBe(true);
    expect(anchor.focus).not.toHaveBeenCalled(); expect(doc.panels).toHaveLength(0);
  });
});
