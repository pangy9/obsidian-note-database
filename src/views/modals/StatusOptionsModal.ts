import { App, Modal, Notice } from "obsidian";
import { COLUMN_TYPE_LABELS, DEFAULT_STATUS_OPTIONS, getBuiltinStatusPresets } from "../../data/ColumnTypes";
import { ColumnDef, StatusColor, StatusOptionDef, StatusPresetDef } from "../../data/types";
import { t } from "../../i18n";

const COLORS: StatusColor[] = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const COLOR_KEYS: Record<StatusColor, string> = {
  gray: "common.colorGray",
  brown: "common.colorBrown",
  orange: "common.colorOrange",
  yellow: "common.colorYellow",
  green: "common.colorGreen",
  blue: "common.colorBlue",
  purple: "common.colorPurple",
  pink: "common.colorPink",
  red: "common.colorRed",
};

export class StatusOptionsModal extends Modal {
  private options: StatusOptionDef[];
  private listEl?: HTMLElement;
  private draggedIndex: number | null = null;

  constructor(
    app: App,
    private col: ColumnDef,
    private onSave: (options: StatusOptionDef[]) => Promise<void>,
    private presets: StatusPresetDef[] = getBuiltinStatusPresets(),
    private showPresets = true,
    private defaultOptions: StatusOptionDef[] = DEFAULT_STATUS_OPTIONS
  ) {
    super(app);
    const defaults = col.type === "status" ? this.defaultOptions : [];
    this.options = (col.statusOptions?.length ? col.statusOptions : defaults)
      .map((option) => ({ ...option }));
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("note-database-modal");
    this.contentEl.createEl("h3", { text: t("modal.statusOptions", { type: COLUMN_TYPE_LABELS()[this.col.type], label: this.col.label }) });
    if (this.col.type === "status" && this.showPresets) this.renderPresets();
    this.listEl = this.contentEl.createDiv({ cls: "db-status-option-list" });
    this.renderList();

    const addBtn = this.contentEl.createEl("button", { text: t("modal.addOption") });
    addBtn.onclick = () => {
      this.options.push({ value: t("modal.newOption"), color: "gray" });
      this.renderList();
    };

    const buttonRow = this.contentEl.createDiv({ cls: "db-modal-button-row" });
    buttonRow.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const saveBtn = buttonRow.createEl("button", { text: t("common.save"), cls: "mod-cta" });
    saveBtn.onclick = async () => {
      const normalized = this.options
        .map((option) => ({ value: option.value.trim(), color: option.color }))
        .filter((option) => option.value.length > 0);
      if (new Set(normalized.map((option) => option.value)).size !== normalized.length) {
        new Notice(t("modal.optionNameDuplicate"));
        return;
      }
      await this.onSave(normalized);
      this.close();
    };
  }

  private renderPresets(): void {
    const wrap = this.contentEl.createDiv({ cls: "db-status-preset-list" });
    wrap.createDiv({ cls: "db-status-preset-title", text: t("modal.preset") });
    const buttons = wrap.createDiv({ cls: "db-status-preset-buttons" });
    for (const preset of this.presets) {
      const btn = buttons.createEl("button", {
        cls: "db-status-preset-button",
        text: preset.name,
        attr: { type: "button" },
      });
      btn.onclick = () => {
        this.options = preset.options.map((option) => ({ ...option }));
        this.renderList();
      };
    }
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    this.options.forEach((option, index) => {
      const row = this.listEl!.createDiv({ cls: "db-status-option-row" });
      row.ondragover = (event) => {
        event.preventDefault();
        row.addClass("is-drop-target");
      };
      row.ondragleave = () => row.removeClass("is-drop-target");
      row.ondrop = (event) => this.dropOn(event, index, row);
      row.ondragend = () => this.finishDrag();

      const drag = row.createSpan({ cls: "db-status-option-drag", text: "⋮⋮" });
      drag.draggable = true;
      drag.title = t("panel.dragToSort");
      drag.ondragstart = (event) => this.startDrag(event, index, row);
      row.createSpan({ cls: `db-status-option-preview status-badge status-color-${option.color}`, text: option.value || t("modal.untitled") });
      const input = row.createEl("input", {
        cls: "db-status-option-input",
        attr: { type: "text" },
      });
      input.value = option.value;
      input.oninput = () => {
        option.value = input.value;
        const preview = row.querySelector(".status-badge");
        if (preview) preview.textContent = option.value || t("modal.untitled");
      };

      const palette = row.createDiv({ cls: "db-status-color-palette" });
      for (const color of COLORS) {
        const colorLabel = t(COLOR_KEYS[color]);
        const colorButton = palette.createEl("button", {
          cls: `db-status-color-button status-color-${color}${option.color === color ? " is-selected" : ""}`,
          attr: { "aria-label": colorLabel, title: colorLabel },
        });
        colorButton.createSpan({ cls: "db-status-color-dot" });
        colorButton.onclick = () => {
          option.color = color;
          this.renderList();
        };
      }

      const controls = row.createDiv({ cls: "db-status-option-controls" });
      controls.createEl("button", { text: "↑", attr: { title: t("modal.moveUp") } }).onclick = () => this.move(index, -1);
      controls.createEl("button", { text: "↓", attr: { title: t("modal.moveDown") } }).onclick = () => this.move(index, 1);
      controls.createEl("button", { text: "×", attr: { title: t("common.delete") } }).onclick = () => {
        this.options.splice(index, 1);
        this.renderList();
      };
    });
  }

  private move(index: number, offset: number): void {
    const next = index + offset;
    if (next < 0 || next >= this.options.length) return;
    [this.options[index], this.options[next]] = [this.options[next], this.options[index]];
    this.renderList();
  }

  private startDrag(event: DragEvent, index: number, row: HTMLElement): void {
    this.draggedIndex = index;
    row.addClass("is-dragging");
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  private dropOn(event: DragEvent, targetIndex: number, row: HTMLElement): void {
    event.preventDefault();
    row.removeClass("is-drop-target");
    const from = this.draggedIndex;
    if (from === null || from === targetIndex) {
      this.finishDrag();
      return;
    }

    const rect = row.getBoundingClientRect();
    let insertIndex = event.clientY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
    const [item] = this.options.splice(from, 1);
    if (from < insertIndex) insertIndex -= 1;
    this.options.splice(insertIndex, 0, item);
    this.finishDrag();
    this.renderList();
  }

  private finishDrag(): void {
    this.draggedIndex = null;
    this.contentEl.querySelectorAll(".db-status-option-row").forEach((row) => {
      row.removeClass("is-dragging", "is-drop-target");
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
