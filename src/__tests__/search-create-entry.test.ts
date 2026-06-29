import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("search result create entry controls", () => {
  it("hides result-area create entry controls while search text is active", () => {
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const tableRenderer = readFileSync(new URL("../views/TableRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(databaseView).toContain("private shouldHideResultCreateEntryButtons(): boolean");
    expect(databaseView).toContain("this.vs().searchText.trim().length > 0");
    expect(databaseView).toContain("const shouldHideResultCreateEntryButtons = () => this.shouldHideResultCreateEntryButtons();");
    expect(databaseView).toContain("get hideCreateEntry() { return shouldHideResultCreateEntryButtons(); }");
    expect(tableRenderer).toContain('table.toggleClass("is-create-entry-hidden", Boolean(this.actions.hideCreateEntry))');
    expect(styles).toContain(".note-database-container .db-table.is-create-entry-hidden tbody tr:last-child td");
    expect(styles).toContain("border-bottom: 1px solid var(--background-modifier-border)");
  });

  it("keeps create-entry hiding separate from read-only state across card/list renderers", () => {
    const board = readFileSync(new URL("../views/BoardRenderer.ts", import.meta.url), "utf8");
    expect(board).toContain("readonly hideCreateEntry?: boolean");
    expect(board).toContain("!this.actions.hideCreateEntry");

    for (const file of ["GalleryRenderer.ts", "ListRenderer.ts"]) {
      const source = readFileSync(new URL(`../views/${file}`, import.meta.url), "utf8");
      expect(source).toContain("readonly hideCreateEntry?: boolean");
      expect(source).toContain("this.actions.isReadOnly || this.actions.hideCreateEntry");
    }
  });
});
