import { Notice, setIcon } from "obsidian";
import { ColumnDef, ComputedSyncMode, DatabaseConfig, DatabaseViewType, NO_TITLE_FIELD, SourceRule, SourceRuleGroup, SourceRuleNode, SourceRuleOperator, StatusPresetDef, ViewConfig } from "../data/types";
import { normalizeComputedSyncMode } from "../data/ComputedSync";
import { isObsidianTagsKey } from "../data/ColumnTypes";
import { getColumnDisplayType } from "../data/ColumnDisplay";
import { BASE_FILE_FIELD_KEYS, getBaseFileFieldType, isBaseFileField } from "../data/FileFields";
import { getSourceRuleTree, isSourceRuleExpression, isSourceRuleGroup, isSourceRuleNot } from "../data/SourceRules";
import { t } from "../i18n";
import { positionToolbarPopover } from "./PopoverPosition";

const CUSTOM_SOURCE_RULE_FIELD = "__custom__";

interface SourceRuleFieldOption {
  value: string;
  label: string;
}

interface SourceRuleFieldGroup {
  label: string;
  options: SourceRuleFieldOption[];
}

interface SourceRuleOperatorGroup {
  label: string;
  operators: SourceRuleOperator[];
}

const SOURCE_RULE_OPERATOR_LABEL_KEYS: Record<string, string> = {
  file: "viewConfig.sourceRules.opGroup.file",
  value: "viewConfig.sourceRules.opGroup.value",
  text: "viewConfig.sourceRules.opGroup.text",
  compare: "viewConfig.sourceRules.opGroup.compare",
  presence: "viewConfig.sourceRules.opGroup.presence",
  type: "viewConfig.sourceRules.opGroup.type",
  current: "viewConfig.sourceRules.opGroup.current",
};

const VALUE_OPERATORS: SourceRuleOperator[] = ["eq", "neq"];
const TEXT_OPERATORS: SourceRuleOperator[] = ["contains", "startsWith", "endsWith", "matches"];
const RANGE_OPERATORS: SourceRuleOperator[] = ["gt", "gte", "lt", "lte"];
const PRESENCE_OPERATORS: SourceRuleOperator[] = ["empty", "notempty"];
const TYPE_OPERATORS: SourceRuleOperator[] = ["isType"];
const BASE_IS_TYPE_VALUES = ["string", "number", "boolean", "date", "list", "object", "null"] as const;
const IS_TYPE_VALUE_ALIASES: Record<string, string> = {
  bool: "boolean",
  checkbox: "boolean",
  array: "list",
};

export function getSourceRuleOperatorGroupsForField(
  database: DatabaseConfig,
  field: string,
  currentOp?: SourceRuleOperator
): SourceRuleOperatorGroup[] {
  const groups = getRecommendedSourceRuleOperatorGroups(database, field);
  if (currentOp && !groups.some((group) => group.operators.includes(currentOp))) {
    return [{ label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.current), operators: [currentOp] }, ...groups];
  }
  return groups;
}

export function getDefaultSourceRuleOperatorForField(database: DatabaseConfig, field: string): SourceRuleOperator {
  if (isFolderSourceRuleField(field)) return "inFolder";
  if (isTagSourceRuleField(field)) return "hasTag";
  if (isLinkSourceRuleField(field)) return "hasLink";
  return getRecommendedSourceRuleOperatorGroups(database, field).some((group) => group.operators.includes("eq")) ? "eq" : "empty";
}

export function getDefaultSourceRuleIsTypeValue(database: DatabaseConfig, field: string): string {
  const displayType = getSourceRuleFieldDisplayType(database, field);
  if (displayType === "checkbox") return "boolean";
  if (displayType === "multi-select") return "list";
  if (displayType === "date") return "date";
  if (displayType === "number" || displayType === "currency") return "number";
  return "string";
}

export function getSourceRuleIsTypeValueOptions(currentValue: string | undefined): string[] {
  const normalized = normalizeSourceRuleIsTypeValue(currentValue || "");
  const values = [...BASE_IS_TYPE_VALUES];
  return normalized && !values.includes(normalized as typeof BASE_IS_TYPE_VALUES[number])
    ? [normalized, ...values]
    : values;
}

function normalizeSourceRuleIsTypeValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  return IS_TYPE_VALUE_ALIASES[normalized] || normalized;
}

function getRecommendedSourceRuleOperatorGroups(database: DatabaseConfig, field: string): SourceRuleOperatorGroup[] {
  const displayType = getSourceRuleFieldDisplayType(database, field);
  const groups: SourceRuleOperatorGroup[] = [];
  const fileOps: SourceRuleOperator[] = [];
  if (isFolderSourceRuleField(field)) fileOps.push("inFolder");
  if (isTagSourceRuleField(field)) fileOps.push("hasTag");
  if (isLinkSourceRuleField(field)) fileOps.push("hasLink");
  if (isPropertyPresenceRuleField(field)) fileOps.push("hasProperty");
  if (fileOps.length > 0) groups.push({ label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.file), operators: fileOps });

  if (displayType === "number" || displayType === "currency" || displayType === "date") {
    groups.push(
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.value), operators: VALUE_OPERATORS },
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.compare), operators: RANGE_OPERATORS },
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.presence), operators: PRESENCE_OPERATORS },
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.type), operators: TYPE_OPERATORS }
    );
    return groups;
  }

  if (displayType === "checkbox") {
    groups.push(
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.value), operators: VALUE_OPERATORS },
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.presence), operators: ["truthy", ...PRESENCE_OPERATORS] },
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.type), operators: TYPE_OPERATORS }
    );
    return groups;
  }

  if (displayType === "multi-select") {
    groups.push(
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.value), operators: ["contains", "eq", "neq"] },
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.presence), operators: PRESENCE_OPERATORS },
      { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.type), operators: TYPE_OPERATORS }
    );
    return groups;
  }

  groups.push(
    { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.value), operators: VALUE_OPERATORS },
    { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.text), operators: TEXT_OPERATORS },
    { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.presence), operators: ["truthy", ...PRESENCE_OPERATORS] },
    { label: t(SOURCE_RULE_OPERATOR_LABEL_KEYS.type), operators: TYPE_OPERATORS }
  );
  return groups;
}

function getSourceRuleFieldDisplayType(database: DatabaseConfig, field: string): ColumnDef["type"] {
  if (isBaseFileField(field)) return getBaseFileFieldType(field);
  const formulaKey = field.startsWith("formula.") ? field.slice("formula.".length) : undefined;
  const column = getSourceRuleColumns(database).find((candidate) => (
    candidate.key === field ||
    (formulaKey && candidate.type === "computed" && (candidate.computedKey || candidate.key) === formulaKey)
  ));
  return column ? getColumnDisplayType(column, getSourceRuleComputedFields(database)) : "text";
}

function getSourceRuleColumns(database: DatabaseConfig): ColumnDef[] {
  const seen = new Set<string>();
  const columns: ColumnDef[] = [];
  const add = (candidate: ColumnDef | undefined) => {
    if (!candidate || seen.has(candidate.key)) return;
    seen.add(candidate.key);
    columns.push(candidate);
  };
  for (const col of database.schema?.columns || []) add(col);
  for (const view of database.views || []) {
    for (const col of view.schema?.columns || []) add(col);
  }
  return columns;
}

function getSourceRuleComputedFields(database: DatabaseConfig): DatabaseConfig["schema"]["computedFields"] {
  const seen = new Set<string>();
  const fields: DatabaseConfig["schema"]["computedFields"] = [];
  const add = (field: DatabaseConfig["schema"]["computedFields"][number] | undefined) => {
    if (!field || seen.has(field.key)) return;
    seen.add(field.key);
    fields.push(field);
  };
  for (const field of database.schema?.computedFields || []) add(field);
  for (const view of database.views || []) {
    for (const field of view.schema?.computedFields || []) add(field);
  }
  return fields;
}

function isFolderSourceRuleField(field: string): boolean {
  return field === "folder" || field === "file.file" || field === "file.folder" || field === "file.path";
}

function isTagSourceRuleField(field: string): boolean {
  return field === "file.tags" || isObsidianTagsKey(field);
}

function isLinkSourceRuleField(field: string): boolean {
  return field === "file.links" || field === "file.backlinks" || field === "file.embeds";
}

function isPropertyPresenceRuleField(field: string): boolean {
  return Boolean(field) && !field.startsWith("formula.") && !field.startsWith("file.") && field !== "folder";
}

export interface ViewConfigPanelActions {
  onChange(): void;
  onViewTypeChange?(viewType: DatabaseViewType): void;
  onDatabaseChange?(): void;
  onComputedSyncModeChange?(): void;
  database?: DatabaseConfig;
  statusPresets?: StatusPresetDef[];
  defaultStatusPresetId?: string;
  onDefaultStatusPresetChange?(presetId: string): void;
  onManageStatusPresets?(): void;
  viewStatusPresets?: StatusPresetDef[];
  defaultViewStatusPresetId?: string;
  onDefaultViewStatusPresetChange?(presetId: string): void;
  onManageViewStatusPresets?(): void;
  readonly isDatabaseReadOnly?: boolean;
}

export class ViewConfigPanelRenderer {
  render(
    containerEl: HTMLElement,
    visible: boolean,
    config: ViewConfig | undefined,
    actions: ViewConfigPanelActions,
    anchorEl?: HTMLElement
  ): void {
    const existingPanel = containerEl.querySelector(".db-view-config-panel");
    const savedScroll = (existingPanel as HTMLElement | null)?.scrollTop ?? 0;
    containerEl.querySelectorAll(".db-view-config-panel").forEach((el) => el.remove());
    if (!visible || !config) return;

    const panel = containerEl.createDiv({ cls: "db-view-config-panel" });
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("toolbar.settings") });

    if (actions.database) {
      this.renderSectionTitle(panel, t("viewConfig.databaseSection"));
      if (actions.isDatabaseReadOnly) {
        panel.createDiv({ cls: "db-view-config-readonly-note", text: t("viewConfig.databaseReadonly") });
      }
      this.renderDatabaseSettings(panel, actions.database, actions);
    }

    this.renderSectionTitle(panel, t("viewConfig.viewSection"));
    this.renderViewType(panel, config, actions);
    this.renderStatusPresetSettings(panel, {
      presets: actions.viewStatusPresets || [],
      defaultPresetId: actions.defaultViewStatusPresetId,
      onDefaultPresetChange: actions.onDefaultViewStatusPresetChange,
      onManagePresets: actions.onManageViewStatusPresets,
    });
    this.renderDefaultColumnWidth(panel, config, actions);
    if (config.viewType !== "table") {
      this.renderTitleField(panel, config, actions);
      this.renderCheckbox(panel, t("viewConfig.showEmptyFields"), config.showEmptyFields === true, (value) => {
        config.showEmptyFields = value || undefined;
        actions.onChange();
      });
    }
    if (config.viewType === "gallery") {
      this.renderGallerySettings(panel, config, actions);
      positionToolbarPopover(panel, anchorEl);
      if (savedScroll) panel.scrollTop = savedScroll;
      return;
    }
    if (config.viewType === "board") {
      this.renderBoardSettings(panel, config, actions);
      positionToolbarPopover(panel, anchorEl);
      if (savedScroll) panel.scrollTop = savedScroll;
      return;
    }
    positionToolbarPopover(panel, anchorEl);
    if (savedScroll) panel.scrollTop = savedScroll;
  }

  private renderSectionTitle(panel: HTMLElement, text: string): void {
    panel.createDiv({ cls: "db-view-config-section-title", text });
  }

  private renderViewType(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    this.renderSelect(
      panel,
      t("viewConfig.viewType"),
      [
        { value: "table", text: t("common.tableView") },
        { value: "board", text: t("common.boardView") },
        { value: "gallery", text: t("common.galleryView") },
        { value: "list", text: t("common.listView") },
      ],
      config.viewType || "table",
      (value) => {
        const next = value as DatabaseViewType;
        if (actions.onViewTypeChange) {
          actions.onViewTypeChange(next);
          return;
        }
        config.viewType = next;
        actions.onChange();
      }
    );
  }

  private renderDatabaseSettings(panel: HTMLElement, database: DatabaseConfig, actions: ViewConfigPanelActions): void {
    const readOnly = actions.isDatabaseReadOnly;
    const syncSourceFolder = (value: string) => {
      database.sourceFolder = value;
    };
    this.renderText(panel, t("viewConfig.databaseName"), database.name || "", t("settings.databaseName"), (value) => {
      database.name = value || t("common.untitledDatabase");
      actions.onDatabaseChange?.();
    }, readOnly, undefined, (value) => {
      database.name = value || t("common.untitledDatabase");
    });
    this.renderTextarea(panel, t("viewConfig.databaseDescription"), database.description || "", t("viewConfig.descriptionPlaceholder"), (value) => {
      database.description = value || undefined;
      actions.onDatabaseChange?.();
    }, readOnly, (value) => {
      database.description = value || undefined;
    });
    this.renderText(panel, t("viewConfig.sourceFolder"), database.sourceFolder || "", t("settings.sourceFolder.placeholder"), (value) => {
      syncSourceFolder(value);
      actions.onDatabaseChange?.();
    }, readOnly, t("settings.sourceFolder.desc"), (value) => {
      syncSourceFolder(value);
    });
    this.renderSourceRules(panel, database, actions, readOnly);
    this.renderNewRecordFolderSetting(panel, database, actions, readOnly);
    this.renderText(panel, t("viewConfig.typeFilter"), database.typeFilter || "", t("settings.typeFilter.placeholder"), (value) => {
      database.typeFilter = value || undefined;
      actions.onDatabaseChange?.();
    }, readOnly, t("settings.typeFilter.desc"), (value) => {
      database.typeFilter = value || undefined;
    });
    this.renderComputedSyncMode(panel, database, actions, readOnly);
    this.renderStatusPresetSettings(panel, {
      presets: actions.statusPresets || [],
      defaultPresetId: actions.defaultStatusPresetId,
      onDefaultPresetChange: actions.onDefaultStatusPresetChange,
      onManagePresets: actions.onManageStatusPresets,
    }, readOnly);
  }

  private renderSourceRules(
    panel: HTMLElement,
    database: DatabaseConfig,
    actions: ViewConfigPanelActions,
    readOnly?: boolean
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row db-source-rules-setting" });
    row.createDiv({ cls: "db-view-config-label", text: t("viewConfig.sourceRules") });
    const field = row.createDiv({ cls: "db-view-config-field" });
    field.createDiv({ cls: "db-view-config-help db-source-rules-help", text: t("viewConfig.sourceRules.help") });
    const editor = field.createDiv({ cls: "db-source-rules-editor" });
    const tree = getSourceRuleTree(database.sourceRuleTree, database.sourceRules, database.sourceLogic);
    if (tree && !database.sourceRuleTree && !readOnly) {
      database.sourceRuleTree = tree;
      database.sourceRules = undefined;
      database.sourceLogic = undefined;
    }
    const commit = (next: SourceRuleNode | undefined) => {
      database.sourceRuleTree = next;
      database.sourceRules = undefined;
      database.sourceLogic = undefined;
      actions.onDatabaseChange?.();
    };
    if (tree) {
      this.renderSourceRuleNode(editor, tree, commit, !!readOnly, database);
    } else {
      editor.createDiv({ cls: "db-source-rules-empty", text: t("viewConfig.sourceRules.empty") });
    }
    if (!readOnly && !tree) {
      const buttons = editor.createDiv({ cls: "db-source-rule-actions" });
      this.createSourceRuleIconButton(buttons, "plus", t("viewConfig.sourceRules.addRule"), () => {
        commit({ field: "file.name", op: "eq", value: "" });
      });
      this.createSourceRuleIconButton(buttons, "folder-plus", t("viewConfig.sourceRules.addGroup"), () => {
        commit({ type: "group", logic: "and", rules: [] });
      });
      this.createSourceRuleIconButton(buttons, "terminal", t("viewConfig.sourceRules.addExpression"), () => {
        commit({ type: "expression", expression: "" });
      });
    }
  }

  private renderSourceRuleNode(
    parent: HTMLElement,
    node: SourceRuleNode,
    onReplace: (node: SourceRuleNode | undefined) => void,
    readOnly: boolean,
    database: DatabaseConfig
  ): void {
    if (isSourceRuleGroup(node)) {
      this.renderSourceRuleGroup(parent, node, onReplace, readOnly, database);
      return;
    }
    if (isSourceRuleNot(node)) {
      const wrap = parent.createDiv({ cls: "db-source-rule-node db-source-rule-not" });
      const header = wrap.createDiv({ cls: "db-source-rule-header" });
      header.createSpan({ cls: "db-source-rule-not-label", text: t("viewConfig.sourceRules.not") });
      if (!readOnly) {
        const actions = header.createDiv({ cls: "db-source-rule-actions" });
        this.createSourceRuleIconButton(actions, "undo-2", t("viewConfig.sourceRules.removeNot"), () => onReplace(node.rule));
        this.createSourceRuleIconButton(actions, "trash-2", t("viewConfig.sourceRules.remove"), () => onReplace(undefined));
      }
      const content = wrap.createDiv({ cls: "db-source-rule-children" });
      this.renderSourceRuleNode(content, node.rule, (next) => next ? onReplace({ ...node, rule: next }) : onReplace(undefined), readOnly, database);
      return;
    }
    if (isSourceRuleExpression(node)) {
      this.renderSourceRuleExpression(parent, node, onReplace, readOnly);
      return;
    }
    this.renderSourceRuleLeaf(parent, node, onReplace, readOnly, database);
  }

  private renderSourceRuleGroup(
    parent: HTMLElement,
    group: SourceRuleGroup,
    onReplace: (node: SourceRuleNode | undefined) => void,
    readOnly: boolean,
    database: DatabaseConfig
  ): void {
    const wrap = parent.createDiv({ cls: "db-source-rule-node db-source-rule-group" });
    const header = wrap.createDiv({ cls: "db-source-rule-header" });
    const logic = header.createEl("select", { cls: "db-control-select db-source-rule-logic" });
    logic.createEl("option", { value: "and", text: t("viewConfig.sourceRules.and") });
    logic.createEl("option", { value: "or", text: t("viewConfig.sourceRules.or") });
    logic.value = group.logic;
    logic.disabled = readOnly;
    logic.onchange = () => onReplace({ ...group, logic: logic.value === "or" ? "or" : "and" });
    if (!readOnly) {
      const actions = header.createDiv({ cls: "db-source-rule-actions" });
      this.createSourceRuleIconButton(actions, "plus", t("viewConfig.sourceRules.addRule"), () => {
        onReplace({ ...group, rules: [...group.rules, { field: "file.name", op: "eq", value: "" }] });
      });
      this.createSourceRuleIconButton(actions, "folder-plus", t("viewConfig.sourceRules.addGroup"), () => {
        onReplace({ ...group, rules: [...group.rules, { type: "group", logic: "and", rules: [] }] });
      });
      this.createSourceRuleIconButton(actions, "terminal", t("viewConfig.sourceRules.addExpression"), () => {
        onReplace({ ...group, rules: [...group.rules, { type: "expression", expression: "" }] });
      });
      this.createSourceRuleIconButton(actions, "circle-slash-2", t("viewConfig.sourceRules.addNot"), () => {
        onReplace({ type: "not", rule: group });
      });
      this.createSourceRuleIconButton(actions, "trash-2", t("viewConfig.sourceRules.remove"), () => onReplace(undefined));
    }
    const children = wrap.createDiv({ cls: "db-source-rule-children" });
    if (group.rules.length === 0) {
      children.createDiv({ cls: "db-source-rules-empty", text: t("viewConfig.sourceRules.emptyGroup") });
    }
    for (let index = 0; index < group.rules.length; index += 1) {
      this.renderSourceRuleNode(children, group.rules[index], (next) => {
        const rules = [...group.rules];
        if (next) rules[index] = next;
        else rules.splice(index, 1);
        onReplace({ ...group, rules });
      }, readOnly, database);
    }
  }

  private renderSourceRuleLeaf(
    parent: HTMLElement,
    rule: SourceRule,
    onReplace: (node: SourceRuleNode | undefined) => void,
    readOnly: boolean,
    database: DatabaseConfig
  ): void {
    const wrap = parent.createDiv({ cls: "db-source-rule-node db-source-rule-leaf" });
    const controls = wrap.createDiv({ cls: "db-source-rule-leaf-controls" });
    const fieldGroups = this.getSourceRuleFieldGroups(database);
    const knownFields = new Set(fieldGroups.flatMap((group) => group.options.map((option) => option.value)));
    const field = controls.createEl("select", { cls: "db-control-select db-source-rule-field" });
    this.populateSourceRuleFieldSelect(field, fieldGroups);
    field.createEl("option", { value: CUSTOM_SOURCE_RULE_FIELD, text: t("viewConfig.sourceRules.customField") });
    const isKnownField = knownFields.has(rule.field);
    field.value = isKnownField ? rule.field : CUSTOM_SOURCE_RULE_FIELD;
    field.disabled = readOnly;
    const customField = controls.createEl("input", {
      cls: "db-view-config-text db-source-rule-custom-field",
      attr: { type: "text", placeholder: t("viewConfig.sourceRules.fieldPlaceholder") },
    });
    customField.value = isKnownField ? "" : rule.field;
    customField.disabled = readOnly;
    customField.style.display = isKnownField ? "none" : "";
    const operator = controls.createEl("select", { cls: "db-control-select db-source-rule-operator" });
    operator.disabled = readOnly;
    const value = controls.createEl("input", {
      cls: "db-view-config-text db-source-rule-value",
      attr: { type: "text", placeholder: t("viewConfig.sourceRules.valuePlaceholder") },
    });
    value.value = rule.value || "";
    const typeValue = controls.createEl("select", { cls: "db-control-select db-source-rule-value db-source-rule-type-value" });
    const updateValueDisabled = () => {
      const noValue = operator.value === "empty" || operator.value === "notempty" || operator.value === "truthy" || operator.value === "hasProperty";
      const isType = operator.value === "isType";
      value.style.display = isType ? "none" : "";
      typeValue.style.display = isType ? "" : "none";
      value.disabled = readOnly || isType || noValue;
      typeValue.disabled = readOnly || !isType;
    };
    const getFieldValue = () => (
      field.value === CUSTOM_SOURCE_RULE_FIELD ? customField.value.trim() : field.value
    );
    const populateOperators = (selectedOp: SourceRuleOperator, preserveUnsupported = true) => {
      operator.empty();
      const groups = getSourceRuleOperatorGroupsForField(database, getFieldValue(), preserveUnsupported ? selectedOp : undefined);
      for (const group of groups) {
        const optgroup = operator.createEl("optgroup", { attr: { label: group.label } });
        for (const op of group.operators) {
          optgroup.createEl("option", { value: op, text: t(`viewConfig.sourceRules.op.${op}`) });
        }
      }
      const recommended = groups.flatMap((group) => group.operators);
      operator.value = recommended.includes(selectedOp) ? selectedOp : getDefaultSourceRuleOperatorForField(database, getFieldValue());
    };
    const populateTypeValues = () => {
      const current = normalizeSourceRuleIsTypeValue(typeValue.value || value.value || rule.value || "");
      const fallback = getDefaultSourceRuleIsTypeValue(database, getFieldValue());
      const selected = current || fallback;
      typeValue.empty();
      for (const option of getSourceRuleIsTypeValueOptions(selected)) {
        typeValue.createEl("option", { value: option, text: option });
      }
      typeValue.value = selected;
      if (operator.value === "isType") {
        value.value = selected;
        rule.value = selected;
      }
    };
    populateOperators(rule.op);
    populateTypeValues();
    updateValueDisabled();
    const commit = () => {
      const op = operator.value as SourceRule["op"];
      const keepsValueType = op === "eq" || op === "neq" || op === "strictEq" || op === "strictNeq" || op === "contains";
      const nextValue = op === "isType" ? typeValue.value : value.value;
      onReplace({
        field: getFieldValue(),
        op,
        value: op === "empty" || op === "notempty" || op === "truthy" || op === "hasProperty" ? undefined : nextValue,
        valueType: keepsValueType ? rule.valueType : undefined,
      });
    };
    field.onchange = () => {
      const custom = field.value === CUSTOM_SOURCE_RULE_FIELD;
      customField.style.display = custom ? "" : "none";
      if (custom) {
        customField.focus();
      } else {
        rule.field = field.value;
        populateOperators(rule.op, false);
        populateTypeValues();
        updateValueDisabled();
        commit();
      }
    };
    customField.oninput = () => {
      rule.field = customField.value.trim();
      populateOperators(rule.op, false);
      populateTypeValues();
      updateValueDisabled();
    };
    customField.onchange = () => {
      populateOperators(rule.op, false);
      populateTypeValues();
      updateValueDisabled();
      commit();
    };
    operator.onchange = () => {
      populateTypeValues();
      updateValueDisabled();
      commit();
    };
    value.oninput = () => { rule.value = value.value; };
    value.onchange = commit;
    typeValue.onchange = () => {
      value.value = typeValue.value;
      rule.value = typeValue.value;
      commit();
    };
    if (!readOnly) {
      const actions = controls.createDiv({ cls: "db-source-rule-actions" });
      this.createSourceRuleIconButton(actions, "circle-slash-2", t("viewConfig.sourceRules.addNot"), () => {
        onReplace({ type: "not", rule });
      });
      this.createSourceRuleIconButton(actions, "trash-2", t("viewConfig.sourceRules.remove"), () => onReplace(undefined));
    }
  }

  private getSourceRuleFieldGroups(database: DatabaseConfig): SourceRuleFieldGroup[] {
    const seen = new Set<string>();
    const unique = (options: SourceRuleFieldOption[]) => options.filter((option) => {
      if (!option.value || seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
    const columns = getSourceRuleColumns(database);
    const noteProperties = unique(columns
      .filter((col) => col.type !== "computed" && !isBaseFileField(col.key))
      .map((col) => ({
        value: col.key,
        label: col.label && col.label !== col.key ? `${col.label} (${col.key})` : col.key,
      })));
    const formulaProperties = unique(columns
      .filter((col) => col.type === "computed")
      .map((col) => {
        const key = col.computedKey || (col.key.startsWith("formula.") ? col.key.slice("formula.".length) : col.key);
        const value = `formula.${key}`;
        return {
          value,
          label: col.label && col.label !== value ? `${col.label} (${value})` : value,
        };
      }));
    const fileProperties = unique(Array.from(BASE_FILE_FIELD_KEYS).map((key) => ({
      value: key,
      label: key,
    })));
    return [
      { label: t("viewConfig.sourceRules.fieldGroup.noteProperties"), options: noteProperties },
      { label: t("viewConfig.sourceRules.fieldGroup.formulaProperties"), options: formulaProperties },
      { label: t("viewConfig.sourceRules.fieldGroup.fileProperties"), options: fileProperties },
    ].filter((group) => group.options.length > 0);
  }

  private populateSourceRuleFieldSelect(select: HTMLSelectElement, groups: SourceRuleFieldGroup[]): void {
    for (const group of groups) {
      const optgroup = select.createEl("optgroup", { attr: { label: group.label } });
      for (const option of group.options) {
        optgroup.createEl("option", { value: option.value, text: option.label });
      }
    }
  }

  private renderSourceRuleExpression(
    parent: HTMLElement,
    rule: { type: "expression"; expression: string },
    onReplace: (node: SourceRuleNode | undefined) => void,
    readOnly: boolean
  ): void {
    const wrap = parent.createDiv({ cls: "db-source-rule-node db-source-rule-expression" });
    const controls = wrap.createDiv({ cls: "db-source-rule-leaf-controls" });
    const expression = controls.createEl("textarea", {
      cls: "db-view-config-text db-source-rule-expression-input",
      attr: { rows: "2", placeholder: t("viewConfig.sourceRules.expressionPlaceholder") },
    });
    expression.value = rule.expression;
    expression.disabled = readOnly;
    expression.oninput = () => { rule.expression = expression.value.trim(); };
    expression.onchange = () => onReplace({ type: "expression", expression: expression.value.trim() });
    if (!readOnly) {
      const actions = controls.createDiv({ cls: "db-source-rule-actions" });
      this.createSourceRuleIconButton(actions, "circle-slash-2", t("viewConfig.sourceRules.addNot"), () => {
        onReplace({ type: "not", rule });
      });
      this.createSourceRuleIconButton(actions, "trash-2", t("viewConfig.sourceRules.remove"), () => onReplace(undefined));
    }
  }

  private createSourceRuleIconButton(parent: HTMLElement, icon: string, title: string, onClick: () => void): void {
    const button = parent.createEl("button", { cls: "db-source-rule-icon-button", attr: { type: "button", title, "aria-label": title } });
    setIcon(button, icon);
    button.onclick = onClick;
  }

  private renderComputedSyncMode(
    panel: HTMLElement,
    database: DatabaseConfig,
    actions: ViewConfigPanelActions,
    readOnly?: boolean
  ): void {
    const mode = normalizeComputedSyncMode(database.computedSyncMode);
    const options: Array<{ value: ComputedSyncMode; title: string; desc: string }> = [
      {
        value: "display-only",
        title: t("viewConfig.computedSync.displayOnly"),
        desc: t("viewConfig.computedSync.displayOnlyDesc"),
      },
      {
        value: "manual",
        title: t("viewConfig.computedSync.manual"),
        desc: t("viewConfig.computedSync.manualDesc"),
      },
      {
        value: "automatic",
        title: t("viewConfig.computedSync.automatic"),
        desc: t("viewConfig.computedSync.automaticDesc"),
      },
    ];
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: t("viewConfig.computedSyncMode") });
    const field = row.createDiv({ cls: "db-view-config-field" });
    if (readOnly) {
      field.createDiv({
        cls: "db-view-config-readonly-value",
        text: options.find((option) => option.value === mode)?.title || t("viewConfig.computedSync.displayOnly"),
      });
      field.createDiv({ cls: "db-view-config-help", text: t("viewConfig.computedSync.help") });
      return;
    }

    const cards = field.createDiv({ cls: "db-computed-sync-cards" });
    const syncActiveCard = () => {
      const activeMode = normalizeComputedSyncMode(database.computedSyncMode);
      for (const card of cards.querySelectorAll<HTMLElement>(".db-computed-sync-card")) {
        const input = card.querySelector<HTMLInputElement>("input");
        const active = input?.value === activeMode;
        if (input) input.checked = active;
        card.toggleClass("is-active", active);
      }
    };
    const changeMode = (rawNextMode: ComputedSyncMode): boolean => {
      const nextMode = normalizeComputedSyncMode(rawNextMode);
      const previousMode = normalizeComputedSyncMode(database.computedSyncMode);
      if (nextMode === previousMode) return true;
      if (previousMode === "display-only" && nextMode === "automatic") {
        const confirmed = window.confirm(t("viewConfig.computedSync.confirmAutomatic"));
        if (!confirmed) return false;
      }
      database.computedSyncMode = nextMode;
      actions.onDatabaseChange?.();
      actions.onComputedSyncModeChange?.();
      if (previousMode === "display-only" && nextMode === "manual") {
        new Notice(t("viewConfig.computedSync.manualHint"));
      } else if (nextMode === "display-only" && previousMode !== "display-only") {
        new Notice(t("viewConfig.computedSync.displayOnlyHint"));
      }
      syncActiveCard();
      return true;
    };
    for (const option of options) {
      const card = cards.createEl("label", {
        cls: `db-computed-sync-card${option.value === mode ? " is-active" : ""}`,
      });
      const radio = card.createEl("input", {
        attr: { type: "radio", name: "computed-sync-mode", value: option.value },
      });
      radio.checked = option.value === mode;
      radio.onchange = () => {
        if (!radio.checked) return;
        if (!changeMode(option.value)) syncActiveCard();
      };
      const body = card.createDiv({ cls: "db-computed-sync-card-body" });
      body.createDiv({ cls: "db-computed-sync-card-title", text: option.title });
      body.createDiv({ cls: "db-computed-sync-card-desc", text: option.desc });
    }
    field.createDiv({ cls: "db-view-config-help", text: t("viewConfig.computedSync.help") });
  }

  private renderStatusPresetSettings(
    panel: HTMLElement,
    options: {
      presets: StatusPresetDef[];
      defaultPresetId?: string;
      onDefaultPresetChange?(presetId: string): void;
      onManagePresets?(): void;
    },
    readOnly?: boolean
  ): void {
    const presets = options.presets || [];
    if (presets.length === 0) return;
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: t("viewConfig.statusPreset") });
    const field = row.createDiv({ cls: "db-view-config-field db-view-config-inline-controls" });
    if (readOnly) {
      const current = presets.find((preset) => preset.id === options.defaultPresetId) || presets[0];
      field.createDiv({ cls: "db-view-config-readonly-value", text: current?.name || t("common.notSet") });
      return;
    }
    const select = field.createEl("select", { cls: "db-control-select" });
    for (const preset of presets) select.createEl("option", { value: preset.id, text: preset.name });
    select.value = options.defaultPresetId || presets[0]?.id || "";
    select.onchange = () => options.onDefaultPresetChange?.(select.value);
    const button = field.createEl("button", { text: t("statusPresets.manage"), attr: { type: "button" } });
    button.onclick = () => options.onManagePresets?.();
  }

  private renderNewRecordFolderSetting(
    panel: HTMLElement,
    database: DatabaseConfig,
    actions: ViewConfigPanelActions,
    readOnly?: boolean
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: t("viewConfig.newRecordFolder") });
    const field = row.createDiv({ cls: "db-view-config-field" });

    if (readOnly) {
      field.createDiv({
        cls: "db-view-config-readonly-value",
        text: database.newRecordFolder || t("common.untitled"),
      });
      return;
    }
      const input = field.createEl("input", {
        cls: "db-view-config-text",
        attr: { type: "text", placeholder: t("settings.sourceFolder.placeholder") },
      });
      input.value = database.newRecordFolder || "";
      input.oninput = () => {
        database.newRecordFolder = input.value.trim() || undefined;
      };
      input.onchange = () => {
        database.newRecordFolder = input.value.trim() || undefined;
        actions.onDatabaseChange?.();
      };
    field.createDiv({ cls: "db-view-config-help", text: t("viewConfig.newRecordFolderLocked") });
  }

  private renderGallerySettings(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    this.renderSelect(
      panel,
      t("viewConfig.coverField"),
      [
        { value: "", text: t("viewConfig.noCover") },
        ...config.schema.columns
          .filter((col) => col.key !== "file.name")
          .map((col) => ({ value: col.key, text: col.label })),
      ],
      config.galleryImageField || "",
      (value) => {
        config.galleryImageField = value || undefined;
        actions.onChange();
      }
    );

    this.renderSelect(
      panel,
      t("viewConfig.imageFit"),
      [
        { value: "cover", text: t("viewConfig.cover") },
        { value: "contain", text: t("viewConfig.contain") },
      ],
      config.galleryImageFit || "cover",
      (value) => {
        config.galleryImageFit = value === "contain" ? "contain" : "cover";
        actions.onChange();
      }
    );

    const setGalleryCardSize = (value: number) => {
      config.galleryCardSize = value;
    };
    this.renderRange(panel, t("viewConfig.cardSize"), config.galleryCardSize || 250, 160, 420, 10, (value) => {
      setGalleryCardSize(value);
      actions.onChange();
    }, setGalleryCardSize);

    const ratioOptions = [
      { value: "0.6", text: t("viewConfig.ratioPortrait") },
      { value: "0.75", text: t("viewConfig.ratioClassic") },
      { value: "1", text: t("viewConfig.ratioSquare") },
      { value: "1.333", text: t("viewConfig.ratioLandscape") },
      { value: "1.777", text: t("viewConfig.ratioWide") },
    ];
    const ratio = String(config.galleryImageAspectRatio || 0.75);
    if (!ratioOptions.some((item) => item.value === ratio)) {
      ratioOptions.push({ value: ratio, text: t("viewConfig.ratioCurrent", { ratio }) });
    }
    this.renderSelect(panel, t("viewConfig.coverRatio"), ratioOptions, ratio, (value) => {
      const next = Number(value);
      if (Number.isFinite(next)) {
        config.galleryImageAspectRatio = next;
        actions.onChange();
      }
    });
  }

  private renderTitleField(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    this.renderSelect(
      panel,
      t("viewConfig.titleField"),
      [
        { value: "", text: t("viewConfig.titleAuto") },
        { value: NO_TITLE_FIELD, text: t("viewConfig.noTitle") },
        ...config.schema.columns.map((col) => ({ value: col.key, text: col.label })),
      ],
      config.titleField || "",
      (value) => {
        config.titleField = value || undefined;
        actions.onChange();
      }
    );
  }

  private renderBoardSettings(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    const groupField = config.boardGroupField || config.groupByField || "";
    this.renderSelect(
      panel,
      t("viewConfig.boardSubgroupField"),
      [
        { value: "", text: t("viewConfig.noSubgroup") },
        ...config.schema.columns
          .filter((col) => col.key !== "file.name" && col.key !== groupField)
          .map((col) => ({ value: col.key, text: col.label })),
      ],
      config.boardSubgroupField || "",
      (value) => {
        config.boardSubgroupField = value || undefined;
        actions.onChange();
      }
    );
    const setBoardColumnWidth = (value: number) => {
      config.boardColumnWidth = value;
    };
    this.renderRange(panel, t("viewConfig.boardColumnWidth"), config.boardColumnWidth || 280, 220, 520, 10, (value) => {
      setBoardColumnWidth(value);
      actions.onChange();
    }, setBoardColumnWidth);
  }

  private renderDefaultColumnWidth(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    const setDefaultColumnWidth = (value: number) => {
      const next = Math.max(80, Math.min(800, Math.round(value)));
      config.defaultColumnWidth = next;
      const columnWidths = { ...(config.columnWidths || {}) };
      for (const col of config.schema.columns) {
        if (col.key === "file.name") continue;
        columnWidths[col.key] = next;
      }
      config.columnWidths = columnWidths;
    };
    this.renderRange(panel, t("viewConfig.defaultColumnWidth"), this.getDefaultColumnWidth(config), 80, 800, 10, (value) => {
      setDefaultColumnWidth(value);
      actions.onChange();
    }, setDefaultColumnWidth);
  }

  private getDefaultColumnWidth(config: ViewConfig): number {
    if (config.defaultColumnWidth) return config.defaultColumnWidth;
    const columns = config.schema.columns.filter((col) => col.key !== "file.name");
    if (columns.length === 0) return 150;
    const total = columns.reduce((sum, col) => sum + (config.columnWidths?.[col.key] || col.width || 150), 0);
    return Math.round(total / columns.length);
  }

  private renderSelect(
    panel: HTMLElement,
    label: string,
    options: Array<{ value: string; text: string }>,
    value: string,
    onChange: (value: string) => void
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    const select = row.createEl("select", { cls: "db-control-select" });
    for (const option of options) {
      select.createEl("option", { value: option.value, text: option.text });
    }
    select.value = value;
    select.onchange = () => onChange(select.value);
  }

  private renderText(
    panel: HTMLElement,
    label: string,
    value: string,
    placeholder: string,
    onChange: (value: string) => void,
    disabled = false,
    helpText?: string,
    onInput?: (value: string) => void
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    const field = row.createDiv({ cls: "db-view-config-field" });
    if (disabled) {
      field.createDiv({ cls: "db-view-config-readonly-value", text: value || t("common.notSet") });
      if (helpText) field.createDiv({ cls: "db-view-config-help", text: helpText });
      return;
    }
    const input = field.createEl("input", {
      cls: "db-view-config-text",
      attr: { type: "text", placeholder },
    });
    input.value = value;
    input.oninput = () => onInput?.(input.value.trim());
    input.onchange = () => onChange(input.value.trim());
    if (helpText) field.createDiv({ cls: "db-view-config-help", text: helpText });
  }

  private renderTextarea(
    panel: HTMLElement,
    label: string,
    value: string,
    placeholder: string,
    onChange: (value: string) => void,
    disabled = false,
    onInput?: (value: string) => void
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    if (disabled) {
      row.createDiv({ cls: "db-view-config-readonly-value db-view-config-readonly-multiline", text: value || t("common.notSet") });
      return;
    }
    const textarea = row.createEl("textarea", {
      cls: "db-view-config-textarea",
      attr: { placeholder, rows: "3" },
    });
    textarea.value = value;
    textarea.oninput = () => onInput?.(textarea.value.trim());
    textarea.onchange = () => onChange(textarea.value.trim());
  }

  private renderCheckbox(
    panel: HTMLElement,
    label: string,
    value: boolean,
    onChange: (value: boolean) => void,
    disabled = false,
    helpText?: string
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    const field = row.createDiv({ cls: "db-view-config-field" });
    if (disabled) {
      field.createDiv({ cls: "db-view-config-readonly-value", text: value ? t("common.true") : t("common.false") });
      if (helpText) field.createDiv({ cls: "db-view-config-help", text: helpText });
      return;
    }
    const input = field.createEl("input", { attr: { type: "checkbox" } });
    input.checked = value;
    input.onchange = () => onChange(input.checked);
    if (helpText) field.createDiv({ cls: "db-view-config-help", text: helpText });
  }

  private renderRange(
    panel: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
    onInput?: (value: number) => void
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    const controls = row.createDiv({ cls: "db-view-config-range" });
    const range = controls.createEl("input", {
      attr: { type: "range", min: String(min), max: String(max), step: String(step) },
    });
    const number = controls.createEl("input", {
      cls: "db-view-config-number",
      attr: { type: "number", min: String(min), max: String(max), step: String(step) },
    });
    const clamped = Math.max(min, Math.min(max, Math.round(value)));
    range.value = String(clamped);
    number.value = String(clamped);
    const clamp = (next: number): number => Math.max(min, Math.min(max, Math.round(next)));
    range.oninput = () => {
      number.value = range.value;
      onInput?.(clamp(Number(range.value)));
    };
    range.onchange = () => onChange(Number(range.value));
    number.oninput = () => {
      const raw = Number(number.value);
      if (!Number.isFinite(raw)) return;
      const next = clamp(raw);
      range.value = String(next);
      onInput?.(next);
    };
    number.onchange = () => {
      const next = clamp(Number(number.value) || value);
      number.value = String(next);
      range.value = String(next);
      onChange(next);
    };
  }
}
