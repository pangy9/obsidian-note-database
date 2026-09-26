// 快速采集表单渲染器：视图态（DatabaseView.renderForm）与 Modal 态（QuickFormModal）
// 共用。字段/必填/锁定由 FormModel 纯模块规划；控件复用插件现有组件（日期选择器、
// 下拉、星级/进度纯函数），多选与 relation 为表单版 popover。
import { App, Notice, setIcon } from "obsidian";
import { t } from "../i18n";
import { ColumnDef, RowData, SourceRuleNode, StatusOptionDef, ViewConfig } from "../data/types";
import {
  buildFormCreateInput,
  FormCreateInput,
  FormFieldPlan,
  planFormFields,
  validateForm,
} from "../data/FormModel";
import { NoteRecord } from "../data/DataSource";
import { parseCoverImage } from "../data/CoverImage";
import { ImageFileSuggestModal } from "./ImageFileSuggestModal";
import { buildRatingSlots, progressFillPercent, progressValueFromBarPointer, progressValueFromRingPointer, ringGeometry } from "../data/NumberDisplay";
import { renderPropertyTypeIcon } from "./PropertyTypeIcon";
import { renderRelationValue } from "./RelationValueRenderer";
import { renderRecordIcon } from "./RecordIconRenderer";
import { renderInlineMarkdown } from "./InlineMarkdownRenderer";
import { parseInlineMarkdown } from "../data/InlineMarkdown";
import { parseTextLink } from "../data/TextLink";
import { getInvalidObsidianTagValues, normalizeOptionValueForKey, normalizeValidObsidianTagValue, resolveOptionDisplay } from "../data/ColumnTypes";
import { OPTION_REGISTRATION_COLORS } from "../data/OptionRegistration";
import { confirmWithModal } from "./modals/ConfirmModal";
import { closeActiveOptionColorPicker, openOptionColorPicker } from "./OptionColorPicker";
import { renderDateValuePicker, closeActiveDateValuePicker } from "./DateValuePicker";
import { installPopoverAutoClose } from "./PopoverAutoClose";
import { positionToolbarPopover } from "./PopoverPosition";
import { createFormPopoverPortal } from "./FormPopoverPortal";
import { suppressClickWhileTextSelected } from "./TextSelectionClickGuard";
import { renderMobileOptionMoveControls } from "./MobileOptionReorder";

export interface FormRendererActions {
  submitForm(input: FormCreateInput): Promise<boolean>;
  /** relation 字段的目标库记录列表（按 relationConfig 解析，由宿主提供）。 */
  getRelationRecords(col: ColumnDef): NoteRecord[];
  /** 数据库定义文件路径（封面相对链接的解析基准）。 */
  getSourcePath(): string;
  /** 视图态提供（持久化 + 重绘）；Modal 快照态不传 → 封面换图/拖动交互禁用。 */
  saveConfig?(config: ViewConfig): void;
  /** 选项增删、改色、排序走宿主的配置事务；失败时表单回退到原选项。 */
  updateOptions?(col: ColumnDef, before: StatusOptionDef[], next: StatusOptionDef[], removed?: string[]): Promise<boolean>;
  app: App;
}

export interface FormRendererOptions {
  /** 提交成功后：keep = 清空保持打开（连续采集，默认）；close = 回调 onSubmitted 由宿主关闭。 */
  keepOpenAfterSubmit?: "keep" | "close";
  onSubmitted?(): void;
  /** 未提交草稿按数据库/视图/入口隔离，当前插件会话内保留。 */
  draftKey?: string;
  /** 快捷弹窗有自己的紧凑标题，不重复渲染表单视图标题。 */
  hideHeader?: boolean;
  /** 只读嵌入仍展示字段，但不允许输入或提交。 */
  readOnly?: boolean;
}

interface FormRenderContext {
  config: ViewConfig;
  mergedRuleTree: SourceRuleNode | undefined;
  hiddenColumnKeys: ReadonlySet<string>;
  actions: FormRendererActions;
  options: FormRendererOptions;
}

export class FormRenderer {
  private static readonly drafts = new Map<string, Map<string, unknown>>();
  private values = new Map<string, unknown>();
  private draftKey?: string;
  /** 红圈只在用户点击提交后才显示（输入过程中不打扰）。 */
  private showErrors = false;
  private plan = planFormFields({
    config: { schema: { columns: [], computedFields: [] } } as unknown as ViewConfig,
    mergedSourceRuleTree: undefined,
    hiddenColumnKeys: new Set<string>(),
  });
  private container: HTMLElement | null = null;
  private stageEl: HTMLElement | null = null;
  private formEl: HTMLElement | null = null;
  /** rollup 只读占位元素（col.key → 展示节点），relation 值变化时实时刷新。 */
  private rollupEls = new Map<string, HTMLElement>();
  /** rating/slider 当前值的 hint 节点（col.key → label 行内 span）。 */
  private valueHintEls = new Map<string, HTMLElement>();
  private context: FormRenderContext | null = null;
  private closeables: Array<() => void> = [];
  private submitting = false;

  render(
    container: HTMLElement,
    config: ViewConfig,
    mergedRuleTree: SourceRuleNode | undefined,
    hiddenColumnKeys: ReadonlySet<string>,
    actions: FormRendererActions,
    options: FormRendererOptions = {},
  ): void {
    this.destroy();
    if (this.draftKey !== options.draftKey) {
      this.draftKey = options.draftKey;
      this.values = new Map(this.draftKey ? FormRenderer.drafts.get(this.draftKey) : undefined);
      this.showErrors = false;
    }
    this.container = container;
    this.context = { config, mergedRuleTree, hiddenColumnKeys, actions, options };
    // 幂等清理：只移除自建的表单节点，绝不动宿主容器（dashboard 的 header/toolbar
    // 与视图容器同级共存——对齐 BoardRenderer.clear 只清 .db-board 的模式）。
    container.querySelectorAll(":scope > .db-form-stage, :scope > .db-form").forEach((el) => el.remove());
    this.plan = planFormFields({ config, mergedSourceRuleTree: mergedRuleTree, hiddenColumnKeys });

    const coverMode = config.formCoverMode || "banner";
    const stage = container.createDiv({ cls: `db-form-stage db-form-stage-${coverMode}` });
    this.stageEl = stage;
    const form = stage.createDiv({ cls: `db-form db-form-cover-${coverMode}${options.readOnly ? " is-readonly" : ""}` });
    this.formEl = form;
    const scroll = form.createDiv({ cls: "db-form-scroll" });
    this.renderCover(stage, scroll, config, actions);
    if (!options.hideHeader) this.renderHeader(scroll, config, actions);
    const fieldsEl = scroll.createDiv({ cls: "db-form-fields" });
    for (const field of this.plan.fields) {
      this.renderField(fieldsEl, field, actions);
    }
    if (options.readOnly) fieldsEl.inert = true;
    else this.renderActions(form);
    this.refreshErrorStates();
    this.refreshRollupPreviews(actions);
  }

  destroy(): void {
    if (this.draftKey) {
      if (this.values.size > 0) FormRenderer.drafts.set(this.draftKey, new Map(this.values));
      else FormRenderer.drafts.delete(this.draftKey);
    }
    this.closeFormPopovers();
    this.rollupEls.clear();
    this.valueHintEls.clear();
    if (this.formEl) closeActiveDateValuePicker(this.formEl.ownerDocument);
    this.stageEl?.remove();
    this.stageEl = null;
    this.formEl = null;
    this.container = null;
  }

  private closeFormPopovers(): void {
    const closeables = this.closeables.splice(0);
    for (const close of closeables) {
      try { close(); } catch { /* 弹层可能已被宿主移除 */ }
    }
  }

  /** 当前字段规划（宿主用 validateCreatedFrontmatter 做提交闸门）。 */
  getPlan() {
    return this.plan;
  }

  /** 清空输入并按上次渲染上下文重绘（连续采集/清空按钮）。 */
  reset(): void {
    this.values.clear();
    if (this.draftKey) FormRenderer.drafts.delete(this.draftKey);
    this.showErrors = false;
    if (this.container && this.context) {
      const { config, mergedRuleTree, hiddenColumnKeys, actions, options } = this.context;
      this.render(this.container, config, mergedRuleTree, hiddenColumnKeys, actions, options);
    }
  }

  private renderCover(stage: HTMLElement, scroll: HTMLElement, config: ViewConfig, actions: FormRendererActions): void {
    const raw = config.formCoverImage?.trim();
    if (!raw) return;
    const parsed = parseCoverImage(raw, { file: { path: actions.getSourcePath() } } as unknown as RowData, actions.app);
    if (!parsed) return;
    const initialPosition = Math.max(0, Math.min(100, config.formCoverPositionY ?? 50));
    if (config.formCoverMode === "wallpaper" || config.formCoverMode === "half") {
      stage.style.setProperty("--db-form-cover-image", `url(${JSON.stringify(parsed.src)})`);
      stage.style.setProperty("--db-form-cover-position", `center ${initialPosition}%`);
      if (actions.saveConfig) this.installStageCoverDrag(stage, config, actions);
      return;
    }
    const cover = scroll.createDiv({ cls: "db-form-cover" });
    cover.style.height = `${config.formCoverHeight ?? 150}px`;
    const image = cover.createEl("img", {
      attr: { src: parsed.src, alt: parsed.alt || "", draggable: "false" },
    });
    image.style.objectPosition = `center ${initialPosition}%`;
    if (!actions.saveConfig) return;

    // 与数据库封面同源交互：拖动调焦点（objectPosition）、右下角换图、底缘拖动调高度。
    cover.addClass("is-repositionable");
    let dragStartY = 0;
    let dragStartPosition = initialPosition;
    let draggingPosition = false;
    cover.onpointerdown = (event) => {
      if (event.button !== 0 || (event.target as HTMLElement | null)?.closest("button")) return;
      draggingPosition = true;
      dragStartY = event.clientY;
      dragStartPosition = config.formCoverPositionY ?? 50;
      cover.addClass("is-repositioning");
      cover.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    cover.onpointermove = (event) => {
      if (!draggingPosition) return;
      const height = Math.max(1, cover.getBoundingClientRect().height);
      const next = Math.max(0, Math.min(100, dragStartPosition - ((event.clientY - dragStartY) / height) * 100));
      config.formCoverPositionY = next;
      image.style.objectPosition = `center ${next}%`;
    };
    const finishPositionDrag = (event: PointerEvent): void => {
      if (!draggingPosition) return;
      draggingPosition = false;
      cover.removeClass("is-repositioning");
      if (cover.hasPointerCapture(event.pointerId)) cover.releasePointerCapture(event.pointerId);
      actions.saveConfig?.(config);
    };
    cover.onpointerup = finishPositionDrag;
    cover.onpointercancel = finishPositionDrag;

    // 高度拖柄（底缘中央）：上下拖动调整展示高度。
    const resize = cover.createEl("button", { cls: "db-form-cover-resize", attr: { type: "button", "aria-label": t("form.coverResize") } });
    let resizing = false;
    let resizeStartY = 0;
    let resizeStartHeight = 0;
    resize.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      resizing = true;
      resizeStartY = event.clientY;
      resizeStartHeight = config.formCoverHeight ?? 150;
      resize.setPointerCapture(event.pointerId);
    };
    resize.onpointermove = (event) => {
      if (!resizing) return;
      const next = Math.max(100, Math.min(500, resizeStartHeight + (event.clientY - resizeStartY)));
      config.formCoverHeight = next;
      cover.style.height = `${next}px`;
    };
    const finishResize = (event: PointerEvent): void => {
      if (!resizing) return;
      resizing = false;
      if (resize.hasPointerCapture(event.pointerId)) resize.releasePointerCapture(event.pointerId);
      actions.saveConfig?.(config);
    };
    resize.onpointerup = finishResize;
    resize.onpointercancel = finishResize;

    // 右下角换图入口（与数据库封面一致）。
    const change = cover.createEl("button", {
      cls: "db-form-cover-change",
      attr: { type: "button", "aria-label": t("databaseCover.choose") },
    });
    setIcon(change, "image-up");
    change.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      new ImageFileSuggestModal(actions.app, (selected) => {
        config.formCoverImage = selected.path;
        config.formCoverPositionY = 50;
        actions.saveConfig?.(config);
      }, t("databaseCover.choose")).open();
    };
  }

  private installStageCoverDrag(stage: HTMLElement, config: ViewConfig, actions: FormRendererActions): void {
    stage.addClass("is-cover-repositionable");
    let dragging = false;
    let startY = 0;
    let startPosition = 50;
    stage.onpointerdown = (event) => {
      // 背景露出的区域本身就是拖动面，不在表单上覆盖额外的手柄。
      if (event.button !== 0 || event.target !== stage) return;
      dragging = true;
      startY = event.clientY;
      startPosition = config.formCoverPositionY ?? 50;
      stage.addClass("is-cover-repositioning");
      stage.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    stage.onpointermove = (event) => {
      if (!dragging) return;
      const distance = Math.min(460, Math.max(1, stage.getBoundingClientRect().height));
      const next = Math.max(0, Math.min(100, startPosition - ((event.clientY - startY) / distance) * 100));
      config.formCoverPositionY = next;
      stage.style.setProperty("--db-form-cover-position", `center ${next}%`);
    };
    const finish = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      stage.removeClass("is-cover-repositioning");
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      actions.saveConfig?.(config);
    };
    stage.onpointerup = finish;
    stage.onpointercancel = finish;
  }

  private renderHeader(scroll: HTMLElement, config: ViewConfig, actions: FormRendererActions): void {
    const header = scroll.createDiv({ cls: "db-form-header" });
    const title = header.createDiv({ cls: "db-form-title", text: config.formTitle?.trim() || config.name || t("common.formView") });
    if (!actions.saveConfig) return; // Modal 快照态不支持就地改名。
    title.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // 与数据库标题同款编辑态（db-heading-edit-title 样式）；Enter/失焦提交，Esc 取消。
      const rect = title.getBoundingClientRect();
      const input = title.ownerDocument.createElement("input");
      input.type = "text";
      input.className = "db-heading-edit db-heading-edit-title db-form-title-edit";
      input.value = config.formTitle?.trim() || config.name || "";
      input.setAttribute("aria-label", t("form.titleLabel"));
      input.style.width = `${Math.max(160, Math.ceil(rect.width))}px`;
      input.style.height = `${Math.ceil(rect.height)}px`;
      title.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        config.formTitle = input.value.trim() || undefined;
        actions.saveConfig?.(config);
      };
      const cancel = () => actions.saveConfig?.(config); // 重绘即还原原标题
      input.addEventListener("keydown", (keyEvent) => {
        if (keyEvent.key === "Enter") {
          keyEvent.preventDefault();
          commit();
        } else if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          cancel();
        }
      });
      input.addEventListener("blur", commit);
    });
  }

  /** 属性名右侧的显示样式标记（icon + 文案，对齐列菜单的显示样式子菜单）。 */
  private renderDisplayStyleHint(label: HTMLElement, col: ColumnDef): void {
    const parts: Array<{ icon?: string; text: string }> = [];
    if (col.type === "text") {
      if (col.textRenderMode === "link") parts.push({ icon: "link", text: t("menu.textRenderLink") });
      else if (col.textRenderMode === "markdown") parts.push({ icon: "square-m", text: t("menu.textRenderMarkdown") });
      if (col.wrap) parts.push({ icon: "wrap-text", text: t("panel.wrap") });
    }
    // 仅 number 列显示数字样式标记；currency 不支持显示样式（复制的残留值不展示）。
    if (col.type === "number") {
      const style = col.numberDisplayStyle;
      if (style === "rating") parts.push({ icon: "star", text: t("menu.numberStyleRating") });
      else if (style === "progress") parts.push({ icon: "gauge", text: t("menu.numberStyleProgress") });
      else if (style === "ring") parts.push({ icon: "circle-dashed", text: t("menu.numberStyleRing") });
    }
    if (parts.length === 0) return;
    const styleGroup = label.createSpan({ cls: "db-form-style-hints" });
    for (const part of parts) {
      const span = styleGroup.createSpan({ cls: "db-form-style-hint" });
      if (part.icon) {
        const icon = span.createSpan({ cls: "db-form-style-hint-icon" });
        setIcon(icon, part.icon);
      }
      span.createSpan({ text: part.text });
    }
  }

  /** rating/slider 值变化时同步属性名右侧的数值 hint。 */
  private updateValueHint(field: FormFieldPlan): void {
    const hint = this.valueHintEls.get(field.col.key);
    if (!hint) return;
    const current = this.getValue(field);
    hint.textContent = typeof current === "number" ? String(current) : "";
  }

  /** 与单元格 renderStatus 同款：status-badge + 选项色（无匹配选项回落灰色）。 */
  private renderStatusBadge(parent: HTMLElement, col: ColumnDef, value: string): void {
    const resolved = resolveOptionDisplay(col, value);
    const badge = parent.createSpan({ cls: "status-badge", text: resolved.value });
    badge.title = resolved.value;
    badge.addClass(resolved.option ? `status-color-${resolved.option.color}` : "status-color-gray");
  }

  private renderField(fieldsEl: HTMLElement, field: FormFieldPlan, actions: FormRendererActions): void {
    const wrap = fieldsEl.createDiv({ cls: "db-form-field", attr: { "data-form-field": field.col.key } });
    const label = wrap.createDiv({ cls: "db-form-field-label" });
    renderPropertyTypeIcon(label, field.col, "db-property-icon db-form-field-type-icon");
    label.createSpan({ cls: "db-form-field-name", text: field.col.label || field.col.key });
    if (field.required) label.createSpan({ cls: "db-form-required-mark", text: "*" });
    if (field.availability === "locked") {
      label.createSpan({ cls: "db-form-locked-hint", text: t("form.lockedFromSourceRules") });
    }
    // 数值 hint：紧贴属性名称文字（在显示样式标记之前创建）。
    if (field.controlKind === "rating" || field.controlKind === "slider" || field.controlKind === "ring") {
      const hint = label.createSpan({ cls: "db-form-value-hint" });
      this.valueHintEls.set(field.col.key, hint);
      const current = this.getValue(field);
      if (typeof current === "number") hint.textContent = String(current);
    }
    // 显示样式标记（对齐列菜单的 icon + 文案）：右对齐贴行尾。
    this.renderDisplayStyleHint(label, field.col);
    const control = wrap.createDiv({ cls: "db-form-field-control" });
    if (field.availability === "locked") {
      const value = field.prefilledValue;
      const display = (item: unknown): string => {
        if (item == null) return "";
        if (typeof item === "object") return JSON.stringify(item);
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);
        return "";
      };
      const text = Array.isArray(value) ? value.map(display).join(", ") : display(value);
      control.createDiv({ cls: "db-form-locked-value", text });
      return;
    }
    if (field.availability === "readonly") {
      const hint = control.createDiv({ cls: "db-form-readonly-hint", text: t("form.rollupPlaceholder") });
      this.rollupEls.set(field.col.key, hint);
      return;
    }
    switch (field.controlKind) {
      case "textarea":
        this.renderTextControl(control, field, true, actions);
        break;
      case "number":
        this.renderNumberControl(control, field);
        break;
      case "rating":
        this.renderRatingControl(control, field);
        break;
      case "slider":
        this.renderProgressControl(control, field, false);
        break;
      case "ring":
        this.renderProgressControl(control, field, true);
        break;
      case "date":
      case "datetime":
        this.renderDateControl(control, field);
        break;
      case "select":
        this.renderSelectControl(control, field, actions);
        break;
      case "multiselect":
        this.renderMultiselectControl(control, field, actions);
        break;
      case "checkbox":
        this.renderCheckboxControl(control, field);
        break;
      case "relation":
        this.renderRelationControl(control, field, actions);
        break;
      default:
        this.renderTextControl(control, field, false, actions);
        break;
    }
  }

  private getValue(field: FormFieldPlan): unknown {
    return this.values.get(field.col.key);
  }

  private setValue(field: FormFieldPlan, value: unknown): void {
    if (value === undefined) this.values.delete(field.col.key);
    else this.values.set(field.col.key, value);
    if (this.showErrors) this.refreshErrorStates();
  }

  /** 即时提示：必填为空时标红（不阻止提交——最终以创建计划校验为准）。 */
  private refreshErrorStates(): void {
    if (!this.container) return;
    const values = Object.fromEntries(this.values);
    const missing = new Set(validateForm(values, this.plan).missing.map((f) => f.col.key));
    this.container.querySelectorAll<HTMLElement>(".db-form-field").forEach((el) => {
      el.toggleClass("db-form-has-error", missing.has(el.dataset.formField || ""));
    });
  }

  private renderTextControl(control: HTMLElement, field: FormFieldPlan, multiline: boolean, actions: FormRendererActions): void {
    const renderMode = field.col.textRenderMode;
    const hasPreview = renderMode === "markdown" || renderMode === "link";
    const shell = hasPreview ? control.createDiv({ cls: "db-form-text-shell" }) : control;
    const input = multiline
      ? shell.createEl("textarea", { cls: "db-form-textarea", attr: { rows: "3" } })
      : shell.createEl("input", { cls: "db-form-input", attr: { type: "text" } });
    input.placeholder = t(field.placeholderKey);
    const current = this.getValue(field);
    input.value = typeof current === "string" ? current : "";
    // 非 plain 显示样式使用同一个控件位置：聚焦时编辑原文，失焦后原地显示。
    // 避免同时出现输入框和下方第二行预览，也不在用户连续输入时抢走焦点。
    const preview = hasPreview
      ? shell.createDiv({ cls: "db-form-text-preview", attr: { role: "button", tabindex: "0" } })
      : null;
    const renderPreview = (): void => {
      if (!preview) return;
      preview.empty();
      const raw = input.value;
      if (!raw.trim()) {
        preview.addClass("is-empty");
        return;
      }
      preview.removeClass("is-empty");
      if (renderMode === "markdown") {
        const nodes = parseInlineMarkdown(raw);
        if (nodes) {
          renderInlineMarkdown(preview, nodes, {
            baseClass: "db-text",
            linkClickStrategy: "table",
            onOpenLink: (target, external) => {
              if (external) window.open(target);
              else void actions.app.workspace.openLinkText(target, actions.getSourcePath());
            },
          });
        } else preview.textContent = raw;
      } else if (renderMode === "link") {
        const link = parseTextLink(raw);
        if (link) {
          preview.createEl("a", {
            cls: `db-text-link ${link.external ? "external-link" : "internal-link"}`,
            text: link.label,
            attr: { title: link.target },
          });
        } else {
          preview.textContent = raw;
        }
      }
    };
    input.addEventListener("input", () => {
      this.setValue(field, input.value);
      if (multiline) this.autoGrow(input as HTMLTextAreaElement);
      renderPreview();
    });
    if (preview) {
      const showPreview = () => {
        const hasValue = input.value.trim().length > 0;
        input.hidden = hasValue;
        preview.hidden = !hasValue;
      };
      const beginEdit = () => {
        input.hidden = false;
        preview.hidden = true;
        input.focus();
      };
      input.addEventListener("blur", showPreview);
      if (!multiline) input.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") input.blur();
      });
      preview.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        beginEdit();
      }, true);
      preview.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        beginEdit();
      });
      showPreview();
    }
    if (multiline) this.autoGrow(input as HTMLTextAreaElement);
    renderPreview();
  }

  /** 聚焦数字输入时滚轮不应改值（浏览器默认行为反直觉），阻止并保持页面滚动语义。 */
  private disableWheelChange(input: HTMLInputElement): void {
    input.addEventListener("wheel", (event) => {
      if (window.activeDocument.activeElement === input) event.preventDefault();
    }, { passive: false });
  }

  private autoGrow(_textarea: HTMLTextAreaElement): void {
    // 高度自适应交由 CSS（.db-form-textarea 的 max-height + overflow），避免逐帧改内联样式。
  }

  private renderNumberControl(control: HTMLElement, field: FormFieldPlan): void {
    const input = control.createEl("input", { cls: "db-form-input", attr: { type: "number" } });
    this.disableWheelChange(input);
    input.placeholder = t(field.placeholderKey);
    const current = this.getValue(field);
    if (typeof current === "number") input.value = String(current);
    input.addEventListener("input", () => {
      const raw = input.value.trim();
      this.setValue(field, raw === "" ? undefined : Number(raw));
    });
  }

  private renderRatingControl(control: HTMLElement, field: FormFieldPlan): void {
    const config = field.col.numberDisplayConfig;
    const max = config?.ratingMax && config.ratingMax > 0 ? config.ratingMax : 5;
    const symbol = config?.ratingSymbol || "star";
    const isEmoji = symbol === "emoji";
    const host = control.createDiv({ cls: `db-form-rating${config?.ratingVariant === "outline" && !isEmoji ? " is-outline" : ""}${isEmoji ? " is-emoji" : ""}` });
    if (config?.color) host.addClass(`db-num-color-${config.color}`);
    const renderStars = () => {
      host.empty();
      const value = typeof this.getValue(field) === "number" ? Number(this.getValue(field)) : 0;
      const slots = buildRatingSlots(value, max);
      for (let index = 1; index <= max; index += 1) {
        const star = host.createSpan({ cls: "db-form-rating-star", attr: { role: "button", tabindex: "0", "aria-label": `${index}/${max}`, "aria-pressed": String(value >= index) } });
        const bg = star.createSpan({ cls: "db-form-rating-star-bg" });
        const fg = star.createSpan({ cls: "db-form-rating-star-fg" });
        fg.style.width = slots[index - 1] === "full" ? "100%" : slots[index - 1] === "half" ? "50%" : "0%";
        if (isEmoji) {
          const emoji = config?.ratingEmoji?.trim() || "⭐";
          bg.createSpan({ text: emoji });
          fg.createSpan({ text: emoji });
        } else {
          setIcon(bg, symbol);
          setIcon(fg, symbol);
        }
        star.onclick = () => {
          this.setValue(field, index === value ? undefined : index);
          this.updateValueHint(field);
          renderStars();
        };
        star.onkeydown = (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          star.click();
          host.querySelectorAll<HTMLElement>(".db-form-rating-star")[index - 1]?.focus();
        };
      }
    };
    renderStars();
  }

  private renderProgressControl(control: HTMLElement, field: FormFieldPlan, isRing: boolean): void {
    const config = field.col.numberDisplayConfig;
    const max = config?.progressDivisor && config.progressDivisor > 0 ? config.progressDivisor : 100;
    const row = control.createDiv({ cls: `db-form-progress-control${isRing ? " is-ring" : " is-bar"}` });
    if (config?.color) row.addClass(`db-num-color-${config.color}`);
    const graphic = row.createDiv({ cls: isRing ? "db-form-progress-ring" : "db-form-progress-track", attr: { role: "slider", tabindex: "0", "aria-label": field.col.label || field.col.key, "aria-valuemin": "0", "aria-valuemax": String(max) } });
    let fill: HTMLElement | null = null;
    let arc: SVGCircleElement | null = null;
    if (isRing) {
      const svg = graphic.createSvg("svg", { attr: { viewBox: "0 0 100 100", "aria-hidden": "true" } });
      svg.createSvg("circle", { attr: { cx: 50, cy: 50, r: 42, fill: "none", "stroke-width": 7 } }).addClass("db-form-progress-ring-track");
      arc = svg.createSvg("circle", { attr: { cx: 50, cy: 50, r: 42, fill: "none", "stroke-width": 7, "stroke-linecap": "round", transform: "rotate(-90 50 50)" } });
      arc.addClass("db-form-progress-ring-arc");
    } else {
      const track = graphic.createSpan({ cls: "db-form-progress-track-base" });
      fill = track.createSpan({ cls: "db-form-progress-fill" });
    }
    const number = row.createEl("input", { cls: "db-form-input db-form-progress-number", attr: { type: "number", min: "0", max: String(max), "aria-label": field.col.label || field.col.key } });
    this.disableWheelChange(number);
    const apply = (value: number | undefined) => {
      this.setValue(field, value);
      this.updateValueHint(field);
      const percent = progressFillPercent(value ?? 0, max) ?? 0;
      if (fill) fill.style.width = `${percent}%`;
      if (arc) {
        const { circumference, dashOffset } = ringGeometry(percent, 42);
        arc.setAttribute("stroke-dasharray", String(circumference));
        arc.setAttribute("stroke-dashoffset", String(dashOffset));
      }
      graphic.setAttribute("aria-valuenow", String(value ?? 0));
      number.value = value == null ? "" : String(value);
    };
    const valueFromPointer = (event: PointerEvent): number => {
      const rect = graphic.getBoundingClientRect();
      return isRing
        ? progressValueFromRingPointer(event.clientX, event.clientY, rect.left + rect.width / 2, rect.top + rect.height / 2, max)
        : progressValueFromBarPointer(event.clientX, rect.left, rect.width, max);
    };
    let dragging = false;
    graphic.onpointerdown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      graphic.setPointerCapture(event.pointerId);
      apply(valueFromPointer(event));
      event.preventDefault();
    };
    graphic.onpointermove = (event) => { if (dragging) apply(valueFromPointer(event)); };
    const finishDrag = (event: PointerEvent): void => {
      dragging = false;
      if (graphic.hasPointerCapture(event.pointerId)) graphic.releasePointerCapture(event.pointerId);
    };
    graphic.onpointerup = finishDrag;
    graphic.onpointercancel = finishDrag;
    graphic.onkeydown = (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowLeft" && event.key !== "ArrowDown" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const current = typeof this.getValue(field) === "number" ? Number(this.getValue(field)) : 0;
      apply(event.key === "Home" ? 0 : event.key === "End" ? max : Math.max(0, Math.min(max, current + (event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1))));
    };
    number.addEventListener("input", () => {
      const raw = number.value.trim();
      apply(raw === "" ? undefined : Number(raw));
    });
    const current = this.getValue(field);
    apply(typeof current === "number" && Number.isFinite(current) ? current : undefined);
  }

  private renderDateControl(control: HTMLElement, field: FormFieldPlan): void {
    const current = this.getValue(field);
    renderDateValuePicker({
      parent: control,
      value: typeof current === "string" ? current : "",
      placeholder: t(field.placeholderKey),
      includeTime: field.controlKind === "datetime",
      className: "db-form-date-field",
      onChange: (value) => this.setValue(field, value || undefined),
    });
  }

  /**
   * 单选/状态：值行与多选一致（左对齐 status-badge，无按钮壳）；点击弹出的选项面板
   * 复用单元格编辑器的 db-cell-option-popover 结构与样式（搜索 + 色点 + 选中态）。
   */
  private renderSelectControl(control: HTMLElement, field: FormFieldPlan, actions: FormRendererActions): void {
    const renderValues = (): void => {
      control.empty();
      const current = this.getValue(field);
      const row = control.createDiv({ cls: "db-form-field-value-row" });
      if (typeof current === "string" && current !== "") {
        this.renderStatusBadge(row, field.col, current);
      } else {
        row.createSpan({ cls: "db-form-select-placeholder", text: t(field.placeholderKey) });
      }
      row.onclick = () => {
        this.openOptionPopover(row, field, false, actions);
      };
    };
    renderValues();
  }

  /** 与单元格选项编辑器共用选项行、添加区和清空区；结构改动交给宿主事务。 */
  private openOptionPopover(anchor: HTMLElement, field: FormFieldPlan, multi: boolean, actions: FormRendererActions): void {
    this.closeFormPopovers();
    const portal = createFormPopoverPortal(anchor.ownerDocument);
    const popover = portal.createDiv({ cls: "db-cell-option-popover db-form-option-popover" });
    suppressClickWhileTextSelected(popover);
    const list = popover.createDiv({ cls: "db-cell-option-list" });
    const isTags = field.col.key === "file.tags";
    let optionDefs = (field.col.statusOptions || []).map((option) => ({ ...option }));
    let savingOptions = false;
    const readValues = (): string[] => {
      const value = this.getValue(field);
      return multi
        ? (Array.isArray(value) ? value.map(String) : [])
        : (typeof value === "string" && value ? [value] : []);
    };
    const rerender = (): void => {
      const row = anchor.closest<HTMLElement>(".db-form-field");
      row?.querySelector<HTMLElement>(".db-form-field-value-row")?.empty();
      this.renderFieldValueRow(row?.querySelector<HTMLElement>(".db-form-field-value-row") ?? anchor, field);
    };
    const persistOptions = async (next: StatusOptionDef[], removed: string[] = []): Promise<boolean> => {
      if (savingOptions) return false;
      const before = (field.col.statusOptions || []).map((option) => ({ ...option }));
      savingOptions = true;
      try {
        if (!actions.updateOptions || !await actions.updateOptions(field.col, before, next, removed)) return false;
        optionDefs = next.map((option) => ({ ...option }));
        field.col.statusOptions = optionDefs.map((option) => ({ ...option }));
        field.col.statusPresetId = undefined;
        renderList();
        rerender();
        return true;
      } catch (error) {
        new Notice(t("errors.updateFailed", { error: String(error) }));
        return false;
      } finally {
        savingOptions = false;
      }
    };
    const renderList = (): void => {
      list.empty();
      const selected = new Set(readValues());
      const visible = [...optionDefs];
      for (const value of selected) {
        if (!visible.some((option) => option.value === value)) visible.push({ value, color: "gray" });
      }
      for (const [index, option] of visible.entries()) {
        const value = option.value;
        const registered = index < optionDefs.length;
        const item = list.createEl("button", {
          cls: `db-cell-option-item${selected.has(value) ? " is-selected" : ""}`,
          attr: { type: "button", role: "option", "aria-selected": selected.has(value) ? "true" : "false" },
        });
        const handle = item.createSpan({ cls: "db-option-drag-handle", text: "⠿" });
        if (isTags || !registered) handle.addClass("is-hidden");
        else {
          handle.draggable = true;
          handle.ondragstart = (event) => {
            event.dataTransfer?.setData("text/plain", String(index));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          };
          item.ondragover = (event) => event.preventDefault();
          item.ondrop = (event) => {
            event.preventDefault();
            const from = Number(event.dataTransfer?.getData("text/plain"));
            if (!Number.isInteger(from) || from < 0 || from >= optionDefs.length || from === index) return;
            const next = optionDefs.map((candidate) => ({ ...candidate }));
            const [moved] = next.splice(from, 1);
            next.splice(index, 0, moved);
            void persistOptions(next);
          };
        }
        if (registered && !isTags && actions.updateOptions) {
          renderMobileOptionMoveControls(item, index, optionDefs.length, (target) => {
            const next = optionDefs.map((candidate) => ({ ...candidate }));
            const [moved] = next.splice(index, 1);
            next.splice(target, 0, moved);
            void persistOptions(next);
          });
        }
        const dot = item.createSpan({ cls: `db-option-color-dot db-option-color-${option.color || "gray"}` });
        if (registered && !isTags) dot.onclick = (event) => {
          event.stopPropagation();
          openOptionColorPicker(dot, option.color || "gray", (color) => {
            const next = optionDefs.map((candidate) => ({ ...candidate }));
            next[index].color = color;
            void persistOptions(next);
          });
        };
        item.createSpan({ cls: "db-option-label", text: value });
        item.createSpan({ cls: "db-option-check", text: selected.has(value) ? "✓" : "" });
        if (!isTags && registered) {
          const remove = item.createEl("button", { cls: "db-option-delete", attr: { type: "button", "aria-label": t("common.delete") } });
          setIcon(remove, "trash");
          remove.onclick = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!await confirmWithModal(actions.app, {
              title: t("common.delete"),
              message: t("modal.confirmDeleteOption", { name: value }),
              confirmText: t("common.delete"),
              danger: true,
            })) return;
            const next = optionDefs.filter((candidate) => candidate.value !== value);
            const previousValue = this.getValue(field);
            if (selected.has(value)) this.setValue(field, multi ? readValues().filter((entry) => entry !== value) : undefined);
            if (!await persistOptions(next, [value])) this.setValue(field, previousValue);
            renderList();
            rerender();
          };
        }
        item.onclick = () => {
          if (multi) {
            const next = new Set(readValues());
            if (next.has(value)) next.delete(value);
            else next.add(value);
            this.setValue(field, Array.from(next));
          } else {
            const current = readValues()[0];
            this.setValue(field, value === current ? undefined : value);
          }
          renderList();
          rerender();
          if (!multi) close();
        };
      }
      if (visible.length === 0) {
        list.createDiv({ cls: "db-panel-empty", text: t("common.empty") });
      }
    };
    const addRow = popover.createDiv({ cls: "db-cell-option-add" });
    const addInput = addRow.createEl("input", { attr: { type: "text", placeholder: t("cell.addOption") } });
    addInput.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (isTags) {
        const invalid = getInvalidObsidianTagValues([addInput.value]);
        if (invalid.length > 0) {
          new Notice(t("fileField.invalidTag", { tag: invalid[0] }));
          return;
        }
      }
      const value = isTags
        ? normalizeValidObsidianTagValue(addInput.value)
        : normalizeOptionValueForKey(field.col.key, addInput.value);
      if (!value) return;
      const finish = () => {
        this.setValue(field, multi ? Array.from(new Set([...readValues(), value])) : value);
        addInput.value = "";
        renderList();
        rerender();
        if (!multi) close();
      };
      if (isTags || optionDefs.some((option) => option.value === value)) {
        finish();
        return;
      }
      const next = [...optionDefs, { value, color: OPTION_REGISTRATION_COLORS[optionDefs.length % OPTION_REGISTRATION_COLORS.length] }];
      const previousValue = this.getValue(field);
      this.setValue(field, multi ? Array.from(new Set([...readValues(), value])) : value);
      rerender();
      void persistOptions(next).then((saved) => {
        if (saved) {
          addInput.value = "";
          if (!multi) close();
        } else {
          this.setValue(field, previousValue);
          rerender();
        }
      });
    };
    const footer = popover.createDiv({ cls: "db-panel-header-actions" });
    const clear = footer.createEl("button", { cls: "db-panel-button", text: t("cell.clear"), attr: { type: "button" } });
    clear.onclick = () => {
      this.setValue(field, multi ? [] : undefined);
      renderList();
      rerender();
    };
    renderList();
    positionToolbarPopover(popover, anchor, { align: "left", minWidth: 240, preferredWidth: 380, maxWidth: 380 });
    const removeAutoClose = installPopoverAutoClose({
      panel: popover,
      anchorEl: anchor,
      close: () => close(),
      closeOnOutsidePointerDown: true,
      closeOnEscape: true,
      isActiveTarget: (target) => target instanceof Element && Boolean(target.closest(".db-color-picker-popup")),
    });
    const close = () => {
      closeActiveOptionColorPicker(anchor.ownerDocument);
      removeAutoClose();
      portal.remove();
    };
    this.closeables.push(close);
  }

  /** 值行渲染（单选/多选共用：左对齐 badges；空值占位）。 */
  private renderFieldValueRow(row: HTMLElement, field: FormFieldPlan): void {
    const value = this.getValue(field);
    const values = Array.isArray(value) ? value.map(String) : (typeof value === "string" && value ? [value] : []);
    if (values.length === 0) {
      row.createSpan({ cls: "db-form-select-placeholder", text: t(field.placeholderKey) });
      return;
    }
    for (const item of values) {
      this.renderStatusBadge(row, field.col, item);
    }
  }

  private renderCheckboxControl(control: HTMLElement, field: FormFieldPlan): void {
    const input = control.createEl("input", { cls: "db-toggle-switch", attr: { type: "checkbox", role: "switch" } });
    input.checked = this.getValue(field) === true;
    input.addEventListener("change", () => this.setValue(field, input.checked ? true : undefined));
  }

  /** 多选（multi-select / file.tags）：值行复用 status-badge；编辑走共用选项弹层。 */
  private renderMultiselectControl(control: HTMLElement, field: FormFieldPlan, actions: FormRendererActions): void {
    const renderValues = (): void => {
      control.empty();
      const row = control.createDiv({ cls: "db-form-field-value-row" });
      this.renderFieldValueRow(row, field);
      row.onclick = () => {
        this.openOptionPopover(row, field, true, actions);
      };
    };
    renderValues();
  }

  /** relation：值区复用 renderRelationValue；编辑走目标库记录多选弹层（同单元格样式）。 */
  private renderRelationControl(control: HTMLElement, field: FormFieldPlan, actions: FormRendererActions): void {
    const chips = control.createDiv({ cls: "db-form-chips" });
    const readValues = (): string[] => {
      const value = this.getValue(field);
      return Array.isArray(value) ? value.map(String) : [];
    };
    const records = actions.getRelationRecords(field.col);
    const renderChips = () => {
      chips.empty();
      // 已选展示复用 renderRelationValue（圆角链接 + file/warning icon + valid/missing
      // 状态），增删操作走点击值行的弹层面板。
      const selected = readValues();
      if (selected.length === 0) {
        chips.createSpan({ cls: "db-form-select-placeholder", text: t(field.placeholderKey) });
        return;
      }
      {
        const pseudoRow = { file: { path: actions.getSourcePath() } } as unknown as RowData;
        const wikilinks = selected.map((path) => `[[${path.replace(/\.md$/i, "")}]]`);
        const scopePaths = new Set(records.map((record) => record.file.path));
        if (!renderRelationValue(chips, actions.app, pseudoRow, wikilinks, true, { scopePaths })) {
          chips.empty();
        }
      }
    };
    const openPanel = (anchor: HTMLElement) => {
      this.closeFormPopovers();
      const selectedDraft = new Set(readValues());
      const portal = createFormPopoverPortal(anchor.ownerDocument);
      const panel = portal.createDiv({ cls: "db-cell-option-popover db-relation-popover db-form-relation-popover" });
      suppressClickWhileTextSelected(panel);
      const header = panel.createDiv({ cls: "db-relation-popover-header" });
      header.createDiv({ cls: "db-relation-popover-title", text: field.col.label || field.col.key });
      const search = header.createEl("input", {
        cls: "db-cell-option-search",
        attr: { type: "search", placeholder: t("relation.search") },
      });
      const list = panel.createDiv({ cls: "db-cell-option-list db-relation-option-list" });
      const footer = panel.createDiv({ cls: "db-relation-popover-footer" });
      const count = footer.createSpan({ cls: "db-relation-selected-count" });
      const clear = footer.createEl("button", { cls: "db-relation-clear", text: t("common.clear"), attr: { type: "button" } });
      const actionsEl = footer.createDiv({ cls: "db-relation-footer-actions" });
      const save = actionsEl.createEl("button", { cls: "mod-cta db-relation-footer-button", text: t("common.save"), attr: { type: "button" } });
      const renderList = () => {
        list.empty();
        const query = search.value.trim().toLowerCase();
        for (const record of records) {
          if (query && !record.file.basename.toLowerCase().includes(query)) continue;
          const row = list.createEl("button", { cls: `db-cell-option-item db-relation-option-item${selectedDraft.has(record.file.path) ? " is-selected" : ""}`, attr: { type: "button" } });
          renderRecordIcon(row, undefined, { compact: true, defaultIcon: "file-text" }).addClass("db-relation-option-icon");
          row.createSpan({ cls: "db-dropdown-option-label", text: record.file.basename });
          const check = row.createSpan({ cls: "db-option-check db-relation-option-check" });
          if (selectedDraft.has(record.file.path)) setIcon(check, "check");
          row.onclick = () => {
            if (selectedDraft.has(record.file.path)) selectedDraft.delete(record.file.path);
            else selectedDraft.add(record.file.path);
            renderList();
          };
        }
        count.textContent = t("relation.selectedCount", { count: selectedDraft.size });
      };
      search.addEventListener("input", renderList);
      renderList();
      positionToolbarPopover(panel, anchor, { align: "left", minWidth: 260, preferredWidth: 440, maxWidth: 440 });
      const removeAutoClose = installPopoverAutoClose({ panel, anchorEl: anchor, close: () => close(), closeOnOutsidePointerDown: true, closeOnEscape: true });
      const close = () => {
        removeAutoClose();
        portal.remove();
      };
      clear.onclick = () => {
        selectedDraft.clear();
        renderList();
      };
      save.onclick = () => {
        this.setValue(field, Array.from(selectedDraft));
        renderChips();
        this.refreshRollupPreviews(actions);
        close();
      };
      this.closeables.push(close);
    };
    chips.addClass("db-form-field-value-row");
    chips.onclick = () => openPanel(chips);
    renderChips();
  }

  /**
   * rollup 实时预览：按当前 relation 选中（编辑期存文件路径）对目标记录的
   * targetField 聚合（count/sum/avg/list）；无选中时回落「提交后自动计算」占位。
   */
  private refreshRollupPreviews(actions: FormRendererActions): void {
    for (const field of this.plan.fields) {
      if (field.availability !== "readonly" || field.col.type !== "rollup") continue;
      const el = this.rollupEls.get(field.col.key);
      if (!el) continue;
      const rollup = field.col.rollupConfig;
      const relationField = this.plan.fields.find(
        (candidate) => candidate.col.key === rollup?.relationField && candidate.controlKind === "relation"
      );
      if (!rollup || !relationField) continue;
      const selected = Array.isArray(this.getValue(relationField)) ? (this.getValue(relationField) as string[]) : [];
      const records = actions.getRelationRecords(relationField.col)
        .filter((record) => selected.includes(record.file.path));
      el.textContent = this.summarizeRollup(records, rollup.targetField, rollup.aggregation);
    }
  }

  private summarizeRollup(records: NoteRecord[], targetField: string, aggregation: "count" | "sum" | "avg" | "list"): string {
    if (records.length === 0) return t("form.rollupPlaceholder");
    if (aggregation === "count") return String(records.length);
    const values = records.map((record) => record.frontmatter[targetField]).filter((value) => value != null && value !== "");
    if (aggregation === "list") return values.map((value) => String(value)).join(", ");
    const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (numbers.length === 0) return t("form.rollupPlaceholder");
    if (aggregation === "sum") return String(numbers.reduce((acc, value) => acc + value, 0));
    const avg = numbers.reduce((acc, value) => acc + value, 0) / numbers.length;
    return String(Math.round(avg * 100) / 100);
  }

  private renderActions(form: HTMLElement): void {
    const bar = form.createDiv({ cls: "db-form-actions" });
    const clearBtn = bar.createEl("button", { cls: "db-form-action db-form-secondary", text: t("form.clear"), attr: { type: "button" } });
    const submitAndClose = this.context?.options.keepOpenAfterSubmit === "close"
      ? bar.createEl("button", { cls: "db-form-action", text: t("form.submitAndClose"), attr: { type: "button" } })
      : null;
    const submitBtn = bar.createEl("button", { cls: "db-form-action db-form-submit mod-cta", text: t("form.submit"), attr: { type: "button" } });

    const submit = async (closeAfter: boolean): Promise<void> => {
      const context = this.context;
      if (!context || this.submitting) return;
      this.showErrors = true;
      this.refreshErrorStates();
      this.submitting = true;
      clearBtn.disabled = true;
      submitBtn.disabled = true;
      if (submitAndClose) submitAndClose.disabled = true;
      try {
        const input = buildFormCreateInput(Object.fromEntries(this.values), this.plan);
        const created = await context.actions.submitForm(input);
        if (created) {
          if (closeAfter) {
            this.values.clear();
            if (this.draftKey) FormRenderer.drafts.delete(this.draftKey);
            context.options.onSubmitted?.();
            return;
          }
          this.reset();
          return;
        }
        // 创建失败或被闸门拦截——保留输入，Notice 已由宿主发出。
      } finally {
        this.submitting = false;
        clearBtn.disabled = false;
        submitBtn.disabled = false;
        if (submitAndClose) submitAndClose.disabled = false;
      }
    };

    clearBtn.onclick = () => this.reset();
    submitBtn.onclick = () => { void submit(false); };
    if (submitAndClose) submitAndClose.onclick = () => { void submit(true); };
  }
}
