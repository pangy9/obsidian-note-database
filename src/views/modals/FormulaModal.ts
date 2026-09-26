import { App, Modal, Notice, setIcon } from "obsidian";
import { makeModalDraggable, suppressClickWhileTextSelected } from "./ModalDrag";
import { evaluateBaseExpression } from "../../data/BaseExpression";
import { isImeComposing } from "../../data/KeyboardUtils";
import { COLUMN_TYPE_LABELS, getColumnOptions, isOptionColumnType, toMultiSelectValuesForKey } from "../../data/ColumnTypes";
import { ComputedFieldEngine } from "../../data/ComputedField";
import { FORMULA_FILE_FIELDS } from "../../data/FormulaFields";
import { getFileFieldValue } from "../../data/FileFieldObsidian";
import { getComputedStorageKey } from "../../data/ColumnDisplay";
import { ColumnDef, ComputedFieldDef, ComputedSyncMode, RowData, StatusOptionDef } from "../../data/types";
import { getEffectiveLocale, t } from "../../i18n";
import { getPropertyDropdownIcon, renderDropdownPropertyTypeIcon, renderPropertyTypeIcon } from "../PropertyTypeIcon";
import { createDropdownField } from "../DropdownField";
import { confirmWithModal } from "./ConfirmModal";
import { safeString } from "../../data/SafeString";
import { isDateLikeColumnType } from "../../data/DateTimeFormat";
import { scanFormulaSegments, type FormulaSegment } from "../../data/FormulaTokenizer";

export interface FormulaSaveResult {
  expression: string;
  resultType: ComputedFieldDef["type"];
  expressionSyntax?: ComputedFieldDef["expressionSyntax"];
}

interface FormulaFunctionHelp {
  categoryKey: string;
  name: string;
  signature: string;
  descriptionKey: string;
  example: string;
}

interface FormulaExampleHelp {
  name: string;
  description: string;
  expression: string;
}

type FormulaHelpItem =
  | { kind: "field"; col: ColumnDef }
  | { kind: "function"; fn: FormulaFunctionHelp }
  | { kind: "example"; example: FormulaExampleHelp };

interface FormulaValidationState {
  valid: boolean;
  empty: boolean;
  message: string;
  output: string;
  severity: "ok" | "error" | "warning" | "muted";
}

interface FormulaReferencedField {
  col: ColumnDef;
  ref: string;
  source: "bracket" | "direct" | "field-call" | "member";
  object?: string;
  syntax: string;
  value: unknown;
}

const FUNCTIONS: FormulaFunctionHelp[] = [
  { categoryKey: "formula.catLogic", name: "IF", signature: "IF(condition, trueValue, falseValue)", descriptionKey: "formula.fn.IF.desc", example: '=IF([status] === "done", 1, 0)' },
  { categoryKey: "formula.catLogic", name: "IFERROR", signature: "IFERROR(value, fallback)", descriptionKey: "formula.fn.IFERROR.desc", example: "=IFERROR([price] / [days], 0)" },
  { categoryKey: "formula.catDate", name: "DAYS", signature: "DAYS(start_date, end_date)", descriptionKey: "formula.fn.DAYS.desc", example: "=DAYS([start_date], [end_date])" },
  { categoryKey: "formula.catDate", name: "ADDDAYS", signature: "ADDDAYS(date, days)", descriptionKey: "formula.fn.ADDDAYS.desc", example: "=ADDDAYS([start_date], [duration])" },
  { categoryKey: "formula.catText", name: "TEXT", signature: "TEXT(value, format)", descriptionKey: "formula.fn.TEXT.desc", example: '=TEXT([date], "YYYY-MM-DD")' },
  { categoryKey: "formula.catMath", name: "ROUND", signature: "ROUND(number, digits)", descriptionKey: "formula.fn.ROUND.desc", example: "=ROUND([price] / [days], 2)" },
  { categoryKey: "formula.catLogic", name: "AND", signature: "AND(condition1, condition2, ...)", descriptionKey: "formula.fn.AND.desc", example: '=AND([status] === "done", [price] > 0)' },
  { categoryKey: "formula.catLogic", name: "OR", signature: "OR(condition1, condition2, ...)", descriptionKey: "formula.fn.OR.desc", example: '=OR([status] === "active", [status] === "done")' },
  { categoryKey: "formula.catMath", name: "SUM", signature: "SUM(number1, number2, ...)", descriptionKey: "formula.fn.SUM.desc", example: "=SUM([price], [fee])" },
  { categoryKey: "formula.catMath", name: "AVERAGE", signature: "AVERAGE(number1, number2, ...)", descriptionKey: "formula.fn.AVERAGE.desc", example: "=AVERAGE([daily_cost], [target_daily_cost])" },
  { categoryKey: "formula.catMath", name: "MIN", signature: "MIN(number1, number2, ...)", descriptionKey: "formula.fn.MIN.desc", example: "=MIN([daily_cost], [target_daily_cost])" },
  { categoryKey: "formula.catMath", name: "MAX", signature: "MAX(number1, number2, ...)", descriptionKey: "formula.fn.MAX.desc", example: "=MAX([daily_cost], [target_daily_cost])" },
  { categoryKey: "formula.catMath", name: "ABS", signature: "ABS(number)", descriptionKey: "formula.fn.ABS.desc", example: "=ABS([balance])" },
  { categoryKey: "formula.catMath", name: "MOD", signature: "MOD(number, divisor)", descriptionKey: "formula.fn.MOD.desc", example: "=MOD([days], 30)" },
  { categoryKey: "formula.catMath", name: "POWER", signature: "POWER(number, power)", descriptionKey: "formula.fn.POWER.desc", example: "=POWER([score], 2)" },
  { categoryKey: "formula.catMath", name: "ROUNDUP", signature: "ROUNDUP(number, digits)", descriptionKey: "formula.fn.ROUNDUP.desc", example: "=ROUNDUP([price] / [days], 2)" },
  { categoryKey: "formula.catMath", name: "ROUNDDOWN", signature: "ROUNDDOWN(number, digits)", descriptionKey: "formula.fn.ROUNDDOWN.desc", example: "=ROUNDDOWN([price] / [days], 2)" },
  { categoryKey: "formula.catText", name: "CONCAT", signature: "CONCAT(text1, text2, ...)", descriptionKey: "formula.fn.CONCAT.desc", example: '=CONCAT([category], " / ", [status])' },
  { categoryKey: "formula.catText", name: "TEXTJOIN", signature: "TEXTJOIN(delimiter, ignoreEmpty, text1, ...)", descriptionKey: "formula.fn.TEXTJOIN.desc", example: '=TEXTJOIN(" / ", true, [category], [status])' },
  { categoryKey: "formula.catText", name: "LEN", signature: "LEN(text)", descriptionKey: "formula.fn.LEN.desc", example: "=LEN([title])" },
  { categoryKey: "formula.catText", name: "LEFT", signature: "LEFT(text, count)", descriptionKey: "formula.fn.LEFT.desc", example: "=LEFT([title], 4)" },
  { categoryKey: "formula.catText", name: "RIGHT", signature: "RIGHT(text, count)", descriptionKey: "formula.fn.RIGHT.desc", example: "=RIGHT([title], 4)" },
  { categoryKey: "formula.catText", name: "MID", signature: "MID(text, start, count)", descriptionKey: "formula.fn.MID.desc", example: "=MID([title], 2, 4)" },
  { categoryKey: "formula.catText", name: "TRIM", signature: "TRIM(text)", descriptionKey: "formula.fn.TRIM.desc", example: "=TRIM([note])" },
  { categoryKey: "formula.catText", name: "UPPER", signature: "UPPER(text)", descriptionKey: "formula.fn.UPPER.desc", example: "=UPPER([title])" },
  { categoryKey: "formula.catText", name: "LOWER", signature: "LOWER(text)", descriptionKey: "formula.fn.LOWER.desc", example: "=LOWER([title])" },
  { categoryKey: "formula.catText", name: "CONTAINS", signature: "CONTAINS(text, keyword)", descriptionKey: "formula.fn.CONTAINS.desc", example: '=CONTAINS([title], "important")' },
  { categoryKey: "formula.catDate", name: "TODAY", signature: "TODAY()", descriptionKey: "formula.fn.TODAY.desc", example: "=TODAY()" },
  { categoryKey: "formula.catDate", name: "NOW", signature: "NOW()", descriptionKey: "formula.fn.NOW.desc", example: "=NOW()" },
  { categoryKey: "formula.catDate", name: "YEAR", signature: "YEAR(date)", descriptionKey: "formula.fn.YEAR.desc", example: "=YEAR([date])" },
  { categoryKey: "formula.catDate", name: "MONTH", signature: "MONTH(date)", descriptionKey: "formula.fn.MONTH.desc", example: "=MONTH([date])" },
  { categoryKey: "formula.catDate", name: "DATE", signature: "DATE(year, month, day)", descriptionKey: "formula.fn.DATE.desc", example: "=DATE([year], [month], 1)" },
  { categoryKey: "formula.catDate", name: "EOMONTH", signature: "EOMONTH(date, months)", descriptionKey: "formula.fn.EOMONTH.desc", example: "=EOMONTH([date], 12)" },
  { categoryKey: "formula.catDate", name: "DATEADD", signature: 'DATEADD(date, amount, "days")', descriptionKey: "formula.fn.DATEADD.desc", example: '=DATEADD([date], 14, "days")' },
  { categoryKey: "formula.catDate", name: "WEEKDAY", signature: "WEEKDAY(date, [return_type])", descriptionKey: "formula.fn.WEEKDAY.desc", example: "=WEEKDAY([date], 2)" },
  { categoryKey: "formula.catDate", name: "WEEKNUM", signature: "WEEKNUM(date)", descriptionKey: "formula.fn.WEEKNUM.desc", example: "=WEEKNUM([date])" },
  { categoryKey: "formula.catDate", name: "NETWORKDAYS", signature: "NETWORKDAYS(start, end, [holidays...])", descriptionKey: "formula.fn.NETWORKDAYS.desc", example: "=NETWORKDAYS([start], [due])" },
  { categoryKey: "formula.catDate", name: "HOUR", signature: "HOUR(datetime)", descriptionKey: "formula.fn.HOUR.desc", example: "=HOUR([datetime])" },
  { categoryKey: "formula.catDate", name: "MINUTE", signature: "MINUTE(datetime)", descriptionKey: "formula.fn.MINUTE.desc", example: "=MINUTE([datetime])" },
  { categoryKey: "formula.catDate", name: "SECOND", signature: "SECOND(datetime)", descriptionKey: "formula.fn.SECOND.desc", example: "=SECOND([datetime])" },
  { categoryKey: "formula.catDate", name: "TIME", signature: "TIME(hour, minute, second)", descriptionKey: "formula.fn.TIME.desc", example: "=TIME(14, 30, 0)" },
  { categoryKey: "formula.catStats", name: "COUNT", signature: "COUNT(value1, value2, ...)", descriptionKey: "formula.fn.COUNT.desc", example: "=COUNT([price], [fee])" },
  { categoryKey: "formula.catStats", name: "COUNTA", signature: "COUNTA(value1, value2, ...)", descriptionKey: "formula.fn.COUNTA.desc", example: "=COUNTA([title], [status])" },
  { categoryKey: "formula.catStats", name: "COUNTIF", signature: "COUNTIF(value_or_list, criterion)", descriptionKey: "formula.fn.COUNTIF.desc", example: '=COUNTIF([status], "done")' },
];

const RESULT_TYPE_KEYS: Array<[ComputedFieldDef["type"], string]> = [["number", "formula.typeNumber"], ["text", "formula.typeText"], ["date", "formula.typeDate"], ["datetime", "formula.typeDatetime"], ["checkbox", "formula.typeCheckbox"]];
const FUNCTION_CATEGORY_KEYS = ["formula.catLogic", "formula.catMath", "formula.catText", "formula.catDate", "formula.catStats"];
const HELP_CATEGORY_KEYS = ["formula.catFields", "formula.catExamples", ...FUNCTION_CATEGORY_KEYS];
const FUNCTION_NAMES = new Set(FUNCTIONS.flatMap((fn) => [fn.name, fn.name.toLowerCase()]));

export class FormulaModal extends Modal {
  private selectedCategoryKey = "formula.catFields";
  private selectedHelpItem: FormulaHelpItem | null = null;
  private searchQuery = "";
  private textarea?: HTMLTextAreaElement;
  private highlightEl?: HTMLElement;
  private lineNumberEl?: HTMLElement;
  private previewOutput?: HTMLElement;
  private previewStatus?: HTMLElement;
  private previewDetails?: HTMLElement;
  private propertySuggestEl?: HTMLElement;
  private suggestionIndex = -1;
  private categoryListEl?: HTMLElement;
  private helpListEl?: HTMLElement;
  private helpDetailEl?: HTMLElement;
  private saveBtn?: HTMLButtonElement;
  private matchedBracketIndexes = new Set<number>();
  private originalExpression = "";
  private originalResultType: ComputedFieldDef["type"] = "text";
  private selectedResultType: ComputedFieldDef["type"] = "text";
  private selectedPreviewIndex = 0;
  private expressionSyntax: ComputedFieldDef["expressionSyntax"] = "note-database";
  private saved = false;
  private resizeObserver?: ResizeObserver;
  private closeConfirmed = false;
  private closeConfirmationPending = false;

  constructor(
    app: App,
    private col: ColumnDef,
    private computedField: ComputedFieldDef | undefined,
    private rows: RowData[],
    private columns: ColumnDef[],
    private computedSyncMode: ComputedSyncMode,
    private onSave: (result: FormulaSaveResult) => Promise<void | boolean>,
    private baseThisFile?: RowData["file"],
    private baseThisFrontmatter?: Record<string, unknown>,
    private initialResultType?: ComputedFieldDef["type"],
    private initialPreviewRowPath?: string,
    private onClosed?: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("formula-workbench-modal-host");
    this.contentEl.addClass("note-database-modal");
    this.contentEl.addClass("formula-workbench-modal");
    this.originalExpression = this.computedField?.expression || "";
    this.originalResultType = this.computedField?.type || "text";
    this.selectedResultType = this.initialResultType || this.originalResultType;
    const initialPreviewIndex = this.initialPreviewRowPath
      ? this.rows.findIndex((row) => row.file.path === this.initialPreviewRowPath)
      : -1;
    this.selectedPreviewIndex = initialPreviewIndex >= 0 ? initialPreviewIndex : 0;
    this.expressionSyntax = this.computedField?.expressionSyntax || "note-database";

    this.renderHeader();

    const workbench = this.contentEl.createDiv({ cls: "db-formula-workbench" });
    const editorPane = workbench.createDiv({ cls: "db-formula-editor-pane" });
    const helpPane = workbench.createDiv({ cls: "db-formula-help-pane" });

    this.renderEditor(editorPane);
    this.renderPreview(editorPane);
    this.renderHelpBrowser(helpPane);
    this.renderButtons();

    this.updateEditorChrome();
    this.updatePreview();
    this.setupResponsiveLayout();
  }

  private setupResponsiveLayout(): void {
    const update = () => {
      const width = this.modalEl.getBoundingClientRect().width || this.contentEl.getBoundingClientRect().width;
      this.contentEl.toggleClass("is-formula-compact", width > 0 && width < 1040);
      this.contentEl.toggleClass("is-formula-narrow", width > 0 && width < 760);
      // 跨过窄/宽阈值时：可见的联想框在停靠式与光标跟随式之间切换定位，而不是直接藏掉。
      if (this.propertySuggestEl?.hasClass("is-visible")) this.applySuggestionPosition();
    };
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(update);
    this.resizeObserver.observe(this.modalEl);
    update();
  }

  private renderHeader(): void {
    const header = this.contentEl.createDiv({ cls: "db-formula-header" });
    const titleWrap = header.createDiv({ cls: "db-formula-title-wrap" });
    titleWrap.createEl("h3", { text: t("formula.title", { name: this.col.label }) });
    makeModalDraggable(this);
    titleWrap.createDiv({ cls: "db-formula-subtitle", text: this.getStorageSubtitle() });
    titleWrap.createDiv({ cls: "db-formula-storage-note", text: this.getStorageNote() });

    const typeWrap = header.createDiv({ cls: "db-formula-result-type-wrap" });
    const typeLabel = typeWrap.createEl("label", { cls: "db-formula-result-type" });
    typeLabel.createSpan({ text: t("formula.resultType") });
    createDropdownField({
      parent: typeLabel,
      label: t("formula.resultType"),
      options: RESULT_TYPE_KEYS.map(([value, labelKey]) => ({ value, text: t(labelKey), icon: getPropertyDropdownIcon(value) })),
      value: this.selectedResultType,
      className: "db-modal-dropdown db-formula-result-type-dropdown",
      hideLabel: true,
      renderIcon: renderDropdownPropertyTypeIcon,
      onChange: (value) => {
        this.selectedResultType = value as ComputedFieldDef["type"];
        this.updatePreview();
        this.renderHelpBrowserContent();
      },
    });
    typeWrap.createDiv({ cls: "db-formula-result-type-note", text: t("formula.typeCoercionHint") });
  }

  private getStorageSubtitle(): string {
    if (this.computedSyncMode === "display-only") {
      return t("formula.storage.displayOnly", { key: getComputedStorageKey(this.col) });
    }
    return t("formula.storage.savedProperty", { key: getComputedStorageKey(this.col) });
  }

  private getStorageNote(): string {
    if (this.computedSyncMode === "display-only") {
      return t("formula.storage.displayOnlyNote");
    }
    if (this.computedSyncMode === "manual") {
      return t("formula.storage.manualNote");
    }
    return t("formula.storage.automaticNote");
  }

  private renderEditor(parent: HTMLElement): void {
    parent.createDiv({ cls: "db-formula-section-title", text: t("formula.sectionTitle") });
    const shell = parent.createDiv({ cls: "db-formula-editor-shell" });
    this.lineNumberEl = shell.createDiv({ cls: "db-formula-line-numbers", attr: { "aria-hidden": "true" } });

    const codeWrap = shell.createDiv({ cls: "db-formula-code-wrap" });
    const pre = codeWrap.createEl("pre", { cls: "db-formula-highlight", attr: { "aria-hidden": "true" } });
    this.highlightEl = pre.createEl("code");
    this.textarea = codeWrap.createEl("textarea", {
      cls: "db-formula-textarea",
      attr: {
        placeholder: '=if([status] === "done", 1, 0)',
        rows: "9",
        autocapitalize: "off",
        autocomplete: "off",
        autocorrect: "off",
        spellcheck: "false",
        wrap: "off",
      },
    });
    this.textarea.spellcheck = false;
    this.textarea.value = this.originalExpression;
    this.propertySuggestEl = codeWrap.createDiv({ cls: "db-formula-property-suggestions" });
    // 保焦点但不禁选：默认阻止 mousedown 会同时阻止文字选择（无法复制）。
    // 改为 mousedown 放行（选择可启动），pointerup 时若未产生选区则把焦点还给编辑器；
    // 纯点击选项（onclick 插入后关闭）不受影响。
    // 拖选文字结束后的 click 不应插入选项（click 守卫；纯点击照常）。
    suppressClickWhileTextSelected(this.propertySuggestEl);
    this.propertySuggestEl.addEventListener("pointerup", () => {
      const selection = this.propertySuggestEl?.ownerDocument.getSelection();
      if (!selection || selection.isCollapsed) this.textarea?.focus();
    });

    this.textarea.addEventListener("input", () => {
      this.updateEditorChrome();
      this.updatePreview();
      this.updateSuggestions();
    });
    this.textarea.addEventListener("scroll", () => this.syncEditorScroll());
    this.textarea.addEventListener("keyup", (event) => {
      this.updateMatchedBrackets();
      if (["Tab", "ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
      this.updateSuggestions();
    });
    this.textarea.addEventListener("click", () => {
      this.updateMatchedBrackets();
      this.updateSuggestions();
    });
    this.textarea.addEventListener("keydown", (event) => {
      if (isImeComposing(event)) return;
      const mod = event.metaKey || event.ctrlKey;

      // Autocomplete keyboard navigation
      if (this.propertySuggestEl?.hasClass("is-visible")) {
        const items = Array.from(
          this.propertySuggestEl.querySelectorAll<HTMLButtonElement>("button.db-formula-property-suggestion")
        );
        if (items.length === 0) {
          this.hideSuggestions();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          this.suggestionIndex = Math.min(this.suggestionIndex + 1, items.length - 1);
          this.highlightSuggestion(items);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          this.suggestionIndex = Math.max(this.suggestionIndex - 1, 0);
          this.highlightSuggestion(items);
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const step = event.shiftKey ? -1 : 1;
          this.suggestionIndex = (this.suggestionIndex + step + items.length) % items.length;
          this.highlightSuggestion(items);
          return;
        }
        if (event.key === "Enter" && this.suggestionIndex >= 0 && items[this.suggestionIndex]) {
          event.preventDefault();
          items[this.suggestionIndex].click();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          this.hideSuggestions();
          return;
        }
      }

      // Cmd/Ctrl+S or Cmd/Ctrl+Enter → save
      if (mod && (event.key === "s" || event.key === "Enter")) {
        event.preventDefault();
        this.saveBtn?.click();
        return;
      }
      // Escape → close (unsaved confirmation handled in onClose)
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      // Cmd/Ctrl+Space → manual trigger autocomplete
      if (mod && event.key === " ") {
        event.preventDefault();
        this.updateSuggestions();
        return;
      }
      // Tab → insert indent
      if (event.key === "Tab") {
        event.preventDefault();
        this.replaceRange(this.textarea!.selectionStart, this.textarea!.selectionEnd, "  ");
      }
    });

    const referenceNote = parent.createDiv({ cls: "db-formula-reference-note" });
    setIcon(referenceNote.createSpan({ cls: "db-formula-reference-note-icon" }), "brackets");
    const referenceText = referenceNote.createDiv({ cls: "db-formula-reference-note-text" });
    referenceText.createDiv({
      cls: "db-formula-reference-note-main",
      text: t(this.expressionSyntax === "base" ? "formula.referenceNoteBase" : "formula.referenceNote"),
    });
    referenceText.createDiv({
      cls: "db-formula-reference-note-secondary",
      text: t(this.expressionSyntax === "base" ? "formula.referenceNoteBaseAdvanced" : "formula.referenceNoteAdvanced"),
    });
    const fallbackHint = parent.createDiv({ cls: "db-formula-iferror-hint" });
    setIcon(fallbackHint.createSpan({ cls: "db-formula-iferror-hint-icon" }), "circle-alert");
    fallbackHint.createSpan({ text: t("formula.ifErrorFallbackHint") });
  }

  private renderPreview(parent: HTMLElement): void {
    const preview = parent.createDiv({ cls: "db-formula-preview" });
    const row = preview.createDiv({ cls: "db-formula-preview-row" });
    row.createSpan({ cls: "db-formula-preview-label", text: t("formula.previewItem") });
    if (!this.rows[this.selectedPreviewIndex]) this.selectedPreviewIndex = 0;
    const previewRowIndexes = this.rows.slice(0, 80).map((_, index) => index);
    if (this.rows[this.selectedPreviewIndex] && !previewRowIndexes.includes(this.selectedPreviewIndex)) {
      previewRowIndexes.push(this.selectedPreviewIndex);
    }
    if (previewRowIndexes.length === 0) {
      createDropdownField({
        parent: row,
        label: t("formula.previewItem"),
        options: [{ value: "0", text: t("formula.noPreviewItems") }],
        value: "0",
        className: "db-modal-dropdown db-formula-preview-dropdown",
        hideLabel: true,
        disabled: true,
        onChange: () => undefined,
      });
    } else {
      createDropdownField({
        parent: row,
        label: t("formula.previewItem"),
        options: previewRowIndexes.map((index) => ({
          value: String(index),
          text: this.rows[index].file.name.replace(/\.md$/, ""),
        })),
        value: String(this.selectedPreviewIndex),
        className: "db-modal-dropdown db-formula-preview-dropdown",
        hideLabel: true,
        onChange: (value) => {
          this.selectedPreviewIndex = Number(value) || 0;
          this.updatePreview();
        },
      });
    }

    const result = preview.createDiv({ cls: "db-formula-result-card" });
    result.createSpan({ cls: "db-formula-preview-label", text: t("formula.calcResult") });
    this.previewOutput = result.createDiv({ cls: "db-formula-preview-output", text: t("formula.notCalculated") });
    this.previewStatus = result.createDiv({ cls: "db-formula-preview-status", text: t("formula.waitingForFormula") });
    this.previewDetails = preview.createDiv({ cls: "db-formula-preview-details" });
  }

  private renderHelpBrowser(parent: HTMLElement): void {
    parent.empty();
    const header = parent.createDiv({ cls: "db-formula-help-header" });
    const titleRow = header.createDiv({ cls: "db-formula-help-title-row" });
    titleRow.createDiv({ cls: "db-formula-section-title", text: t("formula.fieldsAndFunctions") });
    const copyBtn = titleRow.createEl("button", {
      cls: "db-formula-copy-ai-prompt",
      text: t("formula.copyAiPrompt"),
    });
    copyBtn.onclick = () => this.copyAiPrompt();
    const search = header.createEl("input", {
      cls: "db-formula-help-search",
      attr: { type: "search", placeholder: t("formula.searchPlaceholder") },
    });
    search.value = this.searchQuery;
    search.oninput = () => {
      this.searchQuery = search.value.trim();
      this.renderHelpBrowserContent();
    };

    const browser = parent.createDiv({ cls: "db-formula-browser db-formula-browser-three-col" });
    this.categoryListEl = browser.createDiv({ cls: "db-formula-category-list" });
    this.categoryListEl.addEventListener("wheel", (event) => {
      if (!this.categoryListEl) return;
      if (this.categoryListEl.scrollWidth <= this.categoryListEl.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      event.preventDefault();
      this.categoryListEl.scrollLeft += delta;
    }, { passive: false });
    this.helpListEl = browser.createDiv({ cls: "db-formula-function-list-compact" });
    this.helpDetailEl = browser.createDiv({ cls: "db-formula-function-detail" });
    this.renderHelpBrowserContent();
  }

  private renderHelpBrowserContent(): void {
    if (!this.categoryListEl || !this.helpListEl || !this.helpDetailEl) return;
    this.categoryListEl.empty();
    this.helpListEl.empty();
    this.helpDetailEl.empty();

    for (const categoryKey of HELP_CATEGORY_KEYS) {
      const button = this.categoryListEl.createEl("button", {
        cls: `db-formula-category${categoryKey === this.selectedCategoryKey && !this.searchQuery ? " is-active" : ""}`,
        text: t(categoryKey),
      });
      button.onclick = () => {
        this.searchQuery = "";
        this.selectedCategoryKey = categoryKey;
        this.selectedHelpItem = null;
        this.renderHelpBrowserContent();
      };
    }

    const items = this.getHelpItems();
    if (!this.selectedHelpItem || !items.some((item) => this.isSameHelpItem(item, this.selectedHelpItem))) {
      this.selectedHelpItem = items[0] || null;
    }

    if (items.length === 0) {
      this.helpListEl.createDiv({ cls: "db-formula-empty-help", text: t("formula.noMatch") });
      this.helpDetailEl.createDiv({ cls: "db-formula-hint", text: t("formula.noMatchHint") });
      return;
    }

    for (const item of items) {
      const button = this.helpListEl.createEl("button", {
        cls: `db-formula-function-row${this.isSameHelpItem(item, this.selectedHelpItem) ? " is-active" : ""}`,
      });
      this.renderHelpListItem(button, item);
      button.onclick = () => {
        this.selectedHelpItem = item;
        this.renderHelpBrowserContent();
      };
      button.ondblclick = () => this.insertHelpItem(item);
    }

    this.renderHelpDetail(this.selectedHelpItem);
  }

  private renderHelpListItem(button: HTMLElement, item: FormulaHelpItem): void {
    if (item.kind === "field") {
      button.addClass("db-formula-field-row");
      renderPropertyTypeIcon(button, item.col, "db-formula-field-icon");
      const text = button.createDiv({ cls: "db-formula-help-row-text" });
      text.createSpan({ text: item.col.label || item.col.key });
      text.createSpan({ text: `${t("formula.referenceShort")}: ${this.getFormulaFieldReference(item.col)} · ${COLUMN_TYPE_LABELS()[item.col.type]}` });
      return;
    }
    if (item.kind === "example") {
      button.createSpan({ text: item.example.name });
      button.createSpan({ text: item.example.expression });
      return;
    }
    button.createSpan({ text: item.fn.name });
    button.createSpan({ text: item.fn.signature });
  }

  private renderHelpDetail(item: FormulaHelpItem | null): void {
    if (!this.helpDetailEl || !item) return;
    this.helpDetailEl.empty();
    if (item.kind === "field") {
      const heading = this.helpDetailEl.createDiv({ cls: "db-formula-field-detail-heading" });
      const title = heading.createDiv({ cls: "db-formula-field-detail-title" });
      title.createEl("h4", { text: item.col.label || item.col.key, attr: { title: item.col.label || item.col.key } });
      title.createDiv({ cls: "db-formula-field-title-kind", text: t("formula.columnTitle") });
      const type = heading.createDiv({ cls: "db-formula-field-detail-type" });
      renderPropertyTypeIcon(type, item.col, "db-formula-field-detail-type-icon");
      type.createSpan({ text: COLUMN_TYPE_LABELS()[item.col.type] });
      const referenceMap = this.helpDetailEl.createDiv({ cls: "db-formula-field-reference-map" });
      const formulaReference = this.getFormulaFieldReference(item.col);
      this.renderFieldReferenceRow(referenceMap, t("formula.formulaReference"), formulaReference, true);
      this.renderFieldReferenceRow(referenceMap, t("modal.propertyKey"), item.col.key, true);
      this.renderFieldOptions(this.helpDetailEl, item.col);
      const insert = this.helpDetailEl.createEl("button", {
        cls: "db-formula-insert-example",
        text: t("formula.insertField", { reference: formulaReference }),
      });
      insert.onclick = () => this.insertHelpItem(item);
      this.helpDetailEl.createDiv({
        cls: "db-formula-hint",
        text: t("formula.fieldHint"),
      });
      return;
    }
    if (item.kind === "example") {
      this.helpDetailEl.createEl("h4", { text: item.example.name });
      this.helpDetailEl.createDiv({ cls: "db-formula-function-desc", text: item.example.description });
      const insert = this.helpDetailEl.createEl("button", {
        cls: "db-formula-insert-example",
        text: item.example.expression,
      });
      insert.onclick = () => this.insertHelpItem(item);
      return;
    }
    this.helpDetailEl.createEl("h4", { text: item.fn.name });
    this.helpDetailEl.createDiv({ cls: "db-formula-signature", text: item.fn.signature });
    this.helpDetailEl.createDiv({ cls: "db-formula-function-desc", text: t(item.fn.descriptionKey) });
    const example = this.helpDetailEl.createEl("button", {
      cls: "db-formula-insert-example",
      text: item.fn.example,
    });
    example.onclick = () => this.insertExample(item.fn.example);
    this.helpDetailEl.createDiv({
      cls: "db-formula-hint",
      text: t("formula.syntaxHint"),
    });
  }

  private renderFieldReferenceRow(parent: HTMLElement, label: string, value: string, monospace = false): void {
    const row = parent.createDiv({ cls: "db-formula-field-reference-row" });
    row.createSpan({ cls: "db-formula-field-reference-label", text: label });
    row.createSpan({
      cls: `db-formula-field-reference-value${monospace ? " is-monospace" : ""}`,
      text: value,
      attr: { title: value },
    });
  }

  private getFormulaFieldReference(col: ColumnDef): string {
    if (this.expressionSyntax !== "base") return `[${col.key}]`;
    if (col.key.startsWith("file.")) return col.key;
    const isDerived = col.type === "computed" || col.type === "rollup";
    const object = isDerived ? "formula" : "note";
    const key = col.type === "computed" ? getComputedStorageKey(col) : col.key;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
      ? `${object}.${key}`
      : `${object}[${JSON.stringify(key)}]`;
  }

  private renderFieldOptions(parent: HTMLElement, col: ColumnDef): void {
    if (!["select", "multi-select", "status"].includes(col.type)) return;
    const section = parent.createDiv({ cls: "db-formula-field-options" });
    section.createDiv({ cls: "db-formula-field-options-title", text: t("formula.availableOptions") });
    if (col.key === "file.tags") {
      section.createDiv({ cls: "db-formula-hint", text: t("formula.fileTagsHint") });
      return;
    }
    const options = this.getFieldOptionEntries(col);
    if (options.length === 0) {
      section.createDiv({ cls: "db-formula-hint", text: t("formula.noOptions") });
      return;
    }
    const list = section.createDiv({ cls: "db-formula-field-option-list" });
    for (const option of options) {
      const button = list.createEl("button", {
        cls: `db-formula-field-option status-badge status-color-${option.color || "gray"}`,
        text: option.value,
        attr: { type: "button", title: option.value },
      });
      button.onclick = () => this.insertAtCursor(JSON.stringify(option.value));
    }
  }

  private getFieldOptionValues(col: ColumnDef): string[] {
    return this.getFieldOptionEntries(col).map((option) => option.value);
  }

  private getFieldOptionEntries(col: ColumnDef): StatusOptionDef[] {
    if (!isOptionColumnType(col.type)) return [];
    if (col.key === "file.tags") return [];
    const values = new Set<string>();
    const colorsByValue = new Map<string, StatusOptionDef["color"]>();
    for (const option of getColumnOptions(col)) {
      const value = String(option.value || "").trim();
      if (!value) continue;
      values.add(value);
      colorsByValue.set(value, option.color || "gray");
    }
    for (const row of this.rows) {
      const raw = row.frontmatter[col.key];
      if (col.type === "multi-select") {
        for (const value of toMultiSelectValuesForKey(col.key, raw)) {
          if (value) values.add(value);
        }
      } else if (raw != null && raw !== "") {
        values.add(safeString(raw));
      }
    }
    return [...values]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, color: colorsByValue.get(value) || "gray" }));
  }

  private renderButtons(): void {
    const buttonRow = this.contentEl.createDiv({ cls: "db-modal-button-row" });
    buttonRow.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    this.saveBtn = buttonRow.createEl("button", { text: t("formula.save"), cls: "mod-cta" });
    this.saveBtn.onclick = async () => {
      if (!this.textarea) return;
      const state = this.validateFormula();
      if (!state.valid) {
        new Notice(state.message);
        return;
      }
      const expression = this.textarea.value.trim();
      const saved = await this.onSave({
        expression,
        resultType: this.selectedResultType,
        expressionSyntax: this.expressionSyntax,
      });
      if (saved === false) return;
      this.saved = true;
      this.close();
    };
  }

  private getHelpItems(): FormulaHelpItem[] {
    const query = this.searchQuery.toLowerCase();
    const fields = this.getAvailableFields().map((col): FormulaHelpItem => ({ kind: "field", col }));
    const examples = this.getExamples().map((example): FormulaHelpItem => ({ kind: "example", example }));
    const functions = FUNCTIONS.map((fn): FormulaHelpItem => ({ kind: "function", fn }));

    if (query) {
      return [...fields, ...functions, ...examples].filter((item) => {
        if (item.kind === "field") return `${item.col.label} ${item.col.key} ${COLUMN_TYPE_LABELS()[item.col.type]}`.toLowerCase().includes(query);
        if (item.kind === "example") return `${item.example.name} ${item.example.description} ${item.example.expression}`.toLowerCase().includes(query);
        return `${item.fn.name} ${item.fn.signature} ${t(item.fn.descriptionKey)}`.toLowerCase().includes(query);
      });
    }

    if (this.selectedCategoryKey === "formula.catFields") return fields;
    if (this.selectedCategoryKey === "formula.catExamples") return examples;
    return functions.filter((item) => item.kind === "function" && item.fn.categoryKey === this.selectedCategoryKey);
  }

  private getAvailableFields(): ColumnDef[] {
    const currentKeys = new Set([this.col.key, this.col.computedKey || ""]);
    const seen = new Set<string>();
    return [...this.columns, ...FORMULA_FILE_FIELDS].filter((candidate) => {
      if (currentKeys.has(candidate.key) || currentKeys.has(candidate.computedKey || "")) return false;
      if (seen.has(candidate.key)) return false;
      seen.add(candidate.key);
      return true;
    });
  }

  /**
   * Schema-aware 字段名集合（列 key/label + 文件字段 key/label）。
   * 必须与公式引擎（ComputedFieldEngine）使用的集合一致，否则 [2024 Revenue]、
   * [Budget (USD)] 这类多词字段会被扫描器误判为数组/拆成裸标识符，导致
   * 校验、预览字段清单与替换预览三处彼此不一致。
   */
  private getFormulaKnownFields(): ReadonlySet<string> {
    const fields = new Set<string>();
    for (const col of [...this.columns, ...FORMULA_FILE_FIELDS]) {
      fields.add(col.key);
      if (col.label) fields.add(col.label);
    }
    return fields;
  }

  private getExamples(): FormulaExampleHelp[] {
    const status = this.columns.find((candidate) => ["status", "select"].includes(candidate.type)) || this.columns.find((candidate) => candidate.key !== this.col.key);
    const number = this.columns.find((candidate) => ["number", "currency"].includes(candidate.type) && candidate.key !== this.col.key);
    const secondNumber = this.columns.find((candidate) => candidate !== number && ["number", "currency"].includes(candidate.type) && candidate.key !== this.col.key);
    const date = this.columns.find((candidate) => isDateLikeColumnType(candidate.type) && candidate.key !== this.col.key);
    const secondDate = this.columns.find((candidate) => candidate !== date && isDateLikeColumnType(candidate.type) && candidate.key !== this.col.key);
    const datetime = this.columns.find((candidate) => candidate.type === "datetime" && candidate.key !== this.col.key);
    const text = this.columns.find((candidate) => candidate.type === "text" && candidate.key !== this.col.key);
    return [
      {
        name: t("formula.ex.conditional.name"),
        description: t("formula.ex.conditional.desc"),
        expression: status ? `=IF([${status.key}] === "done", 1, 0)` : '=IF([status] === "done", 1, 0)',
      },
      {
        name: t("formula.ex.dateDiff.name"),
        description: t("formula.ex.dateDiff.desc"),
        expression: date && secondDate ? `=DAYS([${date.key}], [${secondDate.key}])` : "=DAYS([start_date], [end_date])",
      },
      {
        name: t("formula.ex.errorFallback.name"),
        description: t("formula.ex.errorFallback.desc"),
        expression: number && secondNumber ? `=IFERROR([${number.key}] / [${secondNumber.key}], 0)` : "=IFERROR([price] / [days], 0)",
      },
      {
        name: t("formula.ex.rounding.name"),
        description: t("formula.ex.rounding.desc"),
        expression: number ? `=ROUND([${number.key}], 2)` : "=ROUND([price], 2)",
      },
      {
        name: t("formula.ex.nestedIf.name"),
        description: t("formula.ex.nestedIf.desc"),
        expression: number ? `=IF([${number.key}] >= 90, "A", IF([${number.key}] >= 60, "B", "C"))` : '=IF([score] >= 90, "A", IF([score] >= 60, "B", "C"))',
      },
      {
        name: t("formula.ex.daysFromNow.name"),
        description: t("formula.ex.daysFromNow.desc"),
        expression: date ? `=DAYSFROMNOW([${date.key}])` : "=DAYSFROMNOW([end_date])",
      },
      {
        name: t("formula.ex.concat.name"),
        description: t("formula.ex.concat.desc"),
        expression: text && number ? `=CONCAT([${text.key}], " - ", [${number.key}])` : '=CONCAT([name], " - ", [price])',
      },
      {
        name: t("formula.ex.dateAdd.name"),
        description: t("formula.ex.dateAdd.desc"),
        expression: date ? `=DATEADD([${date.key}], 1, "month")` : '=DATEADD([start_date], 1, "month")',
      },
      {
        name: t("formula.ex.textFormat.name"),
        description: t("formula.ex.textFormat.desc"),
        expression: number ? `=TEXT([${number.key}], "#,##0.00")` : '=TEXT([price], "#,##0.00")',
      },
      {
        name: t("formula.ex.yearMonth.name"),
        description: t("formula.ex.yearMonth.desc"),
        expression: date ? `=CONCAT(YEAR([${date.key}]), "-", TEXT(MONTH([${date.key}]), "00"))` : '=CONCAT(YEAR([start_date]), "-", TEXT(MONTH([start_date]), "00"))',
      },
      {
        name: t("formula.ex.dateTime.name"),
        description: t("formula.ex.dateTime.desc"),
        expression: datetime ? `=DATEADD([${datetime.key}], 2, "hours")` : '=DATEADD([datetime], 2, "hours")',
      },
    ];
  }

  private isSameHelpItem(a: FormulaHelpItem | null, b: FormulaHelpItem | null): boolean {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === "field" && b.kind === "field") return a.col.key === b.col.key;
    if (a.kind === "function" && b.kind === "function") return a.fn.name === b.fn.name;
    if (a.kind === "example" && b.kind === "example") return a.example.name === b.example.name;
    return false;
  }

  private insertHelpItem(item: FormulaHelpItem): void {
    if (item.kind === "field") {
      this.insertAtCursor(this.getFormulaFieldReference(item.col));
    } else if (item.kind === "example") {
      this.insertExample(item.example.expression);
    } else {
      this.insertFunction(item.fn);
    }
  }

  private insertExample(example: string): void {
    if (!this.textarea) return;
    this.textarea.value = example;
    this.textarea.focus();
    this.textarea.setSelectionRange(example.length, example.length);
    this.updateEditorChrome();
    this.updatePreview();
  }

  private insertFunction(fn: FormulaFunctionHelp): void {
    this.insertAtCursor(fn.signature);
  }

  private updatePreview(): void {
    if (!this.previewOutput || !this.previewStatus) return;
    const state = this.validateFormula();
    const previewOutput = state.severity === "error" ? "ERROR" : state.output;
    this.previewOutput.textContent = previewOutput;
    this.previewOutput.title = state.severity === "error" ? state.message : state.output;
    this.previewStatus.title = state.message;
    this.previewOutput.toggleClass("is-error", state.severity === "error");
    this.previewOutput.toggleClass("is-warning", state.severity === "warning");
    this.previewStatus.textContent = state.message;
    this.previewStatus.toggleClass("is-error", state.severity === "error");
    this.previewStatus.toggleClass("is-warning", state.severity === "warning");
    this.previewStatus.toggleClass("is-ok", state.severity === "ok");
    this.renderPreviewDetails();
    this.updateSaveState(state);
  }

  private validateFormula(): FormulaValidationState {
    const expression = this.textarea?.value.trim() || "";
    if (!expression) {
      return { valid: false, empty: true, message: t("formula.enterFormula"), output: t("formula.notCalculated"), severity: "muted" };
    }

    const fieldError = this.validateReferencedFields(expression);
    if (fieldError) {
      return { valid: false, empty: false, message: fieldError, output: fieldError, severity: "error" };
    }

    const index = this.selectedPreviewIndex;
    const row = this.rows[index];
    if (!row) {
      return { valid: true, empty: false, message: t("formula.noPreviewSaveFirst"), output: t("formula.noPreview"), severity: "muted" };
    }

    let value: unknown;
    try {
      if (this.expressionSyntax === "base") {
        value = evaluateBaseExpression(expression, {
          app: this.app,
          file: row.file,
          frontmatter: row.frontmatter,
          thisFile: this.baseThisFile,
          thisFrontmatter: this.baseThisFrontmatter,
          columns: this.columns,
          computedValues: row.computed,
        });
      } else {
        const fileCache = row.file && this.app ? this.app.metadataCache.getFileCache(row.file) : null;
        const enrichedFm = row.file && this.app
          ? {
              ...row.frontmatter,
              "file.name": getFileFieldValue(row.file, "file.name", row.frontmatter, fileCache, this.app),
              "file.tags": getFileFieldValue(row.file, "file.tags", row.frontmatter, fileCache, this.app),
            }
          : row.frontmatter;
        const result = new ComputedFieldEngine([], this.columns).evaluateSingleDetailed(expression, enrichedFm, row.computed);
        if (result.error) {
          return { valid: false, empty: false, message: result.error, output: result.error, severity: "error" };
        }
        value = result.value;
      }
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      return { valid: false, empty: false, message, output: message, severity: "error" };
    }

    const typeError = this.validateResultType(value);
    if (typeError) {
      return { valid: false, empty: false, message: typeError, output: this.formatPreviewValue(value), severity: "warning" };
    }

    return { valid: true, empty: false, message: t("formula.valid"), output: this.formatPreviewValue(value), severity: "ok" };
  }

  private validateReferencedFields(expression: string): string | null {
    if (this.expressionSyntax === "base") return null;
    const available = [...this.columns, ...FORMULA_FILE_FIELDS];
    const knownNames = new Set([
      ...available.map((col) => col.key),
      ...FUNCTIONS.map((fn) => fn.name),
      ...FUNCTIONS.map((fn) => fn.name.toLowerCase()),
      "today", "now", "pi", "e", "field",
      "true", "false", "null", "undefined", "this",
      "Math", "Number", "String", "Boolean", "Date", "Array", "Object", "JSON",
      "Infinity", "NaN", "console",
    ]);
    for (const segment of scanFormulaSegments(expression, this.getFormulaKnownFields())) {
      if (segment.kind === "bracket-ref" || segment.kind === "field-call") {
        const col = available.find((candidate) => candidate.key === segment.name || candidate.label === segment.name);
        if (!col) return t("formula.fieldNotExist", { name: segment.name });
        continue;
      }
      const id = segment.kind === "member-ref"
        ? segment.object
        : segment.kind === "identifier" && !segment.isMember
          ? segment.text
          : "";
      if (!knownNames.has(id) && id.length > 1) {
        const labelMatch = available.find((candidate) => candidate.label === id && candidate.key !== id);
        if (labelMatch) {
          return t("formula.columnTitleAsVariable", { label: id, key: labelMatch.key });
        }
        return t("formula.undefinedVariable", { name: id });
      }
    }
    return null;
  }

  private validateResultType(value: unknown): string | null {
    const type = this.selectedResultType;
    if (value == null || value === "") return null;
    if (typeof value === "number" && !Number.isFinite(value)) {
      if (value === Infinity || value === -Infinity) return t("formula.divisionByZero");
      return t("formula.resultNaN");
    }
    if (type === "number" && typeof value !== "number") return t("formula.resultTypeMismatch");
    if (type === "date") {
      if (value instanceof Date) return null;
      if (typeof value !== "string" || !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value) || Number.isNaN(Date.parse(value))) {
        return t("formula.resultTypeDate");
      }
    }
    if (type === "datetime") {
      if (value instanceof Date) return null;
      // datetime 必须含日期 + 时间（HH:mm）分量。
      if (typeof value !== "string" || !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}.*\d{1,2}:\d{2}/.test(value)) {
        return t("formula.resultTypeDatetime");
      }
    }
    if (type === "checkbox" && typeof value !== "boolean") return t("formula.resultTypeCheckbox");
    return null;
  }

  private updateSaveState(state = this.validateFormula()): void {
    if (!this.saveBtn || !this.textarea) return;
    const dirty = this.textarea.value.trim() !== this.originalExpression.trim() || this.selectedResultType !== this.originalResultType;
    this.saveBtn.disabled = !dirty || !state.valid;
    this.saveBtn.textContent = !dirty ? t("formula.notModified") : state.valid ? t("formula.save") : t("formula.invalid");
  }

  private renderPreviewDetails(): void {
    if (!this.previewDetails) return;
    this.previewDetails.empty();
    const expression = this.textarea?.value.trim() || "";
    const row = this.getPreviewRow();
    if (!expression || !row) {
      this.previewDetails.createDiv({
        cls: "db-formula-preview-empty",
        text: expression ? t("formula.noPreviewForSteps") : t("formula.enterToSeeSteps"),
      });
      return;
    }

    const refs = this.getReferencedFields(expression, row);
    const expressionSection = this.previewDetails.createDiv({
      cls: "db-formula-preview-section db-formula-preview-expression-section",
    });
    expressionSection.createDiv({
      cls: "db-formula-preview-section-title",
      text: t("formula.substitutedFormula"),
    });
    const substituted = this.buildSubstitutedExpression(expression, refs);
    expressionSection.createEl("code", {
      cls: "db-formula-preview-expression-code",
      text: substituted || t("formula.emptyValue"),
      attr: { title: substituted || t("formula.emptyValue") },
    });

    const fieldsSection = this.previewDetails.createDiv({
      cls: "db-formula-preview-section db-formula-preview-fields-section",
    });
    fieldsSection.createDiv({ cls: "db-formula-preview-section-title", text: t("formula.fieldValues") });
    if (refs.length === 0) {
      fieldsSection.createDiv({ cls: "db-formula-preview-empty", text: t("formula.noReferencedFields") });
    } else {
      const fieldList = fieldsSection.createDiv({ cls: "db-formula-preview-field-list" });
      for (const ref of refs) {
        const item = fieldList.createDiv({ cls: "db-formula-preview-field-item" });
        const main = item.createDiv({ cls: "db-formula-preview-field-main" });
        main.createSpan({ cls: "db-formula-preview-field-name", text: ref.col.label || ref.col.key });
        main.createSpan({
          cls: "db-formula-preview-field-ref",
          text: ref.syntax,
        });
        item.createDiv({
          cls: "db-formula-preview-field-value",
          text: this.formatPreviewValue(ref.value),
          attr: { title: this.formatPreviewValue(ref.value) },
        });
      }
    }
  }

  private getPreviewRow(): RowData | undefined {
    const index = this.selectedPreviewIndex;
    return this.rows[index];
  }

  private getReferencedFields(expression: string, row: RowData): FormulaReferencedField[] {
    const result: FormulaReferencedField[] = [];
    const seen = new Set<string>();
    for (const segment of scanFormulaSegments(expression, this.getFormulaKnownFields())) {
      const resolved = this.resolveFormulaReference(expression, segment);
      if (!resolved) continue;
      const key = `${resolved.source}:${resolved.object || ""}:${resolved.col.key}:${resolved.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...resolved, value: this.getColumnValueForRow(resolved.col, row) });
    }
    return result;
  }

  private resolveFormulaReference(
    expression: string,
    segment: FormulaSegment
  ): Omit<FormulaReferencedField, "value"> | null {
    const available = [...this.columns, ...FORMULA_FILE_FIELDS];
    let source: FormulaReferencedField["source"];
    let ref: string;
    let object: string | undefined;
    let col: ColumnDef | undefined;
    if (segment.kind === "bracket-ref" || segment.kind === "field-call") {
      source = segment.kind === "bracket-ref" ? "bracket" : "field-call";
      ref = segment.name;
      col = available.find((candidate) => candidate.key === ref || candidate.label === ref);
    } else if (segment.kind === "identifier" && !segment.isCall && !segment.isMember) {
      source = "direct";
      ref = segment.text;
      col = available.find((candidate) => candidate.key === ref);
    } else if (segment.kind === "member-ref" && this.expressionSyntax === "base") {
      source = "member";
      ref = segment.name;
      object = segment.object;
      col = object === "formula"
        ? available.find((candidate) => (candidate.type === "computed" || candidate.type === "rollup") && (
            candidate.computedKey === ref || candidate.key === ref || candidate.key === `formula.${ref}`
          ))
        : available.find((candidate) => candidate.key === ref);
    } else {
      return null;
    }
    if (!col) return null;
    return {
      col,
      ref,
      source,
      object,
      syntax: expression.slice(segment.start, segment.end),
    };
  }

  private getColumnValueForRow(col: ColumnDef, row: RowData): unknown {
    if (col.type === "computed") return row.computed[getComputedStorageKey(col)];
    if (col.type === "rollup") return row.computed[col.key];
    if (col.key === "file.name" || col.key === "file.tags") {
      return getFileFieldValue(row.file, col.key, row.frontmatter, row.cache ?? null, row.app);
    }
    return row.frontmatter[col.key];
  }

  private buildSubstitutedExpression(expression: string, refs: FormulaReferencedField[]): string {
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    for (const segment of scanFormulaSegments(expression, this.getFormulaKnownFields())) {
      const resolved = this.resolveFormulaReference(expression, segment);
      const item = resolved
        ? refs.find((candidate) =>
            candidate.source === resolved.source &&
            candidate.ref === resolved.ref &&
            candidate.object === resolved.object &&
            candidate.col.key === resolved.col.key
          )
        : undefined;
      if (item) {
        replacements.push({
          start: segment.start,
          end: segment.end,
          text: this.formatFormulaLiteral(item.value),
        });
      }
    }
    let substituted = expression;
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
      const replacement = replacements[index];
      substituted = substituted.slice(0, replacement.start) + replacement.text + substituted.slice(replacement.end);
    }
    return substituted;
  }

  private formatFormulaLiteral(value: unknown): string {
    if (value == null || value === "") return "null";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return JSON.stringify(value);
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return JSON.stringify(safeString(value));
      }
    }
    return JSON.stringify(safeString(value));
  }

  private updateEditorChrome(): void {
    if (!this.textarea) return;
    this.updateMatchedBrackets();
    this.updateLineNumbers();
    this.updateHighlight();
    this.syncEditorScroll();
  }

  private updateLineNumbers(): void {
    if (!this.textarea || !this.lineNumberEl) return;
    const lines = Math.max(1, this.textarea.value.split("\n").length);
    this.lineNumberEl.textContent = Array.from({ length: lines }, (_, index) => String(index + 1)).join("\n");
  }

  private updateHighlight(): void {
    if (!this.textarea || !this.highlightEl) return;
    const html = this.highlightFormula(this.textarea.value || " ");
    const content = html.endsWith("\n") ? `${html} ` : html;
    // Use DOMParser for safe HTML insertion instead of direct HTML fragment APIs.
    const doc = new DOMParser().parseFromString(content, "text/html");
    this.highlightEl.empty();
    while (doc.body.firstChild) {
      this.highlightEl.appendChild(this.highlightEl.ownerDocument.adoptNode(doc.body.firstChild));
    }
  }

  private syncEditorScroll(): void {
    if (!this.textarea) return;
    if (this.highlightEl?.parentElement) {
      this.highlightEl.parentElement.scrollTop = this.textarea.scrollTop;
      this.highlightEl.parentElement.scrollLeft = this.textarea.scrollLeft;
    }
    if (this.lineNumberEl) this.lineNumberEl.scrollTop = this.textarea.scrollTop;
  }

  private updateMatchedBrackets(): void {
    this.matchedBracketIndexes.clear();
    if (!this.textarea) return;
    const pair = this.findBracketPair(this.textarea.value, this.textarea.selectionStart);
    if (!pair) return;
    this.matchedBracketIndexes.add(pair[0]);
    this.matchedBracketIndexes.add(pair[1]);
  }

  private findBracketPair(text: string, cursor: number): [number, number] | null {
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const reverse: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const index = cursor > 0 && (pairs[text[cursor - 1]] || reverse[text[cursor - 1]]) ? cursor - 1 : cursor;
    const char = text[index];
    if (pairs[char]) {
      let depth = 0;
      for (let i = index; i < text.length; i += 1) {
        if (text[i] === char) depth += 1;
        if (text[i] === pairs[char]) depth -= 1;
        if (depth === 0) return [index, i];
      }
    }
    if (reverse[char]) {
      let depth = 0;
      for (let i = index; i >= 0; i -= 1) {
        if (text[i] === char) depth += 1;
        if (text[i] === reverse[char]) depth -= 1;
        if (depth === 0) return [i, index];
      }
    }
    return null;
  }

  private highlightFormula(text: string): string {
    let html = "";
    let index = 0;
    while (index < text.length) {
      const char = text[index];
      if (char === "\"" || char === "'" || char === "`") {
        const start = index;
        index += 1;
        while (index < text.length) {
          if (text[index] === "\\") {
            index += 2;
            continue;
          }
          if (text[index] === char) {
            index += 1;
            break;
          }
          index += 1;
        }
        html += this.wrapToken(text.slice(start, index), "string", start);
        continue;
      }
      if (char === "[") {
        const start = index;
        const end = text.indexOf("]", index + 1);
        index = end >= 0 ? end + 1 : index + 1;
        const token = text.slice(start, index);
        const name = token.slice(1, -1).trim();
        const known = this.columns.some((col) => col.key === name || col.label === name);
        html += this.wrapToken(token, known ? "field" : "field is-unknown", start);
        continue;
      }
      const number = text.slice(index).match(/^\d+(?:\.\d+)?/);
      if (number) {
        html += this.wrapToken(number[0], "number", index);
        index += number[0].length;
        continue;
      }
      const word = text.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
      if (word) {
        const token = word[0];
        const next = text.slice(index + token.length).match(/^\s*\(/);
        const isFunction = !!next && FUNCTION_NAMES.has(token.toUpperCase());
        const isKeyword = ["true", "false", "null", "undefined", "return", "today", "pi", "e"].includes(token);
        const isFieldKey = this.columns.some((col) => col.key === token);
        html += this.wrapToken(token, isFunction ? "function" : isKeyword ? "keyword" : isFieldKey ? "field-key" : "plain", index);
        index += token.length;
        continue;
      }
      if (/^[=+\-*/%?:!<>|&.,;]/.test(char)) {
        html += this.wrapToken(char, "operator", index);
        index += 1;
        continue;
      }
      html += this.wrapToken(char, "plain", index);
      index += 1;
    }
    return html;
  }

  private wrapToken(token: string, cls: string, startIndex: number): string {
    let html = "";
    for (let i = 0; i < token.length; i += 1) {
      const char = token[i];
      const matched = this.matchedBracketIndexes.has(startIndex + i);
      const bracket = /[()[\]{}]/.test(char);
      const tokenClasses = cls === "plain"
        ? []
        : cls.split(/\s+/).filter(Boolean).map((part) => `db-formula-token-${part}`);
      const classes = [
        ...tokenClasses,
        matched && bracket ? "db-formula-token-bracket-match" : "",
      ].filter(Boolean).join(" ");
      html += classes ? `<span class="${classes}">${this.escapeHtml(char)}</span>` : this.escapeHtml(char);
    }
    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private updateSuggestions(): void {
    if (!this.textarea || !this.propertySuggestEl) return;
    const cursor = this.textarea.selectionStart;
    const before = this.textarea.value.slice(0, cursor);
    const openIndex = before.lastIndexOf("[");
    const closeIndex = before.lastIndexOf("]");
    this.propertySuggestEl.empty();
    const propertyContext = openIndex >= 0 && closeIndex < openIndex;
    if (propertyContext) {
      const query = before.slice(openIndex + 1).toLowerCase();
      const matches = this.getAvailableFields()
        .filter((col) => `${col.label} ${col.key} ${COLUMN_TYPE_LABELS()[col.type]}`.toLowerCase().includes(query))
        .slice(0, 10);
      if (matches.length === 0) {
        this.hideSuggestions();
        return;
      }
      this.showSuggestionBox();
      for (const col of matches) {
        const item = this.propertySuggestEl.createEl("button", { cls: "db-formula-property-suggestion" });
        renderPropertyTypeIcon(item, col, "db-formula-property-suggestion-icon");
        item.createSpan({ cls: "db-formula-property-suggestion-label", text: col.label || col.key });
        item.createSpan({ text: this.getFormulaFieldReference(col) });
        item.onclick = () => this.insertProperty(openIndex, cursor, col);
      }
      this.activateFirstSuggestion();
      return;
    }

    const functionMatch = before.match(/([A-Za-z]{1,30})$/);
    if (!functionMatch) {
      this.hideSuggestions();
      return;
    }
    const query = functionMatch[1].toUpperCase();
    const matches = FUNCTIONS
      .filter((fn) => fn.name.startsWith(query))
      .slice(0, 8);
    if (matches.length === 0) {
      this.hideSuggestions();
      return;
    }
    this.showSuggestionBox();
    for (const fn of matches) {
      const item = this.propertySuggestEl.createEl("button", { cls: "db-formula-property-suggestion" });
      item.createSpan({ text: fn.name });
      item.createSpan({ text: fn.signature });
      item.onclick = () => this.replaceRange(cursor - functionMatch[1].length, cursor, fn.signature);
    }
    this.activateFirstSuggestion();
  }

  private showSuggestionBox(): void {
    if (!this.textarea || !this.propertySuggestEl) return;
    this.applySuggestionPosition();
    this.suggestionIndex = -1;
    this.propertySuggestEl.addClass("is-visible");
  }

  /** 宽屏：跟随光标 inline 定位；窄屏/手机：停靠式（占文档流，出现在输入区下方）。 */
  private applySuggestionPosition(): void {
    if (!this.textarea || !this.propertySuggestEl) return;
    const docked = this.shouldDockSuggestions();
    this.propertySuggestEl.toggleClass("is-docked", docked);
    if (docked) {
      this.propertySuggestEl.setCssProps({ left: "", top: "" });
      return;
    }
    const pos = this.estimateCaretPosition();
    this.propertySuggestEl.setCssProps({ left: `${pos.left}px`, top: `${pos.top + 4}px` });
  }

  private hideSuggestions(): void {
    this.suggestionIndex = -1;
    this.propertySuggestEl?.removeClass("is-visible");
  }

  /**
   * 窄屏（手机或 modal 宽 <760）下光标跟随定位会溢出视口/遮挡输入区，
   * 联想改为停靠式面板展示（不再是早期的一刀切禁用——窄屏也要有联想）。
   */
  private shouldDockSuggestions(): boolean {
    if (window.activeDocument.body.classList.contains("is-phone")) return true;
    const width = this.modalEl?.getBoundingClientRect().width || this.contentEl?.getBoundingClientRect().width || 0;
    return width > 0 && width < 760;
  }

  private highlightSuggestion(items: HTMLButtonElement[]): void {
    items.forEach((el, i) => el.toggleClass("is-selected", i === this.suggestionIndex));
    if (this.suggestionIndex >= 0 && items[this.suggestionIndex]) {
      items[this.suggestionIndex].scrollIntoView({ block: "nearest" });
    }
  }

  private activateFirstSuggestion(): void {
    if (!this.propertySuggestEl) return;
    const items = Array.from(
      this.propertySuggestEl.querySelectorAll<HTMLButtonElement>("button.db-formula-property-suggestion")
    );
    this.suggestionIndex = items.length > 0 ? 0 : -1;
    this.highlightSuggestion(items);
  }

  private estimateCaretPosition(): { left: number; top: number } {
    if (!this.textarea) return { left: 0, top: 0 };
    const cursor = this.textarea.selectionStart;
    const textBeforeCursor = this.textarea.value.slice(0, cursor);

    // Build a hidden mirror div that replicates the textarea layout
    const mirror = window.activeDocument.createElement("div");
    const style = getComputedStyle(this.textarea);
    const copyStyles = [
      "font-family", "font-size", "font-weight", "letter-spacing",
      "line-height", "padding-top", "padding-right", "padding-bottom", "padding-left",
      "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
      "box-sizing", "overflow-wrap", "white-space", "tab-size",
    ];
    mirror.setCssProps({ position: "absolute", visibility: "hidden", top: "0", left: "-9999px", width: `${this.textarea.clientWidth}px`, overflow: "hidden" });
    for (const prop of copyStyles) {
      mirror.style.setProperty(prop, style.getPropertyValue(prop));
    }
    mirror.textContent = textBeforeCursor;

    // Add a span at the caret position to measure it
    const caretSpan = window.activeDocument.createElement("span");
    caretSpan.textContent = "|";
    mirror.appendChild(caretSpan);

    window.activeDocument.body.appendChild(mirror);
    const caretOffset = caretSpan.offsetLeft - mirror.scrollLeft;
    const caretLineTop = caretSpan.offsetTop - mirror.scrollTop;
    window.activeDocument.body.removeChild(mirror);

    return {
      left: Math.min(
        this.textarea.clientWidth - 20,
        caretOffset - (this.textarea.scrollLeft || 0)
      ),
      top: caretLineTop - (this.textarea.scrollTop || 0) + parseFloat(style.lineHeight || "20") + 4,
    };
  }

  private insertProperty(openIndex: number, cursor: number, col: ColumnDef): void {
    const insertion = this.getFormulaFieldReference(col);
    this.replaceRange(openIndex, cursor, insertion);
  }

  private insertAtCursor(text: string): void {
    if (!this.textarea) return;
    this.replaceRange(this.textarea.selectionStart, this.textarea.selectionEnd, text);
  }

  private replaceRange(start: number, end: number, text: string): void {
    if (!this.textarea || !this.propertySuggestEl) return;
    const before = this.textarea.value.slice(0, start);
    const after = this.textarea.value.slice(end);
    this.textarea.value = `${before}${text}${after}`;
    const nextCursor = before.length + text.length;
    this.textarea.focus();
    this.textarea.setSelectionRange(nextCursor, nextCursor);
    this.propertySuggestEl.empty();
    this.propertySuggestEl.removeClass("is-visible");
    this.updateEditorChrome();
    this.updatePreview();
  }

  private formatPreviewValue(value: unknown): string {
    if (value == null || value === "") return t("formula.emptyValue");
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return String(value);
      return String(value);
    }
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return safeString(value);
      }
    }
    return safeString(value);
  }

  private copyAiPrompt(): void {
    const locale = getEffectiveLocale();
    const prompt = locale === "en"
      ? {
        intro: [
          "You are helping me write formulas for an Obsidian plugin called Note Database.",
          "The formula syntax is based on JavaScript expressions.",
        ],
        syntaxTitle: "## Syntax Rules",
        syntaxRules: [
          "Formulas are JavaScript expressions evaluated with a safe expression parser.",
          "Use `===` for equality and `!==` for inequality.",
          "Use single or double quotes for text.",
          "Formulas can optionally start with `=`.",
          "Reference database fields with bracket notation, for example `[field_key]`.",
          "Direct variable names and `field(\"field_key\")` are also supported, but bracket notation is preferred.",
          "The formula must return one value: a number, text, boolean, or date string.",
        ],
        fieldsTitle: "## Available Database Fields",
        label: "column title",
        options: "options",
        functionsTitle: "## Available Functions",
        specialTitle: "## Special Values",
        specialValues: [
          "`today`: current date as a YYYY-MM-DD string",
          "`pi`: Math.PI",
          "`e`: Math.E",
        ],
        request: "Please write a formula for me. I will describe what I need.",
      }
      : locale === "zh-TW"
        ? {
          intro: [
            "請幫我為 Obsidian 外掛 Note Database 編寫公式。",
            "公式語法基於 JavaScript 運算式。",
          ],
          syntaxTitle: "## 語法規則",
          syntaxRules: [
            "公式是通過安全表達式解析器求值的 JavaScript 運算式。",
            "相等比較請使用 `===`，不相等請使用 `!==`。",
            "文字請使用單引號或雙引號。",
            "公式可以選擇性地以 `=` 開頭。",
            "引用資料庫欄位請使用方括號，例如 `[field_key]`。",
            "也支援直接變數名和 `field(\"field_key\")`，但優先使用方括號寫法。",
            "公式必須回傳一個值：數字、文字、布林值或日期字串。",
          ],
          fieldsTitle: "## 可用資料庫欄位",
          label: "欄標題",
          options: "可選項",
          functionsTitle: "## 可用函式",
          specialTitle: "## 特殊值",
          specialValues: [
            "`today`：目前日期，格式為 YYYY-MM-DD 字串",
            "`pi`：Math.PI",
            "`e`：Math.E",
          ],
          request: "請根據我接下來描述的需求，寫出可直接使用的公式。",
        }
        : {
          intro: [
            "请帮我为 Obsidian 插件 Note Database 编写公式。",
            "公式语法基于 JavaScript 表达式。",
          ],
          syntaxTitle: "## 语法规则",
          syntaxRules: [
            "公式是通过安全表达式解析器求值的 JavaScript 表达式。",
            "相等比较请使用 `===`，不相等请使用 `!==`。",
            "文本请使用单引号或双引号。",
            "公式可以选择性地以 `=` 开头。",
            "引用数据库字段请使用方括号，例如 `[field_key]`。",
            "也支持直接变量名和 `field(\"field_key\")`，但优先使用方括号写法。",
            "公式必须返回一个值：数字、文本、布尔值或日期字符串。",
          ],
          fieldsTitle: "## 可用数据库字段",
          label: "列标题",
          options: "可选项",
          functionsTitle: "## 可用函数",
          specialTitle: "## 特殊值",
          specialValues: [
            "`today`：当前日期，格式为 YYYY-MM-DD 字符串",
            "`pi`：Math.PI",
            "`e`：Math.E",
          ],
          request: "请根据我接下来描述的需求，写出可以直接使用的公式。",
        };
    const lines: string[] = [
      ...prompt.intro,
      "",
      prompt.syntaxTitle,
      ...prompt.syntaxRules.map((line) => `- ${line}`),
      "",
      prompt.fieldsTitle,
    ];
    const fields = this.getAvailableFields();
    for (const col of fields) {
      const meta = [COLUMN_TYPE_LABELS()[col.type]];
      if (col.label && col.label !== col.key) meta.push(`${prompt.label}: ${col.label}`);
      const options = this.getFieldOptionValues(col);
      if (options.length > 0) meta.push(`${prompt.options}: ${options.join(", ")}`);
      lines.push(`- \`${col.key}\` (${meta.join("; ")})`);
    }
    lines.push("");
    lines.push(prompt.functionsTitle);
    for (const catKey of FUNCTION_CATEGORY_KEYS) {
      lines.push("");
      lines.push(`### ${t(catKey)}`);
      for (const fn of FUNCTIONS.filter((f) => f.categoryKey === catKey)) {
        lines.push(`- ${fn.signature}: ${t(fn.descriptionKey)}`);
      }
    }
    lines.push("");
    lines.push(prompt.specialTitle);
    for (const value of prompt.specialValues) {
      lines.push(`- ${value}`);
    }
    lines.push("");
    lines.push(prompt.request);

    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(() => {
      new Notice(t("formula.copyAiPrompt") + " ✓");
    }).catch(() => {
      new Notice(t("errors.clipboardFailed"));
    });
  }

  private hasUnsavedChanges(): boolean {
    if (!this.textarea) return false;
    return this.textarea.value.trim() !== this.originalExpression.trim()
      || this.selectedResultType !== this.originalResultType;
  }

  close(): void {
    if (this.saved || this.closeConfirmed || !this.hasUnsavedChanges()) {
      super.close();
      return;
    }
    if (this.closeConfirmationPending) return;
    this.closeConfirmationPending = true;
    void confirmWithModal(this.app, {
      title: t("common.cancel"),
      message: t("formula.confirmDiscard"),
      confirmText: t("formula.discard"),
      danger: true,
    }).then((confirmed) => {
      this.closeConfirmationPending = false;
      if (!confirmed) return;
      this.closeConfirmed = true;
      this.close();
    });
  }

  onClose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.closeConfirmationPending = false;
    this.closeConfirmed = false;
    this.modalEl.removeClass("formula-workbench-modal-host");
    this.contentEl.empty();
    this.onClosed?.();
  }
}
