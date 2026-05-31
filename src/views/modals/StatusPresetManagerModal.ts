import { App, Modal, Notice, setIcon } from "obsidian";
import {
  cloneStatusPreset,
  getBuiltinStatusPresets,
  normalizeStatusPresets,
  resolveDefaultStatusPresetId,
} from "../../data/ColumnTypes";
import { ColumnDef, StatusPresetDef, generateId } from "../../data/types";
import { t } from "../../i18n";
import { StatusOptionsModal } from "./StatusOptionsModal";

export class StatusPresetManagerModal extends Modal {
  private presets: StatusPresetDef[];
  private defaultPresetId: string;
  private listEl?: HTMLElement;

  constructor(
    app: App,
    private title: string,
    presets: StatusPresetDef[],
    defaultPresetId: string | undefined,
    private onSave: (presets: StatusPresetDef[], defaultPresetId: string) => Promise<void>
  ) {
    super(app);
    this.presets = normalizeStatusPresets(presets, getBuiltinStatusPresets()).map((preset) => cloneStatusPreset(preset));
    this.defaultPresetId = resolveDefaultStatusPresetId(this.presets, defaultPresetId);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("note-database-modal");
    this.contentEl.createEl("h3", { text: this.title });
    this.contentEl.createDiv({ cls: "db-modal-help", text: t("statusPresets.desc") });
    this.renderDefaultSelector();
    this.listEl = this.contentEl.createDiv({ cls: "db-status-preset-manager-list" });
    this.renderList();

    const addBtn = this.contentEl.createEl("button", { text: `+ ${t("statusPresets.add")}` });
    addBtn.onclick = () => {
      const source = this.presets.find((preset) => preset.id === this.defaultPresetId) || this.presets[0] || getBuiltinStatusPresets()[0];
      const preset = cloneStatusPreset(source);
      preset.id = generateId();
      preset.name = t("statusPresets.newPreset");
      this.presets.push(preset);
      this.defaultPresetId = resolveDefaultStatusPresetId(this.presets, this.defaultPresetId);
      this.onOpen();
    };

    const buttons = this.contentEl.createDiv({ cls: "db-modal-button-row" });
    buttons.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const save = buttons.createEl("button", { text: t("common.save"), cls: "mod-cta" });
    save.onclick = async () => {
      const normalized = normalizeStatusPresets(this.presets, getBuiltinStatusPresets());
      const defaultId = resolveDefaultStatusPresetId(normalized, this.defaultPresetId);
      await this.onSave(normalized, defaultId);
      this.close();
    };
  }

  private renderDefaultSelector(): void {
    const row = this.contentEl.createDiv({ cls: "db-status-preset-default-row" });
    row.createSpan({ text: t("statusPresets.default") });
    const select = row.createEl("select", { cls: "db-control-select" });
    for (const preset of this.presets) {
      select.createEl("option", { value: preset.id, text: preset.name });
    }
    select.value = this.defaultPresetId;
    select.onchange = () => {
      this.defaultPresetId = select.value;
      this.renderList();
    };
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    for (const preset of this.presets) {
      const row = this.listEl.createDiv({ cls: "db-status-preset-manager-row" });
      const name = row.createEl("input", {
        cls: "db-status-preset-name-input",
        attr: { type: "text", placeholder: t("statusPresets.namePlaceholder") },
      });
      name.value = preset.name;
      name.oninput = () => {
        preset.name = name.value.trim();
      };
      const preview = row.createDiv({ cls: "db-status-preset-preview" });
      for (const option of preset.options.slice(0, 5)) {
        preview.createSpan({ cls: `status-badge status-color-${option.color}`, text: option.value });
      }
      if (preset.options.length > 5) preview.createSpan({ cls: "db-status-preset-more", text: `+${preset.options.length - 5}` });
      if (preset.id === this.defaultPresetId) {
        preview.createSpan({ cls: "db-status-preset-default-badge", text: t("statusPresets.defaultShort") });
        row.addClass("is-default");
      }
      const controls = row.createDiv({ cls: "db-status-preset-manager-controls" });
      const star = row.createSpan({
        cls: `db-status-preset-default-indicator${preset.id === this.defaultPresetId ? " is-active" : ""}`,
        attr: { title: t("statusPresets.useAsDefault") }
      });
      setIcon(star, "star");
      star.onclick = () => {
        this.defaultPresetId = preset.id;
        this.renderList(); // 刷新所有行的星标状态
        this.onOpen();
      };
      const editButton = controls.createEl("button", { cls: "edit-btn", attr: { title: t("common.edit"), "aria-label": t("common.edit") } });
      setIcon(editButton, "edit");
      editButton.onclick = () => this.openOptionEditor(preset);
      this.contentEl.addClass("note-database-modal");
      const deleteBtn = controls.createEl("button", {
        cls: "delete-btn",
        attr: { title: t("common.delete"), "aria-label": t("common.delete") },
      });
      setIcon(deleteBtn, "trash");
      deleteBtn.onclick = () => {
        if (this.presets.length <= 1) {
          new Notice(t("statusPresets.keepOne"));
          return;
        }
        this.presets = this.presets.filter((item) => item !== preset);
        this.defaultPresetId = resolveDefaultStatusPresetId(this.presets, this.defaultPresetId);
        this.onOpen();
      };
    }
  }

  private openOptionEditor(preset: StatusPresetDef): void {
    const col: ColumnDef = {
      key: preset.id,
      label: preset.name,
      type: "status",
      statusOptions: preset.options.map((option) => ({ ...option })),
    };
    new StatusOptionsModal(this.app, col, async (options) => {
      preset.options = options.map((option) => ({ ...option }));
      this.renderList();
    }, [], false).open();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
