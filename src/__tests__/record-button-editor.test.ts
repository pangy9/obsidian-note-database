import { setLocale } from "../i18n";
import { describe, expect, it, vi } from "vitest";
import { ButtonCardEditState, cancelButtonSorting, renderButtonCardHeading, renderButtonCardSummary } from "../views/modals/RecordButtonEditorUI";
import { renderButtonMenuIcon } from "../views/RecordButtonMenuIcons";
import { openDropdownMenu } from "../views/DropdownField";

setLocale("en");

vi.mock("obsidian", () => ({ setIcon: vi.fn(), ToggleComponent: class {} }));
vi.mock("../views/DropdownField", () => ({ openDropdownMenu: vi.fn(), closeDropdownForRoot: vi.fn(() => false) }));
vi.mock("../views/RecordButtonMenuIcons", () => ({ renderButtonMenuIcon: vi.fn() }));

// Minimal event surface: exercise the renderer's real drag and keyboard callbacks.
class ElementStub {
  text = "";
  title = "";
  attributes: Record<string, string> = {};
  setAttr(key: string, value: string): void { this.attributes[key] = value; }
  scrollIntoView(): void {}
  empty(): void { this.children = []; }
  children: ElementStub[] = [];
  parentElement: ElementStub | null = null;
  top = 0;
  height = 100;
  style = { minHeight: "" };
  querySelector(): null { return null; }
  querySelectorAll(selector: string): ElementStub[] { return this.children.flatMap(child => [...(child.hasClass(selector.slice(1)) ? [child] : []), ...child.querySelectorAll(selector)]); }
  hasClass(cls: string): boolean { return this.classes.has(cls); }
  isConnected = true;
  ownerDocument = { getSelection: vi.fn(() => ({ isCollapsed: true })), addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }, body: { createDiv: () => new ElementStub() } };
  setCssProps(): void {}
  setPointerCapture(): void {}
  hasPointerCapture(): boolean { return true; }
  releasePointerCapture(): void {}
  remove(): void {}
  classes = new Set<string>();
  classList = { add: (s: string) => this.classes.add(s), remove: (s: string) => this.classes.delete(s) };
  dataset: Record<string, string> = {};
  onclick?: () => void;
  onkeydown?: (event: unknown) => void;
  onpointerdown?: (event: unknown) => void;
  onpointermove?: (event: unknown) => void;
  onpointerup?: (event: unknown) => void;
  onpointercancel?: (event: unknown) => void;
  createEl(_tag: string, options?: { cls?: string; text?: string }): ElementStub {
    const child = new ElementStub();
    child.text = options?.text || "";
    options?.cls?.split(" ").forEach(c => child.classes.add(c));
    child.parentElement = this; this.children.push(child); return child;
  }
  createDiv(options?: { cls?: string }): ElementStub { return this.createEl("div", options); }
  createSpan(options?: { cls?: string; text?: string }): ElementStub { return this.createEl("span", options); }
  addClass(s: string): void { this.classes.add(s); }
  removeClass(s: string): void { this.classes.delete(s); }
  closest(): null { return null; }
  getBoundingClientRect() { return { top: this.top, bottom: this.top + this.height, height: this.height, left: 0, right: 200 }; }
}
const event = (clientY = 25, pointerId = 1) => ({ button: 0, pointerId, clientX: 50, clientY, preventDefault: vi.fn(), stopPropagation: vi.fn() });
function cards(items: object[], render = vi.fn()) {
  const parent = new ElementStub();
  const result = items.map((_item, index) => {
    const card = parent.createDiv(); card.top = index * 100;
    renderButtonCardHeading(card as unknown as HTMLElement, String(index), items, index, render, true);
    return { card, handle: card.children[0].children[0] };
  });
  return { result, render };
}

describe("button editor ordering", () => {
  it("shows a desktop global toggle only from three actions and handles mixed state without persisting it", () => {
    const state = new ButtonCardEditState(); const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(state.showGlobalToggle(items.slice(0, 2))).toBe(false);
    expect(state.showGlobalToggle(items)).toBe(true);
    expect(items.every(item => !state.isCollapsed(item))).toBe(true);
    state.toggleAll(items); expect(state.hasExpanded(items)).toBe(false);
    state.setCollapsed(items[1], false); expect(state.hasExpanded(items)).toBe(true);
    state.toggleAll(items); expect(state.hasExpanded(items)).toBe(false);
    state.toggleAll(items); expect(items.every(item => !state.isCollapsed(item))).toBe(true);
    state.toggleAll(items);
    const added = { id: 4 }; items.push(added); state.open(items, added);
    expect(state.isCollapsed(added)).toBe(false); expect(state.isCollapsed(items[0])).toBe(true);
    state.compact = true; expect(state.showGlobalToggle(items)).toBe(false);
    expect(JSON.stringify(items)).toBe('[{"id":1},{"id":2},{"id":3},{"id":4}]');
    expect(new ButtonCardEditState().hasExpanded(items)).toBe(true);
  });
  it("toggles by arrow or title keyboard, but ignores text selection and body clicks", () => {
    const state = new ButtonCardEditState(); const items = [{ id: 1 }]; const render = vi.fn();
    const card = new ElementStub();
    renderButtonCardHeading(card as unknown as HTMLElement, "Create", items, 0, render, true, undefined, state);
    const arrow = card.children[0].children[0];
    const title = card.children[0].children.find(child => child.hasClass("db-button-action-title"))!;
    expect(arrow.attributes["aria-expanded"]).toBe("true");
    arrow.onclick!(); expect(state.isCollapsed(items[0])).toBe(true);
    title.onkeydown!({ key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(state.isCollapsed(items[0])).toBe(false);
    card.ownerDocument.getSelection.mockReturnValue({ isCollapsed: false }); title.onclick!();
    expect(state.isCollapsed(items[0])).toBe(false);
    card.ownerDocument.getSelection.mockReturnValue({ isCollapsed: true }); title.onclick!();
    expect(state.isCollapsed(items[0])).toBe(true);
    expect(card.onclick).toBeUndefined();
  });
  it("keeps manual folding attached to its action through a drag and cancellation", () => {
    const state = new ButtonCardEditState(); const items = [{ id: 1 }, { id: 2 }];
    state.setCollapsed(items[0], true);
    const parent = new ElementStub(); const render = vi.fn();
    const cards = items.map((item, index) => {
      const card = parent.createDiv(); card.top = index * 100;
      renderButtonCardHeading(card as unknown as HTMLElement, "Edit", items, index, render, true, undefined, state);
      return card;
    });
    expect(cards[0].hasClass("is-collapsed")).toBe(true);
    const handle = cards[0].children[0].children[1];
    handle.onpointerdown!(event()); handle.onpointermove!(event(175)); handle.onpointerup!(event(175));
    expect(items.map(item => item.id)).toEqual([2, 1]);
    expect(state.isCollapsed(items[1])).toBe(true); expect(state.isCollapsed(items[0])).toBe(false);
    expect(parent.hasClass("is-sorting-actions")).toBe(false);
  });
  it("starts mobile cards closed, edits one per list, and reorders without changing values", () => {
    const editing = new ButtonCardEditState(); editing.compact = true;
    const items = [{ field: "status", value: "Done" }, { field: "due", value: "Tomorrow" }];
    const render = vi.fn();
    const card = new ElementStub();
    renderButtonCardHeading(card as unknown as HTMLElement, "Edit", items, 0, render, false, undefined, editing);
    expect(card.hasClass("is-compact-card")).toBe(true);
    expect(card.hasClass("is-editing")).toBe(false);
    expect(card.querySelectorAll(".db-button-drag-handle")).toHaveLength(0);
    const footer = card.children[1];
    footer.children[1].onclick!();
    expect(editing.isOpen(items, items[0])).toBe(true);
    footer.children[0].children[1].onclick!();
    expect(items.map(item => item.field)).toEqual(["due", "status"]);
    expect(editing.isOpen(items, items[1])).toBe(true);
    expect(items[1].value).toBe("Done");
    editing.open(items, items[0]);
    expect(editing.isOpen(items, items[1])).toBe(false);
    const replacement = { field: "count", value: "1" };
    editing.replace(items, items[0], replacement);
    expect(editing.isOpen(items, replacement)).toBe(true);
    editing.close(items); expect(editing.isOpen(items, replacement)).toBe(false);
  });
  it("limits main properties to two while retaining the full accessible summary", () => {
    const parent = new ElementStub();
    renderButtonCardSummary(parent as unknown as HTMLElement, "Create", ["Status", "Project", "Due", "Count"].map(text => ({ text, kind: "property" })));
    expect(parent.children[1].children).toHaveLength(3);
    expect(parent.children[1].children[2].text).toBe("+2");
    expect(parent.title).toBe("Create · Status · Project · Due · Count");
  });
  it.each(["escape", "pointercancel", "blur", "drop", "document-release", "mouse-release"])("compacts only the dragged sub-action list and restores its reserved height on %s", (ending) => {
    const root = new ElementStub();
    const main = root.createDiv({ cls: "db-button-action" }); main.height = 800;
    const list = main.createDiv({ cls: "db-button-property-actions" }); list.height = 600; list.style.minHeight = "12px";
    const other = root.createDiv({ cls: "db-button-action" }).createDiv({ cls: "db-button-property-actions" });
    const items = [{ field: "status" }, { field: "due" }];
    const render = vi.fn();
    const children = items.map((_, index) => {
      const card = list.createDiv({ cls: "db-button-property-action" }); card.top = index * 100;
      renderButtonCardHeading(card as unknown as HTMLElement, "Edit", items, index, render);
      return { card, handle: card.children[0].children[0] };
    });
    const handle = children[0].handle;
    handle.onpointerdown!(event()); handle.onpointermove!(event(175));
    expect(list.classes.has("is-sorting-properties")).toBe(true);
    expect(list.style.minHeight).toBe("600px");
    expect(main.style.minHeight).toBe("");
    expect(root.classes.has("is-sorting-actions")).toBe(false);
    expect(other.classes.has("is-sorting-properties")).toBe(false);
    if (ending === "escape") expect(cancelButtonSorting(root as unknown as HTMLElement)).toBe(true);
    else if (ending === "pointercancel") handle.onpointercancel!(event());
    else if (ending === "blur") {
      const call = children[0].card.ownerDocument.defaultView.addEventListener.mock.calls.find(([type]) => type === "blur")!;
      (call[1] as () => void)();
    } else if (ending === "document-release" || ending === "mouse-release") {
      const type = ending === "document-release" ? "pointerup" : "mouseup";
      const call = children[0].card.ownerDocument.addEventListener.mock.calls.find(([name]) => name === type)!;
      (call[1] as (e: unknown) => void)(event(175));
    } else handle.onpointerup!(event(175));
    expect(list.classes.has("is-sorting-properties")).toBe(false);
    expect(list.style.minHeight).toBe("12px");
    expect(children[1].card.classes.has("is-drop-after")).toBe(false);
    const committed = ["drop", "document-release", "mouse-release"].includes(ending);
    expect(items.map(item => item.field)).toEqual(committed ? ["due", "status"] : ["status", "due"]);
    expect(render).toHaveBeenCalledTimes(committed ? 1 : 0);
    expect(children[0].card.ownerDocument.removeEventListener).toHaveBeenCalledWith("pointerup", expect.any(Function), true);
  });
  it("renders setting labels as separate tags and refreshes the plain drag summary", () => {
    const parent = new ElementStub();
    renderButtonCardSummary(parent as unknown as HTMLElement, "Create", [{ kind: "target", text: "1.3.3 · Tasks", icon: "database" }, { kind: "property", text: "Status", icon: "property:status" }]);
    expect(parent.children[0].text).toBe("Create");
    expect(parent.children[1].classes.has("is-target")).toBe(true);
    expect(parent.children[2].classes.has("is-property")).toBe(true);
    expect(parent.children[1].children[0].children.at(-1)!.text).toBe("1.3.3 · Tasks");
    expect(parent.title).toBe("Create · 1.3.3 · Tasks · Status");
    expect(parent.children[2].children[0].children).toHaveLength(1);
    renderButtonCardSummary(parent as unknown as HTMLElement, "Create", [{ kind: "target", text: "Changed" }]);
    expect(parent.children).toHaveLength(2);
    expect(parent.title).toBe("Create · Changed");
  });
  it("lets the modal consume Escape while cancelling a compact drag", () => {
    const items = [{ id: 1 }, { id: 2 }]; const { result, render } = cards(items);
    const handle = result[0].handle;
    handle.onpointerdown!(event()); handle.onpointermove!(event(175));
    const list = result[0].card.parentElement!;
    expect(cancelButtonSorting(list as unknown as HTMLElement)).toBe(true);
    expect(list.classes.has("is-sorting-actions")).toBe(false);
    expect(list.style.minHeight).toBe("");
    handle.onpointerup!(event(175));
    expect(render).not.toHaveBeenCalled(); expect(items.map(x => x.id)).toEqual([1, 2]);
    expect(cancelButtonSorting(list as unknown as HTMLElement)).toBe(false);
  });
  it("consumes a host pointercancel immediately followed by Escape only once", () => {
    const items = [{ id: 1 }, { id: 2 }]; const { result } = cards(items);
    result[0].handle.onpointerdown!(event()); result[0].handle.onpointermove!(event(175));
    result[0].handle.onpointercancel!(event());
    const list = result[0].card.parentElement! as unknown as HTMLElement;
    expect(cancelButtonSorting(list)).toBe(true);
    expect(cancelButtonSorting(list)).toBe(false);
  });
  it("moves a whole action after the last card without losing its nested data", () => {
    const original = [{ kind: "create", actions: [{ value: 3 }] }, { kind: "edit" }, { kind: "open" }];
    const items = [...original]; const { result, render } = cards(items);
    result[0].handle.onpointerdown!(event());
    result[0].handle.onpointermove!(event(275));
    expect(result[0].card.parentElement!.classes.has("is-sorting-actions")).toBe(true);
    expect(result[2].card.classes.has("is-drop-after")).toBe(true);
    // Drop uses the displayed placement, even if the pointer moves before dispatch.
    result[0].handle.onpointerup!(event(10));
    expect(items).toEqual([original[1], original[2], original[0]]);
    expect(items[2]).toBe(original[0]);
    expect(render).toHaveBeenCalledOnce();
    expect(result[0].card.classes.has("is-dragging")).toBe(false);
    expect(result[0].card.parentElement!.classes.has("is-sorting-actions")).toBe(false);
    expect(result[0].card.parentElement!.style.minHeight).toBe("");
    expect(result[2].card.classes.has("is-drop-after")).toBe(false);
  });
  it("moves upward before the first card", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }]; const { result } = cards(items);
    result[2].handle.onpointerdown!(event(225)); result[2].handle.onpointermove!(event(25)); result[2].handle.onpointerup!(event(25));
    expect(items.map(x => x.id)).toEqual([3, 1, 2]);
  });
  it("ignores unrelated pointers and targets outside the same property list", () => {
    const a = [{ id: "a" }, { id: "b" }]; const b = [{ id: "c" }];
    const first = cards(a); const second = cards(b);
    const handle = first.result[0].handle;
    handle.onpointerdown!(event());
    handle.onpointermove!(event(175, 2)); handle.onpointerup!(event(175, 2));
    expect(first.render).not.toHaveBeenCalled();
    // A sibling list below this list is not eligible, even with a live drag.
    second.result[0].card.top = 300;
    handle.onpointermove!(event(325)); handle.onpointerup!(event(325));
    expect(a).toEqual([{ id: "a" }, { id: "b" }]); expect(b).toEqual([{ id: "c" }]);
    expect(first.render).not.toHaveBeenCalled(); expect(second.render).not.toHaveBeenCalled();
  });
  it("does not reorder for a click or a cancelled gesture", () => {
    const items = [{ id: 1 }, { id: 2 }]; const { result, render } = cards(items);
    const handle = result[0].handle;
    handle.onpointerdown!(event()); handle.onpointermove!(event(27)); handle.onpointerup!(event());
    handle.onpointerdown!(event()); handle.onpointermove!(event(175)); handle.onpointercancel!(event());
    handle.onpointerup!(event(175));
    expect(items.map(x => x.id)).toEqual([1, 2]); expect(render).not.toHaveBeenCalled();
    expect(result[1].card.classes.has("is-drop-after")).toBe(false);
    expect(result[0].card.parentElement!.classes.has("is-sorting-actions")).toBe(false);
  });
  it("supports keyboard movement with boundary guards", () => {
    const items = [{ id: 1 }, { id: 2 }]; const { result, render } = cards(items);
    result[0].handle.onkeydown!({ ...event(), key: "ArrowUp" });
    expect(render).not.toHaveBeenCalled();
    result[0].handle.onkeydown!({ ...event(), key: "ArrowDown" });
    expect(items.map(x => x.id)).toEqual([2, 1]); expect(render).toHaveBeenCalledOnce();
  });
  it("offers the same movement through the clickable handle for touch users", () => {
    const items = [{ id: 1 }, { id: 2 }]; const { result } = cards(items);
    result[0].handle.onclick!();
    const menu = vi.mocked(openDropdownMenu).mock.calls.at(-1)![0];
    expect(menu.options[0].disabled).toBe(true); expect(menu.options[1].disabled).toBe(false);
    menu.onChange("down"); expect(items.map(x => x.id)).toEqual([2, 1]);
  });
});
