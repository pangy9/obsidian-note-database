import { expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { RecordReminderService } from "../data/RecordReminderService";
import { recordReminderKey, type DueRecordReminder } from "../data/RecordReminders";
import { RecordReminderInbox } from "../views/modals/RecordReminderInbox";
import { setLocale } from "../i18n";

vi.mock("obsidian", () => ({
  Modal: class {
    open(this: { onOpen(): void; contentEl: Node }) {
      this.onOpen();
      // Simulate Obsidian restoring the default row after the onOpen callback.
      this.contentEl.querySelector("[data-reminder-key]")?.focus();
    }
  }, Notice: class {}, Scope: class { register() {} }, Component: class { load() {} register() {} registerDomEvent() {} },
  setIcon() {}, setTooltip() {}, getIconIds() { return []; },
}));
vi.mock("../views/modals/ModalDrag", () => ({ makeModalDraggable() {} }));
class Node {
  children: Node[] = [];
  ownerDocument: Doc;
  dataset: Record<string, string> = {};
  attrs: Record<string, string>;
  textContent: string;
  scrollTop = 0;
  value = "";
  hidden = false;
  isConnected = true;
  classList = { contains: () => false };
  onclick?: () => void;
  oninput?: () => void;
  constructor(doc: Doc, readonly cls = "", text = "", attrs: Record<string, string> = {}, readonly parent?: Node) { this.ownerDocument = doc; this.textContent = text; this.attrs = attrs; }
  createEl(_tag: string, opt: { cls?: string; text?: string; attr?: Record<string, string> } = {}) { const n = new Node(this.ownerDocument, opt.cls, opt.text, opt.attr, this); this.children.push(n); return n; }
  createDiv(opt?: Parameters<Node["createEl"]>[1]) { return this.createEl("div", opt); }
  createSpan(opt?: Parameters<Node["createEl"]>[1]) { return this.createEl("span", opt); }
  addClass() {}
  setText(s: string) { this.textContent = s; }
  setAttribute(k: string, s: string) { this.attrs[k] = s; }
  getAttribute(k: string) { return k === "data-reminder-action" ? this.dataset.reminderAction : this.attrs[k]; }
  closest(selector: string): Node | undefined { return this.cls.split(" ").includes(selector.slice(1)) ? this : this.parent?.closest(selector); }
  empty() { this.children = []; }
  querySelector(selector: string) {
    if (selector === '.db-ri-actions button[aria-expanded="true"]') return this.flatten().find(n => n.attrs["aria-expanded"] === "true");
    if (selector === '[data-reminder-action="more"]') return this.flatten().find(n => n.dataset.reminderAction === "more");
    return this.querySelectorAll(selector)[0];
  }
  contains(child: Node): boolean { return this === child || this.children.some(n => n.contains(child)); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  getClientRects() { return [{}]; }
  flatten(): Node[] { return [this, ...this.children.flatMap(child => child.flatten())]; }
  querySelectorAll(selector: string) {
    return selector === "[data-reminder-key]" ? this.flatten().filter(n => n.dataset.reminderKey) : [];
  }
}
type Doc = { defaultView: { setInterval: (cb: () => void) => number }; body: Node; activeElement?: Node; querySelectorAll?(): Node[] };
const item = (key: string): DueRecordReminder => ({
  key, ruleId: "rule", databaseId: "db", databaseName: "DB", path: key + ".md", title: key, dueAt: 1, reminderAt: 1, ruleName: "Rule", dateFieldLabel: "Due",
});
it("subsequent alerts reach an inbox left focused on the next row", async () => {
  setLocale("en");
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  try {
    let tick!: () => void;
    const doc = { defaultView: { setInterval: cb => { tick = cb; return 1; } } } as Doc;
    doc.body = new Node(doc);
    const contentEl = new Node(doc), containerEl = new Node(doc), modalEl = new Node(doc);
    let pending = [item("A"), item("B")];
    const service = {
      pending: () => pending,
      update: async () => { pending = [item("B")]; return async () => true; },
    };
    const inbox = new RecordReminderInbox({} as App, service as unknown as RecordReminderService, () => false);
    Object.assign(inbox, { contentEl, containerEl, modalEl });
    inbox.onOpen();
    const actions = contentEl.flatten().filter(el => el.dataset.reminderAction).slice(0, 4);
    expect(actions.map(el => el.dataset.reminderAction)).toEqual(["snooze", "rule", "dismiss", "more"]);
    expect(actions[0].children.map(el => el.textContent)).toContain("+10min");
    expect(actions[0].attrs).toMatchObject({ "aria-label": "Remind in 10 minutes", title: "Remind in 10 minutes" });
    expect(actions[1].children).toHaveLength(1);
    expect(actions[1].attrs).toMatchObject({ "aria-label": "View reminder rule", title: "View reminder rule" });
    expect(actions[2].children).toHaveLength(1);
    expect(actions[2].attrs).toMatchObject({ "aria-label": "Dismiss this reminder", title: "Dismiss this reminder" });
    actions[0].onclick?.();
    await vi.waitFor(() => expect(doc.activeElement?.dataset.reminderKey).toBe("B"));
    pending = [item("B"), item("C")];
    tick(); tick();
    const keys = () => contentEl.querySelectorAll("[data-reminder-key]").map(n => n.dataset.reminderKey);
    expect(keys()).toEqual(["B", "C"]);
    expect(doc.activeElement?.dataset.reminderKey).toBe("B");
    const more = doc.activeElement?.parent?.querySelector('[data-reminder-action="more"]')!;
    more.focus();
    more.setAttribute("aria-expanded", "true");
    pending = [item("B"), item("C"), item("D")];
    tick();
    expect(keys()).toEqual(["B", "C"]);
    more.setAttribute("aria-expanded", "false");
    inbox.refreshPending();
    expect(keys()).toEqual(["B", "C", "D"]);
    expect(doc.activeElement?.dataset.reminderAction).toBe("more");
    expect(doc.activeElement?.parent?.parent?.querySelector("[data-reminder-key]")?.dataset.reminderKey).toBe("B");
  } finally { vi.unstubAllGlobals(); }
});

it("keeps literal punctuation in complete names while rendering a separate database and rule", () => {
  setLocale("en");
  const doc = {} as Doc;
  const contentEl = new Node(doc);
  const inbox = new RecordReminderInbox({} as App, {} as RecordReminderService, () => false);
  Object.assign(inbox, { contentEl });
  const task = { ...item("Meeting"), databaseName: "Research · Clients", ruleName: "Review | 2nd pass" };
  (inbox as unknown as { renderRow(list: Node, item: DueRecordReminder, now: number): void }).renderRow(contentEl, task, 0);
  const source = contentEl.flatten().find(node => node.cls.includes("db-ri-source"))!;
  expect(source.children.map(node => node.textContent)).toEqual(["Research · Clients", "Review | 2nd pass"]);
  expect(source.attrs.title.split("\n")).toEqual(["Database: Research · Clients", "Reminder rule: Review | 2nd pass"]);
  expect(contentEl.querySelector("[data-reminder-key]")?.attrs["aria-label"]).toContain("Database: Research · Clients. Rule: Review | 2nd pass.");
});


it("offers undo through the detail overlay when an inline edit leaves its reminder due", async () => {
  setLocale("en");
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  try {
    const doc: Doc = { defaultView: { setInterval: () => 1 }, body: undefined! };
    doc.body = new Node(doc);
    const contentEl = new Node(doc), containerEl = new Node(doc), modalEl = new Node(doc);
    let pending = [item("A")];
    const service = { pending: () => pending };
    const inbox = new RecordReminderInbox({} as App, service as unknown as RecordReminderService, () => false);
    const internal = inbox as unknown as {
      openDetail(anchor: Node, item: DueRecordReminder, pathHint?: string, showUndo?: boolean): void;
      closeDetail(restore: boolean): void;
      renderFeedback(target: Node, inDetail: boolean): void;
      performAction(item: DueRecordReminder, anchor: Node, label: string,
        write: () => Promise<() => Promise<boolean>>, field: string): Promise<void>;
    };
    Object.assign(inbox, { contentEl, containerEl, modalEl });
    inbox.onOpen();
    const original = pending[0];
    const anchor = contentEl.querySelector("[data-reminder-key]")!;
    const update = { ...original, key: "new-due-key", dueAt: 2 };
    const overlay = new Node(doc);
    const close = vi.spyOn(internal, "closeDetail");
    const open = vi.spyOn(internal, "openDetail").mockImplementation((_anchor, _item, _hint, showUndo) => {
      if (showUndo) internal.renderFeedback(overlay, true);
    });
    const undo = vi.fn(async () => { pending = [original]; return true; });
    await internal.performAction(original, anchor, "Record updated", async () => {
      pending = [update]; return undo;
    }, "date");
    expect(open).toHaveBeenCalledWith(expect.anything(), update, undefined, true);
    expect(overlay.children.map(el => el.textContent)).toEqual(["Record updated", "Undo"]);
    overlay.children[1].onclick?.();
    await vi.waitFor(() => expect(doc.activeElement?.dataset.reminderKey).toBe("A"));
    expect(undo).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});


it("locates a live reminder after moving the note, but does not navigate to a replaced record", () => {
  setLocale("en");
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  try {
    const doc: Doc = { defaultView: { setInterval: () => 1 }, body: undefined! };
    doc.body = new Node(doc);
    doc.querySelectorAll = () => [];
    const contentEl = new Node(doc), containerEl = new Node(doc), modalEl = new Node(doc);
    const key = (path: string) => recordReminderKey("rule", "db", path, 1, { dueAt: 1, dateField: "due" });
    const rows = [{ ...item("A"), instance: 1 }, { ...item("B"), key: key("B.md"), instance: 2 }];
    const service = { pending: () => rows };
    const inbox = new RecordReminderInbox({} as App, service as unknown as RecordReminderService, () => false, rows[1]);
    Object.assign(inbox, { contentEl, containerEl, modalEl });
    inbox.open();
    expect(doc.activeElement?.dataset.reminderKey).toBe(key("B.md"));
    const search = contentEl.flatten().find(node => node.cls.includes("db-ri-search"))!;
    search.value = "A";
    search.oninput?.();
    inbox.present({ key: key("B.md"), instance: 9 });
    expect(search.value).toBe("A");
    inbox.present({ key: key("Old/B.md"), instance: 2 });
    expect(search.value).toBe("");
    expect(doc.activeElement?.dataset.reminderKey).toBe(key("B.md"));
  } finally { vi.unstubAllGlobals(); }
});

it("reveals an explicitly clicked notification target when an unrelated idle detail is open", () => {
  setLocale("en");
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  try {
    const doc: Doc = { defaultView: { setInterval: () => 1 }, body: undefined! };
    doc.body = new Node(doc);
    doc.querySelectorAll = () => [];
    const contentEl = new Node(doc), containerEl = new Node(doc), modalEl = new Node(doc);
    let pending = [item("A")];
    const service = { pending: () => pending };
    const inbox = new RecordReminderInbox({} as App, service as unknown as RecordReminderService, () => false);
    Object.assign(inbox, { contentEl, containerEl, modalEl });
    inbox.onOpen();
    const internal = inbox as unknown as { layer?: { host: { querySelector(): object | null } }; closeDetail(restore: boolean): void };
    let editorOpen = true;
    internal.layer = { host: { querySelector: () => editorOpen ? {} : null } };
    const close = vi.spyOn(internal, "closeDetail").mockImplementation(() => { internal.layer = undefined; });
    pending = [item("A"), item("B")];
    expect(inbox.present(item("B"))).toBe(true);
    expect(close).not.toHaveBeenCalled();
    editorOpen = false;
    inbox.refreshPending();
    expect(close).toHaveBeenCalledOnce();
    expect(doc.activeElement?.dataset.reminderKey).toBe("B");
  } finally { vi.unstubAllGlobals(); }
});
