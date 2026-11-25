import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
setLocale("en");

import { RecordReminderService } from "../data/RecordReminderService";
import { TFile, type App } from "obsidian";
import { EmbeddedDataOperations } from "../views/EmbeddedDataOperations";
import { prepareReminderCompletionRename } from "../data/RecordReminders";
import type { ColumnDef } from "../data/types";
import type { DataChangeBatch, DataSource, NoteRecord } from "../data/DataSource";
import type { DatabaseConfig } from "../data/types";
import type { RecordReminderSettings } from "../data/RecordReminders";

const notices = vi.hoisted(() => ({ create: vi.fn(), hide: vi.fn() }));
vi.mock("obsidian", () => ({ TFile: class {}, Notice: class { constructor() { notices.create(); } hide() { notices.hide(); } } }));
const file = (label: string) => ({ path: "Tasks/A.md", basename: "A", extension: "md", stat: { ctime: label === "old" ? 1 : 2 } }) as unknown as NoteRecord["file"];
const database = { id: "db", name: "Tasks", views: [{ id: "view", viewType: "table", titleField: "name" }],
  schema: { columns: [{ key: "due", label: "Due", type: "datetime" }, { key: "done", label: "Done", type: "checkbox" }, { key: "name", label: "Name", type: "text" }] },
} as unknown as DatabaseConfig;
const old = { file: file("old"), frontmatter: { due: "2026-11-25T10:00", done: false, name: "Original" } };
const replacement = { file: file("new"), frontmatter: { ...old.frontmatter, name: "Replacement" } };
const when = (hour: number, minute: number, second = 0) => new Date(2026, 10, 25, hour, minute, second);
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(when(9, 54));
  const app = { workspace: { containerEl: { ownerDocument: { createDocumentFragment: () => ({ createSpan: () => ({ addClass() {} }), createEl: () => ({ addClass() {}, onclick: null }) }) } } } } as unknown as App;
  let notify!: (batch: DataChangeBatch) => void;
  let records = [old];
  const source = { getRecordSnapshot: () => null, getViewDefFiles: () => [{ file: { path: "DB.md" }, config: database }], getRecordsForDatabase: () => records,
    onDataChanged: (receive: typeof notify) => { notify = receive; return () => {}; }, onViewConfigChanged: () => () => {},
  } as unknown as DataSource;
  const settings: RecordReminderSettings = { rules: [{ id: "r", databaseId: "db", enabled: true, dateField: "due", completionField: "done", completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0, offsets: [-6, -5] }], states: {} };
  const save = vi.fn().mockResolvedValue(undefined);
  const service = new RecordReminderService(app, source, () => settings, save, () => {});
  return { service, save, replace() { records = [replacement]; notify({ changes: [{ kind:"deleted", path:old.file.path, origin:"external" }, { kind:"created", path:old.file.path, origin:"external" }] }); } };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("refuses persisted action on a stale inbox row after its path is reused", async () => {
  const { service, save, replace } = setup();
  const [row] = service.pending();
  expect(row.title).toBe("Original");
  replace();
  expect(service.pending()).toMatchObject([{ title: "Replacement", key: row.key }]);
  expect(service.isOriginalRecord(row, replacement.file)).toBe(false);
  expect(service.isOriginalRecord(service.pending()[0], replacement.file)).toBe(true);
  const action = await service.update(row, false);
  expect(save).not.toHaveBeenCalled();
  expect({ accepted: typeof action === "function", remaining: service.pending().map(item => item.title) }).toEqual({ accepted: false, remaining: ["Replacement"] });
});
it("never announces a later reminder point while undo of its schedule-wide snooze is uncommitted", async () => {
  const { service, save } = setup();
  const [row] = service.pending();
  const undo = (await service.update(row, true))!;
  vi.setSystemTime(when(9, 55));
  expect(service.pending()).toEqual([]);
  let reject!: (error: Error) => void;
  save.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  const undoPending = undo();
  const outcome = expect(undoPending).rejects.toThrow("save failed");
  expect(service.pending()).toEqual([]);
  service.tick();
  const uncommittedNotices = notices.create.mock.calls.length;
  reject(new Error("save failed"));
  await outcome;
  expect(service.pending()).toEqual([]);
  expect(await undo()).toBe(true);
  expect(service.pending()[0].key).not.toEqual(row.key);
  expect(notices.create).not.toHaveBeenCalled();
  expect(uncommittedNotices).toBe(0);
});

it("does not announce a completed task while the embedded editor renames its completed status", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(when(10, 30));
  const field: ColumnDef = { key: "state", label: "State", type: "status", statusOptions: [{ value: "Done", color: "green" }] };
  const schema = { columns: [field, { key: "due", label: "Due", type: "datetime" as const }], computedFields: [] };
  let database: DatabaseConfig = { id: "db", name: "DB", sourceFolder: "Notes", schema,
    views: [{ id: "view", name: "View", sourceFolder: "", schema }] };
  const dbFile = Object.assign(new TFile(), { path: "DB.md" });
  const taskFile = Object.assign(new TFile(), { path: "Notes/task.md", basename: "task" });
  const task = { state: "Done", due: "2026-11-25T10:00" };
  const settings: RecordReminderSettings = { rules: [{ id: "r", databaseId: "db", enabled: true, dateField: "due", completionField: "state",
    completedValues: ["Done"], dateOnlyTime: "09:00", advanceMinutes: 0 }], states: {} };
  const app = { vault: { getAbstractFileByPath: (path: string) => path === dbFile.path ? dbFile : taskFile },
    workspace: { containerEl: { ownerDocument: { createDocumentFragment: () => ({ createSpan: () => ({ addClass() {} }), createEl: () => ({ addClass() {}, onclick: null }) }) } } },
  } as unknown as App;
  let notify!: (batch: DataChangeBatch) => void;
  let resume!: () => void;
  const publication = new Promise<void>(resolve => { resume = resolve; });
  let started!: () => void;
  const applied = new Promise<void>(resolve => { started = resolve; });
  const data = {
    getRecordSnapshot: () => null, getViewDefFiles: () => [{ file: dbFile, config: database }],
    getRecordsForDatabase: () => [{ file: taskFile, frontmatter: task }],
    onDataChanged: (receive: typeof notify) => { notify = receive; return () => {}; }, onViewConfigChanged: () => () => {},
    readViewDefSnapshot: async () => ({ typedConfig: structuredClone(database), rawPayload: database }),
    serializeDatabaseConfig: (value: DatabaseConfig) => value,
    readFrontmatterKeySnapshots: async () => ({ state: { exists: true, value: task.state } }),
    patchFrontmatter: async (_p: string, _expected: unknown, put: { state: { value: string } }, guard: () => void) => {
      guard(); task.state = put.state.value;
      setTimeout(() => notify({ changes: [{ kind: "changed", path: taskFile.path, origin: "plugin" }] }), 80);
      started();
    },
    patchViewDefConfig: async (_p: string, _expected: unknown, _patch: unknown, next: DatabaseConfig, _mutation: unknown, guard: () => void) => {
      await publication;
      guard(); database = next;
    },
  } as unknown as DataSource;
  const service = new RecordReminderService(app, data, () => settings, async () => {}, () => {});
  const op = new EmbeddedDataOperations(app, data, "fixture", () => ({ path: dbFile.path, dbId: "db", viewId: "view" }),
    () => true, () => {}, async () => {}, () => {}, async (dbId, change, reverse) => {
      const update = prepareReminderCompletionRename(settings.rules, dbId, change, reverse);
      settings.rules = update.rules;
      change.history = update.history;
      service.refresh();
    });
  expect(service.pending()).toEqual([]);
  const edit = op.editField([taskFile.path], field, undefined, { previousOptions: field.statusOptions,
    nextOptions: [{ value: "Closed", color: "green" }], renameValues: [{ from: "Done", to: "Closed" }], setValue: false });
  await applied;
  await vi.advanceTimersByTimeAsync(80);
  const interim = { record: task.state, rule: settings.rules[0].completedValues[0], pending: service.pending().length, notices: notices.create.mock.calls.length };
  resume();
  expect(await edit).toBe(true);
  const after = { record: task.state, rule: settings.rules[0].completedValues[0], pending: service.pending().length };
  expect(interim).toEqual({ record: "Closed", rule: "Done", pending: 0, notices: 0 });
  expect(after).toEqual({ record: "Closed", rule: "Closed", pending: 0 });
});
