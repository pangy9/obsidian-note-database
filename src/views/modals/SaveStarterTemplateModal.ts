import { App, Modal, Notice, Setting } from "obsidian";
import { DatabaseConfig, RowData, StatusPresetDef } from "../../data/types";
import { MAX_STARTER_SAMPLES, VAULT_STARTER_FOLDER, createVaultStarter, saveVaultStarter } from "../../data/VaultStarterTemplates";
import { parseRecordTemplate } from "../../data/RecordTemplate";
import type { StarterSampleRecord } from "../../data/DatabaseStarterTemplates";
import { t } from "../../i18n";
import { openIconPickerPopover } from "../IconPickerPopover";
import { renderRecordIcon } from "../RecordIconRenderer";
import { makeModalDraggable } from "./ModalDrag";

export class SaveStarterTemplateModal extends Modal {
  private closePicker?: () => void;
  constructor(app: App, private database: DatabaseConfig, private rows: RowData[], private presets: StatusPresetDef[]) {
    super(app);
  }

  onOpen(): void {
    const host = this.contentEl;
    host.addClass("note-database-container", "note-database-modal");
    host.createEl("h3", { text: t("starter.custom.save") });
    makeModalDraggable(this);
    let name = this.database.name;
    let description = this.database.description || "";
    let includeSamples = false;
    new Setting(host).setName(t("starter.custom.name")).addText((input) => input.setValue(name).onChange((value) => {
      name = value;
      save.disabled = !name.trim();
    }));
    new Setting(host).setName(t("starter.custom.description")).addTextArea((input) => input.setValue(description).onChange((value) => { description = value; }));
    const iconRow = new Setting(host).setName(t("starter.custom.icon"));
    const renderIcon = () => {
      iconRow.controlEl.empty();
      renderRecordIcon(iconRow.controlEl, this.database.icon, {
        defaultIcon: "database", editable: true, tooltip: t("starter.custom.icon"),
        onClick: (anchor) => {
          this.closePicker?.();
          this.closePicker = openIconPickerPopover({ anchor, current: this.database.icon, onSelect: (value) => {
            this.database.icon = value || undefined;
            renderIcon();
          } });
        },
      });
    };
    renderIcon();
    new Setting(host).setName(t("starter.custom.samples")).setDesc(t("starter.custom.samplesHint", { count: Math.min(this.rows.length, MAX_STARTER_SAMPLES), max: MAX_STARTER_SAMPLES }))
      .addToggle((toggle) => toggle.setValue(false).onChange((value) => { includeSamples = value; }));
    host.createEl("p", { cls: "db-modal-help", text: t("starter.custom.scope") });
    host.createEl("p", { cls: "db-modal-help", text: t("starter.custom.dependencies") });
    host.createEl("p", { cls: "db-modal-help", text: t("starter.custom.location", { path: VAULT_STARTER_FOLDER }) });
    const buttons = host.createDiv({ cls: "db-delete-modal-buttons" });
    buttons.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const save = buttons.createEl("button", { cls: "mod-cta", text: t("common.save") });
    save.onclick = async () => {
      if (!name.trim() || save.disabled) return;
      save.disabled = true;
      try {
        const samples: StarterSampleRecord[] = [];
        if (includeSamples) {
          const unique = [...new Map(this.rows.map((row) => [row.file.path, row])).values()];
          for (const row of unique.slice(0, MAX_STARTER_SAMPLES)) {
            const parsed = parseRecordTemplate(await this.app.vault.read(row.file), "markdown");
            samples.push({ filename: row.file.basename, frontmatter: parsed.frontmatter, body: parsed.body });
          }
        }
        const template = createVaultStarter(this.database, name, description, samples, this.presets);
        const file = await saveVaultStarter(this.app, template);
        new Notice(t("starter.custom.saved", { path: file.path }));
        this.close();
      } catch (error) {
        new Notice(t("starter.custom.failed", { error: String(error) }));
        save.disabled = false;
      }
    };
  }

  onClose(): void {
    this.closePicker?.();
    this.contentEl.empty();
  }
}
