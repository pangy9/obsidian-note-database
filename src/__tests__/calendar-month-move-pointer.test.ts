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
    expect(calendarRenderer).toContain("private renderMonthRangePreview");
    // 避开 resize 把手（move/resize 共存）。
    expect(calendarRenderer).toContain('closest(".db-calendar-month-resize-handle")');
    // move 时 span 守恒，只动 segment-start。
    expect(calendarRenderer).toContain('"--db-calendar-segment-start"');
    expect(calendarRenderer).toContain('"--db-calendar-segment-span"');
    // 跨周 ghost 复用 month-ghost。
    expect(calendarRenderer).toContain("db-calendar-month-ghost");
  });

  it("previews wrapped month/week ranges by re-segmenting the whole event", () => {
    // A move/resize target may start in the current week but overflow into the next
    // week row. Preview must split that range into per-row ghost segments instead
    // of stretching one grid item into implicit columns.
    expect(calendarRenderer).toContain("this.renderMonthRangePreview({");
    expect(calendarRenderer).toContain("this.setCalendarEventPreviewHidden(container, segment.event.row.file.path, true)");
    expect(calendarRenderer).toContain("ghost.toggleClass(\"is-continuation\", options.startDateKey < firstKey)");
    expect(calendarRenderer).toContain("ghost.toggleClass(\"continues-after\", options.endDateKey > lastKey)");
    expect(calendarRenderer).not.toContain("if (target.grid === originGrid) {\n\t\t\t\tsegmentEl.style.setProperty(\"--db-calendar-segment-start\"");
    expect(styles).toContain(".db-calendar-month-segment.is-preview-hidden");
  });

  it("clamps preview lane to the target grid visible lanes", () => {
    // Adaptive month row heights can give each week a different visible lane
    // capacity. Move/resize preview must use the target grid's capacity rather
    // than blindly reusing the source segment lane, otherwise the ghost can
    // render outside the target week row.
    expect(calendarRenderer).toContain("weekEl.dataset.calendarVisibleLanes = String(visibleRowCount)");
    expect(calendarRenderer).toContain("stage.dataset.calendarVisibleLanes = String(visibleLanes)");
    expect(calendarRenderer).toContain("private getPreviewLaneForGrid");
    expect(calendarRenderer).toContain("Math.min(sourceLane, visibleLanes - 1)");
    expect(calendarRenderer).toContain("this.getPreviewLaneForGrid(grid, options.segment.lane) + 2");
    expect(calendarRenderer).not.toContain("ghost.style.setProperty(\"--db-calendar-segment-lane\", String(segment.lane + 2));");
  });

  it("does not count the +N overflow row against the month visible event lane setting", () => {
    // calendarMonthVisibleLanes is exposed as "events per day": a value of 3
    // should allow three event lanes, with the +N affordance added as an extra
    // row only when needed.
    expect(calendarRenderer).toContain("const visibleRowCount = Math.max(1, Math.min(layout.rowCount, laneLimit));");
    expect(calendarRenderer).toContain("const totalLaneRows = visibleRowCount + (hasOverflow ? 1 : 0);");
    expect(calendarRenderer).not.toContain("const reservedLanes = hasOverflow ? laneLimit - 1 : laneLimit;");
    expect(calendarRenderer).not.toContain("Math.min(layout.rowCount, reservedLanes)");
  });

  it("keeps month event lane spacing fixed when the week row has extra height", () => {
    // A taller adaptive/custom month row should leave blank space below the event
    // stack instead of stretching the rendered event lanes and making gaps look
    // larger when fewer events are present.
    expect(calendarRenderer).toContain("28px repeat(${totalLaneRows}, 22px) minmax(0, 1fr)");
    expect(calendarRenderer).not.toContain("repeat(${totalLaneRows}, minmax(22px, 1fr))");
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
