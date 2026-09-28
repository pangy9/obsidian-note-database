import { App, Menu } from "obsidian";
import { CreateEntryPosition, RowCreateContext, RowData, ViewConfig } from "../data/types";
import { isExplicitlySorted } from "../data/ManualOrder";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";
import { confirmWithModal } from "./modals/ConfirmModal";
import { promptMoveToPosition } from "./modals/MoveToPositionModal";
import { getMovePositionNeighbors } from "../data/MovePosition";
import { getRecordReorderContext, planRecordReorder } from "./RecordReorderContext";
import { getRecordReorderLabel } from "./RecordReorderLabel";
import { startMobileRecordTargetMode } from "./MobileRecordTargetMode";

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
  /** 手动排序（桌面右键菜单与手机端共用链路）：移动行到指定邻居之间。 */
  moveRowToPosition?(movedPath: string, beforePath?: string, afterPath?: string): void;
  /** 跨组移动：更新分组字段到目标组并落位（手机端跨组同款落点）。 */
  moveRowWithGroupUpdatesAndPosition?(row: RowData, updates: Array<{ field: string; fromGroupKey: string; toGroupKey: string }>, beforePath?: string, afterPath?: string): void;
  /** 「进入排序模式」需要容器 DOM（点选目标模式在其内拦截行点击）；无容器则隐藏该项。 */
  getMenuRoot?(): HTMLElement | null;
  readonly isReadOnly?: boolean;
}

export class RowMenu {
  private stopTargetMode?: () => void;

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
    context = getRecordReorderContext(anchorEl || (event.target instanceof Element ? event.target : null)) || context;
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
      if (this.actions.createEntry && config && visibleRows && viewType !== "calendar" && viewType !== "timeline" && viewType !== "form") {
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
      }
      if (config && visibleRows) this.addReorderItems(menu, row, config, { ...context, visibleRows });
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

  /**
   * 手动排序操作组（对齐手机端链路，接入桌面右键菜单）：进入排序模式（点选目标）/
   * 上移 / 下移 / 移动到第几位。相邻移动和序号使用当前组的显示顺序；点选支持跨组。
   * 跨组落点同时更新主分组和子分组。门控与手机端
   * 一致——显式排序时整组禁用；日历/表单视图直接不渲染。
   */
  private addReorderItems(menu: Menu, row: RowData, config: ViewConfig, source: RowCreateContext): void {
    const visibleRows = source.visibleRows || [];
    const actions = this.actions;
    const move: ((movedPath: string, beforePath?: string, afterPath?: string) => void) | undefined = actions.moveRowToPosition?.bind(actions);
    if (!move) return;
    // Calendar ranks can break same-day stack ties, but generic row movement
    // does not change dates. Keep that separate from this record-order menu.
    if (config.viewType === "calendar" || config.viewType === "form") return;
    const allRows = actions.getVisibleRows?.() || visibleRows;
    const allPaths = allRows.map((candidate) => candidate.file.path);
    const groupPaths = visibleRows.map((candidate) => candidate.file.path);
    const allIndex = allPaths.indexOf(row.file.path);
    if (allIndex < 0 || allPaths.length <= 1) return;
    const moveTo = (position: number) => {
      const neighbors = getMovePositionNeighbors(groupPaths, row.file.path, position);
      if (neighbors) move(row.file.path, neighbors.previousPath, neighbors.nextPath);
    };
    const getPlan = (element: HTMLElement, targetPath: string, placement: "before" | "after") => {
      const target = getRecordReorderContext(element);
      if (!target) return null;
      const plan = planRecordReorder(config, source, target, row.file.path, targetPath, placement);
      return plan && (!plan.updates.length || actions.moveRowWithGroupUpdatesAndPosition) ? plan : null;
    };
    const moveWithGroup = (targetPath: string, placement: "before" | "after", element: HTMLElement) => {
      const plan = getPlan(element, targetPath, placement);
      if (!plan) return;
      if (plan.updates.length) {
        actions.moveRowWithGroupUpdatesAndPosition?.(row, plan.updates, plan.previousPath, plan.nextPath);
      } else {
        move(row.file.path, plan.previousPath, plan.nextPath);
      }
    };
    const disabled = isExplicitlySorted(config);
    const lockReason = disabled ? t("menu.reorderSortedDisabled") : "";
    menu.addSeparator();
    const root = this.actions.getMenuRoot?.();
    if (root) {
      menu.addItem((item) => item
        .setTitle(t("mobile.chooseTarget"))
        .setIcon("mouse-pointer-2")
        .setDisabled(disabled)
        .onClick(() => {
          if (disabled) return;
          this.stopTargetMode?.();
          const labels = new Map(allRows.map((candidate) => [candidate.file.path, getRecordReorderLabel(candidate, config)]));
          this.stopTargetMode = startMobileRecordTargetMode({
            root,
            // Desktop RowMenu receives the database container itself. Its parent
            // is outside the scoped banner styles and can sit above the view.
            bannerHost: root,
            movedPath: row.file.path,
            eligiblePaths: new Set(allPaths),
            canSelectTarget: (element) => Boolean(getPlan(element, element.getAttribute("data-note-database-row-path") || "", "before")),
            labelForPath: (path) => labels.get(path) || path,
            onPlace: moveWithGroup,
          });
        })
      );
      if (lockReason) {
        menu.addItem((item) => item
          .setTitle(lockReason)
          .setDisabled(true)
        );
      }
    }
    const groupIndex = groupPaths.indexOf(row.file.path);
    menu.addItem((item) => item
      .setTitle(t("menu.moveUp"))
      .setIcon("chevron-up")
      .setDisabled(disabled || groupIndex <= 0)
      .onClick(() => moveTo(groupIndex))
    );
    menu.addItem((item) => item
      .setTitle(t("menu.moveDown"))
      .setIcon("chevron-down")
      .setDisabled(disabled || groupIndex < 0 || groupIndex >= groupPaths.length - 1)
      .onClick(() => moveTo(groupIndex + 2))
    );
    // 「移动到...」限定当前分组内的序号（分组视图 = context 传入的组内行）。
    menu.addItem((item) => item
      .setTitle(t("mobile.moveToPosition"))
      .setIcon("list-ordered")
      .setDisabled(disabled || groupIndex < 0 || groupPaths.length <= 1)
      .onClick(() => {
        void promptMoveToPosition(
          this.actions.app,
          groupIndex + 1,
          visibleRows.map((candidate) => getRecordReorderLabel(candidate, config))
        ).then((position) => {
          if (position == null || position - 1 === groupIndex) return;
          const neighbors = getMovePositionNeighbors(groupPaths, row.file.path, position);
          if (neighbors) move(row.file.path, neighbors.previousPath, neighbors.nextPath);
        });
      })
    );
  }
}
