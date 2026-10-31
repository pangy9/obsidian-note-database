import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EmbeddedDatabaseRenderer } from "../views/EmbeddedDatabaseRenderer";

vi.mock("obsidian", () => ({
  MarkdownRenderChild: class {}, FileView: class {}, Modal: class {}, FuzzySuggestModal: class {}, SuggestModal: class {},
  TFile: class {}, TFolder: class {}, Notice: class {}, Platform: {},
  setIcon: vi.fn(), addIcon: vi.fn(), setTooltip: vi.fn(), getIconIds: () => [],
  normalizePath: (path: string) => path,
}));

type NoticeHarness = {
  embeddedHistoryNoticeVisible: boolean;
  embeddedHistoryNoticeTimer: number | null;
  unloaded: boolean;
  dataOperations: { busy: boolean; canUndo: boolean; canRedo: boolean };
  resetEmbeddedHistoryNoticeTimer(): void;
  clearEmbeddedHistoryNoticeTimer(): void;
  renderEmbedSelectionStatusBar(): void;
  refreshAfterDataOperation(): void;
  containerEl: unknown;
  getRefreshWindow(): unknown;
  dataSource: unknown;
  cellSelection: unknown;
  selectedRows: Set<string>;
};

function fixture() {
  // Use the production lifecycle methods without constructing Obsidian renderers.
  const renderer = Object.create(EmbeddedDatabaseRenderer.prototype) as NoticeHarness;
  let focused = false;
  const contains = () => focused;
  Object.assign(renderer, {
    embeddedHistoryNoticeVisible: true, embeddedHistoryNoticeTimer: null, unloaded: false,
    cellSelection: null, selectedRows: new Set<string>(),
    dataOperations: { busy: false, canUndo: true, canRedo: false },
    containerEl: { ownerDocument: { activeElement: {} }, querySelector: () => ({ contains }), isConnected: true },
    getRefreshWindow: () => ({ setTimeout, clearTimeout }),
    renderEmbedSelectionStatusBar: vi.fn(),
    dataSource: { getViewDefFiles: () => [] },
  });
  return { renderer, focus: (value: boolean) => { focused = value; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("embedded undo notice", () => {
  it("hides after five idle seconds without clearing undo history", () => {
    const { renderer } = fixture();
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(4_999);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(false);
    expect(renderer.dataOperations.canUndo).toBe(true);
    expect(renderer.renderEmbedSelectionStatusBar).toHaveBeenCalledOnce();
    renderer.resetEmbeddedHistoryNoticeTimer();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts the idle period on activity and pauses during a write", () => {
    const { renderer } = fixture();
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(4_000);
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(4_000);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(true);
    renderer.dataOperations.busy = true;
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(10_000);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(true);
    renderer.dataOperations.busy = false;
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(5_000);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(false);
  });

  it("preserves a focused control and cleans up the timer on unload", () => {
    const { renderer, focus } = fixture();
    focus(true);
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(5_000);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(true);
    focus(false);
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(5_000);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(false);
    renderer.embeddedHistoryNoticeVisible = true;
    renderer.resetEmbeddedHistoryNoticeTimer();
    renderer.unloaded = true;
    renderer.clearEmbeddedHistoryNoticeTimer();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a fresh notice for an operation after an older notice expired", () => {
    const { renderer } = fixture();
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(5_000);
    renderer.refreshAfterDataOperation();
    expect(renderer.embeddedHistoryNoticeVisible).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(false);
  });

  it("reuses sticky positioning and content width for the history-only bar", () => {
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    const rule = css.match(/\.note-database-embed\.note-database-container > \.db-selection-status-bar\.db-embed-history-only \{([^}]+)\}/)?.[1];
    expect(rule).toContain("width: max-content");
    expect(rule).not.toContain("position: static");
    const source = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");
    expect(source).not.toContain(".db-selection-status-bar:not(.db-embed-history-only)");
    expect(source).toContain("this.selectedRows.size > 0 || hasHistory");
  });

  it("does not resurrect an expired notice on a background render", () => {
    const { renderer } = fixture();
    renderer.embeddedHistoryNoticeVisible = false;
    const createDiv = vi.fn();
    Object.assign(renderer, {
      cellSelection: null, selectedRows: new Set(), isEmbedReadOnly: () => false,
      containerEl: { querySelectorAll: () => [], toggleClass: vi.fn(), createDiv },
    });
    EmbeddedDatabaseRenderer.prototype["renderEmbedSelectionStatusBar"].call(renderer as never);
    expect(createDiv).not.toHaveBeenCalled();
    expect(renderer.dataOperations.canUndo).toBe(true);
  });

  it("leaves an active selection toolbar and its editor mounted when time expires", () => {
    const { renderer } = fixture();
    renderer.selectedRows.add("record.md");
    renderer.resetEmbeddedHistoryNoticeTimer();
    vi.advanceTimersByTime(5_000);
    expect(renderer.embeddedHistoryNoticeVisible).toBe(false);
    expect(renderer.renderEmbedSelectionStatusBar).not.toHaveBeenCalled();
  });
});
