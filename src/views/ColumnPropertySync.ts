import { TFile } from "obsidian";
import { PropertyService } from "../data/PropertyService";
import { ColumnDef, ViewConfig } from "../data/types";

export interface RenameResult {
  moved: number;
  skippedConflicts: number;
  deletedStale: number;
}

export interface ChangeResult {
  changed: number;
  skipped: number;
}

export class ColumnPropertySync {
  constructor(
    private propertyService: PropertyService,
    private getFilesForConfig: (config: ViewConfig) => TFile[]
  ) {}

  rename(config: ViewConfig, col: ColumnDef, oldKey: string, newKey: string, force = false): Promise<RenameResult> | null {
    if (oldKey === newKey || oldKey === "file.name" || col.type === "computed" || col.type === "rollup" || col.type === "button") return null;
    return this.propertyService.renameKey(
      this.getFilesForConfig(config),
      oldKey,
      newKey,
      this.propertyService.getDefaultValue(col),
      force
    );
  }

  async ensure(config: ViewConfig, col: ColumnDef): Promise<ChangeResult> {
    if (col.type === "button") return { changed: 0, skipped: 0 };
    return this.propertyService.ensureKey(
      this.getFilesForConfig(config),
      col.key,
      this.propertyService.getDefaultValue(col)
    );
  }

  delete(config: ViewConfig, col: ColumnDef, files = this.getFilesForConfig(config)): Promise<ChangeResult> {
    if (col.type === "button") return Promise.resolve({ changed: 0, skipped: 0 });
    return this.propertyService.deleteKey(files, col.key);
  }

  copy(config: ViewConfig, fromKey: string, toKey: string): Promise<ChangeResult> {
    if (config.schema.columns.some((col) => (col.key === fromKey || col.key === toKey) && col.type === "button")) return Promise.resolve({ changed: 0, skipped: 0 });
    return this.propertyService.copyKey(this.getFilesForConfig(config), fromKey, toKey);
  }

  async convert(config: ViewConfig, col: ColumnDef, type: ColumnDef["type"]): Promise<ChangeResult> {
    if (col.type === "button" || type === "button") return { changed: 0, skipped: 0 };
    const files = this.getFilesForConfig(config);
    await this.propertyService.ensureKey(files, col.key, this.propertyService.getDefaultValue(col));
    return this.propertyService.convertKeyType(files, col.key, type);
  }
}
