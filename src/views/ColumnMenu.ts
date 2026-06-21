import { Menu, setIcon } from "obsidian";
import { COLUMN_TYPE_LABELS, isOptionColumnType } from "../data/ColumnTypes";
import { isFileFieldKey } from "../data/FileFields";
import { ColumnDef } from "../data/types";
import { t } from "../i18n";
import { renderPropertyTypeIcon } from "./PropertyTypeIcon";

export interface ColumnMenuActions {
  editColumn(col: ColumnDef): void;
  editFormula(col: ColumnDef): void;
  editStatusOptions(col: ColumnDef): void;
  showOptionsEditor(col: ColumnDef): void;
  changeColumnType(col: ColumnDef, type: ColumnDef["type"]): void;
  insertColumn(col: ColumnDef, side: "left" | "right"): void;
  duplicateColumn(col: ColumnDef): void;
  moveColumn(key: string, offset: -1 | 1): void;
  hideColumn(col: ColumnDef): void;
  toggleColumnWrap(col: ColumnDef): void;
  sortByColumn(col: ColumnDef): void;
  getColumnSortDirection?(col: ColumnDef): "asc" | "desc" | null;
  clearColumnSort?(col: ColumnDef): void;
  autoFitColumn?(col: ColumnDef): void;
  autoFitAllColumns?(): void;
  deleteColumn(col: ColumnDef): void;
}

export interface ColumnMenuOptions {
  readonly?: boolean;
  includeLayoutActions?: boolean;
  includeWidthActions?: boolean;
}

type MenuItemWithDom = { dom?: HTMLElement };

export class ColumnMenu {
  constructor(private actions: ColumnMenuActions) {}

  showOptionsEditor(col: ColumnDef): void {
    if (isOptionColumnType(col.type) && !isFileFieldKey(col.key)) {
      this.actions.editStatusOptions(col);
    }
  }

  show(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement, options: ColumnMenuOptions = {}): void {
    event.preventDefault();
    event.stopPropagation();
    const readonly = options.readonly === true;
    const includeLayoutActions = options.includeLayoutActions !== false;
    const includeWidthActions = options.includeWidthActions !== false;
    const menu = new Menu().setUseNativeMenu(false);

    if (!readonly) {
      menu.addItem((item) => item
        .setTitle(t("menu.editProperty", { name: col.label }))
        .setIcon("edit")
        .onClick(() => this.actions.editColumn(col))
      );

      if (isOptionColumnType(col.type) && !isFileFieldKey(col.key)) {
        menu.addItem((item) => item
          .setTitle(t("menu.editOptions"))
          .setIcon("palette")
          .onClick(() => this.actions.editStatusOptions(col))
        );
      }

      if (col.type === "computed") {
        menu.addItem((item) => item
          .setTitle(t("menu.openFormula"))
          .setIcon("sigma")
          .onClick(() => this.actions.editFormula(col))
        );
      }

      menu.addItem((item) => {
        const isFileField = isFileFieldKey(col.key);
        item.setTitle(t("menu.changeType")).setIcon("layers");
        item.setDisabled(isFileField);
        if (isFileField) return item;
        const menuItem = item as unknown as MenuItemWithDom;
        const open = (evt: MouseEvent) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.showColumnTypePopover(evt, col, menu, menuItem.dom);
        };
        menuItem.dom?.addEventListener("mouseenter", open);
        menuItem.dom?.addEventListener("mousedown", open, true);
        menuItem.dom?.addEventListener("click", open, true);
        return item;
      });
    }

    if (!readonly && includeLayoutActions) {
      menu.addSeparator();

      menu.addItem((item) => item
        .setTitle(t("menu.insertLeft"))
        .setIcon("arrow-left-to-line")
        .onClick(() => this.actions.insertColumn(col, "left"))
      );
      menu.addItem((item) => item
        .setTitle(t("menu.insertRight"))
        .setIcon("arrow-right-to-line")
        .onClick(() => this.actions.insertColumn(col, "right"))
      );
      menu.addItem((item) => item
        .setTitle(t("menu.duplicateColumn"))
        .setIcon("copy")
        .onClick(() => this.actions.duplicateColumn(col))
        .setDisabled(isFileFieldKey(col.key))
      );
    }

    if (!readonly && includeLayoutActions) {
      menu.addSeparator();

      menu.addItem((item) => item
        .setTitle(t("menu.moveUp"))
        .setIcon("arrow-up")
        .onClick(() => this.actions.moveColumn(col.key, -1))
      );
      menu.addItem((item) => item
        .setTitle(t("menu.moveDown"))
        .setIcon("arrow-down")
        .onClick(() => this.actions.moveColumn(col.key, 1))
      );
    }

    menu.addSeparator();

    menu.addItem((item) => item
      .setTitle(t("menu.hideProperty", { name: col.label }))
      .setIcon("eye-off")
      .onClick(() => this.actions.hideColumn(col))
    );
    menu.addItem((item) => item
      .setTitle(col.wrap ? t("menu.disableWrap") : t("menu.enableWrap"))
      .setIcon("wrap-text")
      .onClick(() => this.actions.toggleColumnWrap(col))
    );
    if (includeWidthActions && this.actions.autoFitColumn) {
      menu.addItem((item) => item
        .setTitle(t("menu.autoFitColumn"))
        .setIcon("ruler-dimension-line")
        .onClick(() => this.actions.autoFitColumn?.(col))
      );
    }
    if (includeWidthActions && this.actions.autoFitAllColumns) {
      menu.addItem((item) => item
        .setTitle(t("menu.autoFitAllColumns"))
        .setIcon("scan-line")
        .onClick(() => this.actions.autoFitAllColumns?.())
      );
    }
    menu.addItem((item) => item
      .setTitle(t("menu.sortBy", { name: col.label }))
      .setIcon("arrow-up-down")
      .onClick(() => this.actions.sortByColumn(col))
    );
    if (this.actions.getColumnSortDirection?.(col)) {
      menu.addItem((item) => item
        .setTitle(t("menu.clearSort"))
        .setIcon("x")
        .onClick(() => this.actions.clearColumnSort?.(col))
      );
    }

    if (!readonly && includeLayoutActions) {
      menu.addSeparator();

      menu.addItem((item) => item
        .setTitle(t("menu.deleteColumn"))
        .setIcon("trash")
        .setDisabled(col.key === "file.name")
        .onClick(() => this.actions.deleteColumn(col))
      );
    }

    if (anchorEl?.isConnected) {
      const rect = anchorEl.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    } else {
      menu.showAtMouseEvent(event);
    }
  }

  private showColumnTypePopover(evt: MouseEvent | KeyboardEvent, col: ColumnDef, menu: Menu, anchorEl?: HTMLElement): void {
    const doc = window.activeDocument;
    const view = doc.defaultView || window;
    doc.querySelectorAll(".db-column-type-popover").forEach((existing) => existing.remove());
    const panel = doc.body.createDiv({ cls: "db-dropdown-popover db-column-type-popover" });
    panel.setAttr("role", "listbox");
    const labels = COLUMN_TYPE_LABELS();
    const groups: Array<{ title: string; types: ColumnDef["type"][] }> = [
      { title: t("columnType.group.basic"), types: ["text", "number", "date", "datetime", "currency", "checkbox"] },
      { title: t("columnType.group.options"), types: ["select", "multi-select", "status"] },
      { title: t("columnType.group.advanced"), types: ["computed"] },
    ];
    groups.forEach((group) => {
      panel.createDiv({ cls: "db-dropdown-section-title", text: group.title });
      for (const type of group.types) {
        const row = panel.createEl("button", {
          cls: `db-dropdown-option has-icon${type === col.type ? " is-selected" : ""}`,
          attr: { type: "button", role: "option", "aria-selected": type === col.type ? "true" : "false" },
        });
        const check = row.createSpan({ cls: "db-dropdown-option-check" });
        if (type === col.type) setIcon(check, "check");
        renderPropertyTypeIcon(row.createSpan({ cls: "db-dropdown-option-icon db-column-type-option-icon" }), {
          key: type,
          label: labels[type],
          type,
        });
        row.createSpan({ cls: "db-dropdown-option-label", text: labels[type] });
        row.onclick = () => {
          cleanup();
          menu.hide();
          if (type !== col.type) this.actions.changeColumnType(col, type);
        };
      }
    });

    if (anchorEl?.isConnected) {
      const rect = anchorEl.getBoundingClientRect();
      panel.setCssProps({
        position: "fixed",
        left: `${Math.max(8, Math.min(rect.right + 6, view.innerWidth - 220))}px`,
        top: `${Math.max(8, Math.min(rect.top, view.innerHeight - 320))}px`,
      });
    } else {
      const point = "clientX" in evt ? { x: evt.clientX, y: evt.clientY } : undefined;
      if (point) {
        panel.setCssProps({
          position: "fixed",
          left: `${Math.max(8, Math.min(point.x + 8, view.innerWidth - 220))}px`,
          top: `${Math.max(8, Math.min(point.y - 8, view.innerHeight - 320))}px`,
        });
      }
    }

    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (panel.contains(target) || (anchorEl?.contains(target) ?? false))) return;
      cleanup();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cleanup();
    };
    const timer = view.setTimeout(() => doc.addEventListener("mousedown", onOutside, true), 0);
    doc.addEventListener("keydown", onKey, true);
    const cleanup = () => {
      view.clearTimeout(timer);
      doc.removeEventListener("mousedown", onOutside, true);
      doc.removeEventListener("keydown", onKey, true);
      panel.remove();
    };
  }
}
