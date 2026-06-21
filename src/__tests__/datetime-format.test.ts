import { afterEach, describe, expect, it } from "vitest";
import {
  formatDateRangeDisplay,
  formatDateTimeRangeDisplay,
  formatDateValueDisplay,
  formatDateTimeValueDisplay,
  hasDateTimeValue,
  parseDateTimeParts,
  setDateDisplayMode,
  toDateTimestamp,
} from "../data/DateTimeFormat";

describe("date and datetime display formatting", () => {
  // 日期用人性化 locale 格式（Intl）。断言校验「年份是否显示」与时间分量，不绑定具体 locale 输出。
  // yearDisplayMode 三选项：always 恒显年（默认）/ smart 当年隐藏 / never 恒不显。
  afterEach(() => setDateDisplayMode("always"));

  it("always shows the year in always mode", () => {
    setDateDisplayMode("always");
    expect(formatDateValueDisplay("2026-06-04", { contextYear: 2026 })).toMatch(/2026/);
    expect(formatDateValueDisplay("2025-06-04", { contextYear: 2026 })).toMatch(/2025/);
  });

  it("hides the context year in smart mode (same year)", () => {
    setDateDisplayMode("smart");
    expect(formatDateValueDisplay("2026-06-04", { contextYear: 2026 })).not.toMatch(/\d{4}/);
    expect(formatDateValueDisplay("2025-06-04", { contextYear: 2026 })).toMatch(/2025/);
  });

  it("never shows the year in never mode", () => {
    setDateDisplayMode("never");
    expect(formatDateValueDisplay("2026-06-04", { contextYear: 2026 })).not.toMatch(/\d{4}/);
    expect(formatDateValueDisplay("2025-06-04", { contextYear: 2026 })).not.toMatch(/\d{4}/);
  });

  it("shows years in always-mode ranges and always when crossing years", () => {
    expect(formatDateRangeDisplay("2026-06-04", "2026-06-08", { contextYear: 2026 })).toMatch(/2026/);
    const crossYear = formatDateRangeDisplay("2026-12-31", "2027-01-01", { contextYear: 2026 });
    expect(crossYear).toMatch(/2026/);
    expect(crossYear).toMatch(/2027/);
  });

  it("hides context-year in same-year ranges under smart mode", () => {
    setDateDisplayMode("smart");
    expect(formatDateRangeDisplay("2026-06-04", "2026-06-08", { contextYear: 2026 })).not.toMatch(/\d{4}/);
  });

  it("keeps datetime complete with year and time (always mode)", () => {
    expect(formatDateTimeValueDisplay("2026-06-04T09:30:00", { mode: "full" })).toMatch(/2026/);
    expect(formatDateTimeValueDisplay("2026-06-04T09:30:00", { mode: "full" })).toMatch(/09:30/);
    expect(formatDateTimeValueDisplay("2026-06-04", { mode: "full", showTimeWhenMissing: true })).toMatch(/00:00/);
  });

  it("hides context-year for contextual datetime under smart mode", () => {
    setDateDisplayMode("smart");
    expect(formatDateTimeValueDisplay("2026-06-04T09:30:00", { mode: "contextual", contextYear: 2026 })).not.toMatch(/\d{4}/);
    expect(formatDateTimeValueDisplay("2026-06-04T09:30:00", { mode: "contextual", contextYear: 2026 })).toMatch(/09:30/);
    expect(formatDateTimeValueDisplay("2025-06-04T09:30:00", { mode: "contextual", contextYear: 2026 })).toMatch(/2025/);
  });

  it("datetime range shows start+end times when minutes present (D1)", () => {
    setDateDisplayMode("always");
    const result = formatDateTimeRangeDisplay("2026-06-04", "2026-06-05", 540, 600, { contextYear: 2026 });
    // 两端都带时间，且用连字符分隔
    expect(result).toMatch(/09:00/);
    expect(result).toMatch(/10:00/);
    expect(result).toMatch(/ - /);
  });

  it("datetime range falls back to plain date range when no minutes (date-only)", () => {
    setDateDisplayMode("always");
    const result = formatDateTimeRangeDisplay("2026-06-04", "2026-06-06", undefined, undefined, { contextYear: 2026 });
    // 纯日期范围，不含时间
    expect(result).not.toMatch(/\d{2}:\d{2}/);
    expect(result).toMatch(/2026/);
  });

  it("datetime range keeps year behavior consistent with date range", () => {
    setDateDisplayMode("smart");
    // 同年 smart 隐藏年份
    expect(formatDateTimeRangeDisplay("2026-06-04", "2026-06-05", 540, 600, { contextYear: 2026 })).not.toMatch(/\d{4}/);
    // 跨年始终显示年份
    const crossYear = formatDateTimeRangeDisplay("2026-12-31", "2027-01-01", 540, 600, { contextYear: 2026 });
    expect(crossYear).toMatch(/2026/);
    expect(crossYear).toMatch(/2027/);
  });

  it("datetime range handles only start minutes present", () => {
    setDateDisplayMode("always");
    // 只有 startMinutes（结束端无时间）→ 起始端带时间，结束端纯日期
    const result = formatDateTimeRangeDisplay("2026-06-04", "2026-06-05", 540, undefined, { contextYear: 2026 });
    expect(result).toMatch(/09:00/);
    // 结束端不含时间（只有一个 09:00）
    const timeMatches = result.match(/\d{2}:\d{2}/g);
    expect(timeMatches).toHaveLength(1);
  });
});

describe("toDateTimestamp normalization", () => {
  it("passes millisecond numbers through as absolute timestamps", () => {
    expect(toDateTimestamp(1717500000000)).toBe(1717500000000);
  });

  it("reads Date objects directly", () => {
    const d = new Date(2026, 5, 4, 9, 30);
    expect(toDateTimestamp(d)).toBe(d.getTime());
  });

  it("interprets date-only strings as local midnight", () => {
    expect(toDateTimestamp("2026-06-04")).toBe(new Date(2026, 5, 4, 0, 0).getTime());
  });

  it("interprets datetime strings as local wall-clock time", () => {
    expect(toDateTimestamp("2026-06-04T09:30")).toBe(new Date(2026, 5, 4, 9, 30).getTime());
  });

  it("falls back to numeric strings as timestamps", () => {
    expect(toDateTimestamp("1717500000000")).toBe(1717500000000);
  });

  it("returns null for unparseable or empty values", () => {
    expect(toDateTimestamp("not a date")).toBeNull();
    expect(toDateTimestamp("")).toBeNull();
    expect(toDateTimestamp(null)).toBeNull();
  });
});

describe("parseDateTimeParts handles millisecond numbers", () => {
  it("parses a millisecond timestamp into local date parts", () => {
    const parts = parseDateTimeParts(new Date(2026, 5, 4, 9, 30).getTime());
    expect(parts?.dateKey).toBe("2026-06-04");
    expect(parts?.time).toBe("09:30");
  });

  it("returns null for non-finite numbers", () => {
    expect(parseDateTimeParts(Number.NaN)).toBeNull();
  });
});

describe("parseDateTimeParts handles Obsidian YAML Date objects", () => {
  it("reads Date object date/time parts in UTC so UTC midnight stays midnight", () => {
    const parts = parseDateTimeParts(new Date(Date.UTC(2026, 10, 25, 0, 0)));
    expect(parts).toMatchObject({
      dateKey: "2026-11-25",
      time: "00:00",
    });
    expect(hasDateTimeValue(new Date(Date.UTC(2026, 10, 25, 0, 0)))).toBe(false);
    expect(hasDateTimeValue(new Date(Date.UTC(2026, 10, 25, 1, 30)))).toBe(true);
  });
});
