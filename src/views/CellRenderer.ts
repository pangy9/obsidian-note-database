import { App, Notice, Platform, normalizePath, setIcon } from "obsidian";
import {
  getColumnOptions,
  getInvalidObsidianTagValues,
  normalizeValidObsidianTagValue,
  normalizeOptionValueForKey,
  toBooleanValue,
  toMultiSelectValuesForKey,
  toValidObsidianTagValues,
} from "../data/ColumnTypes";
import { getColumnDisplayType } from "../data/ColumnDisplay";
import { DataSource } from "../data/DataSource";
import { getFileFieldFixedType, getRowFileFieldValue, isFileFieldKey, isReadonlyFileField } from "../data/FileFields";
import { ColumnDef, ComputedFieldDef, RowData, StatusOptionDef } from "../data/types";
import { t } from "../i18n";
import { clamp, getVisiblePopoverBounds, setPosition } from "./PopoverPosition";
import { setFieldTooltip } from "./FieldTooltip";
import { FileTitleDisplay, getFileTitleDisplay, renderInlineFileTitle } from "./FileTitleDisplay";
import { isHTMLElement } from "./DomGuards";
import { safeString } from "../data/SafeString";
import { confirmWithModal } from "./modals/ConfirmModal";
import { renderSpecialFileFieldValue, shouldRenderSpecialFileField } from "./FileFieldRenderer";

const OPTION_COLORS: StatusOptionDef["color"][] = [
  "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink",
  "red", "slate", "cyan", "teal", "lime", "indigo", "violet", "rose",
];

export interface CellOptionTransaction {
  previousOptions?: StatusOptionDef[];
  nextOptions?: StatusOptionDef[];
  cleanupRemovedValues?: string[];
  renameValues?: Array<{ from: string; to: string }>;
  setValue?: boolean;
  value?: unknown;
}

interface OptionDragPreview {
  preview: HTMLElement;
  offsetX: number;
  offsetY: number;
}

interface MetadataCacheWithTags {
  getTags?(): Record<string, number>;
}

export class CellRenderer {
  private transientTimers = new WeakMap<HTMLElement, Map<string, number>>();
  private activeTextEditClose?: () => void;

  constructor(
    private dataSource: DataSource,
    private refreshAfterSave: () => Promise<void>,
    private openNote: (row: RowData) => void | Promise<void> = (row) => this.dataSource.openNote(row.file),
    private manageOptions?: (col: ColumnDef) => void,
    private editFormula?: (col: ColumnDef) => void,
    private isReadOnly = false,
    private commitCellOptionTransaction?: (row: RowData, col: ColumnDef, transaction: CellOptionTransaction) => Promise<void>,
    private saveCellValue?: (row: RowData, col: ColumnDef, value: unknown) => Promise<void>,
    private getFileTitleInfo: (row: RowData) => FileTitleDisplay = (row) => getFileTitleDisplay(row, [row]),
    private getComputedFields: () => ComputedFieldDef[] = () => [],
    private app?: App
  ) {}

  renderCell(td: HTMLElement, row: RowData, col: ColumnDef): void {
    td.addClass("db-cell");
    if (col.wrap) td.addClass("db-cell-wrap");
    let value: unknown;

    if (col.type === "computed" && col.computedKey) {
      value = row.computed[col.computedKey];
    } else if (col.key === "file.name") {
      td.addClass("db-title-cell");
      const displayInfo = this.getFileTitleInfo(row);
      const link = td.createEl("a", {
        cls: "internal-link",
        attr: { title: displayInfo.fullPath },
      });
      renderInlineFileTitle(link, displayInfo, true);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.openNote(row);
      });
      setFieldTooltip(td, displayInfo.fullPath);
      if (!this.isReadOnly) {
        td.addClass("db-editable-cell");
        setFieldTooltip(td, displayInfo.fullPath, t("cell.doubleClickRename"));
        td.tabIndex = 0;
        td.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          this.editFileName(td, row, displayInfo.name);
        });
        td.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.editFileName(td, row, displayInfo.name);
          }
        });
      }
      return;
    } else {
      value = isFileFieldKey(col.key) ? getRowFileFieldValue(row, col.key) : row.frontmatter[col.key];
    }

    const displayType = this.getEffectiveDisplayType(col);
    if (displayType === "checkbox") {
      this.renderCheckbox(td, row, col, value);
      return;
    }

    if (this.isEmptyValue(value)) {
      td.createSpan({ cls: "db-empty-value", text: t("common.empty") });
      if (!this.isReadOnly && col.type === "computed") {
        this.makeComputedEditable(td, col);
        setFieldTooltip(td, t("common.empty"), t("cell.doubleClickEditFormula"));
      }
      if (!this.isReadOnly && this.isEditableCellColumn(col)) {
        td.addClass("db-editable-cell");
        this.makeEditable(td, row, col, "");
        setFieldTooltip(td, t("common.empty"), t("cell.doubleClickEdit"));
      } else if (!this.isReadOnly && isReadonlyFileField(col.key)) {
        this.makeReadonlyFileFieldNotice(td, col);
      }
      if (this.isReadOnly) {
        setFieldTooltip(td, t("common.empty"));
      }
      return;
    }

    if (shouldRenderSpecialFileField(col) && renderSpecialFileFieldValue(td, this.app, row, col, value)) {
      if (!this.isReadOnly && this.isEditableCellColumn(col)) {
        td.addClass("db-editable-cell");
        this.makeEditable(td, row, col, value);
        setFieldTooltip(td, this.getTooltipValue(col, value), t("cell.doubleClickEdit"));
      } else {
        setFieldTooltip(td, this.getTooltipValue(col, value));
      }
      return;
    }

    switch (displayType) {
      case "status":
      case "select":
        this.renderStatus(td, col, String(value));
        break;
      case "multi-select":
        this.renderMultiSelect(td, col, value);
        break;
      case "currency": {
        const num = typeof value === "number" ? value : parseFloat(String(value));
        td.textContent = isNaN(num) ? "-" : this.formatNumber(num);
        break;
      }
      case "number": {
        const num = typeof value === "number" ? value : parseFloat(String(value));
        td.textContent = isNaN(num) ? "-" : this.formatNumber(num);
        break;
      }
      case "date":
        this.renderDate(td, row, col, value);
        break;
      default:
        td.textContent = String(value);
    }

    if (!this.isReadOnly && col.type === "computed") {
      this.makeComputedEditable(td, col);
      setFieldTooltip(td, this.getTooltipValue(col, value), t("cell.doubleClickEditFormula"));
    } else if (!this.isReadOnly && this.isEditableCellColumn(col)) {
      td.addClass("db-editable-cell");
      this.makeEditable(td, row, col, value);
      setFieldTooltip(td, this.getTooltipValue(col, value), t("cell.doubleClickEdit"));
    } else if (!this.isReadOnly && isReadonlyFileField(col.key)) {
      this.makeReadonlyFileFieldNotice(td, col);
      setFieldTooltip(td, this.getTooltipValue(col, value), t("fileField.readonly", { label: col.label || col.key }));
    } else {
      setFieldTooltip(td, this.getTooltipValue(col, value));
    }
  }

  private getEffectiveDisplayType(col: ColumnDef): ColumnDef["type"] {
    if (isFileFieldKey(col.key)) return getFileFieldFixedType(col.key);
    return getColumnDisplayType(col, this.getComputedFields());
  }

  private isEditableCellColumn(col: ColumnDef): boolean {
    if (col.type === "computed") return false;
    if (!isFileFieldKey(col.key)) return true;
    return col.key === "file.tags";
  }

  private renderStatus(td: HTMLElement, col: ColumnDef, status: string): void {
    const badge = td.createSpan({ cls: "status-badge" });
    badge.textContent = status;
    badge.title = status;
    const option = col.statusOptions?.find((item) => normalizeOptionValueForKey(col.key, item.value) === status);
    if (option) {
      badge.addClass(`status-color-${option.color}`);
    } else {
      badge.addClass("status-color-gray");
    }
  }

  private renderMultiSelect(td: HTMLElement, col: ColumnDef, value: unknown): void {
    const values = toMultiSelectValuesForKey(col.key, value);
    const wrap = td.createDiv({ cls: "db-multi-select-values" });
    setFieldTooltip(wrap, values);
    for (const item of values) {
      this.renderStatus(wrap, col, item);
    }
  }

  private getTooltipValue(col: ColumnDef, value: unknown): unknown {
    if (col.key === "file.tags") return toValidObsidianTagValues(value);
    return this.getEffectiveDisplayType(col) === "multi-select" ? toMultiSelectValuesForKey(col.key, value) : value;
  }

  private renderCheckbox(td: HTMLElement, row: RowData, col: ColumnDef, value: unknown): void {
    td.addClass("db-checkbox-cell");
    setFieldTooltip(td, toBooleanValue(value) ? t("common.true") : t("common.false"));
    const checkbox = td.createEl("input", { attr: { type: "checkbox" } });
    checkbox.checked = toBooleanValue(value);
    if (this.isReadOnly) {
      checkbox.disabled = true;
    } else if (col.type === "computed") {
      // Keep events bubbling to the cell so computed checkbox formulas are editable.
      checkbox.addClass("db-computed-checkbox-preview");
      this.makeComputedEditable(td, col);
      return;
    }
    checkbox.onclick = (event) => event.stopPropagation();
    if (this.isReadOnly) return;
    checkbox.onchange = () => {
      void this.saveValue(row, col, checkbox.checked);
    };
  }

  private renderDate(td: HTMLElement, row: RowData, col: ColumnDef, value: unknown): void {
    const str = String(value);
    td.textContent = str.substring(0, 10);

    if (!col.urgency?.enabled) return;
    const daysKey =
      col.computedKey ||
      (col.key === "next_billing" ? "renewal_days" : "days_to_eol");
    const days = row.computed[daysKey];
    if (typeof days !== "number") return;
    if (days < 0) td.addClass("urgency-red");
    else if (days <= 7) td.addClass("urgency-red");
    else if (days <= col.urgency.thresholdDays) td.addClass("urgency-orange");
    else td.addClass("urgency-green");
  }

  private makeEditable(td: HTMLElement, row: RowData, col: ColumnDef, currentValue: unknown): void {
    td.title = t("cell.doubleClickEdit");
    td.tabIndex = 0;

    const startEdit = (event?: MouseEvent) => {
      td.removeClass("db-cell-selected");
      this.startEdit(td, row, col, event, currentValue);
    };

    td.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.focusExistingEditor(td, event, false)) return;
      this.selectCell(td);
    });
    td.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      if (this.focusExistingEditor(td, event)) return;
      startEdit(event);
    });
    td.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      event.preventDefault();
      startEdit();
    });
  }

  private makeReadonlyFileFieldNotice(td: HTMLElement, col: ColumnDef): void {
    td.tabIndex = 0;
    const showNotice = () => new Notice(t("fileField.readonly", { label: col.label || col.key }));
    td.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showNotice();
    });
    td.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      showNotice();
    });
  }

  private makeComputedEditable(td: HTMLElement, col: ColumnDef): void {
    td.addClass("db-formula-cell");
    td.title = t("cell.doubleClickEditFormula");
    td.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.editFormula?.(col);
    });
  }

  startEdit(
    target: HTMLElement,
    row: RowData,
    col: ColumnDef,
    event?: MouseEvent,
    currentValue = this.getCurrentValue(row, col)
  ): void {
    if (isReadonlyFileField(col.key)) {
      new Notice(t("fileField.readonly", { label: col.label || col.key }));
      return;
    }

    if (col.type === "checkbox") {
      const checkbox = target.matches("input[type='checkbox']")
        ? target as HTMLInputElement
        : target.querySelector<HTMLInputElement>("input[type='checkbox']");
      void this.saveValue(row, col, checkbox ? checkbox.checked : !toBooleanValue(currentValue));
      return;
    }

    if (this.focusExistingEditor(target, event)) return;
    if (col.type === "computed") {
      this.editFormula?.(col);
      return;
    }
    if (col.key === "file.name") return;
    const origText = target.textContent || "";
    const anchorPoint = event ? { x: event.clientX, y: event.clientY } : undefined;

    if (col.type === "status" || col.type === "select") {
      this.editOptionPopover(target, row, col, currentValue, false, anchorPoint);
      return;
    }

    if (col.type === "multi-select") {
      this.editOptionPopover(target, row, col, currentValue, true, anchorPoint);
      return;
    }

    if (col.type === "number" || col.type === "currency") {
      this.editNumber(target, row, col, currentValue, origText);
      return;
    }

    if (col.type === "date") {
      this.editDatePopover(target, row, col, currentValue);
      return;
    }

    this.editText(target, row, col, currentValue, origText);
  }

  private focusExistingEditor(target: HTMLElement, event?: Event, preventDefault = true): boolean {
    const eventTarget = isHTMLElement(event?.target) ? event.target : null;
    const existingEditor =
      eventTarget?.closest<HTMLInputElement | HTMLTextAreaElement>("input, textarea") ||
      target.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    if (!existingEditor) return false;
    if (preventDefault) event?.preventDefault();
    event?.stopPropagation();
    existingEditor.focus();
    return true;
  }

  private getCurrentValue(row: RowData, col: ColumnDef): unknown {
    if (col.type === "computed" && col.computedKey) return row.computed[col.computedKey];
    if (isFileFieldKey(col.key)) return getRowFileFieldValue(row, col.key);
    return row.frontmatter[col.key];
  }

  private selectCell(td: HTMLElement): void {
    window.activeDocument.querySelectorAll(".note-database-container .db-cell-selected")
      .forEach((el) => el.removeClass("db-cell-selected"));
    this.addTransientClass(td, "db-cell-selected", 1200);
    td.focus();
  }

  private editOptionPopover(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: unknown,
    multiple: boolean,
    anchorPoint?: { x: number; y: number }
  ): void {
    const rawContainer = td.closest(".note-database-container");
    const container = isHTMLElement(rawContainer) ? rawContainer : null;
    const host = container || window.activeDocument.body;
    host.querySelectorAll(".db-cell-option-popover").forEach((el) => el.remove());
    const isFileTags = col.key === "file.tags";
    const optionKey = isFileTags ? "tags" : col.key;
    const originalValues = multiple
      ? (isFileTags ? toValidObsidianTagValues(currentValue) : toMultiSelectValuesForKey(optionKey, currentValue))
      : [normalizeOptionValueForKey(optionKey, currentValue)].filter(Boolean);
    const selected = new Set(originalValues);
    const popover = host.createDiv({ cls: "db-cell-option-popover" });
    let activeOptionIndex = 0;

    const close = () => {
      popover.remove();
      // Clean up any leaked color picker popups on window.activeDocument.body
      window.activeDocument.body.querySelectorAll(".db-color-picker-popup").forEach(el => el.remove());
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      window.activeDocument.removeEventListener("keydown", onKeydown, true);
    };
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (popover.contains(target) || td.contains(target))) return;
      if (target && (target as HTMLElement).closest?.(".db-color-picker-popup")) return;
      close();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (isHTMLElement(event.target) && event.target.closest("input, textarea, select")) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
      const items = Array.from(popover.querySelectorAll<HTMLButtonElement>(".db-cell-option-item"));
      if (!items.length) return;
      event.preventDefault();
      if (event.key === "ArrowDown") activeOptionIndex = Math.min(items.length - 1, activeOptionIndex + 1);
      if (event.key === "ArrowUp") activeOptionIndex = Math.max(0, activeOptionIndex - 1);
      const item = items[activeOptionIndex];
      if (event.key === "Enter") item.click();
      else item.focus();
    };
    // Build option objects from column config (mutable copies)
    const optionDefs: StatusOptionDef[] = [];
    if (isFileTags) {
      optionDefs.push(...this.getFileTagDraftOptions(col, originalValues));
    } else {
      const seenOptions = new Set<string>();
      for (const option of getColumnOptions(col)) {
        const value = normalizeOptionValueForKey(optionKey, option.value);
        if (!value || seenOptions.has(value)) continue;
        seenOptions.add(value);
        optionDefs.push({ ...option, value });
      }
      for (const v of originalValues) {
        if (v && !optionDefs.find(o => o.value === v)) {
          optionDefs.push({ value: v, color: "gray" });
        }
      }
    }

    const cloneOptions = (options: StatusOptionDef[]) => options.map((option) => ({ ...option }));
    const getCommittedOptions = () => cloneOptions(col.statusOptions || []);
    const getDraftOptions = () => isFileTags ? this.persistFileTagColorOptions(optionDefs) : cloneOptions(optionDefs);
    const commitOptionTransaction = async (transaction: CellOptionTransaction) => {
      try {
        if (this.commitCellOptionTransaction) {
          await this.commitCellOptionTransaction(row, col, transaction);
          return;
        }
        if (transaction.nextOptions) {
          col.statusOptions = cloneOptions(transaction.nextOptions);
          col.statusPresetId = undefined;
        }
        if (transaction.setValue) await this.saveValue(row, col, transaction.value);
        else await this.refreshAfterSave();
      } catch (err) {
        console.error("Note Database: failed to commit option edit", err);
        new Notice(t("errors.updateFailed", { error: String(err) }));
      }
    };
    const commitValue = (value: unknown) => {
      void commitOptionTransaction({ setValue: true, value: this.normalizeCellValueForSave(col, value) });
    };
    const commitOptions = (transaction: Omit<CellOptionTransaction, "previousOptions" | "nextOptions"> = {}) => {
      void commitOptionTransaction({
        previousOptions: getCommittedOptions(),
        nextOptions: getDraftOptions(),
        ...transaction,
      });
    };

    const renderOptionList = () => {
      // Rebuild transient option rows and empty state from the current local selection set.
      popover.querySelectorAll(".db-cell-option-item, .db-panel-empty, .db-option-drop-line").forEach(el => el.remove());
      activeOptionIndex = 0;
      if (optionDefs.length === 0) {
        const empty = popover.createDiv({ cls: "db-panel-empty", text: t("cell.noOptions") });
        popover.insertBefore(empty, popover.querySelector(".db-cell-option-add"));
      }
      optionDefs.forEach((opt, idx) => {
        if (selected.has(opt.value)) activeOptionIndex = idx;
        const item = popover.createEl("button", { cls: "db-cell-option-item" });
        popover.insertBefore(item, popover.querySelector(".db-cell-option-add"));

        // Drag handle for reorder
        const handle = item.createSpan({ cls: "db-option-drag-handle", text: "⠿" });
        if (isFileTags) handle.addClass("is-hidden");
        handle.onmousedown = (e) => {
          if (isFileTags) return;
          e.stopPropagation();
          e.preventDefault();

          item.addClass("is-dragging");
          const dragPreview = this.createOptionDragPreview(item, e);
          let dropLine: HTMLElement | null = null;
          let lastTarget = idx;

          const removeDropLine = () => { dropLine?.remove(); dropLine = null; };

          const onMove = (ev: MouseEvent) => {
            this.updateOptionDragPreview(dragPreview, ev);
            // Find insert-before position in DOM
            const items = Array.from(popover.querySelectorAll<HTMLButtonElement>(".db-cell-option-item"));
            let insertBefore = items.length;
            for (let i = 0; i < items.length; i++) {
              const ir = items[i].getBoundingClientRect();
              if (ev.clientY < ir.top + ir.height / 2) {
                insertBefore = i;
                break;
              }
            }

            // Convert to target array index after removing dragged item
            const target = insertBefore <= idx ? insertBefore : insertBefore - 1;

            if (target !== idx) {
              removeDropLine();
              dropLine = popover.createDiv({ cls: "db-option-drop-line" });
              const ref = items[insertBefore];
              if (ref) popover.insertBefore(dropLine, ref);
              else popover.insertBefore(dropLine, popover.querySelector(".db-cell-option-add"));
              lastTarget = target;
            } else {
              removeDropLine();
              lastTarget = idx;
            }
          };

          const onUp = () => {
            removeDropLine();
            item.removeClass("is-dragging");
            this.removeOptionDragPreview(dragPreview);
            if (lastTarget !== idx && lastTarget >= 0 && lastTarget < optionDefs.length) {
              const [moved] = optionDefs.splice(idx, 1);
              optionDefs.splice(lastTarget, 0, moved);
              commitOptions();
              renderOptionList();
            }
            window.activeDocument.removeEventListener("mousemove", onMove);
            window.activeDocument.removeEventListener("mouseup", onUp);
          };

          window.activeDocument.addEventListener("mousemove", onMove);
          window.activeDocument.addEventListener("mouseup", onUp);
        };

        const moveControls = item.createSpan({ cls: "db-mobile-reorder-controls" });
        if (isFileTags) moveControls.addClass("is-hidden");
        const upBtn = moveControls.createEl("button", {
          attr: { type: "button", title: t("menu.moveUp"), "aria-label": t("menu.moveUp") },
        });
        setIcon(upBtn, "arrow-up");
        upBtn.disabled = idx === 0;
        upBtn.onclick = (event) => {
          if (isFileTags) return;
          event.preventDefault();
          event.stopPropagation();
          const [moved] = optionDefs.splice(idx, 1);
          optionDefs.splice(idx - 1, 0, moved);
          commitOptions();
          renderOptionList();
        };
        const downBtn = moveControls.createEl("button", {
          attr: { type: "button", title: t("menu.moveDown"), "aria-label": t("menu.moveDown") },
        });
        setIcon(downBtn, "arrow-down");
        downBtn.disabled = idx >= optionDefs.length - 1;
        downBtn.onclick = (event) => {
          if (isFileTags) return;
          event.preventDefault();
          event.stopPropagation();
          const [moved] = optionDefs.splice(idx, 1);
          optionDefs.splice(idx + 1, 0, moved);
          commitOptions();
          renderOptionList();
        };

        // Color dot — opens color picker
        const dot = item.createSpan({ cls: "db-option-color-dot" });
        const updateDot = () => {
          dot.className = `db-option-color-dot db-option-color-${opt.color}`;
        };
        updateDot();
        dot.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          showColorPicker(dot, opt, () => { commitOptions(); updateDot(); });
        };

        // Label — double-click to rename
        const label = item.createSpan({ text: opt.value, cls: "db-option-label" });
        label.ondblclick = (e) => {
          if (isFileTags) return;
          e.stopPropagation();
          e.preventDefault();
          const input = window.activeDocument.createElement("input");
          input.type = "text";
          input.value = opt.value;
          input.className = "db-option-rename-input";
          label.replaceWith(input);
          input.focus();
          input.select();
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            const name = input.value.trim();
            if (name && name !== opt.value && !optionDefs.some(o => o !== opt && o.value === name)) {
              const oldValue = opt.value;
              opt.value = name;
              if (selected.has(oldValue)) {
                selected.delete(oldValue);
                selected.add(name);
              }
              commitOptions({ renameValues: [{ from: oldValue, to: name }] });
            }
            input.replaceWith(label);
            label.textContent = opt.value;
          };
          input.onblur = finish;
          input.onkeydown = (ev) => {
            if (ev.key === "Enter") finish();
            if (ev.key === "Escape") { finished = true; input.replaceWith(label); }
          };
        };

        // Check mark
        const mark = item.createSpan({ text: selected.has(opt.value) ? "✓" : "", cls: "db-option-check" });
        const deleteButton = item.createEl("button", {
          cls: "db-option-delete",
          attr: { title: t("common.delete"), "aria-label": t("common.delete") },
        });
        if (isFileTags) deleteButton.addClass("is-hidden");
        setIcon(deleteButton, "trash");
        deleteButton.onmousedown = (event) => event.preventDefault();
        deleteButton.onclick = async (event) => {
          if (isFileTags) return;
          event.preventDefault();
          event.stopPropagation();
          if (!this.app || !await confirmWithModal(this.app, {
            title: t("common.delete"),
            message: t("modal.confirmDeleteOption", { name: opt.value }),
            confirmText: t("common.delete"),
            danger: true,
          })) return;
          const removed = opt.value;
          optionDefs.splice(idx, 1);
          const wasSelected = selected.delete(removed);
          commitOptions({
            cleanupRemovedValues: [removed],
            setValue: wasSelected,
            value: multiple ? this.normalizeCellValueForSave(col, Array.from(selected)) : null,
          });
          renderOptionList();
        };
        deleteButton.onkeydown = (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          deleteButton.click();
        };

        item.onmousedown = (event) => event.preventDefault();
        item.onclick = () => {
          if (!multiple) {
            selected.clear();
            selected.add(opt.value);
            commitValue(opt.value);
            // Update check marks
            popover.querySelectorAll(".db-option-check").forEach(el => { el.textContent = ""; });
            mark.textContent = "✓";
            return;
          }
          if (selected.has(opt.value)) selected.delete(opt.value);
          else selected.add(opt.value);
          mark.textContent = selected.has(opt.value) ? "✓" : "";
          commitValue(Array.from(selected));
        };
      });
    };

    // Color picker popup — always on body to avoid container overflow/transform issues
    const showColorPicker = (anchor: HTMLElement, opt: StatusOptionDef, onUpdate: () => void) => {
      window.activeDocument.body.querySelectorAll(".db-color-picker-popup").forEach(el => el.remove());
      const picker = window.activeDocument.body.createDiv({ cls: "db-color-picker-popup" });
      OPTION_COLORS.forEach(color => {
        const swatch = picker.createSpan({
          cls: `db-color-picker-swatch db-option-color-${color}${color === opt.color ? " is-selected" : ""}`,
          attr: { role: "button", tabindex: "0", title: color, "aria-label": color },
        });
        swatch.onclick = (e) => {
          e.stopPropagation();
          const oldColor = opt.color;
          opt.color = color;
          onUpdate();
          // Update visible cells in the table immediately
          if (container) {
            container.querySelectorAll(`.status-color-${oldColor}`).forEach((badge: Element) => {
              if (badge.textContent === opt.value) {
                badge.removeClass(`status-color-${oldColor}`);
                badge.addClass(`status-color-${color}`);
              }
            });
          }
          picker.remove();
        };
        swatch.onkeydown = (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          swatch.click();
        };
      });
      const rect = anchor.getBoundingClientRect();
      picker.setCssProps({ left: `${rect.left}px`, top: `${rect.top}px` });
      const closePicker = (e: MouseEvent) => {
        if (!picker.contains(e.target as Node)) {
          picker.remove();
          window.activeDocument.removeEventListener("mousedown", closePicker, true);
        }
      };
      window.setTimeout(() => window.activeDocument.addEventListener("mousedown", closePicker, true), 0);
    };

    // New option input
    const addRow = popover.createDiv({ cls: "db-cell-option-add" });
    const addInput = addRow.createEl("input", {
      attr: { placeholder: t("cell.addOption"), type: "text" },
    });
    addInput.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (isFileTags) {
        const invalidTags = getInvalidObsidianTagValues([addInput.value]);
        if (invalidTags.length > 0) {
          new Notice(t("fileField.invalidTag", { tag: invalidTags[0] }));
          return;
        }
      }
      const name = isFileTags ? normalizeValidObsidianTagValue(addInput.value) : normalizeOptionValueForKey(optionKey, addInput.value);
      if (!name) return;
      if (optionDefs.some(o => o.value === name)) {
        new Notice(t("cell.optionExists", { name }));
        return;
      }
      optionDefs.push({ value: name, color: isFileTags ? "gray" : OPTION_COLORS[optionDefs.length % OPTION_COLORS.length] });
      addInput.value = "";
      if (!multiple) {
        selected.clear();
        selected.add(name);
        popover.querySelectorAll(".db-option-check").forEach(el => { el.textContent = ""; });
        if (isFileTags) commitValue(name);
        else commitOptions({ setValue: true, value: name });
      } else {
        selected.add(name);
        if (isFileTags) commitValue(Array.from(selected));
        else commitOptions({ setValue: true, value: Array.from(selected) });
      }
      renderOptionList();
    };

    // Clear button (at bottom)
    const actions = popover.createDiv({ cls: "db-panel-header-actions" });
    const clearBtn = actions.createEl("button", { cls: "db-panel-button", text: t("cell.clear") });
    clearBtn.onmousedown = (event) => event.preventDefault();
    clearBtn.onclick = () => {
      if (multiple) {
        selected.clear();
        commitValue([]);
        popover.querySelectorAll(".db-option-check").forEach(el => { el.textContent = ""; });
      } else {
        selected.clear();
        commitValue(null);
        popover.querySelectorAll(".db-option-check").forEach(el => { el.textContent = ""; });
      }
    };

    renderOptionList();
    this.positionOptionPopover(popover, td, container, anchorPoint);
    window.requestAnimationFrame(() => this.positionOptionPopover(popover, td, container, anchorPoint));
    window.activeDocument.addEventListener("mousedown", onOutside, true);
    window.activeDocument.addEventListener("keydown", onKeydown, true);
  }

  private editNumber(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: unknown,
    origText: string
  ): void {
    this.editSingleLinePopover(td, safeString(currentValue), "number", async (inputValue) => {
      const raw = inputValue;
      const newVal = raw ? parseFloat(raw) : "";
      if (String(newVal) !== String(currentValue)) {
        await this.saveValue(row, col, newVal);
      } else {
        td.textContent = origText;
      }
      this.clearTransientClass(td, "db-cell-editing");
    }, () => {
      td.textContent = origText;
      this.clearTransientClass(td, "db-cell-editing");
    });
  }

  private editDate(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: unknown,
    origText: string
  ): void {
    this.addTransientClass(td, "db-cell-editing", 1600);
    td.textContent = "";

    const parts = safeString(currentValue).substring(0, 10).split("-");
    const initYear = parts[0] || "";
    const initMonth = parts[1] || "";
    const initDay = parts[2] || "";

    const container = td.createDiv({ cls: "db-date-segments" });
    const yearInp = container.createEl("input", { cls: "db-date-seg", attr: { maxlength: "4", placeholder: "YYYY" } });
    container.createSpan({ cls: "db-date-sep", text: "-" });
    const monthInp = container.createEl("input", { cls: "db-date-seg", attr: { maxlength: "2", placeholder: "MM" } });
    container.createSpan({ cls: "db-date-sep", text: "-" });
    const dayInp = container.createEl("input", { cls: "db-date-seg", attr: { maxlength: "2", placeholder: "DD" } });

    const inputs = [yearInp, monthInp, dayInp];
    let committed = false;

    const pad2 = (v: string) => v.length === 1 ? `0${v}` : v;

    const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysInMonth = (y: number, m: number) => {
      if (m === 2) return isLeapYear(y) ? 29 : 28;
      if ([4, 6, 9, 11].includes(m)) return 30;
      return 31;
    };

    const commit = async () => {
      if (committed) return;
      committed = true;
      const y = yearInp.value;
      const rawM = monthInp.value;
      const rawD = dayInp.value;
      const allEmpty = !y && !rawM && !rawD;
      if (allEmpty) {
        if (safeString(currentValue).substring(0, 10)) {
          await this.saveValue(row, col, null);
        } else {
          restore();
        }
        this.clearTransientClass(td, "db-cell-editing");
        return;
      }
      if (!y || !rawM || !rawD) {
        restore();
        return;
      }
      const m = parseInt(rawM, 10);
      const d = parseInt(rawD, 10);
      const yr = parseInt(y, 10);
      if (isNaN(yr) || isNaN(m) || isNaN(d) || m < 1 || m > 12) {
        restore();
        return;
      }
      const maxD = daysInMonth(yr, m);
      const clampedD = Math.min(Math.max(d, 1), maxD);
      const newVal = `${y}-${pad2(String(m))}-${pad2(String(clampedD))}`;
      if (newVal !== safeString(currentValue).substring(0, 10)) {
        await this.saveValue(row, col, newVal);
      } else {
        restore();
      }
      this.clearTransientClass(td, "db-cell-editing");
    };

    const restore = () => {
      this.clearTransientClass(td, "db-cell-editing");
      td.textContent = origText;
    };

    // Use relatedTarget to detect if focus is moving to another segment.
    // During blur, window.activeDocument.activeElement hasn't updated yet, so isInternalFocus()
    // using activeElement would fail for user-initiated focus changes (clicks).
    const isMovingToSegment = (e: FocusEvent) =>
      inputs.includes(e.relatedTarget as HTMLInputElement);

    const handleSegmentKey = (
      event: KeyboardEvent,
      input: HTMLInputElement,
      prev?: HTMLInputElement,
      _next?: HTMLInputElement,
    ) => {
      // Allow navigation and control keys
      if (["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        if (event.key === "Backspace" && input.value === "" && prev) {
          event.preventDefault();
          prev.focus();
        }
        return;
      }
      if (event.key === "Enter") { event.preventDefault(); void commit(); return; }
      if (event.key === "Escape") { committed = true; restore(); return; }
      // Block non-digits
      if (!/^\d$/.test(event.key)) { event.preventDefault(); return; }
    };

    // Year: auto-advance when 4 digits
    yearInp.value = initYear;
    yearInp.onkeydown = (e) => handleSegmentKey(e, yearInp, undefined, monthInp);
    yearInp.oninput = () => {
      yearInp.value = yearInp.value.replace(/\D/g, "");
      if (yearInp.value.length === 4) { monthInp.focus(); monthInp.select(); }
    };
    yearInp.onblur = (e) => { if (!committed && !isMovingToSegment(e)) void commit(); };

    // Month: smart auto-advance
    monthInp.value = initMonth;
    monthInp.onkeydown = (e) => handleSegmentKey(e, monthInp, yearInp, dayInp);
    monthInp.oninput = () => {
      monthInp.value = monthInp.value.replace(/\D/g, "");
      const v = monthInp.value;
      if (v.length === 1 && /^[2-9]$/.test(v)) {
        monthInp.value = `0${v}`;
        dayInp.focus();
        dayInp.select();
      } else if (v.length === 2) {
        dayInp.focus();
        dayInp.select();
      }
    };
    monthInp.onblur = (e) => { if (!committed && !isMovingToSegment(e)) void commit(); };

    // Day: auto-advance → commit
    dayInp.value = initDay;
    dayInp.onkeydown = (e) => handleSegmentKey(e, dayInp, monthInp);
    dayInp.oninput = () => {
      dayInp.value = dayInp.value.replace(/\D/g, "");
      const v = dayInp.value;
      if (v.length === 1 && /^[3-9]$/.test(v)) {
        dayInp.value = `0${v}`;
        void commit();
      } else if (v.length === 2) {
        void commit();
      }
    };
    dayInp.onblur = (e) => { if (!committed && !isMovingToSegment(e)) void commit(); };

    yearInp.focus();
    yearInp.select();
  }

  private editDatePopover(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: unknown,
  ): void {
    const rawContainer = td.closest(".note-database-container");
    const container = isHTMLElement(rawContainer) ? rawContainer : null;
    const isMobile = Platform.isMobile || window.activeDocument.body.classList.contains("is-phone");
    const host = isMobile ? null : (container || window.activeDocument.body);

    this.activeTextEditClose?.();
    td.addClass("db-cell-editing");

    const parts = safeString(currentValue).substring(0, 10).split("-");
    const initYear = parts[0] || "";
    const initMonth = parts[1] || "";
    const initDay = parts[2] || "";

    let popover: HTMLElement;
    let closeBtn: HTMLButtonElement | undefined;
    let editScrollContainer: HTMLElement | null = null;

    if (isMobile) {
      editScrollContainer = td.closest(".note-database-container")
        || td.closest(".markdown-preview-view")
        || window.activeDocument.body;

      popover = editScrollContainer.createDiv({ cls: "db-cell-edit-popover is-mobile is-inline-overlay db-date-edit-popover" });

      const containerRect = editScrollContainer.getBoundingClientRect();
      const tdRect = td.getBoundingClientRect();
      const scrollTop = editScrollContainer.scrollTop || 0;
      const relativeTop = tdRect.top - containerRect.top + scrollTop;

      popover.setCssProps({ position: "absolute", left: "0", right: "0", top: `${relativeTop + tdRect.height + 2}px`, zIndex: "1000" });

      closeBtn = popover.createEl("button", {
        cls: "db-cell-edit-close",
        attr: { type: "button", title: t("common.cancel"), "aria-label": t("common.cancel") },
      });
      setIcon(closeBtn, "x");
    } else {
      popover = (host as HTMLElement).createDiv({ cls: "db-cell-edit-popover db-date-edit-popover" });
    }

    const segments = popover.createDiv({ cls: "db-date-segments" });
    const yearInp = segments.createEl("input", { cls: "db-date-seg", attr: { maxlength: "4", placeholder: "YYYY" } });
    segments.createSpan({ cls: "db-date-sep", text: "-" });
    const monthInp = segments.createEl("input", { cls: "db-date-seg", attr: { maxlength: "2", placeholder: "MM" } });
    segments.createSpan({ cls: "db-date-sep", text: "-" });
    const dayInp = segments.createEl("input", { cls: "db-date-seg", attr: { maxlength: "2", placeholder: "DD" } });

    const inputs = [yearInp, monthInp, dayInp];
    let committed = false;

    const pad2 = (v: string) => v.length === 1 ? `0${v}` : v;
    const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysInMonth = (y: number, m: number) => {
      if (m === 2) return isLeapYear(y) ? 29 : 28;
      if ([4, 6, 9, 11].includes(m)) return 30;
      return 31;
    };

    const close = () => {
      popover.remove();
      td.removeClass("db-cell-editing");
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      window.activeDocument.removeEventListener("keydown", onDocumentKeydown, true);
      if (this.activeTextEditClose === close) this.activeTextEditClose = undefined;
    };
    this.activeTextEditClose = close;

    const commit = async () => {
      if (committed) return;
      committed = true;
      const y = yearInp.value;
      const rawM = monthInp.value;
      const rawD = dayInp.value;
      const allEmpty = !y && !rawM && !rawD;
      if (allEmpty) {
        if (safeString(currentValue).substring(0, 10)) {
          await this.saveValue(row, col, null);
        }
        close();
        return;
      }
      if (!y || !rawM || !rawD) { close(); return; }
      const m = parseInt(rawM, 10);
      const d = parseInt(rawD, 10);
      const yr = parseInt(y, 10);
      if (isNaN(yr) || isNaN(m) || isNaN(d)) { close(); return; }
      const clampedM = Math.min(Math.max(m, 1), 12);
      const maxD = daysInMonth(yr, clampedM);
      const clampedD = Math.min(Math.max(d, 1), maxD);
      if (m !== clampedM || d !== clampedD) {
        new Notice(t("cell.invalidDate"));
      }
      const newVal = `${y}-${pad2(String(clampedM))}-${pad2(String(clampedD))}`;
      if (newVal !== safeString(currentValue).substring(0, 10)) {
        await this.saveValue(row, col, newVal);
      }
      close();
    };

    const cancel = () => {
      if (committed) return;
      committed = true;
      close();
    };

    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (popover.contains(target) || td.contains(target))) return;
      void commit();
    };

    const onDocumentKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };

    const isMovingToSegment = (e: FocusEvent) =>
      inputs.includes(e.relatedTarget as HTMLInputElement);

    const handleSegmentKey = (
      event: KeyboardEvent,
      input: HTMLInputElement,
      prev?: HTMLInputElement,
    ) => {
      if (["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        if (event.key === "Backspace" && input.value === "" && prev) {
          event.preventDefault();
          prev.focus();
        }
        return;
      }
      if (event.key === "Enter") { event.preventDefault(); void commit(); return; }
      if (event.key === "Escape") { cancel(); return; }
      if (!/^\d$/.test(event.key)) { event.preventDefault(); return; }
    };

    yearInp.value = initYear;
    yearInp.onkeydown = (e) => handleSegmentKey(e, yearInp, undefined);
    yearInp.oninput = () => {
      yearInp.value = yearInp.value.replace(/\D/g, "");
      if (yearInp.value.length === 4) { monthInp.focus(); monthInp.select(); }
    };
    yearInp.onblur = (e) => { if (!committed && !isMovingToSegment(e)) void commit(); };

    monthInp.value = initMonth;
    monthInp.onkeydown = (e) => handleSegmentKey(e, monthInp, yearInp);
    monthInp.oninput = () => {
      monthInp.value = monthInp.value.replace(/\D/g, "");
      const v = monthInp.value;
      if (v.length === 1 && /^[2-9]$/.test(v)) {
        monthInp.value = `0${v}`;
        dayInp.focus();
        dayInp.select();
      } else if (v.length === 2) {
        dayInp.focus();
        dayInp.select();
      }
    };
    monthInp.onblur = (e) => { if (!committed && !isMovingToSegment(e)) void commit(); };

    dayInp.value = initDay;
    dayInp.onkeydown = (e) => handleSegmentKey(e, dayInp, monthInp);
    dayInp.oninput = () => {
      dayInp.value = dayInp.value.replace(/\D/g, "");
      const v = dayInp.value;
      if (v.length === 1 && /^[4-9]$/.test(v)) {
        dayInp.value = `0${v}`;
        void commit();
      } else if (v.length === 2) {
        void commit();
      }
    };
    dayInp.onblur = (e) => { if (!committed && !isMovingToSegment(e)) void commit(); };

    if (closeBtn) {
      closeBtn.onmousedown = (event) => event.preventDefault();
      closeBtn.onclick = cancel;
    }

    if (!isMobile) {
      window.requestAnimationFrame(() => {
        this.positionDateEditPopover(popover, td, container);
        yearInp.focus();
        yearInp.select();
      });
    } else {
      window.setTimeout(() => {
        yearInp.focus();
        yearInp.select();
      }, 50);
    }

    window.setTimeout(() => {
      window.activeDocument.addEventListener("mousedown", onOutside, true);
      window.activeDocument.addEventListener("keydown", onDocumentKeydown, true);
    }, 0);
  }

  private positionDateEditPopover(popover: HTMLElement, td: HTMLElement, container: HTMLElement | null): void {
    const margin = 8;
    const rect = td.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const bounds = getVisiblePopoverBounds(container);
    const width = Math.max(popoverRect.width || 170, 170);
    const left = clamp(rect.left, bounds.left + margin, bounds.right - width - margin);
    const height = popoverRect.height || 36;
    const below = bounds.bottom - rect.top - margin;
    const above = rect.bottom - bounds.top - margin;
    const useAbove = above > below && below < height;
    const top = useAbove ? rect.bottom - height : rect.top;
    const clampedTop = clamp(top, bounds.top + margin, bounds.bottom - height - margin);

    popover.setCssProps({ width: `${width}px` });
    setPosition(
      popover,
      left,
      clampedTop,
      container?.getBoundingClientRect(),
      container?.scrollLeft || 0,
      container?.scrollTop || 0
    );
  }

  private editText(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: unknown,
    origText: string
  ): void {
    const valueText = safeString(currentValue);
    if (this.shouldUsePopoverEditor(td, col, valueText)) {
      this.editTextPopover(td, row, col, valueText);
      return;
    }
    const inp = window.activeDocument.createElement("input");
    inp.className = "db-cell-input";
    inp.type = "text";
    inp.value = valueText;
    this.mountInput(td, inp);

    let committed = false;

    const save = async () => {
      if (committed) return;
      committed = true;
      const newVal = inp.value;
      if (newVal !== safeString(currentValue)) {
        await this.saveValue(row, col, newVal);
      } else {
        this.restoreTextDisplay(td, currentValue, origText);
      }
      this.clearTransientClass(td, "db-cell-editing");
    };

    inp.onblur = save;
    inp.onkeydown = (event) => this.handleEditKey(event, save, () => {
      committed = true;
      this.restoreTextDisplay(td, currentValue, origText);
      this.clearTransientClass(td, "db-cell-editing");
    });
  }

  private editTextPopover(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: string
  ): void {
    const rawContainer = td.closest(".note-database-container");
    const container = isHTMLElement(rawContainer) ? rawContainer : null;
    const isMobile = Platform.isMobile || window.activeDocument.body.classList.contains("is-phone");
    const host = isMobile ? null : (container || window.activeDocument.body);

    // 清理之前的编辑器
    this.activeTextEditClose?.();
    td.addClass("db-cell-editing");

    let popover: HTMLElement;
    let textarea: HTMLTextAreaElement;
    let closeBtn: HTMLButtonElement | undefined;
    let editScrollContainer: HTMLElement | null = null;

    if (isMobile) {
      // ========== 移动端：Inline Overlay 方案 ==========
      // 在单元格所在的滚动容器内直接插入编辑器，不脱离文档流

      editScrollContainer = td.closest(".note-database-container")
        || td.closest(".markdown-preview-view")
        || window.activeDocument.body;
      
      // 创建内联编辑器包装器
      popover = editScrollContainer.createDiv({ cls: "db-cell-edit-popover is-mobile is-inline-overlay" });
      
      // 计算相对于滚动容器的位置
      const containerRect = editScrollContainer.getBoundingClientRect();
      const tdRect = td.getBoundingClientRect();
      const scrollTop = editScrollContainer.scrollTop || 0;
      
      // 相对位置 = 单元格顶部 - 容器顶部 + 容器滚动偏移
      const relativeTop = tdRect.top - containerRect.top + scrollTop;
      
      // 定位在单元格正下方
      popover.setCssProps({ position: "absolute", left: "0", right: "0", top: `${relativeTop + tdRect.height + 2}px`, zIndex: "1000" });
      
      // 关闭按钮
      closeBtn = popover.createEl("button", {
        cls: "db-cell-edit-close",
        attr: { type: "button", title: t("common.cancel"), "aria-label": t("common.cancel") },
      });
      setIcon(closeBtn, "x");
      
      // 文本输入区
      textarea = window.activeDocument.createElement("textarea");
      textarea.className = "db-cell-textarea db-mobile-textarea";
      textarea.value = currentValue;
      popover.appendChild(textarea);
      
    } else {
      // ========== 桌面端：原有 Fixed Popover 方案 ==========
      popover = (host as HTMLElement).createDiv({ cls: "db-cell-edit-popover" });
      
      textarea = window.activeDocument.createElement("textarea");
      textarea.className = "db-cell-textarea";
      textarea.value = currentValue;
      textarea.rows = 1;
      popover.appendChild(textarea);
    }

    let committed = false;

    const close = () => {
      popover.remove();
      td.removeClass("db-cell-editing");
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      window.activeDocument.removeEventListener("keydown", onDocumentKeydown, true);
      if (this.activeTextEditClose === close) this.activeTextEditClose = undefined;
    };
    this.activeTextEditClose = close;

    const save = async () => {
      if (committed) return;
      committed = true;
      const newVal = textarea.value;
      if (newVal !== currentValue) {
        await this.saveValue(row, col, newVal);
      }
      close();
    };

    const cancel = () => {
      if (committed) return;
      committed = true;
      close();
    };

    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (popover.contains(target) || td.contains(target))) return;
      void save();
    };
    
    const onDocumentKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    
    const resize = () => {
      this.autoGrowTextarea(textarea, isMobile ? 320 : 260);
      if (!isMobile) {
        this.positionTextEditPopover(popover, td, container, false);
      }
    };

    if (closeBtn) {
      closeBtn.onmousedown = (event) => event.preventDefault();
      closeBtn.onclick = cancel;
    }
    
    textarea.addEventListener("input", resize);
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void save();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });

    // 移动端特殊处理：确保键盘弹出后编辑器可见
    if (isMobile) {
      // 自动增长高度
      this.autoGrowTextarea(textarea, 320);
      
      // 延迟聚焦，等待 DOM 稳定
      window.setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        
        // 关键：键盘弹出后，滚动编辑器到可视区域中心
        window.setTimeout(() => {
          // 重新计算位置（因为聚焦可能导致布局变化）
          const newTdRect = td.getBoundingClientRect();
          const viewportHeight = window.visualViewport?.height || window.innerHeight;
          const keyboardHeight = window.innerHeight - viewportHeight;
          
          if (keyboardHeight > 100) {
            // 键盘已弹出，确保编辑器在可视区域内
            const popoverRect = popover.getBoundingClientRect();
            const visibleTop = window.visualViewport?.pageTop || window.scrollY;
            const visibleBottom = visibleTop + viewportHeight;
            
            // 如果编辑器底部被键盘遮挡，向上滚动容器
            if (popoverRect.bottom > visibleBottom - 20 && editScrollContainer) {
              const scrollNeeded = popoverRect.bottom - visibleBottom + 60; // 60px 缓冲
              editScrollContainer.scrollBy({ top: scrollNeeded, behavior: "smooth" });
            }
            
            // 同时确保单元格也在可视区域
            if (newTdRect.top < visibleTop + 50) {
              td.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }
        }, 350); // 等待键盘弹出动画完成（iOS 约 300ms）
      }, 50);
      
    } else {
      // 桌面端原有逻辑
      resize();
      window.requestAnimationFrame(resize);
      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
    }

    // 绑定全局关闭事件
    window.setTimeout(() => {
      window.activeDocument.addEventListener("mousedown", onOutside, true);
      window.activeDocument.addEventListener("keydown", onDocumentKeydown, true);
    }, 0);
  }

  private restoreTextDisplay(td: HTMLElement, currentValue: unknown, origText: string): void {
    td.textContent = origText || safeString(currentValue);
  }

  private shouldUsePopoverEditor(_target: HTMLElement, col: ColumnDef, _value: string): boolean {
    return col.type === "text";
  }

  private editSingleLinePopover(
    td: HTMLElement,
    currentValue: string,
    inputType: "text" | "number",
    saveValue: (value: string) => Promise<void>,
    restore: () => void
  ): void {
    const rawContainer = td.closest(".note-database-container");
    const container = isHTMLElement(rawContainer) ? rawContainer : null;
    const host = container || window.activeDocument.body;
    this.activeTextEditClose?.();
    td.addClass("db-cell-popover-editing");

    const popover = host.createDiv({ cls: "db-cell-edit-popover db-cell-line-edit-popover" });
    const input = popover.createEl("input", {
      cls: "db-cell-line-input",
      attr: { type: inputType },
    });
    if (inputType === "number") input.setAttr("step", "any");
    input.value = currentValue;

    let committed = false;
    const close = () => {
      popover.remove();
      td.removeClass("db-cell-popover-editing");
      window.activeDocument.removeEventListener("mousedown", onOutside, true);
      window.activeDocument.removeEventListener("keydown", onDocumentKeydown, true);
      if (this.activeTextEditClose === close) this.activeTextEditClose = undefined;
    };
    this.activeTextEditClose = close;

    const save = async () => {
      if (committed) return;
      committed = true;
      await saveValue(input.value);
      close();
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      restore();
      close();
    };
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (popover.contains(target) || td.contains(target))) return;
      void save();
    };
    const onDocumentKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };

    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void save();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    this.positionTextEditPopover(popover, td, container, false);
    window.requestAnimationFrame(() => {
      this.positionTextEditPopover(popover, td, container, false);
      input.focus();
      input.select();
    });
    window.setTimeout(() => {
      window.activeDocument.addEventListener("mousedown", onOutside, true);
      window.activeDocument.addEventListener("keydown", onDocumentKeydown, true);
    }, 0);
  }

  private mountInput(td: HTMLElement, input: HTMLInputElement): void {
    this.addTransientClass(td, "db-cell-editing", 1600);
    input.setCssProps({ width: "100%" });
    td.textContent = "";
    td.appendChild(input);
    input.focus();
    input.select();
  }

  private autoGrowTextarea(textarea: HTMLTextAreaElement, maxHeight: number): void {
    textarea.setCssProps({ height: "auto" });
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.setCssProps({ height: `${nextHeight}px`, overflowY: textarea.scrollHeight > maxHeight ? "auto" : "hidden" });
  }

  private positionTextEditPopover(popover: HTMLElement, td: HTMLElement, container: HTMLElement | null, isMobile = false): void {
    if (isMobile) {
      popover.setCssProps({ left: "10px", right: "10px", bottom: "calc(10px + env(safe-area-inset-bottom, 0px))", top: "", width: "auto" });
      return;
    }
    const margin = 8;
    const rect = td.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const bounds = getVisiblePopoverBounds(container);
    const width = Math.min(Math.max(rect.width, popoverRect.width || 0, 220), Math.min(520, bounds.width - margin * 2));
    const left = clamp(rect.left, bounds.left + margin, bounds.right - width - margin);
    const below = bounds.bottom - rect.top - margin;
    const above = rect.bottom - bounds.top - margin;
    const height = Math.min(popover.scrollHeight || popoverRect.height || 0, bounds.height - margin * 2);
    const useAbove = above > below && below < height;
    const top = useAbove ? rect.bottom - height : rect.top;
    const clampedTop = clamp(top, bounds.top + margin, bounds.bottom - height - margin);

    popover.setCssProps({ width: `${width}px` });
    setPosition(
      popover,
      left,
      clampedTop,
      container?.getBoundingClientRect(),
      container?.scrollLeft || 0,
      container?.scrollTop || 0
    );
  }

  private handleEditKey(
    event: KeyboardEvent,
    save: () => Promise<void>,
    cancel: () => void
  ): void {
    if (event.key === "Enter") void save();
    if (event.key === "Escape") cancel();
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

  private async saveValue(row: RowData, col: ColumnDef, value: unknown): Promise<void> {
    try {
      const normalizedValue = this.normalizeCellValueForSave(col, value);
      if (this.saveCellValue) {
        await this.saveCellValue(row, col, normalizedValue);
        return;
      }
      await this.dataSource.updateFrontmatter(row.file, { [col.key]: normalizedValue });
      await this.refreshAfterSave();
    } catch (err) {
      new Notice(t("errors.updateFailed", { error: String(err) }));
    }
  }

  private normalizeCellValueForSave(col: ColumnDef, value: unknown): unknown {
    if (value == null) return value;
    if (col.key === "file.tags") return toValidObsidianTagValues(value);
    if (col.type === "multi-select") return toMultiSelectValuesForKey(col.key, value);
    if (col.type === "select" || col.type === "status") return normalizeOptionValueForKey(col.key, value);
    return value;
  }

  private getVaultTagOptionValues(): string[] {
    const metadataCache = this.app?.metadataCache as unknown as MetadataCacheWithTags | undefined;
    const tags = metadataCache?.getTags?.();
    if (!tags) return [];
    return Object.keys(tags)
      .map((tag) => normalizeValidObsidianTagValue(tag))
      .filter((tag): tag is string => Boolean(tag))
      .sort((a, b) => a.localeCompare(b));
  }

  private getFileTagDraftOptions(col: ColumnDef, currentValues: string[]): StatusOptionDef[] {
    const colorsByValue = new Map<string, StatusOptionDef["color"]>();
    for (const option of col.statusOptions || []) {
      const value = normalizeValidObsidianTagValue(option.value);
      if (!value) continue;
      colorsByValue.set(value, option.color || "gray");
    }

    const options: StatusOptionDef[] = [];
    const seen = new Set<string>();
    const add = (value: string) => {
      const normalized = normalizeValidObsidianTagValue(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      options.push({ value: normalized, color: colorsByValue.get(normalized) || "gray" });
    };

    for (const value of this.getVaultTagOptionValues()) add(value);
    for (const value of currentValues) add(value);
    for (const value of colorsByValue.keys()) add(value);
    return options;
  }

  private persistFileTagColorOptions(options: StatusOptionDef[]): StatusOptionDef[] {
    const persisted: StatusOptionDef[] = [];
    const seen = new Set<string>();
    for (const option of options) {
      const value = normalizeValidObsidianTagValue(option.value);
      if (!value || seen.has(value)) continue;
      const color = option.color || "gray";
      if (color === "gray") continue;
      seen.add(value);
      persisted.push({ value, color });
    }
    return persisted;
  }

  private editFileName(td: HTMLElement, row: RowData, currentName: string): void {
    const restore = () => {
      this.clearTransientClass(td, "db-cell-editing");
      td.textContent = "";
      const displayInfo = this.getFileTitleInfo(row);
      const link = td.createEl("a", {
        cls: "internal-link",
        attr: { title: displayInfo.fullPath },
      });
      renderInlineFileTitle(link, displayInfo, true);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.openNote(row);
      });
    };

    this.editSingleLinePopover(td, currentName, "text", async (value) => {
      const newName = value.trim();
      if (!newName || newName === currentName) {
        restore();
        return;
      }
      const parent = row.file.parent;
      const newPath = normalizePath(`${parent ? parent.path + "/" : ""}${newName}.md`);
      if (this.dataSource.fileExists(newPath)) {
        new Notice(t("errors.fileExists", { name: newName }));
        restore();
        return;
      }
      try {
        await this.dataSource.renameNote(row.file, newPath);
        await this.refreshAfterSave();
      } catch (err) {
        new Notice(t("errors.renameFailed", { error: String(err) }));
        restore();
      }
    }, restore);
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) return "-";
    return Number.isInteger(value)
      ? String(value)
      : value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  private createOptionDragPreview(item: HTMLElement, event: MouseEvent): OptionDragPreview {
    const rect = item.getBoundingClientRect();
    const preview = item.cloneNode(true) as HTMLElement;
    preview.addClass("db-cell-option-drag-preview");
    preview.addClass("db-cell-option-item");
    preview.removeClass("is-dragging");
    preview.setAttribute("aria-hidden", "true");
    preview.querySelectorAll(".db-mobile-reorder-controls").forEach((el) => el.remove());
    preview.setCssProps({
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    window.activeDocument.body.appendChild(preview);
    const state: OptionDragPreview = {
      preview,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    this.updateOptionDragPreview(state, event);
    return state;
  }

  private updateOptionDragPreview(state: OptionDragPreview, event: MouseEvent): void {
    state.preview.setCssProps({
      transform: `translate3d(${Math.round(event.clientX - state.offsetX)}px, ${Math.round(event.clientY - state.offsetY)}px, 0)`,
    });
  }

  private removeOptionDragPreview(state: OptionDragPreview): void {
    state.preview.remove();
  }

  private positionOptionPopover(
    popover: HTMLElement,
    td: HTMLElement,
    container: HTMLElement | null,
    anchorPoint?: { x: number; y: number }
  ): void {
    const margin = 8;
    const gap = 4;
    const rect = td.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const bounds = getVisiblePopoverBounds(container);

    const width = Math.min(Math.max(popoverRect.width || rect.width, rect.width, 160), 260);
    const anchorX = anchorPoint?.x ?? rect.left;
    const anchorY = anchorPoint?.y ?? rect.bottom;

    const left = clamp(anchorX, bounds.left + margin, bounds.right - width - margin);

    const below = bounds.bottom - anchorY - gap - margin;
    const above = anchorY - gap - margin;
    const useAbove = above > below && below < Math.min(popover.scrollHeight, 180);
    const availableHeight = Math.max(120, useAbove ? above : below);
    const maxHeight = Math.max(120, bounds.height - margin * 2);
    const height = Math.min(popover.scrollHeight || popoverRect.height || 0, availableHeight, maxHeight);

    const globalTop = useAbove ? anchorY - gap - height : anchorY + gap;
    const globalClampedTop = clamp(globalTop, bounds.top + margin, bounds.bottom - height - margin);

    popover.setCssProps({ width: `${width}px`, maxHeight: `${Math.min(availableHeight, maxHeight)}px` });

    setPosition(
      popover,
      left,
      globalClampedTop,
      container?.getBoundingClientRect(),
      container?.scrollLeft || 0,
      container?.scrollTop || 0
    );
  }

  private isEmptyValue(value: unknown): boolean {
    if (Array.isArray(value)) return value.length === 0;
    return value == null || value === "";
  }
}
