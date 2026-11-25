import { App, Modal, Notice, setIcon } from "obsidian";
import {
  normalizeSettingsFolding, SETTING_FOLD_GROUPS,
  type SettingFoldGroupId, type SettingFoldId, type SettingsFoldingPreferences,
} from "../../data/SettingsFolding";
import { t } from "../../i18n";
import { generateId } from "../../data/types";
import { openSettingsFoldingPreview } from "../SettingsFoldingPreview";
import { makeModalDraggable } from "./ModalDrag";

export class SettingsFoldingModal extends Modal {
  private draft: SettingsFoldingPreferences;
  private readonly defaults = normalizeSettingsFolding(undefined).items;
  private groupId: SettingFoldGroupId = "database";
  private readonly id = `db-fold-${generateId()}`;
  private readonly tabs = new Map<SettingFoldGroupId, HTMLButtonElement>();
  private tabPanel!: HTMLElement;
  private groupHelp!: HTMLElement;
  private previewButton!: HTMLButtonElement;
  private closePreview?: () => void;
  private choices!: HTMLElement;
  private groupCount!: HTMLElement;
  private resetGroup!: HTMLButtonElement;
  private resetAll!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;
  private saveButton!: HTMLButtonElement;
  private saving = false;

  constructor(app: App, value: SettingsFoldingPreferences | undefined, private readonly commit: (draft: SettingsFoldingPreferences) => Promise<void>) {
    super(app);
    this.draft = normalizeSettingsFolding(value);
  }

  onOpen(): void {
    this.setTitle(t("settings.folding.customize"));
    this.modalEl.addClass("db-settings-folding-modal");
    const root = this.contentEl;
    root.addClass("note-database-modal", "db-settings-folding-editor");
    makeModalDraggable(this);
    root.createEl("p", { cls: "db-settings-folding-help", text: t("settings.folding.customizeHelp") });
    const tabs = root.createDiv({ cls: "db-formula-category-list db-settings-folding-tabs", attr: {
      role: "tablist", "aria-label": t("settings.folding.group"),
    } });
    const groups = SETTING_FOLD_GROUPS;
    groups.forEach(({ id, label }, index) => {
      const tab = tabs.createEl("button", { cls: "db-formula-category", text: t(label), attr: {
        type: "button", id: `${this.id}-tab-${id}`, role: "tab", "aria-controls": `${this.id}-panel`,
      } });
      tab.onclick = () => this.selectGroup(id);
      tab.onkeydown = event => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? groups.length - 1
          : event.key === "ArrowLeft" ? (index + groups.length - 1) % groups.length
          : event.key === "ArrowRight" ? (index + 1) % groups.length : -1;
        if (next < 0 || this.saving) return;
        event.preventDefault();
        this.selectGroup(groups[next].id, true);
      };
      this.tabs.set(id, tab);
    });
    this.tabPanel = root.createDiv({ cls: "db-settings-folding-body", attr: { role: "tabpanel", id: `${this.id}-panel` } });
    this.groupHelp = this.tabPanel.createDiv({ cls: "db-settings-folding-group-help" });
    const tools = this.tabPanel.createDiv({ cls: "db-settings-folding-tools" });
    this.groupCount = tools.createSpan({ cls: "db-settings-folding-count", attr: { role: "status" } });
    const groupActions = tools.createDiv({ cls: "db-settings-folding-group-actions" });
    this.previewButton = groupActions.createEl("button", { cls: "db-settings-folding-quiet db-settings-folding-preview-trigger", attr: {
      type: "button", "aria-haspopup": "dialog", "aria-expanded": "false",
    } });
    setIcon(this.previewButton.createSpan({ attr: { "aria-hidden": "true" } }), "eye");
    this.previewButton.createSpan({ text: t("settings.folding.openPreview") });
    this.previewButton.onclick = () => this.togglePreview();
    this.resetGroup = this.createResetButton(groupActions, "settings.folding.resetGroup", "db-settings-folding-reset-group", () => {
      this.draft.items[this.groupId] = [...this.defaults[this.groupId]];
      this.renderChoices();
      if (this.resetGroup.disabled) this.tabs.get(this.groupId)?.focus({ preventScroll: true });
    });
    this.choices = this.tabPanel.createDiv({ cls: "db-settings-folding-choices" });
    const footer = root.createDiv({ cls: "db-settings-folding-footer" });
    this.resetAll = this.createResetButton(footer, "settings.folding.reset", "db-settings-folding-reset", () => {
      this.draft = normalizeSettingsFolding({ enabled: this.draft.enabled });
      this.renderChoices();
      if (this.resetAll.disabled) this.tabs.get(this.groupId)?.focus({ preventScroll: true });
    });
    const actions = footer.createDiv({ cls: "db-settings-folding-actions" });
    this.cancelButton = actions.createEl("button", { text: t("common.cancel"), attr: { type: "button" } });
    this.cancelButton.onclick = () => this.close();
    this.saveButton = actions.createEl("button", { cls: "mod-cta", text: t("common.save"), attr: { type: "button" } });
    this.saveButton.onclick = () => { void this.saveDraft(); };
    this.selectGroup(this.groupId);
  }

  private createResetButton(parent: HTMLElement, label: string, cls: string, reset: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `db-settings-folding-quiet ${cls}`, text: t(label), attr: { type: "button" } });
    button.onclick = () => { if (!this.saving && !button.disabled) reset(); };
    return button;
  }

  onClose(): void {
    this.tabs.clear();
    this.closePreview?.();
    this.contentEl.empty();
  }

  private selectGroup(group: SettingFoldGroupId, focus = false): void {
    if (this.saving) return;
    if (group !== this.groupId) this.closePreview?.();
    this.groupId = group;
    this.tabPanel.setAttribute("aria-labelledby", `${this.id}-tab-${group}`);
    for (const [id, tab] of this.tabs) {
      const active = id === group;
      tab.toggleClass("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.setAttribute("tabindex", active ? "0" : "-1");
    }
    if (focus) this.tabs.get(group)?.focus();
    this.groupHelp.setText(t(group === "database" ? "settings.folding.databaseHelp" :
      group === "view" ? "settings.folding.sharedHelp" : "settings.folding.viewHelp"));
    this.renderChoices();
  }

  private togglePreview(): void {
    if (this.closePreview) {
      this.closePreview();
      return;
    }
    if (this.saving) return;
    const id = `${this.id}-preview`;
    this.previewButton.setAttribute("aria-controls", id);
    this.closePreview = openSettingsFoldingPreview({
      app: this.app, container: this.containerEl, anchor: this.previewButton,
      group: this.groupId, draft: this.draft, id,
      onClose: () => {
        this.closePreview = undefined;
        this.previewButton.removeAttribute("aria-controls");
      },
    });
  }

  private renderChoices(): void {
    const group = SETTING_FOLD_GROUPS.find(({ id }) => id === this.groupId)!;
    this.choices.empty();
    for (const item of group.items) {
      const id: SettingFoldId = item.id;
      const label = this.choices.createEl("label", { cls: "db-settings-folding-choice" });
      label.createSpan({ text: t(item.label) });
      const input = label.createEl("input", { cls: "db-toggle-switch", attr: { type: "checkbox", role: "switch" } });
      input.checked = this.draft.items[group.id].includes(id);
      input.disabled = this.saving;
      input.onchange = () => {
        if (this.saving) return;
        const selected = this.draft.items[group.id];
        this.draft.items[group.id] = input.checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id);
        this.refreshGroupStatus();
        this.closePreview?.();
      };
    }
    this.refreshGroupStatus();
    this.closePreview?.();
  }

  private refreshGroupStatus(): void {
    const group = SETTING_FOLD_GROUPS.find(({ id }) => id === this.groupId)!;
    this.groupCount.setText(t("settings.folding.groupCount", { count: this.draft.items[group.id].length, total: group.items.length }));
    const isDefault = (id: SettingFoldGroupId): boolean => {
      const draft = this.draft.items[id];
      return draft.length === this.defaults[id].length && this.defaults[id].every(item => draft.includes(item));
    };
    this.resetGroup.disabled = this.saving || isDefault(group.id);
    this.resetAll.disabled = this.saving || SETTING_FOLD_GROUPS.every(({ id }) => isDefault(id));
  }

  private setSaving(saving: boolean): void {
    this.saving = saving;
    this.previewButton.disabled = saving;
    if (saving) this.closePreview?.();
    this.saveButton.disabled = saving;
    this.cancelButton.disabled = saving;
    for (const tab of this.tabs.values()) tab.disabled = saving;
    for (const control of this.choices.querySelectorAll<HTMLInputElement>("input")) control.disabled = saving;
    this.refreshGroupStatus();
  }

  private async saveDraft(): Promise<void> {
    if (this.saving) return;
    this.setSaving(true);
    try {
      await this.commit(normalizeSettingsFolding(this.draft));
      if (this.containerEl.isConnected) this.close();
    } catch (error) {
      new Notice(t("errors.updateFailed", { error: String(error) }));
    } finally {
      if (this.contentEl.isConnected) this.setSaving(false);
    }
  }
}
