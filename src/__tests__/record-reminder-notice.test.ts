import { expect, it } from "vitest";
import { buildRecordReminderNotice, buildRecordReminderTestNotice, reminderInboxTargetIdentity } from "../data/RecordReminderNotice";
import { recordReminderKey, type DueRecordReminder } from "../data/RecordReminders";
import { setLocale } from "../i18n";

const entry: DueRecordReminder = {
  key: "key", instance: 1, ruleId: "rule", databaseId: "db", databaseName: "DB",
  path: "PRIVATE/Note.md", title: "Example", dueAt: 10, reminderAt: 9,
  ruleName: "Private rule", dateFieldLabel: "Due",
};

it("builds a compact banner without a path, rule or additional record title", () => {
  setLocale("zh-CN");
  const message = buildRecordReminderNotice([
    { ...entry, key: "later", title: "Do not preview", dueAt: 15 }, entry,
  ], true, "项目库");
  expect(message).toEqual({ title: "记录提醒：项目库", body: "2 条新提醒：Example等", target: { key: "key", instance: 1 } });
  expect(buildRecordReminderNotice([entry], false, "项目库")).toEqual({ title: "记录提醒", body: "1 条新提醒" });
});

it("keeps Unicode intact and gives count precedence for multiline or long names", () => {
  setLocale("en");
  const message = buildRecordReminderNotice([{ ...entry, title: "\n\tTitle\n" + "🧪".repeat(100) }], true, "库".repeat(100));
  expect(message.title).toMatch(/^Record reminders: 库{31}…$/u);
  expect(message.body).toMatch(/^1 new reminder: Title 🧪{39}…$/u);
  expect(buildRecordReminderNotice([{ ...entry, title: " \n" }], true, " ")).toEqual({
    title: "Record reminders", body: "1 new reminder",
  });
});

it("only puts fictional names in a test notification", () => {
  setLocale("en");
  expect(buildRecordReminderTestNotice(true)).toEqual({
    title: "Desktop notification test: Example vault", body: "1 new reminder: Example task",
  });
  expect(buildRecordReminderTestNotice(false)).toEqual({
    title: "Desktop notification test", body: "1 new reminder",
  });
});

it("uses Traditional Chinese in desktop notices", () => {
  setLocale("zh-TW");
  expect(buildRecordReminderTestNotice(false)).toEqual({
    title: "桌面通知測試", body: "1 筆新提醒",
  });
  expect(buildRecordReminderNotice([entry], true, "專案庫").title).toBe("記錄提醒：專案庫");
});

it("matches the same reminder after a move but not another instance, rule, field, or trigger", () => {
  const key = (path: string, reminderAt = 9, dueAt = 10, dateField = "due", rule = "rule") =>
    recordReminderKey(rule, "db", path, reminderAt, { dueAt, dateField });
  const original = { key: key("Old.md"), instance: 1 };
  const identity = reminderInboxTargetIdentity(original);
  expect(reminderInboxTargetIdentity({ ...original, key: key("New.md") })).toBe(identity);
  expect(reminderInboxTargetIdentity({ ...original, instance: 2 })).not.toBe(identity);
  expect(reminderInboxTargetIdentity({ ...original, key: key("New.md", 8) })).not.toBe(identity);
  expect(reminderInboxTargetIdentity({ ...original, key: key("New.md", 9, 11) })).not.toBe(identity);
  expect(reminderInboxTargetIdentity({ ...original, key: key("New.md", 9, 10, "otherDate") })).not.toBe(identity);
  expect(reminderInboxTargetIdentity({ ...original, key: key("New.md", 9, 10, "due", "otherRule") })).not.toBe(identity);
  expect(reminderInboxTargetIdentity({ key: key("New.md") })).not.toBe(reminderInboxTargetIdentity({ key: key("Old.md") }));
});
