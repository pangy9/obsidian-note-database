export function positionToolbarPopover(panel: HTMLElement, anchorEl?: HTMLElement): void {
  if (!anchorEl?.isConnected) return;

  const margin = 12;
  const gap = 6;
  const container = panel.closest(".note-database-container") as HTMLElement | null;

  panel.addClass("db-anchored-popover");
  panel.style.position = container ? "absolute" : "fixed";
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.boxSizing = "border-box";
  panel.style.overflowY = "auto";
  panel.style.overscrollBehavior = "contain";

  const place = () => {
    if (!panel.isConnected || !anchorEl.isConnected) return;

    const bounds = getVisiblePopoverBounds(container);
    const containerRect = container?.getBoundingClientRect();
    const scrollLeft = container?.scrollLeft || 0;
    const scrollTop = container?.scrollTop || 0;
    const anchorRect = anchorEl.getBoundingClientRect();
    const maxWidth = Math.max(160, bounds.width - margin * 2);
    const width = Math.min(520, maxWidth);

    panel.style.width = `${width}px`;
    panel.style.maxWidth = `${maxWidth}px`;
    panel.style.maxHeight = "";
    setPosition(panel, bounds.left + margin, bounds.top + margin, containerRect, scrollLeft, scrollTop);

    const panelRect = panel.getBoundingClientRect();
    const measuredWidth = Math.min(panelRect.width || width, maxWidth);
    const naturalHeight = Math.max(panel.scrollHeight, panelRect.height || 0);
    const belowSpace = Math.max(0, bounds.bottom - anchorRect.bottom - gap - margin);
    const aboveSpace = Math.max(0, anchorRect.top - bounds.top - gap - margin);
    const useAbove = aboveSpace > belowSpace && belowSpace < Math.min(naturalHeight, 240);
    const availableHeight = useAbove ? aboveSpace : belowSpace;

    if (availableHeight <= 0) {
      const fallbackHeight = Math.max(0, bounds.height - margin * 2);
      setPosition(
        panel,
        clamp(anchorRect.right - measuredWidth, bounds.left + margin, bounds.right - measuredWidth - margin),
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
      clamp(anchorRect.right - measuredWidth, bounds.left + margin, bounds.right - measuredWidth - margin),
      clamp(top, bounds.top + margin, bounds.bottom - renderedHeight - margin),
      containerRect,
      scrollLeft,
      scrollTop
    );
    panel.style.maxHeight = `${availableHeight}px`;
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
    panel.style.left = `${globalLeft}px`;
    panel.style.top = `${globalTop}px`;
    return;
  }
  panel.style.left = `${globalLeft - containerRect.left + scrollLeft}px`;
  panel.style.top = `${globalTop - containerRect.top + scrollTop}px`;
}

export function getVisiblePopoverBounds(container: HTMLElement | null): DOMRect {
  const viewport = getVisualViewportBounds();
  const app = document.querySelector(".app-container") || document.querySelector(".workspace");
  const appRect = app instanceof HTMLElement ? app.getBoundingClientRect() : viewport;
  const containerRect = container?.getBoundingClientRect() || viewport;
  const left = Math.max(viewport.left, appRect.left, containerRect.left);
  const top = Math.max(viewport.top, appRect.top, containerRect.top);
  const right = Math.min(viewport.right, appRect.right, containerRect.right);
  let bottom = Math.min(viewport.bottom, appRect.bottom, containerRect.bottom);
  // 移动端底部导航栏留空：手机 Obsidian 有固定底部 tab bar，popover 底部按钮需避让
  if (document.body.classList.contains("is-phone")) {
    const navbar = document.querySelector(".mobile-navbar");
    const navbarHeight = navbar instanceof HTMLElement ? navbar.getBoundingClientRect().height : 50;
    const safeBottom = parseFloat(getComputedStyle(document.body).getPropertyValue("--safe-area-inset-bottom") || "0");
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
