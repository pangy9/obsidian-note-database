import { isHTMLElement } from "./DomGuards";

export interface ToolbarPopoverPositionOptions {
  minWidth?: number;
  preferredWidth?: number;
  maxWidth?: number;
  margin?: number;
  gap?: number;
  align?: "left" | "center" | "right";
}

export function positionToolbarPopover(
  panel: HTMLElement,
  anchorEl?: HTMLElement,
  options: ToolbarPopoverPositionOptions = {}
): void {
  if (!anchorEl?.isConnected) return;

  const margin = options.margin ?? 12;
  const gap = options.gap ?? 6;
  const minWidth = options.minWidth ?? 160;
  const preferredWidth = options.preferredWidth ?? 520;
  const maxPreferredWidth = options.maxWidth ?? preferredWidth;
  const rawContainer = panel.closest(".note-database-container");
  const container = isHTMLElement(rawContainer) ? rawContainer : null;

  panel.addClass("db-anchored-popover");
  panel.setCssProps({
    position: container ? "absolute" : "fixed",
    right: "auto",
    bottom: "auto",
    boxSizing: "border-box",
    overflowY: "auto",
    overscrollBehavior: "contain",
  });

  const place = () => {
    if (!panel.isConnected || !anchorEl.isConnected) return;

    // 保存 popover 内部滚动位置，reposition 后恢复
    const savedPanelScroll = panel.scrollTop;

    const bounds = getVisiblePopoverBounds(container);
    const containerRect = container?.getBoundingClientRect();
    const scrollLeft = container?.scrollLeft || 0;
    const scrollTop = container?.scrollTop || 0;
    const anchorRect = anchorEl.getBoundingClientRect();
    const maxWidth = Math.max(minWidth, Math.min(maxPreferredWidth, bounds.width - margin * 2));
    const width = Math.min(preferredWidth, maxWidth);

    panel.setCssProps({
      width: `${width}px`,
      maxWidth: `${maxWidth}px`,
      maxHeight: "",
    });
    setPosition(panel, bounds.left + margin, bounds.top + margin, containerRect, scrollLeft, scrollTop);

    const panelRect = panel.getBoundingClientRect();
    const measuredWidth = Math.min(panelRect.width || width, maxWidth);
    const alignEdge = options.align ?? "right";
    const anchorLeft = alignEdge === "left"
      ? anchorRect.left
      : alignEdge === "center"
        ? anchorRect.left + anchorRect.width / 2 - measuredWidth / 2
        : anchorRect.right - measuredWidth;
    const naturalHeight = Math.max(panel.scrollHeight, panelRect.height || 0);
    const belowSpace = Math.max(0, bounds.bottom - anchorRect.bottom - gap - margin);
    const aboveSpace = Math.max(0, anchorRect.top - bounds.top - gap - margin);
    const useAbove = aboveSpace > belowSpace && belowSpace < Math.min(naturalHeight, 240);
    const availableHeight = useAbove ? aboveSpace : belowSpace;

    if (availableHeight <= 0) {
      const fallbackHeight = Math.max(0, bounds.height - margin * 2);
      setPosition(
        panel,
        clamp(anchorLeft, bounds.left + margin, bounds.right - measuredWidth - margin),
        bounds.top + margin,
        containerRect,
        scrollLeft,
        scrollTop
      );
      panel.style.maxHeight = `${fallbackHeight}px`;
      return;
    }

    const renderedHeight = Math.min(naturalHeight, availableHeight);
    const top = useAbove
      ? anchorRect.top - gap - renderedHeight
      : anchorRect.bottom + gap;
    setPosition(
      panel,
      clamp(anchorLeft, bounds.left + margin, bounds.right - measuredWidth - margin),
      clamp(top, bounds.top + margin, bounds.bottom - renderedHeight - margin),
      containerRect,
      scrollLeft,
      scrollTop
    );
    panel.style.maxHeight = `${availableHeight}px`;
    panel.scrollTop = savedPanelScroll;
  };

  place();
  window.requestAnimationFrame(place);
}

export function setPosition(
  panel: HTMLElement,
  globalLeft: number,
  globalTop: number,
  containerRect: DOMRect | undefined,
  scrollLeft: number,
  scrollTop: number
): void {
  if (!containerRect) {
    panel.setCssProps({ left: `${globalLeft}px`, top: `${globalTop}px` });
    return;
  }
  panel.setCssProps({
    left: `${globalLeft - containerRect.left + scrollLeft}px`,
    top: `${globalTop - containerRect.top + scrollTop}px`,
  });
}

export function getVisiblePopoverBounds(container: HTMLElement | null): DOMRect {
  const viewport = getVisualViewportBounds();
  const app = window.activeDocument.querySelector(".app-container") || window.activeDocument.querySelector(".workspace");
  const appRect = isHTMLElement(app) ? app.getBoundingClientRect() : viewport;
  const containerRect = container?.getBoundingClientRect() || viewport;
  const left = Math.max(viewport.left, appRect.left, containerRect.left);
  const top = Math.max(viewport.top, appRect.top, containerRect.top);
  const right = Math.min(viewport.right, appRect.right, containerRect.right);
  let bottom = Math.min(viewport.bottom, appRect.bottom, containerRect.bottom);
  // 移动端底部导航栏留空：手机 Obsidian 有固定底部 tab bar，popover 底部按钮需避让
  if (window.activeDocument.body.classList.contains("is-phone")) {
    const navbar = window.activeDocument.querySelector(".mobile-navbar");
    const navbarHeight = isHTMLElement(navbar) ? navbar.getBoundingClientRect().height : 50;
    const safeBottom = parseFloat(getComputedStyle(window.activeDocument.body).getPropertyValue("--safe-area-inset-bottom") || "0");
    bottom = Math.min(bottom, viewport.bottom - navbarHeight - safeBottom);
  }
  if (right <= left || bottom <= top) return viewport;
  return new DOMRect(left, top, right - left, bottom - top);
}

function getVisualViewportBounds(): DOMRect {
  const visual = window.visualViewport;
  if (!visual) return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  return new DOMRect(visual.offsetLeft, visual.offsetTop, visual.width, visual.height);
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

// Bulk editor popovers anchor under the selection status bar (not over the representative
// cell). Pure data-in/data-out so it can be unit-tested in Node and shared by the text/date
// editors. Prefer "below anchor" (top = anchor.bottom + gap); flip above only when below can't
// fit and above has more room. clamp keeps the result inside bounds (margin-respected); when the
// popover is taller than the visible area, clamp falls back to the top edge (stable).
export function resolveAnchoredPopoverTop(
  anchor: { top: number; bottom: number },
  bounds: { top: number; bottom: number },
  height: number,
  gap: number,
  margin: number,
): { top: number; useAbove: boolean } {
  const below = bounds.bottom - anchor.bottom - gap;
  const above = anchor.top - bounds.top - gap;
  const useAbove = above > below && below < height;
  const raw = useAbove ? anchor.top - gap - height : anchor.bottom + gap;
  return { top: clamp(raw, bounds.top + margin, bounds.bottom - height - margin), useAbove };
}
