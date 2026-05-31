import { Notice, TFile } from "obsidian";
import { DataSource } from "../data/DataSource";
import { PropertyService } from "../data/PropertyService";
import { t } from "../i18n";
import {
  createUniqueColumnKey,
  ensureColumnOrder,
  normalizeColumnOrder,
  updateColumnKeyReferences,
} from "../data/ColumnConfig";
import { createOptionsFromValues, isOptionColumnType } from "../data/ColumnTypes";
import { ColumnDef, DatabaseConfig, StatusOptionDef, ViewConfig } from "../data/types";
import { ColumnRenameResult } from "./modals/ColumnRenameModal";
import { DatabaseViewState, ViewStateStore } from "./ViewStateStore";
import { ColumnPropertySync } from "./ColumnPropertySync";

export interface FrontmatterValueChange {
  file: TFile;
  path: string;
  key: string;
  oldValue: unknown;
  oldExists: boolean;
  newValue: unknown;
}

export interface ColumnOperationsDeps {
  dataSource: DataSource;
  propertyService: PropertyService;
  viewStateStore: ViewStateStore;
  getConfig(): ViewConfig | undefined;
  getActiveDb(): DatabaseConfig;
  getState(): DatabaseViewState;
  getFilesForConfig(config: ViewConfig): TFile[];
  saveConfigImmediately(): Promise<void>;
  saveCurrentViewConfig(): Promise<void>;
  scheduleConfigSave(): void;
  refresh(): void;
  refreshSchemaChanged(): void;
  refreshAfterSave(): Promise<void>;
  markPendingColumn(key: string): void;
  refreshColumnManager(): void;
  setPendingUndoLabel(label: string): void;
  setPendingConfigCellChanges(changes: FrontmatterValueChange[]): void;
  getDefaultStatusOptions(): StatusOptionDef[];
}

export class ColumnOperations {
  private propertySync: ColumnPropertySync;

  constructor(private deps: ColumnOperationsDeps) {
    this.propertySync = new ColumnPropertySync(
      deps.propertyService,
      (config) => deps.getFilesForConfig(config)
    );
  }

  setColumnVisible(col: ColumnDef, visible: boolean): void {
    const config = this.deps.getConfig();
    if (!config) return;
    const state = this.deps.getState();
    if (visible) {
      state.hiddenColumns.delete(col.key);
    } else {
      state.hiddenColumns.add(col.key);
    }
    this.deps.viewStateStore.persist(config, state);
    this.deps.setPendingUndoLabel(t("undo.hideColumnsConfig"));
    this.deps.scheduleConfigSave();
    this.deps.refresh();
  }

  async renameColumn(col: ColumnDef, result: ColumnRenameResult): Promise<void> {
    const config = this.deps.getConfig();
    if (!config) return;

    const oldKey = col.key;
    const oldLabel = col.label;
    const oldComputedKey = col.computedKey || oldKey;
    const newKey = result.key.trim();
    const newLabel = result.label.trim() || newKey;
    if (!newKey) {
      new Notice(t("column.keyRequired"));
      return;
    }
    const duplicate = config.schema.columns.some((candidate) => candidate !== col && candidate.key === newKey);
    if (duplicate) {
      new Notice(t("column.keyExists", { key: newKey }));
      return;
    }

    let migrationNotice = "";
    try {
      if (result.migrateValues) {
        const migration = await this.propertySync.rename(config, col, oldKey, newKey, true);
        if (migration) {
          migrationNotice = t("column.migratedFiles", { count: migration.moved });
          if (migration.deletedStale > 0) {
            migrationNotice += t("column.cleanedOldProps", { count: migration.deletedStale });
          }
        }
      }

      ensureColumnOrder(config);
      const state = this.deps.getState();
      if (updateColumnKeyReferences(config, state, oldKey, newKey, oldLabel, newLabel)) {
        this.deps.viewStateStore.persist(config, state);
      }
      col.key = newKey;
      col.label = newLabel;
      col.wrap = result.wrap || undefined;
      if (col.type === "computed") {
        const computed = config.schema.computedFields.find((field) => field.key === oldComputedKey);
        if (computed) {
          computed.key = newKey;
          computed.label = newLabel;
        }
        col.computedKey = newKey;
      }
      normalizeColumnOrder(config);
      // Sync Obsidian property type for the new key
      await this.deps.propertyService.setObsidianPropertyType(newKey, col.type);
      this.deps.setPendingUndoLabel(t("undo.columnRenameConfig"));
      await this.deps.saveCurrentViewConfig();
      this.deps.refreshSchemaChanged();
      this.deps.refreshColumnManager();
      new Notice(t("column.updatedProperty", { label: newLabel, key: newKey, migration: migrationNotice }));
    } catch (err) {
      console.error("Note Database: failed to rename column", err);
      new Notice(t("column.renameFailed", { error: String(err) }));
    }
  }

  moveColumn(key: string, offset: -1 | 1): void {
    const config = this.deps.getConfig();
    if (!config) return;
    ensureColumnOrder(config);
    const index = config.columnOrder!.indexOf(key);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= config.columnOrder!.length) return;
    [config.columnOrder![index], config.columnOrder![nextIndex]] =
      [config.columnOrder![nextIndex], config.columnOrder![index]];
    this.deps.setPendingUndoLabel(t("undo.columnOrderConfig"));
    this.deps.scheduleConfigSave();
    this.deps.refresh();
  }

  moveColumnTo(key: string, targetKey: string, placement: "before" | "after"): void {
    const config = this.deps.getConfig();
    if (!config || key === targetKey) return;
    ensureColumnOrder(config);
    const order = config.columnOrder!;
    const from = order.indexOf(key);
    const target = order.indexOf(targetKey);
    if (from < 0 || target < 0) return;
    const [item] = order.splice(from, 1);
    let insertIndex = order.indexOf(targetKey);
    if (placement === "after") insertIndex += 1;
    order.splice(insertIndex, 0, item);
    this.deps.setPendingUndoLabel(t("undo.columnOrderConfig"));
    this.deps.scheduleConfigSave();
    this.deps.refresh();
  }

  hideColumn(col: ColumnDef): void {
    const config = this.deps.getConfig();
    const state = this.deps.getState();
    state.hiddenColumns.add(col.key);
    if (config) {
      ensureColumnOrder(config);
      this.deps.viewStateStore.persist(config, state);
    }
    this.deps.setPendingUndoLabel(t("undo.hideColumnsConfig"));
    this.deps.scheduleConfigSave();
    this.deps.refresh();
  }

  async deleteColumn(col: ColumnDef): Promise<void> {
    if (col.key === "file.name") return;
    if (!window.confirm(t("column.confirmDelete", { label: col.label, key: col.key }))) return;
    const config = this.deps.getConfig();
    if (!config) return;
    ensureColumnOrder(config);
    const files = this.deps.getFilesForConfig(config);
    const frontmatterChanges = col.type === "computed"
      ? []
      : this.getDeleteKeyChanges(config, col.key);
    const idx = config.schema.columns.findIndex((candidate) => candidate.key === col.key);
    if (idx >= 0) config.schema.columns.splice(idx, 1);
    if (col.type === "computed") {
      const computedKey = col.computedKey || col.key;
      config.schema.computedFields = config.schema.computedFields.filter((field) => field.key !== computedKey);
    }
    const db = this.deps.getActiveDb();
    const state = this.deps.getState();
    for (const view of db.views || [config]) {
      this.removeColumnReferences(view, col.key);
    }
    this.removeColumnFromState(state, col.key);
    this.deps.viewStateStore.persist(config, state);
    this.deps.viewStateStore.clear();
    this.deps.refreshSchemaChanged();

    try {
      this.deps.setPendingUndoLabel(t("undo.deleteColumnConfig"));
      this.deps.setPendingConfigCellChanges(frontmatterChanges);
      await this.deps.saveConfigImmediately();
      const result = col.type === "computed"
        ? { changed: 0, skipped: files.length }
        : await this.propertySync.delete(config, col);
      await this.deps.refreshAfterSave();
      this.deps.refreshColumnManager();
      new Notice(col.type === "computed" ? t("column.deletedComputed") : t("column.deletedColumn", { key: col.key, count: result.changed }));
    } catch (err) {
      console.error("Note Database: failed to delete column", err);
      new Notice(t("column.deleteFailed", { error: String(err) }));
    }
  }

  private removeColumnReferences(config: ViewConfig, key: string): void {
    ensureColumnOrder(config);
    config.columnOrder = (config.columnOrder || []).filter((candidate) => candidate !== key);
    config.hiddenColumns = (config.hiddenColumns || []).filter((candidate) => candidate !== key);
    config.filters = (config.filters || []).filter((rule) => rule.field !== key);
    config.sortRules = (config.sortRules || []).filter((rule) => rule.field !== key);
    if (config.sortColumn === key) {
      config.sortColumn = undefined;
      config.sortDirection = "asc";
    }
    if (config.groupByField === key) config.groupByField = undefined;
    if (config.titleField === key) config.titleField = undefined;
    if (config.boardGroupField === key) config.boardGroupField = undefined;
    if (config.boardSubgroupField === key) config.boardSubgroupField = undefined;
    delete config.groupOrders?.[key];
    delete config.collapsedGroups?.[key];
    delete config.boardCardOrders?.[key];
    for (const viewState of Object.values(config.viewStates || {})) {
      if (!viewState) continue;
      viewState.hiddenColumns = (viewState.hiddenColumns || []).filter((candidate) => candidate !== key);
      viewState.filters = (viewState.filters || []).filter((rule) => rule.field !== key);
      viewState.sortRules = (viewState.sortRules || []).filter((rule) => rule.field !== key);
      if (viewState.sortColumn === key) {
        viewState.sortColumn = undefined;
        viewState.sortDirection = "asc";
      }
      if (viewState.groupByField === key) viewState.groupByField = undefined;
    }
  }

  private removeColumnFromState(state: DatabaseViewState, key: string): void {
    state.hiddenColumns.delete(key);
    state.filters = state.filters.filter((rule) => rule.field !== key);
    state.sortRules = state.sortRules.filter((rule) => rule.field !== key);
    if (state.sortColumn === key) {
      state.sortColumn = undefined;
      state.sortDirection = "asc";
    }
    if (state.groupByField === key) state.groupByField = "";
  }

  async insertColumnNear(col: ColumnDef, side: "left" | "right"): Promise<void> {
    const config = this.deps.getConfig();
    if (!config) return;
    const newCol = this.createTextColumn(config);

    ensureColumnOrder(config);
    const schemaIndex = config.schema.columns.findIndex((candidate) => candidate.key === col.key);
    const schemaInsertIndex = side === "left"
      ? Math.max(schemaIndex, 0)
      : schemaIndex < 0 ? config.schema.columns.length : schemaIndex + 1;
    config.schema.columns.splice(schemaInsertIndex, 0, newCol);

    const orderIndex = config.columnOrder!.indexOf(col.key);
    const orderInsertIndex = side === "left"
      ? orderIndex < 0 ? 0 : orderIndex
      : orderIndex < 0 ? config.columnOrder!.length : orderIndex + 1;
    config.columnOrder!.splice(orderInsertIndex, 0, newCol.key);
    this.deps.markPendingColumn(newCol.key);

    await this.ensureNewColumnInFiles(config, newCol, t("column.insertColumn"), t("column.insertedColumn"));
  }

  async appendColumn(): Promise<void> {
    const config = this.deps.getConfig();
    if (!config) return;
    const newCol = this.createTextColumn(config);
    ensureColumnOrder(config);
    config.schema.columns.push(newCol);
    config.columnOrder!.push(newCol.key);
    this.deps.markPendingColumn(newCol.key);

    await this.ensureNewColumnInFiles(config, newCol, t("column.addColumn"), t("column.addedColumn"));
  }

  async duplicateColumn(col: ColumnDef): Promise<void> {
    const config = this.deps.getConfig();
    if (!config || col.key === "file.name") return;
    ensureColumnOrder(config);

    const copyKey = createUniqueColumnKey(config, `${col.key}_copy`);
    const copy: ColumnDef = {
      ...col,
      key: copyKey,
      label: t("column.copiedLabel", { label: col.label }),
      computedKey: col.type === "computed" ? copyKey : col.computedKey,
    };
    const schemaIndex = config.schema.columns.findIndex((candidate) => candidate.key === col.key);
    config.schema.columns.splice(schemaIndex < 0 ? config.schema.columns.length : schemaIndex + 1, 0, copy);
    const orderIndex = config.columnOrder!.indexOf(col.key);
    config.columnOrder!.splice(orderIndex < 0 ? config.columnOrder!.length : orderIndex + 1, 0, copyKey);
    if (col.type === "computed") {
      const source = config.schema.computedFields.find((field) => field.key === (col.computedKey || col.key));
      config.schema.computedFields.push({
        key: copyKey,
        label: copy.label,
        expression: source?.expression || "",
        type: source?.type || "text",
      });
    }
    this.deps.markPendingColumn(copyKey);
    const frontmatterChanges = col.type === "computed" ? [] : this.getCopyKeyChanges(config, col.key, copyKey);

    try {
      this.deps.setPendingUndoLabel(t("undo.duplicateColumnConfig"));
      this.deps.setPendingConfigCellChanges(frontmatterChanges);
      await this.deps.saveConfigImmediately();
      this.deps.refreshSchemaChanged();
      let changed = 0;
      if (col.type !== "computed") changed = (await this.propertySync.copy(config, col.key, copyKey)).changed;
      await this.deps.refreshAfterSave();
      this.deps.refreshColumnManager();
      new Notice(col.type === "computed" ? t("column.copiedComputed") : t("column.copiedColumn", { source: col.key, target: copyKey, count: changed }));
    } catch (err) {
      console.error("Note Database: failed to duplicate column", err);
      new Notice(t("column.copyColumnFailed", { error: String(err) }));
    }
  }

  async changeColumnType(col: ColumnDef, type: ColumnDef["type"]): Promise<void> {
    const config = this.deps.getConfig();
    if (!config || col.type === type) return;
    const target = config.schema.columns.find((candidate) => candidate.key === col.key);
    if (!target) return;
    const previousType = target.type;
    const previousComputedKey = target.computedKey || target.key;
    const previousOptions = target.statusOptions?.map((option) => ({ ...option }));

    const inferredOptions = isOptionColumnType(type)
      ? createOptionsFromValues(this.getRecords(config).map((record) => record.frontmatter[target.key]))
      : [];
    target.type = type;
    if (isOptionColumnType(type)) {
      if (previousOptions?.length) {
        target.statusOptions = previousOptions;
      } else if (inferredOptions.length > 0) {
        target.statusOptions = inferredOptions;
      } else if (!target.statusOptions?.length) {
        target.statusOptions = type === "status" ? this.deps.getDefaultStatusOptions() : [];
      }
    } else {
      target.statusOptions = undefined;
    }
    if (type === "computed") {
      target.computedKey = target.computedKey || target.key;
      const existing = config.schema.computedFields.find((field) => field.key === target.computedKey);
      if (!existing) {
        config.schema.computedFields.push({
          key: target.computedKey,
          label: target.label,
          expression: `=[${target.key}]`,
          type: "text",
        });
      }
    } else {
      if (previousType === "computed") {
        config.schema.computedFields = config.schema.computedFields.filter((field) => field.key !== previousComputedKey);
      }
      target.computedKey = undefined;
    }

    try {
      const frontmatterChanges = type === "computed" || target.key === "file.name"
        ? []
        : this.getConvertKeyTypeChanges(config, target.key, type);
      this.deps.setPendingUndoLabel(t("undo.columnTypeConfig"));
      this.deps.setPendingConfigCellChanges(frontmatterChanges);
      await this.deps.saveConfigImmediately();
      this.deps.refreshSchemaChanged();
      let changed = 0;
      if (type !== "computed" && target.key !== "file.name") {
        await this.deps.propertyService.setObsidianPropertyType(target.key, type);
        changed = (await this.propertySync.convert(config, target, type)).changed;
      }
      await this.deps.refreshAfterSave();
      this.deps.refreshColumnManager();
      new Notice(type === "computed" ? t("column.changedToComputed") : t("column.changedType", { key: target.key, count: changed }));
    } catch (err) {
      console.error("Note Database: failed to change column type", err);
      new Notice(t("column.changeTypeFailed", { error: String(err) }));
    }
  }

  private createTextColumn(config: ViewConfig): ColumnDef {
    return {
      key: createUniqueColumnKey(config, "new_field"),
      label: t("column.newColumn"),
      type: "text",
    };
  }

  private async ensureNewColumnInFiles(
    config: ViewConfig,
    col: ColumnDef,
    actionName: string,
    successPrefix: string
  ): Promise<void> {
    try {
      const frontmatterChanges = this.getEnsureKeyChanges(config, col);
      this.deps.setPendingUndoLabel(t("undo.insertColumnConfig"));
      this.deps.setPendingConfigCellChanges(frontmatterChanges);
      await this.deps.saveConfigImmediately();
      this.deps.refreshSchemaChanged();
      await this.deps.propertyService.setObsidianPropertyType(col.key, col.type);
      const result = await this.propertySync.ensure(config, col);
      await this.deps.refreshAfterSave();
      this.deps.refreshColumnManager();
      new Notice(t("column.addedProperty", { prefix: successPrefix, key: col.key, count: result.changed }));
    } catch (err) {
      console.error(`Note Database: failed to ${actionName}`, err);
      new Notice(t("column.actionFailed", { action: actionName, error: String(err) }));
    }
  }

  private getRecords(config: ViewConfig) {
    const db = this.deps.getActiveDb();
    const paths = new Set(this.deps.getFilesForConfig(config).map((file) => file.path));
    return this.deps.dataSource.getRecordsForConfig(db).filter((record) => paths.has(record.file.path));
  }

  private getDeleteKeyChanges(config: ViewConfig, key: string): FrontmatterValueChange[] {
    return this.getRecords(config)
      .filter((record) => Object.prototype.hasOwnProperty.call(record.frontmatter, key))
      .map((record) => ({
        file: record.file,
        path: record.file.path,
        key,
        oldValue: this.cloneValue(record.frontmatter[key]),
        oldExists: true,
        newValue: null,
      }));
  }

  private getEnsureKeyChanges(config: ViewConfig, col: ColumnDef): FrontmatterValueChange[] {
    if (col.key === "file.name" || col.type === "computed") return [];
    const defaultValue = this.deps.propertyService.getDefaultValue(col);
    return this.getRecords(config)
      .filter((record) => !Object.prototype.hasOwnProperty.call(record.frontmatter, col.key))
      .map((record) => ({
        file: record.file,
        path: record.file.path,
        key: col.key,
        oldValue: null,
        oldExists: false,
        newValue: this.cloneValue(defaultValue),
      }));
  }

  private getCopyKeyChanges(config: ViewConfig, sourceKey: string, targetKey: string): FrontmatterValueChange[] {
    return this.getRecords(config)
      .filter((record) => Object.prototype.hasOwnProperty.call(record.frontmatter, sourceKey))
      .filter((record) => {
        const targetValue = record.frontmatter[targetKey];
        return !Object.prototype.hasOwnProperty.call(record.frontmatter, targetKey) ||
          targetValue == null ||
          targetValue === "";
      })
      .map((record) => ({
        file: record.file,
        path: record.file.path,
        key: targetKey,
        oldValue: this.cloneValue(record.frontmatter[targetKey]),
        oldExists: Object.prototype.hasOwnProperty.call(record.frontmatter, targetKey),
        newValue: this.cloneValue(record.frontmatter[sourceKey]),
      }));
  }

  private getConvertKeyTypeChanges(
    config: ViewConfig,
    key: string,
    type: ColumnDef["type"]
  ): FrontmatterValueChange[] {
    return this.getRecords(config)
      .filter((record) => Object.prototype.hasOwnProperty.call(record.frontmatter, key))
      .map((record) => {
        const oldValue = record.frontmatter[key];
        const newValue = this.deps.propertyService.convertValueForType(oldValue, type);
        if (newValue === undefined || this.valuesEqual(oldValue, newValue)) return null;
        return {
          file: record.file,
          path: record.file.path,
          key,
          oldValue: this.cloneValue(oldValue),
          oldExists: true,
          newValue: this.cloneValue(newValue),
        };
      })
      .filter((change): change is FrontmatterValueChange => change != null);
  }

  private cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === "object") return JSON.parse(JSON.stringify(value));
    return value;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === "object") || (b && typeof b === "object")) {
      return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    }
    return (a ?? null) === (b ?? null);
  }
}
