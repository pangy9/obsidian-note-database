import { App, Modal, Setting } from "obsidian";
import { t } from "../../i18n";

export interface DeleteDatabaseModalResult {
  action: "trash" | "permanent";
  deleteFiles: boolean;
}

export class DeleteDatabaseModal extends Modal {
  private resolve?: (result: DeleteDatabaseModalResult | null) => void;
  private deleteFiles = false;

  constructor(
    app: App,
    private dbName: string,
    private fileCount: number
  ) {
    super(app);
  }

  open(): Promise<DeleteDatabaseModalResult | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.addClass("db-delete-database-modal");
    contentEl.createEl("h3", { text: t("deleteDatabase.title", { name: this.dbName }) });

    contentEl.createDiv({
      cls: "db-delete-modal-info",
      text: t("deleteDatabase.info", { count: this.fileCount }),
    });

    new Setting(contentEl)
      .setName(t("deleteDatabase.deleteFiles"))
      .setDesc(t("deleteDatabase.deleteFilesDesc", { count: this.fileCount }))
      .addToggle((toggle) => {
        toggle.setValue(this.deleteFiles);
        toggle.onChange((v) => { this.deleteFiles = v; });
      });

    const btnRow = contentEl.createDiv({ cls: "db-delete-modal-buttons db-delete-modal-danger-row" });
    const primaryActions = btnRow.createDiv({ cls: "db-delete-modal-primary-actions" });

    primaryActions.createEl("button", { text: t("common.cancel") }).onclick = () => {
      this.resolve?.(null);
      this.close();
    };

    const trashBtn = primaryActions.createEl("button", {
      cls: "mod-cta",
      text: t("deleteDatabase.moveToTrash"),
    });
    trashBtn.onclick = () => {
      this.resolve?.({ action: "trash", deleteFiles: this.deleteFiles });
      this.close();
    };

    const permBtn = btnRow.createEl("button", {
      cls: "mod-warning",
      text: t("common.permanentlyDelete"),
    });
    permBtn.onclick = () => {
      this.resolve?.({ action: "permanent", deleteFiles: this.deleteFiles });
      this.close();
    };
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
