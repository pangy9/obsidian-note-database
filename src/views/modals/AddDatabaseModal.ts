import { App, Modal, Setting } from "obsidian";
import { t } from "../../i18n";

export interface AddDatabaseModalResult {
  name: string;
  sourceFolder: string;
  typeFilter: string;
}

export class AddDatabaseModal extends Modal {
  private resolve?: (result: AddDatabaseModalResult | null) => void;
  private name = t("defaults.newDatabase");
  private sourceFolder = "";
  private typeFilter = "";

  constructor(
    app: App,
    private defaultFolder: string,
  ) {
    super(app);
  }

  openAndWait(): Promise<AddDatabaseModalResult | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("addDatabase.title") });

    new Setting(contentEl)
      .setName(t("settings.databaseName"))
      .addText((text) => {
        text.setValue(this.name);
        text.inputEl.addClass("db-fullwidth-input");
        text.onChange((v) => { this.name = v.trim() || t("defaults.newDatabase"); });
      });

    new Setting(contentEl)
      .setName(t("settings.sourceFolder"))
      .setDesc(t("addDatabase.sourceDesc", { folder: this.defaultFolder || "/" }))
      .addText((text) => {
        text.setValue(this.sourceFolder);
        text.setPlaceholder(t("settings.sourceFolder.placeholder"));
        text.inputEl.addClass("db-fullwidth-input");
        text.onChange((v) => { this.sourceFolder = v.trim(); });
      });

    new Setting(contentEl)
      .setName(t("settings.typeFilter"))
      .setDesc(t("addDatabase.typeDesc"))
      .addText((text) => {
        text.setValue(this.typeFilter);
        text.setPlaceholder(t("settings.typeFilter.placeholder"));
        text.inputEl.addClass("db-fullwidth-input");
        text.onChange((v) => { this.typeFilter = v.trim(); });
      });

    const btnRow = contentEl.createDiv({ cls: "db-delete-modal-buttons" });

    btnRow.createEl("button", { text: t("common.cancel") }).onclick = () => {
      this.resolve?.(null);
      this.close();
    };

    const okBtn = btnRow.createEl("button", {
      cls: "mod-cta",
      text: t("addDatabase.create"),
    });
    okBtn.onclick = () => {
      this.resolve?.({
        name: this.name,
        sourceFolder: this.sourceFolder,
        typeFilter: this.typeFilter || "",
      });
      this.close();
    };
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
