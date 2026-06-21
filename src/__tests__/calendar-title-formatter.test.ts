import { describe, expect, it } from "vitest";
import { buildTimelineAxisBands, buildTimelineMonthBands, formatCalendarTitleParts } from "../data/CalendarTitleFormatter";

describe("calendar title formatter", () => {
  it("formats English day and month titles as main text plus a lighter year", () => {
    expect(formatCalendarTitleParts({ scale: "day", startDateKey: "2026-06-15", locale: "en" })).toEqual({
      main: "June 15",
      year: "2026",
      ariaLabel: "June 15 2026",
    });

    expect(formatCalendarTitleParts({ scale: "month", startDateKey: "2026-06-01", locale: "en" })).toEqual({
      main: "June",
      year: "2026",
      ariaLabel: "June 2026",
    });

    expect(formatCalendarTitleParts({ scale: "week", startDateKey: "2026-06-15", endDateKey: "2026-06-21", locale: "en" })).toEqual({
      main: "June 15 — 21",
      year: "2026",
      ariaLabel: "June 15 — 21 2026",
    });
  });

  it("formats quarter titles as month ranges instead of quarter labels", () => {
    expect(formatCalendarTitleParts({ scale: "quarter", startDateKey: "2026-04-01", endDateKey: "2026-06-30", locale: "en" })).toEqual({
      main: "April — June",
      year: "2026",
      ariaLabel: "April — June 2026",
    });

    expect(formatCalendarTitleParts({ scale: "quarter", startDateKey: "2026-04-01", endDateKey: "2026-06-30", locale: "zh-CN" })).toEqual({
      main: "四月 — 六月",
      year: "2026",
      ariaLabel: "四月 — 六月 2026",
    });
  });

  it("formats Chinese day and week titles with Chinese month-day text", () => {
    expect(formatCalendarTitleParts({ scale: "day", startDateKey: "2026-06-15", locale: "zh-CN" })).toEqual({
      main: "六月十五日",
      year: "2026",
      ariaLabel: "六月十五日 2026",
    });

    expect(formatCalendarTitleParts({ scale: "week", startDateKey: "2026-06-15", endDateKey: "2026-06-21", locale: "zh-TW" })).toEqual({
      main: "六月十五日 — 二十一日",
      year: "2026",
      ariaLabel: "六月十五日 — 二十一日 2026",
    });
  });

  it("formats visible timeline ranges when day or month windows cross boundaries", () => {
    expect(formatCalendarTitleParts({ scale: "day", startDateKey: "2026-06-20", endDateKey: "2026-06-21", locale: "en" })).toEqual({
      main: "June 20 — 21",
      year: "2026",
      ariaLabel: "June 20 — 21 2026",
    });
    expect(formatCalendarTitleParts({ scale: "day", startDateKey: "2026-06-30", endDateKey: "2026-07-01", locale: "zh-CN" })).toEqual({
      main: "六月三十日 — 七月一日",
      year: "2026",
      ariaLabel: "六月三十日 — 七月一日 2026",
    });
    expect(formatCalendarTitleParts({ scale: "month", startDateKey: "2026-06-20", endDateKey: "2026-07-12", locale: "en" })).toEqual({
      main: "June — July",
      year: "2026",
      ariaLabel: "June — July 2026",
    });
  });

  it("builds non-redundant timeline month bands", () => {
    expect(buildTimelineMonthBands({ scale: "month", startDateKey: "2026-06-01", endDateKey: "2026-06-30", locale: "zh-CN" })).toEqual([]);
    expect(buildTimelineMonthBands({ scale: "week", startDateKey: "2026-06-15", endDateKey: "2026-06-21", locale: "en" })).toEqual([]);
    expect(buildTimelineMonthBands({ scale: "week", startDateKey: "2026-06-29", endDateKey: "2026-07-05", locale: "en" })).toEqual([
      { label: "July", span: 5, offset: 2 },
    ]);
    expect(buildTimelineMonthBands({ scale: "quarter", startDateKey: "2026-04-01", endDateKey: "2026-06-30", locale: "zh-CN" })).toEqual([
      { label: "四月", span: 30, offset: 0 },
      { label: "五月", span: 31, offset: 30 },
      { label: "六月", span: 30, offset: 61 },
    ]);
    expect(buildTimelineMonthBands({ scale: "quarter", startDateKey: "2026-03-30", endDateKey: "2026-06-30", locale: "zh-CN" })).toEqual([
      { label: "四月", span: 30, offset: 2 },
      { label: "五月", span: 31, offset: 32 },
      { label: "六月", span: 30, offset: 63 },
    ]);
  });

  it("builds timeline axis bands at midnight and month starts", () => {
    expect(buildTimelineAxisBands({
      scale: "day",
      startDateKey: "2026-06-20",
      endDateKey: "2026-06-21",
      startMinutes: 22 * 60,
      totalUnits: 6,
      locale: "en",
    })).toEqual([
      { label: "June 21", span: 4, offset: 2 },
    ]);
    expect(buildTimelineAxisBands({
      scale: "week",
      startDateKey: "2026-06-29",
      endDateKey: "2026-07-05",
      locale: "zh-CN",
    })).toEqual([
      { label: "七月", span: 5, offset: 2 },
    ]);
    expect(buildTimelineAxisBands({
      scale: "month",
      startDateKey: "2026-06-01",
      endDateKey: "2026-06-30",
      locale: "en",
    })).toEqual([
      { label: "June", span: 30, offset: 0 },
    ]);
    expect(buildTimelineAxisBands({
      scale: "month",
      startDateKey: "2026-06-20",
      endDateKey: "2026-07-12",
      locale: "en",
    })).toEqual([
      { label: "July", span: 12, offset: 11 },
    ]);
  });
});
