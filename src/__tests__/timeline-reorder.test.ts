import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { compareTimelineManualOrder, isInvalidEventRange, resolveTimelineReorderNeighbors } from "../data/CalendarTimelineModel";
import type { CalendarTimelineEvent } from "../data/CalendarTimelineModel";
import { collectInvalidTimelineEvents, InvalidTimelineEventsScanner } from "../data/InvalidTimeEvents";
import type { RowData, ViewConfig } from "../data/types";

// Bug 4 方案 B：时间线默认（无显式排序）按 manual order 排——manual rank 主导，
// 无 rank 时回退 rows 顺序（order 字段），不再按日期序。日期序需用户在排序选项里
// 显式选择（届时走 hasActiveTimelineSort → compareTimelineEventOrder）。
// 因此 lane 内任意事件都可拖拽重排，不限于同日期。

// 构造最小 CalendarTimelineEvent —— compareTimelineManualOrder 只用到 order/manualRank。
function makeEvent(
  overrides: Partial<CalendarTimelineEvent> & { filePath: string }
): CalendarTimelineEvent {
  const startDateKey = overrides.startDateKey ?? "2026-01-01";
  return {
    id: overrides.filePath,
    title: overrides.filePath,
    row: {} as CalendarTimelineEvent["row"],
    startDateKey,
    endDateKey: startDateKey,
    offsetUnits: 0,
    durationUnits: 1,
    durationDays: 1,
    order: 0,
    ...overrides,
  } as CalendarTimelineEvent;
}

describe("compareTimelineManualOrder — manual order dominates, no date ordering (Bug 4 方案 B)", () => {
  it("orders by manual rank when both events have one", () => {
    const a = makeEvent({ filePath: "a.md", order: 0, manualRank: "b" });
    const b = makeEvent({ filePath: "b.md", order: 1, manualRank: "a" });
    // b.rank "a" < a.rank "b" → b 在前 → compare(a, b) > 0
    expect(compareTimelineManualOrder(a, b)).toBeGreaterThan(0);
    expect(compareTimelineManualOrder(b, a)).toBeLessThan(0);
  });

  it("falls back to row order (not date) when neither has a manual rank", () => {
    const a = makeEvent({ filePath: "a.md", order: 0, startDateKey: "2026-01-02" });
    const b = makeEvent({ filePath: "b.md", order: 1, startDateKey: "2026-01-01" });
    // 无 rank → order: a.order 0 < b.order 1 → a 在前。即使 b 日期更早也不按日期。
    expect(compareTimelineManualOrder(a, b)).toBeLessThan(0);
  });

  it("falls back to row order when only one event has a manual rank", () => {
    const a = makeEvent({ filePath: "a.md", order: 0, manualRank: "z" });
    const b = makeEvent({ filePath: "b.md", order: 1 });
    // 部分 rank → fallback order → a 在前。
    expect(compareTimelineManualOrder(a, b)).toBeLessThan(0);
  });

  it("manual rank overrides both row order and date", () => {
    const a = makeEvent({ filePath: "a.md", order: 5, startDateKey: "2026-01-10", manualRank: "a" });
    const b = makeEvent({ filePath: "b.md", order: 0, startDateKey: "2026-01-01", manualRank: "b" });
    // a.rank "a" < b.rank "b" → a 在前，即使 a 的 order 更大、日期更晚。
    expect(compareTimelineManualOrder(a, b)).toBeLessThan(0);
  });

  it("orders ranks by ASCII byte order (case-sensitive), matching LexoRank — not localeCompare", () => {
    // LexoRank ASCII：'MM' < 'Ma'（M=77 < a=97）。localeCompare 不区分大小写会把 Ma 当 MA < MM，排错。
    // 这是「拖拽后 ranks 改了但 lane 排序与 sortByManualRank 不一致、视图不刷新」的根因。
    const lower = makeEvent({ filePath: "a.md", startDateKey: "2026-01-01", order: 1, manualRank: "Ma" });
    const upper = makeEvent({ filePath: "b.md", startDateKey: "2026-01-01", order: 0, manualRank: "MM" });
    // MM < Ma（ASCII）→ upper 在前 → compare(Ma, MM) > 0
    expect(compareTimelineManualOrder(lower, upper)).toBeGreaterThan(0);
    expect(compareTimelineManualOrder(upper, lower)).toBeLessThan(0);
  });
});

// Bug 4 渲染层接线（DOM 交互无法在无 jsdom 环境单测，用 source-level contract 锁定关键接线防回归）。
describe("timeline reorder wiring (Bug 4 方案 B)", () => {
  it("reorders any event in the lane (no same-date restriction)", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    expect(renderer).toContain("findTimelineReorderTarget");
    // T3：重排序改由 pointer move 路径触发，复用 lastReorderTarget 缓存（dragover drop 已删）。
    expect(renderer).toContain("this.actions.reorderTimelineEvent?.(event.row, lastReorderTarget.beforePath, lastReorderTarget.afterPath)");
  });

  it("lets jump (off-window) indicators act as reorder targets too", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    // jump 指示器纳入 Y 命中选择器，使窗口外事件也能作为重排目标（像表格一样任意重排）。
    expect(renderer).toContain(".db-timeline-event, .db-timeline-window-jump");
  });

  it("shows insertion indicators during pointer move (T3: dragover→pointer, F2: cross-lane precise)", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    // F2：HTML5 dragover 已删，onMove 用共用 helper 算插入点（同 lane 源 / 跨 lane 目标 lane），指示线画在目标 lane。
    expect(renderer).toContain("resolveTimelineReorderTarget(eventsEl, targetEventsEl, moveEvent.clientY");
    // 旧 dragover 形式（event.clientY）已随 drop zone 删除。
    expect(renderer).not.toContain("updateTimelineReorderIndicator(eventsEl, event.clientY");
  });

  it("ships a full-width reorder insertion line for timeline events", () => {
    const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    // 重排指示器改为跨越整个 lane 宽度的水平插入线（替代旧的单卡片边缘 box-shadow，
    // 后者只在卡片上下边缘、不跨行，不够显眼）。
    expect(styles).toContain(".db-timeline-events > .db-timeline-reorder-line");
    // 旧的单卡片边缘 box-shadow 已移除（timeline 专用选择器不再存在）。
    expect(styles).not.toContain(".db-timeline-event.is-drop-before");
  });

  it("cross-lane pointer move inserts into the target lane precisely (F2: 精确插入)", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    // F2：跨 lane 改分组用 onMove 缓存的目标 lane 命中作精确插入点（开启手动排序时），
    // 不再追加末尾；旧 drop zone 的 payload 形式已删。
    expect(renderer).toContain("moveTimelineEventToGroup?.(event.row, config.timelineGroupField, groupKey, targetGroupKey, lastReorderTarget?.beforePath, lastReorderTarget?.afterPath)");
    expect(renderer).not.toContain("moveTimelineEventToGroup?.(row, config.timelineGroupField, payload.groupKey, laneKey, undefined, undefined)");
  });
});

// Bug 4 jump 修复：重排的 before/after 必须基于完整 lane 顺序（含 jump 事件），
// 否则 jump 事件不在 visible DOM 会导致 A 跨越 jump、不紧贴 B。
describe("resolveTimelineReorderNeighbors — full-lane before/after (Bug 4 jump fix)", () => {
  it("placeBefore returns the full-lane predecessor (even when it is a jump event) and the target", () => {
    // fullPath 含 jump 事件 x（不在 visible DOM）；拖到 b 上半区 → A 插到 x 与 b 之间（紧贴 b）。
    expect(resolveTimelineReorderNeighbors("b", true, ["a", "x-jump", "b", "c"]))
      .toEqual({ beforePath: "x-jump", afterPath: "b" });
  });

  it("placeBefore at the first full-lane position has no predecessor", () => {
    expect(resolveTimelineReorderNeighbors("a", true, ["a", "b"]))
      .toEqual({ beforePath: undefined, afterPath: "a" });
  });

  it("placeAfter returns the target and the full-lane successor (even when it is a jump event)", () => {
    expect(resolveTimelineReorderNeighbors("b", false, ["a", "b", "c-jump", "d"]))
      .toEqual({ beforePath: "b", afterPath: "c-jump" });
  });

  it("placeAfter at the last full-lane position has no successor", () => {
    expect(resolveTimelineReorderNeighbors("c", false, ["a", "b", "c"]))
      .toEqual({ beforePath: "c", afterPath: undefined });
  });

  it("returns empty when the target is not in the full path", () => {
    expect(resolveTimelineReorderNeighbors("missing", true, ["a", "b"])).toEqual({});
  });
});

// 无效时间事件检测：开始 datetime >= 结束 datetime（负区间/零时长）的事件应在时间线隐藏并提示用户修复。
describe("isInvalidEventRange — invalid interval detection", () => {
  const ev = (startKey: string, endKey: string, start?: number, end?: number) => ({
    startDateKey: startKey, endDateKey: endKey, startMinutes: start, endMinutes: end,
  });

  it("flags same-day events whose start time is later than end time", () => {
    expect(isInvalidEventRange(ev("2026-06-14", "2026-06-14", 495, 285))).toBe(true); // 08:15 > 04:45
  });

  it("passes same-day events with a normal interval", () => {
    expect(isInvalidEventRange(ev("2026-06-14", "2026-06-14", 495, 555))).toBe(false); // 08:15 < 09:15
  });

  it("flags same-day datetime events with equal start/end because zero duration is not renderable", () => {
    expect(isInvalidEventRange(ev("2026-06-14", "2026-06-14", 495, 495))).toBe(true);
  });

  it("passes cross-day events whose end date is later", () => {
    expect(isInvalidEventRange(ev("2026-06-14", "2026-06-15", 495, 285))).toBe(false);
  });

  it("flags events whose end date is earlier than start date", () => {
    expect(isInvalidEventRange(ev("2026-06-15", "2026-06-14", 285, 495))).toBe(true);
  });

  it("passes events without an end time (instant / no end configured)", () => {
    expect(isInvalidEventRange(ev("2026-06-14", "2026-06-14", 495, undefined))).toBe(false);
  });

  it("passes all-day events (no time component)", () => {
    expect(isInvalidEventRange(ev("2026-06-14", "2026-06-14", undefined, undefined))).toBe(false);
  });

  it("flags backwards date ranges even without time components (pure date columns)", () => {
    // 两个纯 date 列、开始日期晚于结束日期：判为无效（隐藏并提示修复），不再折叠成同天渲染。
    expect(isInvalidEventRange(ev("2026-06-15", "2026-06-14", undefined, undefined))).toBe(true);
    expect(isInvalidEventRange(ev("2026-06-14", "2026-06-14", undefined, undefined))).toBe(false);
  });
});

// 无效时间事件管理接线（source-level contract）。
describe("invalid timeline events wiring", () => {
  it("collects zero-width datetime intervals when one stored value is date-only", () => {
    const config = {
      name: "Timeline",
      sourceFolder: "",
      viewType: "timeline",
      schema: {
        columns: [
          { key: "start", label: "Start", type: "datetime" },
          { key: "end", label: "End", type: "datetime" },
        ],
        computedFields: [],
      },
      timelineStartDateField: "start",
      timelineEndDateField: "end",
    } as ViewConfig;
    const rows = [{
      file: ({
        name: "zero.md",
        path: "zero.md",
        basename: "zero",
        extension: "md",
        parent: { path: "" },
        stat: { ctime: 0, mtime: 0, size: 0 },
      } as RowData["file"]),
      frontmatter: { start: "2026-06-13", end: "2026-06-13T00:00" },
      computed: {},
    }] as RowData[];

    expect(collectInvalidTimelineEvents(rows, config)).toHaveLength(1);
  });

  it("collects mixed date and datetime midnight intervals that would otherwise render as zero width", () => {
    const config = {
      name: "Timeline",
      sourceFolder: "",
      viewType: "timeline",
      schema: {
        columns: [
          { key: "start", label: "Start", type: "date" },
          { key: "end", label: "End", type: "datetime" },
        ],
        computedFields: [],
      },
      timelineStartDateField: "start",
      timelineEndDateField: "end",
    } as ViewConfig;
    const rows = [{
      file: ({
        name: "mixed-zero.md",
        path: "mixed-zero.md",
        basename: "mixed-zero",
        extension: "md",
        parent: { path: "" },
        stat: { ctime: 0, mtime: 0, size: 0 },
      } as RowData["file"]),
      frontmatter: { start: "2026-06-13", end: "2026-06-13T00:00" },
      computed: {},
    }] as RowData[];

    expect(collectInvalidTimelineEvents(rows, config)).toHaveLength(1);
  });

  it("collects invalid events using calendar date fields when timeline fields are absent (A2)", () => {
    // 日历视图只有 calendarStartDateField/calendarEndDateField，collectInvalidTimelineEvents
    // 应回退到 calendar 字段并检测到无效事件（A2：日历复用同一检测入口）。
    const config = {
      name: "Calendar",
      sourceFolder: "",
      viewType: "calendar",
      schema: {
        columns: [
          { key: "start", label: "Start", type: "datetime" },
          { key: "end", label: "End", type: "datetime" },
        ],
        computedFields: [],
      },
      calendarStartDateField: "start",
      calendarEndDateField: "end",
    } as ViewConfig;
    const rows = [{
      file: ({
        name: "reverse.md",
        path: "reverse.md",
        basename: "reverse",
        extension: "md",
        parent: { path: "" },
        stat: { ctime: 0, mtime: 0, size: 0 },
      } as RowData["file"]),
      frontmatter: { start: "2026-06-13T15:00", end: "2026-06-13T10:00" },
      computed: {},
    }] as RowData[];

    expect(collectInvalidTimelineEvents(rows, config)).toHaveLength(1);
  });

  it("caches invalid timeline scan results until rows or timeline date config changes", async () => {
    let chunkCalls = 0;
    const scanner = new InvalidTimelineEventsScanner({
      schedule: (callback) => {
        chunkCalls += 1;
        callback({ timeRemaining: () => 50, didTimeout: false });
        return chunkCalls;
      },
      cancel: vi.fn(),
      chunkSize: 1,
    });
    const config = {
      name: "Timeline",
      sourceFolder: "",
      viewType: "timeline",
      schema: {
        columns: [
          { key: "start", label: "Start", type: "datetime" },
          { key: "end", label: "End", type: "datetime" },
        ],
        computedFields: [],
      },
      timelineStartDateField: "start",
      timelineEndDateField: "end",
    } as ViewConfig;
    const rows = [{
      file: ({
        name: "zero.md",
        path: "zero.md",
        basename: "zero",
        extension: "md",
        parent: { path: "" },
        stat: { ctime: 0, mtime: 0, size: 0 },
      } as RowData["file"]),
      frontmatter: { start: "2026-06-13", end: "2026-06-13T00:00" },
      computed: {},
    }] as RowData[];

    await expect(scanner.getOptions(rows, config, 1)).resolves.toHaveLength(1);
    await expect(scanner.getOptions(rows, config, 1)).resolves.toHaveLength(1);
    expect(chunkCalls).toBe(1);

    await expect(scanner.getOptions(rows, config, 2)).resolves.toHaveLength(1);
    expect(chunkCalls).toBe(2);

    await expect(scanner.getOptions(rows, {
      ...config,
      schema: {
        ...config.schema,
        columns: config.schema.columns.map((column) => column.key === "end" ? { ...column, type: "date" } : column),
      },
    }, 2)).resolves.toHaveLength(1);
    expect(chunkCalls).toBe(3);
  });

  it("cancels stale invalid timeline scans and ignores their results", async () => {
    const scheduled: Array<(deadline: { timeRemaining(): number; didTimeout: boolean }) => void> = [];
    const cancel = vi.fn();
    const scanner = new InvalidTimelineEventsScanner({
      schedule: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancel,
      chunkSize: 1,
    });
    const config = {
      name: "Timeline",
      sourceFolder: "",
      viewType: "timeline",
      schema: {
        columns: [
          { key: "start", label: "Start", type: "datetime" },
          { key: "end", label: "End", type: "datetime" },
        ],
        computedFields: [],
      },
      timelineStartDateField: "start",
      timelineEndDateField: "end",
    } as ViewConfig;
    const rows = [
      {
        file: ({ name: "a.md", path: "a.md", basename: "a", extension: "md", parent: { path: "" }, stat: { ctime: 0, mtime: 0, size: 0 } } as RowData["file"]),
        frontmatter: { start: "2026-06-13T00:00", end: "2026-06-13T00:00" },
        computed: {},
      },
      {
        file: ({ name: "b.md", path: "b.md", basename: "b", extension: "md", parent: { path: "" }, stat: { ctime: 0, mtime: 0, size: 0 } } as RowData["file"]),
        frontmatter: { start: "2026-06-14T00:00", end: "2026-06-14T00:00" },
        computed: {},
      },
    ] as RowData[];

    const stale = scanner.getOptions(rows, config, 1);
    const current = scanner.getOptions(rows.slice(0, 1), config, 2);
    expect(cancel).toHaveBeenCalledWith(1);

    scheduled[0]?.({ timeRemaining: () => 50, didTimeout: false });
    scheduled[1]?.({ timeRemaining: () => 50, didTimeout: false });

    await expect(current).resolves.toHaveLength(1);
    await expect(stale).resolves.toEqual([]);
  });

  it("timeline surfaces invalid events warning in nav icon and popover", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    expect(renderer).toContain("renderTimelineInvalidWarning");
    expect(renderer).toContain("db-timeline-invalid-toggle");
    expect(renderer).toContain("openTimelineInvalidEvents");
    expect(renderer).toContain("private timelineInvalidWarningCount: number | null = null");
    expect(renderer).toContain("const result = this.actions.getTimelineInvalidEventCount();");
    expect(renderer).toContain("if (typeof result === \"number\")");
    expect(renderer).toContain("const initialCount = typeof result === \"number\" ? result : this.timelineInvalidWarningCount");
    expect(renderer).not.toContain("Promise.resolve(this.actions.getTimelineInvalidEventCount())");
    const toolbar = readFileSync(new URL("../views/CalendarTimelineToolbarRenderer.ts", import.meta.url), "utf8");
    expect(toolbar).toContain("renderInvalidEventsNotice");
    expect(toolbar).toContain("invalidEventsConflictNotice");
    expect(toolbar).toContain("fixInvalidEvents");
  });

  it("DatabaseView opens the repair modal and writes back via applyCellChanges", () => {
    const view = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    expect(view).toContain("new InvalidTimelineEventsScanner()");
    expect(view).toContain("this.timelineInvalidEventsScanner.getOptions(this.rows, config, this.timelineInvalidRowsVersion)");
    expect(view).toContain("new InvalidTimeEventsModal");
    expect(view).toContain('applyCellChanges(changes, t("undo.timelineInvalidEvents"))');
  });

  it("embedded timeline invalid events show a read-only route back to full view", () => {
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    expect(embedded).toContain("new InvalidTimelineEventsScanner()");
    expect(embedded).toContain("this.timelineInvalidEventsScanner.getOptions(this.rows, config, this.timelineInvalidRowsVersion)");
    expect(embedded).toContain("openTimelineInvalidEvents");
    expect(embedded).toContain("void this.openFullDatabaseView(config)");
    expect(embedded).toContain("notice.editInFullView");
  });

  it("ships invalid-events copy in all three languages", () => {
    const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");
    expect(i18n).toContain('"timeline.invalidEventsNotice"');
    expect(i18n).toContain('"timeline.viewInvalidEvents"');
    expect(i18n).toContain('"timeline.invalidEventsConfirm"');
    expect(i18n).toContain('"timeline.invalidEventsQuickFix"');
    expect(i18n).toContain('"timeline.invalidEventsSelected"');
    expect(i18n).toContain('"undo.timelineInvalidEvents"');
  });

  it("distinguishes move vs reorder by drag direction (horizontal=move, vertical=reorder)", () => {
    const renderer = readFileSync(new URL("../views/CalendarTimelineRenderer.ts", import.meta.url), "utf8");
    // move 入口已 pointer 化：起点坐标由 mousedown 的 mouseEvent 传入 beginTimelineDateDrag。
    expect(renderer).toContain("this.beginTimelineDateDrag(button, eventsEl, config, event, groupKey, model, mouseEvent.clientX, mouseEvent.clientY, laneEvents, lanes)");
    expect(renderer).toContain("mouseEvent.clientX");
    expect(renderer).toContain("mouseEvent.clientY");
    // T3：方向区分改在 pointer onMove 里计算；drop 区的 dy>=dx && canTimelineReorder 与 dragover 的 dndDy>=dndDx 已删。
    expect(renderer).not.toContain("dy >= dx && this.canTimelineReorder(config)");
    expect(renderer).not.toContain("dndDy >= dndDx");
    // 周/月/季 pointer onMove：垂直 dy>=dx 锁原位高亮目标 lane；日视图 onMove 用 isVertical 分支。
    expect(renderer).toContain("if (dy >= dx) {");
    expect(renderer).toContain("const isVertical = mode === \"move\" && dy >= dx");
  });
});

describe("timeline robustness fixes", () => {
  const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

  it("cleans up timeline renderer (observer/popover/drag) on view unload (#1)", () => {
    const renderer = read("../views/CalendarTimelineRenderer.ts");
    expect(renderer).toContain("destroy(): void");
    expect(renderer).toContain("this.disconnectTimelineResizeObserver()");
    expect(renderer).toContain("this.closeTimelineMiniCalendar()");
    expect(renderer).toContain("this.activeTimelineDragCleanup?.()");
    expect(read("../views/DatabaseView.ts")).toContain("this.calendarTimelineRenderer.destroy()");
    expect(read("../views/EmbeddedDatabaseRenderer.ts")).toContain("this.calendarTimelineRenderer.destroy()");
  });

  it("uses date input for date columns and strips time on write-back (#2)", () => {
    const view = read("../views/DatabaseView.ts");
    expect(view).toContain('getColumnDisplayType(startCol, config.schema.computedFields) === "date"');
    expect(view).toContain("edit.startValue.slice(0, 10)");
    const modal = read("../views/modals/InvalidTimeEventsModal.ts");
    expect(modal).toContain('type: isDateOnly ? "date" : "datetime-local"');
    expect(modal).toContain("clipForDateInput");
    const options = read("../data/InvalidTimeEvents.ts");
    expect(options).toContain("startIsDateOnly: boolean");
  });

  it("keeps horizontal timed-move in the source lane (#3)", () => {
    const renderer = read("../views/CalendarTimelineRenderer.ts");
    expect(renderer).toContain("targetEventsEl = isVerticalUp");
    expect(renderer).toContain("? this.getTimelineTimedDropTarget(upEvent.clientX, upEvent.clientY, eventsEl)");
    expect(renderer).toContain(": eventsEl;");
  });

  it("closes the timeline toolbar popover from closePopovers (#4)", () => {
    const toolbar = read("../views/ToolbarRenderer.ts");
    const idx = toolbar.indexOf("closePopovers(): void");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(toolbar.slice(idx, idx + 400)).toContain("this.calendarTimelineToolbarRenderer.closePopover();");
  });

  it("resolves collapsed timeline lanes as drop targets with highlight (#6)", () => {
    const renderer = read("../views/CalendarTimelineRenderer.ts");
    expect(renderer).toContain('groupEl.setAttribute("data-timeline-lane-key", lane.key)');
    expect(renderer).toContain("if (group?.dataset.timelineLaneKey) return group;");
    expect(renderer).toContain('targetEventsEl.classList.contains("is-collapsed")');
    expect(renderer).toContain(".db-timeline-events.is-drop-target, .db-timeline-group.is-drop-target");
    expect(read("../../styles.css")).toContain(".db-timeline-group.is-drop-target > .db-timeline-group-header");
  });

  it("cross-group drag changes only the group (one undo), not also the date/time", () => {
    const renderer = read("../views/CalendarTimelineRenderer.ts");
    // 跨组拖拽在 moveTimelineEventToGroup 后 return，不再触发 updateEventDates，
    // 避免一次拖拽产生「撤销顺序 / 撤销时间」两条记录。
    expect(renderer).toContain("跨 lane 拖拽只改分组（垂直意图），不改日期");
    expect(renderer).toContain("跨 lane 拖拽只改分组（垂直意图），不改时间");
  });

  it("group move captures the group-field change so undo fully reverts (not just rank)", () => {
    const view = read("../views/DatabaseView.ts");
    // moveRowWithGroupUpdatesAndPosition 把分组字段改动写进 pendingConfigCellChanges 并即时保存，
    // 使「撤销卡片顺序」能完整回退分组（顺带修复看板/表格跨组撤销的同源问题）。
    expect(view).toContain("在写回前捕获分组字段改动");
    expect(view).toContain("this.pendingConfigCellChanges = cellChanges.length > 0 ? cellChanges : null");
  });
});
