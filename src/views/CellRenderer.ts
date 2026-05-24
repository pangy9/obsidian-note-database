import { Notice, normalizePath, setIcon } from "obsidian";
import { getColumnOptions, toBooleanValue, toMultiSelectValues } from "../data/ColumnTypes";
import { DataSource } from "../data/DataSource";
import { ColumnDef, RowData, StatusOptionDef } from "../data/types";
import { t } from "../i18n";
import { clamp, getVisiblePopoverBounds, setPosition } from "./PopoverPosition";
import { setFieldTooltip } from "./FieldTooltip";

const OPTION_COLORS: StatusOptionDef["color"][] = [
  "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink",
  "red", "slate", "cyan", "teal", "lime", "indigo", "violet", "rose",
];

const OPTION_COLOR_HEX: Record<string, string> = {
  gray: "#787774",
  brown: "#8f5d45",
  orange: "#b65f00",
  yellow: "#8f6a00",
  green: "#448361",
  blue: "#2f6fad",
  purple: "#6940a5",
  pink: "#a83272",
  red: "#d44c47",
  slate: "#64748b",
  cyan: "#0891b2",
  teal: "#0f766e",
  lime: "#65a30d",
  indigo: "#4f46e5",
  violet: "#7c3aed",
  rose: "#e11d48",
};

export interface CellOptionTransaction {
  previousOptions?: StatusOptionDef[];
  nextOptions?: StatusOptionDef[];
  cleanupRemovedValues?: string[];
  renameValues?: Array<{ from: string; to: string }>;
  setValue?: boolean;
  value?: unknown;
}

export class CellRenderer {
  private transientTimers = new WeakMap<HTMLElement, Map<string, number>>();

  constructor(
    private dataSource: DataSource,
    private refreshAfterSave: () => Promise<void>,
    private openNote: (row: RowData) => void | Promise<void> = (row) => this.dataSource.openNote(row.file),
    private manageOptions?: (col: ColumnDef) => void,
    private editFormula?: (col: ColumnDef) => void,
    private isReadOnly = false,
    private commitCellOptionTransaction?: (row: RowData, col: ColumnDef, transaction: CellOptionTransaction) => Promise<void>,
    private saveCellValue?: (row: RowData, col: ColumnDef, value: unknown) => Promise<void>
  ) {}

  renderCell(td: HTMLElement, row: RowData, col: ColumnDef): void {
    td.addClass("db-cell");
    if (col.wrap) td.addClass("db-cell-wrap");
    let value: unknown;

    if (col.type === "computed" && col.computedKey) {
      value = row.computed[col.computedKey];
    } else if (col.key === "file.name") {
      td.addClass("db-title-cell");
      const displayName = row.file.name.replace(/\.md$/, "");
      const link = td.createEl("a", {
        text: displayName,
        cls: "internal-link",
        attr: { title: displayName },
      });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.openNote(row);
      });
      setFieldTooltip(td, displayName);
      if (!this.isReadOnly) {
        td.addClass("db-editable-cell");
        setFieldTooltip(td, displayName, t("cell.doubleClickRename"));
        td.tabIndex = 0;
        td.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          this.editFileName(td, row, displayName);
        });
        td.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.editFileName(td, row, displayName);
          }
        });
      }
      return;
    } else {
      value = row.frontmatter[col.key];
    }

    if (col.type === "checkbox") {
      this.renderCheckbox(td, row, col, value);
      return;
    }

    if (this.isEmptyValue(value)) {
      td.createSpan({ cls: "db-empty-value", text: t("common.empty") });
      if (!this.isReadOnly && col.type === "computed") {
        this.makeComputedEditable(td, col);
        setFieldTooltip(td, t("common.empty"), t("cell.doubleClickEditFormula"));
      }
      if (!this.isReadOnly && col.type !== "computed" && col.key !== "file.name") {
        td.addClass("db-editable-cell");
        this.makeEditable(td, row, col, "");
        setFieldTooltip(td, t("common.empty"), t("cell.doubleClickEdit"));
      }
      if (this.isReadOnly) {
        setFieldTooltip(td, t("common.empty"));
      }
      return;
    }

    switch (col.type) {
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
      setFieldTooltip(td, value, t("cell.doubleClickEditFormula"));
    } else if (!this.isReadOnly && col.key !== "file.name") {
      td.addClass("db-editable-cell");
      this.makeEditable(td, row, col, value);
      setFieldTooltip(td, value, t("cell.doubleClickEdit"));
    } else {
      setFieldTooltip(td, value);
    }
  }

  private renderStatus(td: HTMLElement, col: ColumnDef, status: string): void {
    const badge = td.createSpan({ cls: "status-badge" });
    badge.textContent = status;
    badge.title = status;
    const option = col.statusOptions?.find((item) => item.value === status);
    if (option) {
      badge.addClass(`status-color-${option.color}`);
    } else {
      badge.addClass("status-color-gray");
    }
  }

  private renderMultiSelect(td: HTMLElement, col: ColumnDef, value: unknown): void {
    const values = toMultiSelectValues(value);
    const wrap = td.createDiv({ cls: "db-multi-select-values" });
    setFieldTooltip(wrap, values);
    for (const item of values) {
      this.renderStatus(wrap, col, item);
    }
  }

  private renderCheckbox(td: HTMLElement, row: RowData, col: ColumnDef, value: unknown): void {
    td.addClass("db-checkbox-cell");
    setFieldTooltip(td, toBooleanValue(value) ? t("common.true") : t("common.false"));
    const checkbox = td.createEl("input", { attr: { type: "checkbox" } });
    checkbox.checked = toBooleanValue(value);
    checkbox.disabled = this.isReadOnly;
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
    if (this.focusExistingEditor(target, event)) return;
    if (col.type === "computed") {
      this.editFormula?.(col);
      return;
    }
    if (col.key === "file.name") return;
    const origText = target.textContent || "";
    const anchorPoint = event ? { x: event.clientX, y: event.clientY } : undefined;

    if (col.type === "checkbox") {
      void this.saveValue(row, col, !toBooleanValue(currentValue));
      return;
    }

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
      this.editDate(target, row, col, currentValue, origText);
      return;
    }

    this.editText(target, row, col, currentValue, origText);
  }

  private focusExistingEditor(target: HTMLElement, event?: Event, preventDefault = true): boolean {
    const eventTarget = event?.target instanceof HTMLElement ? event.target : null;
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
    return row.frontmatter[col.key];
  }

  private selectCell(td: HTMLElement): void {
    document.querySelectorAll(".note-database-container .db-cell-selected")
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
    const container = td.closest(".note-database-container") as HTMLElement | null;
    const host = container || document.body;
    host.querySelectorAll(".db-cell-option-popover").forEach((el) => el.remove());
    const originalValues = toMultiSelectValues(currentValue);
    const selected = new Set(multiple ? toMultiSelectValues(currentValue) : [String(currentValue ?? "")]);
    const popover = host.createDiv({ cls: "db-cell-option-popover" });

    const close = () => {
      popover.remove();
      // Clean up any leaked color picker popups on document.body
      document.body.querySelectorAll(".db-color-picker-popup").forEach(el => el.remove());
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("keydown", onKeydown, true);
    };
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (popover.contains(target) || td.contains(target))) return;
      if (target && (target as HTMLElement).closest?.(".db-color-picker-popup")) return;
      close();
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    // Build option objects from column config (mutable copies)
    const optionDefs: StatusOptionDef[] = getColumnOptions(col).map(o => ({ ...o }));
    for (const v of originalValues) {
      if (v && !optionDefs.find(o => o.value === v)) {
        optionDefs.push({ value: v, color: "gray" });
      }
    }

    const cloneOptions = (options: StatusOptionDef[]) => options.map((option) => ({ ...option }));
    const getCommittedOptions = () => cloneOptions(col.statusOptions || []);
    const getDraftOptions = () => cloneOptions(optionDefs);
    const commitOptionTransaction = async (transaction: CellOptionTransaction) => {
      try {
        if (this.commitCellOptionTransaction) {
          await this.commitCellOptionTransaction(row, col, transaction);
          return;
        }
        if (transaction.nextOptions) col.statusOptions = cloneOptions(transaction.nextOptions);
        if (transaction.setValue) await this.saveValue(row, col, transaction.value);
        else await this.refreshAfterSave();
      } catch (err) {
        console.error("Note Database: failed to commit option edit", err);
        new Notice(t("errors.updateFailed", { error: String(err) }));
      }
    };
    const commitValue = (value: unknown) => {
      void commitOptionTransaction({ setValue: true, value });
    };
    const commitOptions = (transaction: Omit<CellOptionTransaction, "previousOptions" | "nextOptions"> = {}) => {
      void commitOptionTransaction({
        previousOptions: getCommittedOptions(),
        nextOptions: getDraftOptions(),
        ...transaction,
      });
    };

    const renderOptionList = () => {
      // Clear existing options
      popover.querySelectorAll(".db-cell-option-item").forEach(el => el.remove());
      if (optionDefs.length === 0) {
        const empty = popover.createDiv({ cls: "db-panel-empty", text: t("cell.noOptions") });
        popover.insertBefore(empty, popover.querySelector(".db-cell-option-add"));
      }
      optionDefs.forEach((opt, idx) => {
        const item = popover.createEl("button", { cls: "db-cell-option-item" });
        popover.insertBefore(item, popover.querySelector(".db-cell-option-add"));

        // Drag handle for reorder
        const handle = item.createSpan({ cls: "db-option-drag-handle", text: "⠿" });
        handle.onmousedown = (e) => {
          e.stopPropagation();
          e.preventDefault();

          item.style.opacity = "0.4";
          let dropLine: HTMLElement | null = null;
          let lastTarget = idx;

          const removeDropLine = () => { dropLine?.remove(); dropLine = null; };

          const onMove = (ev: MouseEvent) => {
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
            item.style.opacity = "";
            if (lastTarget !== idx && lastTarget >= 0 && lastTarget < optionDefs.length) {
              const [moved] = optionDefs.splice(idx, 1);
              optionDefs.splice(lastTarget, 0, moved);
              commitOptions();
              renderOptionList();
            }
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };

          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        };

        // Color dot — opens color picker
        const dot = item.createSpan({ cls: "db-option-color-dot" });
        const updateDot = () => {
          dot.style.cssText = `width:12px;height:12px;border-radius:2px;margin:0 4px;flex-shrink:0;background:var(--status-color-fg-${opt.color});cursor:pointer;`;
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
          e.stopPropagation();
          e.preventDefault();
          const input = document.createElement("input");
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
        setIcon(deleteButton, "trash");
        deleteButton.onmousedown = (event) => event.preventDefault();
        deleteButton.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!window.confirm(t("modal.confirmDeleteOption", { name: opt.value }))) return;
          const removed = opt.value;
          optionDefs.splice(idx, 1);
          const wasSelected = selected.delete(removed);
          commitOptions({
            cleanupRemovedValues: [removed],
            setValue: wasSelected,
            value: multiple ? Array.from(selected) : null,
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
      document.body.querySelectorAll(".db-color-picker-popup").forEach(el => el.remove());
      const picker = document.body.createDiv({ cls: "db-color-picker-popup" });
      picker.style.cssText = "position:fixed;display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.15);z-index:1002;width:124px;";
      OPTION_COLORS.forEach(color => {
        const swatch = picker.createSpan();
        swatch.style.cssText = `width:18px;height:18px;border-radius:2px;background:${OPTION_COLOR_HEX[color]};cursor:pointer;${color === opt.color ? 'box-shadow:0 0 0 2px var(--interactive-accent);' : ''}`;
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
      });
      const rect = anchor.getBoundingClientRect();
      picker.style.left = `${rect.left}px`;
      picker.style.top = `${rect.top}px`;
      const closePicker = (e: MouseEvent) => {
        if (!picker.contains(e.target as Node)) {
          picker.remove();
          document.removeEventListener("mousedown", closePicker, true);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", closePicker, true), 0);
    };

    // New option input
    const addRow = popover.createDiv({ cls: "db-cell-option-add" });
    const addInput = addRow.createEl("input", {
      attr: { placeholder: t("cell.addOption"), type: "text" },
    });
    addInput.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const name = addInput.value.trim();
      if (!name) return;
      if (optionDefs.some(o => o.value === name)) {
        new Notice(t("cell.optionExists", { name }));
        return;
      }
      optionDefs.push({ value: name, color: OPTION_COLORS[optionDefs.length % OPTION_COLORS.length] });
      addInput.value = "";
      if (!multiple) {
        selected.clear();
        selected.add(name);
        popover.querySelectorAll(".db-option-check").forEach(el => { el.textContent = ""; });
        commitOptions({ setValue: true, value: name });
      } else {
        selected.add(name);
        commitOptions({ setValue: true, value: Array.from(selected) });
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
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKeydown, true);
  }

  private editNumber(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: unknown,
    origText: string
  ): void {
    const inp = document.createElement("input");
    inp.className = "db-cell-input";
    inp.type = "number";
    inp.step = "any";
    inp.value = String(currentValue ?? "");
    this.mountInput(td, inp);

    let committed = false;

    const save = async () => {
      if (committed) return;
      committed = true;
      const raw = inp.value;
      const newVal = raw ? parseFloat(raw) : "";
      if (String(newVal) !== String(currentValue)) {
        await this.saveValue(row, col, newVal);
      } else {
        td.textContent = origText;
      }
      this.clearTransientClass(td, "db-cell-editing");
    };

    inp.onblur = save;
    inp.onkeydown = (event) => this.handleEditKey(event, save, () => {
      committed = true;
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

    const parts = String(currentValue ?? "").substring(0, 10).split("-");
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
        if (String(currentValue ?? "").substring(0, 10)) {
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
      if (newVal !== String(currentValue ?? "").substring(0, 10)) {
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
    // During blur, document.activeElement hasn't updated yet, so isInternalFocus()
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

  private editText(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: unknown,
    origText: string
  ): void {
    const valueText = String(currentValue ?? "");
    if (this.shouldUseTextarea(td, col, valueText)) {
      this.editLongText(td, row, col, valueText, origText);
      return;
    }
    const inp = document.createElement("input");
    inp.className = "db-cell-input";
    inp.type = "text";
    inp.value = valueText;
    this.mountInput(td, inp);

    let committed = false;

    const save = async () => {
      if (committed) return;
      committed = true;
      const newVal = inp.value;
      if (newVal !== String(currentValue ?? "")) {
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

  private editLongText(
    td: HTMLElement,
    row: RowData,
    col: ColumnDef,
    currentValue: string,
    origText: string
  ): void {
    const textarea = document.createElement("textarea");
    textarea.className = "db-cell-textarea";
    textarea.value = currentValue;
    this.mountTextarea(td, textarea);

    let committed = false;

    const save = async () => {
      if (committed) return;
      committed = true;
      const newVal = textarea.value;
      if (newVal !== currentValue) {
        await this.saveValue(row, col, newVal);
      } else {
        this.restoreTextDisplay(td, currentValue, origText);
      }
      this.clearTransientClass(td, "db-cell-editing");
    };

    textarea.onblur = save;
    textarea.onkeydown = (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void save();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        committed = true;
        this.restoreTextDisplay(td, currentValue, origText);
        this.clearTransientClass(td, "db-cell-editing");
      }
    };
  }

  private restoreTextDisplay(td: HTMLElement, currentValue: unknown, origText: string): void {
    td.textContent = origText || String(currentValue ?? "");
  }

  private shouldUseTextarea(target: HTMLElement, col: ColumnDef, value: string): boolean {
    if (col.type !== "text") return false;
    return col.wrap ||
      value.includes("\n") ||
      value.length > 80 ||
      target.closest(".db-board-card, .db-gallery-card") != null;
  }

  private mountInput(td: HTMLElement, input: HTMLInputElement): void {
    this.addTransientClass(td, "db-cell-editing", 1600);
    input.style.width = "100%";
    td.textContent = "";
    td.appendChild(input);
    input.focus();
    input.select();
  }

  private mountTextarea(td: HTMLElement, textarea: HTMLTextAreaElement): void {
    const rect = td.getBoundingClientRect();
    this.addTransientClass(td, "db-cell-editing", 1600);
    td.textContent = "";
    if (rect.width > 0) textarea.style.width = `${Math.ceil(rect.width)}px`;
    if (rect.height > 0) textarea.style.height = `${Math.max(24, Math.ceil(rect.height))}px`;
    td.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
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
      if (this.saveCellValue) {
        await this.saveCellValue(row, col, value);
        return;
      }
      await this.dataSource.updateFrontmatter(row.file, { [col.key]: value });
      await this.refreshAfterSave();
    } catch (err) {
      new Notice(t("errors.updateFailed", { error: String(err) }));
    }
  }

  private editFileName(td: HTMLElement, row: RowData, currentName: string): void {
    this.addTransientClass(td, "db-cell-editing", 1600);
    const inp = document.createElement("input");
    inp.className = "db-cell-input";
    inp.type = "text";
    inp.value = currentName;
    td.textContent = "";
    td.appendChild(inp);
    inp.focus();
    inp.select();

    let committed = false;
    const commit = async () => {
      if (committed) return;
      committed = true;
      const newName = inp.value.trim();
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
    };

    const restore = () => {
      this.clearTransientClass(td, "db-cell-editing");
      td.textContent = "";
      const link = td.createEl("a", {
        text: currentName,
        cls: "internal-link",
      });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.openNote(row);
      });
    };

    inp.onblur = () => void commit();
    inp.onkeydown = (event) => {
      if (event.key === "Enter") { event.preventDefault(); void commit(); }
      if (event.key === "Escape") { committed = true; restore(); }
    };
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) return "-";
    return Number.isInteger(value)
      ? String(value)
      : value.toLocaleString(undefined, { maximumFractionDigits: 6 });
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

    popover.style.width = `${width}px`;
    popover.style.maxHeight = `${Math.min(availableHeight, maxHeight)}px`;

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
