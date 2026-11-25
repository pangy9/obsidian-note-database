import { configsDeepEqual } from "./FrontmatterPatch";
import { isRecord } from "./SafeString";
import { stringifyValue } from "./Stringify";
import { getColumnOptions, normalizeOptionValueForKey, toBooleanValue } from "./ColumnTypes";
import { normalizeReminderDateTimeInput, parseDateTimeParts, toDateTimestamp } from "./DateTimeFormat";
import { isFileFieldKey } from "./FileFields";
import type { ColumnDef, DatabaseConfig } from "./types";
import type { NoteRecord } from "./DataSource";

export interface RecordReminderRule {
  id: string;
  databaseId: string;
  enabled: boolean;
  name?: string;
  dateField: string;
  completionField: string;
  completedValues: string[];
  dateOnlyTime: string;
  /** Legacy single reminder; retained so saved rules and existing action keys still work. */
  advanceMinutes: number;
  /** Minutes relative to the due date (negative before, positive after). */
  offsets?: number[];
  /** New/retargeted rules skip records already due at activation. Absent for legacy rules. */
  activatedAt?: number;
}
export interface RecordReminderState { dismissed?: boolean; snoozedUntil?: number; updatedAt: number; }
export interface RecordReminderSettings { rules: RecordReminderRule[]; states: Record<string, RecordReminderState>; }
export interface RecordReminderPreferences {
  enabled: boolean;
  showInboxRibbon: boolean;
  showDatabaseToolbar: boolean;
  desktopSystemNotifications: boolean;
  desktopNotificationPreview: boolean;
}

export function normalizeRecordReminderPreferences(value: unknown): RecordReminderPreferences {
  const raw = isRecord(value) ? value : {};
  return {
    enabled: raw.enabled !== false,
    showInboxRibbon: raw.showInboxRibbon === true,
    showDatabaseToolbar: raw.showDatabaseToolbar !== false,
    desktopSystemNotifications: raw.desktopSystemNotifications === true,
    desktopNotificationPreview: raw.desktopNotificationPreview !== false,
  };
}

/** Replace one database's rules without touching rules owned by other databases. */
export function replaceDatabaseReminderRules(rules: RecordReminderRule[], databaseId: string, draft: RecordReminderRule[]): RecordReminderRule[] {
  return [...rules.filter(rule => rule.databaseId !== databaseId), ...draft.filter(rule => rule.databaseId === databaseId)];
}

export interface RecordReminderTarget { database: DatabaseConfig; records: NoteRecord[]; }
export interface DueRecordReminder {
  key: string; ruleId: string; databaseId: string; databaseName: string;
  path: string; title: string; dueAt: number; reminderAt: number;
  ruleName: string; dateFieldLabel: string; iconToken?: string;
  /** In-memory file identity for rejecting actions on a replaced note. */
  instance?: number;
}
export const createReminderSettings = (): RecordReminderSettings => ({ rules: [], states: {} });
export const REMINDER_RULE_NAME_LIMIT = 60;
export function normalizeReminderRuleName(name: unknown): string | undefined {
  return typeof name === "string" ? name.trim().slice(0, REMINDER_RULE_NAME_LIMIT) || undefined : undefined;
}

export function getRecordReminderRuleName(rule: RecordReminderRule, db: DatabaseConfig): string {
  return normalizeReminderRuleName(rule.name) || db.schema.columns.find(column => column.key === rule.dateField)?.label || rule.dateField;
}

function getReminderRecordTitle(record: NoteRecord, db: DatabaseConfig): string {
  const view = db.views[0];
  const titleField = view?.viewType === "calendar" ? view.calendarTitleField
    : view?.viewType === "timeline" ? view.timelineTitleField : view?.titleField;
  const column = titleField && db.schema.columns.find(candidate => candidate.key === titleField);
  if (titleField && !titleField.startsWith("file.") && column && column.type !== "computed" && column.type !== "rollup") {
    const title = stringifyValue(record.frontmatter[titleField]).trim();
    if (title) return title;
  }
  // The inbox needs a navigable label even for a hidden/empty view title, without exposing the path.
  return record.file.basename;
}

export type RecordReminderInboxGroup = "overdue" | "today" | "early";
export function getRecordReminderInboxGroup(dueAt: number, now: number): RecordReminderInboxGroup {
  if (dueAt < now) return "overdue";
  return new Date(dueAt).toDateString() === new Date(now).toDateString() ? "today" : "early";
}

/** Show an unambiguous vault-relative path only for titles shared by different records. */
export function getReminderInboxPathHints(reminders: readonly DueRecordReminder[]): Map<string, string> {
  const byTitle = new Map<string, Set<string>>();
  for (const { title, path } of reminders) {
    const paths = byTitle.get(title) ?? new Set();
    paths.add(path);
    byTitle.set(title, paths);
  }
  const pathHints = new Map<string, string>();
  for (const paths of byTitle.values()) {
    if (paths.size > 1) for (const path of paths) pathHints.set(path, path);
  }
  return pathHints;
}

export function compareReminderInboxOrder(a: DueRecordReminder, b: DueRecordReminder): number {
  return a.dueAt - b.dueAt || a.reminderAt - b.reminderAt || a.key.localeCompare(b.key);
}

export function filterRecordReminderInbox(reminders: readonly DueRecordReminder[], query: string,
  pathHints = getReminderInboxPathHints(reminders)): DueRecordReminder[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return reminders.filter(item => {
    if (!terms.length) return true;
    const display = `${item.title} ${item.databaseName} ${item.ruleName} ${pathHints.get(item.path) || ""}`.toLocaleLowerCase();
    return terms.every(term => display.includes(term));
  }).sort(compareReminderInboxOrder);
}

const MAX_REMINDER_OFFSET = 365 * 24 * 60;
export const MAX_REMINDER_POINTS = 24;

export function normalizeRecordReminderOffsets(values: readonly unknown[]): number[] {
  return [...new Set(values.filter((value): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_REMINDER_OFFSET
  ))].sort((a, b) => a - b);
}

export function getRecordReminderOffsets(rule: RecordReminderRule): number[] {
  return rule.offsets ? normalizeRecordReminderOffsets(rule.offsets) : [-rule.advanceMinutes || 0];
}

export function prepareRecordReminderRules(draft: readonly RecordReminderRule[], previous: readonly RecordReminderRule[], now: number): RecordReminderRule[] {
  const byId = new Map(previous.map(rule => [rule.id, rule]));
  return draft.map(rule => {
    const old = byId.get(rule.id);
    return {
      ...rule, name: normalizeReminderRuleName(rule.name), offsets: getRecordReminderOffsets(rule),
      activatedAt: old && old.databaseId === rule.databaseId && old.dateField === rule.dateField && (!rule.enabled || old.enabled)
        ? old.activatedAt : now,
    };
  });
}

export class RecordReminderRulesConflict extends Error {}

const editableReminderFields = ["name", "enabled", "dateField", "completionField", "completedValues",
  "dateOnlyTime", "advanceMinutes", "offsets"] as const;

/** Preserve live reference migrations when the draft only changed unrelated settings. */
export function mergeRecordReminderDraft(base: readonly RecordReminderRule[], draft: readonly RecordReminderRule[],
  live: readonly RecordReminderRule[]): RecordReminderRule[] {
  if (configsDeepEqual(base, live)) return structuredClone([...draft]);
  if (!configsDeepEqual(base.map(rule => rule.id), live.map(rule => rule.id))) throw new RecordReminderRulesConflict();
  const prior = new Map(base.map(rule => [rule.id, rule]));
  const latest = new Map(live.map(rule => [rule.id, rule]));
  const kept = new Set(draft.map(rule => rule.id));
  for (const rule of base) {
    if (!kept.has(rule.id) && !configsDeepEqual(rule, latest.get(rule.id))) throw new RecordReminderRulesConflict();
  }
  return draft.map(rule => {
    const before = prior.get(rule.id);
    if (!before) return structuredClone(rule);
    const current = latest.get(rule.id)!;
    const next = structuredClone(current);
    // Do not combine an independently changed completion property with options
    // selected for a different property in the draft.
    const completion = (r: RecordReminderRule) => [r.completionField, r.completedValues] as const;
    if (!configsDeepEqual(completion(before), completion(current)) && !configsDeepEqual(completion(before), completion(rule))
      && !configsDeepEqual(completion(current), completion(rule))) throw new RecordReminderRulesConflict();
    for (const key of editableReminderFields) {
      if (configsDeepEqual(rule[key], before[key])) continue;
      if (!configsDeepEqual(current[key], before[key]) && !configsDeepEqual(current[key], rule[key])) throw new RecordReminderRulesConflict();
      Object.assign(next, { [key]: structuredClone(rule[key]) });
    }
    return next;
  });
}

/** Serialize this complete read/write/publish operation on the plugin settings queue. */
export async function persistRecordReminderRules(settings: RecordReminderSettings, databaseId: string, draft: RecordReminderRule[],
  write: (next: RecordReminderSettings) => Promise<void>, now = Date.now(), expected?: readonly RecordReminderRule[]): Promise<void> {
  if (expected && !configsDeepEqual(expected, settings.rules.filter(rule => rule.databaseId === databaseId))) {
    throw new RecordReminderRulesConflict();
  }
  const rules = replaceDatabaseReminderRules(settings.rules, databaseId, prepareRecordReminderRules(draft, settings.rules, now));
  await write({ rules, states: settings.states });
  settings.rules = rules;
}

export type ReminderPreviewGroup = "now" | "skipped" | "later" | "excluded";
export type ReminderPreviewReason = "reached" | "beforeActivation" | "future" | "noDate" | "completed" | "disabled";
export interface ReminderRulePreviewRow {
  path: string; title: string; iconToken?: string;
  dueAt?: number; reminderAt?: number; reason: ReminderPreviewReason;
}
// Preview payloads stay serializable; preserve the live file separately.
const reminderPreviewFiles = new WeakMap<ReminderRulePreviewRow, NoteRecord["file"]>();
export function getReminderPreviewFile(row: ReminderRulePreviewRow): NoteRecord["file"] | undefined {
  return reminderPreviewFiles.get(row);
}

export interface ReminderRuleEvaluation {
  dueAt?: number; reminderAt?: number; reason: ReminderPreviewReason;
}

function getReminderDueAt(value: unknown, dateType: string, dateOnlyTime: string): number | undefined {
  const parts = parseDateTimeParts(value, { rejectInvalidTime: true });
  if (!parts) return;
  if (dateType === "date") return toDateTimestamp(`${parts.dateKey}T${dateOnlyTime}`) ?? undefined;
  if (value instanceof Date || typeof value === "number") {
    const timestamp = value instanceof Date ? value.getTime() : value;
    return Number.isFinite(new Date(timestamp).getTime()) ? timestamp : undefined;
  }
  if (typeof value === "string" && parts.time) {
    // Keep seconds with or without an explicit zone. A zoned value denotes an
    // instant; a native date/time with no offset still uses the device timezone.
    const clock = /[T\s]+\d{1,2}:\d{2}(:[0-5]\d(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(normalizeReminderDateTimeInput(value));
    if (clock) {
      const timestamp = Date.parse(`${parts.dateKey}T${parts.time}${clock[1] ?? ":00"}${clock[2]?.toUpperCase() ?? ""}`);
      return Number.isFinite(timestamp) ? timestamp : undefined;
    }
  }
  return toDateTimestamp(`${parts.dateKey}T${parts.time || "00:00"}`) ?? undefined;
}

function getReminderTiming(record: NoteRecord, rule: RecordReminderRule, dateType: string,
  completionType: string, completedValues: ReadonlySet<string>, offsets: readonly number[], now: number): ReminderRuleEvaluation {
  const dueAt = getReminderDueAt(record.frontmatter[rule.dateField], dateType, rule.dateOnlyTime);
  if (!rule.enabled) return { dueAt, reason: "disabled" };
  const completed = record.frontmatter[rule.completionField];
  if (completionType === "checkbox" ? toBooleanValue(completed) : completedValues.has(normalizeOptionValueForKey(rule.completionField, completed))) {
    return { dueAt, reason: "completed" };
  }
  if (dueAt === undefined) return { reason: "noDate" };
  if (rule.activatedAt !== undefined && dueAt < rule.activatedAt) return { dueAt, reason: "beforeActivation" };
  for (let i = offsets.length - 1; i >= 0; --i) {
    const reminderAt = dueAt + offsets[i] * 60000;
    if (reminderAt <= now) return { dueAt, reminderAt, reason: "reached" };
  }
  return { dueAt, reminderAt: dueAt + offsets[0] * 60000, reason: "future" };
}

export function getRecordReminderRulePreview(rule: RecordReminderRule, db: DatabaseConfig, records: readonly NoteRecord[], now: number): Record<ReminderPreviewGroup, ReminderRulePreviewRow[]> {
  const result = { now: [], skipped: [], later: [], excluded: [] } as Record<ReminderPreviewGroup, ReminderRulePreviewRow[]>;
  if (!isValidReminderRule(rule, db)) return result;
  const date = db.schema.columns.find(column => column.key === rule.dateField)!;
  const completion = db.schema.columns.find(column => column.key === rule.completionField)!;
  const offsets = getRecordReminderOffsets(rule);
  const completedValues = getCompletionValues(rule);
  for (const record of records) {
    const timing = getReminderTiming(record, rule, date.type, completion.type, completedValues, offsets, now);
    const group = timing.reason === "reached" ? "now" : timing.reason === "future" ? "later" : timing.reason === "beforeActivation" ? "skipped" : "excluded";
    const icon = db.recordIconField ? record.frontmatter[db.recordIconField] : undefined;
    const row = { path: record.file.path, title: getReminderRecordTitle(record, db),
      iconToken: typeof icon === "string" ? icon : undefined, ...timing };
    reminderPreviewFiles.set(row, record.file);
    result[group].push(row);
  }
  for (const rows of Object.values(result)) rows.sort((a, b) => (a.reminderAt ?? a.dueAt ?? Infinity) - (b.reminderAt ?? b.dueAt ?? Infinity) || a.title.localeCompare(b.title));
  return result;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Accept a typed 24-hour time or the digit-only form from a numeric touch keyboard. */
export function normalizeDateOnlyReminderTime(input: string): string | undefined {
  const match = /^(\d{1,2})[:：]?([0-5]\d)$/.exec(input.trim());
  if (!match) return;
  const time = `${match[1].padStart(2, "0")}:${match[2]}`;
  if (TIME.test(time)) return time;
}

export function composeDateOnlyReminderTime(hour: string, minute: string): string | undefined {
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return;
  return normalizeDateOnlyReminderTime(`${hour}:${minute.padStart(2, "0")}`);
}

export function isReminderDateColumn(column?: ColumnDef): boolean {
  return Boolean(column && !isFileFieldKey(column.key) && (column.type === "date" || column.type === "datetime"));
}

function getCompletionValues(rule: RecordReminderRule): Set<string> {
  return new Set(rule.completedValues.map(value => normalizeOptionValueForKey(rule.completionField, value)));
}

export function getReminderRuleError(rule: RecordReminderRule, db?: DatabaseConfig): "fields" | "unsupportedDate" | "completionValues" | "time" | "advance" | undefined {
  if (!db || !rule.id || rule.databaseId !== db.id) return "fields";
  const date = db.schema.columns.find(c => c.key === rule.dateField);
  const completion = db.schema.columns.find(c => c.key === rule.completionField);
  if (date && isFileFieldKey(date.key)) return "unsupportedDate";
  if (!date || !isReminderDateColumn(date) || !completion ||
    !(completion.type === "checkbox" || completion.type === "status" || completion.type === "select")) return "fields";
  if (completion.type !== "checkbox") {
    if (!rule.completedValues.length) return "fields";
    const supported = new Set(getColumnOptions(completion).map(option => normalizeOptionValueForKey(completion.key, option.value)));
    for (const value of getCompletionValues(rule)) if (!value || !supported.has(value)) return "completionValues";
  }
  if (date.type === "date" && !TIME.test(rule.dateOnlyTime)) return "time";
  if (rule.offsets) {
    const offsets = getRecordReminderOffsets(rule);
    if (!offsets.length || offsets.length !== rule.offsets.length || offsets.length > MAX_REMINDER_POINTS) return "advance";
  } else if (!Number.isInteger(rule.advanceMinutes) || rule.advanceMinutes < 0 || rule.advanceMinutes > MAX_REMINDER_OFFSET) return "advance";
}

/** Read only native date and completion properties; no implicit formula syncing. */
export function isValidReminderRule(rule: RecordReminderRule, db: DatabaseConfig): boolean {
  return getReminderRuleError(rule, db) === undefined;
}

// Legacy development builds stored only the trigger time. New schedules also
// include the due time: different offsets can produce the same trigger time.
type LegacyReminderKeyParts = [ruleId: string, databaseId: string, path: string, reminderAt: number];
type ReminderKeyParts = LegacyReminderKeyParts | [...LegacyReminderKeyParts, dueAt: number, dateField: string];
type ReminderSchedule = Pick<DueRecordReminder, "dueAt"> & { dateField: string };

export function recordReminderKey(ruleId: string, databaseId: string, path: string, reminderAt: number, schedule?: ReminderSchedule): string {
  const key: ReminderKeyParts = schedule
    ? [ruleId, databaseId, path, reminderAt, schedule.dueAt, schedule.dateField]
    : [ruleId, databaseId, path, reminderAt];
  return JSON.stringify(key);
}

function parseRecordReminderKey(key: string): ReminderKeyParts | undefined {
  try {
    const parts: unknown = JSON.parse(key);
    if (Array.isArray(parts) && (parts.length === 4 || parts.length === 6) &&
        typeof parts[0] === "string" && typeof parts[1] === "string" && typeof parts[2] === "string" &&
        typeof parts[3] === "number" && Number.isFinite(parts[3]) &&
        (parts.length === 4 || typeof parts[4] === "number" && Number.isFinite(parts[4]) && typeof parts[5] === "string")) {
      return parts as ReminderKeyParts;
    }
  } catch { /* Invalid keys have no structured identity. */ }
}

/** A notification can outlive a path rename. Keep every part of its schedule. */
export function getRecordReminderKeyWithoutPath(key: string): string {
  const parts = parseRecordReminderKey(key);
  if (!parts) return key;
  parts[2] = "";
  return JSON.stringify(parts);
}

/** Different notification points still belong to the same scheduled due date. */
export function isSameReminderSchedule(left: string, right: string): boolean {
  if (left === right) return true;
  const a = parseRecordReminderKey(left);
  const b = parseRecordReminderKey(right);
  return a?.length === 6 && b?.length === 6 && a[0] === b[0] && a[1] === b[1] &&
    a[2] === b[2] && a[4] === b[4] && a[5] === b[5];
}

export function isRecordReminderKeyForPath(key: string, path: string): boolean {
  const owner = parseRecordReminderKey(key)?.[2];
  return owner === path || owner?.startsWith(`${path}/`) === true;
}

export function remapRecordReminderKey(key: string, oldPath: string, path: string): string {
  if (oldPath === path) return key;
  const parts = parseRecordReminderKey(key);
  if (!parts || (parts[2] !== oldPath && !parts[2].startsWith(`${oldPath}/`))) return key;
  parts[2] = path + parts[2].slice(oldPath.length);
  return JSON.stringify(parts);
}

export interface ReminderCompletionRename {
  property: string;
  renames: Array<{ from: string; to: string }>;
  /** Only completed-value lists actually changed by the original transaction. */
  history?: Array<{ id: string; before: string[]; after: string[] }>;
}

export function prepareReminderCompletionRename(rules: RecordReminderRule[], databaseId: string,
  change: ReminderCompletionRename, reverse = false): { rules: RecordReminderRule[]; history: NonNullable<ReminderCompletionRename["history"]> } {
  if (!change.history) {
    const next = remapReminderCompletionOptions(rules, databaseId, change.property, change.renames);
    const history = next.flatMap((rule, index) => rule === rules[index] ? []
      : [{ id: rule.id, before: [...rules[index].completedValues], after: [...rule.completedValues] }]);
    return { rules: next, history };
  }
  const indexed = new Map(change.history.map(edit => [edit.id, edit]));
  let changed = false;
  const next = rules.map(rule => {
    if (rule.databaseId !== databaseId || rule.completionField !== change.property) return rule;
    const edit = indexed.get(rule.id);
    if (!edit) return rule;
    const expected = reverse ? edit.after : edit.before;
    if (rule.completedValues.length !== expected.length || rule.completedValues.some((value, i) => value !== expected[i])) {
      throw new Error("Reminder completion values changed during history replay");
    }
    changed = true;
    return { ...rule, completedValues: [...(reverse ? edit.before : edit.after)] };
  });
  return { rules: changed ? next : rules, history: change.history };
}

export function remapReminderCompletionOptions(rules: RecordReminderRule[], databaseId: string, property: string,
  renames: Array<{ from: string; to: string }>): RecordReminderRule[] {
  const byValue = new Map(renames.map(({ from, to }) => [from, to]));
  let changed = false;
  const next = rules.map(rule => {
    if (rule.databaseId !== databaseId || rule.completionField !== property) return rule;
    const values = rule.completedValues.map(value => byValue.get(normalizeOptionValueForKey(property, value)) ?? value);
    if (values.every((value, index) => value === rule.completedValues[index])) return rule;
    changed = true;
    return { ...rule, completedValues: [...new Set(values)] };
  });
  return changed ? next : rules;
}

export function remapRecordReminderDateFieldKey(key: string, databaseId: string, oldKey: string,
  newKey: string, ruleIds: ReadonlySet<string>): string {
  const parts = parseRecordReminderKey(key);
  if (!parts || parts.length !== 6 || parts[1] !== databaseId || parts[5] !== oldKey || !ruleIds.has(parts[0])) return key;
  parts[5] = newKey;
  return JSON.stringify(parts);
}

/** Follow a database field rename, including undo/redo, without reactivating the rules. */
export function renameRecordReminderField(settings: RecordReminderSettings, databaseId: string, oldKey: string, newKey: string): (() => void) | undefined {
  if (oldKey === newKey) return;
  const replacements = new Map<RecordReminderRule, RecordReminderRule>();
  const dateRules = new Set<string>();
  for (const rule of settings.rules) {
    if (rule.databaseId !== databaseId) continue;
    const usesDate = rule.dateField === oldKey, usesCompletion = rule.completionField === oldKey;
    if (!usesDate && !usesCompletion) continue;
    if (usesDate) dateRules.add(rule.id);
    replacements.set(rule, { ...rule, dateField: usesDate ? newKey : rule.dateField,
      completionField: usesCompletion ? newKey : rule.completionField });
  }
  if (!replacements.size) return;
  settings.rules = settings.rules.map(rule => replacements.get(rule) ?? rule);
  const states = settings.states;
  const moves: Array<{ from: string; to: string; moved: RecordReminderState; before?: RecordReminderState }> = [];
  for (const [key, state] of Object.entries(states)) {
    const to = remapRecordReminderDateFieldKey(key, databaseId, oldKey, newKey, dateRules);
    if (to === key) continue;
    const before = states[to];
    if (!before || state.updatedAt > before.updatedAt) states[to] = state;
    delete states[key];
    moves.push({ from: key, to, moved: state, before });
  }
  return () => {
    const inverse = new Map([...replacements].map(([from, to]) => [to, from]));
    settings.rules = settings.rules.map(rule => inverse.get(rule) ?? rule);
    for (const { from, to, moved, before } of moves.reverse()) {
      if (!states[from]) states[from] = moved;
      if (states[to] === moved) {
        if (before) states[to] = before;
        else delete states[to];
      }
    }
  };
}

/** Keeps reminder identity and time unchanged; only the record path changes. */
export function migrateRecordReminderStates(states: Record<string, RecordReminderState>, oldPath: string, path: string): boolean {
  let changed = false;
  for (const [key, state] of Object.entries(states)) {
    const next = remapRecordReminderKey(key, oldPath, path);
    if (next === key) continue;
    // If the destination already has state for the exact same schedule, favor the latest action.
    if (!states[next] || state.updatedAt > states[next].updatedAt) states[next] = state;
    delete states[key];
    changed = true;
  }
  return changed;
}

export function collectDueRecordReminders(settings: RecordReminderSettings, targets: RecordReminderTarget[], now: number,
  getInstance?: (file: NoteRecord["file"]) => number): DueRecordReminder[] {
  const due = new Map<string, DueRecordReminder>();
  const snoozed = new Set<string>();
  const legacySnoozed = new Map<string, number>();
  for (const [key, state] of Object.entries(settings.states)) {
    if (state.dismissed || state.snoozedUntil === undefined || state.snoozedUntil <= now) continue;
    const parts = parseRecordReminderKey(key);
    if (!parts) continue;
    const [ruleId, databaseId, path] = parts;
    if (parts.length === 6) {
      snoozed.add(JSON.stringify([ruleId, databaseId, path, parts[4], parts[5]]));
    } else {
      const identity = JSON.stringify([ruleId, databaseId, path]);
      legacySnoozed.set(identity, Math.max(state.updatedAt, legacySnoozed.get(identity) ?? -Infinity));
    }
  }
  for (const rule of settings.rules) {
    if (!rule.enabled) continue;
    const target = targets.find(t => t.database.id === rule.databaseId);
    if (!target || !isValidReminderRule(rule, target.database)) continue;
    const dateColumn = target.database.schema.columns.find(c => c.key === rule.dateField)!;
    const completedColumn = target.database.schema.columns.find(c => c.key === rule.completionField)!;
    const ruleName = getRecordReminderRuleName(rule, target.database);
    const iconField = target.database.recordIconField;
    const offsets = getRecordReminderOffsets(rule);
    const completedValues = getCompletionValues(rule);
    for (const record of target.records) {
      const { dueAt, reminderAt, reason } = getReminderTiming(record, rule, dateColumn.type, completedColumn.type, completedValues, offsets, now);
      if (reason !== "reached" || dueAt === undefined || reminderAt === undefined) continue;
      const identity = [rule.id, rule.databaseId, record.file.path] as const;
      const key = recordReminderKey(...identity, reminderAt, { dueAt, dateField: rule.dateField });
      const state = settings.states[key];
      const legacy = settings.states[recordReminderKey(...identity, reminderAt)];
      const legacySnoozedAt = legacySnoozed.get(JSON.stringify(identity));
      const activeSince = rule.activatedAt ?? -Infinity;
      // A newer trigger for the same schedule must not shorten its ten-minute snooze.
      // Legacy state has no due time or field; don't carry it past rule reactivation.
      if (state?.dismissed || snoozed.has(JSON.stringify([...identity, dueAt, rule.dateField])) ||
          (!state && legacy?.dismissed && legacy.updatedAt >= activeSince) ||
          (legacySnoozedAt !== undefined && legacySnoozedAt >= activeSince)) continue;
      const icon = iconField ? record.frontmatter[iconField] : undefined;
      due.set(key, { key, ruleId: rule.id, databaseId: rule.databaseId, databaseName: target.database.name, path: record.file.path,
        title: getReminderRecordTitle(record, target.database), ruleName, dateFieldLabel: dateColumn.label || dateColumn.key,
        iconToken: typeof icon === "string" ? icon : undefined, dueAt, reminderAt,
        ...(getInstance ? { instance: getInstance(record.file) } : {}) });
    }
  }
  return [...due.values()].sort((a, b) => a.reminderAt - b.reminderAt || a.path.localeCompare(b.path));
}

/** Defensive parsing keeps settings from an older/corrupt install inert. */
export function normalizeReminderSettings(value: unknown): RecordReminderSettings {
  const result = createReminderSettings();
  if (!value || typeof value !== "object") return result;
  const raw = value as Partial<RecordReminderSettings>;
  if (Array.isArray(raw.rules)) result.rules = raw.rules.filter((r): r is RecordReminderRule => !!r &&
    typeof r.id === "string" && typeof r.databaseId === "string" && typeof r.dateField === "string" && typeof r.completionField === "string" &&
    typeof r.enabled === "boolean" && Array.isArray(r.completedValues) && r.completedValues.every(v => typeof v === "string") &&
    typeof r.dateOnlyTime === "string" && typeof r.advanceMinutes === "number")
    .map(r => {
      const offsets = Array.isArray(r.offsets) ? normalizeRecordReminderOffsets(r.offsets).slice(0, MAX_REMINDER_POINTS) : undefined;
      return { ...r, name: normalizeReminderRuleName(r.name), offsets: offsets?.length ? offsets : undefined,
        activatedAt: typeof r.activatedAt === "number" && Number.isFinite(r.activatedAt) ? r.activatedAt : undefined };
    });
  if (raw.states && typeof raw.states === "object") {
    for (const [key, s] of Object.entries(raw.states)) {
      if (s && typeof s.updatedAt === "number" && Number.isFinite(s.updatedAt)) result.states[key] = {
        updatedAt: s.updatedAt, dismissed: s.dismissed === true,
        snoozedUntil: typeof s.snoozedUntil === "number" && Number.isFinite(s.snoozedUntil) ? s.snoozedUntil : undefined,
      };
    }
  }
  return result;
}
