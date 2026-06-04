import { App, Modal, setIcon } from "obsidian";
import { ColumnDef } from "../../data/types";
import { t } from "../../i18n";
import { PROPERTY_TYPE_ICON_NAMES, renderPropertyTypeIcon } from "../PropertyTypeIcon";

export interface BaseImportColumn extends ColumnDef {
  /** Number of files that have this property */
  fileCount: number;
  /** Whether this column should be excluded from import */
  excluded?: boolean;
}

export interface BaseImportModalOptions {
  titleText?: string;
  descText?: string;
  /** When true, all checkboxes default to unchecked (for new database creation) */
  defaultUnchecked?: boolean;
}

export class BaseImportConfirmModal extends Modal {
  private resolve?: (columns: BaseImportColumn[] | null) => void;
  private columns: BaseImportColumn[];
  private titleText: string;
  private descText: string;
  private defaultUnchecked: boolean;

  private static TYPES: ColumnDef["type"][] = [
    "text", "number", "date", "currency", "select", "multi-select", "status", "checkbox",
  ];

  constructor(
    app: App,
    columns: BaseImportColumn[],
    options?: BaseImportModalOptions,
  ) {
    super(app);
    this.columns = columns.map((c) => ({ ...c }));
    this.titleText = options?.titleText ?? t("baseImport.title");
    this.descText = options?.descText ?? t("baseImport.desc");
    this.defaultUnchecked = options?.defaultUnchecked ?? false;
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
    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", {
      text: this.descText,
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
    headRow.createEl("th", { text: t("baseImport.include") });
    headRow.createEl("th", { text: t("baseImport.fileCount") });

    const tbody = table.createEl("tbody");
    for (const col of this.columns) {
      // Initialize excluded state based on defaultUnchecked
      if (this.defaultUnchecked) {
        col.excluded = true;
      }
      const tr = tbody.createEl("tr");
      if (col.excluded) tr.addClass("base-import-excluded");
      tr.createEl("td", { text: col.key });
      const labelTd = tr.createEl("td");
      const labelInput = labelTd.createEl("input", {
        attr: { type: "text", value: col.label || col.key },
      });
      labelInput.oninput = () => {
        col.label = labelInput.value.trim() || col.key;
      };
      const typeTd = tr.createEl("td");
      typeTd.addClass("base-import-type-cell");
      const iconEl = renderPropertyTypeIcon(typeTd, col);
      const select = typeTd.createEl("select");
      for (const t of BaseImportConfirmModal.TYPES) {
        const opt = select.createEl("option", { value: t, text: t });
        if (col.type === t) opt.selected = true;
      }
      select.onchange = () => {
        col.type = select.value as ColumnDef["type"];
        const iconName = PROPERTY_TYPE_ICON_NAMES[col.type];
        iconEl.setAttribute("data-icon", iconName);
        setIcon(iconEl, iconName);
      };
      const checkTd = tr.createEl("td");
      checkTd.addClass("base-import-check-cell");
      const checkbox = checkTd.createEl("input", {
        attr: { type: "checkbox" },
      });
      checkbox.checked = !this.defaultUnchecked;
      checkbox.onchange = () => {
        col.excluded = !checkbox.checked;
        tr.toggleClass("base-import-excluded", col.excluded);
      };
      tr.createEl("td", { text: col.fileCount > 0 ? String(col.fileCount) : "-" });
    }

    const btnRow = contentEl.createDiv({ cls: "base-import-buttons" });
    btnRow.createEl("button", { text: t("common.cancel") }).onclick = () => {
      this.resolve?.(null);
      this.close();
    };
    btnRow.createEl("button", { cls: "mod-cta", text: t("baseImport.confirm") }).onclick = () => {
      this.resolve?.(this.columns.filter((c) => !c.excluded));
      this.close();
    };
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
