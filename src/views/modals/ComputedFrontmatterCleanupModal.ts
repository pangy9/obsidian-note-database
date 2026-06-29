import { App, Modal } from "obsidian";
import { ComputedFrontmatterCleanupOption } from "../../data/ComputedCleanup";
import { applyRangeSelection } from "../../data/RangeSelection";
import { t } from "../../i18n";

export class ComputedFrontmatterCleanupModal extends Modal {
  private selectedKeys: Set<string>;
  private lastSelectedKey: string | null = null;

  constructor(
    app: App,
    private options: ComputedFrontmatterCleanupOption[],
    private onConfirm: (keys: string[]) => Promise<void>
  ) {
    super(app);
    this.selectedKeys = new Set(options.map((option) => option.key));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.createEl("h3", { text: t("viewConfig.computedCleanup.title") });
    contentEl.createDiv({ cls: "db-modal-help", text: t("viewConfig.computedCleanup.desc") });

    const list = contentEl.createDiv({ cls: "db-computed-cleanup-list" });
    let confirm: HTMLButtonElement;
    const updateConfirmState = () => {
      if (confirm) confirm.disabled = this.selectedKeys.size === 0;
    };
    for (const option of this.options) {
      const row = list.createEl("label", { cls: "db-computed-cleanup-option" });
      const checkbox = row.createEl("input", {
        cls: "db-modal-checkbox",
        attr: { type: "checkbox", value: option.key },
      });
      checkbox.checked = this.selectedKeys.has(option.key);
      checkbox.onclick = (event) => {
        this.lastSelectedKey = applyRangeSelection({
          orderedIds: this.getOptionKeys(),
          selectedIds: this.selectedKeys,
          anchorId: this.lastSelectedKey,
          targetId: option.key,
          selected: checkbox.checked,
          range: event.shiftKey,
        });
        this.syncCheckboxes(list);
        updateConfirmState();
      };
      const text = row.createDiv({ cls: "db-computed-cleanup-option-text" });
      text.createDiv({
        cls: "db-computed-cleanup-option-label",
        text: t("viewConfig.computedCleanup.optionField", { label: option.label }),
      });
      text.createDiv({
        cls: "db-computed-cleanup-option-key",
        text: t("viewConfig.computedCleanup.optionKey", { key: option.key, count: option.recordCount }),
      });
    }

    const actions = contentEl.createDiv({ cls: "db-modal-actions" });
    actions.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" },
    }).onclick = () => this.close();
    confirm = actions.createEl("button", {
      cls: "mod-warning",
      text: t("viewConfig.computedCleanup.confirm"),
      attr: { type: "button" },
    });
    updateConfirmState();
    confirm.onclick = async () => {
      const keys = Array.from(this.selectedKeys);
      if (keys.length === 0) return;
      await this.onConfirm(keys);
      this.close();
    };
  }

  private getOptionKeys(): string[] {
    return this.options.map((option) => option.key);
  }

  private syncCheckboxes(list: HTMLElement): void {
    list.querySelectorAll<HTMLInputElement>("input[type='checkbox'][value]").forEach((checkbox) => {
      checkbox.checked = this.selectedKeys.has(checkbox.value);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
