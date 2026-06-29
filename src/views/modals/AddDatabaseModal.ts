import { App, Modal } from "obsidian";
import { t } from "../../i18n";
import { ColumnDef, DatabaseConfig, StatusPresetDef, ViewConfig, generateId } from "../../data/types";
import { normalizeStatusPresets } from "../../data/ColumnTypes";
import { AddDatabaseModalResult } from "../../data/AddDatabaseResult";
import { ViewConfigPanelActions, ViewConfigPanelRenderer } from "../ViewConfigPanelRenderer";
import { StatusPresetManagerModal } from "./StatusPresetManagerModal";

export class AddDatabaseModal extends Modal {
  private resolve?: (result: AddDatabaseModalResult | null) => void;
  private readonly globalStatusPresets: StatusPresetDef[];
  private readonly globalDefaultStatusPresetId?: string;
  private tempDb: DatabaseConfig;
  private globalsHost?: HTMLElement;

  constructor(
    app: App,
    globalStatusPresets: StatusPresetDef[] = [],
    globalDefaultStatusPresetId?: string,
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
    contentEl.createEl("h3", { text: t("addDatabase.title") });

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
      onDatabaseChange: () => this.scheduleRerender(),
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
    };
  }

  onClose(): void {
    this.resolve?.(null);
    this.contentEl.empty();
  }
}
