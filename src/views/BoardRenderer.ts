import { App, Menu, setIcon, setTooltip } from "obsidian";
import { getColumnOptions, isObsidianTagsKey, normalizeOptionValueForKey, toBooleanValue, toMultiSelectValuesForKey } from "../data/ColumnTypes";
import { OPTION_REGISTRATION_COLORS } from "../data/OptionRegistration";
import { isExplicitlySorted } from "../data/ManualOrder";
import { getColumnDisplayType, getNumberDisplayStyle } from "../data/ColumnDisplay";
import { formatDateTimeValueDisplay, formatDateValueDisplay } from "../data/DateTimeFormat";
import { getFileFieldFixedType, getRowFileFieldValue, isFileFieldKey, isReadonlyFileField } from "../data/FileFields";
import { formatGroupKeyDisplay, isComputedGroupField } from "../data/GroupDisplay";
import { parseTextLink } from "../data/TextLink";
import { parseInlineMarkdown } from "../data/InlineMarkdown";
import { ColumnDef, CreateEntryPosition, NO_TITLE_FIELD, RowCreateContext, RowData, StatusColor, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { isHTMLElement } from "./DomGuards";
import { setFieldTooltip } from "./FieldTooltip";
import { getFileTitleDisplay, renderStackedFileTitle } from "./FileTitleDisplay";
import { renderMobileMoveIcon } from "./MobileMoveIcon";
import { renderSpecialFileFieldValue, shouldRenderSpecialFileField } from "./FileFieldRenderer";
import { renderRating, renderProgress, renderProgressRing } from "./NumberDisplayRenderer";
import { renderRelationValue } from "./RelationValueRenderer";
import { renderInlineMarkdown, resolveInlineImageSrc, valueToTooltip } from "./InlineMarkdownRenderer";
import { clampCardFieldWidth, getFieldWidth } from "./ColumnWidth";
import { renderGroupExpandControls } from "./GroupExpandControls";
import { getGroupVisibleCount } from "../data/GroupVisibility";
import { resolveBoardCardDropIntent, resolveBoardColumnByPoint, resolveBoardContainerDropOrder, type BoardDropCandidate } from "../data/BoardContainerDrop";
import { resolveTitleFieldDisplay } from "../data/TitleFieldDisplay";
import { isImeComposing } from "../data/KeyboardUtils";
import { openOptionColorPicker } from "./OptionColorPicker";

const CARD_MIME = "application/x-note-database-card";
const CARD_FROM_GROUP_MIME = "application/x-note-database-card-from-group";
const CARD_FROM_SUBGROUP_MIME = "application/x-note-database-card-from-subgroup";
const GROUP_MIME = "application/x-note-database-group";

export interface BoardGroup {
  key: string;
  rows: RowData[];
  count: number;
  subgroups?: BoardSubgroup[];
}

export interface BoardSubgroup {
  key: string;
  rows: RowData[];
  count: number;
}

export interface BoardRendererActions {
  openRow(row: RowData): void;
  createEntry(defaults?: Record<string, unknown>, position?: CreateEntryPosition): void;
  createGroup?(field: string, name: string, color: StatusColor): Promise<boolean>;
  updateGroup(row: RowData, field: string, value: string, fromValue?: string): Promise<void>;
  updateGroupOrder(field: string, order: string[]): void;
  updateCardOrder(field: string, groupKey: string, paths: string[]): void;
  moveRowToPosition(movedPath: string, beforePath?: string, afterPath?: string): void;
  moveRowWithGroupUpdatesAndPosition?(
    row: RowData,
    updates: Array<{ field: string; fromGroupKey: string; toGroupKey: string }>,
    beforePath?: string,
    afterPath?: string
  ): void | Promise<void>;
  updateColumnWidth(width: number): void;
  isRowSelected(row: RowData): boolean;
  toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void;
  areAllRowsSelected(rows: RowData[]): boolean;
  toggleRowsSelected(rows: RowData[], selected: boolean): void;
  editCell(target: HTMLElement, row: RowData, col: ColumnDef, event?: MouseEvent): void;
  editFileName?(target: HTMLElement, row: RowData, currentName: string): void;
  getColumns(config: ViewConfig): ColumnDef[];
  isGroupCollapsed?(field: string, key: string): boolean;
  toggleGroupCollapsed?(field: string, key: string): void;
  expandGroup?(field: string, key: string, count: number): void;
  showRowMenu?(event: MouseEvent, row: RowData, context?: RowCreateContext): void;
  showColumnMenu?(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement): void;
  editFormula?(col: ColumnDef): void;
  renderRecordIcon?(parent: HTMLElement, row: RowData, config: ViewConfig, compact?: boolean): HTMLElement | null;
  renderGroupSummaries?(parent: HTMLElement, rows: RowData[], config: ViewConfig): void;
  applyConditionalFormat?(element: HTMLElement, row: RowData, config: ViewConfig, targetField?: string): void;
  readonly isReadOnly?: boolean;
  readonly hideCreateEntry?: boolean;
  readonly canReorderGroups?: boolean;
}

interface ParsedLink {
  label: string;
  target: string;
  external: boolean;
}

export class BoardRenderer {
  private rowByPath = new Map<string, RowData>();
  private transientTimers = new WeakMap<HTMLElement, Map<string, number>>();
  private dragEnterCount = new WeakMap<HTMLElement, number>();
  // .db-board 兜底拖拽落点：当前高亮的列/子分组 + preview 占位 + 兜底淡出 timer。
  private currentBoardDropZone: HTMLElement | null = null;
  private boardDropFadeTimer: number | null = null;
  private resizeState?: { startX: number; startWidth: number; board: HTMLElement };
  private draggingCardPath?: string;
  // 当前渲染的看板与分组元数据，供拖拽期间实时列命中（方案 A/B）复用。
  private boardEl: HTMLElement | null = null;
  private boardGroups: BoardGroup[] = [];
  private boardGroupField = "";
  private boardSubgroupField?: string;
  // 方案 B：鼠标附近浮动列名 preview（单例，dragstart 建 / dragend 删）。
  private boardDragPreview: HTMLElement | null = null;
  private boardDragLabelByKey = new Map<string, string>();
  private boundBoardDragOver?: (event: DragEvent) => void;

  constructor(private app: App, private actions: BoardRendererActions) {}

  render(container: HTMLElement, config: ViewConfig, groups: BoardGroup[], groupField: string): void {
    this.clear(container);
    // 幂等清理：拖拽中途若触发 re-render 导致 board DOM 被替换，dragend 可能不再触发，
    // 这里兜底移除残留的浮动列名 preview 与 dragover 监听，避免孤儿元素与监听器泄漏。
    this.endBoardDragPreview();
    this.rowByPath = new Map(groups.flatMap((group) => group.rows.map((row) => [row.file.path, row] as const)));
    const board = container.createDiv({ cls: "db-board" });
    // 缓存当前看板与分组元数据，供拖拽期间实时列命中（方案 A/B）复用。
    this.boardEl = board;
    this.boardGroups = groups;
    this.boardGroupField = groupField;
    this.boardSubgroupField = config.boardSubgroupEnabled !== false && config.boardSubgroupField && config.boardSubgroupField !== groupField
      ? config.boardSubgroupField
      : undefined;
    board.style.setProperty("--db-board-column-width", `${this.getBoardColumnWidth(config)}px`);
    this.attachBoardContainerDropHandlers(board, groupField);
    for (const group of groups) {
      this.renderColumn(board, config, groups, group, groupField);
    }
    if (
      !this.actions.isReadOnly
      && !this.actions.hideCreateEntry
      && this.actions.createGroup
      && this.canCreateGroup(config, groupField)
    ) {
      this.renderAddGroupControl(board, config, groupField);
    }
  }

  private canCreateGroup(config: ViewConfig, groupField: string): boolean {
    const column = config.schema.columns.find((candidate) => candidate.key === groupField);
    if (!column || column.type === "computed" || column.type === "rollup" || isObsidianTagsKey(column.key)) return false;
    const displayType = getColumnDisplayType(column, config.schema.computedFields);
    return displayType === "status" || displayType === "select" || displayType === "multi-select";
  }

  private renderAddGroupControl(board: HTMLElement, config: ViewConfig, groupField: string): void {
    const column = config?.schema.columns.find((candidate) => candidate.key === groupField);
    let selectedColor: StatusColor = OPTION_REGISTRATION_COLORS[
      (column?.statusOptions?.length || 0) % OPTION_REGISTRATION_COLORS.length
    ];
    const addGroup = board.createDiv({ cls: "db-board-add-column" });
    const trigger = addGroup.createEl("button", {
      cls: "db-board-add-group-trigger",
      text: `+ ${t("board.newGroup")}`,
      attr: { type: "button" },
    });
    trigger.onclick = () => {
      trigger.remove();
      const editor = addGroup.createDiv({ cls: "db-board-add-group-editor" });
      const input = editor.createEl("input", {
        cls: "db-board-add-group-input",
        attr: {
          type: "text",
          placeholder: t("board.groupNamePlaceholder"),
          "aria-label": t("board.groupNamePlaceholder"),
        },
      });
      const confirm = editor.createEl("button", {
        cls: "db-board-add-group-confirm",
        attr: { type: "button", title: t("common.save"), "aria-label": t("common.save") },
      });
      setIcon(confirm, "check");
      const cancel = editor.createEl("button", {
        cls: "db-board-add-group-cancel",
        attr: { type: "button", title: t("common.cancel"), "aria-label": t("common.cancel") },
      });
      setIcon(cancel, "x");
      const colorPreview = editor.createSpan({
        cls: `db-board-add-group-color-preview db-option-color-${selectedColor}`,
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": t("board.groupColor"),
          title: t("board.groupColor"),
        },
      });
      let closeColorPicker: (() => void) | undefined;
      const openColorPicker = () => {
        closeColorPicker = openOptionColorPicker(colorPreview, selectedColor, (color) => {
          colorPreview.removeClass(`db-option-color-${selectedColor}`);
          selectedColor = color;
          colorPreview.addClass(`db-option-color-${selectedColor}`);
        });
      };
      colorPreview.onclick = (event) => {
        event.stopPropagation();
        openColorPicker();
      };
      colorPreview.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openColorPicker();
      };
      let submitting = false;
      const close = () => {
        closeColorPicker?.();
        editor.remove();
        addGroup.remove();
        this.renderAddGroupControl(board, config, groupField);
      };
      const submit = async () => {
        const name = input.value.trim();
        if (!name || submitting || !this.actions.createGroup) return;
        submitting = true;
        closeColorPicker?.();
        input.disabled = true;
        confirm.disabled = true;
        const created = await this.actions.createGroup(groupField, name, selectedColor);
        if (created) return;
        submitting = false;
        input.disabled = false;
        confirm.disabled = false;
        input.focus();
        input.select();
      };
      confirm.onclick = () => { void submit(); };
      cancel.onclick = close;
      input.onkeydown = (event) => {
        if (isImeComposing(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      };
      input.focus();
    };
  }

  private renderColumn(
    board: HTMLElement,
    config: ViewConfig,
    groups: BoardGroup[],
    group: BoardGroup,
    groupField: string
  ): void {
    const column = board.createDiv({ cls: "db-board-column" });
    const subgroupField = config.boardSubgroupEnabled !== false && config.boardSubgroupField && config.boardSubgroupField !== groupField
      ? config.boardSubgroupField
      : undefined;
    column.addEventListener("dragover", (event) => {
      if (this.isGroupDrag(event)) {
        if (!this.canReorderGroups()) return;
      } else if (this.isCardDrag(event)) {
        // 跨组移动只改分组值、与排序无关，不再受 canReorderCards 约束；
        // 有子分组时列级不接 card drop（应落到 subgroup 容器）。
        if (this.actions.isReadOnly || subgroupField) return;
      } else {
        return;
      }
      event.preventDefault();
      this.addTransientClass(column, "is-drop-target", 900);
    });
    column.addEventListener("dragleave", () => this.clearTransientClass(column, "is-drop-target"));
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.clearTransientClass(column, "is-drop-target");
      const groupKey = event.dataTransfer?.getData(GROUP_MIME);
      if (groupKey && this.canReorderGroups()) {
        this.dropGroup(groups, groupField, groupKey, group.key, event, column);
        return;
      }
      if (this.actions.isReadOnly) return;
      const path = event.dataTransfer?.getData(CARD_MIME) || event.dataTransfer?.getData("text/plain");
      const row = path ? this.rowByPath.get(path) : undefined;
      const fromGroup = event.dataTransfer?.getData(CARD_FROM_GROUP_MIME) || undefined;
      if (row) {
        // 拖到列空白区：同列保持原位，跨列才追加到目标列末尾（Bug 1 修复）。
        const drop = resolveBoardContainerDropOrder({
          rows: group.rows,
          draggedPath: row.file.path,
          fromGroup,
          groupKey: group.key,
          fromSubgroup: undefined,
          subgroupKey: undefined,
        });
        if (drop.keepInPlace) return;
        void this.moveCardAndOrder(
          row,
          groupField,
          group.key,
          fromGroup,
          row.file.path,
          drop.order,
          undefined,
          undefined,
          undefined
        );
      }
    });

    const header = column.createDiv({ cls: "db-board-column-header" });
    const columnCollapsed = Boolean(this.actions.isGroupCollapsed?.(groupField, group.key));
    column.toggleClass("is-collapsed", columnCollapsed);
    if (this.canReorderGroups() && !this.isPhoneLayout()) {
      header.draggable = true;
      header.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData(GROUP_MIME, group.key);
        event.dataTransfer?.setData("text/plain", group.key);
        this.addTransientClass(column, "is-dragging", 2400);
      });
      header.addEventListener("dragend", () => this.clearTransientClass(column, "is-dragging"));
    }
    const toggle = header.createEl("button", {
      cls: `db-board-group-toggle${columnCollapsed ? " is-collapsed" : ""}`,
      attr: { type: "button", "aria-label": columnCollapsed ? t("group.expand") : t("group.collapse") },
    });
    toggle.createSpan({ cls: "db-collapse-triangle" });
    toggle.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.toggleGroupCollapsed?.(groupField, group.key);
    };
    if (!this.actions.isReadOnly) {
      const checkbox = header.createEl("input", { cls: "db-board-column-checkbox", attr: { type: "checkbox" } });
      checkbox.checked = this.actions.areAllRowsSelected(group.rows);
      checkbox.indeterminate = group.rows.some((row) => this.actions.isRowSelected(row)) && !checkbox.checked;
      checkbox.onclick = (event) => event.stopPropagation();
      checkbox.onchange = () => this.actions.toggleRowsSelected(group.rows, checkbox.checked);
    }
    const headerText = header.createDiv({ cls: "db-board-header-text" });
    this.renderGroupTitle(headerText, config, groupField, group.key, "db-board-column-title");
    headerText.createSpan({ cls: "db-board-count", text: String(group.count) });
    if (config.summaryRules?.length) {
      const summaries = headerText.createSpan({ cls: "db-board-header-summaries" });
      this.actions.renderGroupSummaries?.(summaries, group.rows, config);
    }
    if (!this.isPhoneLayout()) {
      const resizeHandle = column.createDiv({ cls: "db-board-column-resize-handle" });
      resizeHandle.addEventListener("mousedown", (event) => this.startColumnResize(event, board, config));
    }
    if (columnCollapsed) return;

    if (subgroupField && group.subgroups?.length) {
      const subgroups = column.createDiv({ cls: "db-board-subgroups" });
      for (const subgroup of group.subgroups) {
        this.renderSubgroup(subgroups, config, groups, group, subgroup, groupField, subgroupField);
      }
      return;
    }

    const cards = this.createCardsContainer(column, config, group, groupField);
    const visibleCount = getGroupVisibleCount(config, groupField, group.key, group.rows.length);
    for (const row of group.rows.slice(0, visibleCount)) {
      this.renderCard(cards, config, groups, group, row, groupField, undefined, undefined, group.rows);
    }
    renderGroupExpandControls(cards, config, groupField, group.key, group.rows.length, this.actions);
    if (!this.actions.isReadOnly && !this.actions.hideCreateEntry) {
      if (isComputedGroupField(config, groupField)) {
        cards.createEl("button", { cls: "db-board-new-card is-disabled", text: t("group.computedCreateDisabled"), attr: { disabled: "true" } });
      } else {
        cards.createEl("button", { cls: "db-board-new-card", text: `+ ${t("toolbar.new")}` }).onclick =
          () => this.createEntryNearEnd({ [groupField]: group.key || "" }, group.rows);
      }
    }
  }

  private renderSubgroup(
    parent: HTMLElement,
    config: ViewConfig,
    groups: BoardGroup[],
    group: BoardGroup,
    subgroup: BoardSubgroup,
    groupField: string,
    subgroupField: string
  ): void {
    const section = parent.createDiv({ cls: "db-board-subgroup" });
    const header = section.createDiv({ cls: "db-board-subgroup-header" });
    const collapsed = Boolean(this.actions.isGroupCollapsed?.(subgroupField, subgroup.key));
    section.toggleClass("is-collapsed", collapsed);
    const toggle = header.createEl("button", {
      cls: `db-board-subgroup-toggle${collapsed ? " is-collapsed" : ""}`,
      attr: { type: "button", "aria-label": collapsed ? t("group.expand") : t("group.collapse") },
    });
    toggle.createSpan({ cls: "db-collapse-triangle" });
    toggle.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.toggleGroupCollapsed?.(subgroupField, subgroup.key);
    };
    if (!this.actions.isReadOnly) {
      const checkbox = header.createEl("input", { cls: "db-board-subgroup-checkbox", attr: { type: "checkbox" } });
      checkbox.checked = this.actions.areAllRowsSelected(subgroup.rows);
      checkbox.indeterminate = subgroup.rows.some((row) => this.actions.isRowSelected(row)) && !checkbox.checked;
      checkbox.onclick = (event) => event.stopPropagation();
      checkbox.onchange = () => this.actions.toggleRowsSelected(subgroup.rows, checkbox.checked);
    }
    const headerText = header.createDiv({ cls: "db-board-header-text" });
    this.renderGroupTitle(headerText, config, subgroupField, subgroup.key, "db-board-subgroup-title");
    headerText.createSpan({ cls: "db-board-subgroup-count", text: String(subgroup.count) });
    if (config.summaryRules?.length) {
      const summaries = headerText.createSpan({ cls: "db-board-header-summaries" });
      this.actions.renderGroupSummaries?.(summaries, subgroup.rows, config);
    }
    if (collapsed) return;

    const cards = this.createCardsContainer(section, config, group, groupField, subgroupField, subgroup);
    const visibleCount = getGroupVisibleCount(config, subgroupField, subgroup.key, subgroup.rows.length);
    for (const row of subgroup.rows.slice(0, visibleCount)) {
      this.renderCard(cards, config, groups, group, row, groupField, subgroupField, subgroup.key, subgroup.rows);
    }
    renderGroupExpandControls(cards, config, subgroupField, subgroup.key, subgroup.rows.length, this.actions);
    if (!this.actions.isReadOnly && !this.actions.hideCreateEntry) {
      if (isComputedGroupField(config, groupField) || isComputedGroupField(config, subgroupField)) {
        cards.createEl("button", { cls: "db-board-new-card is-disabled", text: t("group.computedCreateDisabled"), attr: { disabled: "true" } });
      } else {
        cards.createEl("button", { cls: "db-board-new-card", text: `+ ${t("toolbar.new")}` }).onclick =
          () => this.createEntryNearEnd({ [groupField]: group.key || "", [subgroupField]: subgroup.key || "" }, subgroup.rows);
      }
    }
  }

  private createCardsContainer(
    parent: HTMLElement,
    config: ViewConfig,
    group: BoardGroup,
    groupField: string,
    subgroupField?: string,
    subgroup?: BoardSubgroup
  ): HTMLElement {
    const cards = parent.createDiv({ cls: "db-board-cards" });
    cards.addEventListener("dragover", (event) => {
      if (this.actions.isReadOnly) return;
      if (!this.isCardDrag(event)) return;
      // 跨组移动不受排序约束：非只读一律允许 drop，落点由 resolveBoardContainerDropOrder 决定。
      event.preventDefault();
      this.highlightCardDropZone(cards);
    });
    cards.addEventListener("drop", (event) => {
      if (this.actions.isReadOnly) return;
      const path = event.dataTransfer?.getData(CARD_MIME);
      if (!path) return;
      const row = this.rowByPath.get(path);
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      this.clearCardDropZone(cards);
      const fromGroup = event.dataTransfer?.getData(CARD_FROM_GROUP_MIME) || undefined;
      const fromSubgroup = event.dataTransfer?.getData(CARD_FROM_SUBGROUP_MIME) || undefined;
      // 拖到卡片容器空白区：同分组保持原位，跨分组才追加到目标分组末尾（Bug 1 修复）。
      const drop = resolveBoardContainerDropOrder({
        rows: subgroup?.rows ?? group.rows,
        draggedPath: path,
        fromGroup,
        groupKey: group.key,
        fromSubgroup,
        subgroupKey: subgroup?.key,
      });
      if (drop.keepInPlace) return;
      void this.moveCardAndOrder(row, groupField, group.key, fromGroup, path, drop.order, subgroupField, subgroup?.key, fromSubgroup);
    });
    return cards;
  }

  private createEntryNearEnd(defaults: Record<string, unknown> | undefined, rows: RowData[]): void {
    this.actions.createEntry(defaults, this.getCreatePosition(rows));
  }

  private getCreatePosition(rows: RowData[]): CreateEntryPosition | undefined {
    const last = rows[rows.length - 1];
    return last ? { afterPath: last.file.path } : undefined;
  }

  private renderCard(
    cards: HTMLElement,
    config: ViewConfig,
    groups: BoardGroup[],
    group: BoardGroup,
    row: RowData,
    groupField: string,
    subgroupField?: string,
    subgroupKey?: string,
    visibleRows: RowData[] = group.rows
  ): void {
    const card = cards.createDiv({
      cls: "db-board-card",
      attr: { "data-note-database-row-path": row.file.path, title: row.file.path },
    });
    this.actions.applyConditionalFormat?.(card, row, config);
    this.attachRowContextMenu(card, row, {
      visibleRows,
      groups: [
        { field: groupField, key: group.key },
        ...(subgroupField && subgroupKey != null ? [{ field: subgroupField, key: subgroupKey }] : []),
      ],
    });
    if (!this.actions.isReadOnly && !this.isPhoneLayout()) {
      card.draggable = true;
      card.addEventListener("dragstart", (event) => {
        if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData(CARD_MIME, row.file.path);
        event.dataTransfer?.setData("text/plain", row.file.path);
        event.dataTransfer?.setData(CARD_FROM_GROUP_MIME, group.key);
        if (subgroupKey != null) event.dataTransfer?.setData(CARD_FROM_SUBGROUP_MIME, subgroupKey);
        this.draggingCardPath = row.file.path;
        this.addTransientClass(card, "is-dragging", 2400);
        // 方案 A：拖拽期间让列等高（align-items: stretch），使每个列标题的 sticky 失效点推迟到看板底部；
        // 方案 B：启动鼠标附近浮动列名 preview。
        this.boardEl?.addClass("is-card-dragging");
        this.beginBoardDragPreview(config);
      });
      card.addEventListener("dragover", (event) => {
        if (!this.isCardDrag(event)) return;
        const path = this.draggingCardPath || event.dataTransfer?.getData(CARD_MIME);
        if (!path || path === row.file.path || !this.rowByPath.has(path)) return;
        event.preventDefault();
        // before/after 精确插入指示线在未显式排序时显示（同组重排或跨组移动到目标卡片位置
        // 都按鼠标位置精确插入）；显式排序下位置由排序规则决定、精确插入无意义，故不显示，
        // 但 drop 仍被允许以支持跨组移动。
        if (this.canReorderCards(config)) {
          const rect = card.getBoundingClientRect();
          card.toggleClass("is-drop-before", event.clientY <= rect.top + rect.height / 2);
          card.toggleClass("is-drop-after", event.clientY > rect.top + rect.height / 2);
        } else {
          card.removeClass("is-drop-before", "is-drop-after");
        }
        this.addTransientClass(card, "is-drop-target", 900);
        this.highlightCardDropZone(card);
      });
      card.addEventListener("dragenter", (event) => {
        if (!event.dataTransfer?.types.includes(CARD_MIME)) return;
        const count = (this.dragEnterCount.get(card) || 0) + 1;
        this.dragEnterCount.set(card, count);
      });
      card.addEventListener("dragleave", () => {
        const count = (this.dragEnterCount.get(card) || 1) - 1;
        this.dragEnterCount.set(card, count);
        window.setTimeout(() => {
          if ((this.dragEnterCount.get(card) || 0) <= 0) {
            this.clearCardDropTarget(card);
          }
        }, 0);
      });
      card.addEventListener("drop", (event) => {
        const path = event.dataTransfer?.getData(CARD_MIME);
        const dragged = path ? this.rowByPath.get(path) : undefined;
        if (!path || !dragged) return;
        if (path === row.file.path) return;
        event.preventDefault();
        event.stopPropagation();
        this.clearCardDropTarget(card);
        const fromGroup = event.dataTransfer?.getData(CARD_FROM_GROUP_MIME) || undefined;
        const fromSubgroup = event.dataTransfer?.getData(CARD_FROM_SUBGROUP_MIME) || undefined;
        // 跨组移动只改分组值、不受排序约束；同组重排序在显式排序下忽略（manual order 被覆盖）。
        const intent = resolveBoardCardDropIntent({
          fromGroup,
          targetGroupKey: group.key,
          explicitlySorted: isExplicitlySorted(config),
        });
        if (intent === "ignore") return;
        void this.moveCardAndOrder(dragged, groupField, group.key, fromGroup, path, this.getCardDropOrder(visibleRows, path, row.file.path, event, card), subgroupField, subgroupKey, fromSubgroup);
      });
      card.addEventListener("dragend", () => {
        this.clearTransientClass(card, "is-dragging");
        this.clearCardDropTarget(card);
        this.draggingCardPath = undefined;
        // 方案 A/B 收尾：恢复列等高状态，移除浮动列名 preview。
        this.boardEl?.removeClass("is-card-dragging");
        this.endBoardDragPreview();
      });
    }

    const controls = card.createDiv({ cls: "db-board-card-controls" });
    if (!this.actions.isReadOnly) {
      const checkbox = controls.createEl("input", { cls: "db-board-card-checkbox", attr: { type: "checkbox" } });
      checkbox.checked = this.actions.isRowSelected(row);
      checkbox.onclick = (event) => {
        event.stopPropagation();
        this.actions.toggleRowSelected(row, !this.actions.isRowSelected(row), event);
      };
    }
    const openBtn = controls.createEl("button", {
      cls: "db-board-card-open",
    });
    setIcon(openBtn, "maximize-2");
    setTooltip(openBtn, t("menu.openNote"), { delay: 100 });
    openBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.openRow(row);
    };
    if (!this.actions.isReadOnly && this.isPhoneLayout()) {
      this.renderMobileMoveButton(controls, config, groups, group, row, groupField, subgroupField, subgroupKey);
    }
    const columns = this.actions.getColumns(config);
    const titleField = this.getTitleField(config);
    const title = titleField ? resolveTitleFieldDisplay(row, config, titleField) : undefined;
    if (title && !title.isHidden) {
      const titleLine = card.createDiv({ cls: "db-record-title-line" });
      this.actions.renderRecordIcon?.(titleLine, row, config);
      const titleEl = titleLine.createDiv({
        cls: "db-board-card-title",
        attr: { title: title.isFileTitle ? row.file.path : title.isEmpty ? "" : title.text },
      });
      if (title.isFileTitle) {
        renderStackedFileTitle(titleEl, getFileTitleDisplay(row, Array.from(this.rowByPath.values())), true);
        if (!this.actions.isReadOnly && this.actions.editFileName) {
          titleEl.addClass("db-editable-cell");
          setFieldTooltip(titleEl, row.file.path, t("cell.doubleClickRename"));
          titleEl.addEventListener("dblclick", (event) => {
            event.stopPropagation();
            this.actions.editFileName?.(titleEl, row, row.file.basename);
          });
        }
      } else {
        titleEl.textContent = title.text;
        if (title.isEmpty) titleEl.addClass("is-empty-title");
      }
    }
    const meta = card.createDiv({ cls: "db-board-card-meta" });
    const fields = columns.filter((col) => col.key !== titleField);
    for (const col of fields) {
      const value = this.getCellValue(row, col);
      const displayType = this.getDisplayType(config, col);
      const empty = this.isEmptyValue(value) && displayType !== "checkbox";
      if (empty && !this.shouldShowEmptyField(config, col)) continue;
      const displayValue = empty ? this.getEmptyDisplayValue(col, displayType) : value;
      const item = meta.createDiv({ cls: "db-board-card-field", attr: { "data-note-database-column-key": col.key } });
      this.actions.applyConditionalFormat?.(item, row, config, col.key);
      item.style.setProperty("--db-card-field-width", `${this.getCardFieldWidth(config, col)}px`);
      setFieldTooltip(item, displayValue, col.label);
      if (empty) item.addClass("is-empty-field");
      if (displayType === "checkbox") item.addClass("is-checkbox-field");
      if (col.wrap) item.addClass("db-board-card-field-wrap");
      const label = item.createSpan({ text: col.label });
      this.attachColumnContextMenu(item, col);
      this.attachColumnContextMenu(label, col);
      this.renderPreviewValue(item, row, col, displayValue, empty, displayType);
    }
  }

  private attachRowContextMenu(el: HTMLElement, row: RowData, context?: RowCreateContext): void {
    el.addEventListener("contextmenu", (event) => {
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button")) return;
      this.actions.showRowMenu?.(event, row, context);
    });
  }

  private attachColumnContextMenu(el: HTMLElement, col: ColumnDef): void {
    el.addEventListener("contextmenu", (event) => {
      if (!this.actions.showColumnMenu) return;
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button, a")) return;
      event.preventDefault();
      event.stopPropagation();
      this.actions.showColumnMenu(event, col, el);
    });
  }

  private renderMobileMoveButton(
    card: HTMLElement,
    config: ViewConfig,
    groups: BoardGroup[],
    currentGroup: BoardGroup,
    row: RowData,
    groupField: string,
    subgroupField?: string,
    subgroupKey?: string
  ): void {
    // 手机移动菜单支持跨组移动（与排序状态无关）；只读视图由调用方 renderCard 守卫，不会进入此处。
    const button = card.createEl("button", {
      cls: "db-card-mobile-move-btn",
      attr: { type: "button", title: t("mobile.moveCard"), "aria-label": t("mobile.moveCard") },
    });
    renderMobileMoveIcon(button);
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showMobileBoardMoveMenu(event, config, groups, currentGroup, row, groupField, subgroupField, subgroupKey);
    };
  }

  private showMobileBoardMoveMenu(
    event: MouseEvent,
    config: ViewConfig,
    groups: BoardGroup[],
    currentGroup: BoardGroup,
    row: RowData,
    groupField: string,
    subgroupField?: string,
    subgroupKey?: string
  ): void {
    const menu = new Menu();
    const currentRows = subgroupField
      ? currentGroup.subgroups?.find((subgroup) => subgroup.key === subgroupKey)?.rows || []
      : currentGroup.rows;
    const applyOrder = (targetGroup: BoardGroup, targetSubgroupKey: string | undefined, placement: "top" | "bottom" | "before" | "after", targetPath?: string) => {
      void this.moveCardAndOrder(
        row,
        groupField,
        targetGroup.key,
        currentGroup.key,
        row.file.path,
        this.getMobileTargetOrder(targetGroup, row.file.path, placement, targetPath, subgroupField, targetSubgroupKey),
        subgroupField,
        targetSubgroupKey,
        subgroupKey
      );
    };

    menu.addItem((item) => item.setTitle(t("mobile.moveTop")).setIcon("chevrons-up").onClick(() => applyOrder(currentGroup, subgroupKey, "top")));
    menu.addItem((item) => item.setTitle(t("mobile.moveBottom")).setIcon("chevrons-down").onClick(() => applyOrder(currentGroup, subgroupKey, "bottom")));
    for (const target of currentRows.filter((candidate) => candidate.file.path !== row.file.path)) {
      const label = this.getMobileRowLabel(config, target);
      menu.addItem((item) => item
        .setTitle(`${t("mobile.moveBefore")} ${label}`)
        .setIcon("corner-up-left")
        .onClick(() => applyOrder(currentGroup, subgroupKey, "before", target.file.path)));
      menu.addItem((item) => item
        .setTitle(`${t("mobile.moveAfter")} ${label}`)
        .setIcon("corner-down-left")
        .onClick(() => applyOrder(currentGroup, subgroupKey, "after", target.file.path)));
    }

    const targetGroups = subgroupField
      ? groups.flatMap((group) => (group.subgroups || []).map((subgroup) => ({ group, subgroupKey: subgroup.key })))
      : groups.map((group) => ({ group, subgroupKey: undefined as string | undefined }));
    if (targetGroups.length) menu.addSeparator();
    for (const target of targetGroups) {
      const isCurrent = target.group.key === currentGroup.key && target.subgroupKey === subgroupKey;
      if (isCurrent) continue;
      const groupLabel = formatGroupKeyDisplay(config, groupField, target.group.key);
      const subgroupLabel = target.subgroupKey == null
        ? undefined
        : formatGroupKeyDisplay(config, subgroupField, target.subgroupKey);
      const label = subgroupField
        ? `${groupLabel} / ${subgroupLabel || t("common.uncategorized")}`
        : groupLabel;
      menu.addItem((item) => item
        .setTitle(`${t("mobile.moveTo")} ${label}`)
        .setIcon("folder-input")
        .onClick(() => applyOrder(target.group, target.subgroupKey, "bottom")));
    }
    menu.showAtMouseEvent(event);
  }

  private getMobileTargetOrder(
    group: BoardGroup,
    draggedPath: string,
    placement: "top" | "bottom" | "before" | "after",
    targetPath?: string,
    subgroupField?: string,
    subgroupKey?: string
  ): string[] {
    const targetRows = subgroupField && subgroupKey != null
      ? group.subgroups?.find((subgroup) => subgroup.key === subgroupKey)?.rows || []
      : group.rows;
    const order = targetRows.map((candidate) => candidate.file.path).filter((path) => path !== draggedPath);
    if (placement === "top") return [draggedPath, ...order];
    if (placement === "bottom" || !targetPath) return [...order, draggedPath];
    const targetIndex = order.indexOf(targetPath);
    if (targetIndex < 0) return [...order, draggedPath];
    order.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggedPath);
    return order;
  }

  private getMobileRowLabel(config: ViewConfig, row: RowData): string {
    const titleField = this.getTitleField(config);
    const title = titleField ? resolveTitleFieldDisplay(row, config, titleField) : undefined;
    return title && !title.isHidden ? title.text : row.file.name.replace(/\.md$/, "");
  }

  private dropGroup(
    groups: BoardGroup[],
    groupField: string,
    draggedKey: string,
    targetKey: string,
    event: DragEvent,
    column: HTMLElement
  ): void {
    if (draggedKey === targetKey) return;
    const order = groups.map((group) => group.key);
    const from = order.indexOf(draggedKey);
    const target = order.indexOf(targetKey);
    if (from < 0 || target < 0) return;
    const rect = column.getBoundingClientRect();
    let insertIndex = event.clientX > rect.left + rect.width / 2 ? target + 1 : target;
    const [item] = order.splice(from, 1);
    if (from < insertIndex) insertIndex -= 1;
    order.splice(insertIndex, 0, item);
    this.actions.updateGroupOrder(groupField, order);
  }

  private getCardDropOrder(
    rows: RowData[],
    draggedPath: string,
    targetPath: string,
    event: DragEvent,
    card: HTMLElement
  ): string[] {
    const order = rows.map((row) => row.file.path).filter((path) => path !== draggedPath);
    const target = order.indexOf(targetPath);
    if (draggedPath === targetPath || target < 0) return order;
    const rect = card.getBoundingClientRect();
    let insertIndex = event.clientY > rect.top + rect.height / 2 ? target + 1 : target;
    order.splice(insertIndex, 0, draggedPath);
    return order;
  }

  private async moveCardAndOrder(
    row: RowData,
    groupField: string,
    groupKey: string,
    fromGroup: string | undefined,
    draggedPath: string,
    order: string[],
    subgroupField?: string,
    subgroupKey?: string,
    fromSubgroup?: string
  ): Promise<void> {
    if (!order.includes(draggedPath)) order = [...order, draggedPath];
    const position = this.getDropPositionFromOrder(order, draggedPath);
    const groupUpdates: Array<{ field: string; fromGroupKey: string; toGroupKey: string }> = [];
    if (fromGroup && fromGroup !== groupKey) {
      groupUpdates.push({ field: groupField, fromGroupKey: fromGroup, toGroupKey: groupKey });
    }
    if (subgroupField && subgroupKey != null && fromSubgroup && fromSubgroup !== subgroupKey) {
      groupUpdates.push({ field: subgroupField, fromGroupKey: fromSubgroup, toGroupKey: subgroupKey });
    }
    if (groupUpdates.length > 0 && this.actions.moveRowWithGroupUpdatesAndPosition) {
      await this.actions.moveRowWithGroupUpdatesAndPosition(row, groupUpdates, position.before, position.after);
      return;
    }
    for (const update of groupUpdates) {
      await this.actions.updateGroup(row, update.field, update.toGroupKey, update.fromGroupKey);
    }
    this.actions.moveRowToPosition(draggedPath, position.before, position.after);
  }

  private updateCardOrder(groupField: string, groupKey: string, paths: string[]): void {
    this.actions.updateCardOrder(groupField, groupKey, paths);
  }

  private getDropPositionFromOrder(order: string[], movedPath: string): { before?: string; after?: string } {
    const index = order.indexOf(movedPath);
    if (index < 0) return {};
    return {
      before: index > 0 ? order[index - 1] : undefined,
      after: index < order.length - 1 ? order[index + 1] : undefined,
    };
  }

  private canReorderCards(config: ViewConfig): boolean {
    return !isExplicitlySorted(config);
  }

  private canReorderGroups(): boolean {
    return !this.actions.isReadOnly || this.actions.canReorderGroups === true;
  }

  private isCardDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types || []).includes(CARD_MIME);
  }

  private isGroupDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types || []).includes(GROUP_MIME);
  }

  private isPhoneLayout(): boolean {
    return window.activeDocument.body.classList.contains("is-phone");
  }

  private highlightCardDropZone(source: HTMLElement): void {
    const zone = source.closest<HTMLElement>(".db-board-subgroup") || source.closest<HTMLElement>(".db-board-column");
    if (zone) this.addTransientClass(zone, "is-drop-target", 900);
  }

  private clearCardDropZone(source: HTMLElement): void {
    const zone = source.closest<HTMLElement>(".db-board-subgroup") || source.closest<HTMLElement>(".db-board-column");
    if (zone) this.clearTransientClass(zone, "is-drop-target");
  }

  private addTransientClass(el: HTMLElement, className: string, timeoutMs: number): void {
    let timers = this.transientTimers.get(el);
    if (!timers) {
      timers = new Map();
      this.transientTimers.set(el, timers);
    }
    const existing = timers.get(className);
    if (existing) window.clearTimeout(existing);
    el.addClass(className);
    const timer = window.setTimeout(() => {
      el.removeClass(className);
      timers?.delete(className);
    }, timeoutMs);
    timers.set(className, timer);
  }

  private clearTransientClass(el: HTMLElement, className: string): void {
    const timers = this.transientTimers.get(el);
    const existing = timers?.get(className);
    if (existing) window.clearTimeout(existing);
    timers?.delete(className);
    el.removeClass(className);
  }

  private clearCardDropTarget(card: HTMLElement): void {
    this.clearTransientClass(card, "is-drop-target");
    card.removeClass("is-drop-before", "is-drop-after");
  }

  private getCellValue(row: RowData, col: ColumnDef): unknown {
    if (col.key === "file.name") return getFileTitleDisplay(row, Array.from(this.rowByPath.values())).displayPath;
    if (isFileFieldKey(col.key)) return getRowFileFieldValue(row, col.key);
    if (col.type === "computed" || col.type === "rollup") {
      return row.computed[col.type === "computed" ? col.computedKey || col.key : col.key];
    }
    if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, row.frontmatter[col.key]);
    return row.frontmatter[col.key];
  }

  private getTitleField(config: ViewConfig): string | undefined {
    if (config.titleField === NO_TITLE_FIELD) return undefined;
    return config.titleField || "file.name";
  }

  private renderPreviewValue(item: HTMLElement, row: RowData, col: ColumnDef, value: unknown, empty = false, displayType: ColumnDef["type"] = col.type): void {
    const valueEl = item.createDiv({ cls: "db-board-card-value" });
    if (empty) valueEl.addClass("db-card-empty-placeholder");
    item.addEventListener("click", (event) => {
      if (this.actions.isReadOnly || isReadonlyFileField(col.key)) return;
      if (isHTMLElement(event.target) && event.target.closest("a, button, input, textarea, .db-cell-editing")) return;
      event.stopPropagation();
      this.actions.editCell(valueEl, row, col, event);
    });
    if (displayType === "checkbox") {
      valueEl.addClass("db-checkbox-cell");
      const cb = valueEl.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = toBooleanValue(value);
      if (col.type === "computed") {
        // 计算型 checkbox：点击打开公式编辑器
        cb.disabled = !!this.actions.isReadOnly;
        cb.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.actions.isReadOnly) this.actions.editFormula?.(col);
        };
      } else {
        cb.onclick = (event) => event.stopPropagation();
        cb.disabled = !!this.actions.isReadOnly;
        if (!this.actions.isReadOnly) {
          cb.onchange = () => {
            void this.actions.editCell(valueEl, row, col);
          };
        }
      }
      setFieldTooltip(valueEl, cb.checked ? t("common.true") : t("common.false"));
      return;
    }
    if (shouldRenderSpecialFileField(col) && renderSpecialFileFieldValue(valueEl, this.app, row, col, value, {
      tagsContainerClass: "db-board-card-badges",
      linkItemClass: "db-board-card-link",
    })) {
      valueEl.addClass("has-badges");
      return;
    }
    if (col.type === "select" || col.type === "status") {
      this.renderBadge(valueEl, col, String(value));
      return;
    }
    if (col.type === "multi-select") {
      const values = toMultiSelectValuesForKey(col.key, value);
      valueEl.addClass("has-badges");
      const wrap = valueEl.createDiv({ cls: "db-board-card-badges" });
      setFieldTooltip(wrap, values);
      for (const entry of values) this.renderBadge(wrap, col, entry);
      return;
    }
    if (col.type === "relation" && renderRelationValue(valueEl, this.app, row, value, true)) {
      valueEl.addClass("has-badges");
      return;
    }
    if (displayType === "date" || displayType === "datetime") {
      valueEl.addClass("db-date-value");
      valueEl.textContent = displayType === "datetime"
        ? formatDateTimeValueDisplay(value, { mode: "full", showTimeWhenMissing: true })
        : formatDateValueDisplay(value);
      setFieldTooltip(valueEl, valueEl.textContent);
      return;
    }

    const values = Array.isArray(value) ? value : [value];

    if (col.textRenderMode === "markdown" && !isFileFieldKey(col.key)) {
      const mdValues = Array.isArray(value) ? value : [value];
      const parsed = mdValues.map((entry) => parseInlineMarkdown(entry));
      if (parsed.some((nodes) => nodes !== null)) {
        valueEl.empty();
        const onOpenLink = (target: string, external: boolean): void => {
          void this.openTarget(row, target, external);
        };
        const onResolveImage = (target: string, external: boolean): string | null =>
          resolveInlineImageSrc(this.app, row, target, external);
        parsed.forEach((nodes, idx) => {
          if (idx > 0) valueEl.appendText(", ");
          if (nodes) {
            if (parsed.length === 1) renderInlineMarkdown(valueEl, nodes, { onOpenLink, onResolveImage });
            else renderInlineMarkdown(valueEl.createSpan(), nodes, { onOpenLink, onResolveImage });
          } else {
            valueEl.appendText(String(mdValues[idx]));
          }
        });
        setFieldTooltip(valueEl, valueToTooltip(value));
        return;
      }
    }

    if (col.textRenderMode === "link") {
      const links = values
        .map((entry) => parseTextLink(entry))
        .filter((entry): entry is ParsedLink => entry !== null);
      if (links.length > 0) {
        for (const link of links) this.renderLink(valueEl, row, link);
        return;
      }
    }

    if (displayType === "number") {
      const num = typeof value === "number" ? value : parseFloat(String(value));
      if (!isNaN(num)) {
        const style = getNumberDisplayStyle(col);
        if (style === "rating") { renderRating(valueEl, num, col.numberDisplayConfig); return; }
        if (style === "progress") { renderProgress(valueEl, num, col.numberDisplayConfig); return; }
        if (style === "ring") { renderProgressRing(valueEl, num, col.numberDisplayConfig); return; }
      }
    }
    valueEl.textContent = Array.isArray(value) ? value.join(", ") : String(value);
    setFieldTooltip(valueEl, valueEl.textContent);
  }

  renderCardFieldContent(row: RowData, col: ColumnDef, config: ViewConfig): HTMLElement {
    const value = this.getCellValue(row, col);
    const displayType = this.getDisplayType(config, col);
    const empty = this.isEmptyValue(value) && displayType !== "checkbox";
    const displayValue = empty ? this.getEmptyDisplayValue(col, displayType) : value;
    const item = window.activeDocument.createElement("div");
    item.className = "db-board-card-field";
    item.setAttribute("data-note-database-column-key", col.key);
    this.actions.applyConditionalFormat?.(item, row, config, col.key);
    item.style.setProperty("--db-card-field-width", `${this.getCardFieldWidth(config, col)}px`);
    setFieldTooltip(item, displayValue, col.label);
    if (empty) item.classList.add("is-empty-field");
    if (displayType === "checkbox") item.classList.add("is-checkbox-field");
    if (col.wrap) item.classList.add("db-board-card-field-wrap");
    const label = item.createSpan({ text: col.label });
    this.attachColumnContextMenu(item, col);
    this.attachColumnContextMenu(label, col);
    this.renderPreviewValue(item, row, col, displayValue, empty, displayType);
    return item;
  }

  private isEmptyValue(value: unknown): boolean {
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  }

  private shouldShowEmptyField(config: ViewConfig, col: ColumnDef): boolean {
    return config.showEmptyFields === true;
  }

  private getEmptyDisplayValue(col: ColumnDef, displayType: ColumnDef["type"] = col.type): unknown {
    if (displayType === "multi-select") return [t("common.empty")];
    if (displayType === "checkbox") return false;
    return t("common.empty");
  }

  private renderBadge(parent: HTMLElement, col: ColumnDef, value: string): void {
    const badge = parent.createSpan({ cls: "status-badge", text: value });
    badge.title = value;
    const option = getColumnOptions(col).find((item) => normalizeOptionValueForKey(col.key, item.value) === value);
    if (option) badge.addClass(`status-color-${option.color}`);
    else badge.addClass("status-color-gray");
  }

  private renderGroupTitle(
    parent: HTMLElement,
    config: ViewConfig,
    field: string,
    groupKey: string,
    className: string
  ): void {
    const label = formatGroupKeyDisplay(config, field, groupKey);
    const title = parent.createSpan({ cls: className });
    title.title = label;
    const column = config.schema.columns.find((candidate) => candidate.key === field);
    const option = column
      ? getColumnOptions(column).find((candidate) =>
        normalizeOptionValueForKey(column.key, candidate.value) ===
        normalizeOptionValueForKey(column.key, groupKey))
      : undefined;
    const displayType = column
      ? getColumnDisplayType(column, config.schema.computedFields)
      : undefined;
    const isOptionGroup = displayType === "status" || displayType === "select" || displayType === "multi-select";
    if (!isOptionGroup) {
      title.setText(label);
      return;
    }
    title.createSpan({
      cls: `status-badge status-color-${option?.color || "gray"}`,
      text: label,
    });
  }

  private startColumnResize(event: MouseEvent, board: HTMLElement, config: ViewConfig): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizeState = {
      startX: event.clientX,
      startWidth: this.getBoardColumnWidth(config),
      board,
    };
    window.activeDocument.addEventListener("mousemove", this.handleColumnResize);
    window.activeDocument.addEventListener("mouseup", this.finishColumnResize);
  }

  private readonly handleColumnResize = (event: MouseEvent): void => {
    if (!this.resizeState) return;
    const width = this.clampBoardColumnWidth(this.resizeState.startWidth + event.clientX - this.resizeState.startX);
    this.resizeState.board.style.setProperty("--db-board-column-width", `${width}px`);
  };

  private readonly finishColumnResize = (event: MouseEvent): void => {
    if (!this.resizeState) return;
    const width = this.clampBoardColumnWidth(this.resizeState.startWidth + event.clientX - this.resizeState.startX);
    window.activeDocument.removeEventListener("mousemove", this.handleColumnResize);
    window.activeDocument.removeEventListener("mouseup", this.finishColumnResize);
    this.resizeState = undefined;
    this.actions.updateColumnWidth(width);
  };

  private getBoardColumnWidth(config: ViewConfig): number {
    return this.clampBoardColumnWidth(config.boardColumnWidth || 280);
  }

  private getCardFieldWidth(config: ViewConfig, col: ColumnDef): number {
    return clampCardFieldWidth(getFieldWidth(config, col), this.getBoardColumnWidth(config));
  }

  private getDisplayType(config: ViewConfig, col: ColumnDef): ColumnDef["type"] {
    if (isFileFieldKey(col.key)) return getFileFieldFixedType(col.key);
    return getColumnDisplayType(col, config.schema.computedFields);
  }

  private clampBoardColumnWidth(width: number): number {
    return Math.max(220, Math.min(520, Math.round(width)));
  }

  private renderLink(parent: HTMLElement, row: RowData, link: ParsedLink): void {
    const anchor = parent.createEl("a", { cls: "db-board-card-link", text: link.label, attr: { title: link.label } });
    anchor.href = link.external ? link.target : "#";
    anchor.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openTarget(row, link.target, link.external);
    };
  }

  private async openTarget(row: RowData, target: string, external: boolean): Promise<void> {
    if (external) {
      window.open(target);
      return;
    }
    await this.app.workspace.openLinkText(target, row.file.path);
  }

  // 实时收集看板列/子分组候选 rect 与 zone 映射，供容器兜底 drop 与拖拽列命中（方案 B）共用。
  // getBoundingClientRect 实时取，列宽/滚动/折叠变化都能正确命中。
  private collectBoardDropTargets(): {
    candidates: BoardDropCandidate[];
    zones: Map<string, { group: BoardGroup; subgroup?: BoardSubgroup; cardsEl: HTMLElement }>;
  } {
    const candidates: BoardDropCandidate[] = [];
    const zones = new Map<string, { group: BoardGroup; subgroup?: BoardSubgroup; cardsEl: HTMLElement }>();
    const board = this.boardEl;
    if (!board) return { candidates, zones };
    const groups = this.boardGroups;
    const subgroupField = this.boardSubgroupField;
    const columnEls = Array.from(board.querySelectorAll<HTMLElement>(":scope > .db-board-column"));
    columnEls.forEach((colEl, i) => {
      const group = groups[i];
      if (!group) return;
      if (subgroupField && group.subgroups?.length) {
        const subEls = Array.from(colEl.querySelectorAll<HTMLElement>(":scope > .db-board-subgroups > .db-board-subgroup"));
        subEls.forEach((subEl, j) => {
          const subgroup = group.subgroups?.[j];
          if (!subgroup) return;
          const cardsEl = subEl.querySelector<HTMLElement>(":scope > .db-board-cards");
          if (!cardsEl) return;
          const r = subEl.getBoundingClientRect();
          const key = `${group.key}::${subgroup.key}`;
          candidates.push({ key, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
          zones.set(key, { group, subgroup, cardsEl });
        });
      } else {
        const cardsEl = colEl.querySelector<HTMLElement>(":scope > .db-board-cards");
        if (!cardsEl) return;
        const r = colEl.getBoundingClientRect();
        candidates.push({ key: group.key, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
        zones.set(group.key, { group, cardsEl });
      }
    });
    return { candidates, zones };
  }

  // 看板容器空白（列下方/上方 board 区域）的兜底拖拽落点。两列间水平 gap 不处理。
  private attachBoardContainerDropHandlers(board: HTMLElement, groupField: string): void {
    if (this.actions.isReadOnly) return;
    const subgroupField = this.boardSubgroupField;

    // 候选与 zone 收集已提取为 this.collectBoardDropTargets()，供此处与拖拽列命中（方案 B）共用。

    board.addEventListener("dragover", (event) => {
      if (this.actions.isReadOnly) return;
      if (!this.isCardDrag(event)) {
        this.detachBoardDropHighlight();
        return;
      }
      const target = event.target;
      // 冒泡隔离：target 已在列内 → 交给列/cards/card handler，清除 board 兜底反馈。
      if (isHTMLElement(target) && target.closest(".db-board-column")) {
        this.detachBoardDropHighlight();
        return;
      }
      const { candidates, zones } = this.collectBoardDropTargets();
      const key = resolveBoardColumnByPoint(candidates, event.clientX, event.clientY);
      const zone = key ? zones.get(key) : undefined;
      if (!zone) {
        // 两列间 gap 或无候选：不 preventDefault（gap 不可 drop），清除反馈。
        this.detachBoardDropHighlight();
        return;
      }
      event.preventDefault();
      this.showBoardDropHighlight(zone);
    });

    board.addEventListener("dragleave", () => this.detachBoardDropHighlight());

    board.addEventListener("drop", (event) => {
      if (this.actions.isReadOnly) return;
      const path = event.dataTransfer?.getData(CARD_MIME) || event.dataTransfer?.getData("text/plain");
      const row = path ? this.rowByPath.get(path) : undefined;
      if (!row) {
        this.detachBoardDropHighlight();
        return;
      }
      const { candidates, zones } = this.collectBoardDropTargets();
      const key = resolveBoardColumnByPoint(candidates, event.clientX, event.clientY);
      const zone = key ? zones.get(key) : undefined;
      if (!zone) {
        this.detachBoardDropHighlight();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.detachBoardDropHighlight();
      const fromGroup = event.dataTransfer?.getData(CARD_FROM_GROUP_MIME) || undefined;
      const fromSubgroup = event.dataTransfer?.getData(CARD_FROM_SUBGROUP_MIME) || undefined;
      // 拖到列下方空白：同分组保持原位，跨分组追加到目标分组末尾。
      const drop = resolveBoardContainerDropOrder({
        rows: zone.subgroup?.rows ?? zone.group.rows,
        draggedPath: row.file.path,
        fromGroup,
        groupKey: zone.group.key,
        fromSubgroup,
        subgroupKey: zone.subgroup?.key,
      });
      if (drop.keepInPlace) return;
      void this.moveCardAndOrder(
        row,
        groupField,
        zone.group.key,
        fromGroup,
        row.file.path,
        drop.order,
        subgroupField,
        zone.subgroup?.key,
        fromSubgroup
      );
    });
  }

  // 显示目标列整列高亮 + cards 末尾 preview 占位。zone 变化才切换 DOM，避免高频抖动；
  // 持续拖动刷新兜底淡出 timer，停顿 900ms 自动清除。
  private showBoardDropHighlight(zone: { cardsEl: HTMLElement }): void {
    const highlightEl = zone.cardsEl.closest<HTMLElement>(".db-board-subgroup")
      || zone.cardsEl.closest<HTMLElement>(".db-board-column");
    // 同一 zone：仅刷新淡出 timer，不动 DOM。
    if (this.currentBoardDropZone === highlightEl) {
      this.refreshBoardDropFadeTimer();
      return;
    }
    this.detachBoardDropHighlight();
    if (highlightEl) highlightEl.addClass("is-drop-target");
    this.currentBoardDropZone = highlightEl;
    this.refreshBoardDropFadeTimer();
  }

  private refreshBoardDropFadeTimer(): void {
    if (this.boardDropFadeTimer != null) window.clearTimeout(this.boardDropFadeTimer);
    this.boardDropFadeTimer = window.setTimeout(() => this.detachBoardDropHighlight(), 900);
  }

  private detachBoardDropHighlight(): void {
    if (this.boardDropFadeTimer != null) {
      window.clearTimeout(this.boardDropFadeTimer);
      this.boardDropFadeTimer = null;
    }
    this.currentBoardDropZone?.removeClass("is-drop-target");
    this.currentBoardDropZone = null;
  }

  // 方案 B：拖拽开始时构建列名映射并创建跟随鼠标的浮动 preview。preview 与 dragover 监听
  // 全部走 window.activeDocument 以兼容 popout window；preview 是 renderer 级单例。
  private beginBoardDragPreview(config: ViewConfig): void {
    // 兜底：若上一次拖拽异常残留（如 re-render 中途未触发 dragend），先清理。
    this.endBoardDragPreview();
    // 列名映射：key（group.key 或 group::subgroup）→ 该列显示名；子分组也映射到所属列名。
    const labels = new Map<string, string>();
    for (const group of this.boardGroups) {
      const label = formatGroupKeyDisplay(config, this.boardGroupField, group.key);
      labels.set(group.key, label);
      if (group.subgroups?.length) {
        for (const subgroup of group.subgroups) {
          labels.set(`${group.key}::${subgroup.key}`, label);
        }
      }
    }
    this.boardDragLabelByKey = labels;
    // 挂 activeDocument.body（body 级、position:fixed），初始隐藏避免空标签闪烁。
    this.boardDragPreview = window.activeDocument.body.createDiv({ cls: "db-board-drag-group-preview is-hidden" });
    this.boundBoardDragOver = (event) => this.onBoardCardDragOver(event);
    window.activeDocument.addEventListener("dragover", this.boundBoardDragOver);
  }

  // 方案 B 热路径：实时命中当前列，更新 preview 文本与位置；未命中（gap / 光标不在本 board /
  // 同页其它数据库拖拽）隐藏，避免多实例 preview 同时显示串扰。始终显示当前命中列名（含同组）。
  private onBoardCardDragOver(event: DragEvent): void {
    const preview = this.boardDragPreview;
    if (!preview) return;
    const { candidates } = this.collectBoardDropTargets();
    const key = resolveBoardColumnByPoint(candidates, event.clientX, event.clientY);
    const label = key ? this.boardDragLabelByKey.get(key) : undefined;
    if (!label) {
      preview.addClass("is-hidden");
      return;
    }
    preview.removeClass("is-hidden");
    preview.setText(label);
    // 跟随鼠标并偏移避开浏览器原生 drag ghost，夹取到视口内避免越界裁切。
    const offset = 16;
    const doc = window.activeDocument.documentElement;
    const maxX = doc.clientWidth - preview.offsetWidth - 8;
    const maxY = doc.clientHeight - preview.offsetHeight - 8;
    preview.setCssProps({
      left: `${Math.min(event.clientX + offset, Math.max(maxX, 0))}px`,
      top: `${Math.min(event.clientY + offset, Math.max(maxY, 0))}px`,
    });
  }

  // 方案 B：拖拽结束（dragend）或 render 幂等兜底时移除 preview 与 dragover 监听，防泄漏。
  private endBoardDragPreview(): void {
    if (this.boundBoardDragOver) {
      window.activeDocument.removeEventListener("dragover", this.boundBoardDragOver);
      this.boundBoardDragOver = undefined;
    }
    this.boardDragPreview?.remove();
    this.boardDragPreview = null;
    this.boardDragLabelByKey = new Map();
  }

  private clear(container: HTMLElement): void {
    container.querySelectorAll(".db-board").forEach((el) => el.remove());
    this.detachBoardDropHighlight();
  }
}
