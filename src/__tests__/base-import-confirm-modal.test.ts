import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BaseImportConfirmModal selection behavior", () => {
  const source = readFileSync(new URL("../views/modals/BaseImportConfirmModal.ts", import.meta.url), "utf8");

  it("uses the shared range selection helper instead of local shift-click logic", () => {
    expect(source).toContain('from "../../data/RangeSelection"');
    expect(source).toContain("applyRangeSelection(");
    expect(source).toContain("event.shiftKey");
    expect(source).toContain("this.lastSelectedColumnKey");
  });

  it("uses the include header checkbox for select-all / select-none", () => {
    expect(source).toContain("this.headerSelectionCheckbox");
    expect(source).toContain("renderHeaderSelectionCheckbox(");
    expect(source).toContain("selectAll(");
    expect(source).toContain("clearSelection(");
    expect(source).not.toContain("baseImport.selectAll");
    expect(source).not.toContain("baseImport.selectNone");
    expect(source).not.toContain("baseImport.invertSelection");
  });

  it("places the include checkbox column at the far right after file count", () => {
    const fileCountHeader = source.indexOf('headRow.createEl("th", { text: t("baseImport.fileCount") })');
    const includeHeader = source.indexOf("this.renderHeaderSelectionCheckbox(");
    expect(fileCountHeader).toBeGreaterThan(-1);
    expect(includeHeader).toBeGreaterThan(fileCountHeader);

    const fileCountCell = source.indexOf('tr.createEl("td", { text: col.fileCount > 0 ? String(col.fileCount) : "-" })');
    const rowCheckboxCell = source.indexOf('const checkTd = tr.createEl("td")');
    expect(fileCountCell).toBeGreaterThan(-1);
    expect(rowCheckboxCell).toBeGreaterThan(fileCountCell);
  });

  it("uses the shared modal checkbox styling for header and row include controls", () => {
    expect(source).toContain('"db-modal-checkbox base-import-include-checkbox"');
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(styles).toContain(".note-database-modal .db-modal-checkbox");
    expect(styles).toContain("appearance: none");
    expect(styles).toContain("border-radius: var(--db-radius-sm)");
    expect(styles).toContain("border: 1px solid var(--checkbox-border-color, var(--background-modifier-border))");
    expect(styles).toContain(".note-database-modal .db-modal-checkbox:checked::after");
    expect(styles).toContain(".note-database-modal .db-modal-checkbox:indeterminate::after");
    expect(styles).toContain("display: none");
  });
});
