import { expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { CalendarTimelineRenderer } from "../views/CalendarTimelineRenderer";
import { RecordReminderInbox } from "../views/modals/RecordReminderInbox";
import { RecordReminderSettingsModal } from "../views/modals/RecordReminderModal";
import { openDatabaseCardNote } from "../views/DatabaseNoteReturn";
import type { App, TFile } from "obsidian";
import type { DueRecordReminder, RecordReminderSettings } from "../data/RecordReminders";
import type { RecordReminderService } from "../data/RecordReminderService";
import type { DataSource } from "../data/DataSource";

vi.mock("obsidian", () => ({
  Modal: class { constructor(readonly app: App) {} }, MarkdownView: class {}, Notice: class {}, Scope: class { register() {} }, Component: class {},
  TFile: class {}, WorkspaceWindow: class {}, Platform: { isMobile: false }, setIcon() {},
}));
vi.mock("../views/modals/ModalDrag", () => ({ makeModalDraggable() {} }));
setLocale("en");

it("drags a continuous axis from another window with Obsidian's cross-window instanceof", () => {
  class MainElement {}
  class PopupAxis {
    closest(selector: string) { return selector === ".db-timeline-axis" ? this : null; }
    instanceOf(ctor: unknown) { return ctor === MainElement; }
  }
  vi.stubGlobal("Element", MainElement);
  try {
    const renderer = new CalendarTimelineRenderer({ openRow: vi.fn() });
    const scroll = {
      ownerDocument: { defaultView: {} }, clientWidth: 500, scrollWidth: 1500, scrollLeft: 0,
      addEventListener() {}, removeEventListener() {},
      setAttribute: vi.fn(), setPointerCapture: vi.fn(),
      onpointerdown: (_event: unknown) => {}, onpointermove: (_event: unknown) => {},
    };
    const wrap = { style: { setProperty: vi.fn() } };
    const internal = renderer as unknown as { installTimelinePan(...args: unknown[]): void };
    internal.installTimelinePan(scroll, wrap, {}, {}, [], { scale: "week" }, 5, 100, []);
    const axis = new PopupAxis();
    expect(axis).not.toBeInstanceOf(MainElement);
    scroll.onpointerdown({ button: 0, pointerType: "mouse", target: axis, pointerId: 8, clientX: 400, preventDefault() {} });
    scroll.onpointermove({ pointerId: 8, clientX: 300 });
    expect(scroll.setPointerCapture).toHaveBeenCalledWith(8);
    expect(scroll.scrollLeft).toBe(600);
  } finally { vi.unstubAllGlobals(); }
});

it("does not steal focus after the user selects another editor during an async note open", async () => {
  let finish!: () => void;
  let activeChanged: ((leaf: unknown) => void) | undefined;
  let foreground: unknown;
  const host = {};
  const origin = { view: { containerEl: { contains: (candidate: unknown) => candidate === host } } };
  const alternative = { getContainer: () => ({}), view: { containerEl: { contains: () => false } } };
  const target = { view: { containerEl: { contains: () => false, ownerDocument: { defaultView: null } } },
    openFile: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
  const leaves = (visit: (leaf: unknown) => void) => [origin, target, alternative].forEach(visit);
  const workspace = {
    iterateAllLeaves: leaves, iterateRootLeaves: leaves, getLeavesOfType: () => [], getLeaf: () => target,
    setActiveLeaf: vi.fn((leaf: unknown) => { foreground = leaf; activeChanged?.(leaf); }),
    getMostRecentLeaf: () => foreground,
    on: (_name: string, cb: typeof activeChanged) => { activeChanged = cb; return 1; },
    offref: vi.fn(() => { activeChanged = undefined; }),
  };
  foreground = origin;
  const file = { path: "Task.md" } as TFile;
  const result = openDatabaseCardNote({ app: { workspace } as unknown as App, file,
    host: host as HTMLElement, anchor: {} as HTMLElement, view: "board", openNormally: vi.fn() });
  workspace.setActiveLeaf(alternative);
  finish();
  await result;
  expect(foreground).toBe(alternative);
  expect(target.openFile).toHaveBeenCalledWith(file, { active: false });
  expect(workspace.offref).toHaveBeenCalledOnce();
});

it.each(["inbox", "preview"] as const)("puts the %s return strip in the actual note window", async which => {
  const icon = { addClass() {} };
  const button = { createSpan: () => icon };
  const strip = { createEl: () => button };
  const sourceDocument = { body: { createDiv: vi.fn(() => strip) } };
  const targetDocument = { body: { appendChild: vi.fn() }, defaultView: null };
  const containerEl = { ownerDocument: sourceDocument, isConnected: true, addClass() {} };
  const file = { path: "Task.md" } as TFile;
  const target = { view: { containerEl: { ownerDocument: targetDocument }, getState: () => ({ file: file.path }) }, openFile: vi.fn(async () => {}) };
  const origin = {};
  const workspace = {
    getMostRecentLeaf: () => origin, getLeavesOfType: () => [target],
    getLeaf: vi.fn(), setActiveLeaf: vi.fn(), on: vi.fn(), offref: vi.fn(),
  };
  const app = { workspace, vault: { getFileByPath: () => file }, keymap: { popScope: vi.fn() } } as unknown as App;
  if (which === "inbox") {
    const inbox = new RecordReminderInbox(app, { isOriginalRecord: () => true } as unknown as RecordReminderService, () => false);
    Object.assign(inbox, { containerEl, suspend() { Object.assign(inbox, { suspended: true }); } });
    await (inbox as unknown as { openNote(item: DueRecordReminder): Promise<void> }).openNote({ path: file.path } as DueRecordReminder);
  } else {
    const rules = new RecordReminderSettingsModal(app, {} as DataSource, "db", { rules: [], states: {} } as RecordReminderSettings,
      async () => {}, () => {});
    Object.assign(rules, { containerEl, details: { suspend() {} } });
    await (rules as unknown as { openPreviewNote(file: TFile): Promise<void> }).openPreviewNote(file);
  }
  expect(sourceDocument.body.createDiv).toHaveBeenCalledOnce();
  expect(targetDocument.body.appendChild).toHaveBeenCalledWith(strip);
  expect(workspace.setActiveLeaf).toHaveBeenCalledWith(target, { focus: true });
});

for (const which of ["inbox", "preview"] as const) it(`${which}: stale open does not interfere with the next open`, async () => {
  const requests: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const strips: Array<{ buttons: Array<{onclick?: () => void}>; remove: ReturnType<typeof vi.fn> }> = [];
  const doc = { body: {
    createDiv() { const strip = { buttons: [] as Array<{onclick?: () => void}>, remove: vi.fn(), createEl() {
      const button = { parentElement: strip, createSpan: () => ({}), onclick: () => {} }; strip.buttons.push(button); return button;
    }}; strips.push(strip); return strip; },
    appendChild: vi.fn(),
  }};
  const target = { view: { containerEl: { ownerDocument: doc }, getState: () => ({ file: "A.md" }) },
    openFile: vi.fn(() => new Promise<void>((resolve,reject) => requests.push({resolve,reject}))) };
  const origin = {};
  const workspace = {
    getMostRecentLeaf: () => origin, getLeavesOfType: () => [],
    getLeaf: () => target, setActiveLeaf: vi.fn(),
    iterateAllLeaves: (fn: (leaf: unknown) => void) => [origin,target].forEach(fn),
    on: vi.fn(), offref: vi.fn(),
  };
  const containerEl = { ownerDocument: doc, isConnected: true, addClass() {}, removeClass() {} };
  const app = { workspace, vault: { getFileByPath: (path: string) => ({path}) }, keymap: { popScope: vi.fn(), pushScope: vi.fn() } } as unknown as App;
  let start: (path: string) => Promise<void>;
  if (which === "inbox") {
    const inbox = new RecordReminderInbox(app, { isOriginalRecord: () => true } as unknown as RecordReminderService, () => false);
    Object.assign(inbox, { containerEl, suspend() { Object.assign(inbox, { suspended: true }); }, refresh() {}, focusRow() {} });
    start = path => (inbox as unknown as { openNote(item: DueRecordReminder): Promise<void> }).openNote({ path } as DueRecordReminder);
  } else {
    const modal = new RecordReminderSettingsModal(app, {} as DataSource, "db", { rules: [], states: {} } as RecordReminderSettings,
      async () => {}, () => {});
    Object.assign(modal, { containerEl, details: { suspend() {}, resume() {} }, refreshPreviews() {} });
    start = path => (modal as unknown as { openPreviewNote(file: TFile): Promise<void> }).openPreviewNote({path} as TFile);
  }
  const a = start("A.md");
  strips[0].buttons[0].onclick?.();
  const b = start("B.md");
  expect(requests).toHaveLength(2);
  expect(target.openFile.mock.calls).toEqual([[{ path: "A.md" }, { active: false }], [{ path: "B.md" }, { active: false }]]);
  if (which === "inbox") requests[0].resolve();
  else requests[0].reject(new Error("A failed late"));
  await a;
  const count = doc.body.appendChild.mock.calls.length;
  const newRemoved = strips[1].remove.mock.calls.length;
  requests[1].resolve();
  await b;
  expect({ count, newRemoved }, "A must neither recreate its own strip nor remove B's strip").toEqual({ count:0, newRemoved:0 });
});
