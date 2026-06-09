import { App, Modal } from "obsidian";
import { ComputedFrontmatterCleanupOption } from "../../data/ComputedCleanup";
import { t } from "../../i18n";

export class ComputedFrontmatterCleanupModal extends Modal {
  private selectedKey: string;

  constructor(
    app: App,
    private options: ComputedFrontmatterCleanupOption[],
    private onConfirm: (key: string) => Promise<void>
  ) {
    super(app);
    this.selectedKey = options[0]?.key || "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.createEl("h3", { text: t("viewConfig.computedCleanup.title") });
    contentEl.createDiv({ cls: "db-modal-help", text: t("viewConfig.computedCleanup.desc") });

    const list = contentEl.createDiv({ cls: "db-computed-cleanup-list" });
    for (const option of this.options) {
      const row = list.createEl("label", { cls: "db-computed-cleanup-option" });
      const radio = row.createEl("input", {
        attr: { type: "radio", name: "computed-cleanup-field", value: option.key },
      });
      radio.checked = option.key === this.selectedKey;
      radio.onchange = () => {
        if (radio.checked) this.selectedKey = option.key;
      };
      const text = row.createDiv({ cls: "db-computed-cleanup-option-text" });
      text.createDiv({
        cls: "db-computed-cleanup-option-label",
        text: t("viewConfig.computedCleanup.optionField", { label: option.label }),
      });
      text.createDiv({
        cls: "db-computed-cleanup-option-key",
        text: t("viewConfig.computedCleanup.optionKey", { key: option.key }),
      });
    }

    const actions = contentEl.createDiv({ cls: "db-modal-actions" });
    actions.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" },
    }).onclick = () => this.close();
    const confirm = actions.createEl("button", {
      cls: "mod-warning",
      text: t("viewConfig.computedCleanup.confirm"),
      attr: { type: "button" },
    });
    confirm.disabled = !this.selectedKey;
    confirm.onclick = async () => {
      if (!this.selectedKey) return;
      await this.onConfirm(this.selectedKey);
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
