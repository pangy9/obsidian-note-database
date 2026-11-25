import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getTimelineJumpVisibility, getTimelinePanBufferUnits, getTimelinePanVisibleRange, getTimelineScaleAnchor, normalizeTimelinePanOffset, resolveTimelinePanRecenter, shiftTimelinePanAnchor } from "../data/TimelinePan";
import { buildCalendarTimelineSearchResults } from "../data/CalendarTimelineSearchResults";
import { buildTimelineTicks } from "../data/CalendarTimelineModel";
import type { RowData, ViewConfig } from "../data/types";
import { addDateKeyDays } from "../data/CalendarDateTime";

describe("continuous timeline window", () => {
  it("does not rebase while scrolling inside the buffer", () => {
    expect(resolveTimelinePanRecenter(1100, 1000, 15, 1000, 3000)).toBeNull();
  });
  it.each([1801.25, 2999.5, 1.75, 300])("preserves the date under each fractional pixel at %s", left => {
    const result = resolveTimelinePanRecenter(left, 1000, 15, 1000, 3000)!;
    expect(result).not.toBeNull();
    expect(result.units * 15 + 1000 + result.remainder).toBeCloseTo(left, 10);
    expect(Math.abs(result.remainder)).toBeLessThan(15);
  });
  it.each([[270, 180, 2], [80, 180, 1], [360, 180, 2], [361, 180, 3]])(
    "leaves room to rebase in both directions at %dpx with %dpx columns", (viewport, width, expectedBuffer) => {
      const buffer = getTimelinePanBufferUnits(viewport / width);
      expect(buffer).toBe(expectedBuffer);
      const content = buffer * 3 * width;
      const center = buffer * width;
      const maxLeft = content - viewport;
      const next = resolveTimelinePanRecenter(maxLeft, center, width, viewport, content)!;
      const prev = resolveTimelinePanRecenter(0, center, width, viewport, content)!;
      expect(next?.units).toBeGreaterThanOrEqual(1);
      expect(prev?.units).toBeLessThanOrEqual(-1);
      expect(center + next.units * width + next.remainder).toBe(maxLeft);
      expect(center + prev.units * width + prev.remainder).toBe(0);
    },
  );
  it("keeps the original visible wall-clock time when reopening at a smaller width", () => {
    const pan = normalizeTimelinePanOffset("2026-11-18", 420, "day", 11.5 * 60, 60);
    expect(pan).toEqual({ anchor: "2026-11-18", minutes: 1080, offset: 30 });
    const narrow = getTimelinePanBufferUnits(312 / 60);
    const start = shiftTimelinePanAnchor(pan.anchor, pan.minutes, "day", -narrow);
    expect(getTimelinePanVisibleRange(start.dateKey, start.minutes, "day", narrow * 60 + pan.offset, 312, 60).startMinutes).toBe(1110);
    expect(normalizeTimelinePanOffset("2026-11-18", 0, "week", -725, 80)).toEqual({ anchor: "2026-11-09", minutes: 0, offset: -5 });
  });
  it("gives events outside the viewport a jump even when they are inside the render buffer", () => {
    expect(getTimelineJumpVisibility(100, 120, 150, 290)).toEqual({ before: true, after: false, overlaps: false });
    expect(getTimelineJumpVisibility(120, 300, 150, 290)).toEqual({ before: true, after: true, overlaps: true });
    expect(getTimelineJumpVisibility(150, 290, 150, 290)).toEqual({ before: false, after: false, overlaps: true });
  });
  it("continues across years and leap days in either direction", () => {
    expect(shiftTimelinePanAnchor("2026-12-31", 0, "quarter", 1).dateKey).toBe("2027-01-01");
    expect(shiftTimelinePanAnchor("2028-03-01", 0, "month", -1).dateKey).toBe("2028-02-29");
    let anchor = "2026-11-18";
    for (let i = 0; i < 1000; i++) anchor = shiftTimelinePanAnchor(anchor, 0, "week", 37).dateKey;
    expect(anchor).toBe(addDateKeyDays("2026-11-18", 37000));
  });
  it("allocates several view widths for mobile native scrolling without enlarging the desktop buffer", () => {
    expect(getTimelinePanBufferUnits(3.15)).toBe(4);
    expect(getTimelinePanBufferUnits(3.15, true)).toBe(13);
  });
  it("normalizes day-scale hours across midnight", () => {
    expect(shiftTimelinePanAnchor("2026-11-18", 30, "day", -1)).toEqual({ dateKey: "2026-11-17", minutes: 1410 });
    expect(shiftTimelinePanAnchor("2026-12-31", 1410, "day", 2)).toEqual({ dateKey: "2027-01-01", minutes: 90 });
  });
  it("ignores zero-sized and invalid layouts", () => {
    expect(resolveTimelinePanRecenter(0, 1000, 0, 1000, 3000)).toBeNull();
    expect(resolveTimelinePanRecenter(NaN, 1000, 15, 1000, 3000)).toBeNull();
  });
  it("keeps the native scroll node during rebase and avoids persistent config writes", () => {
    const source = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    expect(source).toContain('reusableRoot?.querySelector<HTMLElement>(".db-timeline-scroll")');
    expect(source).toContain("getTimelinePanBufferUnits(visibleUnitSpan ?? visibleUnitCount, nativeTouch)");
    expect(source).toContain("if (!reusableRoot) this.renderTimelineHeader(wrap, config, model);");
    expect(source).not.toContain('wrap.querySelector(".db-timeline-header")?.remove()');
    expect(source).toContain("continuous ? bufferUnits * 3");
    expect(source).toContain("const center = bufferUnits * unitWidth");
    const pan = source.slice(source.indexOf("  private installTimelinePan("), source.indexOf("  private getPannedConfig("));
    expect(pan).toContain("this.renderTimeline(container, config, rows, true)");
    expect(pan).not.toContain("onConfigChange");
    expect(pan).not.toContain("updateTimelineAnchor");
  });
  it("does not round a partial hour into the next day", () => {
    expect(getTimelinePanVisibleRange("2026-11-18", 660, "day", 0, 732, 60)).toEqual({
      startDateKey: "2026-11-18", endDateKey: "2026-11-18", startMinutes: 660, endMinutes: 1392,
    });
  });
  it("includes both partially visible date columns", () => {
    expect(getTimelinePanVisibleRange("2026-11-18", 0, "week", 90, 120, 100)).toEqual({ startDateKey: "2026-11-18", endDateKey: "2026-11-20", startMinutes: 1296, endMinutes: 144 });
  });
  it("retains an exclusive midnight endpoint for searching", () => {
    expect(getTimelinePanVisibleRange("2026-11-18", 1380, "day", 0, 60, 60)).toEqual({
      startDateKey: "2026-11-18", endDateKey: "2026-11-19", startMinutes: 1380, endMinutes: 0,
    });
  });
  it("roundtrips the opt-in setting through database files", () => {
    const source = readFileSync(new URL("../data/DataSource.ts", import.meta.url), "utf8");
    expect(source).toContain('timelineContinuous: typeof v["timelineContinuous"] === "boolean" ? v["timelineContinuous"] : undefined');
    expect(source).toContain('timelineContinuous: view.timelineContinuous,');
    expect(source).toContain('"timelineContinuous",');
  });
});

describe("timeline scales share the browsed position", () => {
  it("uses the panned date across a month or year boundary", () => {
    expect(getTimelineScaleAnchor("2026-12-31", 480, "month", 8.9))
      .toEqual({ dateKey: "2027-01-08", minutes: 480, fraction: 0 });
    expect(getTimelineScaleAnchor("2026-01-01", 480, "week", -0.25).dateKey).toBe("2025-12-31");
  });

  it("keeps the wall-clock minute when going day → week → day across midnight", () => {
    const day = getTimelineScaleAnchor("2026-12-31", 1380, "day", 1.5);
    expect(day).toEqual({ dateKey: "2027-01-01", minutes: 30, fraction: 0.5 });
    expect(getTimelineScaleAnchor(day.dateKey, day.minutes, "week", 0)).toEqual(day);
  });

  it("only hands off after scale validation and does not store the browsed date in the shared definition", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    const handoff = renderer.slice(renderer.indexOf("  preserveTimelineScalePosition("), renderer.indexOf("  private getTimelineNavigationSignature("));
    expect(handoff).toContain("this.panPositionStore?.schedule");
    expect(handoff).not.toContain("config.timelineAnchor =");
    for (const file of ["DatabaseView.ts", "EmbeddedDatabaseRenderer.ts"]) {
      const host = readFileSync(new URL(`../views/${file}`, import.meta.url), "utf8");
      const change = host.slice(host.indexOf("updateTimelineScale(scale: NonNullable"), host.indexOf("  private updateCalendarScale("));
      expect(change.indexOf("return false;")).toBeLessThan(change.indexOf(".preserveTimelineScalePosition("));
      expect(change.indexOf(".preserveTimelineScalePosition(")).toBeLessThan(change.indexOf("config.timelineScale = scale;"));
    }
  });
});

it("preserves the same quarterly tick dates inside overlapping buffers after a non-week rebase", () => {
  const config: ViewConfig = { name: "Continuous", sourceFolder: "", timelineContinuous: true, schema: { columns: [], computedFields: [] } };
  const ticks = (startDateKey: string) => buildTimelineTicks({
    startDateKey, endDateKey: "2026-11-25", totalUnits: 90, unit: "day",
  }, "quarter", config).map(tick => tick.dateKey);
  const stable = ticks("2026-09-02").filter(key => key >= "2026-10-02");
  expect(ticks("2026-10-02")).toEqual(stable);
  expect(stable[0]).toBe("2026-10-05");
});

it("counts a timed record only while the visible fragment of its day overlaps the event", () => {
  const config: ViewConfig = { name: "Continuous", sourceFolder: "", viewType: "timeline", timelineStartDateField: "start", timelineEndDateField: "end",
    schema: { columns: [{ key: "start", label: "Start", type: "datetime" }, { key: "end", label: "End", type: "datetime" }], computedFields: [] } };
  const rows: RowData[] = [{ file: { path: "Record.md", basename: "Record" } as RowData["file"], computed: {},
    frontmatter: { start: "2026-11-21T23:20", end: "2026-11-21T23:50" } }];
  const visibleCountAt = (width: number) => buildCalendarTimelineSearchResults(rows, config, getTimelinePanVisibleRange("2026-11-18", 0, "week", 0, width, 100)).visibleCount;
  expect(visibleCountAt(395)).toBe(0);
  expect(visibleCountAt(398)).toBe(1);
});

it("anchors the idle create label to the visible edge of a continuous timeline", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  expect(css).toContain("--db-timeline-create-view-left: var(--db-timeline-scroll-left, 0px);");
  expect(css).toMatch(/\.is-continuous \.db-timeline-create-button:not\(\.is-previewing\):not\(:focus-visible\) \.db-timeline-create-content\s*\{\s*--db-timeline-create-content-left: var\(--db-timeline-create-view-left\)/);
});

it("keeps date ticks in a continuous quarter when less than a week fits", () => {
  const config: ViewConfig = { name: "Continuous", sourceFolder: "", timelineContinuous: true, schema: { columns: [], computedFields: [] } };
  const ticks = buildTimelineTicks({
    startDateKey: "2026-11-17", endDateKey: "2026-12-05", totalUnits: 19, unit: "day",
  }, "quarter", config, "en", 5.75);
  expect(ticks.slice(0, 3).map(tick => tick.dateKey)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
});
