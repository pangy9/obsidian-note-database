import { App, Modal } from "obsidian";
import { ColumnDef } from "../../data/types";
import { t } from "../../i18n";

export interface BaseImportColumn extends ColumnDef {
  /** Number of files that have this property */
  fileCount: number;
}

export class BaseImportConfirmModal extends Modal {
  private resolve?: (columns: BaseImportColumn[] | null) => void;
  private columns: BaseImportColumn[];

  private static TYPES: ColumnDef["type"][] = [
    "text", "number", "date", "currency", "select", "multi-select", "status", "checkbox",
  ];

  constructor(
    app: App,
    columns: BaseImportColumn[],
  ) {
    super(app);
    this.columns = columns.map((c) => ({ ...c }));
  }

  open(): Promise<BaseImportColumn[] | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.createEl("h3", { text: t("baseImport.title") });
    contentEl.createEl("p", {
      text: t("baseImport.desc"),
      cls: "db-modal-help",
    });

    const table = contentEl.createEl("table", {
      cls: "base-import-table",
    });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    headRow.createEl("th", { text: t("baseImport.property") });
    headRow.createEl("th", { text: t("baseImport.displayName") });
    headRow.createEl("th", { text: t("baseImport.inferredType") });
    headRow.createEl("th", { text: t("baseImport.fileCount") });

    const tbody = table.createEl("tbody");
    for (const col of this.columns) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: col.key });
      const labelTd = tr.createEl("td");
      const labelInput = labelTd.createEl("input", {
        attr: { type: "text", value: col.label || col.key },
      });
      labelInput.oninput = () => {
        col.label = labelInput.value.trim() || col.key;
      };
      const typeTd = tr.createEl("td");
      const select = typeTd.createEl("select");
      for (const t of BaseImportConfirmModal.TYPES) {
        const opt = select.createEl("option", { value: t, text: t });
        if (col.type === t) opt.selected = true;
      }
      select.onchange = () => {
        col.type = select.value as ColumnDef["type"];
      };
      tr.createEl("td", { text: col.fileCount > 0 ? String(col.fileCount) : "-" });
    }

    const btnRow = contentEl.createDiv({ cls: "db-delete-modal-buttons" });
    btnRow.createEl("button", { text: t("common.cancel") }).onclick = () => {
      this.resolve?.(null);
      this.close();
    };
    btnRow.createEl("button", { cls: "mod-cta", text: t("baseImport.confirm") }).onclick = () => {
      this.resolve?.(this.columns);
      this.close();
    };
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
