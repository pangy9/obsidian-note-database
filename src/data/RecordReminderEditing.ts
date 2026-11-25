import { getColumnOptions, normalizeOptionValueForKey, toBooleanValue } from "./ColumnTypes";
import { isFileFieldKey } from "./FileFields";
import { cloneFrontmatterValue } from "./FrontmatterOverride";
import { configsDeepEqual } from "./FrontmatterPatch";
import { toDateTimestamp } from "./DateTimeFormat";
import { isValidReminderRule, type RecordReminderRule, type DueRecordReminder } from "./RecordReminders";
import type { FrontmatterKeySnapshot, FrontmatterWrite } from "./RenameTransaction";
import type { DatabaseConfig, StatusColor } from "./types";

export interface ReminderRecordEditTarget {
  date: { key: string; label: string; type: "date" | "datetime"; value: string };
  completion: { key: string; label: string; value: boolean | string; options: string[]; colors: Record<string, StatusColor> };
  original: Record<string, FrontmatterKeySnapshot>;
  schedule: string;
}
export interface ReminderRecordEdit { date?: string; completion?: boolean | string }

export function getReminderRecordEditTarget(rule: RecordReminderRule, db: DatabaseConfig,
  record: Record<string, unknown>, item: DueRecordReminder): ReminderRecordEditTarget | undefined {
  if (!rule.enabled || !isValidReminderRule(rule, db) || isFileFieldKey(rule.completionField) ||
      rule.completionField === rule.dateField) return;
  const date = db.schema.columns.find(column => column.key === rule.dateField);
  const completion = db.schema.columns.find(column => column.key === rule.completionField);
  if (!completion || !date || (date.type !== "date" && date.type !== "datetime")) return;
  const timestamp = new Date(item.dueAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())}`;
  const value = date.type === "date" ? day : `${day}T${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}`;
  const checkbox = completion.type === "checkbox";
  const options = checkbox ? [] : getColumnOptions(completion);
  const original = Object.fromEntries([date.key, completion.key].map(key => [key, Object.prototype.hasOwnProperty.call(record, key)
    ? { exists: true, value: cloneFrontmatterValue(record[key]) }
    : { exists: false }]));
  return {
    date: { key: date.key, label: date.label || date.key, type: date.type, value },
    completion: {
      key: completion.key, label: completion.label || completion.key,
      value: checkbox ? toBooleanValue(record[completion.key]) : normalizeOptionValueForKey(completion.key, record[completion.key]),
      options: options.map(option => option.value), colors: Object.fromEntries(options.map(({ value, color }) => [value, color])),
    },
    original, schedule: JSON.stringify([rule.activatedAt, rule.dateOnlyTime, rule.advanceMinutes, rule.offsets, rule.completedValues]),
  };
}

/** Only accepts the two bound fields; omission means keep the original YAML value untouched. */
export function planReminderRecordEdit(target: ReminderRecordEditTarget, change: ReminderRecordEdit): Record<string, FrontmatterWrite> {
  const pairs: Array<[string, unknown]> = [];
  if (change.date !== undefined && change.date !== target.date.value) {
    const format = target.date.type === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    const stamp = toDateTimestamp(change.date);
    if (!format.test(change.date) || stamp === null) throw new Error("Invalid reminder date");
    // A local datetime in a skipped DST hour can parse to a different wall time.
    if (target.date.type === "datetime") {
      const wall = new Date(stamp);
      const [hour, minute] = change.date.slice(11).split(":").map(Number);
      if (wall.getHours() !== hour || wall.getMinutes() !== minute) throw new Error("Invalid reminder time");
    }
    pairs.push([target.date.key, change.date]);
  }
  if (change.completion !== undefined && change.completion !== target.completion.value) {
    const valid = typeof target.completion.value === "boolean"
      ? typeof change.completion === "boolean"
      : typeof change.completion === "string" && target.completion.options.includes(change.completion);
    if (!valid) throw new Error("Invalid completion value");
    pairs.push([target.completion.key, change.completion]);
  }
  return Object.fromEntries(pairs.filter(([key, value]) =>
    !target.original[key].exists || !configsDeepEqual(target.original[key].value, value),
  ).map(([key, value]) => [key, { kind: "set", value }]));
}

export type ReminderSnoozePreset = "10m" | "1h" | "tomorrow";
export function getReminderSnoozeUntil(preset: ReminderSnoozePreset, now = Date.now()): number {
  if (preset === "10m") return now + 10 * 60000;
  if (preset === "1h") return now + 60 * 60000;
  const morning = new Date(now);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(9, 0, 0, 0);
  return morning.getTime();
}
