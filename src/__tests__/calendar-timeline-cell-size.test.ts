import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("calendar cell sizing controls", () => {
  it("persists and renders calendar column and row sizing controls", () => {
    const types = readFileSync(new URL("../data/types.ts", import.meta.url), "utf8");
    const dataSource = readFileSync(new URL("../data/DataSource.ts", import.meta.url), "utf8");
    const calendarToolbar = readFileSync(new URL("../views/CalendarToolbarRenderer.ts", import.meta.url), "utf8");
    const calendarRenderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

    // Legacy fields still persisted for backward compatibility
    expect(types).toContain("calendarCellMinHeight?: number");
    expect(types).toContain("calendarKeepCellAspectRatio?: boolean");
    expect(dataSource).toContain("calendarCellMinHeight");
    expect(dataSource).toContain("calendarKeepCellAspectRatio");

    // New sizing controls in CalendarToolbarRenderer
    expect(calendarToolbar).toContain("config.calendarColumnSizeMode");
    expect(calendarToolbar).toContain("config.calendarRowSizeMode");

    // CalendarRenderer uses sizing CSS variables
    expect(calendarRenderer).toContain("--db-calendar-day-min-height");
    expect(styles).toContain(".note-database-container .db-calendar-col-resize-handle");
    expect(styles).toContain(".note-database-container .db-calendar-row-resize-handle");
    expect(i18n).toContain("\"undo.calendarCellSizeConfig\"");
  });
});
