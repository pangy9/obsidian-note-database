import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  captureDatabaseViewport,
  captureEmbeddedHostViewport,
  findEmbeddedHostScroller,
  resolveDatabaseViewportMode,
  restoreDatabaseViewport,
  restoreEmbeddedHostViewport,
} from "../views/DatabaseViewport";

function makeElement(top: number, left: number, rowPath: string, columnKey: string, height = 20): HTMLElement {
  return {
    dataset: { noteDatabaseRowPath: rowPath, noteDatabaseColumnKey: columnKey },
    getBoundingClientRect: () => ({ top, left, height, width: 80, bottom: top + height, right: left + 80 }),
  } as unknown as HTMLElement;
}

function makeContainer(beforeTop: number, afterTop: number): HTMLElement {
  const visibleRowBefore = makeElement(beforeTop, 0, "Books/A.md", "file.name");
  const visibleColBefore = makeElement(0, 120, "Books/A.md", "rating");
  const visibleRowAfter = makeElement(afterTop, 0, "Books/A.md", "file.name");
  const visibleColAfter = makeElement(0, 170, "Books/A.md", "rating");
  let phase: "before" | "after" = "before";
  const container = {
    scrollTop: 240,
    scrollLeft: 80,
    clientHeight: 400,
    clientWidth: 600,
    setAfter: () => { phase = "after"; },
    getBoundingClientRect: () => ({ top: 100, left: 40, height: 400, width: 600, bottom: 500, right: 640 }),
    querySelectorAll: (selector: string) => {
      if (selector.includes("data-note-database-row-path")) return [phase === "before" ? visibleRowBefore : visibleRowAfter];
      if (selector.includes("data-note-database-column-key")) return [phase === "before" ? visibleColBefore : visibleColAfter];
      return [];
    },
  };
  return container as unknown as HTMLElement & { setAfter(): void };
}

describe("database viewport preservation", () => {
  it("restores scroll offsets and compensates for row and column anchor movement", () => {
    const container = makeContainer(150, 175);
    const snapshot = captureDatabaseViewport(container);

    container.scrollTop = 0;
    container.scrollLeft = 0;
    (container as unknown as { setAfter(): void }).setAfter();
    restoreDatabaseViewport(container, snapshot);

    expect(container.scrollTop).toBe(265);
    expect(container.scrollLeft).toBe(130);
  });

  it("resolves viewport behavior from caller intent instead of only view type", () => {
    expect(resolveDatabaseViewportMode("table", "table")).toBe("preserve-anchor");
    expect(resolveDatabaseViewportMode("board", "board")).toBe("preserve-anchor");
    expect(resolveDatabaseViewportMode(null, "table")).toBe("none");
    expect(resolveDatabaseViewportMode("table", "board")).toBe("none");
    expect(resolveDatabaseViewportMode("table", "table", "reset-top")).toBe("reset-top");
    expect(resolveDatabaseViewportMode("table", "board", "preserve-anchor")).toBe("preserve-anchor");
  });

  it("refresh accepts explicit viewport intent from semantic callers", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(source).toContain('refresh(options: { viewport?: DatabaseViewportRequest } = {})');
    expect(source).toContain('resolveDatabaseViewportMode(this.lastRenderedViewType, nextViewType, options.viewport)');
    expect(source).toContain('this.refresh({ viewport: "reset-top" })');
  });

  it("resets to the top when grouping changes the result structure", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    expect(dashboard).toMatch(/private setGroupByField[\s\S]*?this\.refresh\(\{ viewport: "reset-top" \}\);[\s\S]*?private setShowEmptyGroups/);
    expect(dashboard).toMatch(/private setShowEmptyGroups[\s\S]*?this\.refresh\(\{ viewport: "reset-top" \}\);[\s\S]*?private toggleHeaderPopover/);
    expect(dashboard).toMatch(/const commitOrder = \(\) => \{[\s\S]*?this\.refresh\(\{ viewport: "reset-top" \}\);[\s\S]*?window\.requestAnimationFrame\(positionPopover\);/);
    expect(dashboard).toMatch(/private setGroupOrderMode[\s\S]*?this\.refresh\(\{ viewport: "reset-top" \}\);[\s\S]*?private toNumericGroupValue/);

    expect(embedded).toMatch(/setGroupByField: \(value\) => \{[\s\S]*?this\.renderResults\(config, \{ viewport: "reset-top" \}\);[\s\S]*?setShowEmptyGroups/);
    expect(embedded).toMatch(/setShowEmptyGroups: \(field, value\) => \{[\s\S]*?this\.renderResults\(config, \{ viewport: "reset-top" \}\);[\s\S]*?configureGroupOrder/);
    expect(embedded).toMatch(/const commitOrder = \(\) => \{[\s\S]*?this\.renderResults\(config, \{ viewport: "reset-top" \}\);[\s\S]*?this\.saveEmbeddedConfigInBackground/);
    expect(embedded).toMatch(/private setGroupOrderMode[\s\S]*?this\.renderResults\(config, \{ viewport: "reset-top" \}\);[\s\S]*?\}/);
  });

  it("keeps embedded refreshes from moving the host markdown scroller", () => {
    const sourceScroller = { scrollTop: 420, scrollLeft: 0 } as HTMLElement;
    const sourceView = {
      querySelector: (selector: string) => selector === ".cm-scroller" ? sourceScroller : null,
    };
    const livePreviewEmbed = {
      closest: (selector: string) => selector === ".markdown-source-view" ? sourceView : null,
      getBoundingClientRect: () => ({ top: 260, left: 0, height: 200, width: 500, bottom: 460, right: 500 }),
    } as unknown as HTMLElement;

    expect(findEmbeddedHostScroller(livePreviewEmbed)).toBe(sourceScroller);
    const snapshot = captureEmbeddedHostViewport(livePreviewEmbed);
    sourceScroller.scrollTop = 500;
    restoreEmbeddedHostViewport(snapshot);
    expect(sourceScroller.scrollTop).toBe(420);

    const previewScroller = { scrollTop: 180, scrollLeft: 0 } as HTMLElement;
    const previewEmbed = {
      closest: (selector: string) => selector === ".markdown-preview-view" ? previewScroller : null,
      getBoundingClientRect: () => ({ top: 120, left: 0, height: 200, width: 500, bottom: 320, right: 500 }),
    } as unknown as HTMLElement;
    expect(findEmbeddedHostScroller(previewEmbed)).toBe(previewScroller);

    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    expect(embedded).toContain("const hostViewport = captureEmbeddedHostViewport(this.containerEl)");
    expect(embedded).toContain("this.restoreEmbeddedHostViewport(hostViewport)");
    expect(embedded).toContain("window.requestAnimationFrame(() => restoreEmbeddedHostViewport(snapshot))");
  });
});

describe("table row drag start", () => {
  it("uses a dedicated row drag handle instead of making the whole row draggable", () => {
    const source = readFileSync(new URL("../views/TableRenderer.ts", import.meta.url), "utf8");

    expect(source).toContain("db-table-row-drag-handle");
    expect(source).toContain("handle.draggable = true");
    expect(source).not.toContain("tr.draggable = true");
  });
});

describe("board container drop fallback (column below empty space)", () => {
  it("wires a .db-board dragover/drop fallback that resolves the column by point", () => {
    const board = readFileSync(new URL("../views/BoardRenderer.ts", import.meta.url), "utf8");
    const drop = readFileSync(new URL("../data/BoardContainerDrop.ts", import.meta.url), "utf8");

    expect(drop).toContain("export function resolveBoardColumnByPoint");
    expect(drop).toContain("export interface BoardDropCandidate");
    expect(board).toContain("resolveBoardColumnByPoint");
    expect(board).toContain("attachBoardContainerDropHandlers");
    expect(board).toContain('closest(".db-board-column")');
    expect(board).toContain("showBoardDropHighlight");
    expect(board).toContain("detachBoardDropHighlight");
  });
});

describe("local new-entry buttons", () => {
  it("passes the current visible container tail as the create position", () => {
    const files = [
      "../views/TableRenderer.ts",
      "../views/BoardRenderer.ts",
      "../views/GalleryRenderer.ts",
      "../views/ListRenderer.ts",
    ];

    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("getCreatePosition");
      expect(source).toContain("afterPath");
      expect(source).toContain("this.actions.createEntry(defaults,");
    }
  });

  it("uses create positions when assigning manual ranks to new entries", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(source).toContain("assignManualRankForNewEntry(config, file.path, position)");
    expect(source).toContain("const lowerPath = position?.afterPath");
    expect(source).toContain("const upperPath = position?.beforePath");
    expect(source).toContain("rankBetween(lowerRank ?? fallbackLastRank, upperRank)");
  });

  it("reveals and highlights newly created columns after schema refresh", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(source).toContain("this.pendingRevealColumnKey = key");
    expect(source).toContain("this.pendingRevealColumnUntil = Date.now() + NEW_COLUMN_HIGHLIGHT_MS");
    expect(source).toContain("this.applyPendingColumnHighlight()");
    expect(source).toContain("this.clearPendingColumnHighlight()");
    expect(source).toContain("this.pendingRevealColumnScrolled = false");
    expect(source).toContain("this.revealPendingColumn()");
    expect(source).toContain("is-new-column-highlight");
    expect(styles).toContain("is-new-column-highlight");
  });
});

describe("board subgroup layout", () => {
  it("reserves bottom space before the next sticky subgroup header", () => {
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const match = styles.match(/\.note-database-container \.db-board-subgroup:not\(:last-child\) \{(?<body>[^}]*)\}/);

    expect(match?.groups?.body).toContain("padding-bottom: 10px;");
  });
});
