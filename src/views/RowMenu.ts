import { App, Menu } from "obsidian";
import { CreateEntryPosition, RowCreateContext, RowData, ViewConfig } from "../data/types";
import { isExplicitlySorted } from "../data/ManualOrder";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";
import { confirmWithModal } from "./modals/ConfirmModal";

export interface RowMenuActions {
  app: App;
  openRow(row: RowData): void;
  deleteRow(row: RowData): Promise<void>;
  duplicateRow?(row: RowData): Promise<void>;
  isRecordIconShown?(): boolean;
  canToggleRecordIcon?(): boolean;
  toggleRecordIcon?(anchor: HTMLElement, row: RowData): void;
  createEntry?(defaults?: Record<string, unknown>, position?: CreateEntryPosition): void;
  getConfig?(): ViewConfig | undefined;
  getVisibleRows?(): RowData[];
  getCreateDefaults?(row: RowData, context?: RowCreateContext): Record<string, unknown>;
  readonly isReadOnly?: boolean;
}

export class RowMenu {
  constructor(private actions: RowMenuActions) {}

  attachToRow(tr: HTMLElement, row: RowData, context?: RowCreateContext): void {
    tr.addEventListener("contextmenu", (event) => {
      const target = event.target;
      if (isHTMLElement(target) && target.closest("input, select, textarea, button")) {
        return;
      }
      this.show(event, row, context);
    });
  }

  show(
    event: MouseEvent,
    row: RowData,
    context?: RowCreateContext,
    anchorEl?: HTMLElement,
    onClose?: () => void,
  ): void {
    event.preventDefault();
    const displayName = row.file.name.replace(/\.md$/, "");
    const menu = new Menu().setUseNativeMenu(false);
    if (onClose) menu.onHide(onClose);

    menu.addItem((item) => item
      .setTitle(t("menu.openNote"))
      .setIcon("file-text")
      .onClick(() => this.actions.openRow(row))
    );

    if (!this.actions.isReadOnly) {
      const config = this.actions.getConfig?.();
      const visibleRows = context?.visibleRows || this.actions.getVisibleRows?.();
      const viewType = config?.viewType;
      if (this.actions.createEntry && config && visibleRows && viewType !== "calendar" && viewType !== "timeline") {
        const defaults = this.actions.getCreateDefaults?.(row, context) ?? {};
        const paths = visibleRows.map((r) => r.file.path);
        const index = paths.indexOf(row.file.path);
        const sorted = isExplicitlySorted(config);
        menu.addItem((item) => item
          .setTitle(t("menu.insertAbove"))
          .setIcon("chevron-up")
          .setDisabled(sorted)
          .onClick(() => this.actions.createEntry?.(defaults, { afterPath: index > 0 ? paths[index - 1] : undefined, beforePath: row.file.path }))
        );
        menu.addItem((item) => item
          .setTitle(t("menu.insertBelow"))
          .setIcon("chevron-down")
          .setDisabled(sorted)
          .onClick(() => this.actions.createEntry?.(defaults, { afterPath: row.file.path, beforePath: index < paths.length - 1 ? paths[index + 1] : undefined }))
        );
        menu.addSeparator();
      }
      if (this.actions.toggleRecordIcon && this.actions.canToggleRecordIcon?.() === true) {
        menu.addItem((item) => item
          .setTitle(t("recordIcon.show"))
          .setIcon("smile-plus")
          .setChecked(this.actions.isRecordIconShown?.() === true)
          .onClick((clickEvent) => {
            const anchor = isHTMLElement(clickEvent.currentTarget) ? clickEvent.currentTarget : isHTMLElement(clickEvent.target) ? clickEvent.target : null;
            if (anchor) this.actions.toggleRecordIcon?.(anchor, row);
          })
        );
        menu.addSeparator();
      }
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

    if (anchorEl?.isConnected) {
      const rect = anchorEl.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    } else {
      menu.showAtMouseEvent(event);
    }
  }
}
