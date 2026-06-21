import { describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import {
  getInvalidTimeEventQuickFix,
  getTimelineDateTimeSpanMinutes,
  toTimelineDateTimeInputValue,
} from "../data/InvalidTimeEvents";

describe("invalid time event repair helpers", () => {
  it("normalizes date-only values for datetime-local inputs", () => {
    expect(toTimelineDateTimeInputValue("2026-06-13")).toBe("2026-06-13T00:00");
    expect(toTimelineDateTimeInputValue("2026-06-13T08:30")).toBe("2026-06-13T08:30");
  });

  it("quick-fixes date-only zero-width events to end at next midnight", () => {
    expect(getInvalidTimeEventQuickFix("2026-06-13", "2026-06-13")).toEqual({
      startValue: "2026-06-13T00:00",
      endValue: "2026-06-14T00:00",
    });
  });

  it("quick-fixes datetime zero-width events to last one hour", () => {
    expect(getInvalidTimeEventQuickFix("2026-06-13T09:30", "2026-06-13T09:30")).toEqual({
      startValue: "2026-06-13T09:30",
      endValue: "2026-06-13T10:30",
    });
  });

  it("quick-fixes reversed ranges by swapping start and end", () => {
    expect(getInvalidTimeEventQuickFix("2026-06-13T12:00", "2026-06-13T09:00")).toEqual({
      startValue: "2026-06-13T09:00",
      endValue: "2026-06-13T12:00",
    });
  });

  it("reports positive span minutes for preview labels", () => {
    expect(getTimelineDateTimeSpanMinutes("2026-06-13T00:00", "2026-06-14T00:00")).toBe(1440);
    expect(getTimelineDateTimeSpanMinutes("2026-06-13T09:00", "2026-06-13T10:30")).toBe(90);
    expect(getTimelineDateTimeSpanMinutes("2026-06-13T10:30", "2026-06-13T09:00")).toBeNull();
  });
});

describe("InvalidTimeEventsModal layout contract", () => {
  it("renders a compact selectable repair grid with sticky actions and quick fix", () => {
    const source = readFileSync(new URL("../views/modals/InvalidTimeEventsModal.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

    expect(source).toContain("db-invalid-event-grid");
    expect(source).toContain("db-invalid-event-grid-header");
    expect(source).toContain("db-invalid-event-select");
    expect(source).toContain("db-invalid-event-time-field");
    expect(source).toContain("setupResponsiveLayout");
    expect(source).toContain("ResizeObserver");
    expect(source).toContain("is-invalid-events-compact");
    expect(source).toContain("is-invalid-events-narrow");
    expect(source).toContain("applyQuickFixToSelected");
    expect(source).toContain("originalStartValue");
    expect(source).toContain("renderSpan");
    expect(source).toContain("toTimelineDateTimeInputValue");
    expect(styles).toContain(".modal.invalid-events-modal-host");
    expect(styles).toContain(".note-database-modal .db-invalid-event-actions");
    expect(styles).toContain(".note-database-modal.is-invalid-events-compact .db-invalid-event-row");
    expect(styles).toContain(".note-database-modal.is-invalid-events-narrow .db-invalid-event-row");
    expect(styles).toContain(".note-database-modal.is-invalid-events-compact .db-invalid-event-time-label");
    expect(styles).toContain("grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr) max-content");
    expect(styles).toContain("\"select name name span\"");
    expect(styles).toContain("\". start end span\"");
    expect(styles).toContain(".note-database-modal.is-invalid-events-narrow .db-invalid-event-time-field");
    expect(styles).toContain("grid-template-columns: 44px minmax(0, 1fr)");
    expect(styles).toContain(".note-database-modal.is-invalid-events-narrow .db-invalid-event-span-cell");
    expect(styles).toContain("justify-content: flex-end");
    expect(styles).toContain(".note-database-modal.is-invalid-events-narrow .db-invalid-event-row-fix");
    expect(styles).toContain("margin-left: auto");
    expect(styles).toContain("position: sticky");
  });
});
