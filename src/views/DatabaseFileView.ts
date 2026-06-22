import { TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { DataSource } from "../data/DataSource";
import { DatabaseConfig, StatusPresetDef } from "../data/types";
import { t } from "../i18n";
import { DatabaseView } from "./DatabaseView";

export const DATABASE_FILE_VIEW_TYPE = "note-database-file-view";

export class DatabaseFileDashboardView extends DatabaseView {
  allowNoFile = false;
  file: TFile | null = null;
  navigation = true;
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
    this.syncFileReference();
  }

  getViewType(): string {
    return DATABASE_FILE_VIEW_TYPE;
  }

  protected get hideDatabaseActions(): boolean {
    return true;
  }

  getDisplayText(): string {
    if (!this.filePath) return t("app.name");
    return this.getDisplayFileName(this.filePath);
  }

  getIcon(): string {
    return "database";
  }

  getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      file: this.filePath,
    };
  }

  getEphemeralState(): Record<string, unknown> {
    return this.withFilePath(super.getEphemeralState());
  }

  setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const nextPath = this.getStateFilePath(state);
    if (nextPath && nextPath !== this.filePath) {
      this.filePath = nextPath;
    }
    await super.setState(state, result);
    this.syncFileReference();
    if (nextPath) this.openViewReference(nextPath);
    this.syncLeafFileState();
  }

  async onOpen(): Promise<void> {
    await super.onOpen();
    this.contentEl.addClass("note-database-file-view");
    // Navigate to the database matching this file
    if (this.filePath) {
      this.openViewReference(this.filePath);
    }
    this.syncFileReference();
    this.syncLeafFileState();
  }

  async onClose(): Promise<void> {
    await super.onClose();
  }

  async onRename(file: TFile): Promise<void> {
    if (this.file !== file) return;
    this.filePath = file.path;
    this.syncLeafFileState();
  }

  private getStateFilePath(state: unknown): string {
    if (!state || typeof state !== "object" || Array.isArray(state)) return "";
    const file = (state as { file?: unknown }).file;
    return typeof file === "string" ? file : "";
  }

  private getDisplayFileName(path: string): string {
    const fileName = path.split("/").pop() || path;
    return fileName.replace(/\.md$/i, "");
  }

  private withFilePath(state: unknown): Record<string, unknown> {
    const base = state && typeof state === "object" && !Array.isArray(state)
      ? { ...(state as Record<string, unknown>) }
      : {};
    if (this.filePath) base.file = this.filePath;
    return base;
  }

  private syncFileReference(): void {
    this.file = this.filePath ? this.app.vault.getFileByPath(this.filePath) : null;
  }

  private syncLeafFileState(): void {
    if (this.filePath) {
      this.leaf.setEphemeralState(this.withFilePath(this.leaf.getEphemeralState()));
    }
  }
}
