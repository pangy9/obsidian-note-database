import { App, Menu } from "obsidian";
import { RowData } from "../data/types";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";
import { confirmWithModal } from "./modals/ConfirmModal";

export interface RowMenuActions {
  app: App;
  openRow(row: RowData): void;
  deleteRow(row: RowData): Promise<void>;
  duplicateRow?(row: RowData): Promise<void>;
  readonly isReadOnly?: boolean;
}

export class RowMenu {
  constructor(private actions: RowMenuActions) {}

  attachToRow(tr: HTMLElement, row: RowData): void {
    tr.addEventListener("contextmenu", (event) => {
      const target = event.target;
      if (isHTMLElement(target) && target.closest("input, select, textarea, button")) {
        return;
      }
      this.show(event, row);
    });
  }

  show(event: MouseEvent, row: RowData): void {
    event.preventDefault();
    const displayName = row.file.name.replace(/\.md$/, "");
    const menu = new Menu().setUseNativeMenu(false);

    menu.addItem((item) => item
      .setTitle(t("menu.openNote"))
      .setIcon("file-text")
      .onClick(() => this.actions.openRow(row))
    );

    if (!this.actions.isReadOnly) {
      menu.addItem((item) => item
        .setTitle(t("menu.duplicateRecord"))
        .setIcon("copy")
        .onClick(() => { void this.actions.duplicateRow?.(row); })
      );

      menu.addSeparator();

      menu.addItem((item) => item
        .setTitle(t("menu.deleteRow", { name: displayName }))
        .setIcon("trash")
        .setWarning(true)
        .onClick(async () => {
          const ok = await confirmWithModal(this.actions.app, {
            title: t("common.delete"),
            message: t("menu.confirmDeleteRow", { name: displayName }),
            confirmText: t("common.delete"),
            danger: true,
          });
          if (!ok) return;
          void this.actions.deleteRow(row);
        })
      );
    }

    menu.showAtMouseEvent(event);
  }
}
