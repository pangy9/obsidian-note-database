import { t } from "../i18n";
import { compareReminderInboxOrder, getRecordReminderKeyWithoutPath, type DueRecordReminder } from "./RecordReminders";

export type ReminderInboxTarget = Pick<DueRecordReminder, "key" | "instance">;

export function reminderInboxTargetIdentity({ key, instance }: ReminderInboxTarget): string {
  // File identity protects against replacements at the same path. When identity
  // is unavailable, require an exact key rather than matching a different file.
  return JSON.stringify([instance, instance === undefined ? key : getRecordReminderKeyWithoutPath(key)]);
}

export interface RecordReminderNotice {
  title: string;
  body: string;
  target?: ReminderInboxTarget;
}

/** Keep counts readable in short banners, even with multiline or very long user labels. */
function truncateLabel(raw: string, limit: number): string {
  const label = raw.replace(/\s+/gu, " ").replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, "").trim();
  const characters = Array.from(label);
  return characters.length > limit ? characters.slice(0, limit - 1).join("").trimEnd() + "…" : label;
}

function noticeText(count: number, vaultName: string, recordTitle: string): RecordReminderNotice {
  const vault = truncateLabel(vaultName, 32);
  const record = truncateLabel(recordTitle, 46);
  return {
    title: vault ? t("reminder.noticeVault", { vault }) : t("reminder.title"),
    body: record
      ? t(count === 1 ? "reminder.noticePreviewOne" : "reminder.noticePreviewMany", { count, title: record })
      : t(count === 1 ? "reminder.noticeCountOne" : "reminder.noticeCountMany", { count }),
  };
}

export function buildRecordReminderNotice(fresh: readonly DueRecordReminder[], preview: boolean, vaultName = ""): RecordReminderNotice {
  const item = preview ? fresh.reduce<DueRecordReminder | undefined>((first, candidate) =>
    !first || compareReminderInboxOrder(candidate, first) < 0 ? candidate : first, undefined) : undefined;
  const message = noticeText(fresh.length, preview ? vaultName : "", item?.title ?? "");
  return item && truncateLabel(item.title, 46)
    ? { ...message, target: { key: item.key, instance: item.instance } } : message;
}

/** Testing must not reveal names or contents from a real vault on the system surface. */
export function buildRecordReminderTestNotice(preview: boolean): RecordReminderNotice {
  const message = noticeText(1, "", preview ? t("settings.reminders.testExampleRecord") : "");
  return {
    title: preview ? t("settings.reminders.testPreviewTitle", { vault: t("settings.reminders.testExampleVault") })
      : t("settings.reminders.testTitle"),
    body: message.body,
  };
}
