import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";

describe("drag preview targets", () => {
  it("uses whole-row drag sources for list-like reorder controls", () => {
    const settings = readFileSync(new URL("../settings.ts", import.meta.url), "utf8");
    const columnManager = readFileSync(new URL("../views/ColumnManagerRenderer.ts", import.meta.url), "utf8");
    const statusOptions = readFileSync(new URL("../views/modals/StatusOptionsModal.ts", import.meta.url), "utf8");

    expect(settings).toContain("section.draggable = true");
    expect(settings).not.toContain("drag.draggable = true;");
    expect(columnManager).toContain("row.draggable = true");
    expect(columnManager).not.toContain("drag.draggable = true;");
    expect(statusOptions).toContain("row.draggable = true");
    expect(statusOptions).not.toContain("drag.draggable = true;");
  });

  it("applies the option reorder drag state to the whole option item", () => {
    const cellRenderer = readFileSync(new URL("../views/CellRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(cellRenderer).toContain("item.addClass(\"is-dragging\")");
    expect(cellRenderer).toContain("item.removeClass(\"is-dragging\")");
    expect(cellRenderer).toContain("createOptionDragPreview");
    expect(cellRenderer).toContain("updateOptionDragPreview");
    expect(cellRenderer).toContain("preview.addClass(\"db-cell-option-drag-preview\")");
    expect(cellRenderer).toContain("preview.addClass(\"db-cell-option-item\")");
    expect(cellRenderer).toContain("preview.querySelectorAll(\".db-mobile-reorder-controls\")");
    expect(styles).toContain(".note-database-container .db-cell-option-item.is-dragging");
    expect(styles).toContain(".db-cell-option-drag-preview.db-cell-option-item");
    expect(styles).toContain(".db-cell-option-drag-preview .db-mobile-reorder-controls");
    expect(styles).toContain(".db-cell-option-drag-preview .db-option-delete");
    expect(styles).toContain(".db-cell-option-drag-preview .db-option-color-dot");
  });

  it("gives group ordering and sort rules the same row drag feedback", () => {
    const sortPanel = readFileSync(new URL("../views/SortPanelRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const groupOrder = cssRule(styles, ".note-database-container .db-group-order-popover .db-group-order-row.is-dragging");
    const rule = cssRule(styles, ".note-database-container .db-sort-rule-row.is-dragging");

    expect(sortPanel).toContain("row.draggable = true");
    expect(sortPanel).not.toContain("drag.draggable = true");
    expect(groupOrder).toContain("box-shadow");
    expect(rule).toContain("box-shadow");
  });
});

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}(?:\\s*,[^{}]*)?\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}
