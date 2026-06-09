import { App, Modal, Notice, setIcon } from "obsidian";
import { COLUMN_TYPE_LABELS, DEFAULT_STATUS_OPTIONS, getBuiltinStatusPresets } from "../../data/ColumnTypes";
import { ColumnDef, StatusColor, StatusOptionDef, StatusPresetDef } from "../../data/types";
import { t } from "../../i18n";
import { confirmWithModal } from "./ConfirmModal";
import { isHTMLElement } from "../DomGuards";

export interface StatusOptionsSaveResult {
  options: StatusOptionDef[];
  presetId?: string;
}

interface StatusPresetSelectionState {
  activePresetId?: string;
  options: StatusOptionDef[];
  customOptions: StatusOptionDef[];
}

const COLORS: StatusColor[] = [
  "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink",
  "red", "slate", "cyan", "teal", "lime", "indigo", "violet", "rose",
];

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
  slate: "common.colorSlate",
  cyan: "common.colorCyan",
  teal: "common.colorTeal",
  lime: "common.colorLime",
  indigo: "common.colorIndigo",
  violet: "common.colorViolet",
  rose: "common.colorRose",
};

export function getValidStatusPresetId(presetId: string | undefined, presets: StatusPresetDef[]): string | undefined {
  return presetId && presets.some((preset) => preset.id === presetId) ? presetId : undefined;
}

export function getManualStatusOptionsPresetId(): undefined {
  return undefined;
}

export function cloneStatusOptionDraft(options: StatusOptionDef[]): StatusOptionDef[] {
  return options.map((option) => ({ ...option }));
}

export function selectStatusOptionsPreset(
  state: StatusPresetSelectionState,
  presetId: string | undefined,
  presets: StatusPresetDef[]
): StatusPresetSelectionState {
  const customOptions = state.activePresetId === undefined
    ? cloneStatusOptionDraft(state.options)
    : cloneStatusOptionDraft(state.customOptions);
  const preset = presetId ? presets.find((candidate) => candidate.id === presetId) : undefined;
  if (!preset) {
    return {
      activePresetId: undefined,
      options: cloneStatusOptionDraft(customOptions),
      customOptions,
    };
  }
  return {
    activePresetId: preset.id,
    options: cloneStatusOptionDraft(preset.options),
    customOptions,
  };
}

export class StatusOptionsModal extends Modal {
  private options: StatusOptionDef[];
  private customOptions: StatusOptionDef[];
  private listEl?: HTMLElement;
  private draggedIndex: number | null = null;
  private activePresetId?: string;
  private presetButtonsEl?: HTMLElement;

  constructor(
    app: App,
    private col: ColumnDef,
    private onSave: (result: StatusOptionsSaveResult) => Promise<void>,
    private presets: StatusPresetDef[] = getBuiltinStatusPresets(),
    private showPresets = true,
    private defaultOptions: StatusOptionDef[] = DEFAULT_STATUS_OPTIONS
  ) {
    super(app);
    const defaults = col.type === "status" ? this.defaultOptions : [];
    this.options = cloneStatusOptionDraft(col.statusOptions?.length ? col.statusOptions : defaults);
    this.customOptions = cloneStatusOptionDraft(this.options);
    this.activePresetId = getValidStatusPresetId(col.statusPresetId, this.presets);
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
      this.markCustomOptions();
      this.options.push({ value: t("modal.newOption"), color: "gray" });
      this.syncCustomOptions();
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
      await this.onSave({ options: normalized, presetId: this.activePresetId });
      this.close();
    };
  }

  private markCustomOptions(): void {
    if (this.activePresetId === undefined) return;
    this.activePresetId = getManualStatusOptionsPresetId();
    if (this.presetButtonsEl) this.renderPresets();
  }

  private syncCustomOptions(): void {
    if (this.activePresetId !== undefined) return;
    this.customOptions = cloneStatusOptionDraft(this.options);
  }

  private selectPreset(presetId: string | undefined): void {
    const next = selectStatusOptionsPreset({
      activePresetId: this.activePresetId,
      options: this.options,
      customOptions: this.customOptions,
    }, presetId, this.presets);
    this.activePresetId = next.activePresetId;
    this.options = next.options;
    this.customOptions = next.customOptions;
    this.renderPresets();
    this.renderList();
  }

  private renderPresets(): void {
    if (!this.presetButtonsEl) {
      const wrap = this.contentEl.createDiv({ cls: "db-status-preset-list" });
      wrap.createDiv({ cls: "db-status-preset-title", text: t("modal.preset") });
      this.presetButtonsEl = wrap.createDiv({ cls: "db-status-preset-buttons" });
    } else {
      this.presetButtonsEl.empty();
    }

    const noneBtn = this.presetButtonsEl.createEl("button", {
      cls: "db-status-preset-button",
      text: t("statusPresets.none"),
      attr: { type: "button" },
    });
    if (this.activePresetId === undefined) {
      noneBtn.addClass("is-active");
    }
    noneBtn.onclick = () => this.selectPreset(undefined);

    for (const preset of this.presets) {
      const btn = this.presetButtonsEl.createEl("button", {
        cls: "db-status-preset-button",
        text: preset.name,
        attr: { type: "button" },
      });
      if (preset.id === this.activePresetId) {
        btn.addClass("is-active");
      }
      btn.onclick = () => this.selectPreset(preset.id);
    }
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    this.options.forEach((option, index) => {
      const row = this.listEl!.createDiv({ cls: "db-status-option-row" });
      row.draggable = true;
      row.ondragstart = (event) => {
        if (this.shouldIgnoreOptionDrag(event)) {
          event.preventDefault();
          return;
        }
        this.startDrag(event, index, row);
      };
      row.ondragover = (event) => {
        event.preventDefault();
        row.addClass("is-drop-target");
      };
      row.ondragleave = () => row.removeClass("is-drop-target");
      row.ondrop = (event) => this.dropOn(event, index, row);
      row.ondragend = () => this.finishDrag();

      const drag = row.createSpan({ cls: "db-status-option-drag", text: "⋮⋮" });
      drag.title = t("panel.dragToSort");
      const moveControls = row.createSpan({ cls: "db-mobile-reorder-controls db-status-option-mobile-controls" });
      const upBtn = moveControls.createEl("button", {
        attr: { type: "button", title: t("menu.moveUp"), "aria-label": t("menu.moveUp") },
      });
      setIcon(upBtn, "arrow-up");
      upBtn.disabled = index === 0;
      upBtn.onclick = () => this.moveOption(index, index - 1);
      const downBtn = moveControls.createEl("button", {
        attr: { type: "button", title: t("menu.moveDown"), "aria-label": t("menu.moveDown") },
      });
      setIcon(downBtn, "arrow-down");
      downBtn.disabled = index >= this.options.length - 1;
      downBtn.onclick = () => this.moveOption(index, index + 1);
      row.createSpan({
        cls: `db-status-option-preview status-badge status-color-${option.color}`,
        text: option.value || t("modal.untitled"),
        attr: { title: option.value || t("modal.untitled") },
      });
      const input = row.createEl("input", {
        cls: "db-status-option-input",
        attr: { type: "text" },
      });
      input.value = option.value;
      input.oninput = () => {
        this.markCustomOptions();
        option.value = input.value;
        this.syncCustomOptions();
        const preview = row.querySelector(".status-badge");
        if (preview) {
          const previewText = option.value || t("modal.untitled");
          preview.textContent = previewText;
          preview.setAttribute("title", previewText);
        }
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
          this.markCustomOptions();
          option.color = color;
          this.syncCustomOptions();
          this.renderList();
        };
      }

      const controls = row.createDiv({ cls: "db-status-option-controls" });
      const deleteBtn = controls.createEl("button", {
        cls: "db-status-delete-btn",
        attr: { title: t("common.delete"), "aria-label": t("common.delete") },
      });
      setIcon(deleteBtn, "trash");
      deleteBtn.onclick = async () => {
        if (!await confirmWithModal(this.app, {
          title: t("common.delete"),
          message: t("modal.confirmDeleteOption", { name: option.value }),
          confirmText: t("common.delete"),
          danger: true,
        })) return;
        this.markCustomOptions();
        this.options.splice(index, 1);
        this.syncCustomOptions();
        this.renderList();
      };
    });
  }

  private startDrag(event: DragEvent, index: number, row: HTMLElement): void {
    this.draggedIndex = index;
    row.addClass("is-dragging");
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  private moveOption(from: number, to: number): void {
    if (from < 0 || from >= this.options.length || to < 0 || to >= this.options.length) return;
    this.markCustomOptions();
    const [item] = this.options.splice(from, 1);
    this.options.splice(to, 0, item);
    this.syncCustomOptions();
    this.renderList();
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
    this.markCustomOptions();
    const [item] = this.options.splice(from, 1);
    if (from < insertIndex) insertIndex -= 1;
    this.options.splice(insertIndex, 0, item);
    this.syncCustomOptions();
    this.finishDrag();
    this.renderList();
  }

  private finishDrag(): void {
    this.draggedIndex = null;
    this.contentEl.querySelectorAll(".db-status-option-row").forEach((row) => {
      row.removeClass("is-dragging", "is-drop-target");
    });
  }

  private shouldIgnoreOptionDrag(event: DragEvent): boolean {
    return isHTMLElement(event.target)
      && event.target.closest("input, select, textarea, button, .db-mobile-reorder-controls") != null;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
