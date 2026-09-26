import { App, Modal, Notice } from "obsidian";
import { makeModalDraggable } from "./ModalDrag";
import { isFileFieldKey } from "../../data/FileFields";
import { ColumnDef, NumberDisplayStyle } from "../../data/types";
import { COLUMN_TYPE_LABELS, isColumnType } from "../../data/ColumnTypes";
import { createDropdownField } from "../DropdownField";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon } from "../PropertyTypeIcon";
import { getNumberDisplayStyleIcon, renderDisplayStyleDropdownIcon } from "../NumberDisplayStyleIcon";
import { t } from "../../i18n";

export interface ColumnRenameResult {
  key: string;
  label: string;
  migrateValues: boolean;
  wrap: boolean;
  type: ColumnDef["type"];
  textRenderMode?: "plain" | "link" | "markdown";
  numberDisplayStyle?: NumberDisplayStyle;
}

const PROPERTY_TYPES: ColumnDef["type"][] = [
  "text", "number", "date", "datetime", "currency", "checkbox",
  "select", "multi-select", "status", "computed", "relation", "rollup",
];

export class ColumnRenameModal extends Modal {
  constructor(
    app: App,
    private col: ColumnDef,
    private allColumns: ColumnDef[],
    private onSave: (result: ColumnRenameResult) => Promise<void | boolean>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.createEl("h3", { text: t("modal.editProperty", { label: this.col.label }) });

    makeModalDraggable(this);
    const keyLabel = contentEl.createEl("label", {
      text: t("modal.propertyKey"),
      attr: { style: "display: block; margin-top: 8px; font-size: 12px; font-weight: 600;" },
    });
    const keyInput = contentEl.createEl("input", {
      attr: { type: "text", style: "width: 100%; margin-top: 4px;" },
    });
    keyInput.value = this.col.key;
    const fileField = isFileFieldKey(this.col.key);
    keyInput.disabled = fileField;
    keyLabel.title = fileField ? t("fileField.fixedType") : t("modal.propertyKeyHint");

    contentEl.createEl("label", {
      text: t("modal.displayName"),
      attr: { style: "display: block; margin-top: 8px; font-size: 12px; font-weight: 600;" },
    });
    const labelInput = contentEl.createEl("input", {
      attr: { type: "text", style: "width: 100%; margin-top: 4px;" },
    });
    labelInput.value = this.col.label;

    let selectedType = this.col.type;
    let textRenderMode: "plain" | "link" | "markdown" = this.col.textRenderMode ?? "plain";
    let numberDisplayStyle: NumberDisplayStyle = this.col.numberDisplayStyle ?? "plain";
    const typeRow = contentEl.createDiv({ cls: "db-modal-row" });
    typeRow.createEl("label", { cls: "db-modal-label", text: t("modal.propertyType") });
    const styleRow = contentEl.createDiv({ cls: "db-modal-row" });
    const renderStyle = (): void => {
      styleRow.empty();
      styleRow.style.display = selectedType === "text" || selectedType === "number" ? "" : "none";
      if (selectedType !== "text" && selectedType !== "number") return;
      styleRow.createEl("label", { cls: "db-modal-label", text: t("menu.numberDisplayStyle") });
      const options = selectedType === "text"
        ? [
          { value: "plain", text: t("menu.textRenderPlain"), icon: "type" },
          { value: "link", text: t("menu.textRenderLink"), icon: "link" },
          { value: "markdown", text: t("menu.textRenderMarkdown"), icon: "square-m" },
        ]
        : ([
          { value: "plain", text: t("menu.numberStylePlain"), icon: getNumberDisplayStyleIcon("plain") },
          { value: "rating", text: t("menu.numberStyleRating"), icon: getNumberDisplayStyleIcon("rating") },
          { value: "progress", text: t("menu.numberStyleProgress"), icon: getNumberDisplayStyleIcon("progress") },
          { value: "ring", text: t("menu.numberStyleRing"), icon: getNumberDisplayStyleIcon("ring") },
        ]);
      createDropdownField({
        parent: styleRow,
        label: t("menu.numberDisplayStyle"),
        options,
        value: selectedType === "text" ? textRenderMode : numberDisplayStyle,
        className: "db-modal-dropdown",
        hideLabel: true,
        renderIcon: renderDisplayStyleDropdownIcon,
        onChange: (value) => {
          if (selectedType === "text" && (value === "plain" || value === "link" || value === "markdown")) textRenderMode = value;
          if (selectedType === "number" && (value === "plain" || value === "rating" || value === "progress" || value === "ring")) numberDisplayStyle = value;
        },
      });
    };
    createDropdownField({
      parent: typeRow,
      label: t("modal.propertyType"),
      options: PROPERTY_TYPES.map((type) => ({
        value: type,
        text: COLUMN_TYPE_LABELS()[type],
        icon: getPropertyDropdownIcon(type),
        ...(type === "rollup" && !this.allColumns.some((candidate) => candidate !== this.col && candidate.type === "relation")
          ? { disabled: true, disabledReason: t("modal.rollupNeedsRelation") }
          : {}),
      })),
      value: selectedType,
      className: "db-modal-dropdown",
      hideLabel: true,
      renderIcon: renderDropdownPropertyTypeIcon,
      disabled: fileField,
      disabledReason: fileField ? t("fileField.fixedType") : undefined,
      onChange: (value) => {
        if (!isColumnType(value)) return;
        selectedType = value;
        renderStyle();
      },
    });
    renderStyle();

    const wrapRow = contentEl.createEl("label", {
      attr: { style: "display: flex; gap: 8px; align-items: center; margin-top: 10px; font-size: 12px;" },
    });
    const wrapCheckbox = wrapRow.createEl("input", { attr: { type: "checkbox" } });
    wrapCheckbox.checked = !!this.col.wrap;
    wrapRow.createSpan({ text: t("modal.wrapContent") });

    const canMigrate = !fileField && this.col.type !== "computed" && this.col.type !== "rollup";
    let migrateCheckbox: HTMLInputElement | undefined;
    if (!fileField) {
      const migrateRow = contentEl.createDiv({
        attr: { style: "display: flex; gap: 8px; align-items: center; margin-top: 10px; font-size: 12px;" },
      });
      const migrateLabel = migrateRow.createEl("label", {
        attr: { style: "display: flex; gap: 8px; align-items: center; flex: 1; min-width: 0;" },
      });
      migrateCheckbox = migrateLabel.createEl("input", { attr: { type: "checkbox" } });
      migrateCheckbox.checked = !canMigrate;
      migrateCheckbox.disabled = !canMigrate;
      if (this.col.type === "computed" || this.col.type === "rollup") {
        migrateCheckbox.title = t("modal.migrateComputedDisabled");
        migrateLabel.title = t("modal.migrateComputedDisabled");
      }
      migrateLabel.createSpan({ text: t("modal.migrateValues") });
      const migrateHelpText = t("modal.migrateValuesDesc");
      const helpIcon = migrateRow.createEl("button", {
        cls: "db-migrate-help-icon",
        text: "?",
        attr: { type: "button", title: migrateHelpText, "aria-label": migrateHelpText },
      });
      helpIcon.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        new Notice(migrateHelpText, 8000);
      };
    }

    const buttonRow = contentEl.createDiv({
      attr: { style: "display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;" },
    });
    buttonRow.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const saveBtn = buttonRow.createEl("button", { text: t("common.save"), cls: "mod-cta" });
    saveBtn.onclick = async () => {
      const key = keyInput.value.trim();
      const label = labelInput.value.trim() || key;
      if (!key) {
        new Notice(t("modal.propertyKeyRequired"));
        return;
      }
      const duplicate = this.allColumns.some((c) => c !== this.col && c.key === key);
      if (duplicate) {
        new Notice(t("modal.propertyKeyExists", { key }));
        return;
      }
      const result: ColumnRenameResult = {
        key,
        label,
        migrateValues: migrateCheckbox?.checked ?? false,
        wrap: wrapCheckbox.checked,
        type: selectedType,
        textRenderMode: selectedType === "text" ? textRenderMode : undefined,
        numberDisplayStyle: selectedType === "number" ? numberDisplayStyle : undefined,
      };
      const saved = await this.onSave(result);
      if (saved !== false) this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
