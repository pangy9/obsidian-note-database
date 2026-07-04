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
    expect(source).toContain('hourInp = segments.createEl("input", { cls: "db-date-seg db-time-seg db-hour-seg"');
    expect(source).toContain('minuteInp = segments.createEl("input", { cls: "db-date-seg db-time-seg db-minute-seg"');
    expect(source).not.toContain('maxlength: "5", placeholder: timePlaceholder');
  });

  it("adds a calendar picker to the date-time cell editor", () => {
    const source = readFileSync(new URL("../views/CellRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(source).toContain('renderMiniCalendar({');
    expect(source).toContain('const datePicker = popover.createDiv({ cls: "db-calendar-mini-popover db-cell-date-picker" })');
    expect(source).toContain('onSelectDate: (dateKey) => {');
    expect(source).toContain('setDateInputs(dateKey);');
    expect(source).toContain('pickerMonthKey = dateKey.slice(0, 7);');
    expect(source).toContain('(hourInp || dayInp).focus();');
    expect(source).toContain("const setCurrentTimeInputs = () => {");
    expect(source).toContain("hourInp.value = pad2(String(now.getHours()));");
    expect(source).toContain("minuteInp.value = pad2(String(now.getMinutes()));");
    expect(source).toContain("setCurrentTimeInputs();");
    expect(source).toContain('datePicker.addEventListener("mousedown", (event) => {');
    expect(source).toContain("event.preventDefault();");
    expect(source).not.toContain("onSelectDate: (dateKey) => {\n          setDateInputs(dateKey);\n          void commit();");
    expect(styles).toContain(".db-cell-edit-popover.db-date-edit-popover .db-cell-date-picker.db-calendar-mini-popover");
    expect(styles).toContain("width: 252px;");
    expect(styles).toContain("box-sizing: border-box;");
  });

  it("treats datetime fields as date-like in formula examples", () => {
    const source = readFileSync(new URL("../views/modals/FormulaModal.ts", import.meta.url), "utf8");

    expect(source).toContain("isDateLikeColumnType(candidate.type)");
  });
});
