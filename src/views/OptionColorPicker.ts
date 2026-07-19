import { OPTION_COLORS } from "../data/ColumnTypes";
import { StatusColor } from "../data/types";

const activePickers = new WeakMap<Document, () => void>();

export function openOptionColorPicker(
  anchor: HTMLElement,
  current: StatusColor,
  onSelect: (color: StatusColor) => void
): () => void {
  const doc = anchor.ownerDocument;
  const view = doc.defaultView || window;
  activePickers.get(doc)?.();

  const picker = doc.body.createDiv({ cls: "db-color-picker-popup" });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    picker.remove();
    doc.removeEventListener("mousedown", closeOnOutside, true);
    doc.removeEventListener("keydown", closeOnEscape, true);
    if (activePickers.get(doc) === close) activePickers.delete(doc);
  };
  const closeOnOutside = (event: MouseEvent) => {
    if (!picker.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  for (const color of OPTION_COLORS) {
    const swatch = picker.createSpan({
      cls: `db-color-picker-swatch db-option-color-${color}${color === current ? " is-selected" : ""}`,
      attr: { role: "button", tabindex: "0", title: color, "aria-label": color },
    });
    swatch.onclick = (event) => {
      event.stopPropagation();
      onSelect(color);
      close();
    };
    swatch.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      swatch.click();
    };
  }

  const place = () => {
    if (!picker.isConnected || !anchor.isConnected) return;
    const anchorRect = anchor.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const width = pickerRect.width || 124;
    const height = pickerRect.height || 54;
    const viewportWidth = doc.documentElement.clientWidth;
    const viewportHeight = doc.documentElement.clientHeight;
    const left = Math.min(
      Math.max(anchorRect.left, margin),
      Math.max(margin, viewportWidth - width - margin)
    );
    const belowTop = anchorRect.bottom + gap;
    const top = belowTop + height <= viewportHeight - margin
      ? belowTop
      : Math.max(margin, anchorRect.top - gap - height);
    picker.setCssProps({ left: `${left}px`, top: `${top}px` });
  };
  place();
  view.requestAnimationFrame(place);
  view.setTimeout(() => {
    if (closed) return;
    doc.addEventListener("mousedown", closeOnOutside, true);
    doc.addEventListener("keydown", closeOnEscape, true);
  }, 0);
  activePickers.set(doc, close);
  return close;
}
