import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("table keyboard option popovers", () => {
  it("keeps option-list keyboard handling isolated from table navigation", () => {
    const cellRenderer = readFileSync(new URL("../views/CellRenderer.ts", import.meta.url), "utf8");
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(cellRenderer).toContain("close({ restoreFocus: true })");
    expect(cellRenderer).toContain("private restoreTableCellFocus?: (row: RowData, col: ColumnDef) => void");
    expect(cellRenderer).toContain("else this.restoreTableCellFocus?.(row, col);");
    expect(cellRenderer).toMatch(/event\.stopImmediatePropagation\(\);[\s\S]*?if \(event\.key === "Enter"\) item\.click\(\);/);
    expect(cellRenderer).toMatch(/item\.onkeydown = \(event\) => \{[\s\S]*?event\.stopPropagation\(\);[\s\S]*?event\.preventDefault\(\);/);

    expect(databaseView).toContain("(row, col) => this.restoreTableCellFocus(row, col)");
    expect(databaseView).toContain("private restoreTableCellFocus(row: RowData, col: ColumnDef): void");
    expect(databaseView).toContain("await this.applyCellChanges([change], t(\"undo.editCell\"), { preserveCellSelection: true });");
    expect(databaseView).toMatch(/if \(!options\.preserveCellSelection\) this\.clearCellSelection\(\);[\s\S]*?await this\.refreshAfterSave\(\);[\s\S]*?if \(options\.preserveCellSelection\) \{/);
  });
});
