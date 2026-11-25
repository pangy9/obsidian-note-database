import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordReminderService } from "../data/RecordReminderService";
import { DesktopReminderNotification } from "../data/DesktopReminderNotification";
import { setLocale } from "../i18n";
import type { App } from "obsidian";
import type { DataChange, DataChangeBatch, DataSource, NoteRecord } from "../data/DataSource";
import { recordReminderKey, type DueRecordReminder, type RecordReminderSettings } from "../data/RecordReminders";
import type { DatabaseConfig } from "../data/types";
const notices = vi.hoisted(() => ({ created: vi.fn(), hide: vi.fn() }));
vi.mock("obsidian", () => ({ Notice: class { constructor() { notices.created(); } hide() { notices.hide(); } } }));
setLocale("en");
const reminder: DueRecordReminder = { key: "key", ruleId: "r", databaseId: "db", databaseName: "Test", path: "Tasks/A.md", title: "A", dueAt: 1, reminderAt: 1, ruleName: "Deadline", dateFieldLabel: "Due" };
function fixture(enabled: () => boolean = () => true, enqueue?: <T>(write: () => Promise<T>) => Promise<T>,
  desktopNotification?: DesktopReminderNotification, desktopPreviewEnabled?: () => boolean) {
  const unsubscribe = vi.fn();
  const content: { tag: string; options: { text: string; cls?: string; attr?: Record<string, string> }; onclick?: () => void; addClass(): void }[] = [];
  const app = { vault: { getName: () => "Test vault" }, workspace: { containerEl: { ownerDocument: { createDocumentFragment: () => ({
    createEl(tag: string, options: typeof content[number]["options"]) {
      const element = { tag, options, addClass() {} };
      content.push(element);
      return element;
    },
  }) } } } } as unknown as App;
  const emit = { data: (_batch: DataChangeBatch) => {} };
  const source = { getRecordSnapshot: () => undefined, onDataChanged: (cb: typeof emit.data) => {
    emit.data = cb; return unsubscribe;
  }, onViewConfigChanged: () => () => {} } as unknown as DataSource;
  const settings: RecordReminderSettings = { rules: [], states: {} };
  const save = vi.fn().mockResolvedValue(undefined), open = vi.fn();
  const service = new RecordReminderService(app, source, () => settings, save, open, enabled, enqueue, desktopNotification, desktopPreviewEnabled);
  const pending = vi.spyOn(service, "pending").mockReturnValue([reminder]);
  return { service, settings, save, open, pending, unsubscribe, emit, content, source };
}
beforeEach(() => vi.clearAllMocks());
describe("record reminder scheduler", () => {
  it("announces each due schedule once per session and suppresses completed records", () => {
    const { service, pending } = fixture();
    service.tick(); service.tick();
    expect(notices.created).toHaveBeenCalledTimes(1);
    pending.mockReturnValue([]); service.tick(); expect(notices.hide).toHaveBeenCalled();
    pending.mockReturnValue([reminder]); service.tick(); expect(notices.created).toHaveBeenCalledTimes(2);
    service.destroy();
  });
  it("opens the inbox from the compact notice button without changing reminder state", () => {
    const { service, content, open, settings } = fixture();
    service.tick();
    const action = content.find(el => el.tag === "button")!;
    expect(action.options).toMatchObject({
      cls: "db-reminder-notice-action", text: "View",
      attr: { type: "button", "aria-label": "View record reminders" },
    });
    action.onclick?.();
    expect(open).toHaveBeenCalledOnce();
    expect(notices.hide).toHaveBeenCalledOnce();
    expect(settings.states).toEqual({});
    service.destroy();
  });
  it("persists snooze without modifying the record", async () => {
    const { service, settings, save } = fixture();
    const before = Date.now(); await service.update(reminder, true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(settings.states.key.snoozedUntil).toBeGreaterThanOrEqual(before + 600000);
    expect(settings.states.key.dismissed).toBeUndefined(); service.destroy();
  });
  it("restores the previous reminder state when saving fails", async () => {
    const { service, settings, save } = fixture();
    settings.states.key = { snoozedUntil: 20, updatedAt: 10 };
    save.mockRejectedValue(new Error("disk unavailable"));
    await expect(service.update(reminder, false)).rejects.toThrow("disk unavailable");
    expect(settings.states.key).toEqual({ snoozedUntil: 20, updatedAt: 10 }); service.destroy();
  });
  it.each([false, true])("retains a notification when an in-flight inbox action fails (snooze: %s)", async (snooze) => {
    const { service, settings, save, source, pending } = fixture();
    pending.mockRestore();
    const now = Date.now();
    settings.rules = [{
      id: "r", databaseId: "db", enabled: true, dateField: "due", completionField: "done",
      completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0, activatedAt: now - 3600000,
    }];
    const db: DatabaseConfig = {
      id: "db", name: "Test", sourceFolder: "Tasks", views: [],
      schema: { columns: [{ key: "due", label: "Due", type: "datetime" }, { key: "done", label: "Done", type: "checkbox" }], computedFields: [] },
    };
    const record: NoteRecord = {
      file: { path: "Tasks/A.md", basename: "A" } as NoteRecord["file"],
      frontmatter: { due: new Date(now - 60000).toISOString(), done: false },
    };
    source.getViewDefFiles = () => [{ config: db, file: { path: "DB.md" } as NoteRecord["file"] }];
    source.getRecordsForDatabase = () => [record];
    try {
      service.tick();
      expect(notices.created).toHaveBeenCalledOnce();
      const [due] = service.pending();
      let reject: (error: Error) => void = () => {};
      save.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
      const saving = service.update(due, snooze);
      const rejection = expect(saving).rejects.toThrow("disk unavailable");
      service.tick();
      const during = { pending: service.pending().length, hidden: notices.hide.mock.calls.length };
      reject(new Error("disk unavailable"));
      await rejection;
      service.tick();
      expect(during).toEqual({ pending: 1, hidden: 0 });
      expect(service.pending()).toEqual([due]);
      expect(notices.created).toHaveBeenCalledOnce();
      expect(settings.states).toEqual({});
      expect(await service.update(due, snooze)).toBeDefined();
      expect(service.pending()).toEqual([]);
    } finally { service.destroy(); }
  });
  it("avoids a vault scan when no reminder rules are enabled", () => {
    const { service, pending } = fixture(); pending.mockRestore();
    expect(service.pending()).toEqual([]); service.destroy();
  });
  it("unsubscribes and stops notices after unloading", () => {
    const { service, pending, unsubscribe } = fixture(); service.destroy(); service.tick();
    expect(unsubscribe).toHaveBeenCalledTimes(1); expect(pending).not.toHaveBeenCalled();
  });
});

describe("rename notifications", () => {
  const path = (name: string) => `Tasks/${name}.md`;
  const key = (name: string) => recordReminderKey("r", "db", path(name), 1);
  const rename = (from: string, to: string): DataChange => ({ kind: "renamed", oldPath: path(from), path: path(to), origin: "external" });
  const batch = (...changes: DataChange[]): DataChangeBatch => ({ changes });

  it("migrates chained moves before the next pending scan and persists the batch once", () => {
    const { service, settings, save, pending, emit } = fixture();
    settings.states[key("A")] = { snoozedUntil: 5000, updatedAt: 10 };
    pending.mockImplementation(() => {
      expect(settings.states[key("A")]).toBeUndefined();
      expect(settings.states[key("B")]).toBeUndefined();
      expect(settings.states[key("C")]).toEqual({ snoozedUntil: 5000, updatedAt: 10 });
      return [];
    });
    emit.data(batch(rename("A", "B"), rename("B", "C")));
    expect(save).toHaveBeenCalledTimes(1);
    expect(notices.created).not.toHaveBeenCalled();
    service.destroy();
  });

  it("rejects a retained inbox row after a move without writing state to the old path", async () => {
    const { service, settings, save, pending, emit } = fixture();
    const original = { ...reminder, key: key("A"), path: path("A") };
    const moved = { ...reminder, key: key("B"), path: path("B") };
    pending.mockReturnValue([moved]);
    emit.data(batch(rename("A", "B")));
    expect(await service.update(original, true)).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    expect(settings.states).toEqual({});
    expect(await service.update(moved, false)).toBeDefined();
    expect(settings.states[moved.key]?.dismissed).toBe(true);
    service.destroy();
  });

  it("does not announce the same already-shown reminder again after rename", () => {
    const { service, save, pending, emit } = fixture();
    pending.mockReturnValue([{ ...reminder, key: key("A") }]);
    service.tick();
    pending.mockReturnValue([{ ...reminder, key: key("B"), path: path("B") }]);
    emit.data(batch(rename("A", "B")));
    expect(notices.created).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    service.destroy();
  });

  it("keeps a failed migration active in this session and retries on the next tick", async () => {
    const { service, settings, save, pending, emit } = fixture();
    pending.mockReturnValue([]);
    settings.states[key("A")] = { dismissed: true, updatedAt: 1 };
    save.mockRejectedValueOnce(new Error("disk unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      emit.data(batch(rename("A", "B")));
      await Promise.resolve();
      await Promise.resolve();
      expect(settings.states[key("B")]?.dismissed).toBe(true);
      service.tick();
      expect(save).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); service.destroy(); }
  });
});

describe("vault pause", () => {
  it("removes the notice, skips pending scans while off and keeps saved or already announced states", async () => {
    let enabled = true;
    const { service, settings, save, pending } = fixture(() => enabled);
    const saved = { dismissed: true, updatedAt: 20 };
    settings.states.remember = saved;
    service.tick();
    expect(notices.created).toHaveBeenCalledOnce();
    pending.mockClear();
    enabled = false;
    service.tick(); service.refresh();
    expect(pending).not.toHaveBeenCalled();
    expect(notices.hide).toHaveBeenCalledOnce();
    expect(settings.states.remember).toBe(saved);
    await service.update(reminder, false);
    expect(save).not.toHaveBeenCalled();
    enabled = true;
    service.tick();
    expect(pending).toHaveBeenCalledOnce();
    expect(notices.created).toHaveBeenCalledOnce();
    service.destroy();
  });

  it("does not query vault data even when configured rules exist but the global switch is off", () => {
    const { service, settings, pending } = fixture(() => false);
    settings.rules.push({
      id: "r", databaseId: "db", enabled: true, dateField: "due", completionField: "done",
      completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0,
    });
    pending.mockRestore();
    expect(service.pending()).toEqual([]);
    expect(settings.rules).toHaveLength(1);
    service.destroy();
  });
});


describe("undoing an inbox action", () => {
  it("undoes only the latest matching action and persists the restored state", async () => {
    const { service, settings, save } = fixture();
    const first = await service.update(reminder, true);
    const second = await service.update(reminder, false);
    expect(await first?.()).toBe(false);
    expect(await second?.()).toBe(true);
    expect(settings.states.key.snoozedUntil).toBeDefined();
    expect(settings.states.key.dismissed).toBeUndefined();
    expect(await second?.()).toBe(false);
    expect(save).toHaveBeenCalledTimes(3);
    service.destroy();
  });

  it("finds the saved action after a note move and rolls back failed undo writes", async () => {
    const { service, settings, save, pending, emit } = fixture();
    pending.mockReturnValue([]);
    const original = { ...reminder, key: recordReminderKey("r", "db", reminder.path, 1) };
    pending.mockReturnValueOnce([original]);
    const undo = await service.update(original, false);
    const moved = "Tasks/Moved.md";
    emit.data({ changes: [{ kind: "renamed", oldPath: original.path, path: moved, origin: "external" }] });
    await Promise.resolve();
    const movedKey = recordReminderKey("r", "db", moved, 1);
    expect(settings.states[movedKey]?.dismissed).toBe(true);
    save.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(undo?.()).rejects.toThrow("disk unavailable");
    expect(settings.states[movedKey]?.dismissed).toBe(true);
    expect(await undo?.()).toBe(true);
    expect(settings.states[movedKey]).toBeUndefined();
    service.destroy();
  });
});

it("failed undo across rename restores dismissal on the current path", async () => {
  const { service, settings, save, pending, emit } = fixture();
  const original = { ...reminder, key: recordReminderKey("r", "db", reminder.path, 1) };
  pending.mockReturnValue([original]);
  const undo = (await service.update(original, false))!;
  let reject!: (error: Error) => void;
  save.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  const request = undo();
  const moved = "Tasks/Moved.md";
  const movedKey = recordReminderKey("r", "db", moved, 1);
  pending.mockImplementation(() => settings.states[movedKey]?.dismissed ? [] : [{ ...original, path: moved, key: movedKey }]);
  emit.data({ changes: [{ kind: "renamed", oldPath: original.path, path: moved, origin: "external" }] });
  reject(new Error("disk unavailable"));
  await expect(request).rejects.toThrow("disk unavailable");
  expect(settings.states).toEqual({ [movedKey]: expect.objectContaining({ dismissed: true }) });
  service.destroy();
});

it("a pending undo cannot announce an ignored item before the save succeeds", async () => {
  const { service, settings, save, pending, emit } = fixture();
  const original = { ...reminder, key: recordReminderKey("r", "db", reminder.path, 1) };
  const moved = { ...original, path: "Tasks/B.md", key: recordReminderKey("r", "db", "Tasks/B.md", 1) };
  let record = original;
  pending.mockImplementation(() => settings.states[record.key]?.dismissed ? [] : [record]);
  const undo = (await service.update(original, false))!;
  let reject!: (error: Error) => void;
  save.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  const request = undo();
  record = moved;
  emit.data({ changes: [{ kind: "renamed", oldPath: original.path, path: moved.path, origin: "external" }] });
  reject(new Error("disk unavailable"));
  await expect(request).rejects.toThrow("disk unavailable");
  expect(settings.states[moved.key]?.dismissed).toBe(true);
  expect(notices.created).toHaveBeenCalledTimes(0);
  service.destroy();
});

it("never applies the state of a deleted record to its replacement with the same path", async () => {
  const { service, save, pending, settings, emit } = fixture();
  const fresh = { ...reminder, key: recordReminderKey("r", "db", reminder.path, 1, { dateField: "due", dueAt: 1 }) };
  pending.mockImplementation(() => settings.states[fresh.key]?.dismissed ? [] : [fresh]);
  const undo = await service.update(fresh, false);
  expect(settings.states[fresh.key].dismissed).toBe(true);
  emit.data({ changes: [{ kind: "deleted", path: fresh.path, origin: "external" }, { kind: "created", path: fresh.path, origin: "external" }] });
  expect(settings.states[fresh.key]).toBeUndefined();
  expect(service.pending()).toEqual([fresh]);
  expect(await undo?.()).toBe(false);
  expect(save).toHaveBeenCalledTimes(2);
  service.destroy();
});

it("rolls a failed dismissal back before the next plugin settings write takes its snapshot", async () => {
  let tail = Promise.resolve();
  const enqueue = <T,>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run);
    tail = next.then(() => {}, () => {});
    return next;
  };
  const { service, settings, save } = fixture(() => true, enqueue);
  let reject!: (error: Error) => void;
  save.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const update = service.update(reminder, false);
  const checking = expect(update).rejects.toThrow("save failed");
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  const nextSnapshot = enqueue(async () => structuredClone(settings.states));
  reject(new Error("save failed"));
  await checking;
  expect(await nextSnapshot).toEqual({});
  expect(settings.states).toEqual({});
  service.destroy();
});


describe("desktop notification channel", () => {
  function desktopFixture(useNativeWindow = false, routing: ConstructorParameters<typeof DesktopReminderNotification>[4] = {}) {
    let focused = false;
    let optedIn = true;
    const openInbox = vi.fn();
    const instances: DesktopNotificationMock[] = [];
    class DesktopNotificationMock {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn().mockResolvedValue("granted");
      close = vi.fn();
      onclick?: ((event?: { preventDefault(): void }) => void) | null;
      onerror?: (() => void) | null;
      onshow?: (() => void) | null;
      onclose?: (() => void) | null;
      constructor(readonly title: string, readonly options: { body: string }) { instances.push(this); }
    }
    const restore = vi.fn(), show = vi.fn(), focus = vi.fn();
    const issuingWindow = { isDestroyed: () => false, isMinimized: () => true, restore, show, focus };
    const otherWindow = { focus: vi.fn() };
    const remote = { getCurrentWindow: () => issuingWindow, BrowserWindow: { getFocusedWindow: () => focused ? otherWindow : null } };
    const win = { Notification: DesktopNotificationMock, focus: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
      require: useNativeWindow ? () => ({ remote }) : undefined,
      setTimeout: (fn: () => void, delay: number) => setTimeout(fn, delay),
      setInterval: (fn: () => void, delay: number) => setInterval(fn, delay),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id) } as unknown as Window & typeof globalThis;
    const adapter = new DesktopReminderNotification(() => win, () => optedIn, () => focused, openInbox, routing);
    return { adapter, instances, openInbox, win, DesktopNotificationMock, issuingWindow, otherWindow,
      focus: () => { focused = true; }, blur: () => { focused = false; }, optOut: () => { optedIn = false; } };
  }

  it("background opt-in previews the vault and selected title, opening its inbox item", () => {
    const desktop = desktopFixture();
    const { service } = fixture(() => true, undefined, desktop.adapter);
    service.tick(); service.tick();
    expect(notices.created).not.toHaveBeenCalled();
    expect(desktop.instances).toHaveLength(1);
    const [notification] = desktop.instances;
    expect(notification.title).toBe("Record reminders: Test vault");
    expect(notification.options.body).toBe("1 new reminder: A");
    expect(notification.options.body).not.toContain(reminder.path);
    notification.onclick?.();
    expect(notification.close).toHaveBeenCalledOnce();
    expect(desktop.win.focus).toHaveBeenCalledOnce();
    expect(desktop.openInbox).toHaveBeenCalledExactlyOnceWith({ key: reminder.key, instance: reminder.instance });
    service.destroy();
  });

  it("counts only newly triggered reminders and previews their first item in inbox order", () => {
    const desktop = desktopFixture();
    const { service, pending } = fixture(() => true, undefined, desktop.adapter);
    service.tick(); // One item stays in the queue.
    const later = { ...reminder, key: "later", title: "Later", dueAt: 12, reminderAt: 2 };
    const earlier = { ...reminder, key: "earlier", title: "Earlier", dueAt: 7, reminderAt: 3, instance: 12 };
    pending.mockReturnValue([reminder, later, earlier]);
    service.tick(); service.tick();
    expect(desktop.instances).toHaveLength(2);
    const notice = desktop.instances[1];
    expect(notice.options.body).toBe("2 new reminders: Earlier and others");
    notice.onclick?.();
    expect(desktop.openInbox).toHaveBeenCalledExactlyOnceWith({ key: "earlier", instance: 12 });
    service.destroy();
  });

  it("hides vault and record title and skips item targeting when previews are disabled", () => {
    const desktop = desktopFixture();
    const { service } = fixture(() => true, undefined, desktop.adapter, () => false);
    service.tick();
    const [notification] = desktop.instances;
    expect(notification.title).toBe("Record reminders");
    expect(notification.options.body).toBe("1 new reminder");
    notification.onclick?.();
    expect(desktop.openInbox).toHaveBeenCalledExactlyOnceWith(undefined);
    service.destroy();
  });

  it("delivers a fallback after the still-pending note moved during desktop delivery", async () => {
    const desktop = desktopFixture();
    const { service, pending, emit, content } = fixture(() => true, undefined, desktop.adapter);
    const schedule = { dueAt: 1, dateField: "due" };
    const key = (path: string) => recordReminderKey("r", "db", path, 1, schedule);
    const old = { ...reminder, key: key("Tasks/A.md"), instance: 12 };
    pending.mockReturnValue([old]);
    service.tick();
    const path = "Tasks/B.md";
    pending.mockReturnValue([{ ...old, key: key(path), path, title: "B" }]);
    emit.data({ changes: [{ kind: "renamed", oldPath: old.path, path }] } as DataChangeBatch);
    expect(desktop.instances).toHaveLength(1);
    desktop.instances[0].onerror?.();
    await Promise.resolve();
    service.tick();
    expect(content[0]?.options.text).toBe("1 new reminder: B");
    service.destroy();
  });

  it("does not lose a still-undelivered batch when a second desktop notification starts", async () => {
    const desktop = desktopFixture();
    const { service, pending, content } = fixture(() => true, undefined, desktop.adapter);
    service.tick();
    const [first] = desktop.instances;
    pending.mockReturnValue([reminder, { ...reminder, key: "b", path: "Tasks/B.md", title: "B" }]);
    service.tick();
    expect(first.close).not.toHaveBeenCalled();
    expect(desktop.instances[1].options.body).toBe("1 new reminder: B");
    first.onerror?.();
    await Promise.resolve();
    service.tick();
    expect(content.map(chunk => chunk.options.text)).toContain("1 new reminder: A");
    expect(desktop.instances[1].close).not.toHaveBeenCalled();
    service.destroy();
  });

  it("falls back only on undelivered notifications when removing visible previews", () => {
    const desktop = desktopFixture();
    const delivered = vi.fn(), pending = vi.fn();
    expect(desktop.adapter.show("A", "Due", delivered)).toBe(true);
    expect(desktop.adapter.show("B", "Due", pending)).toBe(true);
    desktop.instances[0].onshow?.();
    desktop.adapter.close(true);
    expect(delivered).not.toHaveBeenCalled();
    expect(pending).toHaveBeenCalledOnce();
    expect(desktop.instances.every(item => item.onclick === null && item.close.mock.calls.length === 1)).toBe(true);
    desktop.adapter.destroy();
  });

  it("combines still-undelivered batches when the desktop channel is disabled", async () => {
    const desktop = desktopFixture();
    const { service, pending, content } = fixture(() => true, undefined, desktop.adapter);
    service.tick();
    pending.mockReturnValue([reminder, { ...reminder, key: "b", dueAt: 2, path: "Tasks/B.md", title: "B" }]);
    service.tick();
    desktop.optOut();
    service.tick();
    await Promise.resolve();
    expect(notices.created).toHaveBeenCalledOnce();
    expect(content[0].options.text).toBe("2 new reminders: A and others");
    service.destroy();
  });

  it("preserves a newly eligible reminder in the same tick as older undelivered desktop fallback", async () => {
    const desktop = desktopFixture();
    const { service, pending, content } = fixture(() => true, undefined, desktop.adapter);
    service.tick(); // A has a desktop notification pending, but not shown.
    pending.mockReturnValue([reminder, { ...reminder, key: "b", path: "Tasks/B.md", title: "B" }]); // B reaches its scheduled time.
    desktop.optOut();
    service.tick(); // Close A and discover B.
    await Promise.resolve();
    const labels = content.filter(chunk => chunk.tag === "span").map(chunk => chunk.options.text);
    expect(labels.at(-1)).toMatch(/^2 new reminders/);
    service.destroy();
  });

  it("does not show old backlog again if a fresh system batch disappears before a delivery error", async () => {
    const desktop = desktopFixture();
    const { service, pending } = fixture(() => true, undefined, desktop.adapter);
    service.tick();
    pending.mockReturnValue([reminder, { ...reminder, key: "new", title: "New" }]);
    service.tick();
    pending.mockReturnValue([reminder]);
    desktop.instances[1].onerror?.();
    await Promise.resolve();
    expect(notices.created).not.toHaveBeenCalled();
    service.destroy();
  });

  it.each(["foreground", "denied", "opted-out"])("uses only the in-app notice when desktop delivery is %s", reason => {
    const desktop = desktopFixture();
    if (reason === "foreground") desktop.focus();
    if (reason === "denied") desktop.DesktopNotificationMock.permission = "denied";
    if (reason === "opted-out") desktop.optOut();
    const { service } = fixture(() => true, undefined, desktop.adapter);
    service.tick(); service.tick();
    expect(desktop.instances).toEqual([]);
    expect(notices.created).toHaveBeenCalledOnce();
    service.destroy();
  });

  it("falls back once on an async delivery failure and closes outstanding notifications on opt-out", async () => {
    const desktop = desktopFixture();
    const { service, pending } = fixture(() => true, undefined, desktop.adapter);
    service.tick();
    desktop.instances[0].onerror?.();
    await Promise.resolve();
    service.tick();
    expect(notices.created).toHaveBeenCalledOnce();
    pending.mockReturnValue([{ ...reminder, key: "next" }]);
    service.tick();
    expect(desktop.instances).toHaveLength(2);
    desktop.optOut();
    service.tick();
    expect(desktop.instances[1].close).toHaveBeenCalledOnce();
    expect(desktop.instances[1].onclick).toBeNull();
    service.destroy();
  });

  it("targets the issuing vault window, not the other window activated by the OS", () => {
    const desktop = desktopFixture(true);
    expect(desktop.adapter.show("Due", "Generic", vi.fn())).toBe(true);
    desktop.focus();
    const event = { preventDefault: vi.fn() };
    desktop.instances[0].onclick?.(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(desktop.issuingWindow.restore).toHaveBeenCalledOnce();
    expect(desktop.issuingWindow.show).toHaveBeenCalledOnce();
    expect(desktop.issuingWindow.focus).toHaveBeenCalledOnce();
    expect(desktop.otherWindow.focus).not.toHaveBeenCalled();
    expect(desktop.openInbox).toHaveBeenCalledOnce();
    expect(desktop.adapter.hasVerifiedDelivery()).toBe(true);
    desktop.adapter.destroy();
  });

  it("uses the existing inbox pop-out even before Obsidian activeWindow updates", () => {
    const popoutFocus = vi.fn();
    const status = vi.fn();
    const popoutNative = { focus: vi.fn(), show: vi.fn(), restore: vi.fn(), isDestroyed: () => false, isMinimized: () => true };
    const popout = { focus: popoutFocus, electronWindow: popoutNative,
      document: { hasFocus: () => false } } as unknown as Window;
    const desktop = desktopFixture(true, {
      getInboxWindow: () => popout, isActiveWindow: () => false, onStatusChange: status,
    });
    expect(desktop.adapter.show("Due", "Generic", vi.fn())).toBe(true);
    desktop.instances[0].onclick?.();
    expect(status).toHaveBeenCalledOnce();
    expect(popoutNative.focus).toHaveBeenCalledOnce();
    expect(popoutNative.restore).toHaveBeenCalledOnce();
    expect(popoutFocus).not.toHaveBeenCalled();
    expect(desktop.issuingWindow.focus).not.toHaveBeenCalled();
    expect(desktop.openInbox).toHaveBeenCalledOnce();
    desktop.adapter.destroy();
  });

  it("handles a denied immediate focus by waiting for the user to focus this window later", async () => {
    vi.useFakeTimers();
    try {
      let active = false;
      const desktop = desktopFixture(true, { isActiveWindow: () => active });
      expect(desktop.adapter.show("Due", "Generic", vi.fn())).toBe(true);
      desktop.instances[0].onclick?.();
      await vi.advanceTimersByTimeAsync(1600);
      expect(desktop.openInbox).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      const focused = vi.mocked(desktop.win.addEventListener).mock.calls[0][1] as () => void;
      focused(); // Host updates activeWindow after the focus event reaches its listeners.
      active = true;
      await vi.advanceTimersByTimeAsync(25);
      expect(desktop.openInbox).toHaveBeenCalledOnce();
      expect(desktop.win.removeEventListener).toHaveBeenCalledOnce();
      desktop.adapter.destroy();
    } finally { vi.useRealTimers(); }
  });

  it("waits for activeWindow before opening a new inbox and cancels delayed opening on opt-out", async () => {
    vi.useFakeTimers();
    try {
      let active = false;
      const desktop = desktopFixture(true, { isActiveWindow: () => active });
      expect(desktop.adapter.show("Due", "Generic", vi.fn())).toBe(true);
      desktop.instances[0].onclick?.();
      expect(desktop.issuingWindow.focus).toHaveBeenCalledOnce();
      expect(desktop.openInbox).not.toHaveBeenCalled();
      active = true;
      await vi.advanceTimersByTimeAsync(25);
      expect(desktop.openInbox).toHaveBeenCalledOnce();
      active = false;
      expect(desktop.adapter.show("Due", "Another", vi.fn())).toBe(true);
      desktop.instances[1].onclick?.();
      desktop.optOut();
      desktop.adapter.closeIfDisabled();
      active = true;
      await vi.advanceTimersByTimeAsync(25);
      expect(desktop.openInbox).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("waits for Obsidian to leave the foreground before testing, preserving the real reminder", async () => {
    vi.useFakeTimers();
    try {
      const desktop = desktopFixture(true);
      const checked = vi.fn();
      expect(desktop.adapter.show("A", "Due", vi.fn())).toBe(true);
      desktop.focus();
      const test = desktop.adapter.sendTest("Test", "No record changed", vi.fn(), checked);
      await vi.advanceTimersByTimeAsync(700);
      expect(desktop.instances.map(item => item.title)).toEqual(["A"]);
      desktop.blur();
      await vi.advanceTimersByTimeAsync(350);
      expect(await test).toBe("sent");
      expect(desktop.instances.map(item => item.title)).toEqual(["A", "Test"]);
      expect(desktop.adapter.hasVerifiedDelivery()).toBe(false);
      desktop.instances[1].onclick?.();
      expect(desktop.adapter.hasVerifiedDelivery()).toBe(true);
      expect(checked).toHaveBeenCalledOnce();
      expect(desktop.instances[0].close).not.toHaveBeenCalled();
      desktop.DesktopNotificationMock.permission = "denied";
      expect(desktop.adapter.hasVerifiedDelivery()).toBe(false);
      expect(await desktop.adapter.sendTest("Test", "Not permitted", vi.fn())).toBe("unavailable");
      desktop.adapter.destroy();
      expect(desktop.instances[0].close).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it("expires or cancels a waiting test without posting a late system notification", async () => {
    vi.useFakeTimers();
    try {
      const desktop = desktopFixture();
      desktop.focus();
      const first = desktop.adapter.sendTest("Test", "Never switch", vi.fn());
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await first).toBe("timed-out");
      const second = desktop.adapter.sendTest("Test", "Disabled", vi.fn());
      await vi.advanceTimersByTimeAsync(350);
      desktop.optOut();
      desktop.adapter.closeIfDisabled();
      expect(await second).toBe("unavailable");
      desktop.blur();
      await vi.advanceTimersByTimeAsync(350);
      expect(desktop.instances).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it("only asks for unresolved OS permission, not a prior denial", async () => {
    const desktop = desktopFixture();
    desktop.DesktopNotificationMock.permission = "denied";
    await desktop.adapter.requestPermission();
    expect(desktop.DesktopNotificationMock.requestPermission).not.toHaveBeenCalled();
    desktop.DesktopNotificationMock.permission = "default";
    await desktop.adapter.requestPermission();
    expect(desktop.DesktopNotificationMock.requestPermission).toHaveBeenCalledOnce();
  });
});
