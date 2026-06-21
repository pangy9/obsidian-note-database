import { describe, it, expect } from "vitest";
import type { ViewConfig } from "../data/types";

function makeCalendarConfig(overrides: Partial<ViewConfig> = {}): ViewConfig {
  return {
    id: "test",
    name: "Test",
    viewType: "calendar",
    schema: { columns: [], computedFields: [] },
    ...overrides,
  } as ViewConfig;
}

describe("calendar config defaults", () => {
  it("should have undefined calendarScale by default", () => {
    const config = makeCalendarConfig();
    expect(config.calendarScale).toBeUndefined();
  });

  it("should default calendarColumnSizeMode to undefined (adaptive)", () => {
    const config = makeCalendarConfig();
    expect(config.calendarColumnSizeMode).toBeUndefined();
  });

  it("should default calendarRowSizeMode to undefined (adaptive)", () => {
    const config = makeCalendarConfig();
    expect(config.calendarRowSizeMode).toBeUndefined();
  });

  it("should default calendarWeekSlotDuration to undefined (30min)", () => {
    const config = makeCalendarConfig();
    expect(config.calendarWeekSlotDuration).toBeUndefined();
  });

  it("should default day calendar time-window fields to undefined", () => {
    const config = makeCalendarConfig();
    expect(config.calendarDay).toBeUndefined();
    expect(config.calendarStartHour).toBeUndefined();
    expect(config.calendarEndHour).toBeUndefined();
    expect(config.calendarHourHeight).toBeUndefined();
  });

  it("should accept calendarScale week", () => {
    const config = makeCalendarConfig({ calendarScale: "week" });
    expect(config.calendarScale).toBe("week");
  });

  it("should accept calendarScale day and time-window fields", () => {
    const config = makeCalendarConfig({
      calendarScale: "day",
      calendarDay: "2026-06-10",
      calendarStartHour: 8,
      calendarEndHour: 20,
      calendarHourHeight: 56,
    });

    expect(config.calendarScale).toBe("day");
    expect(config.calendarDay).toBe("2026-06-10");
    expect(config.calendarStartHour).toBe(8);
    expect(config.calendarEndHour).toBe(20);
    expect(config.calendarHourHeight).toBe(56);
  });

  it("should accept calendarColumnSizeMode custom", () => {
    const config = makeCalendarConfig({ calendarColumnSizeMode: "custom", calendarCustomColumnWidth: 160 });
    expect(config.calendarColumnSizeMode).toBe("custom");
    expect(config.calendarCustomColumnWidth).toBe(160);
  });

  it("should accept calendarCustomRowHeights", () => {
    const config = makeCalendarConfig({ calendarCustomRowHeights: { "0": 120, "2": 180 } });
    expect(config.calendarCustomRowHeights).toEqual({ "0": 120, "2": 180 });
  });
});
