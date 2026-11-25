import { prepareReminderCompletionRename, type ReminderCompletionRename, persistRecordReminderRules, remapReminderCompletionOptions, renameRecordReminderField } from "../data/RecordReminders";
import { normalizeRecordReminderPreferences, replaceDatabaseReminderRules } from "../data/RecordReminders";
import { describe, expect, it } from "vitest";
import { composeDateOnlyReminderTime, collectDueRecordReminders, filterRecordReminderInbox, getRecordReminderInboxGroup, getReminderInboxPathHints, getRecordReminderOffsets, getRecordReminderRulePreview, prepareRecordReminderRules, getReminderRuleError, isValidReminderRule, migrateRecordReminderStates, recordReminderKey, normalizeDateOnlyReminderTime, normalizeReminderSettings, type RecordReminderRule, type RecordReminderSettings, type RecordReminderTarget } from "../data/RecordReminders";
import { readTimeSegmentInput } from "../views/TimeSegments";
import type { DatabaseConfig } from "../data/types";
import type { NoteRecord } from "../data/DataSource";
const now = new Date(2026, 10, 18, 10).getTime();
const rule: RecordReminderRule = { id: "rule", databaseId: "tasks", enabled: true, dateField: "due", completionField: "done", completedValues: [], dateOnlyTime: "09:00", advanceMinutes: 0 };
const db: DatabaseConfig = { id: "tasks", name: "Tasks", sourceFolder: "Tasks", schema: { columns: [{ key: "due", label: "Due", type: "date" }, { key: "done", label: "Done", type: "checkbox" }], computedFields: [] }, views: [] };
const record = (due: unknown, done: unknown = false): NoteRecord => ({ file: { path: "Tasks/One.md", basename: "One" } as NoteRecord["file"], frontmatter: { due, done } });
const settings = (r = rule): RecordReminderSettings => ({ rules: [r], states: {} });
const target = (records: NoteRecord[], database = db): RecordReminderTarget[] => [{ database, records }];
describe("keyboard entry for date-only reminder times", () => {
  it("normalizes colon and numeric-keyboard formats to a canonical 24-hour time", () => {
    const cases = [
      ["00:00", "00:00"], ["0:00", "00:00"], ["9:05", "09:05"], ["905", "09:05"],
      [" 0905 ", "09:05"], ["9：05", "09:05"], ["2359", "23:59"],
    ];
    for (const [input, expected] of cases) expect(normalizeDateOnlyReminderTime(input)).toBe(expected);
  });
  it("rejects incomplete and out-of-range values instead of shifting the due time", () => {
    for (const input of ["", "9", "9:", "9:5", "24:00", "2560", "23:60", "09:00 PM", "09:00:30", "abc", "00000"]) {
      expect(normalizeDateOnlyReminderTime(input)).toBeUndefined();
    }
  });
  it("normalizes each segment without rounding or filling missing values", () => {
    expect(composeDateOnlyReminderTime("8", "5")).toBe("08:05");
    expect(composeDateOnlyReminderTime("00", "0")).toBe("00:00");
    expect(composeDateOnlyReminderTime("23", "59")).toBe("23:59");
    for (const [hour, minute] of [["", "30"], ["9", ""], ["24", "00"], ["9", "60"], ["120", "00"], ["x", "12"]]) {
      expect(composeDateOnlyReminderTime(hour, minute)).toBeUndefined();
    }
  });
  it("uses the same segment completion rules as the date-time cell", () => {
    expect(readTimeSegmentInput("2", "hour")).toEqual({ text: "2", complete: false });
    expect(readTimeSegmentInput("8", "hour")).toEqual({ text: "08", complete: true });
    expect(readTimeSegmentInput("23", "hour")).toEqual({ text: "23", complete: true });
    expect(readTimeSegmentInput("5", "minute")).toEqual({ text: "5", complete: false });
    expect(readTimeSegmentInput("8", "minute")).toEqual({ text: "08", complete: true });
    expect(readTimeSegmentInput("x", "minute")).toEqual({ text: "", complete: false });
  });
  it("uses the normalized time for real date-only reminders", () => {
    const dateOnlyTime = normalizeDateOnlyReminderTime("845")!;
    const [pending] = collectDueRecordReminders(settings({ ...rule, dateOnlyTime }), target([record("2026-11-18")]), now);
    expect(pending.dueAt).toBe(new Date(2026, 10, 18, 8, 45).getTime());
  });
});

describe("database record reminders", () => {
  it("uses date-only local time and catches up when the app opens late", () => {
    const pending = collectDueRecordReminders(settings(), target([record("2026-11-18")]), now);
    expect(pending).toHaveLength(1);
    expect(pending[0].dueAt).toBe(new Date(2026, 10, 18, 9).getTime());
    expect(collectDueRecordReminders(settings(), target([record("2026-11-18")]), new Date(2026, 10, 18, 8).getTime())).toEqual([]);
  });
  it.each([true, "true", "on", "是", 1])("excludes completed checkbox %s", done => {
    expect(collectDueRecordReminders(settings(), target([record("2026-11-18", done)]), now)).toEqual([]);
  });
  it("honors datetime and advance minutes across midnight", () => {
    const datetime: DatabaseConfig = { ...db, schema: { ...db.schema, columns: [{ ...db.schema.columns[0], type: "datetime" }, db.schema.columns[1]] } };
    const r = { ...rule, advanceMinutes: 30 };
    expect(collectDueRecordReminders(settings(r), target([record("2026-11-19T00:15")], datetime), new Date(2026, 10, 18, 23, 46).getTime())).toHaveLength(1);
    expect(collectDueRecordReminders(settings(r), target([record("2026-11-19T00:15")], datetime), new Date(2026, 10, 18, 23, 44).getTime())).toEqual([]);
  });
  it("uses the entered time for ISO datetime values with a lowercase separator", () => {
    const datetime: DatabaseConfig = { ...db, schema: { ...db.schema, columns: [{ ...db.schema.columns[0], type: "datetime" }, db.schema.columns[1]] } };
    const records = target([record("2026-11-18t13:30")], datetime);
    const timestamp = new Date(2026, 10, 18, 13, 30).getTime();
    expect(collectDueRecordReminders(settings(), records, timestamp - 1)).toEqual([]);
    expect(collectDueRecordReminders(settings(), records, timestamp)[0]?.dueAt).toBe(timestamp);
  });
  it("uses YAML date components consistently", () => {
    expect(collectDueRecordReminders(settings(), target([record(new Date("2026-11-18T00:00Z"))]), now)[0].dueAt).toBe(new Date(2026, 10, 18, 9).getTime());
  });
  it.each(["invalid", "", null, undefined, "2026-02-30"])("ignores missing or invalid date %s", date => {
    expect(collectDueRecordReminders(settings(), target([record(date)]), now)).toEqual([]);
  });
  it("uses explicitly selected completion status rather than guessing", () => {
    const statusDb: DatabaseConfig = { ...db, schema: { ...db.schema, columns: [db.schema.columns[0], { key: "done", label: "Status", type: "status", statusOptions: [{ value: "Complete", color: "green" }, { value: "Done", color: "gray" }] }] } };
    const r = { ...rule, completedValues: ["Complete"] };
    expect(collectDueRecordReminders(settings(r), target([record("2026-11-18", "Complete")], statusDb), now)).toEqual([]);
    expect(collectDueRecordReminders(settings(r), target([record("2026-11-18", "Done")], statusDb), now)).toHaveLength(1);
  });
  it.each(["status", "select"] as const)("uses trimmed %s identity for preview and scheduling", type => {
    const col = { key: "done", label: "Status", type, statusOptions: [{ value: "Done", color: "green" as const }] };
    const statusDb = { ...db, schema: { ...db.schema, columns: [db.schema.columns[0], col] } };
    const r = { ...rule, completedValues: ["  Done  "] };
    const done = record("2026-11-18", "  Done  ");
    const pending = record("2026-11-18", "In progress");
    expect(getReminderRuleError(r, statusDb)).toBeUndefined();
    expect(collectDueRecordReminders(settings(r), target([done], statusDb), now)).toEqual([]);
    expect(collectDueRecordReminders(settings({ ...r, completedValues: ["Done"] }), target([done], statusDb), now)).toEqual([]);
    expect(collectDueRecordReminders(settings(r), target([pending], statusDb), now)).toHaveLength(1);
    const preview = getRecordReminderRulePreview(r, statusDb, [done, pending], now);
    expect(preview.excluded).toMatchObject([{ reason: "completed" }]);
    expect(preview.now).toHaveLength(1);
  });
  it.each(["file.ctime", "file.mtime", "file.created", "file.modified"])("rejects virtual dates %s in both preview and scheduler", key => {
    const fileDateDb = { ...db, schema: { ...db.schema, columns: [{ ...db.schema.columns[0], key }, db.schema.columns[1]] } };
    const r = { ...rule, dateField: key };
    const item = record("2026-11-18");
    item.frontmatter[key] = "2026-11-18";
    expect(getReminderRuleError(r, fileDateDb)).toBe("unsupportedDate");
    expect(collectDueRecordReminders(settings(r), target([item], fileDateDb), now)).toEqual([]);
    expect(getRecordReminderRulePreview(r, fileDateDb, [item], now)).toEqual({ now: [], skipped: [], later: [], excluded: [] });
  });
  it("pauses a rule with an old completion value instead of reminding for renamed completed tasks", () => {
    const statusDb: DatabaseConfig = { ...db, schema: { ...db.schema, columns: [db.schema.columns[0], { key: "done", label: "Status", type: "select",
      statusOptions: [{ value: "Complete", color: "green" }, { value: "In progress", color: "blue" }] }] } };
    const r = { ...rule, completedValues: ["Done", "In progress"] };
    const items = [record("2026-11-18", "Complete")];
    expect(getReminderRuleError(r, statusDb)).toBe("completionValues");
    expect(collectDueRecordReminders(settings(r), target(items, statusDb), now)).toEqual([]);
    expect(getReminderRuleError({ ...r, completedValues: ["Complete"] }, statusDb)).toBeUndefined();
  });
  it("honors ten minutes of snooze across newer triggers without silencing another rule", () => {
    const due = new Date(2026, 10, 18, 9).getTime();
    const first = { ...rule, offsets: [-30, -25] };
    const second = { ...first, id: "another" };
    const s = settings(first);
    s.rules.push(second);
    const records = target([record("2026-11-18")]);
    const pending = (minutes: number) => collectDueRecordReminders(s, records, due + minutes * 60000);
    const early = pending(-30).find(item => item.ruleId === first.id)!;
    s.states[early.key] = { snoozedUntil: due - 20 * 60000, updatedAt: due - 30 * 60000 };
    expect(pending(-25).map(item => item.ruleId)).toEqual([second.id]);
    expect(pending(-21).map(item => item.ruleId)).toEqual([second.id]);
    const after = pending(-20).find(item => item.ruleId === first.id);
    expect(after?.reminderAt).toBe(due - 25 * 60000);
    expect(after?.key).not.toBe(early.key);
  });
  it("persists dismissal only for this exact scheduled reminder", () => {
    const s = settings();
    const first = collectDueRecordReminders(s, target([record("2026-11-18")]), now)[0];
    s.states[first.key] = { dismissed: true, updatedAt: now };
    expect(collectDueRecordReminders(s, target([record("2026-11-18")]), now)).toEqual([]);
    expect(collectDueRecordReminders(s, target([record("2026-11-17")]), now)).toHaveLength(1);
  });
  it.each([false, true])("does not inherit a previous due date's dismissal or snooze (snooze=%s)", snooze => {
    const s = settings({ ...rule, offsets: [-1440, 0] });
    const [first] = collectDueRecordReminders(s, target([record("2026-11-18")]), now);
    s.states[first.key] = snooze ? { snoozedUntil: now + 600000, updatedAt: now } : { dismissed: true, updatedAt: now };
    expect(collectDueRecordReminders(s, target([record("2026-11-18")]), now)).toEqual([]);
    const [rescheduled] = collectDueRecordReminders(s, target([record("2026-11-19")]), now);
    expect(rescheduled).toBeDefined();
    expect(rescheduled.reminderAt).toBe(first.reminderAt);
    expect(rescheduled.key).not.toBe(first.key);
  });
  it("does not carry an ignored reminder to a different date field with the same time", () => {
    const schema = { ...db.schema, columns: [...db.schema.columns, { key: "release", label: "Release", type: "date" as const }] };
    const item = record("2026-11-19");
    item.frontmatter.release = item.frontmatter.due;
    const records = target([item], { ...db, schema });
    const initial = { ...rule, offsets: [-1440] };
    const s = settings(initial);
    const [first] = collectDueRecordReminders(s, records, now);
    const legacy = recordReminderKey(first.ruleId, first.databaseId, first.path, first.reminderAt);
    s.states[first.key] = s.states[legacy] = { dismissed: true, updatedAt: now };
    s.rules = prepareRecordReminderRules([{ ...initial, dateField: "release" }], s.rules, now + 1);
    const [retargeted] = collectDueRecordReminders(s, records, now + 1);
    expect(retargeted).toBeDefined();
    expect(retargeted.key).not.toBe(first.key);
    expect(retargeted.dueAt).toBe(first.dueAt);
    expect(retargeted.reminderAt).toBe(first.reminderAt);
  });

  it("still reads legacy dismissal keys and migrates both key formats on rename", () => {
    const s = settings();
    const original = record("2026-11-18");
    const [due] = collectDueRecordReminders(s, target([original]), now);
    const moved = { ...original, file: { ...original.file, path: "Tasks/Two.md" } };
    const legacy = recordReminderKey(due.ruleId, due.databaseId, due.path, due.reminderAt);
    expect(due.key).not.toBe(legacy);
    s.states[legacy] = { dismissed: true, updatedAt: now };
    expect(collectDueRecordReminders(s, target([original]), now)).toEqual([]);
    expect(migrateRecordReminderStates(s.states, original.file.path, moved.file.path)).toBe(true);
    expect(collectDueRecordReminders(s, target([moved]), now)).toEqual([]);
    delete s.states[recordReminderKey(due.ruleId, due.databaseId, moved.file.path, due.reminderAt)];
    s.states[due.key] = { dismissed: true, updatedAt: now };
    expect(migrateRecordReminderStates(s.states, original.file.path, moved.file.path)).toBe(true);
    expect(collectDueRecordReminders(s, target([moved]), now)).toEqual([]);
  });

  it("persists snooze through a settings roundtrip and fires at its expiry", () => {
    const s = settings(); const first = collectDueRecordReminders(s, target([record("2026-11-18")]), now)[0];
    s.states[first.key] = { snoozedUntil: now + 600000, updatedAt: now };
    const restored = normalizeReminderSettings(JSON.parse(JSON.stringify(s)));
    expect(collectDueRecordReminders(restored, target([record("2026-11-18")]), now + 599999)).toEqual([]);
    expect(collectDueRecordReminders(restored, target([record("2026-11-18")]), now + 600000)).toHaveLength(1);
  });
  it("ignores disabled rules and deleted or mistyped fields", () => {
    expect(collectDueRecordReminders(settings({ ...rule, enabled: false }), target([record("2026-11-18")]), now)).toEqual([]);
    expect(collectDueRecordReminders(settings({ ...rule, dateField: "deleted" }), target([record("2026-11-18")]), now)).toEqual([]);
    expect(collectDueRecordReminders(settings(), [], now)).toEqual([]);
    expect(isValidReminderRule({ ...rule, dateOnlyTime: "25:00" }, db)).toBe(false);
    expect(isValidReminderRule({ ...rule, advanceMinutes: -1 }, db)).toBe(false);
  });
  it("defensively loads old and malformed settings", () => {
    expect(normalizeReminderSettings(null)).toEqual({ rules: [], states: {} });
    expect(normalizeReminderSettings({ rules: [null, {}], states: { bad: {} } })).toEqual({ rules: [], states: {} });
  });
});

describe("reminder identity through record moves", () => {
  it("moves exact paths and schedules without altering dismissal or snooze", () => {
    const s = settings();
    const [before] = collectDueRecordReminders(s, target([record("2026-11-18")]), now);
    s.states[before.key] = { dismissed: true, updatedAt: now };
    const unrelated = recordReminderKey("rule", "tasks", "Elsewhere/One.md", before.reminderAt);
    s.states[unrelated] = { snoozedUntil: now + 600000, updatedAt: now };
    expect(migrateRecordReminderStates(s.states, "Tasks/One.md", "Tasks/Moved.md")).toBe(true);
    expect(s.states[before.key]).toBeUndefined();
    expect(s.states[unrelated].snoozedUntil).toBe(now + 600000);
    const moved = record("2026-11-18");
    moved.file = { path: "Tasks/Moved.md", basename: "Moved" } as NoteRecord["file"];
    expect(collectDueRecordReminders(s, target([moved]), now)).toEqual([]);
    moved.frontmatter.due = "2026-11-17";
    expect(collectDueRecordReminders(s, target([moved]), now)).toHaveLength(1);
  });

  it("keeps the newest action at a collision and does not reinterpret malformed keys", () => {
    const oldKey = recordReminderKey("rule", "tasks", "Tasks/A.md", now);
    const newKey = recordReminderKey("rule", "tasks", "Tasks/B.md", now);
    const states = { [oldKey]: { dismissed: true, updatedAt: now - 1 }, [newKey]: { snoozedUntil: now + 600000, updatedAt: now }, bad: { updatedAt: now } };
    expect(migrateRecordReminderStates(states, "Tasks/A.md", "Tasks/B.md")).toBe(true);
    expect(states).toEqual({ [newKey]: { snoozedUntil: now + 600000, updatedAt: now }, bad: { updatedAt: now } });
    expect(migrateRecordReminderStates(states, "Tasks/A.md", "Tasks/B.md")).toBe(false);
  });

  it("only validates the date-only clock for date fields and distinguishes field and lead errors", () => {
    const datetime: DatabaseConfig = { ...db, schema: { ...db.schema, columns: [{ ...db.schema.columns[0], type: "datetime" }, db.schema.columns[1]] } };
    expect(getReminderRuleError({ ...rule, dateOnlyTime: "" }, db)).toBe("time");
    expect(getReminderRuleError({ ...rule, dateOnlyTime: "" }, datetime)).toBeUndefined();
    expect(getReminderRuleError({ ...rule, completionField: "" }, db)).toBe("fields");
    expect(getReminderRuleError({ ...rule, advanceMinutes: -1 }, db)).toBe("advance");
  });
});

describe("record reminder preferences and database ownership", () => {
  it("migrates older vaults to on, ribbon hidden, database toolbar visible", () => {
    expect(normalizeRecordReminderPreferences(undefined)).toEqual({ enabled: true, showInboxRibbon: false, showDatabaseToolbar: true, desktopSystemNotifications: false, desktopNotificationPreview: true });
    expect(normalizeRecordReminderPreferences({ enabled: false, showInboxRibbon: true, showDatabaseToolbar: false }))
      .toEqual({ enabled: false, showInboxRibbon: true, showDatabaseToolbar: false, desktopSystemNotifications: false, desktopNotificationPreview: true });
    expect(normalizeRecordReminderPreferences({ enabled: "false", showInboxRibbon: 1, showDatabaseToolbar: null }))
      .toEqual({ enabled: true, showInboxRibbon: false, showDatabaseToolbar: true, desktopSystemNotifications: false, desktopNotificationPreview: true });
  });

  it("only opts in to desktop notifications with an explicit true value", () => {
    expect(normalizeRecordReminderPreferences({ desktopSystemNotifications: true }).desktopSystemNotifications).toBe(true);
    expect(normalizeRecordReminderPreferences({ desktopSystemNotifications: "true" }).desktopSystemNotifications).toBe(false);
  });

  it("enables previews by default, without enabling desktop delivery, and preserves an explicit opt-out", () => {
    expect(normalizeRecordReminderPreferences(undefined)).toMatchObject({
      desktopSystemNotifications: false, desktopNotificationPreview: true,
    });
    expect(normalizeRecordReminderPreferences({ desktopSystemNotifications: true }).desktopNotificationPreview).toBe(true);
    expect(normalizeRecordReminderPreferences({ desktopNotificationPreview: false }).desktopNotificationPreview).toBe(false);
  });

  it("replaces only the current database's rules, including deleting all of them", () => {
    const make = (databaseId: string, id: string): RecordReminderRule => ({
      id, databaseId, enabled: true, dateField: "due", completionField: "done", completedValues: [],
      dateOnlyTime: "09:00", advanceMinutes: 0,
    });
    const a = make("a", "one"), b = make("b", "two"), c = make("a", "three");
    const rules = [a, b];
    expect(replaceDatabaseReminderRules(rules, "a", [c, b])).toEqual([b, c]);
    expect(replaceDatabaseReminderRules(rules, "a", [])).toEqual([b]);
    expect(rules).toEqual([a, b]);
  });
});


describe("inbox presentation from real records", () => {
  it("uses the primary stored title and icon, and distinguishes rules without changing their keys", () => {
    const schema: DatabaseConfig["schema"] = { ...db.schema, columns: [...db.schema.columns, { key: "subject", label: "Subject", type: "text" }] };
    const primary = { name: "Tasks", sourceFolder: "Tasks", schema, titleField: "subject" };
    const table = { ...db, schema, views: [primary], recordIconField: "icon" };
    const note = record("2026-11-18");
    note.frontmatter.subject = "Verify itinerary";
    note.frontmatter.icon = "lucide:file-text@blue";
    const [first] = collectDueRecordReminders(settings({ ...rule, name: "  Deadline check " }), target([note], table), now);
    const [old] = collectDueRecordReminders(settings(), target([note], table), now);
    expect(first).toMatchObject({ title: "Verify itinerary", ruleName: "Deadline check", dateFieldLabel: "Due", iconToken: "lucide:file-text@blue" });
    expect(old.ruleName).toBe("Due");
    expect(first.key).toBe(old.key);
    expect(filterRecordReminderInbox([first, old], "tasks CHECK")).toEqual([first]);
    expect(filterRecordReminderInbox([first], "Tasks/One.md")).toEqual([]);
  });

  it("can find same-title records by folder without making unique titles expose their path", () => {
    const now = new Date(2026, 10, 18, 15).getTime();
    const [item] = collectDueRecordReminders(settings(), target([record("2026-11-18")]), now);
    const first = { ...item, key: "first", title: "Weekly", path: "Tasks/ProjectA/Weekly.md" };
    const second = { ...first, key: "second", path: "Tasks/ProjectB/Weekly.md" };
    const other = { ...first, key: "other", title: "Planning", path: "Tasks/Internal/Planning.md" };
    expect(filterRecordReminderInbox([first, second, other], "Weekly ProjectA")).toEqual([first]);
    expect(filterRecordReminderInbox([first, second, other], "ProjectB")).toEqual([second]);
    expect(filterRecordReminderInbox([first, second, other], "Internal")).toEqual([]);
    const root = { ...first, path: "Archive.md" };
    const nested = { ...second, path: "Archive/Archive.md" };
    expect([...getReminderInboxPathHints([root, nested, other]).values()]).toEqual(["Archive.md", "Archive/Archive.md"]);
  });

  it("prioritizes due time, including a future deadline whose reminder has already triggered", () => {
    const now = new Date(2026, 10, 18, 10).getTime();
    const dueAt = new Date(2026, 10, 19, 8).getTime();
    const lateAt = new Date(2026, 10, 18, 9).getTime();
    expect(getRecordReminderInboxGroup(dueAt, now)).toBe("early");
    expect(getRecordReminderInboxGroup(now, now)).toBe("today");
    expect(getRecordReminderInboxGroup(lateAt, now)).toBe("overdue");
    const [row] = collectDueRecordReminders(settings(), target([record("2026-11-18")]), now);
    expect(filterRecordReminderInbox([{ ...row, dueAt, reminderAt: 0 }, row], "").map(item => item.dueAt)).toEqual([lateAt, dueAt]);
  });

  it("keeps names through saved settings, but not invalid name types", () => {
    expect(normalizeReminderSettings({ rules: [{ ...rule, name: "  Review  " }] }).rules[0].name).toBe("Review");
    expect(normalizeReminderSettings({ rules: [{ ...rule, name: 47 }] }).rules[0].name).toBeUndefined();
  });
});


describe("live reminder time points and draft preview", () => {
  it("keeps a legacy rule's original reminder key after saving", () => {
    const original = { ...rule, advanceMinutes: 15 };
    const source = target([record("2026-11-18")]);
    const [saved] = prepareRecordReminderRules([original], [original], now);
    expect(getRecordReminderOffsets(saved)).toEqual([-15]);
    expect(saved.activatedAt).toBeUndefined();
    expect(collectDueRecordReminders(settings(saved), source, now)[0].key)
      .toBe(collectDueRecordReminders(settings(original), source, now)[0].key);
  });

  it("keeps one pending row per rule/record across multiple signed times", () => {
    const point = new Date(2026, 10, 18, 9).getTime();
    const configured = { ...rule, offsets: [-120, 0, 30] };
    const source = target([record("2026-11-18")]);
    const state = settings(configured);
    const [early] = collectDueRecordReminders(state, source, point - 30 * 60000);
    expect(early.reminderAt).toBe(point - 120 * 60000);
    state.states[early.key] = { updatedAt: point - 30 * 60000, dismissed: true };
    const [onTime] = collectDueRecordReminders(state, source, point);
    expect(onTime.reminderAt).toBe(point);
    state.states[onTime.key] = { updatedAt: point, dismissed: true };
    expect(collectDueRecordReminders(state, source, point + 10 * 60000)).toEqual([]);
    const late = collectDueRecordReminders(state, source, point + 30 * 60000);
    expect(late.map(row => row.reminderAt)).toEqual([point + 30 * 60000]);
    expect(normalizeReminderSettings(state).rules[0].offsets).toEqual([-120, 0, 30]);
  });

  it("uses the same activation and date math for previews and real reminders", () => {
    const neverSaved = { ...rule, offsets: [-120, 0] };
    const [saved] = prepareRecordReminderRules([neverSaved], [], now);
    const records = [record("2026-11-17"), record("2026-11-19"), record("", false), record("2026-11-18", true)];
    const preview = getRecordReminderRulePreview(saved, db, records, now);
    expect(preview.skipped).toHaveLength(1);
    expect(preview.later).toHaveLength(1);
    expect(preview.excluded).toHaveLength(2);
    expect(preview.now).toHaveLength(0);
    expect(collectDueRecordReminders(settings(saved), target(records), now)).toEqual([]);
    expect(prepareRecordReminderRules([{ ...saved, name: "New title" }], [saved], now + 10000)[0].activatedAt).toBe(now);
  });
});

it("malformed datetime times are excluded rather than treated as midnight", () => {
  const datetime: DatabaseConfig = { ...db, schema: { ...db.schema, columns: [{ ...db.schema.columns[0], type: "datetime" }, db.schema.columns[1]] } };
  const malformed = record("2026-11-18T25:00");
  const preview = getRecordReminderRulePreview(rule, datetime, [malformed], now);
  expect({ pending: collectDueRecordReminders(settings(), target([malformed], datetime), now).map(x => new Date(x.dueAt).toString()), excluded: preview.excluded.map(x => x.reason) }).toEqual({ pending: [], excluded: ["noDate"] });
});

it("impossible calendar dates cannot fall through to JS date rollover", () => {
  const datetime: DatabaseConfig = { ...db, schema: { ...db.schema, columns: [{ ...db.schema.columns[0], type: "datetime" }, db.schema.columns[1]] } };
  const malformed = record("2026/02/30 10:00");
  const preview = getRecordReminderRulePreview(rule, datetime, [malformed], now);
  expect({ pending: collectDueRecordReminders(settings(), target([malformed], datetime), now).map(r => new Date(r.dueAt).toString()), excluded: preview.excluded.map(x => x.reason) }).toEqual({ pending: [], excluded: ["noDate"] });
});

it("writes only the successful rule draft after a concurrent unrelated database save fails", async () => {
  const a = { ...rule, id: "old-a", databaseId: "A" };
  const requestedA = { ...a, name: "failed draft" };
  const requestedB = { ...rule, id: "new-b", databaseId: "B" };
  const state = { rules: [a], states: {} };
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = (action: () => Promise<void>) => {
    const next = tail.then(action);
    tail = next.catch(() => {});
    return next;
  };
  let fail!: (reason: Error) => void;
  const first = new Promise<void>((_resolve, reject) => { fail = reject; });
  const aSave = enqueue(() => persistRecordReminderRules(state, "A", [requestedA], () => first, now));
  let disk: RecordReminderSettings | undefined;
  const bSave = enqueue(() => persistRecordReminderRules(state, "B", [requestedB], next => {
    disk = structuredClone(next);
    return Promise.resolve();
  }, now));
  const handling = expect(aSave).rejects.toThrow("disk write failed");
  fail(new Error("disk write failed"));
  await handling;
  await bSave;
  expect(disk?.rules.map(x => [x.id, x.name])).toEqual([["old-a", undefined], ["new-b", undefined]]);
  expect(state.rules).toEqual(disk?.rules);
});

it("migrates reminder fields and schedule state only for the affected database, and can roll back", () => {
  const initial = { ...rule, activatedAt: now - 86400000 };
  const s = settings(initial);
  s.rules.push({ ...initial, id: "elsewhere", databaseId: "another" });
  const [due] = collectDueRecordReminders(s, target([record("2026-11-18")]), now);
  s.states[due.key] = { dismissed: true, updatedAt: now };
  const undo = renameRecordReminderField(s, db.id, "due", "deadline")!;
  expect(s.rules.map(x => [x.dateField, x.activatedAt])).toEqual([["deadline", initial.activatedAt], ["due", initial.activatedAt]]);
  const newDb = { ...db, schema: { ...db.schema, columns: [{ ...db.schema.columns[0], key: "deadline" }, db.schema.columns[1]] } };
  const newRec = { ...record("2026-11-18"), frontmatter: { deadline: "2026-11-18" } };
  const [newDue] = collectDueRecordReminders({ ...s, states: {} }, target([newRec], newDb), now);
  expect(newDue.key).not.toBe(due.key);
  expect(s.states[newDue.key]?.dismissed).toBe(true);
  expect(collectDueRecordReminders(s, target([newRec], newDb), now)).toEqual([]);
  undo();
  expect(s.rules[0]).toBe(initial);
  expect(s.states[due.key]?.dismissed).toBe(true);
  expect(Object.keys(s.states)).toEqual([due.key]);
  expect(renameRecordReminderField(s, db.id, "done", "finished")).toBeTypeOf("function");
  expect(s.rules[0].completionField).toBe("finished");
});

it("updates completed option names without reactivating reminder rules", () => {
  const original = { ...rule, completedValues: ["Done", "Cancelled"], activatedAt: now - 30000 };
  const another = { ...original, databaseId: "other" };
  const updated = remapReminderCompletionOptions([original, another], db.id, "done", [{ from: "Done", to: "Closed" }]);
  expect(updated[0]).toEqual({ ...original, completedValues: ["Closed", "Cancelled"] });
  expect(updated[1]).toBe(another);
  expect(remapReminderCompletionOptions(updated, db.id, "done", [{ from: "Closed", to: "Done" }])).toEqual([original, another]);
});

it("undoes and redoes an option merge without forgetting either originally excluded value", () => {
  const original = { ...rule, completedValues: ["A", "B"] };
  const edit: ReminderCompletionRename = { property: "done", renames: [{ from: "A", to: "B" }] };
  const forward = prepareReminderCompletionRename([original], db.id, edit);
  expect(forward.rules[0].completedValues).toEqual(["B"]);
  edit.history = forward.history;
  const undo = prepareReminderCompletionRename(forward.rules, db.id, edit, true);
  expect(undo.rules[0].completedValues).toEqual(["A", "B"]);
  expect(prepareReminderCompletionRename(undo.rules, db.id, edit).rules).toEqual(forward.rules);
});
