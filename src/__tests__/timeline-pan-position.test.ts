import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { TimelinePanPosition, TimelinePanPositionStore, timelinePanPositionKey } from "../views/TimelinePanPositionStore";

const navigation = '["day","2026-11-18",1380,0]';
const position: TimelinePanPosition = { navigation, anchor: "2027-01-01", minutes: 30, offsetUnits: -0.375 };
function fixture(key = "view-a") {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { values.set(k, v); }), removeItem: vi.fn((k: string) => { values.delete(k); }) };
  const timers = { setTimeout: (fn: TimerHandler, ms?: number) => Number(setTimeout(fn as () => void, ms)), clearTimeout: (id?: number) => clearTimeout(id) };
  return { values, storage, timers, store: new TimelinePanPositionStore(storage, timers, key) };
}
afterEach(() => vi.useRealTimers());

describe("persistent local timeline browsing position", () => {
  it("batches a burst of scrolling into one write after 600 ms", () => {
    const f = fixture();
    for (let i = 0; i < 25; i++) { f.store.schedule({ ...position, offsetUnits: i / 10 }); vi.advanceTimersByTime(20); }
    expect(f.storage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
    expect(f.store.load(navigation)?.offsetUnits).toBe(2.4);
  });
  it("restores the date, minute and fractional column offset in a new instance", () => {
    const f = fixture(); f.store.schedule(position); f.store.flush();
    expect(new TimelinePanPositionStore(f.storage, f.timers, "view-a").load(navigation)).toEqual(position);
    expect(f.store.load("a new explicit anchor or scale")).toBeUndefined();
  });
  it("flushes pending position before the debounce and cancels the timer", () => {
    const f = fixture(); f.store.schedule(position); f.store.flush(); vi.runAllTimers();
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  });
  it("does not rewrite an unchanged position or the initial render", () => {
    const f = fixture(); expect(f.store.load(navigation)).toBeUndefined(); vi.runAllTimers();
    expect(f.storage.setItem).not.toHaveBeenCalled();
    f.store.schedule(position); f.store.flush(); f.store.schedule(position); vi.runAllTimers();
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  });
  it("clears pending and saved pans for Today or explicit date navigation", () => {
    const f = fixture(); f.store.schedule(position); f.store.flush(); f.store.schedule({ ...position, offsetUnits: 2 });
    f.store.clear(); vi.runAllTimers(); expect(f.store.load(navigation)).toBeUndefined();
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  });
  it("cancels a pending write when the user pans back to the saved position", () => {
    const f = fixture(); f.store.schedule(position); f.store.flush();
    f.store.schedule({ ...position, offsetUnits: 3 }); f.store.schedule(position); vi.runAllTimers();
    expect(f.storage.setItem).toHaveBeenCalledTimes(1);
  });
  it.each(["null", "broken JSON", JSON.stringify({ ...position, anchor: "bad" }), JSON.stringify({ ...position, minutes: -1 }), JSON.stringify({ ...position, offsetUnits: "2" })])("ignores corrupt storage: %s", raw => {
    const f = fixture(); f.values.set("view-a", raw); expect(f.store.load(navigation)).toBeUndefined();
  });
  it("keeps vaults, database files and views isolated, ignoring resource cache timestamps", () => {
    const key = timelinePanPositionKey("app://vault?123", "database.md", "view-a");
    expect(key).toBe(timelinePanPositionKey("app://vault?456", "database.md", "view-a"));
    expect(key).not.toBe(timelinePanPositionKey("app://other", "database.md", "view-a"));
    expect(key).not.toBe(timelinePanPositionKey("app://vault", "other.md", "view-a"));
    expect(key).not.toBe(timelinePanPositionKey("app://vault", "database.md", "view-b"));
  });
  it("survives unavailable storage and retries a failed write", () => {
    const f = fixture(); f.storage.setItem.mockImplementationOnce(() => { throw Error("quota"); });
    f.store.schedule(position); expect(() => f.store.flush()).not.toThrow(); f.store.flush();
    expect(f.store.load(navigation)).toEqual(position);
    const broken = new TimelinePanPositionStore({ getItem: () => { throw Error("denied"); }, setItem: () => { throw Error("denied"); }, removeItem: () => { throw Error("denied"); } }, f.timers, "broken");
    expect(broken.load(navigation)).toBeUndefined(); expect(() => broken.clear()).not.toThrow();
  });
  it("routes full-view and embedded search jumps through pan reset and reveals real events", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    const jump = renderer.slice(renderer.indexOf("  navigateToTimelineDate("), renderer.indexOf("  private getTimelineAnchorTimeMinutes("));
    expect(jump).toMatch(/panPositionStore\?\.clear\(\);\s*this\.panState = undefined;\s*this\.actions\.updateTimelineAnchor/);
    for (const file of ["DatabaseView.ts", "EmbeddedDatabaseRenderer.ts"]) {
      const source = readFileSync(new URL(`../views/${file}`, import.meta.url), "utf8");
      expect(source).toContain("this.calendarTimelineRenderer.navigateToTimelineDate(item.startDateKey, timeMinutes)");
      expect(source).toContain("[data-note-database-row-path]:not(.db-timeline-window-jump)");
    }
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.db-timeline-scroll:focus-visible \.db-timeline-axis\s*\{\s*box-shadow: inset/);
  });
  it("wires full views and embeds to a stable source and flushes on teardown/pagehide", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    expect(renderer).toContain("offset: (saved?.offsetUnits || 0) * unitWidth");
    expect(renderer).toContain("offsetUnits: this.panState.offset / unitWidth");
    expect(renderer).toContain("if (!scroll.isConnected || this.timelineRoot !== wrap) return;");
    expect(renderer).toContain('win.addEventListener("pagehide", flush)');
    expect(renderer).toContain('win.removeEventListener("pagehide", flush)');
    expect(renderer.slice(renderer.indexOf("  destroy():"), renderer.indexOf("  renderTimeline("))).toContain("this.panPositionStore?.flush()");
    for (const file of ["DatabaseView.ts", "EmbeddedDatabaseRenderer.ts"]) {
      const source = readFileSync(new URL(`../views/${file}`, import.meta.url), "utf8"); expect(source).toContain("getTimelinePositionSource: () =>");
    }
  });
});
