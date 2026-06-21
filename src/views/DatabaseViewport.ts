import type { DatabaseViewType } from "../data/types";

export interface DatabaseViewportSnapshot {
  top: number;
  left: number;
  rowAnchor?: { path: string; offset: number };
  columnAnchor?: { key: string; offset: number };
}

export interface EmbeddedHostViewportSnapshot {
  scroller: HTMLElement;
  top: number;
  left: number;
  embedTop: number;
  embedLeft: number;
}

export type DatabaseViewportRequest = "auto" | "preserve-anchor" | "preserve-raw" | "reset-top" | "none";
export type DatabaseViewportMode = Exclude<DatabaseViewportRequest, "auto">;

interface AnchorCandidate {
  id: string;
  offset: number;
}

/** Capture scroll offsets and the first visible row/column so a full rerender can keep the user's place. */
export function captureDatabaseViewport(container: HTMLElement): DatabaseViewportSnapshot {
  const bounds = container.getBoundingClientRect();
  const rowAnchor = findVisibleAnchor(container, "[data-note-database-row-path]", "noteDatabaseRowPath", bounds, "top");
  const columnAnchor = findVisibleAnchor(container, "[data-note-database-column-key]", "noteDatabaseColumnKey", bounds, "left");
  return {
    top: container.scrollTop,
    left: container.scrollLeft,
    rowAnchor: rowAnchor ? { path: rowAnchor.id, offset: rowAnchor.offset } : undefined,
    columnAnchor: columnAnchor ? { key: columnAnchor.id, offset: columnAnchor.offset } : undefined,
  };
}

/** Restore the captured scroll position and compensate when the anchor moved during rerender. */
export function restoreDatabaseViewport(container: HTMLElement, snapshot: DatabaseViewportSnapshot): void {
  container.scrollTop = snapshot.top;
  container.scrollLeft = snapshot.left;

  const bounds = container.getBoundingClientRect();
  const row = snapshot.rowAnchor
    ? findAnchorById(container, "[data-note-database-row-path]", "noteDatabaseRowPath", snapshot.rowAnchor.path)
    : null;
  if (row) {
    container.scrollTop += row.getBoundingClientRect().top - bounds.top - snapshot.rowAnchor!.offset;
  }

  const column = snapshot.columnAnchor
    ? findAnchorById(container, "[data-note-database-column-key]", "noteDatabaseColumnKey", snapshot.columnAnchor.key)
    : null;
  if (column) {
    container.scrollLeft += column.getBoundingClientRect().left - bounds.left - snapshot.columnAnchor!.offset;
  }
}

export function findEmbeddedHostScroller(embed: HTMLElement): HTMLElement | null {
  const sourceView = embed.closest<HTMLElement>(".markdown-source-view");
  const sourceScroller = sourceView?.querySelector<HTMLElement>(".cm-scroller");
  if (sourceScroller) return sourceScroller;

  const previewView = embed.closest<HTMLElement>(".markdown-preview-view");
  if (previewView) return previewView;

  const readingView = embed.closest<HTMLElement>(".markdown-reading-view");
  const readingPreview = readingView?.querySelector<HTMLElement>(".markdown-preview-view");
  if (readingPreview) return readingPreview;
  if (readingView) return readingView;

  return embed.closest<HTMLElement>(".view-content")
    || embed.closest<HTMLElement>(".workspace-leaf-content");
}

export function captureEmbeddedHostViewport(embed: HTMLElement): EmbeddedHostViewportSnapshot | null {
  const scroller = findEmbeddedHostScroller(embed);
  if (!scroller) return null;
  const rect = embed.getBoundingClientRect();
  return {
    scroller,
    top: scroller.scrollTop,
    left: scroller.scrollLeft,
    embedTop: rect.top,
    embedLeft: rect.left,
  };
}

export function restoreEmbeddedHostViewport(snapshot: EmbeddedHostViewportSnapshot | null): void {
  if (!snapshot) return;
  snapshot.scroller.scrollTop = snapshot.top;
  snapshot.scroller.scrollLeft = snapshot.left;
}

export function resolveDatabaseViewportMode(
  previousViewType: DatabaseViewType | null | undefined,
  nextViewType: DatabaseViewType | null | undefined,
  request: DatabaseViewportRequest = "auto"
): DatabaseViewportMode {
  if (request !== "auto") return request;
  return previousViewType && nextViewType && previousViewType === nextViewType
    ? "preserve-anchor"
    : "none";
}

function findVisibleAnchor(
  container: HTMLElement,
  selector: string,
  datasetKey: "noteDatabaseRowPath" | "noteDatabaseColumnKey",
  bounds: DOMRect,
  axis: "top" | "left"
): AnchorCandidate | undefined {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(selector));
  for (const candidate of candidates) {
    const id = candidate.dataset[datasetKey];
    if (!id) continue;
    const rect = candidate.getBoundingClientRect();
    const visible = axis === "top"
      ? rect.bottom >= bounds.top && rect.top <= bounds.bottom
      : rect.right >= bounds.left && rect.left <= bounds.right;
    if (!visible) continue;
    return {
      id,
      offset: axis === "top" ? rect.top - bounds.top : rect.left - bounds.left,
    };
  }
  return undefined;
}

function findAnchorById(
  container: HTMLElement,
  selector: string,
  datasetKey: "noteDatabaseRowPath" | "noteDatabaseColumnKey",
  id: string
): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return candidates.find((candidate) => candidate.dataset[datasetKey] === id) || null;
}
