import { Modal, Notice, Scope, setIcon, setTooltip, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import type { DataSource, NoteRecord } from "../../data/DataSource";
import { getColumnOptions, normalizeOptionValueForKey } from "../../data/ColumnTypes";
import type { ColumnDef, DatabaseConfig } from "../../data/types";
import { generateId } from "../../data/types";
import {
  composeDateOnlyReminderTime, getRecordReminderOffsets, getRecordReminderRuleName, getRecordReminderRulePreview, getReminderRuleError, isReminderDateColumn, MAX_REMINDER_POINTS,
  mergeRecordReminderDraft, normalizeDateOnlyReminderTime, normalizeRecordReminderOffsets, normalizeReminderRuleName, prepareRecordReminderRules, REMINDER_RULE_NAME_LIMIT,
  RecordReminderRulesConflict, type RecordReminderRule, type RecordReminderSettings,
} from "../../data/RecordReminders";
import { withDatabaseSourceScope } from "../../data/SourceRules";
import { isImeComposing } from "../../data/KeyboardUtils";
import { getEffectiveLocale, t } from "../../i18n";
import { createDropdownField, closeDropdownForRoot, openDropdownMenu, type DropdownOption } from "../DropdownField";
import { isEditorLeaf } from "../DatabaseNoteReturn";
import { toPropertyDropdownOption } from "../PropertyTypeIcon";
import { createTimeSegments, readTimeSegmentInput } from "../TimeSegments";
import { renderButtonMenuIcon } from "../RecordButtonMenuIcons";
import type { RecordTitleIconDisplay } from "../RecordIconRenderer";
import { makeModalDraggable } from "./ModalDrag";
import { LiveReminderRuleDetails, REMINDER_PREVIEW_GROUPS } from "./LiveReminderRuleDetails";

const PRESETS = [-10080, -2880, -1440, -180, -60, -30, -15, 0];
const UNITS = [
  { value: "1", key: "reminder.unit.minutes", short: "m", english: "minute" },
  { value: "60", key: "reminder.unit.hours", short: "h", english: "hour" },
  { value: "1440", key: "reminder.unit.days", short: "d", english: "day" },
  { value: "10080", key: "reminder.unit.weeks", short: "w", english: "week" },
];
type TimeEditor = { id: string; replaced?: number; amount: string; unit: string; direction: string };
export interface ReminderRuleModalTarget { ruleId: string; onClose: () => void; }

function defaultCompletedValues(completion?: ColumnDef): string[] {
  if (!completion || completion.type === "checkbox") return [];
  const match = getColumnOptions(completion).find(o => /^(done|complete|completed|完成|已完成)$/i.test(o.value.trim()));
  return match ? [normalizeOptionValueForKey(completion.key, match.value)] : [];
}
function ruleIssueKey(rule: RecordReminderRule, db?: DatabaseConfig): string | undefined {
  const completion = db?.schema.columns.find(c => c.key === rule.completionField);
  if ((completion?.type === "status" || completion?.type === "select") && getColumnOptions(completion).length === 0) {
    return "reminder.noCompletionOptions";
  }
  switch (getReminderRuleError(rule, db)) {
    case "fields": return "reminder.invalid";
    case "unsupportedDate": return "reminder.unsupportedDate";
    case "completionValues": return "reminder.completionValuesChanged";
    case "time": return "reminder.invalidDateOnlyTime";
    case "advance": return "reminder.invalidAdvance";
  }
}
function displayOffset(offset: number, compact = false): string {
  if (!offset) return t(compact ? "reminder.atTimeChip" : "reminder.atTime");
  const magnitude = Math.abs(offset);
  const unit = [...UNITS].reverse().find(value => magnitude % Number(value.value) === 0) ?? UNITS[0];
  const amount = magnitude / Number(unit.value);
  const english = getEffectiveLocale() === "en";
  if (compact && english) return `${offset < 0 ? "−" : "+"}${amount}${unit.short}`;
  return t(offset < 0 ? "reminder.beforeOffset" : "reminder.afterOffset",
    { amount, unit: english ? unit.english + (amount === 1 ? "" : "s") : t(unit.key) });
}

export class RecordReminderSettingsModal extends Modal {
  private draft: RecordReminderRule[];
  private readonly initialRules: RecordReminderRule[];
  private readonly expanded = new Set<string>();
  private readonly cardHeaders = new Map<string, HTMLElement>();
  private readonly summaryObservers: ResizeObserver[] = [];
  private body!: HTMLElement;
  private footer!: HTMLElement;
  private editor?: TimeEditor;
  private renaming?: string;
  private details?: LiveReminderRuleDetails;
  private records?: NoteRecord[];
  private unsubscribeData?: () => void;
  private previewTimer?: number;
  private readonly previewRefreshers = new Set<() => void>();
  private db?: DatabaseConfig;
  private formSchemaSignature = "";
  private databaseName?: HTMLElement;
  private saving = false;
  private parked?: { button: HTMLButtonElement; origin: WorkspaceLeaf | null; cleanup?: () => void };
  constructor(app: App, private readonly source: DataSource, private readonly databaseId: string,
    private readonly settings: RecordReminderSettings, private readonly save: (draft: RecordReminderRule[], expected: readonly RecordReminderRule[]) => Promise<void>, private readonly changed: () => void,
    private readonly target?: ReminderRuleModalTarget, private readonly recordIcons?: RecordTitleIconDisplay) {
    super(app);
    this.initialRules = structuredClone(settings.rules.filter(rule => rule.databaseId === databaseId));
    this.draft = structuredClone(this.initialRules);
    const first = target?.ruleId ?? this.draft[0]?.id;
    if (first) this.expanded.add(first);
    this.scope = new Scope(this.scope);
    this.scope.register([], "Escape", event => {
      if (isImeComposing(event)) return;
      if (!closeDropdownForRoot(this.contentEl)) {
        if (this.details) this.details.escape();
        else if (this.editor || this.renaming) {
          const id = this.editor?.id ?? this.renaming!;
          this.editor = undefined; this.renaming = undefined; this.render(); this.focusRule(id);
        } else this.close();
      }
      return false;
    });
  }

  onOpen(): void {
    const root = this.contentEl;
    root.addClass("note-database-modal", "db-button-modal", "db-rr-content");
    this.modalEl.addClass("db-reminder-rules-editor");
    this.db = this.findDatabase();
    const stopRecords = this.source.onDataChanged(batch => {
      const dbPath = this.db?.baseThisFilePath;
      if (!dbPath || batch.changes.some(change => change.path === dbPath || change.oldPath === dbPath)) this.db = this.findDatabase();
      this.records = undefined;
      this.refreshAfterDatabaseChange();
    });
    const stopConfig = this.source.onViewConfigChanged(mutation => {
      if (mutation.dbId !== this.databaseId && mutation.dbPath !== this.db?.baseThisFilePath) return;
      this.db = this.findDatabase();
      this.records = undefined;
      this.refreshAfterDatabaseChange();
    });
    this.unsubscribeData = () => { stopRecords(); stopConfig(); };
    this.previewTimer = root.ownerDocument.defaultView?.setInterval(() => {
      if (!this.parked) this.refreshPreviews();
    }, 30000);
    const header = root.createDiv({ cls: "db-rr-head" });
    const heading = header.createEl("h3", { text: t("reminder.configureTitle") });
    makeModalDraggable(this, heading);
    if (this.db) {
      const context = header.createDiv({ cls: "db-rr-context" });
      context.createSpan({ text: t("reminder.currentDatabase") });
      const tag = context.createSpan({ cls: "db-button-summary-tag" });
      setIcon(tag.createSpan({ cls: "db-button-summary-tag-icon", attr: { "aria-hidden": "true" } }), "database");
      this.databaseName = tag.createSpan({ text: this.db.name, cls: "db-button-summary-tag-label" });
    }
    this.body = root.createDiv({ cls: "db-rr-body" });
    this.footer = root.createDiv({ cls: "db-rr-footer" });
    this.render();
    const id = this.target?.ruleId;
    if (id) root.ownerDocument.defaultView?.requestAnimationFrame(() => this.focusRule(id));
  }

  override close(): void {
    this.restoreAfterNote(false);
    super.close();
  }
  onClose(): void {
    if (this.previewTimer !== undefined) this.contentEl.ownerDocument.defaultView?.clearInterval(this.previewTimer);
    this.previewTimer = undefined;
    this.unsubscribeData?.();
    this.unsubscribeData = undefined;
    this.previewRefreshers.clear();
    this.records = undefined;
    this.disconnectSummaries();
    this.details?.close(false);
    closeDropdownForRoot(this.contentEl, false);
    this.contentEl.empty();
    this.target?.onClose();
  }

  private findDatabase(): DatabaseConfig | undefined {
    const entry = this.source.getViewDefFiles().find(item => item.config.id === this.databaseId);
    return entry ? withDatabaseSourceScope({ ...entry.config, baseThisFilePath: entry.file.path }) : undefined;
  }

  private button(parent: HTMLElement, label: string, onClick: () => void, cls?: string, icon?: string): HTMLButtonElement {
    const button = parent.createEl("button", { cls, attr: { type: "button" } });
    if (icon) setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), icon);
    button.createSpan({ text: label });
    button.onclick = onClick;
    return button;
  }

  private disconnectSummaries(): void { for (const observer of this.summaryObservers.splice(0)) observer.disconnect(); }

  private readFormSchemaSignature(): string {
    return this.db ? JSON.stringify(this.db.schema.columns.filter(column => isReminderDateColumn(column)
      || column.type === "checkbox" || column.type === "status" || column.type === "select")) : "";
  }

  private refreshAfterDatabaseChange(): void {
    this.databaseName?.setText(this.db?.name ?? "");
    if (this.parked) return;
    if (this.readFormSchemaSignature() === this.formSchemaSignature || this.details || this.renaming || this.editor) {
      this.refreshPreviews();
      return;
    }
    const active = this.contentEl.ownerDocument.activeElement;
    const id = active?.closest<HTMLElement>(".db-rr-card")?.dataset.reminderRuleId;
    this.render();
    if (id) this.focusRule(id);
  }

  private render(): void {
    this.formSchemaSignature = this.readFormSchemaSignature();
    this.previewRefreshers.clear();
    this.disconnectSummaries();
    closeDropdownForRoot(this.contentEl, false);
    const scrollTop = this.body.scrollTop;
    this.body.empty(); this.footer.empty(); this.cardHeaders.clear();
    const db = this.db;
    if (db) {
      this.body.createEl("h4", { text: t("reminder.ruleList"), cls: "db-rr-section-title" });
      const list = this.body.createDiv({ cls: "db-button-actions db-rr-list" });
      for (const rule of this.draft) this.renderRule(list, rule, db);
      if (!this.draft.length) list.createEl("p", { cls: "db-rr-muted", text: t("reminder.noRules") });
      const add = this.button(list, t("reminder.add"), () => this.addRule(db), "db-button-add db-rr-add", "plus");
      add.dataset.reminderControl = "add";
    } else this.body.createEl("p", { text: t("reminder.openDatabase") });
    const cancel = this.button(this.footer, t(this.target ? "reminder.backToInbox" : "common.cancel"), () => this.close());
    if (this.target) cancel.addClass("db-reminder-rules-back");
    const save = this.button(this.footer, t("common.save"), () => { void this.saveDraft(save); }, "mod-cta");
    save.disabled = !db || Boolean(this.editor) || Boolean(this.renaming);
    this.body.scrollTop = scrollTop;
  }

  private addRule(db: DatabaseConfig): void {
    const fields = db.schema.columns.filter(isReminderDateColumn);
    const completion = db.schema.columns.find(col => col.type === "checkbox" || col.type === "status" || col.type === "select");
    const unused = fields.find(col => !this.draft.some(rule => rule.dateField === col.key));
    const rule: RecordReminderRule = {
      id: generateId(), databaseId: db.id, enabled: true, dateField: (unused ?? fields[0])?.key ?? "",
      completionField: completion?.key ?? "", completedValues: defaultCompletedValues(completion),
      advanceMinutes: 0, offsets: [0], dateOnlyTime: "09:00",
    };
    this.draft.push(rule);
    this.expanded.add(rule.id);
    this.render(); this.focusRule(rule.id);
  }

  private removeRule(id: string): void {
    this.draft = this.draft.filter(rule => rule.id !== id);
    this.expanded.delete(id);
    if (this.renaming === id) this.renaming = undefined;
    if (this.editor?.id === id) this.editor = undefined;
  }

  private focusRule(id: string): void {
    const elem = this.cardHeaders.get(id);
    elem?.scrollIntoView({ block: "nearest" });
    elem?.focus({ preventScroll: true });
  }

  private async saveDraft(button: HTMLButtonElement): Promise<void> {
    if (this.saving || this.editor || this.renaming) return;
    const db = this.findDatabase();
    if (!db) { new Notice(t("reminder.openDatabase")); return; }
    this.db = db;
    const latest = structuredClone(this.settings.rules.filter(rule => rule.databaseId === this.databaseId));
    let draft: RecordReminderRule[];
    try { draft = mergeRecordReminderDraft(this.initialRules, this.draft, latest); }
    catch (error) {
      if (!(error instanceof RecordReminderRulesConflict)) throw error;
      new Notice(t("reminder.rulesConflict")); return;
    }
    for (const rule of draft) {
      if (!rule.enabled) continue;
      const issue = ruleIssueKey(rule, db);
      if (issue) {
        this.expanded.add(rule.id); this.render(); this.focusRule(rule.id);
        if (issue === "reminder.invalidDateOnlyTime") {
          this.cardHeaders.get(rule.id)?.closest(".db-rr-card")
            ?.querySelector<HTMLInputElement>(".db-rr-date-time .db-hour-seg")?.focus();
        } else new Notice(t(issue));
        return;
      }
    }
    this.saving = true; button.disabled = true;
    try { await this.save(draft, latest); }
    catch (error) {
      new Notice(error instanceof RecordReminderRulesConflict ? t("reminder.rulesConflict") : t("errors.updateFailed", { error: String(error) }));
      this.saving = false; button.disabled = false;
      return;
    }
    this.saving = false;
    this.changed();
    if (this.containerEl.isConnected) this.close();
  }

  private field(parent: HTMLElement, label: string, labelId?: string): HTMLElement {
    const row = parent.createDiv({ cls: "db-rr-field" });
    row.createSpan({ cls: "db-modal-label", text: label, attr: labelId ? { id: labelId } : undefined });
    return row.createDiv({ cls: "db-rr-control" });
  }

  private select(parent: HTMLElement, label: string, options: DropdownOption[], current: string, change: (value: string) => void): void {
    createDropdownField({ parent, label, value: current, options, hideLabel: true, bottomBoundary: this.footer,
      popoverClassName: "db-button-menu-popover", renderIcon: renderButtonMenuIcon, placeholder: t("reminder.selectProperty"),
      onChange: change });
  }

  private renderRule(list: HTMLElement, rule: RecordReminderRule, db: DatabaseConfig): void {
    const card = list.createDiv({ cls: "db-button-action db-rr-card" });
    card.dataset.reminderRuleId = rule.id;
    const open = this.expanded.has(rule.id);
    card.toggleClass("is-folded", !open);
    const header = card.createDiv({ cls: "db-button-action-heading db-rr-card-head" });
    const name = getRecordReminderRuleName(rule, db) || t("reminder.rule");
    const dates = db.schema.columns.filter(isReminderDateColumn);
    const dateColumn = dates.find(col => col.key === rule.dateField);
    const toggle = header.createEl("button", { cls: "db-rr-toggle", attr: { type: "button", "aria-expanded": String(open) } });
    this.cardHeaders.set(rule.id, toggle);
    setIcon(toggle.createSpan({ cls: "db-rr-chevron", attr: { "aria-hidden": "true" } }), open ? "chevron-down" : "chevron-right");
    const icon = toPropertyDropdownOption(dateColumn ?? { key: "date", label: "", type: "datetime" }).icon;
    if (icon) renderButtonMenuIcon(toggle.createSpan({ cls: "db-button-action-icon", attr: { "aria-hidden": "true" } }), icon);
    const identity = toggle.createSpan({ cls: "db-rr-identity", attr: { title: name } });
    identity.createSpan({ cls: "db-button-action-name", text: name });
    if (!open) {
      const offsets = getRecordReminderOffsets(rule);
      this.renderOffsetSummary(toggle, offsets.map(offset => displayOffset(offset, true)), offsets.map(offset => displayOffset(offset)));
    }
    const state = toggle.createSpan({ cls: `db-rr-rule-state${rule.enabled ? " is-active" : " is-paused"}` });
    setIcon(state.createSpan({ attr: { "aria-hidden": "true" } }), rule.enabled ? "bell" : "pause");
    state.createSpan({ text: t(rule.enabled ? "reminder.ruleStateActive" : "reminder.ruleStatePaused") });
    toggle.onclick = () => {
      if (open) {
        this.expanded.delete(rule.id);
        if (this.renaming === rule.id) this.renaming = undefined;
        if (this.editor?.id === rule.id) this.editor = undefined;
      } else this.expanded.add(rule.id);
      this.render(); this.focusRule(rule.id);
    };
    const actions = header.createEl("button", { cls: "db-button-quiet-icon", attr: {
      type: "button", "aria-label": t("reminder.ruleActions", { name }), "aria-haspopup": "listbox", "aria-expanded": "false",
    } });
    setIcon(actions, "more-horizontal");
    actions.onclick = () => this.menu(actions, t("reminder.rule"), [
      { value: "rename", text: t("reminder.renameRule"), icon: "pencil" },
      { value: "enable", text: t(rule.enabled ? "reminder.disableRule" : "reminder.enableRule"), icon: rule.enabled ? "bell-off" : "bell" },
      { value: "remove", text: t("common.delete"), icon: "trash-2" },
    ], action => {
      if (action === "remove") this.removeRule(rule.id);
      else {
        if (action === "rename") { this.expanded.add(rule.id); this.renaming = rule.id; }
        else if (action === "enable") rule.enabled = !rule.enabled;
        if (this.editor?.id === rule.id) this.editor = undefined;
      }
      this.render();
      if (action === "rename") this.body.querySelector<HTMLInputElement>(".db-rr-name")?.focus();
      else if (action === "remove") this.body.querySelector<HTMLElement>("[data-reminder-control=add]")?.focus();
      else this.focusRule(rule.id);
    });
    if (!rule.enabled) card.addClass("is-disabled");
    if (!open) return;
    if (this.renaming === rule.id) this.renderName(card, rule, name);
    const form = card.createDiv({ cls: "db-rr-form" });
    const dateLabel = t("reminder.dateField");
    this.select(this.field(form, dateLabel), dateLabel, dates.map(col => toPropertyDropdownOption(col)), rule.dateField,
      value => { rule.dateField = value; this.render(); this.focusRule(rule.id); });
    const timeRow = this.field(form, t("reminder.advance"));
    this.renderOffsets(timeRow, rule);
    let refreshFeedback = (): void => {};
    if (dateColumn?.type === "date") this.renderDateOnlyTime(form, rule, () => refreshFeedback());
    const completionFields = db.schema.columns.filter(col => col.type === "checkbox" || col.type === "status" || col.type === "select");
    const completion = completionFields.find(col => col.key === rule.completionField);
    const completionLabel = t("reminder.completionField");
    this.select(this.field(form, completionLabel), completionLabel, completionFields.map(col => toPropertyDropdownOption(col)), rule.completionField, value => {
      rule.completionField = value; rule.completedValues = defaultCompletedValues(completionFields.find(col => col.key === value));
      this.render(); this.focusRule(rule.id);
    });
    if (completion && completion.type !== "checkbox") {
      const chips = this.field(form, t("reminder.excludedStatuses"));
      chips.addClass("db-rr-status");
      const options = getColumnOptions(completion);
      const identityFor = (value: string) => normalizeOptionValueForKey(completion.key, value);
      const valid = new Set(options.map(option => identityFor(option.value)));
      for (const option of options) {
        const identity = identityFor(option.value);
        const active = rule.completedValues.some(value => identityFor(value) === identity);
        const button = chips.createEl("button", { cls: "db-rr-status-chip", attr: { type: "button", "aria-pressed": String(active), title: option.value } });
        const badge = button.createSpan({ cls: `status-badge ${active ? `status-color-${option.color || "gray"}` : "is-neutral"}` });
        if (active) setIcon(badge.createSpan({ attr: { "aria-hidden": "true" } }), "check");
        else badge.createSpan({ cls: `db-rr-status-dot db-option-color-${option.color || "gray"}`, attr: { "aria-hidden": "true" } });
        badge.createSpan({ cls: "db-rr-status-label", text: option.value });
        button.onclick = () => {
          const selected = new Set(rule.completedValues.map(identityFor).filter(value => value && valid.has(value)));
          if (active) selected.delete(identity);
          else selected.add(identity);
          rule.completedValues = [...selected];
          this.render();
          const wrapper = Array.from(this.body.querySelectorAll<HTMLElement>("[data-reminder-rule-id]")).find(el => el.dataset.reminderRuleId === rule.id);
          Array.from(wrapper?.querySelectorAll<HTMLButtonElement>(".db-rr-status-chip") ?? []).find(el => el.textContent === option.value)?.focus();
        };
      }
    }
    if (!rule.enabled) {
      card.createEl("p", { cls: "db-rr-muted", text: t("reminder.ruleDisabled") });
      return;
    }
    const warning = card.createEl("p", { cls: "db-rr-error" });
    const preview = this.renderPreview(card, rule, name);
    refreshFeedback = () => {
      const issue = ruleIssueKey(rule, this.db);
      // Time errors already appear beside the input.
      const message = issue && issue !== "reminder.invalidDateOnlyTime" ? t(issue) : "";
      warning.hidden = !message;
      warning.setText(message);
      preview(!issue);
    };
    this.previewRefreshers.add(refreshFeedback);
    refreshFeedback();
  }

  private refreshPreviews(): void {
    for (const refresh of this.previewRefreshers) refresh();
    this.details?.refresh();
  }

  private renderDateOnlyTime(form: HTMLElement, rule: RecordReminderRule, refreshFeedback: () => void): void {
    const id = `db-rr-time-${generateId()}`;
    const wrapper = this.field(form, t("reminder.dateOnlyTime"), `${id}-label`);
    const row = wrapper.createDiv({ cls: "db-rr-date-time-row" });
    const group = row.createDiv({ cls: "db-rr-date-time", attr: {
      role: "group", "aria-labelledby": `${id}-label`, "aria-describedby": `${id}-hint`,
    } });
    const { hour, minute } = createTimeSegments(group);
    const [initialHour = "", initialMinute = ""] = (normalizeDateOnlyReminderTime(rule.dateOnlyTime) ?? rule.dateOnlyTime).split(":");
    hour.value = initialHour;
    minute.value = initialMinute;
    row.createSpan({ cls: "db-rr-muted", text: t("reminder.dateOnlyTimeHint"), attr: { id: `${id}-hint` } });
    const error = wrapper.createEl("p", { cls: "db-rr-error db-rr-date-time-error", attr: { id: `${id}-error`, "aria-live": "polite" } });

    const showError = (invalid: boolean): void => {
      group.toggleClass("is-invalid", invalid);
      hour.setAttribute("aria-invalid", String(invalid && !composeDateOnlyReminderTime(hour.value, "00")));
      minute.setAttribute("aria-invalid", String(invalid && !composeDateOnlyReminderTime("00", minute.value)));
      error.setText(invalid ? t("reminder.invalidDateOnlyTime") : "");
    };
    const updateDraft = (): string | undefined => {
      const time = composeDateOnlyReminderTime(hour.value, minute.value);
      rule.dateOnlyTime = time ?? `${hour.value}:${minute.value}`;
      return time;
    };
    const validate = (): void => {
      const time = updateDraft();
      if (time) {
        const [hh, mm] = time.split(":");
        if (hour.value !== hh) hour.value = hh;
        if (minute.value !== mm) minute.value = mm;
      }
      showError(!time);
      refreshFeedback();
    };
    const selectSegment = (input: HTMLInputElement): void => { input.focus(); input.select(); };
    for (const input of [hour, minute]) {
      input.setAttribute("aria-describedby", error.id);
      input.onfocus = () => input.select();
      input.oninput = () => {
        const { text, complete } = readTimeSegmentInput(input.value, input === hour ? "hour" : "minute");
        if (input.value !== text) input.value = text;
        const valid = Boolean(updateDraft());
        if (valid || group.hasClass("is-invalid")) showError(!valid);
        if (input === hour && complete) selectSegment(minute);
      };
      input.onkeydown = event => {
        if (isImeComposing(event) || event.altKey || event.ctrlKey || event.metaKey) return;
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
        const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
        if (event.key === "Enter") {
          event.preventDefault();
          validate();
        } else if (event.key === ":" || event.key === "：") {
          event.preventDefault();
          if (input === hour) selectSegment(minute);
        } else if (!event.shiftKey && ((input === hour && event.key === "ArrowRight" && atEnd)
          || (input === minute && ((event.key === "ArrowLeft" && atStart) || (event.key === "Backspace" && !input.value))))) {
          event.preventDefault();
          selectSegment(input === hour ? minute : hour);
        }
      };
      input.onpaste = event => {
        const pasted = event.clipboardData?.getData("text").trim() ?? "";
        if (/^\d{1,2}$/.test(pasted)) return; // Native replacement of a single segment.
        event.preventDefault();
        const pair = /^(\d{1,2})[:：]?(\d{2})$/.exec(pasted);
        if (!pair) return;
        hour.value = pair[1];
        minute.value = pair[2];
        validate();
      };
    }
    group.addEventListener("focusout", event => {
      if (event.relatedTarget !== hour && event.relatedTarget !== minute) validate();
    });
    showError(!composeDateOnlyReminderTime(hour.value, minute.value));
  }

  private renderName(card: HTMLElement, rule: RecordReminderRule, placeholder: string): void {
    const row = card.createDiv({ cls: "db-rr-name-row" });
    const input = row.createEl("input", { cls: "db-rr-name", type: "text", value: rule.name ?? "", attr: {
      "aria-label": t("reminder.ruleName"), maxlength: String(REMINDER_RULE_NAME_LIMIT), placeholder,
    } });
    const apply = (): void => { rule.name = normalizeReminderRuleName(input.value); this.renaming = undefined; this.render(); this.focusRule(rule.id); };
    input.onkeydown = event => {
      if (event.key === "Enter" && !isImeComposing(event)) { event.preventDefault(); apply(); }
    };
    this.button(row, t("common.cancel"), () => { this.renaming = undefined; this.render(); this.focusRule(rule.id); });
    this.button(row, t("reminder.apply"), apply);
  }

  private renderOffsetSummary(toggle: HTMLElement, labels: string[], accessibleLabels: string[]): void {
    toggle.setAttribute("aria-description", accessibleLabels.join(", "));
    const outer = toggle.createSpan({ cls: "db-rr-offset-summary", attr: { "aria-hidden": "true" } });
    const visible = outer.createSpan({ cls: "db-rr-offset-strip" });
    const measure = outer.createSpan({ cls: "db-rr-offset-strip db-rr-offset-probe" });
    const probes = labels.map(text => measure.createSpan({ text }));
    const extra = labels.map((_, i) => measure.createSpan({ text: `+${i + 1}` }));
    const win = outer.ownerDocument.defaultView!;
    let last = -1;
    const update = (): void => {
      const space = visible.clientWidth;
      const gap = 7;
      let width = 0;
      let fit = 0;
      for (let i = 0; i <= labels.length; i++) {
        const remainder = labels.length - i;
        if (width + (remainder ? (i ? gap : 0) + extra[remainder - 1].getBoundingClientRect().width : 0) <= space) fit = i;
        if (i < probes.length) width += probes[i].getBoundingClientRect().width + (i ? gap : 0);
      }
      if (last === fit) return;
      last = fit; visible.empty();
      for (const label of labels.slice(0, fit)) visible.createSpan({ text: label });
      if (fit < labels.length) visible.createSpan({ text: `+${labels.length - fit}` });
    };
    const observer = new win.ResizeObserver(update);
    observer.observe(outer); observer.observe(measure); this.summaryObservers.push(observer); update();
  }

  private menu(anchor: HTMLElement, label: string, options: DropdownOption[], choose: (value: string) => void): void {
    const wasOpen = anchor.getAttribute("aria-expanded") === "true";
    closeDropdownForRoot(this.contentEl, false);
    if (wasOpen) return;
    openDropdownMenu({ anchor, label, options, value: "", bottomBoundary: this.footer, popoverClassName: "db-button-menu-popover",
      onClose: () => anchor.setAttribute("aria-expanded", "false"), onChange: choose });
    anchor.setAttribute("aria-expanded", "true");
  }

  private renderOffsets(parent: HTMLElement, rule: RecordReminderRule): void {
    const offsets = getRecordReminderOffsets(rule);
    const chips = parent.createDiv({ cls: "db-rr-time-points" });
    const set = (offset: number, old?: number): void => {
      rule.offsets = normalizeRecordReminderOffsets([...offsets.filter(value => value !== old), offset]);
      this.editor = undefined; this.render(); this.focusRule(rule.id);
    };
    const open = (anchor: HTMLElement, replaced?: number): void => {
      const options = PRESETS.map(value => ({
        value: String(value), text: displayOffset(value), disabled: offsets.includes(value) && value !== replaced,
      }));
      this.menu(anchor, t("reminder.advance"), [...options, { value: "custom", text: t("reminder.customTime"), icon: "clock" }], value => {
        if (value !== "custom") { set(Number(value), replaced); return; }
        const amount = Math.abs(replaced || 30);
        const unit = [...UNITS].reverse().find(item => amount % Number(item.value) === 0) ?? UNITS[0];
        this.editor = { id: rule.id, replaced, unit: unit.value, amount: String(amount / Number(unit.value)), direction: replaced && replaced > 0 ? "after" : "before" };
        this.render();
        this.body.querySelector<HTMLInputElement>(".db-rr-amount")?.focus();
      });
    };
    for (const offset of offsets) {
      const shell = chips.createSpan({ cls: "db-button-value-chip db-rr-chip" });
      const text = displayOffset(offset);
      const chip = this.button(shell, displayOffset(offset, true), () => open(chip, offset), "db-rr-chip-text");
      chip.setAttribute("aria-label", text);
      chip.setAttribute("aria-haspopup", "listbox");
      if (chip.textContent !== text) setTooltip(chip, text, { delay: 250 });
      const del = shell.createEl("button", { cls: "db-rr-chip-remove", attr: { type: "button", "aria-label": t("reminder.removeTime", { time: text }) } });
      setIcon(del, "x");
      del.disabled = offsets.length <= 1;
      del.onclick = () => { rule.offsets = offsets.filter(value => value !== offset); this.editor = undefined; this.render(); this.focusRule(rule.id); };
    }
    const add = this.button(chips, t("reminder.addTime"), () => open(add), "db-rr-time-add", "plus");
    add.setAttribute("aria-haspopup", "listbox");
    add.disabled = offsets.length >= MAX_REMINDER_POINTS;
    const edit = this.editor;
    if (!edit || edit.id !== rule.id) return;
    const editor = parent.createDiv({ cls: "db-button-property-action db-rr-custom" });
    const fields = editor.createDiv({ cls: "db-rr-custom-fields" });
    let update = (): void => {};
    this.select(fields, t("reminder.relativeTime"), [{ value: "before", text: t("reminder.beforeTime") }, { value: "after", text: t("reminder.afterTime") }],
      edit.direction, value => { edit.direction = value; update(); });
    const amount = fields.createEl("input", { cls: "db-rr-amount", type: "number", value: edit.amount,
      attr: { "aria-label": t("reminder.amount"), min: "1", step: "1", inputmode: "numeric" } });
    this.select(fields, t("reminder.timeUnit"), UNITS.map(item => ({ value: item.value, text: t(item.key) })), edit.unit,
      value => { edit.unit = value; update(); });
    const error = editor.createDiv({ cls: "db-rr-error", attr: { "aria-live": "polite" } });
    const controls = editor.createDiv({ cls: "db-rr-custom-actions" });
    const read = () => (/^\d+$/.test(amount.value.trim()) ? Number(amount.value) * Number(edit.unit) * (edit.direction === "before" ? -1 : 1) : NaN);
    this.button(controls, t("common.cancel"), () => { this.editor = undefined; this.render(); this.focusRule(rule.id); });
    const apply = this.button(controls, t("reminder.apply"), () => set(read(), edit.replaced));
    update = () => {
      const value = read();
      const duplicate = offsets.includes(value) && value !== edit.replaced;
      const valid = value !== 0 && normalizeRecordReminderOffsets([value]).length > 0;
      error.setText(duplicate ? t("reminder.duplicateTime") : valid ? "" : t("reminder.invalidCustomTime"));
      apply.disabled = duplicate || !valid;
    };
    amount.oninput = () => { edit.amount = amount.value; update(); };
    amount.onkeydown = event => {
      if (event.key === "Enter" && !isImeComposing(event) && !apply.disabled) { event.preventDefault(); apply.click(); }
    };
    update();
  }

  private renderPreview(card: HTMLElement, rule: RecordReminderRule, name: string): (visible: boolean) => void {
    const calculate = () => {
      const db = this.db;
      if (!db) return { now: [], skipped: [], later: [], excluded: [] };
      const now = Date.now();
      this.records ??= this.source.getRecordsForDatabase(db);
      const [previewRule] = prepareRecordReminderRules([rule], this.settings.rules, now);
      return getRecordReminderRulePreview(previewRule, db, this.records, now);
    };
    const footer = card.createDiv({ cls: "db-rr-preview-row" });
    const summary = footer.createDiv({ cls: "db-rr-muted db-rr-preview-counts" });
    summary.createEl("strong", { text: t("reminder.previewTitle") });
    const counts = summary.createSpan();
    const separator = getEffectiveLocale() === "en" ? ", " : "、";
    const button = this.button(footer, t("reminder.inspectPreview"), () => {
      if (footer.hidden) return;
      this.records = undefined;
      this.refreshPreviews();
      this.details?.close(false);
      this.details = new LiveReminderRuleDetails(this.app, this.containerEl, this.modalEl, button, name, calculate,
        this.recordIcons, file => this.openPreviewNote(file), () => {
          this.details = undefined;
          if (this.previewRefreshers.size) this.refreshAfterDatabaseChange();
        });
    }, "db-rr-preview-link");
    button.setAttribute("aria-haspopup", "dialog");
    return visible => {
      if (visible) {
        const next = calculate();
        counts.setText(REMINDER_PREVIEW_GROUPS.map(id => `${t(`reminder.preview.${id}`)} ${next[id].length}`).join(separator));
      }
      footer.hidden = !visible;
    };
  }

  private async openPreviewNote(file: TFile): Promise<void> {
    if (!this.details || this.parked) return;
    const workspace = this.app.workspace;
    const strip = this.containerEl.ownerDocument.body.createDiv({ cls: "db-ri-workspace-return" });
    const back = this.button(strip, t("reminder.backToPreview"), () => this.restoreAfterNote(true), "db-ri-return", "arrow-left");
    this.parked = { button: back, origin: workspace.getMostRecentLeaf() };
    this.details.suspend();
    this.containerEl.addClass("db-ri-parked");
    this.app.keymap.popScope(this.scope);
    const placeStrip = (doc: Document) => {
      const parked = this.parked;
      if (parked?.button !== back) return;
      parked.cleanup?.();
      doc.body.appendChild(strip);
      if (doc === this.containerEl.ownerDocument) { parked.cleanup = undefined; return; }
      const onWindowClose = () => {
        if (this.parked?.button === back) this.restoreAfterNote(true);
      };
      const win = doc.defaultView;
      win?.addEventListener("pagehide", onWindowClose, { once: true });
      parked.cleanup = () => win?.removeEventListener("pagehide", onWindowClose);
    };
    let interrupted = false;
    let pending: ReturnType<typeof workspace.on> | undefined;
    try {
      const leaf = workspace.getLeavesOfType("markdown").find(candidate => candidate.view.getState().file === file.path)
        ?? workspace.getLeaf("tab");
      pending = workspace.on("active-leaf-change", active => {
        if (!active || active === leaf || this.parked?.button !== back || !isEditorLeaf(this.app, active)) return;
        interrupted = true;
        placeStrip(active.view.containerEl.ownerDocument);
      });
      await leaf.openFile(file, { active: false });
      if (this.parked?.button !== back || interrupted) return;
      placeStrip(leaf.view.containerEl.ownerDocument);
      workspace.setActiveLeaf(leaf, { focus: true });
    } catch {
      if (this.parked?.button !== back || interrupted) return;
      this.restoreAfterNote(true);
      new Notice(t("reminder.noteUnavailable"));
    } finally {
      if (pending) workspace.offref(pending);
    }
  }

  private restoreAfterNote(restore: boolean): void {
    const saved = this.parked;
    if (!saved) return;
    this.parked = undefined;
    saved.cleanup?.();
    saved.button.parentElement?.remove();
    this.containerEl.removeClass("db-ri-parked");
    this.app.keymap.pushScope(this.scope);
    if (restore) {
      this.app.workspace.iterateAllLeaves(leaf => { if (leaf === saved.origin) this.app.workspace.setActiveLeaf(leaf, { focus: true }); });
      this.records = undefined;
      this.refreshPreviews();
      this.details?.resume();
    }
  }
}
