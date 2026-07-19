import { App } from "obsidian";
import { isColumnType, isComputedFieldType, isOptionColumnType } from "../data/ColumnTypes";
import {
  filterPropertyTypeConflictsForChange,
  findPropertyTypeConflicts,
  getPropertyTypeConflictEntryId,
  PropertyTypeConflictEntry,
} from "../data/PropertyTypeConflict";
import { ColumnDef, DatabaseConfig, StatusOptionDef } from "../data/types";
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
