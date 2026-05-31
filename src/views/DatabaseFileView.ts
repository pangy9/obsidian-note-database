import { WorkspaceLeaf } from "obsidian";
import { DataSource } from "../data/DataSource";
import { DatabaseConfig, StatusPresetDef } from "../data/types";
import { t } from "../i18n";
import { DatabaseView } from "./DatabaseView";

export const DATABASE_FILE_VIEW_TYPE = "note-database-file-view";

export class DatabaseFileDashboardView extends DatabaseView {
  private filePath: string;

  constructor(
    leaf: WorkspaceLeaf,
    dataSource: DataSource,
    databases: DatabaseConfig[],
    filePath: string,
    databaseFolder: string,
    statusPresets: StatusPresetDef[],
    defaultStatusPresetId: string | undefined,
    onConfigChanged: () => Promise<void>,
  ) {
    super(leaf, dataSource, [], databaseFolder, statusPresets, defaultStatusPresetId, onConfigChanged);
    this.filePath = filePath;
  }

  getViewType(): string {
    return DATABASE_FILE_VIEW_TYPE;
  }

  protected get hideDatabaseActions(): boolean {
    return true;
  }

  getDisplayText(): string {
    return this.filePath ? this.filePath.replace(/\.md$/, "") : t("app.name");
  }

  getIcon(): string {
    return "database";
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.contentEl.addClass("note-database-file-view");
    // Navigate to the database matching this file
    if (this.filePath) {
      this.openViewReference(this.filePath);
    }
  }
}
