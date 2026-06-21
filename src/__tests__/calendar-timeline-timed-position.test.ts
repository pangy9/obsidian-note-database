import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Menu: class {
    addItem(): this { return this; }
    addSeparator(): this { return this; }
    showAtMouseEvent(): void {}
  },
  setIcon: vi.fn(),
}));

import { getTimelineTimedPositionStyle, getTimelineTodayPositionStyle } from "../views/CalendarTimelineRenderer";

describe("timeline timed event positioning", () => {
  it("keeps the opposite edge fixed when resizing a timed event from the start", () => {
    const original = getTimelineTimedPositionStyle(9 * 60, 11 * 60, 8 * 60, 18 * 60, 10);
    const resized = getTimelineTimedPositionStyle(10 * 60, 11 * 60, 8 * 60, 18 * 60, 10);

    expect(original.offsetUnits + original.durationUnits).toBe(3);
    expect(resized.offsetUnits + resized.durationUnits).toBe(3);
    expect(resized.cssProps["--db-timeline-exact-offset"]).toBe("calc(var(--db-timeline-unit-width) * 2)");
    expect(resized.cssProps["--db-timeline-exact-width"]).toBe("calc(var(--db-timeline-unit-width) * 1)");
  });

  it("places the day-scale today line by the exact current minute instead of the hour tick", () => {
    const style = getTimelineTodayPositionStyle(new Date(2026, 5, 15, 22, 59, 30), {
      startDateKey: "2026-06-15",
      endDateKey: "2026-06-15",
      startMinutes: 0,
      totalUnits: 24,
      scale: "day",
      unit: "hour",
    }, 48);

    expect(style?.offsetUnits).toBeCloseTo(22.9917, 4);
    expect(style?.cssProps["--db-timeline-today-offset-px"]).toBe("1103.6px");
    expect(style?.cssProps["--db-timeline-today-offset-units"]).not.toBe("22");
  });

  it("places 23:10 one sixth of an hour after the 23:00 tick", () => {
    const style = getTimelineTodayPositionStyle(new Date(2026, 5, 15, 23, 10, 0), {
      startDateKey: "2026-06-15",
      endDateKey: "2026-06-16",
      startMinutes: 11 * 60,
      totalUnits: 24,
      scale: "day",
      unit: "hour",
    }, 48);

    expect(style?.offsetUnits).toBeCloseTo(12 + 1 / 6, 4);
    expect(style?.cssProps["--db-timeline-today-offset-px"]).toBe("584px");
  });

  it.each(["week", "month", "quarter"] as const)("places %s-scale today line inside the day instead of snapping to the date tick", (scale) => {
    const style = getTimelineTodayPositionStyle(new Date(2026, 5, 15, 12, 0, 0), {
      startDateKey: "2026-06-15",
      endDateKey: "2026-06-21",
      totalUnits: 7,
      scale,
      unit: "day",
    }, 80);

    expect(style?.offsetUnits).toBeCloseTo(0.5, 4);
    expect(style?.cssProps["--db-timeline-today-offset-px"]).toBe("40px");
    expect(style?.cssProps["--db-timeline-today-offset-units"]).not.toBe("0");
  });
});
