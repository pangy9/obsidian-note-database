import { expect, it, vi } from "vitest";
import { RecordReminderInbox } from "../views/modals/RecordReminderInbox";
import type { RecordReminderService } from "../data/RecordReminderService";
import type { DueRecordReminder } from "../data/RecordReminders";
import type { App } from "obsidian";
import { setLocale } from "../i18n";
setLocale("en");

vi.mock("obsidian", () => ({
  Modal: class { constructor(readonly app: unknown) {} },
  Scope: class { register() {} },
  Component: class {},
  Notice: class {},
  setIcon() {},
  setTooltip() {},
}));

it("an open reminder detail does not open a different note at a stale path", async () => {
  const oldRow: DueRecordReminder = {
    key: "schedule", ruleId: "rule", databaseId: "db", databaseName: "Tasks",
    path: "Task.md", title: "Original task", dueAt: 1, reminderAt: 1,
    ruleName: "Deadline", dateFieldLabel: "Due", instance: 1,
  };
  const newFile = { path: oldRow.path, basename: "Task", record: "replacement" };
  const openFile = vi.fn(async (_file: typeof newFile) => {});
  const strip = { createEl() { return { createSpan() {} }; } };
  const doc = { querySelectorAll: () => [], body: { createDiv: () => strip, appendChild() {} } };
  const leaf = { view: { containerEl: { ownerDocument: doc }, getState: () => ({ file: oldRow.path }) }, openFile };
  const pending = vi.fn(() => [{ ...oldRow, instance: 2, title: "Replacement task" }]);
  const app = {
    keymap: { popScope() {} },
    workspace: {
      getLeavesOfType: () => [leaf], getMostRecentLeaf: () => undefined,
      on() {}, setActiveLeaf() {},
    },
    vault: { getFileByPath: (path: string) => path === newFile.path ? newFile : null },
  };
  const inbox = new RecordReminderInbox(app as unknown as App, { pending, isOriginalRecord: () => false } as unknown as RecordReminderService, () => false);
  Object.assign(inbox, {
    containerEl: { isConnected: true, ownerDocument: doc, addClass() {} },
    // Only presentation is stubbed: refreshPending and openNote are production methods.
    contentEl: { ownerDocument: doc }, layer: {}, closeDetail() {}, clearHover() {}, refresh() { pending(); }, focusRow() {},
  });
  inbox.refreshPending();
  expect(pending).not.toHaveBeenCalled();
  await (inbox as unknown as { openNote(item: DueRecordReminder): Promise<void> }).openNote(oldRow);
  expect(openFile).not.toHaveBeenCalled();
  expect(pending).toHaveBeenCalledOnce();
});
