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

  it("keeps the table row drag handle visually aligned with column manager handles", () => {
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const tableHandle = cssRule(styles, ".note-database-container .db-table .db-table-row-drag-handle");

    expect(tableHandle).toContain("appearance: none");
    expect(tableHandle).toContain("width: 16px");
    expect(tableHandle).toContain("min-width: 16px");
    expect(tableHandle).toContain("min-height: 0");
    expect(tableHandle).toContain("border: 0");
    expect(tableHandle).toContain("border-radius: 0");
    expect(tableHandle).toContain("box-shadow: none");
    expect(tableHandle).toContain("font-size: 13px");
    expect(tableHandle).toContain("opacity: 0");
    expect(tableHandle).toContain("transition: opacity 120ms ease, color 120ms ease");
    expect(styles).toContain(".note-database-container .db-table tr:hover .db-table-row-drag-handle");
    expect(styles).toContain(".note-database-container .db-table tr.is-dragging .db-table-row-drag-handle");
    expect(styles).toContain("opacity: 1");
  });

  it("reserves enough table selection-column width for the row drag handle and checkbox", () => {
    const tableRenderer = readFileSync(new URL("../views/TableRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const selectCol = cssRule(styles, ".note-database-container .db-table col.db-select-colgroup");
    const selectCell = cssRule(styles, ".note-database-container .db-table th.db-select-col,\n.note-database-container .db-table td.db-select-col");
    const headerReserve = cssRule(styles, ".note-database-container .db-table th.db-select-col .db-select-inner::before");
    const mobileHeaderReserve = cssRule(styles, ".is-phone .note-database-container .db-table th.db-select-col .db-select-inner::before");
    const mobileCheckbox = cssRule(styles, ".is-phone .note-database-container .db-table th.db-select-col input[type=\"checkbox\"],\n.is-phone .note-database-container .db-table td.db-select-col input[type=\"checkbox\"]");
    const mobileMoveButton = cssRule(styles, ".is-phone .note-database-container .db-table-mobile-move-btn");

    expect(tableRenderer).toContain("return this.isPhoneLayout() ? 62 : 40");
    expect(tableRenderer.indexOf("this.renderMobileMoveButton(selectInner")).toBeLessThan(tableRenderer.indexOf("const cb = selectInner.createEl(\"input\""));
    expect(selectCol).toContain("width: 40px");
    expect(selectCell).toContain("width: 40px");
    expect(mobileHeaderReserve).toContain("flex-basis: 24px");
    expect(mobileCheckbox).toContain("margin: 0 8px 0 auto");
    expect(mobileMoveButton).toContain("flex: 0 0 24px");
    expect(mobileMoveButton).toContain("margin: 0");
    expect(headerReserve).toContain('content: ""');
    expect(headerReserve).toContain("flex: 0 0 17px");
  });

  it("uses shared targeted drop feedback for table, list, and gallery item reordering", () => {
    const files = [
      "../views/TableRenderer.ts",
      "../views/ListRenderer.ts",
      "../views/GalleryRenderer.ts",
    ];

    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain('from "./DragDropFeedback"');
      expect(source).toContain("new DragDropFeedbackState()");
      expect(source).toContain("resolveDropPlacement(");
      expect(source).toContain(".update(");
      expect(source).toContain(".clear()");
      expect(source).not.toMatch(/dragover[\s\S]{0,500}querySelectorAll\("\.is-drop-before, \.is-drop-after"\)/);
    }

    const board = readFileSync(new URL("../views/BoardRenderer.ts", import.meta.url), "utf8");
    expect(board).not.toContain('from "./DragDropFeedback"');
  });

  it("shows a floating target-group preview while dragging board cards", () => {
    const board = readFileSync(new URL("../views/BoardRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    // 方案 A：拖拽期间让列等高（align-items: stretch），使列标题的 sticky 失效点推迟到看板底部
    expect(board).toContain('addClass("is-card-dragging")');
    expect(board).toContain('removeClass("is-card-dragging")');
    expect(styles).toContain(".note-database-container .db-board.is-card-dragging");
    const stretchRule = cssRule(styles, ".note-database-container .db-board.is-card-dragging");
    expect(stretchRule).toContain("align-items: stretch");

    // 方案 B：鼠标附近浮动列名 preview，复用列命中与列名 helper（不重复造轮子）
    expect(board).toContain("db-board-drag-group-preview");
    expect(board).toContain("resolveBoardColumnByPoint");
    expect(board).toContain("formatGroupKeyDisplay");
    expect(board).toContain("collectBoardDropTargets");
    // popout 兼容：preview 与 dragover 监听都走 activeDocument，且成对移除防泄漏
    expect(board).toContain("window.activeDocument");
    expect(board).toContain('addEventListener("dragover"');
    expect(board).toContain('removeEventListener("dragover"');

    const previewRule = cssRule(styles, ".db-board-drag-group-preview");
    expect(previewRule).toContain("position: fixed");
    expect(previewRule).toContain("pointer-events: none");
    expect(previewRule).toContain("var(--interactive-accent)");
    expect(previewRule).toContain("border-radius: 999px");
    // body 级元素：禁止嵌套在 .note-database-container 作用域，否则会被滚动祖先裁切
    expect(styles).not.toContain(".note-database-container .db-board-drag-group-preview");
  });
});

function cssRule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}(?:\\s*,[^{}]*)?\\s*\\{([^}]*)\\}`));
  return match?.[1] || "";
}
