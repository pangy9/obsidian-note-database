/** Reject retargeted clicks and the second click of a cell-edit double click. */
export function guardSelectionAction(button: HTMLElement): void {
  let pressed = false;
  button.addEventListener("pointerdown", (event) => { pressed = event.button === 0; });
  button.addEventListener("pointercancel", () => { pressed = false; });
  button.addEventListener("pointerleave", () => { pressed = false; });
  button.addEventListener("click", (event) => {
    const allowed = event.detail === 0 || (event.detail === 1 && pressed);
    pressed = false;
    if (!allowed) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}
