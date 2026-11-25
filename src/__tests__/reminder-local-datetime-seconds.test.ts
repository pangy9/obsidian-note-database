import { expect, it } from "vitest";
import { collectDueRecordReminders, getRecordReminderRulePreview, prepareRecordReminderRules } from "../data/RecordReminders";
import type { NoteRecord } from "../data/DataSource";
import type { DatabaseConfig } from "../data/types";

const db: DatabaseConfig = { id: "tasks", name: "Tasks", sourceFolder: "", schema: { columns: [
  { key: "deadline", label: "Deadline", type: "datetime" },
  { key: "done", label: "Done", type: "checkbox" },
], computedFields: [] }, views: [] };
const r = { id: "r", databaseId: "tasks", enabled: true, dateField: "deadline", completionField: "done",
  completedValues: [], dateOnlyTime: "09:00", offsets: [0], advanceMinutes: 0 };
const rec = (deadline: string) => ({ file: { path: "Tasks/A.md", basename: "A" }, frontmatter: { deadline, done: false } }) as unknown as NoteRecord;
const at = (second: number) => +new Date(2026,11,1,15,5,second);
const evaluate = (deadline: string, activatedAt: number, now: number) => {
  const rules = prepareRecordReminderRules([r], [], activatedAt);
  const records = [rec(deadline)];
  const groups = getRecordReminderRulePreview(rules[0], db, records, now);
  const [group, rows] = Object.entries(groups).find(([, rows]) => rows.length)!;
  const pending = collectDueRecordReminders({ rules, states: {} }, [{ database: db, records }], now);
  return { group, dueAt: rows[0].dueAt, pending: pending.length };
};

it("keeps an ordinary local datetime with explicit seconds in the future when the rule is activated in the same minute", () => {
  const issued = evaluate("2026-12-01T15:05:45", at(15), at(15));
  const reached = evaluate("2026-12-01T15:05:45", at(15), at(45));
  expect([issued, reached]).toEqual([
    { group: "later", dueAt: at(45), pending: 0 },
    { group: "now", dueAt: at(45), pending: 1 },
  ]);
});

it("controls: minute precision and the same instant with an explicit Asia/Shanghai UTC offset", () => {
  expect(evaluate("2026-12-01T15:06", at(15), at(45))).toEqual({
    group: "later", dueAt: +new Date(2026,11,1,15,6), pending: 0,
  });
  const zonedAt = (second: number) => Date.UTC(2026, 11, 1, 7, 5, second);
  expect(evaluate("2026-12-01T15:05:45+08:00", zonedAt(15), zonedAt(45))).toEqual({
    group: "now", dueAt: zonedAt(45), pending: 1,
  });
});
