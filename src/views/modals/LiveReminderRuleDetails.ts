import { Component, Notice, setIcon, type App, type HoverParent, type TFile } from "obsidian";
import { getReminderPreviewFile, type ReminderPreviewGroup, type ReminderRulePreviewRow } from "../../data/RecordReminders";
import { getEffectiveLocale, t } from "../../i18n";
import { isElement } from "../DomGuards";
import { installNoteHoverPreview, markNoteHoverLink } from "../HoverLinkPreview";
import { positionToolbarPopover } from "../PopoverPosition";
import { renderReadonlyRecordTitleIcon, type RecordTitleIconDisplay } from "../RecordIconRenderer";

export const REMINDER_PREVIEW_GROUPS: ReminderPreviewGroup[] = ["now", "skipped", "later", "excluded"];
type Results = Record<ReminderPreviewGroup, ReminderRulePreviewRow[]>;

export class LiveReminderRuleDetails {
  private readonly overlay: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly host: HTMLElement;
  private readonly tabs = new Map<ReminderPreviewGroup, HTMLButtonElement>();
  private readonly duplicated = new Set<string>();
  private readonly lifecycle = new Component();
  private readonly hoverParent: HoverParent = { hoverPopover: null };
  private readonly hoverRows = new WeakMap<HTMLElement, ReminderRulePreviewRow>();
  private readonly formatter = new Intl.DateTimeFormat(getEffectiveLocale(), { dateStyle: "medium", timeStyle: "short" });
  private readonly win: Window;
  private activeGroup: ReminderPreviewGroup = "now";
  private event?: { card: HTMLElement; anchor: HTMLButtonElement; launch: HTMLButtonElement };
  private result: Results;
  private parked = false;
  private closed = false;

  constructor(private readonly app: App, container: HTMLElement, private readonly modal: HTMLElement, private readonly anchor: HTMLButtonElement,
    name: string, private readonly readResult: () => Results, private readonly recordIcons: RecordTitleIconDisplay | undefined,
    private readonly openNote: (file: TFile) => Promise<void>, private readonly afterClose: () => void) {
    this.win = container.ownerDocument.defaultView!;
    this.overlay = container.createDiv({ cls: "db-rr-details-overlay" });
    this.panel = this.overlay.createEl("section", { cls: "db-relation-popover db-rr-details", attr: {
      id: "db-rr-rule-details", role: "dialog", "aria-modal": "true", "aria-labelledby": "db-rr-rule-details-title",
    } });
    const header = this.panel.createDiv({ cls: "db-rr-details-head" });
    header.createEl("h4", { text: t("reminder.previewDetailsTitle"), attr: { id: "db-rr-rule-details-title" } });
    const close = this.iconButton(header, "x", t("common.close"));
    close.onclick = () => this.close();
    this.panel.createEl("p", { cls: "db-rr-muted", text: t("reminder.previewScope", { name }) });
    this.search = this.panel.createEl("input", { cls: "db-cell-option-search db-rr-details-search", type: "search",
      attr: { "aria-label": t("reminder.previewSearch"), placeholder: t("reminder.previewSearch") } });
    this.search.oninput = () => this.render();
    const frame = this.panel.createDiv({ cls: "db-rr-details-frame" });
    const tabs = frame.createDiv({ cls: "db-rr-details-tabs", attr: { role: "group", "aria-label": t("reminder.previewTitle") } });
    for (const id of REMINDER_PREVIEW_GROUPS) {
      const button = tabs.createEl("button", { attr: { type: "button" } });
      button.onclick = () => { this.activeGroup = id; this.render(); };
      this.tabs.set(id, button);
    }
    this.list = frame.createDiv({ cls: "db-rr-details-list" });
    this.host = this.overlay.createDiv({ cls: "note-database-container db-ri-event-host db-rr-event-host" });
    this.overlay.onmousedown = event => {
      if (event.target === this.overlay) { if (this.event) this.closeEvent(true); else this.close(); }
      else if (this.event && isElement(event.target) && !this.event.card.contains(event.target) && !this.event.anchor.contains(event.target)) {
        this.closeEvent(false);
      }
    };
    this.panel.onkeydown = this.trapTab;
    this.list.addEventListener("scroll", this.repositionEvent, { passive: true });
    this.win.addEventListener("resize", this.place);
    this.lifecycle.load();
    installNoteHoverPreview(this.lifecycle, this.overlay, this.app, this.hoverParent, target => {
      const row = this.hoverRows.get(target);
      return !!row && this.getOriginalFile(row)?.path === row.path;
    });
    const observer = new MutationObserver(() => this.hoverParent.hoverPopover?.hoverEl.addClass("db-ri-note-hover"));
    observer.observe(container.ownerDocument.body, { childList: true });
    this.lifecycle.register(() => observer.disconnect());
    this.result = this.readResult();
    this.updateDuplicateNames();
    this.modal.inert = true;
    this.anchor.setAttribute("aria-expanded", "true");
    this.anchor.setAttribute("aria-controls", this.panel.id);
    this.render(); this.place();
    (this.win.matchMedia("(pointer: coarse)").matches ? close : this.search).focus({ preventScroll: true });
  }

  private updateDuplicateNames(): void {
    this.duplicated.clear();
    const names = new Map<string, string>();
    for (const row of Object.values(this.result).flat()) {
      if (names.has(row.title) && names.get(row.title) !== row.path) this.duplicated.add(row.title);
      names.set(row.title, row.path);
    }
  }

  refresh(): void {
    const next = this.readResult();
    if (JSON.stringify(next) === JSON.stringify(this.result) &&
        REMINDER_PREVIEW_GROUPS.every(id => next[id].every((row, index) => getReminderPreviewFile(row) === getReminderPreviewFile(this.result[id][index])))) return;
    const focus = this.panel.ownerDocument.activeElement;
    const restoreFocus = Boolean(focus && (this.list.contains(focus) || this.event?.card.contains(focus)));
    const scroll = this.list.scrollTop;
    this.result = next;
    this.updateDuplicateNames();
    this.render();
    this.list.scrollTop = scroll;
    if (restoreFocus) this.search.focus({ preventScroll: true });
  }

  escape(): void {
    if (this.hoverParent.hoverPopover) this.clearHover();
    else if (this.event) this.closeEvent(true);
    else if (this.search.value) { this.search.value = ""; this.render(); this.search.focus({ preventScroll: true }); }
    else this.close();
  }
  suspend(): void { this.parked = true; this.clearHover(); }
  resume(): void {
    this.parked = false; this.place();
    (this.event?.launch ?? this.search).focus({ preventScroll: true });
  }
  close(restore = true): void {
    if (this.closed) return;
    this.closed = true;
    this.closeEvent(false);
    this.clearHover();
    this.win.removeEventListener("resize", this.place);
    this.lifecycle.unload();
    this.overlay.remove();
    this.modal.inert = false;
    this.anchor.removeAttribute("aria-controls");
    this.anchor.setAttribute("aria-expanded", "false");
    if (restore && this.anchor.isConnected) this.anchor.focus({ preventScroll: true });
    this.afterClose();
  }

  private iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
    const el = parent.createEl("button", { cls: "db-board-card-open db-rr-details-icon", attr: { type: "button", "aria-label": label, title: label } });
    setIcon(el, icon);
    return el;
  }

  private directory(row: ReminderRulePreviewRow): string {
    return this.duplicated.has(row.title) && row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : "";
  }

  private render(): void {
    this.closeEvent(false);
    this.clearHover();
    const words = this.search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const results = (id: ReminderPreviewGroup): ReminderRulePreviewRow[] => this.result[id].filter(row => {
      const text = `${row.title} ${this.directory(row)}`.toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
    for (const id of REMINDER_PREVIEW_GROUPS) {
      const button = this.tabs.get(id)!;
      const total = this.result[id].length;
      button.setText(`${t(`reminder.preview.${id}`)} ${words.length ? `${results(id).length}/${total}` : total}`);
      button.setAttribute("aria-pressed", String(id === this.activeGroup));
    }
    const rows = results(this.activeGroup);
    this.list.empty();
    if (rows.length && this.activeGroup === "skipped") this.list.createEl("p", { text: t("reminder.reason.beforeActivation"), cls: "db-rr-muted" });
    if (!rows.length) this.list.createEl("p", { text: t(words.length ? "common.noResults" : "reminder.previewEmpty"), cls: "db-rr-muted", attr: { role: "status" } });
    const list = this.list.createEl("ul");
    for (const row of rows) {
      const entry = list.createEl("li");
      const button = entry.createEl("button", { cls: "db-rr-detail-row", attr: { type: "button", "aria-expanded": "false", "aria-controls": "db-rr-preview-event" } });
      setIcon(button.createSpan({ cls: "db-rr-detail-file", attr: { "aria-hidden": "true" } }), "file-text");
      const identity = button.createSpan({ cls: "db-rr-detail-label" });
      const title = identity.createEl("strong", { text: row.title });
      markNoteHoverLink(title, row.path, row.path);
      this.hoverRows.set(title, row);
      const directory = this.directory(row);
      if (directory) identity.createSpan({ text: directory, attr: { title: directory } });
      if (row.reminderAt !== undefined || row.dueAt !== undefined) {
        button.createSpan({ cls: "db-rr-detail-time", text: this.formatter.format(row.reminderAt ?? row.dueAt) });
      }
      setIcon(button.createSpan({ cls: "db-rr-detail-file", attr: { "aria-hidden": "true" } }), "chevron-right");
      button.onclick = event => {
        if (event.ctrlKey || event.metaKey) return;
        if (this.event?.anchor === button) this.closeEvent(true); else this.openEvent(button, row);
      };
    }
  }

  private getOriginalFile(row: ReminderRulePreviewRow): TFile | undefined {
    const file = getReminderPreviewFile(row);
    return file && this.app.vault.getFileByPath(file.path) === file ? file : undefined;
  }

  private openEvent(anchor: HTMLButtonElement, row: ReminderRulePreviewRow): void {
    const file = this.getOriginalFile(row);
    if (!file) { this.refresh(); new Notice(t("reminder.noteUnavailable")); return; }
    this.closeEvent(false);
    this.clearHover();
    this.panel.inert = true;
    const card = this.host.createEl("section", { cls: "db-record-detail-panel db-ri-event db-rr-preview-event", attr: {
      id: "db-rr-preview-event", role: "dialog", "aria-modal": "true", "aria-labelledby": "db-rr-preview-event-title",
    } });
    const header = card.createDiv({ cls: "db-record-detail-header" });
    renderReadonlyRecordTitleIcon(header, file, this.recordIcons ?? { visible: true, tokenForFile: () => row.iconToken });
    const title = header.createDiv({ cls: "db-record-detail-title", text: row.title, attr: { id: "db-rr-preview-event-title" } });
    markNoteHoverLink(title, row.path, row.path);
    this.hoverRows.set(title, row);
    const controls = header.createDiv({ cls: "db-ri-event-controls" });
    const launch = this.iconButton(controls, "maximize-2", t("menu.openNote"));
    launch.onclick = () => {
      const current = this.getOriginalFile(row);
      if (current) void this.openNote(current);
      else { this.refresh(); new Notice(t("reminder.noteUnavailable")); }
    };
    this.iconButton(controls, "x", t("common.close")).onclick = () => this.closeEvent(true);
    const fields = card.createDiv({ cls: "db-record-detail-fields" });
    const field = (label: string, value: string): void => {
      const line = fields.createDiv({ cls: "db-record-detail-field is-readonly" });
      line.createSpan({ cls: "db-record-detail-field-label", text: label });
      line.createSpan({ cls: "db-board-card-value", text: value });
    };
    if (row.dueAt !== undefined) field(t("reminder.dueLabel"), this.formatter.format(row.dueAt));
    if (row.reminderAt !== undefined) field(t("reminder.triggerLabel"), this.formatter.format(row.reminderAt));
    field(t("reminder.previewReason"), t(`reminder.reason.${row.reason}`));
    card.onkeydown = this.trapTab;
    anchor.setAttribute("aria-expanded", "true");
    this.event = { card, anchor, launch };
    this.repositionEvent();
    launch.focus({ preventScroll: true });
  }

  private closeEvent(restore: boolean): void {
    if (!this.event) return;
    const { card, anchor } = this.event;
    this.event = undefined;
    this.clearHover();
    this.panel.inert = false;
    card.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  private place = (): void => {
    if (this.parked) return;
    const viewport = this.overlay.getBoundingClientRect();
    const phone = viewport.width <= 600 || this.overlay.ownerDocument.body.classList.contains("is-phone");
    if (phone) {
      this.panel.setCssProps({ position: "absolute", left: "12px", right: "12px", top: "auto", width: "auto",
        maxWidth: "none", bottom: "max(12px, env(safe-area-inset-bottom))", maxHeight: "min(520px, 80dvh)" });
    } else positionToolbarPopover(this.panel, this.anchor, { placement: "submenu", preferredWidth: 434, maxWidth: 434, maxHeight: 500 });
    this.repositionEvent();
  };

  private repositionEvent = (): void => {
    if (!this.event || this.parked) return;
    const { card, anchor } = this.event;
    if (this.overlay.clientWidth <= 600 || this.overlay.ownerDocument.body.classList.contains("is-phone")) {
      card.addClass("is-sheet");
      card.setCssProps({ position: "absolute", left: "12px", right: "12px", bottom: "max(12px, env(safe-area-inset-bottom))",
        top: "auto", width: "auto", maxWidth: "none", maxHeight: "65dvh" });
    } else {
      card.removeClass("is-sheet");
      positionToolbarPopover(card, anchor, { preferredWidth: 350, maxWidth: 350, maxHeight: 360, align: "center" });
    }
  };

  private trapTab = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const scope = this.event?.card ?? this.panel;
    const keys = Array.from(scope.querySelectorAll<HTMLElement>("button:not([disabled]), input"));
    const first = keys[0];
    const last = keys[keys.length - 1];
    const focused = scope.ownerDocument.activeElement;
    if (event.shiftKey ? focused === first : focused === last) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  };

  private clearHover(): void {
    const hover = this.hoverParent.hoverPopover;
    this.hoverParent.hoverPopover = null;
    if (hover && "hide" in hover && typeof hover.hide === "function") Reflect.apply(hover.hide, hover, []);
    else if (hover) { hover.hoverEl.remove(); hover.unload(); }
  }
}
