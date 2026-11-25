import { expect, it, vi } from "vitest";
import { formatDateTimeValueDisplay, parseDateTimeParts } from "../data/DateTimeFormat";
import { RecordReminderService } from "../data/RecordReminderService";
import { getRecordReminderRulePreview, prepareRecordReminderRules, type RecordReminderRule } from "../data/RecordReminders";
import { setLocale } from "../i18n";
import type { DatabaseConfig } from "../data/types";
import type { DataSource, NoteRecord } from "../data/DataSource";
import type { App } from "obsidian";

const noticeLabels = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", () => ({ Notice: class { hide() {} } }));

it("keeps accepted pre-upgrade slash date-time with 12-hour clock in preview, inbox, and background notices", () => {
  setLocale("en");
  const before = new Date(2026, 10, 25, 19, 0).getTime();
  const at = new Date(2026, 10, 25, 20, 30).getTime();
  const database: DatabaseConfig = { id: "db", name: "Events", sourceFolder: "Events", schema: { columns: [{ key: "starts", label: "Starts", type: "datetime" }, { key: "done", label: "Done", type: "checkbox" }], computedFields: [] }, views: [] };
  const configured: RecordReminderRule = { id: "r", databaseId: "db", enabled: true, dateField: "starts", completionField: "done", completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0, offsets: [0] };
  const [rule] = prepareRecordReminderRules([configured], [], before);
  const records = ["2026/11/25 8:30 PM", "2026-11-25T20:30"].map((starts, i) => ({ file: { path: `Events/${i}.md`, basename: String(i) } as NoteRecord["file"], frontmatter: { starts, done: false } }));
  expect(records.map(record => parseDateTimeParts(record.frontmatter.starts)?.time)).toEqual(["20:30", "20:30"]);
  expect(formatDateTimeValueDisplay(records[0].frontmatter.starts)).toBe(formatDateTimeValueDisplay(records[1].frontmatter.starts));
  const app = { workspace: { containerEl: { ownerDocument: { createDocumentFragment: () => ({ createEl(tag: string, attrs: { text: string }) { if (tag === "span") noticeLabels.push(attrs.text); return { addClass() {}, onclick: null }; } }) } } } } as unknown as App;
  const source = { getViewDefFiles: () => [{ file: { path: "Database.md" }, config: database }], getRecordsForDatabase: () => records, onDataChanged: () => () => {}, onViewConfigChanged: () => () => {} } as unknown as DataSource;
  vi.useFakeTimers();
  const service = new RecordReminderService(app, source, () => ({ rules: [rule], states: {} }), async () => {}, () => {});
  try {
    vi.setSystemTime(before);
    expect(service.pending()).toEqual([]);
    vi.setSystemTime(at);
    service.tick();
    const preview = getRecordReminderRulePreview(rule, database, records, at);
    const actual = { previewNow: preview.now.map(row => row.title), excluded: preview.excluded.map(row => [row.title, row.reason]), inbox: service.pending().map(row => row.title), noticeLabels };
    expect(actual).toEqual({ previewNow: ["0", "1"], excluded: [], inbox: ["0", "1"], noticeLabels: ["2 new reminders: 0 and others"] });
  } finally {
    service.destroy();
    vi.useRealTimers();
  }
});
