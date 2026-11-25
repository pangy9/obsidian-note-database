import type { App, Component, HoverParent } from "obsidian";
import { isElement, isHTMLElement } from "./DomGuards";

export const NOTE_DATABASE_HOVER_LINK_SOURCE = "note-database";

const HOVER_LINK_SELECTOR = "[data-note-database-hover-link]";

/** Mark an element as an Obsidian-internal note link for delegated Page Preview. */
export function markNoteHoverLink(
  element: HTMLElement,
  linktext: string,
  sourcePath: string,
): void {
  element.setAttribute("data-note-database-hover-link", "true");
  element.setAttribute("data-note-database-linktext", linktext);
  element.setAttribute("data-note-database-source-path", sourcePath);
}

/**
 * Delegate internal-link hover events to Obsidian's native Page Preview plugin.
 * Modifier-key policy is intentionally owned by registerHoverLinkSource/Page Preview.
 */
export function installNoteHoverPreview(
  component: Component,
  container: HTMLElement,
  app: App,
  hoverParent: HoverParent,
  canPreview?: (target: HTMLElement) => boolean,
): void {
  component.registerDomEvent(container, "mouseover", (event: MouseEvent) => {
    if (!isElement(event.target)) return;
    const targetEl = event.target.closest(HOVER_LINK_SELECTOR);
    if (!isHTMLElement(targetEl) || !container.contains(targetEl) || canPreview?.(targetEl) === false) return;

    if (isElement(event.relatedTarget) && targetEl.contains(event.relatedTarget)) return;

    const linktext = targetEl.getAttribute("data-note-database-linktext");
    if (!linktext) return;
    app.workspace.trigger("hover-link", {
      event,
      source: NOTE_DATABASE_HOVER_LINK_SOURCE,
      hoverParent,
      targetEl,
      linktext,
      sourcePath: targetEl.getAttribute("data-note-database-source-path") || "",
    });
  });
}
