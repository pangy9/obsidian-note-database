import { App, Modal, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import NoteDatabasePlugin from "./main";
import { DatabaseConfig, PluginSettings, ViewConfig, generateId, TrashedDatabase } from "./data/types";
import { LocaleCode, setLocale, t } from "./i18n";
import { DeleteDatabaseModal } from "./views/modals/DeleteDatabaseModal";
import { DEFAULT_STATUS_PRESET_ID, getBuiltinStatusPresets, normalizeStatusPresets, resolveDefaultStatusPresetId } from "./data/ColumnTypes";
import { StatusPresetManagerModal } from "./views/modals/StatusPresetManagerModal";
import { AddDatabaseModal } from "./views/modals/AddDatabaseModal";
import { DatabaseFileEntry, moveDatabaseFilePath, sortDatabaseFileEntries } from "./data/DatabaseFileOrder";

/** Default databases shipped with the plugin. Keep empty for a neutral marketplace first run. */
export const DEFAULT_DATABASES: DatabaseConfig[] = [];

// Keep for migration compatibility
export const DEFAULT_VIEWS = DEFAULT_DATABASES;

export const DEFAULT_SETTINGS = {
  databases: DEFAULT_DATABASES,
  databaseFolder: "database",
  databaseFileOrder: [] as string[],
  statusPresets: getBuiltinStatusPresets(),
  defaultStatusPresetId: DEFAULT_STATUS_PRESET_ID,
  language: "system" as LocaleCode,
};

export function createDefaultSettings(): PluginSettings {
  return {
    databases: [],
    databaseFolder: DEFAULT_SETTINGS.databaseFolder,
    databaseFileOrder: [],
    statusPresets: getBuiltinStatusPresets(),
    defaultStatusPresetId: DEFAULT_SETTINGS.defaultStatusPresetId,
    language: DEFAULT_SETTINGS.language,
  };
}

export class SettingsTab extends PluginSettingTab {
  private plugin: NoteDatabasePlugin;
  /** 文件型数据库拖拽排序状态 */
  private draggedFileEntry: DatabaseFileEntry | null = null;

  constructor(app: App, plugin: NoteDatabasePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.addClass("note-database-settings");
    new Setting(containerEl).setName(t("settings.title")).setHeading();

    // 分组 1：通用设置
    const general = this.createSettingGroup(containerEl, "settings.groups.general");
    new Setting(general)
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
    new Setting(general)
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

    // 分组 2：数据管理
    const dataMgmt = this.createSettingGroup(containerEl, "settings.groups.dataManagement");
    new Setting(dataMgmt)
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
    // 回收站入口（在数据管理分组中）
    const trashCount = this.plugin.settings.trashedDatabases?.length ?? 0;
    new Setting(dataMgmt)
      .setName(t("settings.trash.name"))
      .setDesc(t("settings.trash.manageDesc"))
      .addButton((btn) =>
        btn.setButtonText(`${t("settings.trash.name")}${trashCount > 0 ? ` (${trashCount})` : ""}`).onClick(() => {
          new TrashManagerModal(this.app, this.plugin, () => this.display()).open();
        })
      );

    // 分组 3：全局状态预设
    const presets = this.createSettingGroup(containerEl, "settings.groups.statusPresets");
    this.renderGlobalStatusPresetSetting(presets);

    // 分组 4：数据库
    const dbFilesGroup = containerEl.createDiv({ cls: "setting-group", attr: { id: "db-settings-database-group" } });
    dbFilesGroup.createDiv({ cls: "setting-group-title", text: t("settings.groups.databaseFiles") });
    dbFilesGroup.createDiv({ cls: "setting-group-desc", text: t("settings.groups.databaseFiles.desc") });
    const dbFiles = dbFilesGroup.createDiv({ cls: "setting-group-body" });
    this.renderAddDatabaseButton(dbFiles);
    const files = sortDatabaseFileEntries(this.plugin.dataSource.getViewDefFiles(), this.plugin.settings.databaseFileOrder || []);
    if (files.length === 0) {
      dbFiles.createDiv({ cls: "db-panel-empty", text: t("settings.databaseFiles.emptyHint") });
    } else {
      const list = dbFiles.createDiv({ cls: "db-settings-database-list" });
      for (let i = 0; i < files.length; i++) {
        this.renderFileDatabaseCard(list, files, i);
      }
    }
  }

  /** 创建一个分组卡片，返回 body 容器供添加内容 */
  private createSettingGroup(
    parent: HTMLElement,
    titleKey: string,
    descKey?: string,
  ): HTMLElement {
    const group = parent.createDiv({ cls: "setting-group" });
    group.createDiv({ cls: "setting-group-title", text: t(titleKey) });
    if (descKey) {
      group.createDiv({ cls: "setting-group-desc", text: t(descKey) });
    }
    return group.createDiv({ cls: "setting-group-body" });
  }

  /** 关闭 Obsidian 设置面板 */
  private closeSettings(): void {
    // Obsidian 内部 API：app.setting.close() 可关闭设置面板
    const setting = (this.app as any).setting;
    if (setting && typeof setting.close === "function") {
      setting.close();
    }
  }

  /** 渲染新建数据库按钮 */
  private renderAddDatabaseButton(parent: HTMLElement): void {
    const btn = parent.createEl("button", { cls: "db-settings-add-database" });
    setIcon(btn.createSpan({ cls: "db-settings-add-icon" }), "plus");
    btn.createSpan({ text: t("settings.addDatabaseFile") });
    btn.onclick = async () => {
      const result = await new AddDatabaseModal(
        this.app,
        this.plugin.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder,
      ).open();
      if (!result) return;
      const name = this.getUniqueDatabaseName(result.name || t("defaults.newDatabase"));
      const db = this.createEmptyDatabase(name, result.sourceFolder, result.typeFilter);
      const file = await this.plugin.dataSource.createViewDefFile(
        this.plugin.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder,
        name,
        db
      );
      new Notice(t("notice.createdDbFile", { path: file.path }));
      this.closeSettings();
      await this.plugin.openDashboardReference(file.path);
    };
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

  private getUniqueDatabaseName(baseName: string): string {
    const existing = new Set([
      ...this.plugin.settings.databases.map((db) => db.name),
      ...this.plugin.dataSource.getViewDefFiles().map((entry) => entry.config.name),
    ]);
    if (!existing.has(baseName)) return baseName;
    let i = 1;
    while (existing.has(`${baseName} ${i}`)) i++;
    return `${baseName} ${i}`;
  }

  private createEmptyDatabase(name = t("defaults.newDatabase"), sourceFolder = "", typeFilter = ""): DatabaseConfig {
    const view: ViewConfig = {
      id: generateId(),
      name: t("common.tableView"),
      viewType: "table",
      sourceFolder,
      typeFilter,
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
      name,
      sourceFolder,
      typeFilter: typeFilter || undefined,
      schema: view.schema,
      views: [view],
    };
  }

  /** 渲染文件型数据库卡片（含拖拽、路径、元信息、hover 操作按钮） */
  private renderFileDatabaseCard(parent: HTMLElement, files: DatabaseFileEntry[], index: number): void {
    const entry = files[index];
    const config = entry.config;

    const section = parent.createDiv({
      cls: "settings-section db-settings-database-card",
      attr: { title: entry.file.path },
    });
    this.attachFileDragEvents(section, parent, files, index);

    const heading = section.createDiv({ cls: "db-settings-database-heading" });
    this.renderFileDragHandle(heading, section, parent, files, index);
    this.renderMobileReorder(heading, index, files.length, (from, to) => this.moveFileDatabase(files, from, to));

    const title = heading.createDiv({ cls: "db-settings-database-title" });
    new Setting(title).setName(config.name || entry.file.basename).setHeading();

    // 文件路径
    heading.createSpan({
      cls: "db-settings-database-path",
      text: entry.file.path,
      attr: { title: entry.file.path },
    });

    // 元信息：列数、视图数
    heading.createSpan({
      cls: "db-settings-database-meta",
      text: `${config.schema?.columns?.length ?? 0} ${t("settings.databaseList.columns")}, ${config.views?.length ?? 0} ${t("settings.databaseList.views")}`,
    });

    // 打开按钮（hover 时显示）
    const openBtn = heading.createEl("button", {
      cls: "db-settings-open-button",
      attr: { type: "button", title: t("common.open"), "aria-label": t("common.open") },
    });
    setIcon(openBtn, "arrow-up-right");
    openBtn.onclick = () => {
      this.closeSettings();
      void this.plugin.openDashboardReference(entry.file.path);
    };

    // 删除按钮（hover 时显示）— 逻辑与配置型数据库一致
    const deleteButton = heading.createEl("button", {
      cls: "db-settings-delete-button",
      attr: { type: "button", title: t("settings.deleteDatabase"), "aria-label": t("settings.deleteDatabase") },
    });
    setIcon(deleteButton, "trash");
    deleteButton.onclick = async () => {
      // 文件型数据库也能查询到关联的笔记记录
      const records = this.plugin.dataSource?.getRecordsForConfig(config) || [];
      const result = await new DeleteDatabaseModal(this.app, config.name || entry.file.basename, records.length).open();
      if (!result) return;

      // 如果勾选了同时删除关联笔记文件，将它们移至系统回收站
      if (result.deleteFiles && this.plugin.dataSource) {
        for (const record of records) {
          try {
            await this.plugin.dataSource.trashNote(record.file);
          } catch (e) {
            console.warn(`Failed to trash file ${record.file.path}:`, e);
          }
        }
      }

      // Both actions remove the live database file. Plugin trash additionally keeps a restorable snapshot.
      try {
        await this.plugin.dataSource.trashNote(entry.file);
      } catch (e) {
        new Notice(t("errors.deleteFailed", { error: String(e) }));
        return;
      }

      if (result.action === "plugin-trash") {
        // 移至插件回收站：保存配置快照
        if (!this.plugin.settings.trashedDatabases) this.plugin.settings.trashedDatabases = [];
        this.plugin.settings.trashedDatabases.push({
          database: JSON.parse(JSON.stringify(config)) as DatabaseConfig,
          deletedAt: Date.now(),
        });
      }

      // 从 databaseFileOrder 中移除
      const order = this.plugin.settings.databaseFileOrder || [];
      this.plugin.settings.databaseFileOrder = order.filter((p) => p !== entry.file.path);
      try {
        await this.plugin.saveSettings();
      } catch (e) {
        console.error("Note Database: failed to save database trash settings", e);
        new Notice(t("errors.updateFailed", { error: String(e) }));
      }
      this.display();
    };
  }

  /** 给文件型数据库卡片添加拖拽事件 */
  private attachFileDragEvents(section: HTMLElement, parent: HTMLElement, files: DatabaseFileEntry[], index: number): void {
    section.ondragover = (event) => {
      if (this.draggedFileEntry == null || this.draggedFileEntry === files[index]) return;
      event.preventDefault();
      section.addClass("is-drop-target");
    };
    section.ondragleave = () => section.removeClass("is-drop-target");
    section.ondrop = (event) => {
      if (this.draggedFileEntry == null || this.draggedFileEntry === files[index]) return;
      event.preventDefault();
      section.removeClass("is-drop-target");
      void this.moveFileDatabase(files, files.indexOf(this.draggedFileEntry), index);
    };
  }

  /** 渲染文件型数据库拖拽手柄 */
  private renderFileDragHandle(heading: HTMLElement, section: HTMLElement, parent: HTMLElement, files: DatabaseFileEntry[], index: number): void {
    const drag = heading.createSpan({
      cls: "db-settings-database-drag",
      text: "⋮⋮",
      attr: { title: t("panel.dragToSort") },
    });
    drag.draggable = true;
    drag.ondragstart = (event) => {
      this.draggedFileEntry = files[index];
      event.dataTransfer?.setData("text/plain", files[index].file.path);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      section.addClass("is-dragging");
    };
    drag.ondragend = () => {
      this.draggedFileEntry = null;
      section.removeClass("is-dragging");
      parent.querySelectorAll(".db-settings-database-card.is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
    };
  }

  /** 渲染移动端上/下移按钮 */
  private renderMobileReorder(heading: HTMLElement, index: number, total: number, onMove: (from: number, to: number) => Promise<void>): void {
    const controls = heading.createSpan({ cls: "db-mobile-reorder-controls" });
    const upBtn = controls.createEl("button", {
      attr: { type: "button", title: t("menu.moveUp"), "aria-label": t("menu.moveUp") },
    });
    setIcon(upBtn, "arrow-up");
    upBtn.disabled = index === 0;
    upBtn.onclick = (event) => { event.preventDefault(); void onMove(index, index - 1); };
    const downBtn = controls.createEl("button", {
      attr: { type: "button", title: t("menu.moveDown"), "aria-label": t("menu.moveDown") },
    });
    setIcon(downBtn, "arrow-down");
    downBtn.disabled = index >= total - 1;
    downBtn.onclick = (event) => { event.preventDefault(); void onMove(index, index + 1); };
  }

  /** 移动文件型数据库顺序 */
  private async moveFileDatabase(files: DatabaseFileEntry[], fromIndex: number, toIndex: number): Promise<void> {
    if (fromIndex < 0 || fromIndex >= files.length || toIndex < 0 || toIndex >= files.length) return;
    const fromPath = files[fromIndex].file.path;
    const toPath = files[toIndex].file.path;
    // 先确保所有文件路径都在 order 中
    const order = [...(this.plugin.settings.databaseFileOrder || [])];
    for (const f of files) {
      if (!order.includes(f.file.path)) order.push(f.file.path);
    }
    this.plugin.settings.databaseFileOrder = moveDatabaseFilePath(order, fromPath, toPath);
    this.draggedFileEntry = null;
    await this.plugin.saveSettings();
    this.display();
  }

}

/** 回收站管理弹窗 */
class TrashManagerModal extends Modal {
  constructor(
    app: App,
    private plugin: NoteDatabasePlugin,
    private onRefresh: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("note-database-modal");
    contentEl.createEl("h3", { text: t("settings.trash.manageTitle") });
    contentEl.createDiv({ cls: "db-delete-modal-info", text: t("settings.trash.manageDesc") });

    const trash = this.plugin.settings.trashedDatabases;
    if (!trash || trash.length === 0) {
      contentEl.createDiv({ cls: "db-panel-empty", text: t("settings.trash.empty") });
      return;
    }

    const list = contentEl.createDiv({ cls: "db-trash-manager-list" });
    for (let i = 0; i < trash.length; i++) {
      const item = trash[i];
      const row = list.createDiv({ cls: "db-trash-manager-row" });

      // 左侧信息区
      const info = row.createDiv({ cls: "db-trash-manager-info" });
      const nameEl = info.createDiv({ cls: "db-trash-manager-name", text: item.database.name || t("common.untitled") });

      // 描述（最多 100 字）
      if (item.database.description) {
        const desc = item.database.description.length > 100
          ? item.database.description.slice(0, 100) + "..."
          : item.database.description;
        info.createDiv({ cls: "db-trash-manager-desc", text: desc });
      }

      // 元信息行：列数、视图数、删除日期
      const meta = info.createDiv({ cls: "db-trash-manager-meta" });
      meta.createSpan({ text: `${item.database.schema?.columns?.length ?? 0} ${t("settings.databaseList.columns")}, ${item.database.views?.length ?? 0} ${t("settings.databaseList.views")}` });
      meta.createSpan({ cls: "db-trash-manager-date", text: new Date(item.deletedAt).toLocaleDateString() });

      // 右侧操作按钮
      const actions = row.createDiv({ cls: "db-trash-manager-actions" });

      // 恢复按钮
      const restoreBtn = actions.createEl("button", {
        cls: "db-settings-trash-icon-btn",
        attr: { type: "button", title: t("common.restore"), "aria-label": t("common.restore") },
      });
      setIcon(restoreBtn, "rotate-ccw");
      restoreBtn.onclick = () => {
        this.openRestoreConfirmModal(item, i, trash);
      };

      // 永久删除按钮
      const permDeleteBtn = actions.createEl("button", {
        cls: "db-settings-trash-icon-btn db-settings-trash-danger",
        attr: { type: "button", title: t("common.permanentlyDelete"), "aria-label": t("common.permanentlyDelete") },
      });
      setIcon(permDeleteBtn, "trash-2");
      permDeleteBtn.onclick = async () => {
        if (window.confirm(t("settings.trash.confirmPermanentDelete", { name: item.database.name || t("common.untitled") }))) {
          trash.splice(i, 1);
          await this.plugin.saveSettings();
          this.onRefresh();
          this.onOpen();
        }
      };
    }
  }

  /** 恢复确认弹窗：选择恢复为数据库文件 */
  private openRestoreConfirmModal(item: TrashedDatabase, index: number, trash: TrashedDatabase[]): void {
    const self = this;
    const restoreModal = new class extends Modal {
      onOpen(): void {
        this.contentEl.empty();
        this.contentEl.addClass("note-database-modal");
        this.contentEl.createEl("h3", { text: t("settings.trash.restoreTitle", { name: item.database.name || t("common.untitled") }) });
        this.contentEl.createDiv({ cls: "db-delete-modal-info", text: t("settings.trash.restoreDesc") });

        const btnRow = this.contentEl.createDiv({ cls: "db-delete-modal-buttons" });
        btnRow.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();

        const fileBtn = btnRow.createEl("button", {
          cls: "mod-cta",
          text: t("settings.trash.restoreAsFile"),
        });
        fileBtn.onclick = async () => {
          const existing = new Set([
            ...self.plugin.dataSource.getViewDefFiles().map((e) => e.config.name),
          ]);
          let name = item.database.name || t("defaults.newDatabase");
          if (existing.has(name)) {
            let j = 1;
            while (existing.has(`${name} ${j}`)) j++;
            name = `${name} ${j}`;
          }
          try {
            const database = JSON.parse(JSON.stringify(item.database)) as DatabaseConfig;
            database.name = name;
            const file = await self.plugin.dataSource.createViewDefFile(
              self.plugin.settings.databaseFolder || DEFAULT_SETTINGS.databaseFolder,
              name,
              database,
            );
            trash.splice(index, 1);
            await self.plugin.saveSettings();
            self.onRefresh();
            this.close();
            new Notice(t("notice.createdDbFile", { path: file.path }));
            self.onOpen();
          } catch (e) {
            new Notice(t("errors.createFailed", { error: String(e) }));
          }
        };
      }
      onClose(): void { this.contentEl.empty(); }
    }(this.app);
    restoreModal.open();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
