/**
 * Keep toolbar badges outside the button element. Some WebKit/Obsidian shells
 * clip button descendants regardless of the button's overflow rule; a sibling
 * badge positioned by this wrapper preserves the intended top-right placement.
 */
export function replaceToolbarBadge(
  button: HTMLElement,
  className: string,
  text?: string,
): void {
  const shell = ensureToolbarBadgeShell(button);
  for (const child of Array.from(shell.children)) {
    if (child.classList.contains(className)) child.remove();
  }
  if (text == null || text === "") return;
  const badge = button.ownerDocument.createElement("span");
  badge.className = className;
  badge.textContent = text;
  shell.appendChild(badge);
}

function ensureToolbarBadgeShell(button: HTMLElement): HTMLElement {
  const currentParent = button.parentElement;
  if (currentParent?.classList.contains("db-toolbar-badge-shell")) return currentParent;
  if (!currentParent) return button;

  const shell = button.ownerDocument.createElement("span");
  shell.className = "db-toolbar-badge-shell";
  currentParent.insertBefore(shell, button);
  shell.appendChild(button);
  return shell;
}
