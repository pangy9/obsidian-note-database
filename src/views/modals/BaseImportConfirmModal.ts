import { App, Modal } from "obsidian";
import { COLUMN_TYPE_LABELS } from "../../data/ColumnTypes";
import { applyRangeSelection, clearSelection, selectAll } from "../../data/RangeSelection";
import { ColumnDef } from "../../data/types";
import { t } from "../../i18n";
import { createDropdownField } from "../DropdownField";
import { renderPropertyTypeIcon } from "../PropertyTypeIcon";

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
  private selectedColumnKeys = new Set<string>();
  private lastSelectedColumnKey: string | null = null;
  private headerSelectionCheckbox?: HTMLInputElement;
  private columnSelectionRows: Array<{ key: string; row: HTMLElement; checkbox: HTMLInputElement }> = [];

  private static TYPES: ColumnDef["type"][] = [
    "text", "number", "date", "datetime", "currency", "select", "multi-select", "status", "checkbox",
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

  openAndWait(): Promise<BaseImportColumn[] | null> {
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

    this.initializeColumnSelection();

    const table = contentEl.createEl("table", {
      cls: "base-import-table",
    });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    headRow.createEl("th", { text: t("baseImport.property") });
    headRow.createEl("th", { text: t("baseImport.displayName") });
    headRow.createEl("th", { text: t("baseImport.inferredType") });
    headRow.createEl("th", { text: t("baseImport.fileCount") });
    this.renderHeaderSelectionCheckbox(headRow.createEl("th", { cls: "base-import-check-cell" }));

    const tbody = table.createEl("tbody");
    this.columnSelectionRows = [];
    for (const col of this.columns) {
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
      let iconEl = renderPropertyTypeIcon(typeTd, col);
      const typeLabels = COLUMN_TYPE_LABELS();
      const typeDropdown = createDropdownField({
        parent: typeTd,
        label: t("baseImport.inferredType"),
        options: BaseImportConfirmModal.TYPES.map((type) => ({ value: type, text: typeLabels[type] })),
        value: col.type,
        className: "db-modal-dropdown db-base-import-type-dropdown",
        hideLabel: true,
        onChange: (value) => {
          col.type = value as ColumnDef["type"];
          iconEl.remove();
          iconEl = renderPropertyTypeIcon(typeTd, col);
          typeTd.insertBefore(iconEl, typeDropdown.button);
        },
      });
      tr.createEl("td", { text: col.fileCount > 0 ? String(col.fileCount) : "-" });
      const checkTd = tr.createEl("td");
      checkTd.addClass("base-import-check-cell");
      const checkbox = checkTd.createEl("input", {
        cls: "db-modal-checkbox base-import-include-checkbox",
        attr: { type: "checkbox", "aria-label": t("baseImport.include") },
      });
      checkbox.checked = this.selectedColumnKeys.has(col.key);
      this.columnSelectionRows.push({ key: col.key, row: tr, checkbox });
      checkbox.onclick = (event) => {
        event.stopPropagation();
        const useRangeSelection = event.shiftKey && !event.metaKey && !event.ctrlKey;
        this.lastSelectedColumnKey = applyRangeSelection({
          orderedIds: this.getColumnKeys(),
          selectedIds: this.selectedColumnKeys,
          anchorId: this.lastSelectedColumnKey,
          targetId: col.key,
          selected: checkbox.checked,
          range: useRangeSelection,
        });
        this.syncColumnSelectionRows();
      };
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

  private initializeColumnSelection(): void {
    this.selectedColumnKeys.clear();
    for (const col of this.columns) {
      if (this.defaultUnchecked) col.excluded = true;
      else col.excluded = Boolean(col.excluded);
      if (!col.excluded) this.selectedColumnKeys.add(col.key);
    }
    if (this.lastSelectedColumnKey && !this.selectedColumnKeys.has(this.lastSelectedColumnKey)) {
      this.lastSelectedColumnKey = null;
    }
  }

  private renderHeaderSelectionCheckbox(parent: HTMLElement): void {
    const checkbox = parent.createEl("input", {
      cls: "db-modal-checkbox base-import-include-checkbox",
      attr: { type: "checkbox", "aria-label": t("baseImport.include") },
    });
    this.headerSelectionCheckbox = checkbox;
    this.syncHeaderSelectionCheckbox();
    checkbox.onchange = () => {
      if (checkbox.checked) {
        selectAll(this.getColumnKeys(), this.selectedColumnKeys);
        this.lastSelectedColumnKey = this.columns[this.columns.length - 1]?.key || null;
      } else {
        clearSelection(this.getColumnKeys(), this.selectedColumnKeys);
        this.lastSelectedColumnKey = null;
      }
      this.syncColumnSelectionRows();
    };
  }

  private getColumnKeys(): string[] {
    return this.columns.map((col) => col.key);
  }

  private syncColumnSelectionRows(): void {
    for (const col of this.columns) {
      col.excluded = !this.selectedColumnKeys.has(col.key);
    }
    for (const item of this.columnSelectionRows) {
      const selected = this.selectedColumnKeys.has(item.key);
      item.checkbox.checked = selected;
      item.row.toggleClass("base-import-excluded", !selected);
    }
    this.syncHeaderSelectionCheckbox();
  }

  private syncHeaderSelectionCheckbox(): void {
    const checkbox = this.headerSelectionCheckbox;
    if (!checkbox) return;
    const selectedCount = this.selectedColumnKeys.size;
    checkbox.checked = this.columns.length > 0 && selectedCount === this.columns.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < this.columns.length;
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
