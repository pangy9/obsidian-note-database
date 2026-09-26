import { App } from "obsidian";
import { isColumnType, isComputedFieldType, isOptionColumnType } from "../data/ColumnTypes";
import {
  filterPropertyTypeConflictsForChange,
  findPropertyTypeConflicts,
  getPropertyTypeConflictEntryId,
  PropertyTypeConflictEntry,
} from "../data/PropertyTypeConflict";
import { ColumnDef, DatabaseConfig, StatusOptionDef } from "../data/types";
import type { DataSource } from "../data/DataSource";
import { configsDeepEqual } from "../data/FrontmatterPatch";
import { commitNewDatabaseConflictChanges, type NewDatabaseConflictConfigChange } from "../data/NewDatabaseConflictCommit";
import { PropertyTypeConflictChange, PropertyTypeConflictModal } from "./modals/PropertyTypeConflictModal";

export interface MutablePropertyTypeConflictEntry extends PropertyTypeConflictEntry {
  config: DatabaseConfig;
  sourcePath?: string;
}

export interface NewDatabaseConflictOptions {
  getDefaultStatusOptions?: () => StatusOptionDef[];
  getDefaultStatusPresetId?: () => string | undefined;
}

export interface NewDatabaseConflictResult {
  changes: PropertyTypeConflictChange[];
  changedEntries: MutablePropertyTypeConflictEntry[];
}

export interface NewDatabaseConflictPreparation {
  /** 新库及示例文件创建成功后才写已有库；失败时已写步骤会自动补偿。 */
  commit(): Promise<void>;
}

/** 起步模板创建专用：确认时只改草稿，不提前改动已有库。 */
export async function prepareNewDatabasePropertyTypeConflictsForCreate(
  app: App,
  dataSource: DataSource,
  existingEntries: MutablePropertyTypeConflictEntry[],
  newEntry: MutablePropertyTypeConflictEntry,
  sourceInstanceId: string,
  options: NewDatabaseConflictOptions = {},
  onCommitted?: (entries: MutablePropertyTypeConflictEntry[]) => void,
): Promise<NewDatabaseConflictPreparation | null> {
  const draftEntries = existingEntries.map((entry) => ({
    ...entry,
    config: structuredClone(entry.config),
  }));
  const result = await confirmNewDatabasePropertyTypeConflicts(app, draftEntries, newEntry, options);
  if (!result) return null;
  const changes: NewDatabaseConflictConfigChange[] = [];
  for (const entry of result.changedEntries) {
    if (!entry.sourcePath) continue;
    const before = await dataSource.readViewDefSnapshot(entry.sourcePath);
    const original = existingEntries.find((candidate) => candidate.sourcePath === entry.sourcePath);
    if (!original || !configsDeepEqual(before.typedConfig, original.config)) {
      throw new Error(`Database config changed while preparing: ${entry.sourcePath}`);
    }
    changes.push({
      path: entry.sourcePath,
      dbId: entry.config.id,
      before,
      after: entry.config,
      afterPayload: dataSource.serializeDatabaseConfig(entry.config),
    });
  }
  return {
    commit: async () => {
      await commitNewDatabaseConflictChanges(dataSource, changes, sourceInstanceId);
      // 磁盘已提交；内存同步失败不能让调用方误以为整个创建可回滚。
      try { onCommitted?.(result.changedEntries); }
      catch (error) { console.error("Note Database: committed conflict config but failed to sync view memory", error); }
    },
  };
}

export async function confirmNewDatabasePropertyTypeConflicts(
  app: App,
  existingEntries: MutablePropertyTypeConflictEntry[],
  newEntry: MutablePropertyTypeConflictEntry,
  options: NewDatabaseConflictOptions = {}
): Promise<NewDatabaseConflictResult | null> {
  const beforeConflicts = findPropertyTypeConflicts(existingEntries);
  const afterEntries = [...existingEntries, newEntry];
  const afterConflicts = findPropertyTypeConflicts(afterEntries);
  const newDatabaseId = getPropertyTypeConflictEntryId(newEntry);
  const conflicts = afterConflicts.filter((conflict) =>
    conflict.writers.some((writer) => writer.databaseId === newDatabaseId) &&
    filterPropertyTypeConflictsForChange(beforeConflicts, afterConflicts, newEntry, conflict.key).length > 0
  );
  if (conflicts.length === 0) return { changes: [], changedEntries: [] };

  const result = await new PropertyTypeConflictModal(app, {
    conflicts,
    activeConflictKey: conflicts[0]?.key,
    mode: "confirm-change",
  }).openAndWait();
  if (result.action === "cancel") return null;
  if (result.action === "ignore") return { changes: [], changedEntries: [] };

  const changedEntries = applyPropertyTypeConflictChangesToEntries(
    afterEntries,
    result.changes,
    options
  );
  return {
    changes: result.changes,
    changedEntries: changedEntries.filter((entry) => entry !== newEntry),
  };
}

function applyPropertyTypeConflictChangesToEntries(
  entries: MutablePropertyTypeConflictEntry[],
  changes: PropertyTypeConflictChange[],
  options: NewDatabaseConflictOptions
): MutablePropertyTypeConflictEntry[] {
  const changed = new Set<MutablePropertyTypeConflictEntry>();
  for (const change of changes) {
    const entry = entries.find((candidate) => propertyTypeChangeTargetsEntry(candidate, change));
    if (!entry) continue;
    if (!applyPropertyTypeToConfig(entry.config, change, options)) continue;
    changed.add(entry);
  }
  return [...changed];
}

function propertyTypeChangeTargetsEntry(entry: MutablePropertyTypeConflictEntry, change: PropertyTypeConflictChange): boolean {
  if (change.databasePath) return entry.sourcePath === change.databasePath;
  return (entry.config.id || entry.sourcePath) === change.databaseId;
}

function applyPropertyTypeToConfig(
  config: DatabaseConfig,
  change: PropertyTypeConflictChange,
  options: NewDatabaseConflictOptions
): boolean {
  if (change.sourceKind === "computed") {
    const field = config.schema.computedFields.find((candidate) => candidate.key === change.key);
    if (!field || !isComputedFieldType(change.type) || field.type === change.type) return false;
    field.type = change.type;
    return true;
  }
  const col = config.schema.columns.find((candidate) => candidate.key === change.key);
  if (!col || !isColumnType(change.type) || col.type === change.type || col.type === "computed" || col.type === "rollup") return false;
  return applyColumnTypeToColumn(col, change.type, options);
}

function applyColumnTypeToColumn(
  col: ColumnDef,
  type: ColumnDef["type"],
  options: NewDatabaseConflictOptions
): boolean {
  if (col.type === type || col.type === "computed" || col.type === "rollup") return false;
  col.type = type;
  if (isOptionColumnType(type)) {
    if (!col.statusOptions?.length) {
      col.statusOptions = type === "status" ? options.getDefaultStatusOptions?.() || [] : [];
      col.statusPresetId = type === "status" ? options.getDefaultStatusPresetId?.() : undefined;
    } else {
      col.statusPresetId = undefined;
    }
  } else {
    col.statusOptions = undefined;
    col.statusPresetId = undefined;
  }
  return true;
}
