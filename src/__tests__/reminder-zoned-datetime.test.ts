import { expect, it } from "vitest";
import {
  collectDueRecordReminders, getRecordReminderRulePreview, prepareRecordReminderRules,
} from "../data/RecordReminders";
import type { NoteRecord } from "../data/DataSource";
import type { DatabaseConfig } from "../data/types";

it.each(["2026-12-01T10:00:00Z", "2026-12-01T18:00:00+08:00", "2026/12/01 04:30:00-0530"])("respects explicit zone in %s", due => {
  const db: DatabaseConfig = {
    id: "db", name: "Appointments", sourceFolder: "",
    schema: { columns: [
      { key: "due", label: "Appointment time", type: "datetime" },
      { key: "done", label: "Done", type: "checkbox" },
    ], computedFields: [] }, views: [],
  };
  const record = {
    file: { path: "Appointment.md", basename: "Appointment" },
    frontmatter: { due, done: false },
  } as unknown as NoteRecord;
  const activation = Date.parse("2026-11-30T10:00:00Z");
  const rules = prepareRecordReminderRules([{
    id: "r", databaseId: "db", enabled: true, dateField: "due", completionField: "done",
    completedValues: [], advanceMinutes: 0, offsets: [0], dateOnlyTime: "09:00",
  }], [], activation);
  const now = Date.parse("2026-12-01T02:30:00Z"); // 10:30 Asia/Shanghai
  const preview = getRecordReminderRulePreview(rules[0], db, [record], now);
  const inbox = collectDueRecordReminders({ rules, states: {} }, [{ database: db, records: [record] }], now);
  const result = {
    previewNow: preview.now.map(({ dueAt }) => new Date(dueAt!).toISOString()),
    previewLater: preview.later.map(({ dueAt }) => new Date(dueAt!).toISOString()),
    inbox: inbox.map(({ dueAt }) => new Date(dueAt).toISOString()),
  };
  expect(result).toEqual({ previewNow: [], previewLater: ["2026-12-01T10:00:00.000Z"], inbox: [] });
});
