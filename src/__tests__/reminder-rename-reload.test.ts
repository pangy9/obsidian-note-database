import { afterEach, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { DataSource } from "../data/DataSource";
import { setLocale } from "../i18n";
import { RecordReminderService } from "../data/RecordReminderService";
import type { RecordReminderSettings } from "../data/RecordReminders";

const seen = vi.hoisted(() => ({ notice: vi.fn(), hide: vi.fn() }));
vi.mock("obsidian", () => ({
  TFile: class {}, TFolder: class {}, normalizePath: (value: string) => value,
  Notice: class {
    constructor(_msg: unknown, duration: number) { if (duration === 10000) seen.notice(); }
    hide() { seen.hide(); }
  },
}));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it.each([0, 79, 80])("a dismissed reminder remains dismissed when the plugin reloads %i ms after renaming the note", async (waitAfterRename) => {
  vi.useFakeTimers(); vi.stubGlobal("window", globalThis);
  setLocale("en");
  vi.setSystemTime(new Date(2026, 10, 25, 12));
  const f = (path: string) => Object.assign(new TFile(), { path, extension: "md", basename: path.split("/").at(-1)!.slice(0, -3) });
  const definition = f("DB.md"), note = f("Tasks/A.md");
  const noteProperties = { due: "2026-11-25T11:00", done: false };
  const dbProperties = { db_view: true, database: { id: "tasks", name: "Tasks", sourceFolder: "Tasks",
    columns: [{ key: "due", label: "Due", type: "datetime" }, { key: "done", label: "Done", type: "checkbox" }],
    views: [{ id: "one", name: "One", viewType: "table" }] } };
  const handlers = new Map<string, (...args: any[]) => void>();
  const on = (event: string, callback: (...args: any[]) => void) => {
    handlers.set(event, callback); return { offref: () => handlers.delete(event) };
  };
  const app = {
    workspace: { containerEl: { ownerDocument: { createDocumentFragment: () => ({ createEl: () => ({ addClass() {}, onclick: null }) }) } } },
    vault: { on, getMarkdownFiles: () => [definition, note], getAbstractFileByPath: (p: string) => [definition, note].find(x => x.path === p) },
    metadataCache: { on, getFileCache: (file: TFile) => ({ frontmatter: file === definition ? dbProperties : noteProperties }) },
  } as unknown as App;
  const source = new DataSource(app);
  source.startListening();
  const settings: RecordReminderSettings = { rules: [{ id: "r", databaseId: "tasks", enabled: true,
    dateField: "due", completionField: "done", completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0,
    offsets: [0], activatedAt: +new Date(2026, 10, 24) }], states: {} };
  let durable = structuredClone(settings);
  const service = new RecordReminderService(app, source, () => settings, async () => { durable = structuredClone(settings); }, () => {});
  const timer = window.setInterval(() => service.tick(), 30000);
  try {
    const [pending] = service.pending();
    expect(pending.path).toBe("Tasks/A.md");
    await service.update(pending, false);
    expect(service.pending()).toEqual([]);
    const oldPath = note.path;
    note.path = "Tasks/B.md";
    note.basename = "B";
    handlers.get("rename")!(note, oldPath);
    expect(service.pending()).toEqual([]);
    expect(Object.keys(settings.states)[0]).toContain("Tasks/B.md");
    await vi.advanceTimersByTimeAsync(waitAfterRename);
    window.clearInterval(timer);
    service.destroy();
    source.destroy();
    const reopenedSource = new DataSource(app);
    reopenedSource.startListening();
    const reopened = new RecordReminderService(app, reopenedSource, () => durable, async () => {}, () => {});
    try {
      reopened.tick();
      const result = {
        pending: reopened.pending().map(row => row.path),
        notificationCount: seen.notice.mock.calls.length,
        diskKeys: Object.keys(durable.states),
      };
      expect({ pending: result.pending, notifications: result.notificationCount }).toEqual({ pending: [], notifications: 0 });
    } finally { reopened.destroy(); reopenedSource.destroy(); }
  } finally { window.clearInterval(timer); service.destroy(); source.destroy(); }
});
