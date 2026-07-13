import { App, Modal, Notice } from "obsidian";
import { ColumnDef } from "../../data/types";
import { t } from "../../i18n";

export class CreateRecordIconFieldModal extends Modal {
  constructor(
    app: App,
    private columns: ColumnDef[],
    private onCreate: (key: string, label: string) => Promise<boolean>,
  ) { super(app); }

  onOpen(): void {
    const conflict = this.columns.some((column) => column.key === "icon");
    const suggested = conflict ? "record_icon" : "icon";
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: t("recordIcon.createField") });
    const keyInput = this.createInput(t("modal.propertyKey"), suggested);
    const labelInput = this.createInput(t("modal.displayName"), suggested);
    if (conflict) this.contentEl.createDiv({ cls: "setting-item-description", text: t("recordIcon.iconKeyConflict") });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const create = actions.createEl("button", { text: t("common.create"), cls: "mod-cta" });
    create.onclick = async () => {
      const key = keyInput.value.trim();
      const label = labelInput.value.trim() || key;
      if (!key) { new Notice(t("modal.propertyKeyRequired")); return; }
      if (key.startsWith("file.")) { new Notice(t("recordIcon.fileKeyInvalid")); return; }
      if (this.columns.some((column) => column.key === key)) { new Notice(t("modal.propertyKeyExists", { key })); return; }
      create.disabled = true;
      try { if (await this.onCreate(key, label)) this.close(); } finally { create.disabled = false; }
    };
    window.setTimeout(() => { keyInput.focus(); keyInput.select(); }, 0);
  }

  private createInput(label: string, value: string): HTMLInputElement {
    this.contentEl.createEl("label", { text: label, attr: { style: "display:block;margin-top:10px;font-size:12px;font-weight:600" } });
    const input = this.contentEl.createEl("input", { attr: { type: "text", style: "width:100%;margin-top:4px" } });
    input.value = value;
    return input;
  }

  onClose(): void { this.contentEl.empty(); }
}
