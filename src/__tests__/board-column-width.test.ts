import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Regression contract for the board "long group title pins the column open" bug.
//
// .db-board-column is `flex: 0 0 var(--db-board-column-width)`. Without
// min-width:0 on the flex chain (column → header → title), a long nowrap group
// title sets the column's min-content floor, so the resize clamp (220px) cannot
// shrink the column below the title width and text-overflow:ellipsis never
// triggers — the column "gets stuck" and can't be narrowed. Every flex item in
// the chain must carry min-width:0 for the ellipsis to win over min-width:auto.
// (.db-board-subgroup-title already followed this pattern; the group column did not.)
describe("board column width vs long group title", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

  const ruleBody = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, `CSS rule "${selector}" must exist`).not.toBeNull();
    return match![1];
  };

  it("column flex item can shrink below its content's min-content", () => {
    expect(ruleBody(".note-database-container .db-board-column")).toMatch(/min-width:\s*0/);
  });

  it("column header can shrink so the title can truncate inside it", () => {
    expect(ruleBody(".note-database-container .db-board-column-header")).toMatch(/min-width:\s*0/);
  });

  it("column title truncates with ellipsis and can shrink", () => {
    const title = ruleBody(".note-database-container .db-board-column-title");
    expect(title).toMatch(/min-width:\s*0/);
    expect(title).toMatch(/overflow:\s*hidden/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(title).toMatch(/white-space:\s*nowrap/);
  });
});
