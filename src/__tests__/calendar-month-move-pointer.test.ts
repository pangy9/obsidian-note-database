import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 项目无 jsdom，无法实例化 CalendarRenderer；沿用 calendar-drop-no-change.test.ts 的
// source-level 契约测试模式（读源码断言关键结构），锁定月视图 move 从 HTML5 drag 迁移到
// pointer 后的不变量，防止回归。

describe("calendar month/week move (pointer, not HTML5 drag)", () => {
  const calendarRenderer = readFileSync(new URL("../views/CalendarRenderer.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

  it("removes HTML5 drag infrastructure from calendar segments", () => {
    expect(calendarRenderer).not.toContain("setupEventDrag");
    expect(calendarRenderer).not.toContain("setupDayDropZone");
    expect(calendarRenderer).not.toContain("CALENDAR_EVENT_MIME");
    expect(calendarRenderer).not.toContain("setDragGhost");
    expect(calendarRenderer).not.toContain("cleanupDragGhost");
    expect(calendarRenderer).not.toContain("readDragPayload");
    expect(calendarRenderer).not.toContain("monthResizeInProgress");
    expect(calendarRenderer).not.toContain("activeDragPayload");
    expect(calendarRenderer).not.toContain("element.draggable = true");
    // CalendarDragPayload / CalendarEventDragInfo / getDragInfo 已随 HTML5 drag 删除。
    expect(calendarRenderer).not.toContain("interface CalendarDragPayload");
    expect(calendarRenderer).not.toContain("interface CalendarEventDragInfo");
    expect(calendarRenderer).not.toContain("private getDragInfo");
    // drag-ghost CSS 已删。
    expect(styles).not.toContain("db-calendar-drag-ghost");
  });

  it("adds pointer-based beginMonthMove with snapping + cross-week ghost", () => {
    expect(calendarRenderer).toContain("private beginMonthMove");
    expect(calendarRenderer).toContain("private attachMonthMoveHandler");
    expect(calendarRenderer).toContain("private resolveMonthMoveTarget");
    // 避开 resize 把手（move/resize 共存）。
    expect(calendarRenderer).toContain('closest(".db-calendar-month-resize-handle")');
    // move 时 span 守恒，只动 segment-start。
    expect(calendarRenderer).toContain('"--db-calendar-segment-start"');
    expect(calendarRenderer).toContain('"--db-calendar-segment-span"');
    // 跨周 ghost 复用 month-ghost。
    expect(calendarRenderer).toContain("db-calendar-month-ghost");
  });

  it("move preserves span (durationDays) and transmits time components", () => {
    // onUp 提交：换日期保时长 + 透传时刻（datetime 不丢时间）。
    expect(calendarRenderer).toContain("resolveDayMoveChange({");
    expect(calendarRenderer).toContain("durationDays - 1");
    expect(calendarRenderer).toContain("startMinutes: segment.event.startMinutes");
    expect(calendarRenderer).toContain("endMinutes: segment.event.endMinutes");
  });

  it("parameterizes move target for month week rows and week all-day stage", () => {
    expect(calendarRenderer).toContain('".db-calendar-month-week"');
    expect(calendarRenderer).toContain('".db-calendar-day"');
    expect(calendarRenderer).toContain('".db-calendar-week-allday-cols"');
    expect(calendarRenderer).toContain('".db-calendar-week-allday-col"');
  });

  it("keeps timed pointer drag helpers (renderDropSnap / clearAllDropTargets)", () => {
    // timed 事件拖拽仍用这些，不能随 HTML5 drag 删除一起误删。
    expect(calendarRenderer).toContain("private renderDropSnap");
    expect(calendarRenderer).toContain("private clearAllDropTargets");
  });

  it("adds is-moving shadow style (mirrors is-resizing)", () => {
    expect(styles).toContain(".db-calendar-month-segment.is-moving");
    // drop-snap 仍保留（timed drag 用）。
    expect(styles).toContain(".db-calendar-drop-snap");
  });
});
