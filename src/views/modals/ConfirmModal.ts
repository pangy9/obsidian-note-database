import { App, Modal } from "obsidian";
import { t } from "../../i18n";

export interface ConfirmModalOptions {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

class ConfirmModal extends Modal {
  private resolve?: (confirmed: boolean) => void;

  constructor(
    app: App,
    private options: ConfirmModalOptions
  ) {
    super(app);
  }

  openAndWait(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("note-database-modal");
    this.contentEl.createEl("h3", { text: this.options.title });
    this.contentEl.createDiv({ cls: "db-modal-help", text: this.options.message });

    const actions = this.contentEl.createDiv({ cls: "db-modal-actions" });
    actions.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" },
    }).onclick = () => this.finish(false);

    actions.createEl("button", {
      cls: this.options.danger ? "mod-warning" : "mod-cta",
      text: this.options.confirmText || t("common.delete"),
      attr: { type: "button" },
    }).onclick = () => this.finish(true);
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    if (this.modalEl.isShown()) this.close();
    resolve?.(confirmed);
  }
}

export function confirmWithModal(app: App, options: ConfirmModalOptions): Promise<boolean> {
  return new ConfirmModal(app, options).openAndWait();
}
