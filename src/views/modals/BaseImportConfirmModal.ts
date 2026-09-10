import { App, Modal } from "obsidian";
import { makeModalDraggable } from "./ModalDrag";
import { COLUMN_TYPE_LABELS } from "../../data/ColumnTypes";
import { BaseImportSortKey, orderBaseImportColumns } from "../../data/BaseImportView";
import { applyRangeSelection, clearSelection, selectAll } from "../../data/RangeSelection";
import { ColumnDef } from "../../data/types";
import { t } from "../../i18n";
import { createDropdownField } from "../DropdownField";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon } from "../PropertyTypeIcon";

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
  private searchQuery = "";
  private sortKey: BaseImportSortKey = "default";
  private tbodyEl?: HTMLElement;

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
    makeModalDraggable(this);
    contentEl.createEl("p", {
      text: this.descText,
      cls: "db-modal-help",
    });

    this.initializeColumnSelection();
    this.renderToolbar();

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

    this.tbodyEl = table.createEl("tbody");
    this.renderTableBody();

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

  /** 搜索栏 + 排序选择栏：属性很多时先过滤/排序再勾选。 */
  private renderToolbar(): void {
    const toolbar = this.contentEl.createDiv({ cls: "base-import-toolbar" });
    const search = toolbar.createEl("input", {
      cls: "base-import-search",
      attr: { type: "search", placeholder: t("baseImport.searchPlaceholder"), "aria-label": t("baseImport.searchPlaceholder") },
    });
    search.value = this.searchQuery;
    search.oninput = () => {
      this.searchQuery = search.value;
      this.renderTableBody();
    };
    const sortDropdown = createDropdownField({
      parent: toolbar,
      label: t("baseImport.sortBy"),
      hideLabel: true,
      icon: "arrow-up-down",
      options: [
        { value: "default", text: t("baseImport.sortDefault") },
        { value: "key-asc", text: t("baseImport.sortKeyAsc") },
        { value: "key-desc", text: t("baseImport.sortKeyDesc") },
        { value: "count-desc", text: t("baseImport.sortCountDesc") },
        { value: "count-asc", text: t("baseImport.sortCountAsc") },
      ],
      value: this.sortKey,
      className: "db-modal-dropdown base-import-sort-dropdown",
      onChange: (value) => {
        this.sortKey = value as BaseImportSortKey;
        this.renderTableBody();
      },
    });
    sortDropdown.button.setAttr("title", t("baseImport.sortHint"));
    sortDropdown.button.setAttr("aria-label", `${t("baseImport.sortBy")}: ${t("baseImport.sortHint")}`);
    this.contentEl.createEl("p", {
      cls: "base-import-toolbar-help",
      text: t("baseImport.toolbarHint"),
    });
    if (this.columns.some((col) => col.computedKey)) {
      this.contentEl.createEl("p", {
        cls: "base-import-toolbar-help",
        text: t("baseImport.formulaTypeHint"),
      });
    }
  }

  /** 当前搜索词 + 排序下实际展示的列（label/type/excluded 保存在列对象上，重绘不丢失）。 */
  private getVisibleColumns(): BaseImportColumn[] {
    return orderBaseImportColumns(
      this.columns,
      this.searchQuery,
      this.sortKey,
      (type) => COLUMN_TYPE_LABELS()[type] || type
    );
  }

  private renderTableBody(): void {
    const tbody = this.tbodyEl;
    if (!tbody) return;
    tbody.empty();
    this.columnSelectionRows = [];
    for (const col of this.getVisibleColumns()) {
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
      const typeLabels = COLUMN_TYPE_LABELS();
      createDropdownField({
        parent: typeTd,
        label: t("baseImport.inferredType"),
        options: (col.computedKey ? ["computed" as const, "text" as const] : BaseImportConfirmModal.TYPES).map((type) => ({ value: type, text: typeLabels[type], icon: getPropertyDropdownIcon(type) })),
        value: col.type,
        className: "db-modal-dropdown db-base-import-type-dropdown",
        hideLabel: true,
        renderIcon: renderDropdownPropertyTypeIcon,
        onChange: (value) => {
          col.type = value as ColumnDef["type"];
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
          orderedIds: this.getVisibleColumnKeys(),
          selectedIds: this.selectedColumnKeys,
          anchorId: this.lastSelectedColumnKey,
          targetId: col.key,
          selected: checkbox.checked,
          range: useRangeSelection,
        });
        this.syncColumnSelectionRows();
      };
    }
    this.syncHeaderSelectionCheckbox();
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
      // 只作用于当前可见（搜索过滤后）的行：先搜再全选是批量勾选可见属性的常用路径。
      const visibleKeys = this.getVisibleColumnKeys();
      if (checkbox.checked) {
        selectAll(visibleKeys, this.selectedColumnKeys);
        this.lastSelectedColumnKey = visibleKeys[visibleKeys.length - 1] || null;
      } else {
        clearSelection(visibleKeys, this.selectedColumnKeys);
        this.lastSelectedColumnKey = null;
      }
      this.syncColumnSelectionRows();
    };
  }

  private getVisibleColumnKeys(): string[] {
    return this.getVisibleColumns().map((col) => col.key);
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
    const visibleKeys = this.getVisibleColumnKeys();
    const visibleSelected = visibleKeys.filter((key) => this.selectedColumnKeys.has(key)).length;
    checkbox.checked = visibleKeys.length > 0 && visibleSelected === visibleKeys.length;
    checkbox.indeterminate = visibleSelected > 0 && visibleSelected < visibleKeys.length;
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
