import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { buildTimelineModel, resolveTimelineUnitWidth, resolveTimelineViewportUnitCount } from "../data/CalendarTimelineModel";
import { getTimelinePanBufferUnits } from "../data/TimelinePan";
import type { ViewConfig } from "../data/types";
import { CalendarTimelineRenderer } from "../views/CalendarTimelineRenderer";
import { timelinePanPositionKey } from "../views/TimelinePanPositionStore";

vi.mock("obsidian", () => ({ Modal: class {}, TFile: class {}, WorkspaceWindow: class {}, Platform: { isMobile: false } }));
setLocale("en");

const config = (id: string, timelineContinuous = true): ViewConfig => ({
  id, name: id, sourceFolder: "", viewType: "timeline", timelineScale: "week", timelineContinuous,
  schema: { columns: [{ key: "due", label: "Due", type: "date" }], computedFields: [] },
});

describe("timeline navigation regressions", () => {
  afterEach(() => vi.useRealTimers());

  function mobileNavigation(scale: "day" | "week") {
    const view: ViewConfig = {
      ...config("mobile"), timelineScale: scale, timelineStartDateField: "due",
      schema: { columns: [{ key: "due", label: "Due", type: "datetime" }], computedFields: [] },
    };
    const width = 320;
    const unitWidth = resolveTimelineUnitWidth(view, scale);
    const buffer = getTimelinePanBufferUnits(width / unitWidth, true);
    const model = buildTimelineModel([], view, { visibleUnitCount: buffer * 3 });
    const jump = vi.fn();
    const renderer = new CalendarTimelineRenderer({ openRow: vi.fn(), updateTimelineAnchor: jump });
    const internal = renderer as unknown as {
      timelineObservedUnitCount: number | undefined;
      panState: { anchor: string; offset: number; minutes: number };
      goToTimelineToday: (c: ViewConfig, m: typeof model) => void;
      shiftTimeline: (c: ViewConfig, s: "week", delta: number, m: typeof model, distance: "long") => void;
    };
    internal.timelineObservedUnitCount = resolveTimelineViewportUnitCount(width, unitWidth, scale);
    return { view, model, jump, internal, visibleHours: width / unitWidth };
  }

  it("centers the current hour in the actual mobile viewport, not the touch buffer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 25, 12));
    const { view, model, jump, internal, visibleHours } = mobileNavigation("day");
    internal.goToTimelineToday(view, model);
    expect(jump).toHaveBeenCalledWith("2026-11-25", expect.any(String), 600);
    expect(600 + visibleHours * 60).toBeGreaterThan(720);
  });

  it("keeps mobile fast navigation overlapping the actual visible days", () => {
    const { view, model, jump, internal } = mobileNavigation("week");
    internal.panState = { anchor: "2026-11-24", minutes: 0, offset: 0 };
    internal.shiftTimeline(view, "week", 1, model, "long");
    // A four-day viewport moves three days: from Nov 24 to Nov 27, saved with its center anchor.
    expect(jump).toHaveBeenCalledWith("2026-11-28", expect.any(String), undefined);
  });

  it("uses the visible first date for a keyboard the same way it previews focus", () => {
    const create = vi.fn();
    const renderer = new CalendarTimelineRenderer({ createEntryForDate: create, openRow: vi.fn() });
    vi.stubGlobal("window", { getComputedStyle: () => ({ getPropertyValue: () => "100px" }) });
    try {
      const viewport = { clientLeft: 0, getBoundingClientRect: () => ({ left: 200 }) };
      let left = -400;
      const props = vi.fn();
      const button = {
        getBoundingClientRect: () => ({ left, width: 1800 }), closest: () => viewport,
        setCssProps: props, addClass: vi.fn(), removeClass: vi.fn(), matches: () => true,
        onfocus: () => {}, onclick: (_event: unknown) => {},
      };
      const internal = renderer as unknown as { setupTimelineCreateRow(
        el: unknown, c: ViewConfig, m: { startDateKey: string; totalUnits: number; scale: string }, group: string
      ): () => void };
      const refreshPreview = internal.setupTimelineCreateRow(button, config("A"), { startDateKey: "2026-11-01", totalUnits: 18, scale: "week" }, "");
      const click = (clientX: number, detail: number) => button.onclick({ clientX, detail, preventDefault() {}, stopPropagation() {} });
      button.onfocus();
      expect(props).toHaveBeenLastCalledWith(expect.objectContaining({ "--db-timeline-create-offset": "7" }));
      click(0, 0);
      expect(create.mock.lastCall?.[1]).toBe("2026-11-07");
      click(450, 1);
      expect(create.mock.lastCall?.[1]).toBe("2026-11-09");
      left = -500;
      refreshPreview();
      expect(props).toHaveBeenLastCalledWith(expect.objectContaining({ "--db-timeline-create-offset": "8" }));
      click(0, 0);
      expect(create.mock.lastCall?.[1]).toBe("2026-11-08");
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not clear view A's saved pan when jumping in a non-continuous view B", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k), setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) };
    const target = { addEventListener() {}, removeEventListener() {} };
    const win = { ...target, localStorage: storage, getComputedStyle: () => ({}), setTimeout, clearTimeout };
    const document = { ...target, defaultView: win };
    const container = { ownerDocument: document, getBoundingClientRect: () => ({ width: 600 }), toggleClass() {} } as unknown as HTMLElement;
    const renderer = new CalendarTimelineRenderer({ openRow: vi.fn() });
    const stop = new Error("stop after preparing storage");
    // A simulated layout stops only after the position store is selected. No render UI or vault needed.
    const instance = renderer as unknown as {
      getTimelineRenderSignature(...args: unknown[]): string;
      getTimelineNavigationSignature(...args: unknown[]): string;
    };
    const oldSignature = instance.getTimelineRenderSignature.bind(renderer);
    vi.spyOn(instance, "getTimelineRenderSignature").mockImplementation((...args) => oldSignature(...args));
    vi.spyOn(instance, "getTimelineNavigationSignature").mockImplementation(() => { throw stop; });
    vi.stubGlobal("window", win);
    try {
      expect(() => renderer.renderTimeline(container, config("A"), [])).toThrow(stop);
      // Stop the next render at its DOM before creating a view. Runtime position identity has already been prepared.
      const earlyStop = new Error("after layout");
      container.toggleClass = () => { throw earlyStop; };
      expect(() => renderer.renderTimeline(container, config("B", false), [])).toThrow(earlyStop);
      const a = timelinePanPositionKey("", "", "A");
      const b = timelinePanPositionKey("", "", "B");
      values.set(a, "pan in A"); values.set(b, "pan in B");
      renderer.navigateToTimelineDate("2026-11-25");
      expect(values.get(a)).toBe("pan in A");
      expect(values.has(b)).toBe(false);
    } finally { renderer.destroy(); vi.unstubAllGlobals(); }
  });

  it("renders an old incompatible Day snapshot without reentering a configuration callback", () => {
    const onConfigChange = vi.fn();
    const renderer = new CalendarTimelineRenderer({ openRow: vi.fn(), onConfigChange });
    const stop = new Error("layout after normalization");
    const candidate: ViewConfig = { ...config("A", false), timelineScale: "day" };
    vi.spyOn(renderer as unknown as { getTimelineRenderUnitWidth: (v: ViewConfig, scale: string) => number }, "getTimelineRenderUnitWidth")
      .mockImplementation((_view, scale) => { expect(scale).toBe("week"); throw stop; });
    expect(() => renderer.renderTimeline({ ownerDocument: { defaultView: null } } as unknown as HTMLElement, candidate, [])).toThrow(stop);
    expect(onConfigChange).not.toHaveBeenCalled();
    expect(candidate.timelineScale).toBe("day");
  });
});
