import { DatabaseConfig, DatabaseViewType, NO_TITLE_FIELD, StatusPresetDef, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { positionToolbarPopover } from "./PopoverPosition";

export interface ViewConfigPanelActions {
  onChange(): void;
  onViewTypeChange?(viewType: DatabaseViewType): void;
  onDatabaseChange?(): void;
  database?: DatabaseConfig;
  statusPresets?: StatusPresetDef[];
  defaultStatusPresetId?: string;
  onDefaultStatusPresetChange?(presetId: string): void;
  onManageStatusPresets?(): void;
  viewStatusPresets?: StatusPresetDef[];
  defaultViewStatusPresetId?: string;
  onDefaultViewStatusPresetChange?(presetId: string): void;
  onManageViewStatusPresets?(): void;
  readonly isDatabaseReadOnly?: boolean;
}

export class ViewConfigPanelRenderer {
  render(
    containerEl: HTMLElement,
    visible: boolean,
    config: ViewConfig | undefined,
    actions: ViewConfigPanelActions,
    anchorEl?: HTMLElement
  ): void {
    const existingPanel = containerEl.querySelector(".db-view-config-panel");
    const savedScroll = (existingPanel as HTMLElement | null)?.scrollTop ?? 0;
    containerEl.querySelectorAll(".db-view-config-panel").forEach((el) => el.remove());
    if (!visible || !config) return;

    const panel = containerEl.createDiv({ cls: "db-view-config-panel" });
    const header = panel.createDiv({ cls: "db-panel-header" });
    header.createDiv({ cls: "db-panel-title", text: t("toolbar.settings") });

    if (actions.database) {
      this.renderSectionTitle(panel, t("viewConfig.databaseSection"));
      if (actions.isDatabaseReadOnly) {
        panel.createDiv({ cls: "db-view-config-readonly-note", text: t("viewConfig.databaseReadonly") });
      }
      this.renderDatabaseSettings(panel, actions.database, actions);
    }

    this.renderSectionTitle(panel, t("viewConfig.viewSection"));
    this.renderViewType(panel, config, actions);
    this.renderStatusPresetSettings(panel, {
      presets: actions.viewStatusPresets || [],
      defaultPresetId: actions.defaultViewStatusPresetId,
      onDefaultPresetChange: actions.onDefaultViewStatusPresetChange,
      onManagePresets: actions.onManageViewStatusPresets,
    });
    this.renderDefaultColumnWidth(panel, config, actions);
    if (config.viewType !== "table") {
      this.renderTitleField(panel, config, actions);
      this.renderCheckbox(panel, t("viewConfig.showEmptyFields"), config.showEmptyFields === true, (value) => {
        config.showEmptyFields = value || undefined;
        actions.onChange();
      });
    }
    if (config.viewType === "gallery") {
      this.renderGallerySettings(panel, config, actions);
      positionToolbarPopover(panel, anchorEl);
      if (savedScroll) panel.scrollTop = savedScroll;
      return;
    }
    if (config.viewType === "board") {
      this.renderBoardSettings(panel, config, actions);
      positionToolbarPopover(panel, anchorEl);
      if (savedScroll) panel.scrollTop = savedScroll;
      return;
    }
    positionToolbarPopover(panel, anchorEl);
    if (savedScroll) panel.scrollTop = savedScroll;
  }

  private renderSectionTitle(panel: HTMLElement, text: string): void {
    panel.createDiv({ cls: "db-view-config-section-title", text });
  }

  private renderViewType(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    this.renderSelect(
      panel,
      t("viewConfig.viewType"),
      [
        { value: "table", text: t("common.tableView") },
        { value: "board", text: t("common.boardView") },
        { value: "gallery", text: t("common.galleryView") },
        { value: "list", text: t("common.listView") },
      ],
      config.viewType || "table",
      (value) => {
        const next = value as DatabaseViewType;
        if (actions.onViewTypeChange) {
          actions.onViewTypeChange(next);
          return;
        }
        config.viewType = next;
        actions.onChange();
      }
    );
  }

  private renderDatabaseSettings(panel: HTMLElement, database: DatabaseConfig, actions: ViewConfigPanelActions): void {
    const readOnly = actions.isDatabaseReadOnly;
    const syncSourceFolder = (value: string) => {
      database.sourceFolder = value;
      for (const view of database.views) {
        view.sourceFolder = value;
      }
    };
    this.renderText(panel, t("viewConfig.databaseName"), database.name || "", t("settings.databaseName"), (value) => {
      database.name = value || t("common.untitledDatabase");
      actions.onDatabaseChange?.();
    }, readOnly);
    this.renderTextarea(panel, t("viewConfig.databaseDescription"), database.description || "", t("viewConfig.descriptionPlaceholder"), (value) => {
      database.description = value || undefined;
      actions.onDatabaseChange?.();
    }, readOnly);
    this.renderText(panel, t("viewConfig.sourceFolder"), database.sourceFolder || "", t("settings.sourceFolder.placeholder"), (value) => {
      syncSourceFolder(value);
      actions.onDatabaseChange?.();
    }, readOnly, t("settings.sourceFolder.desc"), (value) => {
      syncSourceFolder(value);
    });
    this.renderNewRecordFolderSetting(panel, database, actions, readOnly);
    this.renderText(panel, t("viewConfig.typeFilter"), database.typeFilter || "", t("settings.typeFilter.placeholder"), (value) => {
      database.typeFilter = value || undefined;
      for (const view of database.views) view.typeFilter = database.typeFilter;
      actions.onDatabaseChange?.();
    }, readOnly, t("settings.typeFilter.desc"));
    this.renderStatusPresetSettings(panel, {
      presets: actions.statusPresets || [],
      defaultPresetId: actions.defaultStatusPresetId,
      onDefaultPresetChange: actions.onDefaultStatusPresetChange,
      onManagePresets: actions.onManageStatusPresets,
    }, readOnly);
  }

  private renderStatusPresetSettings(
    panel: HTMLElement,
    options: {
      presets: StatusPresetDef[];
      defaultPresetId?: string;
      onDefaultPresetChange?(presetId: string): void;
      onManagePresets?(): void;
    },
    readOnly?: boolean
  ): void {
    const presets = options.presets || [];
    if (presets.length === 0) return;
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: t("viewConfig.statusPreset") });
    const field = row.createDiv({ cls: "db-view-config-field db-view-config-inline-controls" });
    if (readOnly) {
      const current = presets.find((preset) => preset.id === options.defaultPresetId) || presets[0];
      field.createDiv({ cls: "db-view-config-readonly-value", text: current?.name || t("common.notSet") });
      return;
    }
    const select = field.createEl("select", { cls: "db-control-select" });
    for (const preset of presets) select.createEl("option", { value: preset.id, text: preset.name });
    select.value = options.defaultPresetId || presets[0]?.id || "";
    select.onchange = () => options.onDefaultPresetChange?.(select.value);
    const button = field.createEl("button", { text: t("statusPresets.manage"), attr: { type: "button" } });
    button.onclick = () => options.onManagePresets?.();
  }

  private renderNewRecordFolderSetting(
    panel: HTMLElement,
    database: DatabaseConfig,
    actions: ViewConfigPanelActions,
    readOnly?: boolean
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: t("viewConfig.newRecordFolder") });
    const field = row.createDiv({ cls: "db-view-config-field" });

    if (readOnly) {
      field.createDiv({
        cls: "db-view-config-readonly-value",
        text: database.newRecordFolder || t("common.untitled"),
      });
      return;
    }
      const input = field.createEl("input", {
        cls: "db-view-config-text",
        attr: { type: "text", placeholder: t("settings.sourceFolder.placeholder") },
      });
      input.value = database.newRecordFolder || "";
      input.oninput = () => {
        database.newRecordFolder = input.value.trim() || undefined;
        for (const view of database.views) view.newRecordFolder = database.newRecordFolder;
      };
      input.onchange = () => {
        database.newRecordFolder = input.value.trim() || undefined;
        for (const view of database.views) view.newRecordFolder = database.newRecordFolder;
        actions.onDatabaseChange?.();
      };
    field.createDiv({ cls: "db-view-config-help", text: t("viewConfig.newRecordFolderLocked") });
  }

  private renderGallerySettings(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    this.renderSelect(
      panel,
      t("viewConfig.coverField"),
      [
        { value: "", text: t("viewConfig.noCover") },
        ...config.schema.columns
          .filter((col) => col.key !== "file.name")
          .map((col) => ({ value: col.key, text: col.label })),
      ],
      config.galleryImageField || "",
      (value) => {
        config.galleryImageField = value || undefined;
        actions.onChange();
      }
    );

    this.renderSelect(
      panel,
      t("viewConfig.imageFit"),
      [
        { value: "cover", text: t("viewConfig.cover") },
        { value: "contain", text: t("viewConfig.contain") },
      ],
      config.galleryImageFit || "cover",
      (value) => {
        config.galleryImageFit = value === "contain" ? "contain" : "cover";
        actions.onChange();
      }
    );

    this.renderRange(panel, t("viewConfig.cardSize"), config.galleryCardSize || 250, 160, 420, 10, (value) => {
      config.galleryCardSize = value;
      actions.onChange();
    });

    const ratioOptions = [
      { value: "0.6", text: t("viewConfig.ratioPortrait") },
      { value: "0.75", text: t("viewConfig.ratioClassic") },
      { value: "1", text: t("viewConfig.ratioSquare") },
      { value: "1.333", text: t("viewConfig.ratioLandscape") },
      { value: "1.777", text: t("viewConfig.ratioWide") },
    ];
    const ratio = String(config.galleryImageAspectRatio || 0.75);
    if (!ratioOptions.some((item) => item.value === ratio)) {
      ratioOptions.push({ value: ratio, text: t("viewConfig.ratioCurrent", { ratio }) });
    }
    this.renderSelect(panel, t("viewConfig.coverRatio"), ratioOptions, ratio, (value) => {
      const next = Number(value);
      if (Number.isFinite(next)) {
        config.galleryImageAspectRatio = next;
        actions.onChange();
      }
    });
  }

  private renderTitleField(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    this.renderSelect(
      panel,
      t("viewConfig.titleField"),
      [
        { value: "", text: t("viewConfig.titleAuto") },
        { value: NO_TITLE_FIELD, text: t("viewConfig.noTitle") },
        ...config.schema.columns.map((col) => ({ value: col.key, text: col.label })),
      ],
      config.titleField || "",
      (value) => {
        config.titleField = value || undefined;
        actions.onChange();
      }
    );
  }

  private renderBoardSettings(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    const groupField = config.boardGroupField || config.groupByField || "";
    this.renderSelect(
      panel,
      t("viewConfig.boardSubgroupField"),
      [
        { value: "", text: t("viewConfig.noSubgroup") },
        ...config.schema.columns
          .filter((col) => col.key !== "file.name" && col.key !== groupField)
          .map((col) => ({ value: col.key, text: col.label })),
      ],
      config.boardSubgroupField || "",
      (value) => {
        config.boardSubgroupField = value || undefined;
        actions.onChange();
      }
    );
    this.renderRange(panel, t("viewConfig.boardColumnWidth"), config.boardColumnWidth || 280, 220, 520, 10, (value) => {
      config.boardColumnWidth = value;
      actions.onChange();
    });
  }

  private renderDefaultColumnWidth(panel: HTMLElement, config: ViewConfig, actions: ViewConfigPanelActions): void {
    this.renderRange(panel, t("viewConfig.defaultColumnWidth"), this.getDefaultColumnWidth(config), 80, 800, 10, (value) => {
      const next = Math.max(80, Math.min(800, Math.round(value)));
      config.defaultColumnWidth = next;
      for (const col of config.schema.columns) {
        if (col.key === "file.name") continue;
        col.width = next;
      }
      actions.onChange();
    });
  }

  private getDefaultColumnWidth(config: ViewConfig): number {
    if (config.defaultColumnWidth) return config.defaultColumnWidth;
    const columns = config.schema.columns.filter((col) => col.key !== "file.name");
    if (columns.length === 0) return 150;
    const total = columns.reduce((sum, col) => sum + (col.width || 150), 0);
    return Math.round(total / columns.length);
  }

  private renderSelect(
    panel: HTMLElement,
    label: string,
    options: Array<{ value: string; text: string }>,
    value: string,
    onChange: (value: string) => void
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    const select = row.createEl("select", { cls: "db-control-select" });
    for (const option of options) {
      select.createEl("option", { value: option.value, text: option.text });
    }
    select.value = value;
    select.onchange = () => onChange(select.value);
  }

  private renderText(
    panel: HTMLElement,
    label: string,
    value: string,
    placeholder: string,
    onChange: (value: string) => void,
    disabled = false,
    helpText?: string,
    onInput?: (value: string) => void
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    const field = row.createDiv({ cls: "db-view-config-field" });
    if (disabled) {
      field.createDiv({ cls: "db-view-config-readonly-value", text: value || t("common.notSet") });
      if (helpText) field.createDiv({ cls: "db-view-config-help", text: helpText });
      return;
    }
    const input = field.createEl("input", {
      cls: "db-view-config-text",
      attr: { type: "text", placeholder },
    });
    input.value = value;
    input.oninput = () => onInput?.(input.value.trim());
    input.onchange = () => onChange(input.value.trim());
    if (helpText) field.createDiv({ cls: "db-view-config-help", text: helpText });
  }

  private renderTextarea(
    panel: HTMLElement,
    label: string,
    value: string,
    placeholder: string,
    onChange: (value: string) => void,
    disabled = false
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    if (disabled) {
      row.createDiv({ cls: "db-view-config-readonly-value db-view-config-readonly-multiline", text: value || t("common.notSet") });
      return;
    }
    const textarea = row.createEl("textarea", {
      cls: "db-view-config-textarea",
      attr: { placeholder, rows: "3" },
    });
    textarea.value = value;
    textarea.onchange = () => onChange(textarea.value.trim());
  }

  private renderCheckbox(
    panel: HTMLElement,
    label: string,
    value: boolean,
    onChange: (value: boolean) => void,
    disabled = false,
    helpText?: string
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    const field = row.createDiv({ cls: "db-view-config-field" });
    if (disabled) {
      field.createDiv({ cls: "db-view-config-readonly-value", text: value ? t("common.true") : t("common.false") });
      if (helpText) field.createDiv({ cls: "db-view-config-help", text: helpText });
      return;
    }
    const input = field.createEl("input", { attr: { type: "checkbox" } });
    input.checked = value;
    input.onchange = () => onChange(input.checked);
    if (helpText) field.createDiv({ cls: "db-view-config-help", text: helpText });
  }

  private renderRange(
    panel: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void
  ): void {
    const row = panel.createDiv({ cls: "db-view-config-row" });
    row.createDiv({ cls: "db-view-config-label", text: label });
    const controls = row.createDiv({ cls: "db-view-config-range" });
    const range = controls.createEl("input", {
      attr: { type: "range", min: String(min), max: String(max), step: String(step) },
    });
    const number = controls.createEl("input", {
      cls: "db-view-config-number",
      attr: { type: "number", min: String(min), max: String(max), step: String(step) },
    });
    const clamped = Math.max(min, Math.min(max, Math.round(value)));
    range.value = String(clamped);
    number.value = String(clamped);
    range.oninput = () => { number.value = range.value; };
    range.onchange = () => onChange(Number(range.value));
    number.onchange = () => {
      const next = Math.max(min, Math.min(max, Number(number.value) || value));
      number.value = String(next);
      range.value = String(next);
      onChange(next);
    };
  }
}
