import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { RowCreateContext, RowData, ViewConfig } from "../data/types";
import { planRecordReorder, setRecordReorderContext } from "../views/RecordReorderContext";
import { RowMenu } from "../views/RowMenu";
import { startMobileRecordTargetMode } from "../views/MobileRecordTargetMode";

const state = vi.hoisted(() => ({ items: [] as Array<{ title: string; disabled: boolean; click?: () => void }> }));
vi.mock("obsidian", () => ({ Menu: class {
  setUseNativeMenu() { return this; }
  onHide() { return this; }
  addSeparator() {}
  showAtMouseEvent() {}
  showAtPosition() {}
  addItem(build: (item: unknown) => void) {
    const item = {
      title: "", disabled: false, click: undefined as (() => void) | undefined,
      setTitle(title: string) { this.title = title; return this; },
      setIcon() { return this; }, setWarning() { return this; },
      setDisabled(value: boolean) { this.disabled = value; return this; },
      onClick(callback: () => void) { this.click = callback; return this; },
    };
    build(item); state.items.push(item);
  }
} }));
vi.mock("../i18n", () => ({ t: (key: string) => key }));
vi.mock("../views/modals/ConfirmModal", () => ({ confirmWithModal: vi.fn() }));
vi.mock("../views/modals/MoveToPositionModal", () => ({ promptMoveToPosition: vi.fn() }));
vi.mock("../views/RecordReorderLabel", () => ({ getRecordReorderLabel: (row: RowData) => row.file.path }));
vi.mock("../views/MobileRecordTargetMode", () => ({ startMobileRecordTargetMode: vi.fn(() => vi.fn()) }));

const row = (path: string) => ({ file: { path, name: path }, frontmatter: {}, computed: {} }) as RowData;
const a = row("a.md"), b = row("b.md"), c = row("c.md"), d = row("d.md");
const config = (viewType = "board") => ({
  viewType, schema: { columns: [
    { key: "status", type: "status" }, { key: "team", type: "multi-select" },
    { key: "formula", type: "computed" }, { key: "file.folder", type: "text" },
  ] },
}) as ViewConfig;
const context = (rows: RowData[], status: string, team?: string): RowCreateContext => ({
  visibleRows: rows,
  groups: [{ field: "status", key: status }, ...(team ? [{ field: "team", key: team }] : [])],
});

describe("record reorder plans", () => {
  it("updates both main group and subgroup and uses target subgroup neighbors", () => {
    expect(planRecordReorder(config(), context([a], "Todo", "Design"), context([b, c], "Done", "Web"), a.file.path, c.file.path, "before"))
      .toEqual({ previousPath: b.file.path, nextPath: c.file.path, updates: [
        { field: "status", fromGroupKey: "Todo", toGroupKey: "Done" },
        { field: "team", fromGroupKey: "Design", toGroupKey: "Web" },
      ] });
  });
  it("updates a subgroup even if the main group is unchanged", () => {
    expect(planRecordReorder(config(), context([a], "Todo", "Design"), context([b], "Todo", "Web"), a.file.path, b.file.path, "after")?.updates)
      .toEqual([{ field: "team", fromGroupKey: "Design", toGroupKey: "Web" }]);
  });
  it("honors the clicked occurrence when a multi-select record appears twice", () => {
    const source = context([a], "Todo", "Design");
    const target = context([a, b], "Todo", "Web");
    expect(planRecordReorder(config(), source, target, a.file.path, b.file.path, "before"))
      .toEqual({ previousPath: undefined, nextPath: b.file.path, updates: [{ field: "team", fromGroupKey: "Design", toGroupKey: "Web" }] });
  });
  it.each(["formula", "file.folder"])("blocks writes to %s but allows ordering within its group", (field) => {
    const source = { visibleRows: [a, b], groups: [{ field, key: "A" }] };
    expect(planRecordReorder(config(), source, { visibleRows: [c], groups: [{ field, key: "B" }] }, a.file.path, c.file.path, "before")).toBeNull();
    expect(planRecordReorder(config(), source, source, a.file.path, b.file.path, "after")?.updates).toEqual([]);
  });
});

describe("RowMenu behavior", () => {
  beforeEach(() => { state.items = []; vi.clearAllMocks(); vi.stubGlobal("Element", class {}); });
  afterEach(() => vi.unstubAllGlobals());
  function open(view = config(), source = context([a, c, d], "Todo")) {
    const move = vi.fn(), moveGroups = vi.fn();
    const menu = new RowMenu({
      app: {} as App, openRow: vi.fn(), deleteRow: vi.fn(),
      getConfig: () => view, getVisibleRows: () => [a, b, c, d],
      getMenuRoot: () => ({}) as HTMLElement,
      moveRowToPosition: move, moveRowWithGroupUpdatesAndPosition: moveGroups,
    });
    menu.show({ preventDefault() {}, target: null } as unknown as MouseEvent, c, source);
    return { move, moveGroups };
  }
  const item = (title: string) => state.items.find((candidate) => candidate.title === title)!;

  it("moves within displayed group order even when global ranks interleave groups", () => {
    const { move, moveGroups } = open();
    item("menu.moveUp").click!();
    expect(move).toHaveBeenLastCalledWith(c.file.path, undefined, a.file.path);
    item("menu.moveDown").click!();
    expect(move).toHaveBeenLastCalledWith(c.file.path, d.file.path, undefined);
    expect(moveGroups).not.toHaveBeenCalled();
  });
  it.each(["calendar", "form"])("hides reorder actions in %s", (view) => {
    open(config(view));
    expect(item("mobile.chooseTarget")).toBeUndefined();
    expect(item("menu.moveUp")).toBeUndefined();
    expect(item("mobile.moveToPosition")).toBeUndefined();
  });
  it("disables local movement at group boundaries while allowing target mode", () => {
    open(config(), context([c], "Todo"));
    expect(item("menu.moveUp").disabled).toBe(true);
    expect(item("menu.moveDown").disabled).toBe(true);
    expect(item("mobile.moveToPosition").disabled).toBe(true);
    expect(item("mobile.chooseTarget").disabled).toBe(false);
  });
  it("disables all reorder actions when explicitly sorted", () => {
    open({ ...config(), sortRules: [{ field: "status", direction: "asc" }] });
    for (const title of ["mobile.chooseTarget", "menu.moveUp", "menu.moveDown", "mobile.moveToPosition"])
      expect(item(title).disabled).toBe(true);
    expect(item("menu.reorderSortedDisabled")).toBeDefined();
  });
  it("passes the actual target occurrence through to a subgroup move", () => {
    const { moveGroups } = open(config(), context([a, c, d], "Todo", "Design"));
    item("mobile.chooseTarget").click!();
    const options = vi.mocked(startMobileRecordTargetMode).mock.calls[0][0];
    const element = { parentElement: null, getAttribute: () => b.file.path } as unknown as HTMLElement;
    setRecordReorderContext(element, context([b], "Done", "Web"));
    expect(options.canSelectTarget!(element)).toBe(true);
    options.onPlace(b.file.path, "after", element);
    expect(moveGroups).toHaveBeenCalledWith(c, [
      { field: "status", fromGroupKey: "Todo", toGroupKey: "Done" },
      { field: "team", fromGroupKey: "Design", toGroupKey: "Web" },
    ], b.file.path, undefined);
  });
});
