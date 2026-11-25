import { setIcon } from "obsidian";
import { t } from "../i18n";
import { closeDropdownForRoot, openDropdownMenu } from "./DropdownField";

const ACTIONS = [
  { key: "snooze", label: "reminder.snooze", icon: "timer" },
  { key: "rule", label: "reminder.inspectRule", icon: "settings-2" },
  { key: "dismiss", label: "reminder.dismiss", icon: "bell-off" },
] as const;

export type ReminderInboxAction = typeof ACTIONS[number]["key"];

export function renderReminderInboxActions(parent: HTMLElement, options: {
  root: HTMLElement;
  summary: HTMLButtonElement;
  title: string;
  bottomBoundary?: HTMLElement;
  run: (action: ReminderInboxAction) => void;
}): void {
  const { root, summary, title, bottomBoundary, run } = options;
  const button = (classes: string, label: string, icon: string) => {
    const result = parent.createEl("button", { cls: classes, attr: {
      type: "button", "aria-label": label, title: label,
    } });
    setIcon(result.createSpan({ attr: { "aria-hidden": "true" } }), icon);
    return result;
  };
  // Two presentations of the same handlers. Container queries expose only one in the tab order.
  const inline = ACTIONS.map(({ key, label, icon }) => {
    const control = button(`db-ri-inline db-ri-${key}`, t(label), icon);
    control.dataset.reminderAction = key;
    if (key === "snooze") control.createSpan({ text: t("reminder.snoozeShort"), attr: { "aria-hidden": "true" } });
    control.onclick = () => run(key);
    return control;
  });
  const more = button("db-ri-icon db-ri-more", t("reminder.itemActions", { title }), "more-horizontal");
  more.dataset.reminderAction = "more";
  more.setAttribute("aria-haspopup", "listbox");
  more.setAttribute("aria-expanded", "false");
  more.onclick = () => {
    const wasOpen = more.getAttribute("aria-expanded") === "true";
    closeDropdownForRoot(root, false);
    if (wasOpen) return;
    const win = more.ownerDocument.defaultView;
    const onResize = () => {
      closeDropdownForRoot(root, false);
      const next = more.getClientRects().length ? more : inline.find(control => control.getClientRects().length) ?? summary;
      next.focus({ preventScroll: true });
    };
    openDropdownMenu({
      anchor: more, focusOptions: true, bottomBoundary, label: t("reminder.rule"), value: "", popoverClassName: "db-button-menu-popover",
      options: ACTIONS.map(({ key, label, icon }) => ({ value: key, text: t(label), icon })),
      onChange: choice => {
        const item = ACTIONS.find(({ key }) => key === choice);
        if (item) run(item.key);
      },
      onClose: () => {
        win?.removeEventListener("resize", onResize);
        more.setAttribute("aria-expanded", "false");
      },
    });
    more.setAttribute("aria-expanded", "true");
    win?.addEventListener("resize", onResize);
  };
}
