import { Modal, Notice, type App } from "obsidian";
import {
  CREATION_DEFAULT_VIEW_TYPES, getDefaultKeys, getDisplayedDefault, getEditorDefaultValue,
  hasViewDefaultOverride, isSharedDefault, normalizeNewViewDefaults, updateCreationDefault,
  type CreationDefaultGroup, type CreationDefaultKey, type NewViewDefaults,
} from "../../data/NewViewDefaults";
import { generateId } from "../../data/types";
import { t } from "../../i18n";
import { CalendarTimelineToolbarRenderer } from "../CalendarTimelineToolbarRenderer";
import { CalendarToolbarRenderer } from "../CalendarToolbarRenderer";
import { ChartToolbarRenderer } from "../ChartToolbarRenderer";
import { closeDropdownForRoot } from "../DropdownField";
import { createSettingsSample } from "../SettingsFoldingPreview";
import { ViewConfigPanelRenderer } from "../ViewConfigPanelRenderer";
import { makeModalDraggable } from "./ModalDrag";

const GROUPS: { id: CreationDefaultGroup; label: string }[] = [
  { id: "shared", label: "settings.folding.sharedTab" },
  { id: "database", label: "settings.folding.databaseTab" },
  ...CREATION_DEFAULT_VIEW_TYPES.map(type => ({ id: type, label: `common.${type}View` })),
];
const editableControls = "button, input, select, textarea, a, [role=button], [contenteditable], [tabindex]";
// Keep production setting rows as-is (including their own input and event handlers).
// Preserve a section heading only when the section still contains editable rows.
function keepEditableDefaults(container: Element, allowed: ReadonlySet<string>): boolean {
  const headings: Element[] = [];
  let hasEditable = false;
  for (const child of Array.from(container.children)) {
    if (child.matches(".db-chart-options-section-title")) {
      headings.push(child);
    } else if (allowed.has(child.getAttribute("data-creation-default") ?? "") || keepEditableDefaults(child, allowed)) {
      hasEditable = true;
    } else {
      child.remove();
    }
  }
  if (!hasEditable) for (const heading of headings) heading.remove();
  return hasEditable;
}

export class NewViewDefaultsModal extends Modal {
  private draft: NewViewDefaults;
  private group: CreationDefaultGroup = "shared";
  private readonly key = `db-creation-defaults-${generateId()}`;
  private body!: HTMLElement;
  private help!: HTMLElement;
  private navigation!: HTMLElement;
  private readonly tabs = new Map<CreationDefaultGroup, HTMLButtonElement>();
  private footer!: HTMLElement;
  private saving = false;

  constructor(app: App, value: NewViewDefaults | undefined, private readonly commit: (draft: NewViewDefaults) => Promise<void>) {
    super(app);
    this.draft = normalizeNewViewDefaults(value);
  }

  onOpen(): void {
    this.setTitle(t("settings.creationDefaults.title"));
    this.modalEl.addClass("db-creation-defaults-modal");
    const root = this.contentEl;
    root.addClass("note-database-modal", "db-creation-defaults-editor");
    makeModalDraggable(this);
    this.scope.register([], "Escape", event => {
      if (closeDropdownForRoot(root)) {
        event.preventDefault();
        return false;
      }
      if (this.saving) return false;
      this.close();
      return false;
    });
    root.createEl("p", { cls: "db-creation-defaults-help", text: t("settings.creationDefaults.description") });
    this.navigation = root.createDiv({ cls: "db-creation-defaults-navigation" });
    const tablist = this.navigation.createDiv({ cls: "db-formula-category-list db-settings-folding-tabs db-creation-defaults-tabs",
      attr: { role: "tablist", "aria-label": t("settings.folding.group") } });
    GROUPS.forEach(({ id, label }, index) => {
      const button = tablist.createEl("button", { cls: "db-formula-category", text: t(label), attr: {
        type: "button", id: `${this.key}-${id}`, role: "tab", "aria-controls": this.key,
      } });
      button.onclick = () => this.selectGroup(id);
      button.onkeydown = event => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? GROUPS.length - 1
          : event.key === "ArrowLeft" ? (index + GROUPS.length - 1) % GROUPS.length
          : event.key === "ArrowRight" ? (index + 1) % GROUPS.length : -1;
        if (next < 0 || this.saving) return;
        event.preventDefault();
        this.selectGroup(GROUPS[next].id);
        this.tabs.get(GROUPS[next].id)?.focus({ preventScroll: true });
      };
      this.tabs.set(id, button);
    });
    this.help = root.createDiv({ cls: "db-creation-defaults-help db-creation-defaults-view-help" });
    this.body = root.createDiv({ cls: "note-database-container db-creation-defaults-body",
      attr: { role: "tabpanel", id: this.key } });
    this.footer = root.createDiv({ cls: "db-settings-folding-footer" });
    const reset = this.footer.createEl("button", { cls: "db-settings-folding-quiet", text: t("settings.creationDefaults.reset"), attr: { type: "button" } });
    reset.onclick = () => {
      if (this.saving) return;
      this.draft = normalizeNewViewDefaults(undefined);
      this.renderPanel(false);
    };
    const actions = this.footer.createDiv({ cls: "db-settings-folding-actions" });
    const cancel = actions.createEl("button", { text: t("common.cancel"), attr: { type: "button" } });
    cancel.onclick = () => { if (!this.saving) this.close(); };
    const save = actions.createEl("button", { cls: "mod-cta", text: t("common.save"), attr: { type: "button" } });
    save.onclick = () => { void this.save(); };
    this.selectGroup(this.group);
  }

  onClose(): void {
    closeDropdownForRoot(this.contentEl, false);
    this.tabs.clear();
    this.contentEl.empty();
  }

  private selectGroup(group: CreationDefaultGroup): void {
    if (this.saving) return;
    this.group = group;
    for (const [id, button] of this.tabs) {
      button.toggleClass("is-active", id === group);
      button.setAttribute("aria-selected", String(id === group));
      button.tabIndex = id === group ? 0 : -1;
    }
    this.body.setAttribute("aria-labelledby", `${this.key}-${group}`);
    this.help.hidden = group !== "shared" && group !== "chart" && group !== "timeline";
    this.help.setText(group === "shared" ? t("settings.creationDefaults.sharedHelp")
      : group === "chart" ? t("settings.creationDefaults.chartAxesHelp")
        : group === "timeline" ? t("settings.creationDefaults.timelineDayHelp") : "");
    const tab = this.tabs.get(group);
    const strip = tab?.parentElement;
    if (tab && strip) {
      const item = tab.getBoundingClientRect();
      const track = strip.getBoundingClientRect();
      const start = track.left + strip.clientLeft;
      const end = start + strip.clientWidth;
      if (item.left < start) strip.scrollLeft += item.left - start;
      else if (item.right > end) strip.scrollLeft += item.right - end;
    }
    this.renderPanel(false);
  }

  private renderPanel(preserveScroll: boolean, focusKey?: CreationDefaultKey): void {
    closeDropdownForRoot(this.body, false);
    const scrollTop = preserveScroll ? this.body.scrollTop : 0;
    this.body.empty();
    const group = this.group;
    const keys = getDefaultKeys(group);
    const { database, view } = createSettingsSample(group === "shared" ? "gallery" : group === "database" ? "table" : group);
    for (const key of keys) {
      const value = getDisplayedDefault(this.draft, group, key);
      Object.assign(key === "quickFormEnabled" ? database : view, { [key]: value });
    }
    const values = new Map(keys.map(key => [key, getEditorDefaultValue(view, database, key)]));
    let redrawPending = false;
    const onChange = () => {
      if (this.saving || this.group !== group) return;
      const changed: CreationDefaultKey[] = [];
      for (const key of keys) {
        const next = getEditorDefaultValue(view, database, key);
        if (Object.is(values.get(key), next)) continue;
        updateCreationDefault(this.draft, group, key, next);
        values.set(key, next);
        changed.push(key);
      }
      const redrawKey = changed.find(key => key === "calendarScale");
      if (redrawKey && !redrawPending) {
        redrawPending = true;
        queueMicrotask(() => {
          if (this.group === group && panel.isConnected && !this.saving) this.renderPanel(true, redrawKey);
        });
      } else if (changed.length) {
        this.updateInheritedLabels(panel);
      }
    };
    const actions = { database, onChange };
    // Render off the page and mount only editable rows. This editor never exposes live-only actions.
    const staging = this.body.ownerDocument.createElement("div");
    const panel = group === "calendar" ? new CalendarToolbarRenderer().renderPreview(staging, view, actions)
      : group === "timeline" ? new CalendarTimelineToolbarRenderer().renderPreview(staging, view, actions)
        : group === "chart" ? new ChartToolbarRenderer().renderPreview(staging, view, { ...actions, creationDefaults: true })
          : new ViewConfigPanelRenderer().render(staging, true, view, {
            ...actions, app: this.app, onDatabaseChange: onChange,
            creationDefaultsScope: group === "database" ? "database" : "view",
          })!;
    keepEditableDefaults(panel, new Set(keys));
    this.body.replaceChildren(panel);
    for (const row of panel.querySelectorAll<HTMLElement>("[data-creation-default]")) {
      const label = row.querySelector(".db-view-config-label, .db-chart-options-label")?.textContent;
      if (label) for (const control of row.querySelectorAll("input:not([aria-label])")) control.setAttribute("aria-label", label);
    }
    this.updateInheritedLabels(panel);
    this.body.scrollTop = scrollTop;
    if (focusKey) {
      const row = panel.querySelector<HTMLElement>(`[data-creation-default="${focusKey}"]`);
      (row?.matches(editableControls) ? row : row?.querySelector<HTMLElement>(editableControls))?.focus({ preventScroll: true });
    }
  }

  private updateInheritedLabels(panel: HTMLElement): void {
    if (this.group === "database" || this.group === "shared") return;
    for (const row of panel.querySelectorAll<HTMLElement>("[data-creation-default]")) {
      const key = row.dataset.creationDefault as CreationDefaultKey;
      if (!isSharedDefault(key)) continue;
      row.parentElement?.querySelector(`[data-default-inheritance="${key}"]`)?.remove();
      const hint = panel.ownerDocument.createElement("div");
      hint.className = "db-creation-default-inheritance";
      hint.dataset.defaultInheritance = key;
      row.insertAdjacentElement("afterend", hint);
      const overridden = hasViewDefaultOverride(this.draft, this.group, key);
      row.toggleClass("is-default-overridden", overridden);
      if (overridden) {
        const button = hint.createEl("button", { text: t("settings.creationDefaults.inherit"), attr: { type: "button" } });
        button.onclick = () => {
          updateCreationDefault(this.draft, this.group, key, undefined);
          this.renderPanel(true, key);
        };
      } else {
        hint.createSpan({ text: t("settings.creationDefaults.inherited") });
      }
    }
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    closeDropdownForRoot(this.contentEl, false);
    for (const element of [this.navigation, this.body, this.footer]) element.inert = true;
    try {
      await this.commit(normalizeNewViewDefaults(this.draft));
      if (this.containerEl.isConnected) this.close();
    } catch (error) {
      new Notice(t("errors.updateFailed", { error: String(error) }));
    } finally {
      this.saving = false;
      for (const element of [this.navigation, this.body, this.footer]) element.inert = false;
    }
  }
}
