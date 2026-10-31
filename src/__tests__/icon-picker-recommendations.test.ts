import { afterEach, describe, expect, it, vi } from "vitest";
import { openIconPickerPopover } from "../views/IconPickerPopover";
import { setLocale } from "../i18n";
vi.mock("obsidian", () => ({ setIcon: vi.fn(), setTooltip: vi.fn(), Notice: class {} }));
vi.mock("../views/RecordIconRenderer", () => ({ getValidRecordIconIds: () => ["check", "plus"] }));
vi.mock("../data/IconPickerCatalog", () => ({ EMOJI_CATEGORIES: [{ id: "people", labelKey: "recordIcon.emoji", items: [{ value: "😀" }] }], LUCIDE_CATEGORY_DEFINITIONS: [{ id: "common", labelKey: "recordIcon.icons", icon: "star" }], getLucideCategoryIds: () => ["check", "plus"] }));
vi.mock("../views/PopoverPosition", () => ({ positionToolbarPopover: vi.fn() }));
vi.mock("../views/PopoverAutoClose", () => ({ installPopoverAutoClose: () => vi.fn() }));
setLocale("en");
class Element {
  children: Element[] = [];
  classes = new Set<string>();
  attrs: Record<string, string> = {};
  text = "";
  onclick?: () => void;
  listeners = new Map<string, (event: Event) => void>();
  addEventListener(type: string, listener: (event: Event) => void): void { this.listeners.set(type, listener); }
  scrollTop = 0;
  createEl(_tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }): Element {
    const child = new Element(); child.text = options?.text || ""; child.attrs = options?.attr || {};
    options?.cls?.split(" ").forEach(c => child.classes.add(c)); this.children.push(child); return child;
  }
  createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): Element { return this.createEl("div", options); }
  createSpan(options?: { cls?: string; text?: string }): Element { return this.createEl("span", options); }
  empty(): void { this.children = []; }
  addClass(value: string): void { this.classes.add(value); }
  remove(): void {}
  querySelector(selector: string): Element | null { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector: string): Element[] { return this.children.flatMap(child => [...(child.classes.has(selector.slice(1)) ? [child] : []), ...child.querySelectorAll(selector)]); }
  scrollTo(): void {}
}
function setup(container?: Element) {
  const body = new Element(); const doc = { body, querySelectorAll: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("window", { activeDocument: doc, setTimeout: vi.fn(() => 1) });
  const onSelect = vi.fn(); const onClose = vi.fn();
  const close = openIconPickerPopover({ anchor: {} as HTMLElement, container: container as unknown as HTMLElement, current: "lucide:check@orange", recommended: [{ value: "lucide:check", label: "Check" }, { value: "lucide:plus", label: "Plus" }, { value: "✅", label: "Done" }], onSelect, onClose });
  return { body, panel: (container || body).children[0], onSelect, onClose, close };
}
afterEach(() => vi.unstubAllGlobals());
describe("icon picker contextual recommendations", () => {
  it("owns a submenu picker inside its menu instead of the outside-click surface", () => {
    const menu = new Element();
    const { body, panel, onSelect, close, onClose } = setup(menu);
    expect(body.children).toHaveLength(0);
    expect(menu.children).toContain(panel);
    const event = { stopPropagation: vi.fn() };
    panel.listeners.get("click")!(event as unknown as Event);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    panel.querySelector(".db-icon-picker-recommendations")!.querySelector(".db-icon-picker-grid")!.children[0].onclick!();
    expect(onSelect).toHaveBeenCalledWith("lucide:check@orange");
    expect(onClose).not.toHaveBeenCalled();
    close(); expect(onClose).toHaveBeenCalledOnce();
  });
  it("keeps a category-style recommendation section outside scrolling pages on both tabs", () => {
    const { panel, close } = setup();
    expect(panel.children[0].classes.has("db-icon-picker-header")).toBe(true);
    expect(panel.children[1].classes.has("db-icon-picker-colors")).toBe(true);
    expect(panel.children[2].classes.has("db-icon-picker-recommendations")).toBe(true);
    expect(panel.children[3].classes.has("db-icon-picker-scroll")).toBe(true);
    const recommendations = panel.children[2];
    expect(recommendations.querySelector(".db-icon-picker-label")?.text).toBe("Suggested");
    expect(recommendations.querySelector(".db-icon-picker-grid")?.children).toHaveLength(2);
    expect(panel.querySelector(".db-icon-picker-scroll")?.querySelector(".db-icon-picker-recommendations")).toBeNull();
    panel.children[0].children[0].children[0].onclick!();
    expect(panel.children[1].classes.has("db-icon-picker-recommendations")).toBe(true);
    expect(panel.querySelectorAll(".db-icon-picker-recommendations")).toHaveLength(1);
    expect(panel.children[1].querySelector(".db-icon-picker-grid")?.children.map(child => child.attrs["aria-label"])).toEqual(["Done"]);
    close();
  });
  it("selects an emoji recommendation without applying the icon color", () => {
    const { panel, onSelect, close } = setup();
    panel.children[0].children[0].children[0].onclick!();
    panel.querySelector(".db-icon-picker-recommendations")!.querySelector(".db-icon-picker-grid")!.children[0].onclick!();
    expect(onSelect).toHaveBeenCalledWith("✅");
    close();
  });
  it("commits a recommended icon with the selected color and closes exactly once", () => {
    const { panel, onSelect, onClose, close } = setup();
    panel.querySelector(".db-icon-picker-recommendations")!.querySelector(".db-icon-picker-grid")!.children.find(child => child.attrs["aria-label"] === "Plus")!.onclick!();
    expect(onSelect).toHaveBeenCalledWith("lucide:plus@orange");
    close(); close(); expect(onClose).toHaveBeenCalledOnce();
  });
});
