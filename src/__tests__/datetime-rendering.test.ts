import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("datetime renderer integration", () => {
  it("keeps datetime complete outside calendar and timeline views", () => {
    const renderers = [
      "../views/CellRenderer.ts",
      "../views/BoardRenderer.ts",
      "../views/GalleryRenderer.ts",
      "../views/ListRenderer.ts",
    ];

    for (const rendererPath of renderers) {
      const source = readFileSync(new URL(rendererPath, import.meta.url), "utf8");
      expect(source).toContain('formatDateTimeValueDisplay(value, { mode: "full", showTimeWhenMissing: true })');
    }
  });

  it("routes datetime cells through the date-time editor instead of plain text editing", () => {
    const source = readFileSync(new URL("../views/CellRenderer.ts", import.meta.url), "utf8");

    expect(source).toContain('if (col.type === "date" || col.type === "datetime")');
    expect(source).toContain('this.editDatePopover(target, row, col, currentValue, col.type === "datetime")');
    expect(source).toContain('timeInp = segments.createEl("input", { cls: "db-date-seg db-time-seg"');
  });

  it("treats datetime fields as date-like in formula examples", () => {
    const source = readFileSync(new URL("../views/modals/FormulaModal.ts", import.meta.url), "utf8");

    expect(source).toContain("isDateLikeColumnType(candidate.type)");
  });
});
