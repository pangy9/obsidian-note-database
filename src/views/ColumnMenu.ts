import { Menu, MenuItem } from "obsidian";
import { COLUMN_TYPE_LABELS, isOptionColumnType } from "../data/ColumnTypes";
import { ColumnDef } from "../data/types";
import { t } from "../i18n";

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

type MenuItemWithSubmenu = MenuItem & { setSubmenu(): Menu };

export class ColumnMenu {
  constructor(private actions: ColumnMenuActions) {}

  showOptionsEditor(col: ColumnDef): void {
    if (isOptionColumnType(col.type)) {
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

      if (isOptionColumnType(col.type)) {
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
        const sub = (item as MenuItemWithSubmenu).setTitle(t("menu.changeType")).setIcon("layers").setSubmenu();
        const types: ColumnDef["type"][] = [
          "text",
          "number",
          "date",
          "currency",
          "select",
          "multi-select",
          "status",
          "checkbox",
          "computed",
        ];
        for (const type of types) {
          sub.addItem((subItem) => {
            const label = COLUMN_TYPE_LABELS()[type];
            subItem.setTitle(type === col.type ? `✓ ${label}` : label);
            if (type === col.type) subItem.setIcon("check");
            subItem.onClick(() => {
              if (type !== col.type) {
                menu.hide();
                this.actions.changeColumnType(col, type);
              }
            });
          });
        }
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
        .setDisabled(col.key === "file.name")
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
}
