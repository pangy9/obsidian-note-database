import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("database description layout", () => {
  it("keeps description edit mode aligned with the read mode layout", () => {
    const toolbar = readFileSync(new URL("../views/ToolbarRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(toolbar).toContain("const initialHeight = Math.ceil(el.getBoundingClientRect().height)");
    expect(toolbar).toContain("input.rows = 1");
    expect(toolbar).toContain("this.syncDatabaseDescriptionEditHeight(input, initialHeight)");
    expect(toolbar).toContain("getDatabaseDescriptionEditMaxHeight");
    expect(toolbar).not.toContain("window.requestAnimationFrame(() => this.autoGrowTextarea(input, 200))");

    const rule = cssRule(styles, ".note-database-container .db-heading-edit-description");
    expect(rule).toContain("display: block");
    expect(rule).toContain("width: 100%");
    expect(rule).toContain("min-width: 0");
    expect(rule).toContain("max-width: none");
    expect(rule).toContain("min-height: var(--db-description-min-height)");
    expect(rule).toContain("max-height: 30vh");
    expect(rule).toContain("border: 0");
    expect(rule).toContain("font-family: var(--font-interface)");
    expect(rule).toContain("margin-left: 0");
    expect(rule).toContain("margin-top: 0");
    expect(rule).toContain("margin-bottom: 0");
    expect(rule).toContain("padding: 0 4px 0 0");
    expect(rule).toContain("scrollbar-gutter: stable");
  });
});

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}
