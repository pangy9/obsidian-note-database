import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("selection checkbox surfaces", () => {
  it("applies shared range selection to the column visibility manager", () => {
    const source = readFileSync(new URL("../views/ColumnManagerRenderer.ts", import.meta.url), "utf8");

    expect(source).toContain('from "../data/RangeSelection"');
    expect(source).toContain("applyRangeSelection(");
    expect(source).toContain("lastSelectedColumnVisibilityKey");
    expect(source).toContain("event.shiftKey");
  });

  it("applies shared range selection to invalid time event repair rows", () => {
    const source = readFileSync(new URL("../views/modals/InvalidTimeEventsModal.ts", import.meta.url), "utf8");

    expect(source).toContain('from "../../data/RangeSelection"');
    expect(source).toContain("applyRangeSelection(");
    expect(source).toContain("lastSelectedEventKey");
    expect(source).toContain("event.shiftKey");
    expect(source).toContain('"db-modal-checkbox db-invalid-event-select"');
  });

  it("applies shared range selection to computed frontmatter cleanup rows", () => {
    const source = readFileSync(new URL("../views/modals/ComputedFrontmatterCleanupModal.ts", import.meta.url), "utf8");

    expect(source).toContain('from "../../data/RangeSelection"');
    expect(source).toContain("applyRangeSelection(");
    expect(source).toContain("lastSelectedKey");
    expect(source).toContain("event.shiftKey");
  });

  it("applies shared range selection to embedded row selection callbacks", () => {
    const source = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    expect(source).toContain('from "../data/RangeSelection"');
    expect(source).toContain("applyRangeSelection(");
    expect(source).toContain("lastSelectedRowPath");
    expect(source).toContain("toggleRowSelected(row, selected, event)");
  });
});
