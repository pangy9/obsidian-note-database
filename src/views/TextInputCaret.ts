/** Measure text rather than estimating Chinese/emoji widths in ch units. */
export function getTextInputContentWidth(input: HTMLInputElement | HTMLTextAreaElement): number {
  const doc = input.ownerDocument;
  const style = doc.defaultView!.getComputedStyle(input);
  const mirror = doc.createElement("span");
  mirror.setCssProps({ position: "fixed", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre", width: "max-content" });
  for (const prop of ["font-family", "font-size", "font-weight", "font-style", "letter-spacing", "tab-size"]) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop));
  }
  mirror.textContent = input.value;
  doc.body.appendChild(mirror);
  try { return Math.ceil(mirror.getBoundingClientRect().width); }
  finally { mirror.remove(); }
}

/** Measure an input caret with the same mirror-layout technique as the formula editor. */
export function getTextInputCaretRect(input: HTMLInputElement | HTMLTextAreaElement): DOMRect {
  const doc = input.ownerDocument;
  const style = doc.defaultView!.getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  const mirror = doc.createElement("div");
  mirror.setCssProps({ position: "fixed", visibility: "hidden", pointerEvents: "none", left: "0", top: "0", width: `${rect.width}px`, overflow: "hidden" });
  for (const prop of ["font-family", "font-size", "font-weight", "font-style", "letter-spacing", "line-height", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-style", "box-sizing", "tab-size", "word-break", "overflow-wrap"]) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop));
  }
  mirror.setCssProps({ whiteSpace: input.tagName === "TEXTAREA" ? "pre-wrap" : "pre" });
  mirror.textContent = input.value.slice(0, input.selectionStart ?? input.value.length);
  const marker = doc.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker); doc.body.appendChild(mirror);
  try {
    const caret = marker.getBoundingClientRect();
    const origin = mirror.getBoundingClientRect();
    const height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
    return new DOMRect(
      Math.max(rect.left, Math.min(rect.right - 1, rect.left + caret.left - origin.left - input.scrollLeft)),
      Math.max(rect.top, Math.min(rect.bottom - height, rect.top + caret.top - origin.top - input.scrollTop)),
      1, height,
    );
  } finally { mirror.remove(); }
}
