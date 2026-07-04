import { App, Modal, Notice } from "obsidian";
import { isFileFieldKey } from "../../data/FileFields";
import { ColumnDef, ComputedFieldDef, NumberDisplayStyle } from "../../data/types";
import { t } from "../../i18n";
import { createDropdownField } from "../DropdownField";
import { isNumberDisplayColumn } from "../../data/ColumnDisplay";

export interface ColumnRenameResult {
  key: string;
  label: string;
  migrateValues: boolean;
  wrap: boolean;
  /** Only present for number columns (plain/rating/progress). */
  numberDisplayStyle?: NumberDisplayStyle;
}

export class ColumnRenameModal extends Modal {
  constructor(
    app: App,
    private col: ColumnDef,
    private allColumns: ColumnDef[],
    private onSave: (result: ColumnRenameResult) => Promise<void | boolean>,
    private computedFields: ComputedFieldDef[] = []
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("modal.editProperty", { label: this.col.label }) });

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

    const wrapRow = contentEl.createEl("label", {
      attr: { style: "display: flex; gap: 8px; align-items: center; margin-top: 10px; font-size: 12px;" },
    });
    const wrapCheckbox = wrapRow.createEl("input", { attr: { type: "checkbox" } });
    wrapCheckbox.checked = !!this.col.wrap;
    wrapRow.createSpan({ text: t("modal.wrapContent") });

    let numberDisplayStyle: NumberDisplayStyle | undefined;
    if (isNumberDisplayColumn(this.col, this.computedFields)) {
      numberDisplayStyle = this.col.numberDisplayStyle ?? "plain";
      const styleRow = contentEl.createDiv({
        attr: { style: "margin-top: 10px; font-size: 12px;" },
      });
      createDropdownField({
        parent: styleRow,
        label: t("modal.numberDisplayStyle"),
        value: numberDisplayStyle,
        options: [
          { value: "plain", text: t("menu.numberStylePlain") },
          { value: "rating", text: t("menu.numberStyleRating") },
          { value: "progress", text: t("menu.numberStyleProgress") },
          { value: "ring", text: t("menu.numberStyleRing") },
        ],
        onChange: (value) => { numberDisplayStyle = value as NumberDisplayStyle; },
      });
    }

    const canMigrate = !fileField && this.col.type !== "computed";
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
      if (this.col.type === "computed") {
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
      };
      if (numberDisplayStyle !== undefined) result.numberDisplayStyle = numberDisplayStyle;
      const saved = await this.onSave(result);
      if (saved !== false) this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
