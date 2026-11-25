import { expect, it, vi } from "vitest";
import { openCellStatusValuePicker } from "../views/CellStatusValuePicker";
import { positionToolbarPopover } from "../views/PopoverPosition";

vi.mock("../views/PopoverPosition", () => ({ positionToolbarPopover: vi.fn() }));

class FakeDocument extends EventTarget {
  activeElement?: FakeElement;
  body = { classList: { contains: (cls: string) => cls === "is-phone" } };
  defaultView = new EventTarget();
}
type Spec = { cls?: string; text?: string; attr?: Record<string, string> };
class FakeElement {
  children: FakeElement[] = [];
  className: string;
  textContent: string;
  attrs: Record<string, string>;
  isConnected = true;
  onkeydown?: (event: KeyboardEvent) => void;
  onclick?: () => void;
  constructor(public ownerDocument: FakeDocument, public tag = "div", spec: Spec = {}) {
    this.className = spec.cls ?? ""; this.textContent = spec.text ?? ""; this.attrs = spec.attr ?? {};
  }
  createEl(tag: string, spec: Spec) {
    const child = new FakeElement(this.ownerDocument, tag, spec);
    this.children.push(child);
    return child;
  }
  createDiv(spec: Spec) { return this.createEl("div", spec); }
  createSpan(spec: Spec) { return this.createEl("span", spec); }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  focus() { this.ownerDocument.activeElement = this; }
  remove() { this.isConnected = false; }
}
function fixture() {
  const doc = new FakeDocument(), host = new FakeElement(doc), anchor = new FakeElement(doc, "button");
  const onSelect = vi.fn(), onClose = vi.fn();
  const close = openCellStatusValuePicker({
    host: host as unknown as HTMLElement, anchor: anchor as unknown as HTMLButtonElement,
    label: "Status", value: "Doing", options: [
      { value: "To do", color: "gray" }, { value: "Doing", color: "blue" }, { value: "Done", color: "green" },
    ], onSelect, onClose,
  });
  return { doc, host, anchor, close, onSelect, onClose, panel: host.children[0] };
}
it("shares cell colors, labels, and the current check mark without schema edit controls", () => {
  const { panel, doc, anchor, onSelect, onClose } = fixture();
  expect(panel.className).toBe("db-cell-option-popover db-cell-status-value-picker");
  expect(panel.attrs).toMatchObject({ role: "dialog", "aria-label": "Status" });
  expect(panel.children.map(row => row.children.map(part => part.className))).toEqual([
    ["db-option-color-dot db-option-color-gray", "db-option-label", "db-option-check"],
    ["db-option-color-dot db-option-color-blue", "db-option-label", "db-option-check"],
    ["db-option-color-dot db-option-color-green", "db-option-label", "db-option-check"],
  ]);
  expect(panel.children[1].children.map(part => part.textContent)).toEqual(["", "Doing", "✓"]);
  expect(doc.activeElement).toBe(panel.children[1]);
  expect(anchor.attrs["aria-expanded"]).toBe("true");
  panel.children[2].onclick?.();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("Done");
  expect(onClose).toHaveBeenCalledOnce();
  expect(panel.isConnected).toBe(false);
  expect(anchor.attrs["aria-expanded"]).toBe("false");
  expect(doc.activeElement).toBe(anchor);
});
it("supports keyboard focus and closes without writing when canceled", () => {
  const { panel, doc, onSelect, close, onClose } = fixture();
  const event = (key: string) => ({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as KeyboardEvent;
  panel.onkeydown?.(event("Home"));
  expect(doc.activeElement).toBe(panel.children[0]);
  panel.onkeydown?.(event("End"));
  expect(doc.activeElement).toBe(panel.children[2]);
  panel.onkeydown?.(event("Escape"));
  close();
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
});
it("uses its own document for touch dismissal and cleans up resize handlers", () => {
  const { doc, panel, anchor, onClose, onSelect } = fixture();
  const before = vi.mocked(positionToolbarPopover).mock.calls.length;
  const pointer = (path: unknown[]) => Object.assign(new Event("pointerdown"), { composedPath: () => path });
  doc.dispatchEvent(pointer([panel.children[0], panel]));
  doc.dispatchEvent(pointer([anchor]));
  expect(onClose).not.toHaveBeenCalled();
  doc.defaultView.dispatchEvent(new Event("resize"));
  expect(positionToolbarPopover).toHaveBeenCalledTimes(before + 1);
  doc.dispatchEvent(pointer([]));
  doc.dispatchEvent(pointer([]));
  doc.defaultView.dispatchEvent(new Event("resize"));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
  expect(positionToolbarPopover).toHaveBeenCalledTimes(before + 1);
});
