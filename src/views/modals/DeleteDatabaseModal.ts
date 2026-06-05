import { App, Modal, Setting } from "obsidian";
import { t } from "../../i18n";

export interface DeleteDatabaseModalResult {
  /** "plugin-trash" = 移至插件回收站；"system-trash" = 移至系统回收站 */
  action: "plugin-trash" | "system-trash";
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

  openAndWait(): Promise<DeleteDatabaseModalResult | null> {
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

    if (this.fileCount > 0) {
      new Setting(contentEl)
        .setName(t("deleteDatabase.deleteFiles"))
        .setDesc(t("deleteDatabase.deleteFilesDesc", { count: this.fileCount }))
        .addToggle((toggle) => {
          toggle.setValue(this.deleteFiles);
          toggle.onChange((v) => { this.deleteFiles = v; });
        });
    }

    const btnRow = contentEl.createDiv({ cls: "db-delete-modal-buttons db-delete-modal-danger-row" });
    const primaryActions = btnRow.createDiv({ cls: "db-delete-modal-primary-actions" });

    primaryActions.createEl("button", { text: t("common.cancel") }).onclick = () => {
      this.resolve?.(null);
      this.close();
    };

    // 移至插件回收站（主操作）
    const pluginTrashBtn = primaryActions.createEl("button", {
      cls: "mod-cta",
      text: t("deleteDatabase.moveToPluginTrash"),
    });
    pluginTrashBtn.onclick = () => {
      this.resolve?.({ action: "plugin-trash", deleteFiles: this.deleteFiles });
      this.close();
    };

    // 移至系统回收站（危险操作）
    const systemTrashBtn = btnRow.createEl("button", {
      cls: "mod-warning",
      text: t("deleteDatabase.moveToSystemTrash"),
    });
    systemTrashBtn.onclick = () => {
      this.resolve?.({ action: "system-trash", deleteFiles: this.deleteFiles });
      this.close();
    };
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
