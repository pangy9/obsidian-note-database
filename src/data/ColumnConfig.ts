import { ColumnDef, DatabaseConfig, RowData, ViewConfig } from "./types";
import { DatabaseViewState } from "../views/ViewStateStore";
import { isOptionColumnType } from "./ColumnTypes";
import { isBaseFileField } from "./FileFields";
import { getRowFileFieldValue } from "./FileFieldObsidian";
import {
  updateColumnKeyReferences as updateColumnKeyReferencesCore,
  updateComputedFormulaReferences,
  updateSourceRuleKeyReferences,
  updateSummaryFormulaReferences,
} from "./ColumnKeyReferences";
import { updateSourceRuleTreeKeyReferences } from "./SourceRules";

// 引用更新纯逻辑已抽到 obsidian-free 的 ColumnKeyReferences（便于 R2-CO-1 plan builder
// 单测）；这里仅 re-export 保持既有调用方不变，并为 updateColumnKeyReferences 注入
// 真实的 sourceRuleTree 更新器（所在 SourceRules.ts 耦合 obsidian，不由纯模块直接 import）。
export { updateComputedFormulaReferences, updateSourceRuleKeyReferences, updateSummaryFormulaReferences };

/**
 * After JSON deserialization, db.schema and each view.schema can become
 * independent objects. The database-level schema is canonical so stale view
 * schema copies cannot resurrect renamed/deleted columns.
 */
export function linkDatabaseSchemas(databases: DatabaseConfig[]): void {
  for (const db of databases) {
    linkDatabaseSchema(db);
  }
}

export function linkDatabaseSchema(db: DatabaseConfig): void {
  if (!db.schema || !Array.isArray(db.schema.columns)) {
    db.schema = db.views?.find((view) => Array.isArray(view.schema?.columns))?.schema || {
      columns: [],
      computedFields: [],
    };
  }
  if (!Array.isArray(db.schema.computedFields)) db.schema.computedFields = [];

  if (db.schema.columns.length === 0) {
    const firstViewSchema = db.views?.find((view) => Array.isArray(view.schema?.columns) && view.schema.columns.length > 0)?.schema;
    if (firstViewSchema) {
      db.schema = {
        columns: firstViewSchema.columns || [],
        computedFields: firstViewSchema.computedFields || [],
      };
      if (!Array.isArray(db.schema.computedFields)) db.schema.computedFields = [];
    }
  }

  for (const view of db.views || []) {
    view.schema = db.schema;
  }
}

export function ensureColumnOrder(config: ViewConfig): void {
  if (!config.columnOrder || config.columnOrder.length === 0) {
    config.columnOrder = config.schema.columns.map((col) => col.key);
    return;
  }
  normalizeColumnOrder(config);
}

export function normalizeColumnOrder(config: ViewConfig): void {
  if (!config.columnOrder) return;
  const validKeys = new Set(config.schema.columns.map((col) => col.key));
  const normalized = config.columnOrder.filter((key, index, arr) =>
    validKeys.has(key) && arr.indexOf(key) === index
  );
  for (const col of config.schema.columns) {
    if (!normalized.includes(col.key)) normalized.push(col.key);
  }
  config.columnOrder = normalized;
}

export function getColumnsInOrder(config: ViewConfig): ColumnDef[] {
  if (!config.columnOrder || config.columnOrder.length === 0) {
    return config.schema.columns;
  }
  normalizeColumnOrder(config);
  const orderMap = new Map(config.columnOrder.map((key, index) => [key, index]));
  return [...config.schema.columns].sort((a, b) => {
    const ai = orderMap.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const bi = orderMap.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

export function getVisibleColumns(
  config: ViewConfig,
  rows: RowData[],
  state: DatabaseViewState,
  pendingShowColumns: Set<string>
): ColumnDef[] {
  const autoHidden = new Set<string>();
  const explicitlyOrderedKeys = new Set(config.columnOrder || []);
  const allCols = getColumnsInOrder(config);
  for (const col of allCols) {
    if (rows.length === 0) continue;
    if (col.type === "computed" || col.type === "rollup" || col.key === "file.name" || isOptionColumnType(col.type) || col.type === "checkbox") continue;
    if (pendingShowColumns.has(col.key)) continue;
    if (explicitlyOrderedKeys.has(col.key)) continue;
    const hasValue = rows.some((row) => {
      const val = isBaseFileField(col.key)
        ? getRowFileFieldValue(row, col.key)
        : col.computedKey ? row.computed[col.computedKey] : row.frontmatter[col.key];
      return val != null && val !== "" && val !== undefined;
    });
    if (!hasValue) autoHidden.add(col.key);
  }

  const hiddenColumns = state.hiddenColumns;
  return allCols.filter((col) => !hiddenColumns.has(col.key) && !autoHidden.has(col.key));
}

export function createUniqueColumnKey(config: ViewConfig, base: string): string {
  const keys = new Set(config.schema.columns.map((col) => col.key));
  if (!keys.has(base)) return base;
  let i = 1;
  let key = `${base}_${i}`;
  while (keys.has(key)) {
    i += 1;
    key = `${base}_${i}`;
  }
  return key;
}

export function updateColumnKeyReferences(
  config: ViewConfig,
  state: DatabaseViewState | undefined,
  oldKey: string,
  newKey: string,
  oldLabel?: string,
  newLabel?: string
): boolean {
  return updateColumnKeyReferencesCore(config, state, oldKey, newKey, {
    updateSourceRuleTree: updateSourceRuleTreeKeyReferences as (tree: unknown, oldKey: string, newKey: string) => boolean,
  }, oldLabel, newLabel);
}
