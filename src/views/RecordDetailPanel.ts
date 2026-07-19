import { App, setIcon, setTooltip } from "obsidian";
import { getColumnOptions, isObsidianTagsKey, normalizeOptionValueForKey, toBooleanValue, toMultiSelectValuesForKey } from "../data/ColumnTypes";
import { getColumnDisplayType, getNumberDisplayStyle } from "../data/ColumnDisplay";
import { formatDateValueDisplay, formatDateTimeValueDisplay } from "../data/DateTimeFormat";
import { getFileFieldFixedType, getRowFileFieldValue, isFileFieldKey, isReadonlyFileField } from "../data/FileFields";
import { isImeComposing } from "../data/KeyboardUtils";
import { safeString } from "../data/SafeString";
import { parseTextLink } from "../data/TextLink";
import { ColumnDef, RowData, ViewConfig } from "../data/types";
import { resolveTitleFieldDisplay } from "../data/TitleFieldDisplay";
import { t } from "../i18n";
import { isElement, isHTMLElement } from "./DomGuards";
import { setFieldTooltip } from "./FieldTooltip";
import { renderSpecialFileFieldValue, shouldRenderSpecialFileField } from "./FileFieldRenderer";
import { renderProgress, renderProgressRing, renderRating } from "./NumberDisplayRenderer";
import { renderRelationValue } from "./RelationValueRenderer";
import { getFieldWidth } from "./ColumnWidth";
import { parseInlineMarkdown } from "../data/InlineMarkdown";
import { renderInlineMarkdown, resolveInlineImageSrc, valueToTooltip } from "./InlineMarkdownRenderer";
import { positionToolbarPopover } from "./PopoverPosition";

/**
 * 日历 / 时间线事件卡片「展开为可编辑浮动面板」。
 *
 * 点击事件卡片时，在卡片附近浮出一个记录详情面板：列出该记录的全部可见列，
 * 每个字段点击进入内联编辑（与看板卡片点击字段编辑同款体验，复用 CellRenderer.startEdit）。
 * 面板底部提供「打开笔记」按钮；原打开文件入口保留在右键菜单与面板按钮。
 *
 * 设计要点：
 * - 定位复用 positionToolbarPopover（视口夹取 / 翻转 / 容器内随滚动）。
 * - 关闭采用轻量模式（仿 CellRenderer.editOptionPopover）：延后注册的 outside-mousedown +
 *   Esc + 容器滚动/视口 resize 即关。不用 installPopoverAutoClose（其为「空闲超时关」语义）。
 * - 面板挂在 .note-database-container 内且不加 transform/filter，确保字段编辑时子气泡
 *   （db-cell-option-popover 等）相对同一容器 absolute 定位正确。
 * - z-index 999：低于子编辑气泡（1000–1002），子气泡浮在面板之上。
 */

export interface RecordDetailActions {
  editCell: (target: HTMLElement, row: RowData, col: ColumnDef, event?: MouseEvent) => void;
  editFileName?: (target: HTMLElement, row: RowData, currentName: string) => void;
  showColumnMenu?: (event: MouseEvent, col: ColumnDef, anchorEl: HTMLElement) => void;
  openRow: (row: RowData) => void;
  renderRecordIcon?(parent: HTMLElement, row: RowData, config: ViewConfig, compact?: boolean): HTMLElement | null;
  applyConditionalFormat?(element: HTMLElement, row: RowData, config: ViewConfig, targetField?: string): void;
  isReadOnly?: boolean;
}

export interface OpenRecordDetailOptions {
  /** 被点击的事件卡片，作为定位锚点。 */
  anchorEl: HTMLElement;
  /** 面板挂载宿主（传容器的 note-database-container 元素）。 */
  host: HTMLElement;
  row: RowData;
  /** 调用方算好的可见列。 */
  columns: ColumnDef[];
  config: ViewConfig;
  app: App;
  actions: RecordDetailActions;
}

interface ActivePanel {
  filePath: string;
  close: () => void;
  refreshFields: (row: RowData) => void;
}

let currentPanel: ActivePanel | null = null;

const RECORD_DETAIL_CHILD_POPOVER_SELECTOR = [
  ".db-cell-edit-popover",
  ".db-cell-option-popover",
  ".db-cell-date-popover",
  ".db-color-picker-popup",
  ".db-dropdown-popover",
  ".db-icon-picker-popover",
].join(", ");

function isRecordDetailChildPopoverTarget(target: EventTarget | null): boolean {
  return isElement(target) && Boolean(target.closest(RECORD_DETAIL_CHILD_POPOVER_SELECTOR));
}

/** 关闭当前展开的记录详情面板（若存在）。供切库 / 视图 re-render 调用，避免孤儿 listener。 */
export function closeRecordDetailPanel(): void {
  currentPanel?.close();
}

/** 当前展开面板的记录路径（无则 null）。 */
export function getOpenRecordDetailPath(): string | null {
  return currentPanel?.filePath ?? null;
}

/** 视图 re-render 后刷新面板：同记录则局部刷新字段（常驻编辑），否则（记录被筛掉/切换）关闭。 */
export function refreshRecordDetailPanel(newRow: RowData): void {
  if (currentPanel && currentPanel.filePath === newRow.file.path) {
    currentPanel.refreshFields(newRow);
  } else {
    closeRecordDetailPanel();
  }
}

export function openRecordDetailPanel(opts: OpenRecordDetailOptions): void {
  // 互斥：先关旧面板
  closeRecordDetailPanel();

  const { anchorEl, host, row, columns, config, app, actions } = opts;

  // 记录从日历 overflow popover 打开时，定位必须先使用仍连接且可见的事件锚点。
  // 定位完成后只隐藏 overflow，不能 remove：CalendarRenderer 会保留节点引用供
  // “还有 N 条”再次打开；remove 会留下 detached 引用，使后续 hover/click 无响应。
  const calendarPopovers = Array.from(
    host.querySelectorAll<HTMLElement>(".db-calendar-day-popover, .db-calendar-week-allday-popover")
  );

  const panel = host.createDiv({ cls: "db-record-detail-panel" });

  // 关闭逻辑（先定义，renderContent 的「打开笔记」按钮复用 close）
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    panel.remove();
    window.activeDocument.removeEventListener("mousedown", onOutside, true);
    window.activeDocument.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("resize", onResize);
    if (currentPanel?.close === close) currentPanel = null;
  };
  const onOutside = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && (panel.contains(target) || anchorEl.contains(target))) return;
    // 字段编辑器挂在 host/body，而不是详情 panel 内；它们属于详情面板的子交互，
    // 不能被误判成 outside click。该集合必须覆盖所有 CellRenderer 编辑表面。
    if (isRecordDetailChildPopoverTarget(event.target)) return;
    close();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape") {
      // 嵌套编辑器拥有第一层 Escape：先关闭/取消编辑器，详情面板继续保留。
      if (isRecordDetailChildPopoverTarget(event.target)) return;
      event.preventDefault();
      close();
    }
  };
  const onResize = (): void => close();

  // 渲染面板内容（title + fields + footer）；抽成函数以支持 re-render 后局部刷新（常驻编辑）
  const renderContent = (r: RowData): void => {
    panel.empty();
    const explicitTitleField = getRecordEventTitleField(config);
    const title = resolveTitleFieldDisplay(r, config, explicitTitleField);
    const titleField = title.field || "file.name";
    // 标题区（对齐事件卡片标题）+ 右上角「打开笔记」按钮（复用看板卡片 db-board-card-open 样式）
    const header = panel.createDiv({ cls: "db-record-detail-header" });
    actions.renderRecordIcon?.(header, r, config);
    const titleEl = header.createDiv({ cls: "db-record-detail-title", text: title.text });
    actions.applyConditionalFormat?.(titleEl, r, config, titleField);
    if (title.isEmpty) titleEl.addClass("is-empty-title");
    // 仅 file.name 标题可双击重命名；其它字段标题只读（用字段编辑改值）
    const editFileName = titleField === "file.name" ? actions.editFileName : undefined;
    if (editFileName && !actions.isReadOnly) {
      titleEl.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        editFileName(titleEl, r, title.text);
      });
      setFieldTooltip(titleEl, title.text, t("cell.doubleClickRename"));
    } else {
      setFieldTooltip(titleEl, title.isEmpty ? "" : title.text);
    }
    const openBtn = header.createEl("button", {
      cls: "db-board-card-open",
    });
    setIcon(openBtn, "maximize-2");
    setTooltip(openBtn, t("menu.openNote"), { delay: 100 });
    openBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.openRow(r);
      close();
    });
    // 字段列表（跳过 titleField；空字段按 showEmptyFields 过滤，对齐看板卡片）
    const fieldsEl = panel.createDiv({ cls: "db-record-detail-fields" });
    for (const col of columns) {
      if (col.key === titleField) continue;
      const value = getRecordCellValue(r, col);
      const displayType = getRecordDisplayType(config, col);
      const empty = isEmptyValue(value) && displayType !== "checkbox";
      if (empty && config.showEmptyFields !== true) continue;
      renderRecordField(fieldsEl, r, col, config, app, actions);
    }
  };

  renderContent(row);
  // 定位（复用 positionToolbarPopover：挂载点选择 / 视口夹取 / 翻转 / 移动端留白）
  positionToolbarPopover(panel, anchorEl, { minWidth: 240, preferredWidth: 360, maxWidth: 420, align: "center" });
  // positionToolbarPopover 会在下一帧复测一次；按注册顺序在其复测之后隐藏来源
  // overflow，既保留正确锚点位置，也避免详情面板与事件列表继续层叠显示。
  window.requestAnimationFrame(() => {
    calendarPopovers.forEach((popover) => {
      if (popover.isConnected) popover.addClass("is-hidden");
    });
  });

  // 延后注册 mousedown，避免触发打开的那次点击冒泡立即关闭面板
  window.setTimeout(() => window.activeDocument.addEventListener("mousedown", onOutside, true), 0);
  window.activeDocument.addEventListener("keydown", onKeydown, true);
  // 不监听滚动：面板 fixed，滚动视图不关闭；仅 resize 关闭（视口变化重定位不划算）
  window.addEventListener("resize", onResize);

  currentPanel = {
    filePath: row.file.path,
    close,
    refreshFields: (newRow: RowData) => renderContent(newRow),
  };
}

/** 渲染单个字段行（label + 值 + 点击编辑绑定）。 */
function renderRecordField(
  parent: HTMLElement,
  row: RowData,
  col: ColumnDef,
  config: ViewConfig,
  app: App,
  actions: RecordDetailActions,
): void {
  const value = getRecordCellValue(row, col);
  const displayType = getRecordDisplayType(config, col);
  const empty = isEmptyValue(value) && displayType !== "checkbox";
  const displayValue = empty ? getEmptyDisplayValue(displayType) : value;

  const field = parent.createDiv({ cls: "db-record-detail-field" });
  field.setAttribute("data-note-database-column-key", col.key);
  actions.applyConditionalFormat?.(field, row, config, col.key);
  if (actions.isReadOnly || isReadonlyFileField(col.key)) field.addClass("is-readonly");
  if (col.wrap) field.addClass("db-board-card-field-wrap");
  field.style.setProperty("--db-card-field-width", `${getFieldWidth(config, col)}px`);
  field.createSpan({ cls: "db-record-detail-field-label", text: col.label });
  setFieldTooltip(field, displayValue, col.label);

  const valueEl = field.createDiv({ cls: "db-board-card-value" });
  if (empty) valueEl.addClass("db-card-empty-placeholder");

  // 右键字段 → 列菜单（对齐看板 attachColumnContextMenu；只读视图不接 showColumnMenu 则不绑）
  const showColumnMenu = actions.showColumnMenu;
  if (showColumnMenu) {
    field.addEventListener("contextmenu", (event) => {
      if (isHTMLElement(event.target) && event.target.closest("input, select, textarea, button, a")) return;
      event.preventDefault();
      event.stopPropagation();
      showColumnMenu(event, col, field);
    });
  }

  // 点击字段值进入内联编辑（仿 BoardRenderer.renderPreviewValue 的守卫）
  field.addEventListener("click", (event) => {
    if (actions.isReadOnly || isReadonlyFileField(col.key)) return;
    if (isHTMLElement(event.target) && event.target.closest("a, button, input, textarea, .db-cell-editing")) return;
    event.stopPropagation();
    actions.editCell(valueEl, row, col, event);
  });

  renderRecordValue(valueEl, row, col, displayValue, displayType, app, actions);
  // renderRecordValue 部分分支（file 特殊 / select / number）未给 valueEl 设 title；统一补上，hover 值显示完整内容
  setFieldTooltip(valueEl, displayValue);
}

/** 渲染字段值展示（移植自 BoardRenderer.renderPreviewValue 的展示分支，markdown/link/image 首版降级为文本）。 */
function renderRecordValue(
  valueEl: HTMLElement,
  row: RowData,
  col: ColumnDef,
  value: unknown,
  displayType: ColumnDef["type"],
  app: App,
  actions: RecordDetailActions,
): void {
  // checkbox
  if (displayType === "checkbox") {
    valueEl.addClass("db-checkbox-cell");
    const cb = valueEl.createEl("input", { attr: { type: "checkbox" } });
    cb.checked = toBooleanValue(value);
    cb.onclick = (event) => event.stopPropagation();
    cb.disabled = !!actions.isReadOnly;
    if (!actions.isReadOnly) {
      cb.onchange = () => {
        void actions.editCell(valueEl, row, col);
      };
    }
    setFieldTooltip(valueEl, cb.checked ? t("common.true") : t("common.false"));
    return;
  }

  // file 特殊字段（file.tags / file 链接字段）
  if (shouldRenderSpecialFileField(col) && renderSpecialFileFieldValue(valueEl, app, row, col, value, {
    tagsContainerClass: "db-board-card-badges",
    linkItemClass: "db-board-card-link",
  })) {
    valueEl.addClass("has-badges");
    return;
  }

  // select / status
  if (col.type === "select" || col.type === "status") {
    renderBadge(valueEl, col, String(value));
    return;
  }

  // multi-select
  if (col.type === "multi-select") {
    const values = toMultiSelectValuesForKey(col.key, value);
    valueEl.addClass("has-badges");
    const wrap = valueEl.createDiv({ cls: "db-board-card-badges" });
    setFieldTooltip(wrap, values);
    for (const entry of values) renderBadge(wrap, col, entry);
    return;
  }
  if (col.type === "relation" && renderRelationValue(valueEl, app, row, value, true)) {
    valueEl.addClass("has-badges");
    return;
  }

  // date / datetime
  if (displayType === "date" || displayType === "datetime") {
    valueEl.addClass("db-date-value");
    valueEl.textContent = displayType === "datetime"
      ? formatDateTimeValueDisplay(value, { mode: "full", showTimeWhenMissing: true })
      : formatDateValueDisplay(value);
    setFieldTooltip(valueEl, valueEl.textContent);
    return;
  }

  // number（rating / progress / ring）
  if (displayType === "number") {
    const num = typeof value === "number" ? value : parseFloat(String(value));
    if (!isNaN(num)) {
      const style = getNumberDisplayStyle(col);
      if (style === "rating") { renderRating(valueEl, num, col.numberDisplayConfig); return; }
      if (style === "progress") { renderProgress(valueEl, num, col.numberDisplayConfig); return; }
      if (style === "ring") { renderProgressRing(valueEl, num, col.numberDisplayConfig); return; }
    }
  }

  // markdown 内联（text 字段 textRenderMode === "markdown"）：对齐看板卡片渲染，
  // 链接点击 stopPropagation 立即打开（renderInlineMarkdown 默认 card 策略，与面板"单击=编辑"共存）
  if (col.textRenderMode === "markdown" && !isFileFieldKey(col.key)) {
    const mdValues = Array.isArray(value) ? value : [value];
    const parsed = mdValues.map((entry) => parseInlineMarkdown(entry));
    if (parsed.some((nodes) => nodes !== null)) {
      valueEl.empty();
      const onOpenLink = (target: string, external: boolean): void => {
        openTarget(app, row, target, external);
      };
      const onResolveImage = (target: string, external: boolean): string | null =>
        resolveInlineImageSrc(app, row, target, external);
      parsed.forEach((nodes, idx) => {
        if (idx > 0) valueEl.appendText(", ");
        if (nodes) {
          if (parsed.length === 1) renderInlineMarkdown(valueEl, nodes, { onOpenLink, onResolveImage });
          else renderInlineMarkdown(valueEl.createSpan(), nodes, { onOpenLink, onResolveImage });
        } else {
          valueEl.appendText(safeString(mdValues[idx]));
        }
      });
      setFieldTooltip(valueEl, valueToTooltip(value));
      return;
    }
  }

  // text link（textRenderMode === "link"）：值显示为可点击链接，对齐看板/列表/画廊
  if (col.textRenderMode === "link" && !isFileFieldKey(col.key)) {
    const linkValues = Array.isArray(value) ? value : [value];
    const links = linkValues
      .map((entry) => parseTextLink(entry))
      .filter((entry): entry is ParsedLink => entry !== null);
    if (links.length > 0) {
      for (const link of links) renderLink(valueEl, link, app, row);
      return;
    }
  }

  // 默认文本
  valueEl.textContent = Array.isArray(value) ? value.join(", ") : safeString(value);
  setFieldTooltip(valueEl, valueEl.textContent);
}

/** 事件标题字段：日历用 calendarTitleField，时间线用 timelineTitleField，对齐事件卡片。 */
function getRecordEventTitleField(config: ViewConfig): string | undefined {
  if (config.viewType === "calendar") return config.calendarTitleField;
  if (config.viewType === "timeline") return config.timelineTitleField;
  return config.titleField;
}

function getRecordCellValue(row: RowData, col: ColumnDef): unknown {
  if (isFileFieldKey(col.key)) return getRowFileFieldValue(row, col.key);
  if (col.type === "computed" || col.type === "rollup") {
    return row.computed[col.type === "computed" ? col.computedKey || col.key : col.key];
  }
  if (isObsidianTagsKey(col.key)) return toMultiSelectValuesForKey(col.key, row.frontmatter[col.key]);
  return row.frontmatter[col.key];
}

function getRecordDisplayType(config: ViewConfig, col: ColumnDef): ColumnDef["type"] {
  if (isFileFieldKey(col.key)) return getFileFieldFixedType(col.key);
  return getColumnDisplayType(col, config.schema.computedFields);
}

function isEmptyValue(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function getEmptyDisplayValue(displayType: ColumnDef["type"]): unknown {
  if (displayType === "multi-select") return [t("common.empty")];
  if (displayType === "checkbox") return false;
  return t("common.empty");
}

function renderBadge(parent: HTMLElement, col: ColumnDef, value: string): void {
  const badge = parent.createSpan({ cls: "status-badge", text: value });
  badge.title = value;
  const option = getColumnOptions(col).find((item) => normalizeOptionValueForKey(col.key, item.value) === value);
  badge.addClass(option ? `status-color-${option.color}` : "status-color-gray");
}

/** 打开内部 / 外部链接（markdown 内联链接 / 图片点击复用）。 */
function openTarget(app: App, row: RowData, target: string, external: boolean): void {
  if (external) {
    window.open(target);
    return;
  }
  void app.workspace.openLinkText(target, row.file.path);
}

interface ParsedLink {
  label: string;
  target: string;
  external: boolean;
}

/** text link 模式：值渲染为可点击链接（复刻 BoardRenderer.renderLink）。 */
function renderLink(parent: HTMLElement, link: ParsedLink, app: App, row: RowData): void {
  const anchor = parent.createEl("a", { cls: "db-board-card-link", text: link.label, attr: { title: link.label } });
  anchor.href = link.external ? link.target : "#";
  anchor.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTarget(app, row, link.target, link.external);
  };
}
