import { App, Notice, TFile } from "obsidian";
import { DataSource } from "../data/DataSource";
import { PropertyService } from "../data/PropertyService";
import { normalizeComputedSyncMode } from "../data/ComputedSync";
import { t } from "../i18n";
import {
  createUniqueColumnKey,
  ensureColumnOrder,
  linkDatabaseSchema,
  normalizeColumnOrder,
  updateColumnKeyReferences,
  updateSummaryFormulaReferences,
  updateSourceRuleKeyReferences,
} from "../data/ColumnConfig";
import { createOptionsFromValues, isOptionColumnType } from "../data/ColumnTypes";
import { getDefaultChartDateBucket, getDefaultChartNumberBucket, isChartAggregationValueColumn, requiresChartValueField } from "../data/ChartAggregation";
import { normalizeTimelineDayScale } from "../data/CalendarTimelineModel";
import { isDateLikeColumnType } from "../data/DateTimeFormat";
import { removeSourceRuleTreeReferences, updateSourceRuleTreeKeyReferences } from "../data/SourceRules";
import { getColumnDisplayType, getComputedStorageKey, normalizeComputedStorageKey } from "../data/ColumnDisplay";
import { ColumnDef, DatabaseConfig, StatusOptionDef, ViewConfig } from "../data/types";
import { getFileFieldFixedType, isFileFieldKey, isSupportedFileField } from "../data/FileFields";
import { ColumnRenameResult } from "./modals/ColumnRenameModal";
import { confirmWithModal } from "./modals/ConfirmModal";
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
  app: App;
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
  refreshSchemaChanged(options?: { preserveViewport?: boolean }): void;
  refreshAfterSave(): Promise<void>;
  markPendingColumn(key: string): void;
  refreshColumnManager(): void;
  setPendingUndoLabel(label: string): void;
  setPendingConfigCellChanges(changes: FrontmatterValueChange[]): void;
  getDefaultStatusOptions(): StatusOptionDef[];
  getDefaultStatusPresetId(): string | undefined;
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

    const db = this.deps.getActiveDb();
    linkDatabaseSchema(db);
    const oldKey = col.key;
    const oldLabel = col.label;
    const targetCol = this.resolveColumn(config, col, oldKey);
    const oldComputedKey = getComputedStorageKey(targetCol);
    const newKey = result.key.trim();
    const newLabel = result.label.trim() || newKey;
    const newComputedKey = targetCol.type === "computed" ? normalizeComputedStorageKey(newKey) : newKey;
    if (!newKey) {
      new Notice(t("column.keyRequired"));
      return;
    }
    const duplicate = config.schema.columns.some((candidate) => candidate !== targetCol && candidate.key === newKey);
    if (duplicate) {
      new Notice(t("column.keyExists", { key: newKey }));
      return;
    }

    const isComputed = targetCol.type === "computed";
    const oldIsFileField = isFileFieldKey(oldKey);
    const newIsFileField = isFileFieldKey(newKey);
    if (newIsFileField && !isSupportedFileField(newKey)) {
      new Notice(t("fileField.unsupportedKey", { key: newKey }));
      return;
    }
    if (oldIsFileField && newKey !== oldKey) {
      new Notice(t("fileField.fixedType"));
      return;
    }
    if (isComputed && newIsFileField) {
      new Notice(t("fileField.fixedType"));
      return;
    }
    if (!oldIsFileField && newIsFileField && result.migrateValues) {
      new Notice(t("fileField.migrationIgnored", { key: newKey }));
    }
    const convertingToFileField = !oldIsFileField && newIsFileField;
    const useFrontmatterMigration = !oldIsFileField && !newIsFileField;
    const displayOnly = this.isDisplayOnlyComputedSync();
    const renameSavedComputedProperty = useFrontmatterMigration && isComputed && !displayOnly && oldComputedKey !== newComputedKey
      ? await confirmWithModal(this.deps.app, {
        title: t("menu.editProperty", { name: newLabel }),
        message: t("column.confirmRenameComputedSavedProperty", { oldKey: oldComputedKey, newKey: newComputedKey }),
        confirmText: t("common.save"),
      })
      : false;
    let migrationNotice = "";
    const frontmatterChanges = convertingToFileField
      ? this.getDeleteKeyChanges(config, oldKey)
      : useFrontmatterMigration
      ? this.getRenameColumnChanges(config, targetCol, oldKey, newKey, result.migrateValues, renameSavedComputedProperty, oldComputedKey, newComputedKey)
      : [];
    try {
      if (renameSavedComputedProperty) {
        const migration = await this.deps.propertyService.renameKey(
          this.deps.getFilesForConfig(config),
          oldComputedKey,
          newComputedKey,
          undefined,
          true
        );
        migrationNotice = t("column.migratedFiles", { count: migration.moved });
      } else if (useFrontmatterMigration && !isComputed && result.migrateValues) {
        const migration = await this.propertySync.rename(config, targetCol, oldKey, newKey, true);
        if (migration) {
          migrationNotice = t("column.migratedFiles", { count: migration.moved });
          if (migration.deletedStale > 0) {
            migrationNotice += t("column.cleanedOldProps", { count: migration.deletedStale });
          }
        }
      } else if (useFrontmatterMigration && !isComputed && oldKey !== newKey) {
        await this.propertySync.delete(config, targetCol);
      } else if (convertingToFileField && !isComputed) {
        await this.propertySync.delete(config, targetCol);
      }

      ensureColumnOrder(config);
      const state = this.deps.getState();
      let activeStateChanged = false;
      for (const view of new Set([config, ...(db.views || [])])) {
        const changed = updateColumnKeyReferences(
          view,
          view === config ? state : undefined,
          oldKey,
          newKey,
          oldLabel,
          newLabel
        );
        if (view === config && changed) activeStateChanged = true;
      }
      updateSourceRuleKeyReferences(db.sourceRules, oldKey, newKey);
      updateSourceRuleTreeKeyReferences(db.sourceRuleTree, oldKey, newKey);
      updateSummaryFormulaReferences(db, oldKey, newKey, oldLabel, newLabel);
      if (activeStateChanged) {
        this.deps.viewStateStore.persist(config, state);
      }
      this.removeDuplicateSchemaColumns(db, targetCol, oldKey);
      targetCol.key = newKey;
      targetCol.label = newLabel;
      targetCol.wrap = result.wrap || undefined;
      if (newIsFileField) {
        targetCol.type = getFileFieldFixedType(newKey);
        targetCol.statusOptions = undefined;
        targetCol.statusPresetId = undefined;
      }
      if (targetCol.type === "computed") {
        const computed = config.schema.computedFields.find((field) => field.key === oldComputedKey);
        if (computed) {
          computed.key = newComputedKey;
          computed.label = newLabel;
        }
        targetCol.computedKey = newComputedKey;
      }
      linkDatabaseSchema(db);
      this.deps.setPendingUndoLabel(t("undo.columnRenameConfig"));
      this.deps.setPendingConfigCellChanges(frontmatterChanges);
      await this.deps.saveCurrentViewConfig();
      // Keep the database config durable even if Obsidian property type sync fails.
      const obsidianPropertyType = isComputed
        ? config.schema.computedFields.find((field) => field.key === newComputedKey)?.type || "text"
        : targetCol.type;
      if (!newIsFileField) await this.deps.propertyService.setObsidianPropertyType(isComputed ? newComputedKey : newKey, obsidianPropertyType);
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
    const config = this.deps.getConfig();
    if (!config) return;
    const db = this.deps.getActiveDb();
    linkDatabaseSchema(db);
    const targetCol = this.resolveColumn(config, col, col.key);
    const isComputed = targetCol.type === "computed";
    const isFileField = isFileFieldKey(targetCol.key);
    const propertyKey = getComputedStorageKey(targetCol);
    const displayOnly = this.isDisplayOnlyComputedSync();
    if (isComputed) {
      if (!await confirmWithModal(this.deps.app, {
        title: t("common.delete"),
        message: t("column.confirmDeleteComputed", { label: targetCol.label, key: propertyKey }),
        confirmText: t("common.delete"),
        danger: true,
      })) return;
    } else if (!await confirmWithModal(this.deps.app, {
      title: t("common.delete"),
      message: t("column.confirmDelete", { label: targetCol.label, key: targetCol.key }),
      confirmText: t("common.delete"),
      danger: true,
    })) {
      return;
    }
    ensureColumnOrder(config);
    const files = this.deps.getFilesForConfig(config);
    const cleanupSavedComputedProperty = isComputed && !displayOnly
      ? await confirmWithModal(this.deps.app, {
        title: t("common.delete"),
        message: t("column.confirmDeleteComputedSavedProperty", { key: propertyKey }),
        confirmText: t("common.delete"),
        danger: true,
      })
      : false;
    const shouldDeleteFrontmatter = !isFileField && (!isComputed || cleanupSavedComputedProperty);
    const frontmatterChanges = shouldDeleteFrontmatter
      ? this.getDeleteKeyChanges(config, isComputed ? propertyKey : targetCol.key)
      : [];
    const keysToRemove = this.getColumnReferenceKeys(targetCol);
    this.removeColumnFromSchemas(db, config, targetCol);
    for (const key of keysToRemove) {
      this.removeSourceRuleReferences(db.sourceRules, key);
      db.sourceRuleTree = removeSourceRuleTreeReferences(db.sourceRuleTree, key);
    }
    const state = this.deps.getState();
    for (const view of db.views || [config]) {
      for (const key of keysToRemove) this.removeColumnReferences(view, key);
      normalizeColumnOrder(view);
    }
    for (const key of keysToRemove) this.removeColumnFromState(state, key);
    this.deps.viewStateStore.persist(config, state);
    this.deps.viewStateStore.clear();
    this.deps.refreshSchemaChanged();

    try {
      this.deps.setPendingUndoLabel(t("undo.deleteColumnConfig"));
      this.deps.setPendingConfigCellChanges(frontmatterChanges);
      await this.deps.saveConfigImmediately();
      const result = shouldDeleteFrontmatter
        ? isComputed
          ? await this.deps.propertyService.deleteKey(files, propertyKey)
          : await this.propertySync.delete(config, targetCol, files)
        : { changed: 0, skipped: files.length };
      await this.deps.refreshAfterSave();
      this.deps.refreshColumnManager();
      new Notice(targetCol.type === "computed" ? t("column.deletedComputed") : t("column.deletedColumn", { key: targetCol.key, count: result.changed }));
    } catch (err) {
      console.error("Note Database: failed to delete column", err);
      new Notice(t("column.deleteFailed", { error: String(err) }));
    }
  }

  private removeColumnFromSchemas(db: DatabaseConfig, config: ViewConfig, col: ColumnDef): void {
    const computedKey = getComputedStorageKey(col);
    const referenceKeys = this.getColumnReferenceKeys(col);
    const schemas = new Set([db.schema, config.schema, ...(db.views || []).map((view) => view.schema)]);
    for (const schema of schemas) {
      if (!schema) continue;
      schema.columns = (schema.columns || []).filter((candidate) => candidate !== col && !referenceKeys.has(candidate.key));
      if (col.type === "computed") {
        schema.computedFields = (schema.computedFields || []).filter((field) => field.key !== computedKey);
      }
    }
    for (const view of db.views || []) {
      view.schema = db.schema;
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
    if (config.sortColumnOrder === key) config.sortColumnOrder = undefined;
    if (config.groupByField === key) config.groupByField = undefined;
    if (config.titleField === key) config.titleField = undefined;
    if (config.galleryImageField === key) config.galleryImageField = undefined;
    if (config.boardGroupField === key) config.boardGroupField = undefined;
    if (config.boardSubgroupField === key) config.boardSubgroupField = undefined;
    if (config.calendarStartDateField === key) config.calendarStartDateField = undefined;
    if (config.calendarEndDateField === key) config.calendarEndDateField = undefined;
    if (config.calendarTitleField === key) config.calendarTitleField = undefined;
    if (config.calendarColorField === key) config.calendarColorField = undefined;
    if (config.timelineStartDateField === key) config.timelineStartDateField = undefined;
    if (config.timelineEndDateField === key) config.timelineEndDateField = undefined;
    if (config.timelineGroupField === key) config.timelineGroupField = undefined;
    if (config.timelineTitleField === key) config.timelineTitleField = undefined;
    if (config.timelineColorField === key) config.timelineColorField = undefined;
    if (config.chartGroupField === key) {
      config.chartGroupField = undefined;
      config.chartDateBucket = undefined;
      config.chartHiddenGroups = undefined;
    }
    if (config.chartStackField === key) config.chartStackField = undefined;
    if (config.chartSeriesField === key) config.chartSeriesField = undefined;
    if (config.chartValueField === key) config.chartValueField = undefined;
    if (config.chartSecondaryValueField === key) config.chartSecondaryValueField = undefined;
    if (config.summaryRules?.[key]) delete config.summaryRules[key];
    this.removeSourceRuleReferences(config.sourceRules, key);
    config.sourceRuleTree = removeSourceRuleTreeReferences(config.sourceRuleTree, key);
    delete config.groupOrders?.[key];
    delete config.showEmptyGroups?.[key];
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

  private removeSourceRuleReferences(rules: ViewConfig["sourceRules"], key: string): void {
    if (!rules) return;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      if (rules[index].field === key) rules.splice(index, 1);
    }
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
    if (!config || isFileFieldKey(col.key)) return;
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
        expressionSyntax: source?.expressionSyntax,
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

  private resolveColumn(config: ViewConfig, col: ColumnDef, key: string): ColumnDef {
    return config.schema.columns.find((candidate) => candidate === col) ||
      config.schema.columns.find((candidate) => candidate.key === key) ||
      col;
  }

  private getColumnReferenceKeys(col: ColumnDef): Set<string> {
    const keys = new Set([col.key]);
    if (col.type === "computed") {
      const storageKey = getComputedStorageKey(col);
      keys.add(storageKey);
      keys.add(`formula.${storageKey}`);
    }
    return keys;
  }

  private removeDuplicateSchemaColumns(db: DatabaseConfig, targetCol: ColumnDef, oldKey: string): void {
    const schemas = new Set([db.schema, ...(db.views || []).map((view) => view.schema)]);
    for (const schema of schemas) {
      if (!schema) continue;
      schema.columns = (schema.columns || []).filter((candidate) => candidate === targetCol || candidate.key !== oldKey);
    }
  }

  async changeColumnType(col: ColumnDef, type: ColumnDef["type"]): Promise<void> {
    const config = this.deps.getConfig();
    if (!config || col.type === type) return;
    const target = config.schema.columns.find((candidate) => candidate.key === col.key);
    if (!target) return;
    if (isFileFieldKey(target.key)) {
      new Notice(t("fileField.fixedType"));
      return;
    }
    const previousType = target.type;
    const previousComputedKey = target.computedKey || target.key;
    const previousOptions = target.statusOptions?.map((option) => ({ ...option }));
    const changingToComputed = type === "computed" && previousType !== "computed";
    const displayOnly = this.isDisplayOnlyComputedSync();
    let cleanupExistingProperty = false;
    if (changingToComputed) {
      if (displayOnly) {
        cleanupExistingProperty = await confirmWithModal(this.deps.app, {
          title: t("menu.changeType"),
          message: t("column.confirmConvertComputedCleanup", { key: target.key }),
          confirmText: t("common.delete"),
          danger: true,
        });
      } else if (!await confirmWithModal(this.deps.app, {
        title: t("menu.changeType"),
        message: t("column.confirmConvertComputedSavedProperty", { key: target.key }),
        confirmText: t("common.save"),
      })) {
        return;
      }
    }

    const inferredOptions = isOptionColumnType(type)
      ? createOptionsFromValues(this.getRecords(config).map((record) => record.frontmatter[target.key]))
      : [];
    target.type = type;
    if (isOptionColumnType(type)) {
      if (previousOptions?.length) {
        target.statusOptions = previousOptions;
        target.statusPresetId = undefined;
      } else if (inferredOptions.length > 0) {
        target.statusOptions = inferredOptions;
        target.statusPresetId = undefined;
      } else if (!target.statusOptions?.length) {
        target.statusOptions = type === "status" ? this.deps.getDefaultStatusOptions() : [];
        target.statusPresetId = type === "status" ? this.deps.getDefaultStatusPresetId() : undefined;
      }
    } else {
      target.statusOptions = undefined;
      target.statusPresetId = undefined;
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
    this.clearInvalidChartValueReferences(this.deps.getActiveDb(), target);
    this.clearInvalidCalendarTimelineDateReferences(this.deps.getActiveDb(), target);
    this.normalizeInvalidTimelineDayScales(this.deps.getActiveDb());
    this.updateChartDateBucketReferences(this.deps.getActiveDb(), target);

    try {
      const frontmatterChanges = type === "computed"
        ? this.getComputedConversionChanges(config, target.key, cleanupExistingProperty)
        : target.key === "file.name"
          ? []
          : this.getConvertKeyTypeChanges(config, target.key, type);
      this.deps.setPendingUndoLabel(t("undo.columnTypeConfig"));
      this.deps.setPendingConfigCellChanges(frontmatterChanges);
      await this.deps.saveConfigImmediately();
      this.deps.refreshSchemaChanged();
      let changed = 0;
      if (type === "computed" && cleanupExistingProperty) {
        changed = (await this.propertySync.delete(config, target)).changed;
      } else if (type !== "computed" && target.key !== "file.name") {
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

  private clearInvalidChartValueReferences(db: DatabaseConfig, col: ColumnDef): void {
    for (const view of db.views || []) {
      if (
        view.chartValueField === col.key &&
        (!requiresChartValueField(view.chartAggregation) || !isChartAggregationValueColumn(col, view.chartAggregation, db.schema.computedFields))
      ) {
        view.chartValueField = undefined;
      }
      if (
        view.chartSecondaryValueField === col.key &&
        (!requiresChartValueField(view.chartSecondaryAggregation) || !isChartAggregationValueColumn(col, view.chartSecondaryAggregation, db.schema.computedFields))
      ) {
        view.chartSecondaryValueField = undefined;
      }
    }
  }

  private clearInvalidCalendarTimelineDateReferences(db: DatabaseConfig, col: ColumnDef): void {
    if (isDateLikeColumnType(getColumnDisplayType(col, db.schema.computedFields))) return;
    for (const view of db.views || []) {
      if (view.calendarStartDateField === col.key) view.calendarStartDateField = undefined;
      if (view.calendarEndDateField === col.key) view.calendarEndDateField = undefined;
      if (view.timelineStartDateField === col.key) view.timelineStartDateField = undefined;
      if (view.timelineEndDateField === col.key) view.timelineEndDateField = undefined;
    }
  }

  private normalizeInvalidTimelineDayScales(db: DatabaseConfig): void {
    for (const view of db.views || []) {
      normalizeTimelineDayScale(view);
    }
  }

  private updateChartDateBucketReferences(db: DatabaseConfig, col: ColumnDef): void {
    for (const view of db.views || []) {
      if (view.chartGroupField !== col.key) continue;
      view.chartDateBucket = getDefaultChartDateBucket(db.schema.columns, col.key, db.schema.computedFields);
      view.chartNumberBucket = getDefaultChartNumberBucket(db.schema.columns, col.key, db.schema.computedFields);
      if (!view.chartNumberBucket) view.chartNumberBucketSize = undefined;
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
      this.deps.refreshSchemaChanged({ preserveViewport: true });
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

  private isDisplayOnlyComputedSync(): boolean {
    return normalizeComputedSyncMode(this.deps.getActiveDb().computedSyncMode) === "display-only";
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

  private getRenameColumnChanges(
    config: ViewConfig,
    col: ColumnDef,
    oldKey: string,
    newKey: string,
    migrateValues: boolean,
    renameSavedComputedProperty = false,
    oldComputedKey = getComputedStorageKey(col),
    newComputedKey = normalizeComputedStorageKey(newKey)
  ): FrontmatterValueChange[] {
    if (oldKey === newKey || oldKey === "file.name") return [];
    if (col.type === "computed") return renameSavedComputedProperty ? this.getRenameKeyChanges(config, oldComputedKey, newComputedKey) : [];
    if (!migrateValues) return this.getDeleteKeyChanges(config, oldKey);
    return this.getRenameKeyChanges(config, oldKey, newKey);
  }

  private getComputedConversionChanges(config: ViewConfig, key: string, cleanupExistingProperty = false): FrontmatterValueChange[] {
    return cleanupExistingProperty ? this.getDeleteKeyChanges(config, key) : [];
  }

  private getRenameKeyChanges(config: ViewConfig, oldKey: string, newKey: string): FrontmatterValueChange[] {
    const changes: FrontmatterValueChange[] = [];
    for (const record of this.getRecords(config)) {
      if (!Object.prototype.hasOwnProperty.call(record.frontmatter, oldKey)) continue;
      changes.push({
        file: record.file,
        path: record.file.path,
        key: oldKey,
        oldValue: this.cloneValue(record.frontmatter[oldKey]),
        oldExists: true,
        newValue: null,
      });
      changes.push({
        file: record.file,
        path: record.file.path,
        key: newKey,
        oldValue: this.cloneValue(record.frontmatter[newKey]),
        oldExists: Object.prototype.hasOwnProperty.call(record.frontmatter, newKey),
        newValue: this.cloneValue(record.frontmatter[oldKey]),
      });
    }
    return changes;
  }

  private getEnsureKeyChanges(config: ViewConfig, col: ColumnDef): FrontmatterValueChange[] {
    if (isFileFieldKey(col.key) || col.type === "computed") return [];
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
    if (Array.isArray(value)) return [...(value as unknown[])];
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
