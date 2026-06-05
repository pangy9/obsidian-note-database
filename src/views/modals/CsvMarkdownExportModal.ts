import { Modal } from "obsidian";
import { t } from "../../i18n";
import { CsvMarkdownExportOptions } from "../../data/CsvMarkdownZipExport";

export class CsvMarkdownExportModal extends Modal {
  private resolve?: (options: CsvMarkdownExportOptions | null) => void;
  private includeFrontmatter = true;

  openAndWait(): Promise<CsvMarkdownExportOptions | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("note-database-modal");
    this.contentEl.createEl("h3", { text: t("csvMarkdownExport.title") });
    this.contentEl.createDiv({ cls: "db-panel-empty", text: t("csvMarkdownExport.desc") });

    this.renderCheckboxOption(t("csvMarkdownExport.includeFrontmatter"), this.includeFrontmatter, (value) => {
      this.includeFrontmatter = value;
    });

    const actions = this.contentEl.createDiv({ cls: "db-modal-actions" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    actions.createEl("button", {
      cls: "mod-cta",
      text: t("csvMarkdownExport.export"),
      attr: { type: "button" },
    }).onclick = () => {
      const resolve = this.resolve;
      this.resolve = undefined;
      this.close();
      resolve?.({
        includeFrontmatter: this.includeFrontmatter,
      });
    };
  }

  private renderCheckboxOption(text: string, checked: boolean, onChange: (value: boolean) => void): void {
    const row = this.contentEl.createDiv({ cls: "db-csv-markdown-option-row" });
    const label = row.createEl("label", { cls: "db-csv-markdown-option-label" });
    const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
    checkbox.checked = checked;
    checkbox.onchange = () => onChange(checkbox.checked);
    label.createSpan({ text });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve?.(null);
    this.resolve = undefined;
  }
}
