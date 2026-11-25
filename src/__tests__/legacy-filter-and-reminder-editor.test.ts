import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { QueryEngine } from "../data/QueryEngine";
import type { DataChangeCallback, DataSource, ViewConfigMutationCallback } from "../data/DataSource";
import type { RecordReminderRule, RecordReminderSettings } from "../data/RecordReminders";
import type { DatabaseConfig, FilterRule, RowData, ViewConfig } from "../data/types";
import { setLocale } from "../i18n";
import { FilterPanelRenderer } from "../views/FilterPanelRenderer";
import { ViewStateStore } from "../views/ViewStateStore";
import { RecordReminderSettingsModal } from "../views/modals/RecordReminderModal";
import type { DropdownFieldOptions } from "../views/DropdownField";

const ui = vi.hoisted(() => ({
  dropdown: vi.fn<(options: DropdownFieldOptions) => void>(),
  choose: undefined as ((action: string) => void) | undefined,
}));
vi.mock("obsidian", () => ({
  TFile: class {}, Component: class {}, Modal: class { close() {} },
  Scope: class { register() {} }, setIcon() {}, setTooltip() {}, addIcon() {},
  Notice: class {}, ToggleComponent: class {},
}));
vi.mock("../data/FileFieldObsidian", () => ({ getRowFileFieldValue: () => undefined }));
vi.mock("../views/DropdownField", () => ({
  closeDropdownForRoot: () => false,
  createDropdownField: ui.dropdown,
  openDropdownMenu: (options: { onChange: (action: string) => void }) => { ui.choose = options.onChange; },
}));
vi.mock("../views/DateValuePicker", () => ({ closeActiveDateValuePicker() {}, renderDateValuePicker() {} }));
vi.mock("../views/modals/ModalDrag", () => ({ makeModalDraggable() {} }));

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
class ElementStub {
  readonly children: ElementStub[] = [];
  ownerDocument = { createElementNS: (_namespace: string, tag: string) => new ElementStub(tag),
    defaultView: { requestAnimationFrame: () => 1, ResizeObserver: class { observe() {} disconnect() {} }, setInterval: (callback: () => void, ms: number) => setInterval(callback, ms), clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id) } };
  readonly classList = { add() {} };
  readonly dataset: Record<string, string> = {};
  readonly attrs: Record<string, string>;
  readonly cls: string;
  textContent = "";
  scrollTop = 0;
  clientWidth = 116;
  getBoundingClientRect() { return { width: this.textContent.length * 7 }; }
  value = "";
  disabled = false;
  isConnected = true;
  onclick?: () => void;

  constructor(readonly tag: string, opts?: Options) {
    this.cls = opts?.cls ?? "";
    this.attrs = { ...opts?.attr };
    this.textContent = opts?.text ?? "";
  }
  createEl(tag: string, opts?: Options): ElementStub {
    const child = new ElementStub(tag, opts);
    return this.appendChild(child);
  }
  appendChild(child: ElementStub) { this.children.push(child); return child; }
  createDiv(opts?: Options) { return this.createEl("div", opts); }
  createSpan(opts?: Options) { return this.createEl("span", opts); }
  addClass() {}
  toggleClass() {}
  empty() { this.children.length = 0; }
  focus() {}
  blur() {}
  onblur?: () => void;
  oninput?: () => void;
  scrollIntoView() {}
  setText(text: string) { this.textContent = text; }
  getAttribute(key: string) { return this.attrs[key] ?? null; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  find(predicate: (e: ElementStub) => boolean): ElementStub | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
  }
  querySelector(selector: string) {
    if (selector === "[data-reminder-control=add]") return this.find(e => e.dataset.reminderControl === "add");
    if (selector.startsWith(".")) return this.find(e => e.cls.split(/\s+/).includes(selector.slice(1)));
    return null;
  }
  querySelectorAll() { return []; }
  get text(): string { return this.textContent + this.children.map(child => child.text).join(""); }
}
const element = (stub: ElementStub) => stub as unknown as HTMLElement;

describe("read-only rendering of saved filters", () => {
  it("does not change a legacy numeric formula substring filter until a user chooses another operator", () => {
    setLocale("en"); ui.dropdown.mockClear();
    const config: ViewConfig = { name: "Test", sourceFolder: "", schema: {
      columns: [{ key: "result", label: "Result", type: "computed", computedKey: "formula.result" }],
      computedFields: [{ key: "result", label: "Result", expression: "0", type: "number" }],
    } };
    const state = new ViewStateStore().get(0, 0, config);
    const rule: FilterRule = { field: "result", op: "contains", value: "1" };
    state.filters.push(rule);
    const rows = [1, 12, 21, 2].map(value => ({
      file: { path: `${value}.md` } as RowData["file"], frontmatter: {}, computed: { result: value },
    }));
    const modelColumn = [{ ...config.schema.columns[0], type: "number" as const }];
    const engine = new QueryEngine();
    const currentMatches = () => engine.applyFilters(rows, state.filters, "and", modelColumn).map(row => row.file.path);
    const parent = new ElementStub("div");
    const actions = { saveState: vi.fn(), refresh: vi.fn(), close: vi.fn() };
    expect(currentMatches()).toEqual(["1.md", "12.md", "21.md"]);
    new FilterPanelRenderer().renderSingleRuleEditor(element(parent), element(parent), 0, state, config, actions);
    expect(rule).toEqual({ field: "result", op: "contains", value: "1" });
    expect(currentMatches()).toEqual(["1.md", "12.md", "21.md"]);
    expect(actions.saveState).not.toHaveBeenCalled();
    expect(parent.find(node => node.tag === "input")?.attrs.type).toBe("text");
    const dropdown = ui.dropdown.mock.calls.find(([opts]) => opts.className?.includes("db-filter-operator-dropdown"))?.[0];
    expect(dropdown?.value).toBe("contains");
    expect(dropdown?.options.some(option => option.value === "contains")).toBe(true);
    dropdown?.onChange?.("eq");
    expect(rule.op).toBe("eq");
    expect(currentMatches()).toEqual(["1.md"]);
    expect(actions.saveState).toHaveBeenCalledOnce();
  });

  it("preserves a formatted numeric formula literal when its field is blurred without editing", () => {
    const config: ViewConfig = { name: "Test", sourceFolder: "", schema: {
      columns: [{ key: "result", label: "Result", type: "computed", computedKey: "formula.result" }],
      computedFields: [{ key: "result", label: "Result", expression: "0", type: "number" }],
    } };
    const state = new ViewStateStore().get(0, 0, config);
    const rule: FilterRule = { field: "result", op: "eq", value: "$12" };
    state.filters.push(rule);
    const parent = new ElementStub("div");
    const actions = { saveState: vi.fn(), refresh: vi.fn(), close: vi.fn() };
    new FilterPanelRenderer().renderSingleRuleEditor(element(parent), element(parent), 0, state, config, actions);
    const input = parent.find(e => e.tag === "input")!;
    expect(input.attrs.type).toBe("text");
    expect(input.value).toBe("$12");
    input.onblur?.();
    expect(rule.value).toBe("$12");
    expect(actions.saveState).not.toHaveBeenCalled();
  });

  it("retains the original legacy checkbox literal instead of showing an opposite boolean", () => {
    setLocale("en");
    const config: ViewConfig = { name: "Test", sourceFolder: "", schema: {
      columns: [{ key: "paid", label: "Paid", type: "computed", computedKey: "paid" }],
      computedFields: [{ key: "paid", label: "Paid", expression: "false", type: "checkbox" }],
    } };
    const state = new ViewStateStore().get(0, 0, config);
    const rule: FilterRule = { field: "paid", op: "eq", value: "on", comparison: "legacy" };
    state.filters.push(rule);
    const parent = new ElementStub("div");
    const actions = { saveState: vi.fn(), refresh: vi.fn(), close: vi.fn() };
    new FilterPanelRenderer().renderSingleRuleEditor(element(parent), element(parent), 0, state, config, actions);
    const input = parent.find(e => e.tag === "input")!;
    expect(input.value).toBe("on");
    input.onblur?.();
    expect(rule).toEqual({ field: "paid", op: "eq", value: "on", comparison: "legacy" });
    expect(actions.saveState).not.toHaveBeenCalled();
  });

  it("displays a legacy checkbox comparison as checked, but does not rewrite it while rendering", () => {
    ui.dropdown.mockClear();
    const config: ViewConfig = { name: "Test", sourceFolder: "", schema: { columns: [{ key: "done", label: "Done", type: "checkbox" }], computedFields: [] } };
    const state = new ViewStateStore().get(0, 0, config);
    const rule: FilterRule = { field: "done", op: "eq", value: "✓" };
    state.filters.push(rule);
    const parent = element(new ElementStub("div"));
    new FilterPanelRenderer().renderSingleRuleEditor(parent, parent, 0, state, config, { saveState: vi.fn(), refresh: vi.fn(), close: vi.fn() });
    expect(rule).toEqual({ field: "done", op: "eq", value: "✓" });
    expect(ui.dropdown.mock.calls.find(([opts]) => opts.className?.includes("db-filter-operator-dropdown"))?.[0].value).toBe("notempty");
  });
});

it("saves normally after deleting the rule that is currently being renamed", async () => {
  setLocale("en");
  const db: DatabaseConfig = { id: "db", name: "Test", sourceFolder: "", views: [], schema: {
    columns: [{ key: "due", label: "Due", type: "datetime" }, { key: "done", label: "Done", type: "checkbox" }],
    computedFields: [],
  } };
  const rule: RecordReminderRule = { id: "rule", databaseId: db.id, enabled: true, dateField: "due", completionField: "done",
    completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0 };
  const settings: RecordReminderSettings = { rules: [rule], states: {} };
  const source = { getViewDefFiles: () => [{ config: db, file: { path: "DB.md" } }], onDataChanged: () => () => {}, onViewConfigChanged: () => () => {},
    getRecordsForDatabase: () => [] } as unknown as DataSource;
  const save = vi.fn().mockResolvedValue(undefined);
  const modal = new RecordReminderSettingsModal({} as App, source, db.id, settings, save, vi.fn());
  const content = new ElementStub("div");
  Object.assign(modal, { contentEl: content, modalEl: new ElementStub("div"), containerEl: new ElementStub("div") });
  modal.onOpen();
  const actions = () => content.find(e => e.attrs["aria-label"] === "Actions for rule: Due")!;
  const saveButton = () => content.find(e => e.tag === "button" && e.text === "Save")!;
  actions().onclick?.();
  ui.choose?.("rename");
  expect(saveButton().disabled).toBe(true);
  actions().onclick?.();
  ui.choose?.("remove");
  expect(saveButton().disabled).toBe(false);
  saveButton().onclick?.();
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith([], [rule]);
  expect(settings.rules).toEqual([rule]); // publication belongs to the persisted writer
  modal.onClose();
});

it("shows only the rule identity, times and state when folded, with the date property in the form", () => {
  setLocale("en");
  ui.dropdown.mockClear();
  const db: DatabaseConfig = { id: "db", name: "Test", sourceFolder: "", views: [], schema: {
    columns: [{ key: "due", label: "Delivery time", type: "datetime" }, { key: "done", label: "Done", type: "checkbox" }],
    computedFields: [],
  } };
  const rule: RecordReminderRule = { id: "rule", name: "Delivery reminder", databaseId: db.id, enabled: false,
    dateField: "due", completionField: "done", completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0, offsets: [-30, 0] };
  const source = { getViewDefFiles: () => [{ config: db, file: { path: "DB.md" } }], onDataChanged: () => () => {},
    onViewConfigChanged: () => () => {}, getRecordsForDatabase: () => [] } as unknown as DataSource;
  const modal = new RecordReminderSettingsModal({} as App, source, db.id, { rules: [rule], states: {} }, vi.fn(), vi.fn());
  const content = new ElementStub("div");
  Object.assign(modal, { contentEl: content, modalEl: new ElementStub("div"), containerEl: new ElementStub("div") });
  modal.onOpen();
  try {
    const header = () => content.find(e => e.cls === "db-rr-toggle")!;
    expect(header().attrs["aria-expanded"]).toBe("true");
    expect(ui.dropdown.mock.calls.some(([opts]) => opts.options.some(option => option.text === "Delivery time"))).toBe(true);
    header().onclick?.();
    expect(header().attrs["aria-expanded"]).toBe("false");
    expect(header().find(e => e.cls === "db-rr-identity")?.text).toBe("Delivery reminder");
    expect(header().find(e => e.cls === "db-rr-offset-strip")?.text).toContain("−30m");
    expect(header().find(e => e.cls.startsWith("db-rr-rule-state"))?.text).toBe("Paused");
    expect(content.find(e => e.cls === "db-rr-form")).toBeUndefined();
    header().onclick?.();
    expect(content.find(e => e.cls === "db-rr-form")).toBeDefined();
  } finally { modal.onClose(); }
});

function previewFixture() {
  setLocale("en");
  const db: DatabaseConfig = { id: "db", name: "Test", sourceFolder: "Old", views: [], schema: {
    columns: [{ key: "due", label: "Due", type: "datetime" }, { key: "done", label: "Done", type: "checkbox" }], computedFields: [],
  } };
  const rule: RecordReminderRule = { id: "rule", databaseId: db.id, enabled: true, dateField: "due", completionField: "done",
    completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0 };
  const committed = { ...db };
  const settings: RecordReminderSettings = { rules: [rule], states: {} };
  const event = { data: (() => {}) as DataChangeCallback, config: (() => {}) as ViewConfigMutationCallback };
  const records = [{ file: { path: "Old/A.md", basename: "A" }, frontmatter: { due: "2026-11-18T10:00", done: false } }];
  const source = {
    getViewDefFiles: () => [{ config: { ...committed }, file: { path: "DB.md" } }],
    onDataChanged: (callback: DataChangeCallback) => { event.data = callback; return () => {}; },
    onViewConfigChanged: (callback: ViewConfigMutationCallback) => { event.config = callback; return () => {}; },
    getRecordsForDatabase: (scope: DatabaseConfig) => records.filter(record => record.file.path.startsWith(scope.sourceFolder + "/")),
  } as unknown as DataSource;
  const modal = new RecordReminderSettingsModal({} as App, source, db.id, settings, vi.fn(), vi.fn());
  const content = new ElementStub("div");
  Object.assign(modal, { contentEl: content, modalEl: new ElementStub("div"), containerEl: new ElementStub("div") });
  modal.onOpen();
  return { content, committed, event, modal };
}

it("reminder rule previews use the newly committed database source", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 10, 18, 9, 59).getTime());
  try {
    const { content, committed, event, modal } = previewFixture();
    expect(content.text).toContain("Later 1");
    committed.sourceFolder = "New";
    event.data({ changes: [{ kind: "changed", path: "DB.md", origin: "external" }] });
    expect(content.text).toContain("Later 0");
    committed.sourceFolder = "Old";
    event.config({ dbId: "db", dbPath: "DB.md", sourceInstanceId: "other" });
    expect(content.text).toContain("Later 1");
    modal.onClose();
  } finally { clock.mockRestore(); }
});

it("an open reminder preview follows the clock when crossing a trigger", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 18, 9, 59));
  try {
    const { content, modal } = previewFixture();
    expect(content.text).toContain("Later 1");
    vi.advanceTimersByTime(90_000);
    expect(content.text).toContain("Due now 1");
    modal.onClose();
  } finally { vi.useRealTimers(); }
});

it("a database schema change makes the new completion statuses selectable without closing the editor", () => {
  const { content, committed, event, modal } = previewFixture();
  committed.schema = { ...committed.schema, columns: [committed.schema.columns[0], { key: "done", label: "Done", type: "status", statusOptions: [{ value: "Closed", color: "green" }] }] };
  event.config({ dbId: "db", dbPath: "DB.md", sourceInstanceId: "other" });
  expect(content.find(node => node.cls.includes("db-rr-status-chip") && node.text === "Closed")).toBeDefined();
  modal.onClose();
  modal.onClose();
});

it("keeps a renamed date reference when saving the open draft as paused", async () => {
  const { persistRecordReminderRules, renameRecordReminderField } = await import("../data/RecordReminders");
  setLocale("en");
  const db: DatabaseConfig = { id: "db", name: "Test", sourceFolder: "", views: [], schema: {
    columns: [{ key: "due", label: "Due", type: "datetime" }, { key: "done", label: "Done", type: "checkbox" }], computedFields: [],
  } };
  const settings: RecordReminderSettings = { rules: [{ id: "r", databaseId: "db", enabled: true,
    dateField: "due", completionField: "done", completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0 }], states: {} };
  let emit = (() => {}) as ViewConfigMutationCallback;
  const source = { getViewDefFiles: () => [{ config: db, file: { path: "DB.md" } }], onDataChanged: () => () => {},
    onViewConfigChanged: (handler: ViewConfigMutationCallback) => { emit = handler; return () => {}; }, getRecordsForDatabase: () => [] } as unknown as DataSource;
  let persisted: RecordReminderSettings | undefined;
  const save = (draft: RecordReminderRule[], expected: readonly RecordReminderRule[]) =>
    persistRecordReminderRules(settings, "db", draft, async next => { persisted = structuredClone(next); }, Date.now(), expected);
  const modal = new RecordReminderSettingsModal({} as App, source, "db", settings, save, vi.fn());
  const content = new ElementStub("div");
  Object.assign(modal, { contentEl: content, modalEl: new ElementStub("div"), containerEl: new ElementStub("div") });
  modal.onOpen();
  try {
    renameRecordReminderField(settings, "db", "due", "deadline");
    db.schema.columns[0] = { key: "deadline", label: "Due", type: "datetime" };
    emit({ dbId: "db", dbPath: "DB.md", sourceInstanceId: "other" });
    expect(settings.rules[0].dateField).toBe("deadline");
    const actions = content.find(e => e.attrs["aria-label"] === "Actions for rule: due")!;
    actions.onclick?.();
    ui.choose?.("enable");
    content.find(e => e.tag === "button" && e.text === "Save")!.onclick?.();
    await vi.waitFor(() => expect(persisted?.rules[0]?.enabled).toBe(false));
    expect(persisted?.rules[0]?.dateField).toBe("deadline");
  } finally { modal.onClose(); }
});

it("rejects a reminder reference change that races the queued settings write", async () => {
  const { persistRecordReminderRules, renameRecordReminderField, RecordReminderRulesConflict } = await import("../data/RecordReminders");
  const rule: RecordReminderRule = { id: "r", databaseId: "db", enabled: true, dateField: "due", completionField: "done",
    completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0 };
  const settings: RecordReminderSettings = { rules: [rule], states: {} };
  const expected = structuredClone(settings.rules);
  renameRecordReminderField(settings, "db", "due", "deadline");
  const write = vi.fn();
  await expect(persistRecordReminderRules(settings, "db", [{ ...rule, enabled: false }], write, Date.now(), expected))
    .rejects.toBeInstanceOf(RecordReminderRulesConflict);
  expect(write).not.toHaveBeenCalled();
  expect(settings.rules[0]).toMatchObject({ dateField: "deadline", enabled: true });
});
