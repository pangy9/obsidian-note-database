import { App, Modal, Notice, setIcon } from "obsidian";
import { makeModalDraggable } from "./ModalDrag";
import { t } from "../../i18n";
import { ColumnDef, DatabaseConfig, StatusPresetDef, ViewConfig, generateId } from "../../data/types";
import { normalizeStatusPresets } from "../../data/ColumnTypes";
import { AddDatabaseModalResult } from "../../data/AddDatabaseResult";
import { ViewConfigPanelActions, ViewConfigPanelRenderer } from "../ViewConfigPanelRenderer";
import { StatusPresetManagerModal } from "./StatusPresetManagerModal";
import { createDropdownField } from "../DropdownField";
import { buildStarterDatabaseConfig, getStarterRecordFolder, getStarterTemplate, getStarterTemplates, type StarterTemplateId } from "../../data/DatabaseStarterTemplates";
import { SavedVaultStarter, loadVaultStarters, instantiateVaultStarter, getMissingStarterAssets } from "../../data/VaultStarterTemplates";
import { getDatabaseDropdownIcon, renderDatabaseDropdownIcon, renderRecordIcon } from "../RecordIconRenderer";
import { confirmWithModal } from "./ConfirmModal";

export class AddDatabaseModal extends Modal {
  private resolve?: (result: AddDatabaseModalResult | null) => void;
  private readonly globalStatusPresets: StatusPresetDef[];
  private readonly globalDefaultStatusPresetId?: string;
  private tempDb: DatabaseConfig;
  private globalsHost?: HTMLElement;
  private starterPreviewHost?: HTMLElement;
  private starterTemplateId?: StarterTemplateId;
  private includeStarterSamples = true;
  private initialStarterFolder = "";
  private customStarters: SavedVaultStarter[] = [];
  private customStarter?: SavedVaultStarter;
  private pickerHost?: HTMLElement;
  private pickerClose?: () => void;
  private initialCover?: string;
  private closed = false;

  constructor(
    app: App,
    globalStatusPresets: StatusPresetDef[] = [],
    globalDefaultStatusPresetId?: string,
    private databaseFolder = "database",
  ) {
    super(app);
    this.globalStatusPresets = normalizeStatusPresets(globalStatusPresets);
    this.globalDefaultStatusPresetId = globalDefaultStatusPresetId;
    this.tempDb = this.createTempDatabase();
  }

  /** Build the in-memory config the modal edits. Source-rule / status-preset fields start
   *  unset so the created database inherits global defaults unless the user customizes. */
  private createTempDatabase(): DatabaseConfig {
    const nameColumn: ColumnDef = { key: "file.name", label: t("defaults.nameColumn"), type: "text" };
    const view: ViewConfig = {
      id: generateId(),
      name: t("common.tableView"),
      viewType: "table",
      sourceFolder: "",
      schema: { columns: [nameColumn], computedFields: [] },
      sortColumn: "",
      sortDirection: "asc",
    };
    return {
      id: generateId(),
      name: t("defaults.newDatabase"),
      sourceFolder: "",
      schema: view.schema,
      views: [view],
    };
  }

  openAndWait(): Promise<AddDatabaseModalResult | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv({ cls: "db-add-database-header note-database-container note-database-modal" });
    header.createEl("h3", { text: t("addDatabase.title") });
    this.closed = false;
    this.pickerHost = header.createDiv({ cls: "db-starter-picker" });
    this.renderPicker();
    void loadVaultStarters(this.app).then(({ templates, invalid }) => {
      if (this.closed) return;
      this.customStarters = templates;
      this.renderPicker();
      if (invalid.length) new Notice(t("starter.custom.invalid", { paths: invalid.join(", ") }), 10000);
    }).catch((error: unknown) => { if (!this.closed) new Notice(t("starter.custom.failed", { error: String(error) })); });
    this.starterPreviewHost = contentEl.createDiv({ cls: "db-starter-preview" });
    this.renderStarterPreview();

    makeModalDraggable(this);
    // Wrap the globals in `.note-database-container` so the scoped `db-view-config-*`
    // styles (which key off that ancestor) apply unchanged — the base selector only sets
    // CSS variables, so this is safe inside a modal. The same renderer powers the settings
    // popover, so the creation form is visually identical to editing an existing database.
    this.globalsHost = contentEl.createDiv({ cls: "note-database-container" });
    this.renderGlobals();

    const btnRow = contentEl.createDiv({ cls: "db-delete-modal-buttons" });
    btnRow.createEl("button", { text: t("common.cancel") }).onclick = () => {
      this.resolve?.(null);
      this.close();
    };
    const okBtn = btnRow.createEl("button", {
      cls: "mod-cta",
      text: t("addDatabase.create"),
    });
    okBtn.onclick = () => {
      this.resolve?.(this.collectResult());
      this.close();
    };
  }

  private renderPicker(): void {
    if (!this.pickerHost) return;
    this.pickerClose?.();
    this.pickerHost.empty();
    const picker = createDropdownField({
      parent: this.pickerHost, label: t("starter.select"),
      value: this.customStarter ? `vault:${this.customStarter.path}` : this.starterTemplateId || "blank",
      options: [
        { value: "blank", text: t("starter.blank"), icon: "database", description: t("starter.blankDesc") },
        ...getStarterTemplates().map((starter) => ({ value: starter.id, text: starter.name, icon: starter.icon,
          description: starter.description, section: t("starter.custom.builtIn") })),
        ...this.customStarters.map((starter) => ({ value: `vault:${starter.path}`, text: starter.name,
          icon: getDatabaseDropdownIcon(starter.config), description: starter.description, section: t("starter.custom.mine") })),
      ],
      renderIcon: (parent, icon) => { if (!renderDatabaseDropdownIcon(parent, icon)) setIcon(parent, icon); },
      hideLabel: true, popoverClassName: "db-starter-dropdown",
      onChange: (value) => this.selectStarter(value),
    });
    this.pickerClose = () => picker.close();
  }

  private selectStarter(value: string): void {
    const starter = getStarterTemplate(value);
    this.customStarter = this.customStarters.find((item) => `vault:${item.path}` === value);
    this.tempDb = this.createTempDatabase();
    this.starterTemplateId = starter?.id;
    this.includeStarterSamples = true;
    if (starter || this.customStarter) {
      const selected = (starter || this.customStarter)!;
      this.initialStarterFolder = getStarterRecordFolder(this.databaseFolder, selected.name);
      this.tempDb = this.customStarter
        ? instantiateVaultStarter(this.customStarter, selected.name, this.initialStarterFolder)
        : buildStarterDatabaseConfig(starter!, selected.name, this.initialStarterFolder, generateId);
      this.tempDb.description = selected.description;
      this.tempDb.statusPresets = normalizeStatusPresets([
        ...this.globalStatusPresets,
        ...(this.tempDb.statusPresets || []),
      ]);
    } else {
      this.initialStarterFolder = "";
    }
    this.initialCover = this.tempDb.coverImage;
    this.renderStarterPreview();
    this.renderGlobals();
  }

  private renderStarterPreview(): void {
    const host = this.starterPreviewHost;
    if (!host) return;
    host.empty();
    const starter = this.customStarter || getStarterTemplate(this.starterTemplateId);
    if (!starter) return;
    const heading = host.createDiv({ cls: "db-starter-preview-heading" });
    const icon = heading.createSpan({ cls: "db-starter-preview-icon" });
    if (this.customStarter) renderRecordIcon(icon, this.customStarter.config.icon, { compact: true, defaultIcon: "database" });
    else if ("icon" in starter) setIcon(icon, starter.icon);
    heading.createSpan({ text: starter.name });
    host.createDiv({
      cls: "db-starter-description",
      text: starter.description || (this.customStarter ? t("starter.custom.noDescription") : ""),
    });
    const views = host.createDiv({ cls: "db-starter-views" });
    const viewList = views.createSpan({ cls: "db-starter-views-list" });
    const viewIcons: Record<string, string> = {
      table: "table", board: "layout-grid", gallery: "image", list: "list",
      chart: "bar-chart", calendar: "calendar-days", timeline: "chart-gantt", form: "clipboard-list",
    };
    for (const view of this.customStarter?.config.views || ("views" in starter ? starter.views : [])) {
      const item = viewList.createSpan({ cls: "db-starter-view-item" });
      setIcon(item.createSpan(), viewIcons[view.viewType || "table"] || "table");
      item.createSpan({ text: view.name });
    }
    host.createDiv({ cls: "db-starter-counts", text: t("starter.preview", {
      fields: this.customStarter?.config.schema.columns.length ?? ("columns" in starter ? starter.columns.length : 0),
      records: starter.samples.length,
    }) });
    const sampleRow = host.createEl("label", { cls: "db-starter-samples" });
    const checkbox = sampleRow.createEl("input", { attr: { type: "checkbox" } });
    checkbox.checked = this.includeStarterSamples;
    checkbox.onchange = () => { this.includeStarterSamples = checkbox.checked; };
    sampleRow.createSpan({ text: t("starter.addSamples") });
    checkbox.disabled = starter.samples.length === 0;
    if (this.customStarter) {
      host.createEl("p", { cls: "db-modal-help", text: t("starter.custom.dependencies") });
      const missing = getMissingStarterAssets(this.app, this.customStarter);
      if (missing.length) host.createEl("p", { cls: "db-modal-help", text: t("starter.custom.missing", { paths: missing.join(", ") }) });
      const selected = this.customStarter;
      host.createEl("button", { text: t("starter.custom.delete") }).onclick = async () => {
        if (!await confirmWithModal(this.app, { title: t("starter.custom.delete"), message: t("starter.custom.deleteConfirm", { name: selected.name }), danger: true })) return;
        try {
          const file = this.app.vault.getAbstractFileByPath(selected.path);
          if (file) await this.app.fileManager.trashFile(file);
          this.customStarters = this.customStarters.filter((item) => item.path !== selected.path);
          if (this.closed) return;
          this.selectStarter("blank");
          this.renderPicker();
        } catch (error) { new Notice(t("starter.custom.failed", { error: String(error) })); }
      };
    }
  }

  private renderGlobals(): void {
    const host = this.globalsHost;
    if (!host) return;
    host.empty();
    const renderer = new ViewConfigPanelRenderer();
    const statusPresets = this.tempDb.statusPresets || this.globalStatusPresets;
    const defaultStatusPresetId = this.tempDb.defaultStatusPresetId || this.globalDefaultStatusPresetId;
    const actions: ViewConfigPanelActions = {
      app: this.app,
      database: this.tempDb,
      onChange: () => {},
      // Source-rule structural edits (add/remove rule, pick field/operator) go through
      // commit → onDatabaseChange. The settings popover rebuilds its whole panel via
      // refresh(); here we rebuild just the globals section, deferred to the next frame
      // so the rebuild never runs inside a click/focus handler (which could detach the
      // clicked button mid-click — e.g. typing the name then clicking "Add rule").
      onDatabaseChange: () => {
        if ((this.starterTemplateId || this.customStarter) && this.tempDb.sourceFolder === this.initialStarterFolder &&
          this.tempDb.newRecordFolder === this.initialStarterFolder) {
          this.initialStarterFolder = getStarterRecordFolder(this.databaseFolder, this.tempDb.name);
          this.tempDb.sourceFolder = this.initialStarterFolder;
          this.tempDb.newRecordFolder = this.initialStarterFolder;
        } else if ((this.starterTemplateId || this.customStarter) && this.tempDb.newRecordFolder === this.initialStarterFolder &&
          this.tempDb.sourceFolder !== this.initialStarterFolder) {
          // Keep the default creation destination with a manually changed source folder.
          this.tempDb.newRecordFolder = this.tempDb.sourceFolder;
        }
        this.scheduleRerender();
      },
      statusPresets,
      defaultStatusPresetId,
      statusPresetHelpText: t("viewConfig.statusPreset.help"),
      managedStatusPresetCount: statusPresets.length,
      onDefaultStatusPresetChange: (presetId) => {
        this.tempDb.defaultStatusPresetId = presetId;
      },
      onManageStatusPresets: () => this.openStatusPresetManager(),
      isDatabaseReadOnly: false,
    };
    renderer.renderDatabaseGlobals(host, this.tempDb, actions);
    renderer.renderStatusPresetSettings(host, {
      presets: statusPresets,
      defaultPresetId: defaultStatusPresetId,
      helpText: t("viewConfig.statusPreset.help"),
      managedPresetCount: statusPresets.length,
      onDefaultPresetChange: (presetId) => {
        this.tempDb.defaultStatusPresetId = presetId;
      },
      onManagePresets: () => this.openStatusPresetManager(),
    }, false);
  }

  private rerenderScheduled = false;

  /** Re-render the globals section on the next animation frame (deduped). Deferred so a
   *  rebuild triggered by blur/change never detaches the element a user just clicked. */
  private scheduleRerender(): void {
    if (this.rerenderScheduled) return;
    this.rerenderScheduled = true;
    window.requestAnimationFrame(() => {
      this.rerenderScheduled = false;
      this.renderGlobals();
    });
  }

  private openStatusPresetManager(): void {
    new StatusPresetManagerModal(
      this.app,
      t("viewConfig.statusPreset"),
      this.tempDb.statusPresets || this.globalStatusPresets,
      this.tempDb.defaultStatusPresetId || this.globalDefaultStatusPresetId,
      async (presets, defaultPresetId) => {
        // Once the user manages presets, the database stores its own set (no longer
        // inherits global). Re-render so the dropdown reflects the edited list.
        this.tempDb.statusPresets = presets;
        this.tempDb.defaultStatusPresetId = defaultPresetId;
        this.renderGlobals();
      },
    ).open();
  }

  private collectResult(): AddDatabaseModalResult {
    return {
      name: this.tempDb.name || t("defaults.newDatabase"),
      description: this.tempDb.description || undefined,
      sourceFolder: this.tempDb.sourceFolder || "",
      sourceRules: this.tempDb.sourceRules,
      sourceLogic: this.tempDb.sourceLogic,
      sourceRuleTree: this.tempDb.sourceRuleTree,
      newRecordFolder: this.tempDb.newRecordFolder,
      statusPresets: this.tempDb.statusPresets,
      defaultStatusPresetId: this.tempDb.defaultStatusPresetId,
      starterTemplateId: this.starterTemplateId,
      customStarter: this.customStarter ? structuredClone(this.customStarter) : undefined,
      coverImage: this.tempDb.coverImage !== this.initialCover ? this.tempDb.coverImage || "" : undefined,
      coverImagePositionY: this.tempDb.coverImagePositionY,
      newRecordTemplate: this.tempDb.newRecordTemplate,
      includeStarterSamples: this.starterTemplateId || this.customStarter ? this.includeStarterSamples : undefined,
      starterSourceFolderAuto: !!(this.starterTemplateId || this.customStarter) &&
        this.tempDb.sourceFolder === this.initialStarterFolder &&
        this.tempDb.newRecordFolder === this.initialStarterFolder,
    };
  }

  onClose(): void {
    this.closed = true;
    this.pickerClose?.();
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
