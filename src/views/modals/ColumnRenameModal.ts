import { App, Modal, Notice } from "obsidian";
import { ColumnDef } from "../../data/types";
import { t } from "../../i18n";

export interface ColumnRenameResult {
  key: string;
  label: string;
  migrateValues: boolean;
  wrap: boolean;
}

export class ColumnRenameModal extends Modal {
  constructor(
    app: App,
    private col: ColumnDef,
    private allColumns: ColumnDef[],
    private onSave: (result: ColumnRenameResult) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.createEl("h3", { text: t("modal.editProperty", { label: this.col.label }) });

    const keyLabel = contentEl.createEl("label", {
      text: t("modal.propertyKey"),
      cls: "db-modal-label",
    });
    const keyInput = contentEl.createEl("input", {
      attr: { type: "text" },
      cls: "db-modal-input",
    });
    keyInput.value = this.col.key;
    keyInput.disabled = this.col.key === "file.name";
    keyLabel.title = t("modal.propertyKeyHint");

    contentEl.createEl("label", {
      text: t("modal.displayName"),
      cls: "db-modal-label",
    });
    const labelInput = contentEl.createEl("input", {
      attr: { type: "text" },
      cls: "db-modal-input",
    });
    labelInput.value = this.col.label;

    const wrapRow = contentEl.createEl("label", { cls: "db-modal-row" });
    const wrapCheckbox = wrapRow.createEl("input", { attr: { type: "checkbox" } });
    wrapCheckbox.checked = !!this.col.wrap;
    wrapRow.createSpan({ text: t("modal.wrapContent") });

    const canMigrate = this.col.key !== "file.name" && this.col.type !== "computed";
    const migrateRow = contentEl.createEl("label", { cls: "db-modal-row" });
    const migrateCheckbox = migrateRow.createEl("input", { attr: { type: "checkbox" } });
    migrateCheckbox.checked = canMigrate;
    migrateCheckbox.disabled = !canMigrate;
    migrateRow.createSpan({ text: t("modal.migrateValues") });
    const helpIcon = migrateRow.createSpan({
      cls: "db-migrate-help-icon",
      text: "?",
      attr: { title: t("modal.migrateValuesDesc"), tabindex: "0" },
    });
    helpIcon.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const buttonRow = contentEl.createDiv({ cls: "db-modal-button-row" });
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
      await this.onSave({ key, label, migrateValues: migrateCheckbox.checked, wrap: wrapCheckbox.checked });
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
