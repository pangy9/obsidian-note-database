import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { DataSource, NoteRecord } from "../data/DataSource";
import { RecordReminderService } from "../data/RecordReminderService";
import { getReminderRecordEditTarget, getReminderSnoozeUntil, planReminderRecordEdit } from "../data/RecordReminderEditing";
import { applyFrontmatterWrites, verifyFrontmatterExpect } from "../data/FrontmatterPatch";
import type { FrontmatterKeySnapshot, FrontmatterWrite } from "../data/RenameTransaction";
import type { DatabaseConfig } from "../data/types";
import type { RecordReminderRule } from "../data/RecordReminders";
import { setLocale } from "../i18n";
const notices = vi.hoisted(() => ({ new: vi.fn() }));
vi.mock("obsidian", () => ({ Notice: class { constructor() { notices.new(); } hide() {} } }));
setLocale("en");

const now = new Date(2026, 10, 25, 19, 30);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); notices.new.mockClear(); });
afterEach(() => vi.useRealTimers());

function fixture(kind: "checkbox" | "status" = "checkbox", date: "date" | "datetime" = "datetime") {
  const rule: RecordReminderRule = { id: "r", databaseId: "db", enabled: true, dateField: "due", completionField: "state",
    completedValues: kind === "status" ? ["Done", "Cancelled"] : [], dateOnlyTime: "09:00", advanceMinutes: 0, offsets: [0] };
  const db: DatabaseConfig = { id: "db", name: "Draft", sourceFolder: "Notes", views: [], schema: {
    columns: [
      { key: "due", label: "Review date", type: date },
      { key: "state", label: "Work status", type: kind, ...(kind === "status" && { statusOptions: [
        { value: "Open", color: "gray" }, { value: "Done", color: "green" }, { value: "Cancelled", color: "red" },
      ] }) },
    ],
    computedFields: [],
  } };
  const file = { path: "Notes/Test.md", basename: "Test" } as NoteRecord["file"];
  const frontmatter: Record<string, unknown> = { due: date === "date" ? "2026-11-25" : "2026-11-25T19:00", protected: "untouched" };
  if (kind === "status") frontmatter.state = "Open";
  const record = { file, frontmatter };
  const settings = { rules: [rule], states: {} };
  const app = { workspace: { containerEl: { ownerDocument: { createDocumentFragment: () => ({
    createEl: () => ({ addClass() {}, onclick: null }),
  }) } } } } as unknown as App;
  const snapshot = (key: string): FrontmatterKeySnapshot =>
    Object.prototype.hasOwnProperty.call(frontmatter, key) ? { exists: true, value: frontmatter[key] } : { exists: false };
  const writer = vi.fn(async (_path: string, expected: Record<string, FrontmatterKeySnapshot>,
    writes: Record<string, FrontmatterWrite>, guard: () => void) => {
    guard();
    if (!verifyFrontmatterExpect(frontmatter, expected).ok) throw new Error("frontmatter conflict");
    applyFrontmatterWrites(frontmatter, writes);
  });
  const source = {
    getViewDefFiles: () => [{ file: { path: "DB.md" }, config: db }], getRecordsForDatabase: () => [record],
    getRecordSnapshot: (path: string) => path === file.path ? record : null,
    onDataChanged: () => () => {}, onViewConfigChanged: () => () => {},
    patchFrontmatter: writer, readFrontmatterKeySnapshots: async (_path: string, keys: string[]) =>
      Object.fromEntries(keys.map(key => [key, snapshot(key)])),
  } as unknown as DataSource;
  const service = new RecordReminderService(app, source, () => settings, async () => {}, () => {});
  return { service, frontmatter, rule, db, writer, settings, file };
}

describe("editable reminder detail", () => {
  it("marks a checkbox done atomically and restores its original absence on undo", async () => {
    const { service, frontmatter, writer } = fixture();
    const [item] = service.pending();
    const target = service.editTarget(item)!;
    expect(target.date.label).toBe("Review date");
    expect(target.completion).toMatchObject({ label: "Work status", value: false });
    const undo = await service.editRecord(item, target, { completion: true });
    expect(writer).toHaveBeenCalledOnce();
    expect(frontmatter).toMatchObject({ state: true, due: "2026-11-25T19:00", protected: "untouched" });
    expect(service.pending()).toEqual([]);
    expect(await undo?.()).toBe(true);
    expect(frontmatter).not.toHaveProperty("state");
    expect(service.pending()).toHaveLength(1);
    expect(notices.new).not.toHaveBeenCalled();
    service.destroy();
  });

  it("allows an explicit status or reschedule, but never guesses a done value from two skip states", async () => {
    const { service, rule, db, frontmatter, settings } = fixture("status", "date");
    settings.rules.push({ ...rule, id: "another" });
    const item = service.pending().find(candidate => candidate.ruleId === "r")!;
    const target = getReminderRecordEditTarget(rule, db, frontmatter, item)!;
    expect(target.completion.options).toEqual(["Open", "Done", "Cancelled"]);
    expect(target.completion.colors).toMatchObject({ Done: "green", Cancelled: "red" });
    expect(() => planReminderRecordEdit(target, { date: "2026-11-26T08:00" })).toThrow("Invalid reminder date");
    expect(() => planReminderRecordEdit(target, { completion: "Unknown" })).toThrow("Invalid completion value");
    const undo = await service.editRecord(item, target, { date: "2026-11-26", completion: "Done" });
    expect(frontmatter).toMatchObject({ due: "2026-11-26", state: "Done" });
    expect(service.pending()).toEqual([]);
    expect(await undo?.()).toBe(true);
    expect(frontmatter).toMatchObject({ due: "2026-11-25", state: "Open" });
    expect(service.pending()).toHaveLength(2);
    service.destroy();
  });

  it("does not overwrite concurrent note edits or a changed rule, nor undo a newer write", async () => {
    const { service, rule, frontmatter, writer } = fixture();
    const [item] = service.pending();
    const target = service.editTarget(item)!;
    rule.offsets = [0, 60];
    expect(await service.editRecord(item, target, { completion: true })).toBeUndefined();
    rule.offsets = [0];
    frontmatter.due = "2026-11-25T18:00";
    expect(await service.editRecord(item, target, { completion: true })).toBeUndefined();
    expect(writer).not.toHaveBeenCalled();
    frontmatter.due = "2026-11-25T19:00";
    const undo = await service.editRecord(item, target, { completion: true });
    frontmatter.state = false;
    expect(await undo?.()).toBe(false);
    expect(frontmatter.state).toBe(false);
    service.destroy();
  });

  it("snoozes using a requested preset without writing frontmatter and can undo it", async () => {
    const { service, writer, frontmatter, settings } = fixture();
    const [item] = service.pending();
    const until = getReminderSnoozeUntil("tomorrow", now.getTime());
    expect(new Date(until).getHours()).toBe(9);
    expect(new Date(until).getDate()).toBe(26);
    expect(getReminderSnoozeUntil("1h", now.getTime()) - now.getTime()).toBe(3600000);
    const undo = await service.update(item, until);
    expect(settings.states).toMatchObject({ [item.key]: { snoozedUntil: until } });
    expect(frontmatter.due).toBe("2026-11-25T19:00");
    expect(writer).not.toHaveBeenCalled();
    expect(await undo?.()).toBe(true);
    expect(service.pending()).toHaveLength(1);
    service.destroy();
  });
});
