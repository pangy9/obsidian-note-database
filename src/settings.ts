import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import NoteDatabasePlugin from "./main";
import { DatabaseConfig, PluginSettings, ViewConfig, generateId, TrashedDatabase } from "./data/types";
import { LocaleCode, setLocale, t } from "./i18n";
import { DeleteDatabaseModal } from "./views/modals/DeleteDatabaseModal";
import { DEFAULT_STATUS_PRESET_ID, getBuiltinStatusPresets, normalizeStatusPresets, resolveDefaultStatusPresetId } from "./data/ColumnTypes";
import { StatusPresetManagerModal } from "./views/modals/StatusPresetManagerModal";

/** Default databases shipped with the plugin. Keep empty for a neutral marketplace first run. */
export const DEFAULT_DATABASES: DatabaseConfig[] = [];

// Keep for migration compatibility
export const DEFAULT_VIEWS = DEFAULT_DATABASES;

export const DEFAULT_SETTINGS = {
  databases: DEFAULT_DATABASES,
  databaseFolder: "database",
  databaseFileOrder: [] as string[],
  dashboardInitialSource: "settings" as "settings" | "file",
  statusPresets: getBuiltinStatusPresets(),
  defaultStatusPresetId: DEFAULT_STATUS_PRESET_ID,
  language: "system" as LocaleCode,
};

export function createDefaultSettings(): PluginSettings {
  return {
    databases: [],
    databaseFolder: DEFAULT_SETTINGS.databaseFolder,
    databaseFileOrder: [],
    dashboardInitialSource: DEFAULT_SETTINGS.dashboardInitialSource,
    statusPresets: getBuiltinStatusPresets(),
    defaultStatusPresetId: DEFAULT_SETTINGS.defaultStatusPresetId,
    language: DEFAULT_SETTINGS.language,
  };
}

export class SettingsTab extends PluginSettingTab {
  private plugin: NoteDatabasePlugin;
  private draggedDatabaseIndex: number | null = null;

  constructor(app: App, plugin: NoteDatabasePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.addClass("note-database-settings");
    containerEl.createEl("h2", { text: t("settings.title") });

    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("system", t("settings.language.system"))
          .addOption("en", t("settings.language.en"))
          .addOption("zh-CN", t("settings.language.zhCN"))
          .addOption("zh-TW", t("settings.language.zhTW"))
          .setValue(this.plugin.settings.language || "system")
          .onChange(async (value) => {
            this.plugin.settings.language = value as LocaleCode;
            setLocale(this.plugin.settings.language);
            this.plugin.refreshCommandNames();
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.databaseFolder.name"))
      .setDesc(t("settings.databaseFolder.desc"))
      .addText((text) =>
        text
          .setPlaceholder("database")
          .setValue(this.plugin.settings.databaseFolder || "database")
          .onChange(async (value) => {
            this.plugin.settings.databaseFolder = value.trim() || "database";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.databaseFiles.name"))
      .setDesc(t("settings.databaseFiles.desc"))
      .addButton((btn) =>
        btn.setButtonText(t("settings.databaseFiles.open")).onClick(() => {
          this.plugin.showDatabaseFiles();
        })
      );

    new Setting(containerEl)
      .setName(t("settings.dashboardInitialSource.name"))
      .setDesc(t("settings.dashboardInitialSource.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("settings", t("settings.dashboardInitialSource.settings"))
          .addOption("file", t("settings.dashboardInitialSource.file"))
          .setValue(this.plugin.settings.dashboardInitialSource || DEFAULT_SETTINGS.dashboardInitialSource)
          .onChange(async (value) => {
            this.plugin.settings.dashboardInitialSource = value === "file" ? "file" : "settings";
            await this.plugin.saveSettings();
            this.plugin.notifyViewSettingsChanged();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.csvMarkdownTransfer.name"))
      .setDesc(t("settings.csvMarkdownTransfer.desc"))
      .addButton((btn) =>
        btn.setButtonText(t("settings.csvMarkdownTransfer.import")).onClick(() => {
          void this.plugin.importCsvMarkdownFiles();
        })
      )
      .addButton((btn) =>
        btn.setButtonText(t("settings.csvMarkdownTransfer.export")).onClick(() => {
          void this.plugin.exportCurrentViewAsCsvMarkdownZip();
        })
      );

    this.renderGlobalStatusPresetSetting(containerEl);

    containerEl.createEl("h3", { text: t("settings.databaseList.title") });
    containerEl.createEl("p", {
      text: t("settings.databaseList.desc"),
      cls: "db-muted-desc",
    });

    if (this.plugin.settings.databases.length === 0) {
      const empty = containerEl.createDiv({ cls: "db-settings-empty" });
      empty.createDiv({ cls: "db-settings-empty-title", text: t("settings.empty.title") });
      empty.createDiv({ cls: "db-settings-empty-desc", text: t("settings.empty.desc") });
    } else {
      const list = containerEl.createDiv({ cls: "db-settings-database-list" });
      for (let i = 0; i < this.plugin.settings.databases.length; i++) {
        this.renderDatabaseSettings(list, i);
      }
    }

    const addDatabaseButton = containerEl.createEl("button", { cls: "db-settings-add-database" });
    setIcon(addDatabaseButton.createSpan({ cls: "db-settings-add-icon" }), "plus");
    addDatabaseButton.createSpan({ text: t("settings.addDatabase") });
    addDatabaseButton.onclick = async () => {
      this.plugin.settings.databases.push(this.createEmptyDatabase());
      await this.plugin.saveSettings();
      this.display();
    };

    // Recycle bin
    this.renderTrashSection(containerEl);
  }

  private renderGlobalStatusPresetSetting(containerEl: HTMLElement): void {
    const presets = normalizeStatusPresets(this.plugin.settings.statusPresets);
    this.plugin.settings.statusPresets = presets;
    this.plugin.settings.defaultStatusPresetId = resolveDefaultStatusPresetId(presets, this.plugin.settings.defaultStatusPresetId);
    new Setting(containerEl)
      .setName(t("settings.statusPresets.name"))
      .setDesc(t("settings.statusPresets.desc"))
      .addDropdown((dropdown) => {
        for (const preset of presets) dropdown.addOption(preset.id, preset.name);
        dropdown
          .setValue(this.plugin.settings.defaultStatusPresetId || DEFAULT_STATUS_PRESET_ID)
          .onChange(async (value) => {
            this.plugin.settings.defaultStatusPresetId = value;
            await this.plugin.saveSettings();
            this.display();
          });
      })
      .addButton((btn) =>
        btn.setButtonText(t("statusPresets.manage")).onClick(() => {
          new StatusPresetManagerModal(
            this.app,
            t("settings.statusPresets.name"),
            this.plugin.settings.statusPresets || getBuiltinStatusPresets(),
            this.plugin.settings.defaultStatusPresetId,
            async (nextPresets, defaultPresetId) => {
              this.plugin.settings.statusPresets = nextPresets;
              this.plugin.settings.defaultStatusPresetId = defaultPresetId;
              await this.plugin.saveSettings();
              this.display();
            }
          ).open();
        })
      );
  }

  private createEmptyDatabase(): DatabaseConfig {
    const view: ViewConfig = {
      id: generateId(),
      name: t("common.tableView"),
      viewType: "table",
      sourceFolder: "",
      typeFilter: "",
      schema: {
        columns: [
          { key: "file.name", label: t("defaults.nameColumn"), type: "text" },
        ],
        computedFields: [],
      },
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

  private renderDatabaseSettings(parent: HTMLElement, index: number): void {
    const db = this.plugin.settings.databases[index];

    const section = parent.createDiv({
      cls: "settings-section db-settings-database-card",
    });
    section.ondragover = (event) => {
      if (this.draggedDatabaseIndex == null || this.draggedDatabaseIndex === index) return;
      event.preventDefault();
      section.addClass("is-drop-target");
    };
    section.ondragleave = () => section.removeClass("is-drop-target");
    section.ondrop = (event) => {
      if (this.draggedDatabaseIndex == null || this.draggedDatabaseIndex === index) return;
      event.preventDefault();
      section.removeClass("is-drop-target");
      void this.moveSettingsDatabase(this.draggedDatabaseIndex, index);
    };

    const heading = section.createDiv({ cls: "db-settings-database-heading" });
    const drag = heading.createSpan({
      cls: "db-settings-database-drag",
      text: "⋮⋮",
      attr: { title: t("panel.dragToSort") },
    });
    drag.draggable = true;
    drag.ondragstart = (event) => {
      this.draggedDatabaseIndex = index;
      event.dataTransfer?.setData("text/plain", String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      section.addClass("is-dragging");
    };
    drag.ondragend = () => {
      this.draggedDatabaseIndex = null;
      section.removeClass("is-dragging");
      parent.querySelectorAll(".db-settings-database-card.is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
    };
    const moveControls = heading.createSpan({ cls: "db-mobile-reorder-controls" });
    const upBtn = moveControls.createEl("button", {
      attr: { type: "button", title: t("menu.moveUp"), "aria-label": t("menu.moveUp") },
    });
    setIcon(upBtn, "arrow-up");
    upBtn.disabled = index === 0;
    upBtn.onclick = (event) => {
      event.preventDefault();
      void this.moveSettingsDatabase(index, index - 1);
    };
    const downBtn = moveControls.createEl("button", {
      attr: { type: "button", title: t("menu.moveDown"), "aria-label": t("menu.moveDown") },
    });
    setIcon(downBtn, "arrow-down");
    downBtn.disabled = index >= this.plugin.settings.databases.length - 1;
    downBtn.onclick = (event) => {
      event.preventDefault();
      void this.moveSettingsDatabase(index, index + 1);
    };
    const title = heading.createDiv({ cls: "db-settings-database-title" });
    title.createEl("h4", { text: db.name || t("common.untitledDatabase") });
    const deleteButton = heading.createEl("button", {
      cls: "db-settings-delete-button db-trash-button",
      attr: { type: "button", title: t("settings.deleteDatabase"), "aria-label": t("settings.deleteDatabase") },
    });
    setIcon(deleteButton, "trash");
    deleteButton.onclick = async () => {
      await this.deleteSettingsDatabase(index);
    };
  }

  private async moveSettingsDatabase(fromIndex: number, toIndex: number): Promise<void> {
    const databases = this.plugin.settings.databases;
    if (fromIndex < 0 || fromIndex >= databases.length || toIndex < 0 || toIndex >= databases.length) return;
    const [db] = databases.splice(fromIndex, 1);
    databases.splice(toIndex, 0, db);
    this.draggedDatabaseIndex = null;
    await this.plugin.saveSettings();
    this.display();
  }

  private async deleteSettingsDatabase(index: number): Promise<void> {
    const db = this.plugin.settings.databases[index];
    if (!db) return;
    const records = this.plugin.dataSource?.getRecordsForConfig(db) || [];
    const result = await new DeleteDatabaseModal(this.app, db.name || t("common.untitledDatabase"), records.length).open();
    if (!result) return;

    if (result.deleteFiles && this.plugin.dataSource) {
      for (const record of records) {
        try {
          await this.plugin.dataSource.trashNote(record.file);
        } catch (e) {
          console.warn(`Failed to trash file ${record.file.path}:`, e);
        }
      }
    }

    if (result.action === "trash") {
      if (!this.plugin.settings.trashedDatabases) this.plugin.settings.trashedDatabases = [];
      this.plugin.settings.trashedDatabases.push({
        database: JSON.parse(JSON.stringify(db)) as DatabaseConfig,
        deletedAt: Date.now(),
      });
    }

    this.plugin.settings.databases.splice(index, 1);
    await this.plugin.saveSettings();
    this.display();
  }

  private renderTrashSection(containerEl: HTMLElement): void {
    const trash = this.plugin.settings.trashedDatabases;
    if (!trash || trash.length === 0) return;

    containerEl.createEl("h3", { text: t("settings.trash") });

    for (let i = 0; i < trash.length; i++) {
      const item = trash[i];
      const section = containerEl.createDiv({ cls: "db-settings-trash-row" });
      const info = section.createDiv({ cls: "db-settings-trash-info" });
      info.createSpan({ cls: "db-settings-trash-name", text: item.database.name || t("common.untitled") });
      info.createSpan({ cls: "db-settings-trash-date", text: new Date(item.deletedAt).toLocaleDateString() });

      const actions = section.createDiv({ cls: "db-settings-trash-actions" });
      actions.createEl("button", { cls: "db-settings-trash-restore", text: t("common.restore") }).onclick = async () => {
        this.plugin.settings.databases.push(item.database);
        trash.splice(i, 1);
        await this.plugin.saveSettings();
        this.display();
      };
      actions.createEl("button", { cls: "db-settings-trash-danger", text: t("common.permanentlyDelete") }).onclick = async () => {
        if (window.confirm(t("settings.confirmPermanentDelete", { name: item.database.name || t("common.untitled") }))) {
          trash.splice(i, 1);
          await this.plugin.saveSettings();
          this.display();
        }
      };
    }
  }
}
