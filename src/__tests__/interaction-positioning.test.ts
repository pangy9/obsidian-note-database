import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureDatabaseViewport, restoreDatabaseViewport } from "../views/DatabaseViewport";

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
