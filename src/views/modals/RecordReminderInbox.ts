import { Component, Modal, Notice, Scope, setIcon, type App, type HoverParent, type WorkspaceLeaf } from "obsidian";
import { filterRecordReminderInbox, getRecordReminderInboxGroup, getReminderInboxPathHints, type DueRecordReminder, type RecordReminderInboxGroup } from "../../data/RecordReminders";
import { reminderInboxTargetIdentity, type ReminderInboxTarget } from "../../data/RecordReminderNotice";
import type { RecordReminderService } from "../../data/RecordReminderService";
import { isImeComposing } from "../../data/KeyboardUtils";
import { getEffectiveLocale, t } from "../../i18n";
import { closeDropdownForRoot, openDropdownMenu } from "../DropdownField";
import { closeActiveDateValuePicker, renderDateValuePicker } from "../DateValuePicker";
import { getReminderSnoozeUntil, type ReminderRecordEdit, type ReminderSnoozePreset } from "../../data/RecordReminderEditing";
import { isEditorLeaf } from "../DatabaseNoteReturn";
import { openCellStatusValuePicker } from "../CellStatusValuePicker";
import { renderReminderInboxActions } from "../ReminderInboxActions";
import { installNoteHoverPreview, markNoteHoverLink } from "../HoverLinkPreview";
import { positionToolbarPopover } from "../PopoverPosition";
import { renderRecordIcon } from "../RecordIconRenderer";
import { makeModalDraggable } from "./ModalDrag";

type RuleNavigator = (databaseId: string, ruleId: string, onClose: () => void) => boolean;
const GROUPS: RecordReminderInboxGroup[] = ["overdue", "today", "early"];

interface EventLayer {
  overlay: HTMLElement;
  anchor: HTMLButtonElement;
  position: () => void;
  host: HTMLElement;
  closeStatusPicker?: (restoreFocus?: boolean) => void;
}

/** The ribbon, command, and scheduler notice all open this real, vault-wide inbox. */
export class RecordReminderInbox extends Modal {
  private readonly lifecycle = new Component();
  private readonly hoverParent: HoverParent = { hoverPopover: null };
  private readonly hoverItems = new WeakMap<HTMLElement, DueRecordReminder>();
  private readonly formatter = new Intl.DateTimeFormat(getEffectiveLocale(), { dateStyle: "medium", timeStyle: "short" });
  private readonly dayTime = new Intl.DateTimeFormat(getEffectiveLocale(), { hour: "numeric", minute: "2-digit" });
  private readonly shortDate = new Intl.DateTimeFormat(getEffectiveLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  private layer?: EventLayer;
  private suspended = false;
  private updating = false;
  private undoAction?: { key: string; label: string; run: () => Promise<boolean> };
  private releaseReturn?: () => void;
  private returnFromNote?: () => void;
  private timer?: number;
  private search!: HTMLInputElement;
  private list!: HTMLDivElement;
  private body!: HTMLDivElement;
  private count!: HTMLSpanElement;
  private footer!: HTMLDivElement;
  private heading!: HTMLHeadingElement;
  private items: DueRecordReminder[] = [];
  private dataSignature = "";
  private requestedFocus?: ReminderInboxTarget;

  constructor(app: App, private readonly service: RecordReminderService, private readonly openRuleConfig: RuleNavigator, target?: ReminderInboxTarget) {
    super(app);
    this.requestedFocus = target;
    this.scope = new Scope(this.scope);
    this.scope.register([], "Escape", event => {
      if (isImeComposing(event)) return;
      if (this.layer?.host.querySelector(".db-date-value-popover")) {
        closeActiveDateValuePicker(this.contentEl.ownerDocument);
        return false;
      }
      if (this.layer?.closeStatusPicker) {
        this.layer.closeStatusPicker();
        return false;
      }
      if (!closeDropdownForRoot(this.layer?.host ?? this.contentEl)) {
        if (this.hoverParent.hoverPopover) this.clearHover();
        else if (this.layer) { if (!this.updating) this.closeDetail(true); }
        else if (this.search.value) {
          this.search.value = "";
          this.renderList();
          this.search.focus({ preventScroll: true });
        } else this.close();
      }
      return false;
    });
  }

  onOpen(): void {
    this.modalEl.addClass("db-reminder-inbox");
    const root = this.contentEl;
    root.addClass("note-database-modal", "db-reminder-inbox-content");
    const header = root.createDiv({ cls: "db-ri-head" });
    this.heading = header.createEl("h3", { cls: "db-ri-title", attr: { tabindex: "-1" } });
    this.heading.createSpan({ text: t("reminder.inbox") });
    this.count = this.heading.createSpan({ cls: "db-ri-count" });
    makeModalDraggable(this, this.heading);
    this.body = root.createDiv({ cls: "db-ri-body" });
    this.search = this.body.createEl("input", { cls: "db-cell-option-search db-ri-search", attr: {
      type: "search", "aria-label": t("reminder.searchInbox"), placeholder: t("reminder.searchInbox"),
    } });
    this.search.oninput = () => { this.clearHover(); this.renderList(); };
    this.list = this.body.createDiv({ cls: "db-ri-list" });
    this.footer = root.createDiv({ cls: "db-ri-feedback" });
    this.footer.hidden = true;
    this.lifecycle.load();
    installNoteHoverPreview(this.lifecycle, this.containerEl, this.app, this.hoverParent, target => {
      const item = this.hoverItems.get(target);
      return !!item && !!this.getOriginalFile(item);
    });
    const observer = new MutationObserver(() => this.hoverParent.hoverPopover?.hoverEl.addClass("db-ri-note-hover"));
    observer.observe(root.ownerDocument.body, { childList: true });
    this.lifecycle.register(() => observer.disconnect());
    this.refresh(true);
    this.timer = root.ownerDocument.defaultView?.setInterval(() => this.refreshPending(), 30000);
  }

  override open(): void {
    super.open();
    // Obsidian applies its default modal focus after onOpen returns.
    if (this.containerEl.isConnected && !this.suspended) this.revealRequestedReminder();
  }

  override close(): void {
    this.releaseReturn?.();
    this.resume(false);
    super.close();
  }

  onClose(): void {
    if (this.timer !== undefined) this.contentEl.ownerDocument.defaultView?.clearInterval(this.timer);
    this.closeDetail(false);
    this.clearHover();
    closeDropdownForRoot(this.contentEl, false);
    this.lifecycle.unload();
    this.contentEl.empty();
  }

  /** Reopen the single inbox from the ribbon or command even while a note is displayed. */
  present(target?: ReminderInboxTarget): boolean {
    if (target) this.requestedFocus = target;
    if (this.returnFromNote) { this.returnFromNote(); return true; }
    if (this.suspended) return false; // The rule editor owns the return callback.
    this.refreshPending();
    return true;
  }

  refreshPending(): void {
    if (this.suspended || this.updating) return;
    const target = this.requestedFocus;
    if (target) {
      // An explicit notification click can replace an idle detail, but not an
      // open property editor with a draft. Ignore stale clicks without disturbing the UI.
      if (this.layer?.closeStatusPicker || this.layer?.host.querySelector(".db-date-value-popover")) return;
      const identity = reminderInboxTargetIdentity(target);
      if (this.service.pending().some(item => reminderInboxTargetIdentity(item) === identity)) {
        this.closeDetail(false);
        this.clearHover();
        closeDropdownForRoot(this.contentEl, false);
      } else this.requestedFocus = undefined;
    }
    if (this.layer || this.hoverParent.hoverPopover
      || this.list.querySelector('.db-ri-actions button[aria-expanded="true"]')) return;
    this.refresh();
    this.revealRequestedReminder();
  }

  private revealRequestedReminder(): void {
    const target = this.requestedFocus;
    if (!target) return;
    this.requestedFocus = undefined;
    const identity = reminderInboxTargetIdentity(target);
    const item = this.items.find(candidate => reminderInboxTargetIdentity(candidate) === identity);
    if (!item) return;
    const rowByKey = () => this.rowButtons().find(row => row.dataset.reminderKey === item.key);
    if (!rowByKey() && this.search.value) {
      this.search.value = "";
      this.renderList();
    }
    const row = rowByKey();
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  }

  private refresh(force = false): void {
    const items = this.service.pending();
    const now = Date.now();
    const signature = JSON.stringify([new Date(now).toDateString(), items.map(item => [item, getRecordReminderInboxGroup(item.dueAt, now)])]);
    if (!force && signature === this.dataSignature) return;
    this.dataSignature = signature;
    this.items = items;
    this.count.setText(String(items.length));
    this.count.setAttribute("aria-label", t("reminder.inboxCount", { count: items.length }));
    if (items.length >= 10) this.modalEl.addClass("db-ri-searchable");
    this.search.hidden = !this.modalEl.classList.contains("db-ri-searchable");
    this.renderList();
  }

  private renderList(): void {
    const scroll = this.body.scrollTop;
    const active = this.contentEl.ownerDocument.activeElement;
    const focusedRow = active && this.list.contains(active) ? active.closest(".db-ri-row") : null;
    const restore = focusedRow?.querySelector<HTMLElement>("[data-reminder-key]")?.dataset.reminderKey;
    const action = active?.getAttribute("data-reminder-action") ?? undefined;
    this.list.empty();
    const pathHints = getReminderInboxPathHints(this.items);
    const filtered = filterRecordReminderInbox(this.items, this.search.value, pathHints);
    if (!filtered.length) {
      const empty = this.list.createDiv({ cls: "db-ri-empty", attr: { role: "status" } });
      setIcon(empty.createSpan({ attr: { "aria-hidden": "true" } }), this.items.length ? "search" : "bell");
      empty.createEl("h4", { text: t(this.items.length ? "common.noResults" : "reminder.inboxEmpty") });
      if (!this.items.length) empty.createEl("p", { text: t("reminder.inboxEmptyHelp") });
    } else {
      const groups = new Map<RecordReminderInboxGroup, DueRecordReminder[]>();
      const now = Date.now();
      for (const item of filtered) {
        const group = getRecordReminderInboxGroup(item.dueAt, now);
        const rows = groups.get(group) ?? [];
        rows.push(item);
        groups.set(group, rows);
      }
      for (const group of GROUPS) {
        const rows = groups.get(group);
        if (!rows?.length) continue;
        const label = t(`reminder.group.${group}`);
        const section = this.list.createEl("section", { cls: `db-ri-group is-${group}`, attr: { "aria-label": label } });
        section.createEl("h4", { text: label }).createSpan({ text: String(rows.length) });
        const entries = section.createEl("ul");
        for (const item of rows) this.renderRow(entries, item, now, pathHints.get(item.path));
      }
    }
    this.body.scrollTop = scroll;
    if (restore) this.focusRow(restore, action);
  }

  private button(parent: HTMLElement, label: string, icon: string, cls?: string, showLabel = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls, attr: { type: "button", "aria-label": label, title: label } });
    setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), icon);
    if (showLabel) button.createSpan({ text: label });
    return button;
  }

  private dueLabel(timestamp: number, now: number): string {
    const day = new Date(timestamp).toDateString();
    if (day === new Date(now).toDateString()) return t("reminder.todayAt", { time: this.dayTime.format(timestamp) });
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (day === tomorrow.toDateString()) return t("reminder.tomorrowAt", { time: this.dayTime.format(timestamp) });
    return (new Date(timestamp).getFullYear() === new Date(now).getFullYear() ? this.shortDate : this.formatter).format(timestamp);
  }

  private renderRow(list: HTMLElement, item: DueRecordReminder, now: number, pathHint?: string): void {
    const row = list.createEl("li", { cls: "db-ri-row" });
    const summary = row.createEl("button", { cls: "db-ri-summary", attr: { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" } });
    summary.dataset.reminderKey = item.key;
    const icon = renderRecordIcon(summary, item.iconToken, { compact: true });
    icon.setAttribute("aria-hidden", "true");
    const labels = summary.createSpan({ cls: "db-ri-labels" });
    const title = labels.createEl("strong", { text: item.title, attr: { title: item.title } });
    markNoteHoverLink(title, item.path, item.path);
    this.hoverItems.set(title, item);
    summary.setAttribute("aria-keyshortcuts", "Shift+Enter");
    summary.onkeydown = event => {
      if (!event.shiftKey || event.key !== "Enter" || isImeComposing(event)) return;
      event.preventDefault();
      const win = title.ownerDocument.defaultView;
      if (win) title.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true, metaKey: true, ctrlKey: true }));
    };
    const due = this.dueLabel(item.dueAt, now);
    const metadata = labels.createSpan({ cls: "db-ri-source db-segmented-meta", attr: {
      title: [`${t("common.database")}: ${item.databaseName}`, `${t("reminder.rule")}: ${item.ruleName}`].join("\n"),
    } });
    metadata.createSpan({ cls: "db-ri-database", text: item.databaseName });
    metadata.createSpan({ cls: "db-ri-rule", text: item.ruleName });
    if (pathHint) labels.createSpan({ cls: "db-ri-path-hint", text: pathHint, attr: { title: pathHint } });
    const accessibleTitle = pathHint ? `${item.title} (${pathHint})` : item.title;
    summary.setAttribute("aria-label", t("reminder.inboxRowLabel", { title: accessibleTitle, database: item.databaseName, rule: item.ruleName, due }));
    summary.createSpan({ cls: "db-ri-due", text: due, attr: { title: this.formatter.format(item.dueAt) } });
    summary.onclick = event => { if (!event.metaKey && !event.ctrlKey) this.openDetail(summary, item, pathHint); };
    const actions = row.createDiv({ cls: "db-ri-actions" });
    renderReminderInboxActions(actions, {
      root: this.contentEl, summary, title: accessibleTitle, bottomBoundary: this.footer,
      run: choice => {
        if (choice === "rule") this.inspectRule(item);
        else void this.handle(item, choice === "snooze", summary);
      },
    });
  }

  private rowButtons(): HTMLButtonElement[] { return Array.from(this.list.querySelectorAll<HTMLButtonElement>("[data-reminder-key]")); }

  private focusRow(key?: string, action?: string): void {
    const row = this.rowButtons().find(button => button.dataset.reminderKey === key);
    const control = action ? row?.closest(".db-ri-row")
      ?.querySelector<HTMLButtonElement>(`[data-reminder-action="${action}"]`) : undefined;
    const target = control && control.getClientRects().length ? control : row ?? (this.search.hidden ? this.heading : this.search);
    target.focus({ preventScroll: true });
  }

  private async handle(item: DueRecordReminder, snooze: boolean | number, anchor: HTMLButtonElement): Promise<void> {
    const label = typeof snooze === "number" ? t("reminder.snoozedUntil", { time: this.formatter.format(snooze) }) :
      t(snooze ? "reminder.snoozed" : "reminder.dismissed");
    await this.performAction(item, anchor, label,
      () => this.service.update(item, snooze));
  }

  private async performAction(item: DueRecordReminder, anchor: HTMLButtonElement, label: string,
    write: () => Promise<(() => Promise<boolean>) | undefined>, keepField?: string): Promise<void> {
    if (this.updating) return;
    this.updating = true;
    const rows = this.rowButtons();
    const position = rows.indexOf(anchor);
    const nextKey = (rows[position + 1] ?? rows[position - 1])?.dataset.reminderKey;
    try {
      const run = await write();
      if (!this.containerEl.isConnected) return;
      if (!run) {
        this.closeDetail(false);
        this.refresh(true);
        this.focusRow(nextKey);
        new Notice(t("reminder.itemChanged"));
        return;
      }
      this.undoAction = { key: item.key, label, run };
      this.closeDetail(false);
      this.refresh(true);
      this.renderFeedback();
      const nextItem = keepField ? this.items.find(candidate =>
        candidate.path === item.path && candidate.instance === item.instance && candidate.ruleId === item.ruleId &&
        candidate.databaseId === item.databaseId) : undefined;
      const nextAnchor = nextItem && this.rowButtons().find(row => row.dataset.reminderKey === nextItem.key);
      if (nextItem && nextAnchor) {
        this.openDetail(nextAnchor, nextItem, getReminderInboxPathHints(this.items).get(nextItem.path), true);
        this.layer?.host.querySelector<HTMLElement>(`[data-ri-editor="${keepField}"]`)?.focus({ preventScroll: true });
      } else this.focusRow(this.rowButtons().some(row => row.dataset.reminderKey === item.key) ? item.key : nextKey);
    } catch (error) {
      new Notice(t("errors.updateFailed", { error: String(error) }));
    } finally {
      this.updating = false;
      if (this.requestedFocus && this.containerEl.isConnected) this.refreshPending();
    }
  }

  private renderFeedback(target = this.footer, inDetail = false): void {
    target.empty();
    const action = this.undoAction;
    target.hidden = !action;
    if (!action) return;
    target.createSpan({ text: action.label, attr: { role: "status" } });
    target.createEl("button", { text: t("toolbar.undo"), attr: { type: "button" } }).onclick = () => {
      if (this.updating || this.undoAction !== action) return;
      this.updating = true;
      void action.run().then(restored => {
        if (!this.containerEl.isConnected) return;
        this.undoAction = undefined;
        if (inDetail) this.closeDetail(false);
        this.renderFeedback();
        this.refresh(true);
        if (!restored) new Notice(t("reminder.undoExpired"));
        this.focusRow(action.key);
      }).catch((error: unknown) => new Notice(t("errors.updateFailed", { error: String(error) })))
        .finally(() => {
          this.updating = false;
          if (this.requestedFocus && this.containerEl.isConnected) this.refreshPending();
        });
    };
  }

  private openDetail(anchor: HTMLButtonElement, item: DueRecordReminder, pathHint?: string, showUndo = false): void {
    if (!this.getOriginalFile(item)) { this.refreshChangedItem(item); return; }
    closeDropdownForRoot(this.contentEl, false);
    this.closeDetail(false);
    this.clearHover();
    const overlay = this.containerEl.createDiv({ cls: "db-ri-event-overlay" });
    const host = overlay.createDiv({ cls: "note-database-container db-ri-event-host" });
    const card = host.createEl("section", { cls: "db-record-detail-panel db-ri-event", attr: {
      id: "db-ri-event", role: "dialog", "aria-modal": "true", "aria-labelledby": "db-ri-event-title",
    } });
    const header = card.createDiv({ cls: "db-record-detail-header" });
    renderRecordIcon(header, item.iconToken).setAttribute("aria-hidden", "true");
    const title = header.createDiv({ cls: "db-record-detail-title", text: item.title, attr: { id: "db-ri-event-title" } });
    markNoteHoverLink(title, item.path, item.path);
    this.hoverItems.set(title, item);
    const controls = header.createDiv({ cls: "db-ri-event-controls" });
    const open = this.button(controls, t("menu.openNote"), "maximize-2", "db-board-card-open");
    open.onclick = () => { if (!this.updating) void this.openNote(item); };
    this.button(controls, t("common.close"), "x", "db-board-card-open").onclick = () => { if (!this.updating) this.closeDetail(true); };
    const fields = card.createDiv({ cls: "db-record-detail-fields" });
    const field = (label: string, editable = false): HTMLDivElement => {
      const line = fields.createDiv({ cls: editable ? "db-record-detail-field db-ri-inline-field" : "db-record-detail-field is-readonly" });
      line.createSpan({ cls: "db-record-detail-field-label", text: label });
      return line;
    };
    if (pathHint) field(t("reminder.recordPath")).createSpan({ cls: "db-board-card-value db-ri-path-hint", text: pathHint });
    field(t("common.database")).createSpan({ cls: "db-board-card-value", text: item.databaseName });
    const link = this.button(field(t("reminder.rule")), item.ruleName, "arrow-up-right", "db-ri-rule-link", true);
    link.setAttribute("aria-label", t("reminder.inspectNamedRule", { name: item.ruleName }));
    link.onclick = () => { if (!this.updating) this.inspectRule(item); };
    const trigger = field(t("reminder.triggerLabel")).createDiv({ cls: "db-board-card-value db-ri-trigger-value has-badges" });
    const triggerTime = this.formatter.format(item.reminderAt);
    const ruleHint = t("reminder.triggerRuleHint");
    trigger.createSpan({ cls: "db-ri-rule-time", text: triggerTime, attr: { title: ruleHint, "aria-label": `${triggerTime} · ${ruleHint}` } });
    trigger.createSpan({ cls: "db-ri-rule-time-hint", text: ruleHint });

    const snooze = this.button(controls, t("reminder.snoozeMenu"), "timer", "db-board-card-open");
    controls.insertBefore(snooze, open);
    snooze.setAttribute("aria-haspopup", "listbox");
    snooze.setAttribute("aria-expanded", "false");
    snooze.onclick = () => {
      if (this.updating || closeDropdownForRoot(host)) return;
      snooze.setAttribute("aria-expanded", "true");
      openDropdownMenu({ anchor: snooze, focusOptions: true, label: t("reminder.snoozeMenu"), value: "", options:
        (["10m", "1h", "tomorrow"] as const).map(value => ({ value, text: t(`reminder.snoozePreset.${value}`) })),
        onChange: value => { void this.handle(item, getReminderSnoozeUntil(value as ReminderSnoozePreset), anchor); },
        onClose: () => snooze.setAttribute("aria-expanded", "false") });
    };

    const target = this.service.editTarget(item);
    if (target) {
      // Picker close handlers may restore focus to their trigger after returning.
      const flushRequestedFocus = () => queueMicrotask(() => {
        if (this.requestedFocus && this.layer?.host === host) this.refreshPending();
      });
      const apply = (draft: ReminderRecordEdit, field: "date" | "completion", recover: () => void): void => {
        if (this.updating) { recover(); return; }
        void this.performAction(item, anchor, t("reminder.recordUpdated"),
          () => this.service.editRecord(item, target, draft), field).then(() => {
            // A failed write keeps the current card and restores its displayed value.
            if (this.layer?.host === host) recover();
          });
      };
      const dateField = field(target.date.label, true);
      const due = target.date.type === "date"
        ? new Intl.DateTimeFormat(getEffectiveLocale(), { dateStyle: "medium" }).format(item.dueAt)
        : this.formatter.format(item.dueAt);
      const dateButton = renderDateValuePicker({
        parent: dateField, placeholder: target.date.label, className: "db-board-card-value db-ri-inline-date",
        value: target.date.value, displayText: due, allowEmpty: false, includeTime: target.date.type === "datetime",
        onClose: flushRequestedFocus,
        onChange: value => apply({ date: value }, "date", () => {
          if (this.layer?.host === host) {
            this.openDetail(anchor, item, pathHint);
            this.layer?.host.querySelector<HTMLElement>('[data-ri-editor="date"]')?.focus({ preventScroll: true });
          }
        }),
      });
      dateButton.dataset.riEditor = "date";
      dateButton.addEventListener("click", event => { if (this.updating) event.stopImmediatePropagation(); }, true);
      dateField.onclick = () => dateButton.click();

      const completionField = field(target.completion.label, true);
      const current = target.completion.value;
      if (typeof current === "boolean") {
        const value = completionField.createDiv({ cls: "db-board-card-value db-checkbox-cell" });
        const check = value.createEl("input", { attr: { type: "checkbox", "aria-label": target.completion.label } });
        check.dataset.riEditor = "completion";
        check.checked = current;
        check.onclick = event => event.stopPropagation();
        check.onchange = () => apply({ completion: check.checked }, "completion", () => { check.checked = current; });
        completionField.onclick = () => check.click();
      } else {
        const choice = completionField.createEl("button", {
          cls: "db-board-card-value db-ri-inline-status has-badges",
          attr: { type: "button", "aria-label": `${target.completion.label}: ${current || t("common.empty")}`,
            "aria-haspopup": "dialog", "aria-expanded": "false" },
        });
        choice.dataset.riEditor = "completion";
        choice.createSpan({ cls: `status-badge status-color-${target.completion.colors[current] ?? "gray"}`, text: current || t("common.empty") });
        choice.onclick = event => {
          event.stopPropagation();
          const layer = this.layer;
          if (this.updating || layer?.host !== host) return;
          closeDropdownForRoot(host, false);
          if (layer.closeStatusPicker) { layer.closeStatusPicker(); return; }
          layer.closeStatusPicker = openCellStatusValuePicker({
            host, anchor: choice, label: target.completion.label, value: current,
            options: target.completion.options.map(value => ({ value, color: target.completion.colors[value] ?? "gray" })),
            onSelect: completion => apply({ completion }, "completion", () => {}),
            onClose: () => {
              layer.closeStatusPicker = undefined;
              flushRequestedFocus();
            },
          });
        };
        completionField.onclick = () => choice.click();
      }
    } else {
      field(item.dateFieldLabel).createSpan({ cls: "db-board-card-value", text: this.formatter.format(item.dueAt) });
      fields.createEl("p", { cls: "db-ri-edit-hint", text: t("reminder.editUnavailable") });
    }

    if (showUndo) this.renderFeedback(card.createDiv({ cls: "db-ri-feedback db-ri-detail-feedback" }), true);

    overlay.onclick = event => { if (!this.updating && event.target === overlay) this.closeDetail(true); };
    card.onkeydown = event => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(card.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),[tabindex='0']"))
        .filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = card.ownerDocument.activeElement;
      if (event.shiftKey && active === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last && first) { event.preventDefault(); first.focus(); }
    };
    const position = (): void => {
      const narrow = overlay.clientWidth <= 600 || card.ownerDocument.body.classList.contains("is-phone");
      card.toggleClass("is-sheet", narrow);
      if (narrow) {
        card.setCssProps({ position: "absolute", left: "12px", right: "12px", top: "auto",
          width: "auto", maxWidth: "none", bottom: "max(12px, env(safe-area-inset-bottom))", maxHeight: "min(420px, 65dvh)" });
      } else positionToolbarPopover(card, anchor, { preferredWidth: 370, maxWidth: 370, maxHeight: 450, align: "center" });
    };
    this.layer = { overlay, anchor, position, host };
    this.modalEl.inert = true;
    anchor.setAttribute("aria-expanded", "true");
    anchor.setAttribute("aria-controls", card.id);
    overlay.ownerDocument.defaultView?.addEventListener("resize", position);
    position();
    open.focus({ preventScroll: true });
  }

  private closeDetail(restore: boolean): void {
    const layer = this.layer;
    if (!layer) return;
    this.layer = undefined;
    layer.closeStatusPicker?.(false);
    if (layer.host.querySelector(".db-date-value-popover")) closeActiveDateValuePicker(layer.overlay.ownerDocument);
    closeDropdownForRoot(layer.host, false);
    this.clearHover();
    layer.overlay.ownerDocument.defaultView?.removeEventListener("resize", layer.position);
    layer.overlay.remove();
    this.modalEl.inert = false;
    layer.anchor.setAttribute("aria-expanded", "false");
    layer.anchor.removeAttribute("aria-controls");
    if (restore && layer.anchor.isConnected) {
      layer.anchor.focus({ preventScroll: true });
      if (this.requestedFocus) this.refreshPending();
    }
  }

  private clearHover(): void {
    const hover = this.hoverParent.hoverPopover;
    this.hoverParent.hoverPopover = null;
    if (hover && "hide" in hover && typeof hover.hide === "function") Reflect.apply(hover.hide, hover, []);
    else if (hover) { hover.hoverEl.remove(); hover.unload(); }
  }

  private suspend(): void {
    this.closeDetail(false);
    this.clearHover();
    closeDropdownForRoot(this.contentEl, false);
    this.suspended = true;
    this.containerEl.addClass("db-ri-parked");
    this.app.keymap.popScope(this.scope);
  }

  private resume(refresh: boolean, key?: string): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.containerEl.removeClass("db-ri-parked");
    this.app.keymap.pushScope(this.scope);
    if (refresh) { this.refresh(true); this.focusRow(key); this.revealRequestedReminder(); }
  }

  private inspectRule(item: DueRecordReminder): void {
    if (this.updating || this.suspended) return;
    this.suspend();
    const back = (): void => { if (this.containerEl.isConnected) this.resume(true, item.key); };
    if (!this.openRuleConfig(item.databaseId, item.ruleId, back)) {
      back();
      new Notice(t("reminder.ruleUnavailable"));
    }
  }

  private getOriginalFile(item: DueRecordReminder) {
    const file = this.app.vault.getFileByPath(item.path);
    return file && this.service.isOriginalRecord(item, file) ? file : null;
  }

  private refreshChangedItem(item: DueRecordReminder): void {
    this.closeDetail(false);
    this.clearHover();
    this.refresh(true);
    this.focusRow(item.key);
    new Notice(t("reminder.itemChanged"));
  }

  private async openNote(item: DueRecordReminder): Promise<void> {
    if (this.updating || this.suspended) return;
    const file = this.getOriginalFile(item);
    if (!file) { this.refreshChangedItem(item); return; }
    const workspace = this.app.workspace;
    const origin = workspace.getMostRecentLeaf();
    this.suspend();
    const strip = this.containerEl.ownerDocument.body.createDiv({ cls: "db-ri-workspace-return" });
    const back = this.button(strip, t("reminder.backToInbox"), "arrow-left", "db-ri-return", true);
    const dismiss = this.button(strip, t("common.close"), "x", "db-ri-return-close");
    let settled = false;
    let target: WorkspaceLeaf | undefined;
    const cancelIfLeft = (): void => {
      if (!settled || !target || !this.suspended) return;
      let attached = false;
      workspace.iterateAllLeaves(leaf => { if (leaf === target) attached = true; });
      if (!attached || workspace.getMostRecentLeaf() !== target || target.view.getState().file !== file.path) this.close();
    };
    const refs = [workspace.on("active-leaf-change", leaf => {
      if (!settled && target && leaf && leaf !== target && isEditorLeaf(this.app, leaf)) this.close();
      else cancelIfLeft();
    }), workspace.on("file-open", cancelIfLeft), workspace.on("layout-change", cancelIfLeft)];
    const release = () => {
      for (const ref of refs) workspace.offref(ref);
      strip.remove();
      if (this.releaseReturn === release) {
        this.releaseReturn = undefined;
        this.returnFromNote = undefined;
      }
    };
    this.releaseReturn = release;
    dismiss.onclick = () => { if (this.releaseReturn === release) this.close(); };
    this.returnFromNote = back.onclick = () => {
      if (this.releaseReturn !== release) return;
      release();
      if (origin) workspace.iterateAllLeaves(leaf => { if (leaf === origin) workspace.setActiveLeaf(leaf, { focus: true }); });
      this.resume(true, item.key);
    };
    try {
      target = workspace.getLeavesOfType("markdown").find(leaf => leaf.view.getState().file === file.path) ?? workspace.getLeaf("tab");
      await target.openFile(file, { active: false });
      if (this.releaseReturn !== release || !this.suspended || !this.containerEl.isConnected) return;
      // The note may already be open in another Obsidian window.
      target.view.containerEl.ownerDocument.body.appendChild(strip);
      workspace.setActiveLeaf(target, { focus: true });
      settled = true;
    } catch {
      if (this.releaseReturn !== release || !this.suspended) return;
      release();
      this.resume(true, item.key);
      new Notice(t("reminder.noteUnavailable"));
    }
  }
}
