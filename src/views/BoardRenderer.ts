import { App, Menu, setIcon, TFile } from "obsidian";
import { getColumnOptions, toBooleanValue, toMultiSelectValues } from "../data/ColumnTypes";
import { ColumnDef, NO_TITLE_FIELD, RowData, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { setFieldTooltip } from "./FieldTooltip";

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
  createEntry(defaults?: Record<string, unknown>): void;
  updateGroup(row: RowData, field: string, value: string, fromValue?: string): Promise<void>;
  updateGroupOrder(field: string, order: string[]): void;
  updateCardOrder(field: string, groupKey: string, paths: string[]): void;
  updateColumnWidth(width: number): void;
  isRowSelected(row: RowData): boolean;
  toggleRowSelected(row: RowData, selected: boolean, event?: MouseEvent): void;
  areAllRowsSelected(rows: RowData[]): boolean;
  toggleRowsSelected(rows: RowData[], selected: boolean): void;
  editCell(target: HTMLElement, row: RowData, col: ColumnDef, event?: MouseEvent): void;
  getColumns(config: ViewConfig): ColumnDef[];
  isGroupCollapsed?(field: string, key: string): boolean;
  toggleGroupCollapsed?(field: string, key: string): void;
  showRowMenu?(event: MouseEvent, row: RowData): void;
  showColumnMenu?(event: MouseEvent, col: ColumnDef, anchorEl?: HTMLElement): void;
  readonly isReadOnly?: boolean;
  readonly canReorderGroups?: boolean;
}

interface ParsedLink {
  label: string;
  target: string;
  external: boolean;
}

interface ParsedImage {
  alt: string;
  label: string;
  target: string;
  src: string;
  external: boolean;
}

export class BoardRenderer {
  private rowByPath = new Map<string, RowData>();
  private transientTimers = new WeakMap<HTMLElement, Map<string, number>>();
  private dragEnterCount = new WeakMap<HTMLElement, number>();
  private resizeState?: { startX: number; startWidth: number; board: HTMLElement };
  private draggingCardPath?: string;

  constructor(private app: App, private actions: BoardRendererActions) {}

  render(container: HTMLElement, config: ViewConfig, groups: BoardGroup[], groupField: string): void {
    this.clear(container);
    this.rowByPath = new Map(groups.flatMap((group) => group.rows.map((row) => [row.file.path, row] as const)));
    const board = container.createDiv({ cls: "db-board" });
    board.style.setProperty("--db-board-column-width", `${this.getBoardColumnWidth(config)}px`);
    for (const group of groups) {
      this.renderColumn(board, config, groups, group, groupField);
    }
    if (!this.actions.isReadOnly) {
      const addColumn = board.createDiv({ cls: "db-board-add-column" });
      addColumn.createEl("button", { text: `+ ${t("toolbar.new")}` }).onclick = () => this.actions.createEntry();
    }
  }

  private renderColumn(
    board: HTMLElement,
    config: ViewConfig,
    groups: BoardGroup[],
    group: BoardGroup,
    groupField: string
  ): void {
    const column = board.createDiv({ cls: "db-board-column" });
    const subgroupField = config.boardSubgroupField && config.boardSubgroupField !== groupField
      ? config.boardSubgroupField
      : undefined;
    column.addEventListener("dragover", (event) => {
      if (this.isGroupDrag(event)) {
        if (!this.canReorderGroups()) return;
      } else if (this.isCardDrag(event)) {
        if (this.actions.isReadOnly || !this.canReorderCards(config) || subgroupField) return;
      } else {
        return;
      }
      event.preventDefault();
      this.addTransientClass(column, "is-drop-target", 900);
    });
    column.addEventListener("dragleave", () => this.clearTransientClass(column, "is-drop-target"));
    column.addEventListener("drop", (event) => {
      event.preventDefault();
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
      if (row) void this.actions.updateGroup(row, groupField, group.key, fromGroup);
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
    header.createSpan({ cls: "db-board-column-title", text: group.key || t("common.uncategorized") });
    header.createSpan({ cls: "db-board-count", text: String(group.count) });
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
    for (const row of group.rows) {
      this.renderCard(cards, config, groups, group, row, groupField);
    }
    if (!this.actions.isReadOnly) {
      cards.createEl("button", { cls: "db-board-new-card", text: `+ ${t("toolbar.new")}` }).onclick =
        () => this.actions.createEntry({ [groupField]: group.key || "" });
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
    header.createSpan({ cls: "db-board-subgroup-title", text: subgroup.key || t("common.uncategorized") });
    header.createSpan({ cls: "db-board-subgroup-count", text: String(subgroup.count) });
    if (collapsed) return;

    const cards = this.createCardsContainer(section, config, group, groupField, subgroupField, subgroup);
    for (const row of subgroup.rows) {
      this.renderCard(cards, config, groups, group, row, groupField, subgroupField, subgroup.key);
    }
    if (!this.actions.isReadOnly) {
      cards.createEl("button", { cls: "db-board-new-card", text: `+ ${t("toolbar.new")}` }).onclick =
        () => this.actions.createEntry({ [groupField]: group.key || "", [subgroupField]: subgroup.key || "" });
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
      if (!this.canReorderCards(config)) return;
      if (!this.isCardDrag(event)) return;
      event.preventDefault();
      this.highlightCardDropZone(cards);
    });
    cards.addEventListener("drop", (event) => {
      if (this.actions.isReadOnly) return;
      if (!this.canReorderCards(config)) return;
      const path = event.dataTransfer?.getData(CARD_MIME);
      if (!path) return;
      const row = this.rowByPath.get(path);
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      this.clearCardDropZone(cards);
      const fromGroup = event.dataTransfer?.getData(CARD_FROM_GROUP_MIME) || undefined;
      const fromSubgroup = event.dataTransfer?.getData(CARD_FROM_SUBGROUP_MIME) || undefined;
      void this.moveCardAndOrder(row, groupField, group.key, fromGroup, path, this.getContainerDropOrder(group, path, subgroupField, subgroup), subgroupField, subgroup?.key, fromSubgroup);
    });
    return cards;
  }

  private renderCard(
    cards: HTMLElement,
    config: ViewConfig,
    groups: BoardGroup[],
    group: BoardGroup,
    row: RowData,
    groupField: string,
    subgroupField?: string,
    subgroupKey?: string
  ): void {
    const card = cards.createDiv({
      cls: "db-board-card",
      attr: { "data-note-database-row-path": row.file.path },
    });
    this.attachRowContextMenu(card, row);
    if (!this.actions.isReadOnly && !this.isPhoneLayout()) {
      card.draggable = true;
      card.addEventListener("dragstart", (event) => {
        if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, button")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData(CARD_MIME, row.file.path);
        event.dataTransfer?.setData("text/plain", row.file.path);
        event.dataTransfer?.setData(CARD_FROM_GROUP_MIME, group.key);
        if (subgroupKey != null) event.dataTransfer?.setData(CARD_FROM_SUBGROUP_MIME, subgroupKey);
        this.draggingCardPath = row.file.path;
        this.addTransientClass(card, "is-dragging", 2400);
      });
      card.addEventListener("dragover", (event) => {
        if (!this.canReorderCards(config)) return;
        if (!this.isCardDrag(event)) return;
        const path = this.draggingCardPath || event.dataTransfer?.getData(CARD_MIME);
        if (!path || path === row.file.path || !this.rowByPath.has(path)) return;
        event.preventDefault();
        const rect = card.getBoundingClientRect();
        card.toggleClass("is-drop-before", event.clientY <= rect.top + rect.height / 2);
        card.toggleClass("is-drop-after", event.clientY > rect.top + rect.height / 2);
        this.addTransientClass(card, "is-drop-target", 900);
        this.highlightCardDropZone(card);
      });
      card.addEventListener("dragenter", (event) => {
        if (!this.canReorderCards(config)) return;
        if (!event.dataTransfer?.types.includes(CARD_MIME)) return;
        const count = (this.dragEnterCount.get(card) || 0) + 1;
        this.dragEnterCount.set(card, count);
      });
      card.addEventListener("dragleave", () => {
        if (!this.canReorderCards(config)) return;
        const count = (this.dragEnterCount.get(card) || 1) - 1;
        this.dragEnterCount.set(card, count);
        setTimeout(() => {
          if ((this.dragEnterCount.get(card) || 0) <= 0) {
            this.clearCardDropTarget(card);
          }
        }, 0);
      });
      card.addEventListener("drop", (event) => {
        if (!this.canReorderCards(config)) return;
        const path = event.dataTransfer?.getData(CARD_MIME);
        const dragged = path ? this.rowByPath.get(path) : undefined;
        if (!path || !dragged) return;
        if (path === row.file.path) return;
        event.preventDefault();
        event.stopPropagation();
        this.clearCardDropTarget(card);
        const fromGroup = event.dataTransfer?.getData(CARD_FROM_GROUP_MIME) || undefined;
        const fromSubgroup = event.dataTransfer?.getData(CARD_FROM_SUBGROUP_MIME) || undefined;
        void this.moveCardAndOrder(dragged, groupField, group.key, fromGroup, path, this.getCardDropOrder(group, path, row.file.path, event, card), subgroupField, subgroupKey, fromSubgroup);
      });
      card.addEventListener("dragend", () => {
        this.clearTransientClass(card, "is-dragging");
        this.clearCardDropTarget(card);
        this.draggingCardPath = undefined;
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
    if (!this.actions.isReadOnly && this.isPhoneLayout()) {
      this.renderMobileMoveButton(card, config, groups, group, row, groupField, subgroupField, subgroupKey);
    }
    const openBtn = controls.createEl("button", {
      cls: "db-board-card-open",
      attr: { "aria-label": t("menu.openNote"), title: t("menu.openNote") },
    });
    setIcon(openBtn, "maximize-2");
    openBtn.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.openRow(row);
    };
    const columns = this.actions.getColumns(config);
    const titleField = this.getTitleField(config, columns);
    const title = titleField ? this.getTitleText(config, row, titleField) : "";
    if (title) {
      card.createDiv({ cls: "db-board-card-title", text: title, attr: { title } });
    }
    const meta = card.createDiv({ cls: "db-board-card-meta" });
    const fields = columns.filter((col) => col.key !== titleField);
    for (const col of fields) {
      const value = this.getCellValue(row, col);
      const empty = this.isEmptyValue(value);
      if (empty && !this.shouldShowEmptyField(config, col)) continue;
      const displayValue = empty ? this.getEmptyDisplayValue(col) : value;
      const item = meta.createDiv({ cls: "db-board-card-field" });
      item.style.setProperty("--db-card-field-width", `${col.width || config.defaultColumnWidth || 150}px`);
      setFieldTooltip(item, displayValue, col.label);
      if (empty) item.addClass("is-empty-field");
      if (col.wrap) item.addClass("db-board-card-field-wrap");
      const label = item.createSpan({ text: col.label });
      this.attachColumnContextMenu(item, col);
      this.attachColumnContextMenu(label, col);
      this.renderPreviewValue(item, row, col, displayValue, empty);
    }
  }

  private attachRowContextMenu(el: HTMLElement, row: RowData): void {
    el.addEventListener("contextmenu", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, button")) return;
      this.actions.showRowMenu?.(event, row);
    });
  }

  private attachColumnContextMenu(el: HTMLElement, col: ColumnDef): void {
    el.addEventListener("contextmenu", (event) => {
      if (!this.actions.showColumnMenu) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, button, a")) return;
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
    if (!this.canReorderCards(config) && !subgroupField) return;
    const button = card.createEl("button", {
      cls: "db-card-mobile-move-btn",
      attr: { type: "button", title: t("mobile.moveCard"), "aria-label": t("mobile.moveCard") },
    });
    setIcon(button, "move");
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
      const label = subgroupField
        ? `${target.group.key || t("common.uncategorized")} / ${target.subgroupKey || t("common.uncategorized")}`
        : target.group.key || t("common.uncategorized");
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
    const order = group.rows.map((candidate) => candidate.file.path).filter((path) => path !== draggedPath);
    if (subgroupField && subgroupKey != null && !targetPath) {
      const subgroupPaths = new Set((group.subgroups?.find((subgroup) => subgroup.key === subgroupKey)?.rows || [])
        .map((candidate) => candidate.file.path)
        .filter((path) => path !== draggedPath));
      const subgroupIndexes = order
        .map((path, index) => subgroupPaths.has(path) ? index : -1)
        .filter((index) => index >= 0);
      const insertIndex = placement === "top"
        ? (subgroupIndexes[0] ?? order.length)
        : ((subgroupIndexes[subgroupIndexes.length - 1] ?? (order.length - 1)) + 1);
      order.splice(insertIndex, 0, draggedPath);
      return order;
    }
    if (placement === "top") return [draggedPath, ...order];
    if (placement === "bottom" || !targetPath) return [...order, draggedPath];
    const targetIndex = order.indexOf(targetPath);
    if (targetIndex < 0) return [...order, draggedPath];
    order.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggedPath);
    return order;
  }

  private getMobileRowLabel(config: ViewConfig, row: RowData): string {
    const columns = this.actions.getColumns(config);
    const titleField = this.getTitleField(config, columns);
    const value = titleField ? this.getTitleText(config, row, titleField) : "";
    return value || row.file.name.replace(/\.md$/, "");
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
    group: BoardGroup,
    draggedPath: string,
    targetPath: string,
    event: DragEvent,
    card: HTMLElement
  ): string[] {
    const order = group.rows.map((row) => row.file.path).filter((path) => path !== draggedPath);
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
    if (fromGroup && fromGroup !== groupKey) await this.actions.updateGroup(row, groupField, groupKey, fromGroup);
    if (subgroupField && subgroupKey != null && fromSubgroup && fromSubgroup !== subgroupKey) {
      await this.actions.updateGroup(row, subgroupField, subgroupKey, fromSubgroup);
    }
    if (!order.includes(draggedPath)) order = [...order, draggedPath];
    this.updateCardOrder(groupField, groupKey, order);
  }

  private getContainerDropOrder(
    group: BoardGroup,
    draggedPath: string,
    subgroupField?: string,
    subgroup?: BoardSubgroup
  ): string[] {
    const paths = group.rows.map((row) => row.file.path).filter((path) => path !== draggedPath);
    if (!subgroupField || !subgroup) return [...paths, draggedPath];
    const subgroupPathSet = new Set(subgroup.rows.map((row) => row.file.path));
    let insertIndex = paths.length;
    for (let index = paths.length - 1; index >= 0; index--) {
      if (subgroupPathSet.has(paths[index])) {
        insertIndex = index + 1;
        break;
      }
    }
    paths.splice(insertIndex, 0, draggedPath);
    return paths;
  }

  private updateCardOrder(groupField: string, groupKey: string, paths: string[]): void {
    this.actions.updateCardOrder(groupField, groupKey, paths);
  }

  private canReorderCards(config: ViewConfig): boolean {
    return !(config.sortColumn || (config.sortRules && config.sortRules.length > 0));
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
    return document.body.classList.contains("is-phone");
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
    if (col.key === "file.name") return row.file.name.replace(/\.md$/, "");
    if (col.type === "computed") return row.computed[col.computedKey || col.key];
    return row.frontmatter[col.key];
  }

  private getTitleField(config: ViewConfig, visibleColumns: ColumnDef[]): string | undefined {
    if (config.titleField === NO_TITLE_FIELD) return undefined;
    if (config.titleField) return config.titleField;
    return visibleColumns.some((col) => col.key === "file.name") ? "file.name" : undefined;
  }

  private getTitleText(config: ViewConfig, row: RowData, field: string): string {
    const col = config.schema.columns.find((candidate) => candidate.key === field);
    if (!col) return "";
    const value = this.getCellValue(row, col);
    if (value == null) return "";
    return Array.isArray(value) ? value.join(", ") : String(value);
  }

  private renderPreviewValue(item: HTMLElement, row: RowData, col: ColumnDef, value: unknown, empty = false): void {
    const valueEl = item.createDiv({ cls: "db-board-card-value" });
    if (empty) valueEl.addClass("db-card-empty-placeholder");
    item.addEventListener("click", (event) => {
      if (this.actions.isReadOnly) return;
      if (event.target instanceof HTMLElement && event.target.closest("a, button, input, textarea, .db-cell-editing")) return;
      event.stopPropagation();
      this.actions.editCell(valueEl, row, col, event);
    });
    if (col.type === "checkbox") {
      valueEl.textContent = toBooleanValue(value) ? t("common.true") : t("common.false");
      setFieldTooltip(valueEl, valueEl.textContent);
      return;
    }
    if (col.type === "select" || col.type === "status") {
      this.renderBadge(valueEl, col, String(value));
      return;
    }
    if (col.type === "multi-select") {
      const values = toMultiSelectValues(value);
      valueEl.addClass("has-badges");
      const wrap = valueEl.createDiv({ cls: "db-board-card-badges" });
      setFieldTooltip(wrap, values);
      for (const entry of values) this.renderBadge(wrap, col, entry);
      return;
    }

    const values = Array.isArray(value) ? value : [value];
    const images = values
      .map((entry) => this.parseImage(entry, row))
      .filter((entry): entry is ParsedImage => entry !== null);
    if (images.length > 0) {
      item.addClass("is-image-field");
      const gallery = valueEl.createDiv({ cls: "db-board-card-images" });
      for (const image of images.slice(0, 3)) this.renderImage(gallery, row, image);
      if (images.length > 3) gallery.createSpan({ cls: "db-board-card-more", text: `+${images.length - 3}` });
      return;
    }

    const links = values
      .map((entry) => this.parseLink(entry))
      .filter((entry): entry is ParsedLink => entry !== null);
    if (links.length > 0) {
      for (const link of links) this.renderLink(valueEl, row, link);
      return;
    }

    valueEl.textContent = Array.isArray(value) ? value.join(", ") : String(value);
    setFieldTooltip(valueEl, valueEl.textContent);
  }

  private isEmptyValue(value: unknown): boolean {
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  }

  private shouldShowEmptyField(config: ViewConfig, col: ColumnDef): boolean {
    return config.showEmptyFields === true;
  }

  private getEmptyDisplayValue(col: ColumnDef): unknown {
    if (col.type === "multi-select") return [t("common.empty")];
    if (col.type === "checkbox") return false;
    return t("common.empty");
  }

  private renderBadge(parent: HTMLElement, col: ColumnDef, value: string): void {
    const badge = parent.createSpan({ cls: "status-badge", text: value });
    badge.title = value;
    const option = getColumnOptions(col).find((item) => item.value === value);
    if (option) badge.addClass(`status-color-${option.color}`);
    else badge.addClass("status-color-gray");
  }

  private renderImage(parent: HTMLElement, row: RowData, image: ParsedImage): void {
    const button = parent.createEl("button", { cls: "db-board-card-image-button", attr: { title: image.label } });
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openTarget(row, image.target, image.external);
    };
    button.createEl("img", { attr: { src: image.src, alt: image.alt } });
  }

  private startColumnResize(event: MouseEvent, board: HTMLElement, config: ViewConfig): void {
    event.preventDefault();
    event.stopPropagation();
    this.resizeState = {
      startX: event.clientX,
      startWidth: this.getBoardColumnWidth(config),
      board,
    };
    document.addEventListener("mousemove", this.handleColumnResize);
    document.addEventListener("mouseup", this.finishColumnResize);
  }

  private readonly handleColumnResize = (event: MouseEvent): void => {
    if (!this.resizeState) return;
    const width = this.clampBoardColumnWidth(this.resizeState.startWidth + event.clientX - this.resizeState.startX);
    this.resizeState.board.style.setProperty("--db-board-column-width", `${width}px`);
  };

  private readonly finishColumnResize = (event: MouseEvent): void => {
    if (!this.resizeState) return;
    const width = this.clampBoardColumnWidth(this.resizeState.startWidth + event.clientX - this.resizeState.startX);
    document.removeEventListener("mousemove", this.handleColumnResize);
    document.removeEventListener("mouseup", this.finishColumnResize);
    this.resizeState = undefined;
    this.actions.updateColumnWidth(width);
  };

  private getBoardColumnWidth(config: ViewConfig): number {
    return this.clampBoardColumnWidth(config.boardColumnWidth || 280);
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

  private parseImage(value: unknown, row: RowData): ParsedImage | null {
    if (typeof value !== "string") return null;
    const link = this.parseLink(value);
    const target = link?.target || value.trim();
    if (!this.isImageTarget(target)) return null;
    const src = link?.external ? target : this.resolveImageSrc(target, row);
    if (!src) return null;
    return {
      alt: link?.label || target,
      label: link?.label || target,
      target,
      src,
      external: link?.external || this.isExternalUrl(target),
    };
  }

  private parseLink(value: unknown): ParsedLink | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text) return null;

    const markdownImage = text.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (markdownImage) return this.toParsedLink(markdownImage[2], markdownImage[1] || markdownImage[2]);

    const markdownLink = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (markdownLink) return this.toParsedLink(markdownLink[2], markdownLink[1]);

    const wikiImage = text.match(/^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (wikiImage) return this.toParsedLink(wikiImage[1], wikiImage[2] || wikiImage[1]);

    const wikiLink = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
    if (wikiLink) return this.toParsedLink(wikiLink[1], wikiLink[2] || wikiLink[1]);

    if (this.isExternalUrl(text)) return this.toParsedLink(text, text);
    if (this.isLikelyLocalTarget(text)) return this.toParsedLink(text, text);
    return null;
  }

  private toParsedLink(target: string, label: string): ParsedLink {
    const cleanTarget = target.trim();
    return {
      label: label.trim() || cleanTarget,
      target: cleanTarget,
      external: this.isExternalUrl(cleanTarget),
    };
  }

  private resolveImageSrc(target: string, row: RowData): string | null {
    const file = this.app.metadataCache.getFirstLinkpathDest(target, row.file.path);
    if (file instanceof TFile) return this.app.vault.getResourcePath(file);
    return this.isExternalUrl(target) ? target : null;
  }

  private async openTarget(row: RowData, target: string, external: boolean): Promise<void> {
    if (external) {
      window.open(target);
      return;
    }
    await this.app.workspace.openLinkText(target, row.file.path);
  }

  private isImageTarget(target: string): boolean {
    return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#].*)?$/i.test(target);
  }

  private isExternalUrl(target: string): boolean {
    return /^https?:\/\//i.test(target);
  }

  private isLikelyLocalTarget(target: string): boolean {
    return target.endsWith(".md") || target.includes("/") || this.isImageTarget(target);
  }

  private clear(container: HTMLElement): void {
    container.querySelectorAll(".db-board").forEach((el) => el.remove());
  }
}
