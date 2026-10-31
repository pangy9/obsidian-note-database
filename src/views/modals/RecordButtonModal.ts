import { BUTTON_STEP_ICONS, BUTTON_TARGET_ICONS, renderButtonMenuIcon } from "../RecordButtonMenuIcons";
import { getDatabaseDropdownIcon } from "../RecordIconRenderer";
import { toPropertyDropdownOption } from "../PropertyTypeIcon";
import { App, Modal, Notice, Platform, Scope } from "obsidian";
import type { ColumnDef, DatabaseConfig, RecordButtonConfig, RecordButtonStep } from "../../data/types";
import { findRecordButtonConfigurationIssue, isButtonTarget, type RecordButtonConfigurationIssue } from "../../data/RecordButton";
import { t } from "../../i18n";
import { makeModalDraggable } from "./ModalDrag";
import { closeDropdownForRoot, createDropdownField } from "../DropdownField";
import { ButtonCardEditState, cancelButtonSorting, buttonAdd, buttonIcon, buttonToggle, renderButtonCardHeading, renderButtonCardSummary, type ButtonSummaryTag } from "./RecordButtonEditorUI";
import { renderButtonComposition } from "./RecordButtonValueEditor";
import { isImeComposing } from "../../data/KeyboardUtils";
import { serializeButtonText } from "../../data/RecordButtonComposition";
import { buttonRow, buttonSelect, buttonText, renderButtonActions, renderButtonValue } from "./RecordButtonActionEditor";

export class RecordButtonModal extends Modal {
  private draft: RecordButtonConfig;
  private actionsEl!: HTMLElement;
  private foldAll!: HTMLButtonElement;
  private validationIssue?: RecordButtonConfigurationIssue;
  private editing = new ButtonCardEditState();
  private responsiveCleanup?: () => void;
  constructor(app: App, private column: ColumnDef, private columns: () => ColumnDef[], private save: (config: RecordButtonConfig) => Promise<void>, private databases: () => DatabaseConfig[] = () => [], private databaseId = "", private showDatabaseIcons = true) {
    super(app);
    this.draft = structuredClone(column.buttonConfig || { label: column.label, icon: "mouse-pointer-2", style: "default", actions: [] });
    if (!this.draft.steps) this.draft.steps = this.draft.actions.length ? [{ kind: "edit", target: "trigger", actions: this.draft.actions }] : [];
    this.draft.actions = [];
    // A child scope takes precedence over Modal's pre-registered Escape handler.
    this.scope = new Scope(this.scope);
    this.scope.register([], "Escape", event => {
      if (isImeComposing(event)) return;
      if (!closeDropdownForRoot(this.contentEl) && !cancelButtonSorting(this.actionsEl)) this.close();
      return false;
    });
  }
  onOpen(): void {
    this.editing = new ButtonCardEditState(); this.validationIssue = undefined;
    this.modalEl.addClass("db-button-modal-host");
    this.contentEl.addClass("note-database-modal", "db-button-modal");
    this.contentEl.createEl("h3", { text: t("button.configure") }); makeModalDraggable(this);
    this.contentEl.createDiv({ cls: "db-modal-help", text: t("button.workflow.help") });
    buttonText(this.contentEl, t("button.label"), this.draft.label, value => { this.draft.label = value; });
    buttonToggle(this.contentEl, t("button.confirm"), !!this.draft.confirm, value => { this.draft.confirm = value; });
    const section = this.contentEl.createDiv({ cls: "db-button-section-heading" });
    section.createEl("h4", { text: t("button.actions") });
    this.foldAll = section.createEl("button", { cls: "db-button-fold-all", attr: { type: "button" } });
    this.foldAll.onclick = () => { cancelButtonSorting(this.actionsEl); this.editing.toggleAll(this.draft.steps!); this.renderSteps(); this.foldAll.focus({ preventScroll: true }); };
    this.actionsEl = this.contentEl.createDiv({ cls: "db-button-actions" });
    const narrow = this.contentEl.ownerDocument.defaultView!.matchMedia("(max-width: 600px)");
    const resize = (): void => {
      cancelButtonSorting(this.actionsEl);
      this.editing.compact = Platform.isMobile || narrow.matches;
      this.contentEl.toggleClass("is-compact-editor", this.editing.compact);
      this.renderSteps();
    };
    narrow.addEventListener("change", resize);
    this.responsiveCleanup = () => narrow.removeEventListener("change", resize);
    resize();
    createDropdownField({
      parent: this.contentEl, label: t("button.addAction"), hideLabel: true, value: "", placeholder: t("button.addAction"),
      icon: "plus", className: "db-button-add db-button-add-step", popoverClassName: "db-button-menu-popover",
      renderIcon: renderButtonMenuIcon,
      options: (["edit", "create", "duplicate", "variable", "confirm", "open"] as const).map(kind => ({ value: kind, text: t(`button.workflow.kind.${kind}`), icon: BUTTON_STEP_ICONS[kind], preserveValueOnSelect: true })),
      onChange: kind => { const step = this.newStep(kind as RecordButtonStep["kind"]); this.draft.steps!.push(step); this.editing.open(this.draft.steps!, step); this.renderSteps(); this.actionsEl.lastElementChild?.scrollIntoView({ block: "start" }); },
    });
    const footer = this.contentEl.createDiv({ cls: "db-modal-button-row" });
    footer.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const save = footer.createEl("button", { cls: "mod-cta", text: t("common.save") });
    save.onclick = () => {
      if (save.disabled) return;
      this.validationIssue = findRecordButtonConfigurationIssue(this.draft, this.columns(), (step, created) => this.schemaFor(step, created));
      if (this.validationIssue) { this.revealValidationIssue(); new Notice(this.validationIssue.message); return; }
      save.disabled = true;
      void this.save(structuredClone(this.draft)).then(() => this.close()).catch((error: unknown) => { new Notice(t("errors.updateFailed", { error: String(error) })); }).finally(() => { save.disabled = false; });
    };
  }
  private newStep(kind: RecordButtonStep["kind"]): RecordButtonStep {
    if (kind === "edit") return { kind, target: "trigger", actions: [] };
    if (kind === "create" || kind === "duplicate") return { kind, databaseId: this.databaseId, title: kind === "duplicate" ? "{{trigger.file.basename}} " + t("button.workflow.copySuffix") : "{{trigger.file.basename}} " + t("button.workflow.followupSuffix"), actions: [] };
    if (kind === "variable") return { kind, name: "value" + (this.draft.steps!.filter(s => s.kind === "variable").length + 1), value: { source: "trigger", value: "file.link" } };
    if (kind === "open") return { kind, target: "created", newTab: true };
    return { kind, message: t("button.workflow.defaultConfirm") };
  }
  private schemaFor(step: RecordButtonStep, created: ColumnDef[]): ColumnDef[] {
    if (step.kind === "edit" && step.target === "trigger") return this.columns();
    if (step.kind === "edit" && step.target === "created") return created;
    if (step.kind === "create" || step.kind === "duplicate" || step.kind === "edit") return step.databaseId === this.databaseId ? this.columns() : this.databases().find(db => db.id === step.databaseId)?.schema.columns || [];
    return [];
  }
  private databasePicker(parent: HTMLElement, id: string, change: (id: string) => void): void {
    const options = this.databases().map(db => ({ value: db.id, text: db.name, icon: getDatabaseDropdownIcon(db, this.showDatabaseIcons) }));
    if (!options.some(o => o.value === id)) options.unshift({ value: id, text: t("button.workflow.databaseRequired"), icon: undefined });
    buttonSelect(buttonRow(parent, t("button.workflow.database")), t("button.workflow.database"), id, options, change);
  }
  private revealValidationIssue(): void {
    const issue = this.validationIssue;
    if (!issue?.step) {
      this.contentEl.scrollTop = 0;
      this.contentEl.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    this.editing.open(this.draft.steps!, issue.step);
    if (issue.action && "actions" in issue.step) this.editing.open(issue.step.actions, issue.action);
    this.renderSteps();
    const card = this.actionsEl.children[this.draft.steps!.indexOf(issue.step)] as HTMLElement | undefined;
    const target = issue.action && "actions" in issue.step
      ? card?.querySelectorAll<HTMLElement>(".db-button-property-actions > .db-button-property-action")[issue.step.actions.indexOf(issue.action)] || card : card;
    target?.scrollIntoView({ block: "start" });
    target?.querySelector<HTMLElement>("input, textarea, .db-dropdown-field, .db-button-card-disclosure")?.focus({ preventScroll: true });
  }
  private renderSteps(): void {
    const scrollTop = this.contentEl.scrollTop;
    this.foldAll.hidden = !this.editing.showGlobalToggle(this.draft.steps!);
    this.foldAll.textContent = t(this.editing.hasExpanded(this.draft.steps!) ? "button.workflow.collapseAll" : "button.workflow.expandAll");
    while (closeDropdownForRoot(this.actionsEl, false)) { /* Rerenders must not leave menus anchored to removed fields. */ }
    this.actionsEl.empty();
    let created: ColumnDef[] = [];
    let hasCreated = false;
    const variables: string[] = [];
    this.draft.steps!.forEach((step, index) => {
      const group = this.actionsEl.createDiv({ cls: "db-button-action" });
      renderButtonCardHeading(group, t(`button.workflow.kind.${step.kind}`), this.draft.steps!, index, () => this.renderSteps(), true, BUTTON_STEP_ICONS[step.kind], this.editing);
      const schema = this.schemaFor(step, created);
      const valueColumns = { trigger: this.columns(), target: step.kind === "edit" || step.kind === "create" || step.kind === "duplicate" ? schema : undefined, created: hasCreated ? created : undefined };
      const textColumns = { ...valueColumns, target: undefined };
      const compose = (label: string, value: string, change: (value: string) => void, multiline = false, help?: string): void => {
        renderButtonComposition(group, label, value, textColumns, [...variables], parts => change(serializeButtonText(parts)), multiline, help);
      };
      const summary = group.querySelector<HTMLElement>(".db-button-action-title")!;
      const refreshSummary = (): void => {
        const tags: ButtonSummaryTag[] = [];
        if (step.kind === "edit" || step.kind === "open") tags.push({ kind: "target", text: t(`button.workflow.target.${step.target}`), icon: BUTTON_TARGET_ICONS[step.target] });
        if (step.kind === "create" || step.kind === "duplicate" || (step.kind === "edit" && step.target === "database")) {
          const database = this.databases().find(db => db.id === step.databaseId);
          tags.push({ kind: "target", text: database?.name || t("button.workflow.databaseRequired"), icon: database ? getDatabaseDropdownIcon(database, this.showDatabaseIcons) : undefined });
        }
        if (step.kind === "variable" && step.name) tags.push({ kind: "variable", text: step.name, icon: BUTTON_STEP_ICONS.variable });
        if ("actions" in step) for (const action of step.actions) {
          const column = schema.find(c => c.key === action.field);
          tags.push({ ...(column ? toPropertyDropdownOption(column) : { text: action.field }), kind: "property" });
        }
        renderButtonCardSummary(summary, t(`button.workflow.kind.${step.kind}`), tags);
      };
      refreshSummary();
      if (this.validationIssue?.step === step) {
        group.createDiv({ cls: "db-button-error", text: this.validationIssue.message, attr: { role: "alert" } });
      }
      group.addEventListener("input", () => {
        refreshSummary();
        if (this.validationIssue?.step === step) {
          this.validationIssue = undefined;
          group.querySelector('.db-button-error[role="alert"]')?.remove();
        }
      });
      const render = (): void => { this.validationIssue = undefined; this.renderSteps(); };
      if (step.kind === "edit") {
        buttonSelect(buttonRow(group, t("button.workflow.target")), t("button.workflow.target"), step.target, ["trigger", "created", "database"].map(value => ({ value, text: t(`button.workflow.target.${value}`), icon: BUTTON_TARGET_ICONS[value] })), target => {
          step.target = target as typeof step.target; step.databaseId = this.databaseId; step.actions = []; step.filters = []; step.allRecords = false; render();
        });
        if (step.target === "database") {
          this.databasePicker(group, step.databaseId || "", id => { step.databaseId = id; step.actions = []; step.filters = []; step.allRecords = false; render(); });
          group.createDiv({ cls: "db-modal-help", text: t("button.workflow.filterHelp") });
          for (const [fi, filter] of (step.filters || []).entries()) {
            const row = group.createDiv({ cls: "db-button-property-action" });
            buttonSelect(buttonRow(row, t("filter.field")), t("filter.field"), filter.field, schema.filter(c => !["button", "computed", "rollup"].includes(c.type)).map(c => toPropertyDropdownOption(c)), key => { filter.field = key; });
            buttonSelect(buttonRow(row, t("button.operation")), t("button.operation"), filter.op, ["eq", "neq", "contains", "hasTag", "gt", "lt", "gte", "lte", "empty", "notempty"].map(op => ({ value: op, text: t(`button.workflow.filter.${op}`) })), op => { filter.op = op as typeof filter.op; render(); });
            if (!["empty", "notempty"].includes(filter.op)) renderButtonValue(row, filter.value, render, valueColumns, [...variables]);
            buttonIcon(row.createDiv({ cls: "db-button-filter-tools" }), "trash-2", t("common.delete"), () => { step.filters!.splice(fi, 1); render(); });
          }
          buttonAdd(group, t("button.workflow.addFilter"), () => { const field = schema.find(isButtonTarget); if (field) { (step.filters ||= []).push({ field: field.key, op: "eq", value: { source: "literal", value: "" } }); render(); } });
          if (!step.filters?.length) buttonToggle(group, t("button.workflow.allRecords"), !!step.allRecords, value => { step.allRecords = value; });
        }
        renderButtonActions(group, step.actions, schema, render, valueColumns, [...variables], this.editing);
      } else if (step.kind === "create" || step.kind === "duplicate") {
        this.databasePicker(group, step.databaseId, id => { step.databaseId = id; step.actions = []; render(); });
        compose(t("button.workflow.title"), step.title, value => { step.title = value; });
        compose(t("button.workflow.body"), step.body || "", value => { step.body = value; }, true, t("button.workflow.bodyHelp"));
        renderButtonActions(group, step.actions, schema, render, valueColumns, [...variables], this.editing);
        created = schema; hasCreated = true;
      } else if (step.kind === "variable") {
        buttonText(group, t("button.workflow.variableName"), step.name, value => { step.name = value; });
        renderButtonValue(group, step.value, render, valueColumns, [...variables]); variables.push(step.name);
      } else if (step.kind === "confirm") compose(t("button.workflow.confirmMessage"), step.message, value => { step.message = value; }, true);
      else if (step.kind === "open") {
        buttonSelect(buttonRow(group, t("button.workflow.target")), t("button.workflow.target"), step.target, ["trigger", "created", "link"].map(value => ({ value, text: t(`button.workflow.target.${value}`), icon: BUTTON_TARGET_ICONS[value] })), target => { step.target = target as typeof step.target; render(); });
        if (step.target === "link") compose(t("button.workflow.link"), step.link || "", value => { step.link = value; });
        buttonToggle(group, t("button.workflow.newTab"), !!step.newTab, value => { step.newTab = value; });
      }
    });
    // Match keyboard traversal to visual order: fields before Edit/Done and ordering controls.
    this.actionsEl.querySelectorAll<HTMLElement>(".db-button-card-footer").forEach(footer => footer.parentElement?.appendChild(footer));
    this.contentEl.scrollTop = scrollTop;
  }
  onClose(): void { this.responsiveCleanup?.(); cancelButtonSorting(this.actionsEl); while (closeDropdownForRoot(this.contentEl, false)) { /* Close owned flyouts before removing their anchors. */ } this.contentEl.empty(); }
}
