import { ColumnDef, RowData, ViewConfig } from "./types";
import { DatabaseViewState } from "../views/ViewStateStore";
import { isOptionColumnType } from "./ColumnTypes";

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
    if (col.type === "computed" || col.key === "file.name" || isOptionColumnType(col.type) || col.type === "checkbox") continue;
    if (pendingShowColumns.has(col.key)) continue;
    if (explicitlyOrderedKeys.has(col.key)) continue;
    const hasValue = rows.some((row) => {
      const val = col.computedKey ? row.computed[col.computedKey] : row.frontmatter[col.key];
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
  state: DatabaseViewState,
  oldKey: string,
  newKey: string,
  oldLabel?: string,
  newLabel?: string
): boolean {
  if (oldKey === newKey) {
    updateComputedFormulaReferences(config, oldKey, newKey, oldLabel, newLabel);
    return false;
  }
  config.columnOrder = config.columnOrder!.map((key) => key === oldKey ? newKey : key);
  if (config.titleField === oldKey) config.titleField = newKey;
  if (config.boardGroupField === oldKey) config.boardGroupField = newKey;
  if (config.boardSubgroupField === oldKey) config.boardSubgroupField = newKey;
  if (config.sortColumn === oldKey) config.sortColumn = newKey;
  if (config.sortColumnOrder === oldKey) config.sortColumnOrder = newKey;
  for (const rule of config.sortRules || []) {
    if (rule.field === oldKey) rule.field = newKey;
  }

  if (config.hiddenColumns) {
    config.hiddenColumns = config.hiddenColumns.map((key) => key === oldKey ? newKey : key);
  }
  if (config.groupOrders?.[oldKey]) {
    config.groupOrders[newKey] = config.groupOrders[oldKey];
    delete config.groupOrders[oldKey];
  }
  if (config.collapsedGroups?.[oldKey]) {
    config.collapsedGroups[newKey] = config.collapsedGroups[oldKey];
    delete config.collapsedGroups[oldKey];
  }
  if (config.boardCardOrders?.[oldKey]) {
    config.boardCardOrders[newKey] = config.boardCardOrders[oldKey];
    delete config.boardCardOrders[oldKey];
  }
  for (const viewState of Object.values(config.viewStates || {})) {
    if (!viewState) continue;
    if (viewState.sortColumn === oldKey) viewState.sortColumn = newKey;
    if (viewState.groupByField === oldKey) viewState.groupByField = newKey;
    if (viewState.hiddenColumns) viewState.hiddenColumns = viewState.hiddenColumns.map((key) => key === oldKey ? newKey : key);
    for (const rule of viewState.sortRules || []) {
      if (rule.field === oldKey) rule.field = newKey;
    }
    for (const rule of viewState.filters || []) {
      if (rule.field === oldKey) rule.field = newKey;
    }
  }
  const hiddenChanged = state.hiddenColumns.delete(oldKey);
  if (hiddenChanged) state.hiddenColumns.add(newKey);
  if (state.groupByField === oldKey) state.groupByField = newKey;
  if (state.sortColumn === oldKey) state.sortColumn = newKey;
  for (const rule of state.sortRules) {
    if (rule.field === oldKey) rule.field = newKey;
  }
  for (const rule of state.filters) {
    if (rule.field === oldKey) rule.field = newKey;
  }
  updateComputedFormulaReferences(config, oldKey, newKey, oldLabel, newLabel);
  return hiddenChanged;
}

export function updateComputedFormulaReferences(
  config: ViewConfig,
  oldKey: string,
  newKey: string,
  oldLabel?: string,
  _newLabel?: string
): boolean {
  const names = new Set([oldKey, oldLabel].filter((value): value is string => !!value && value !== newKey));
  if (names.size === 0) return false;
  let changed = false;
  for (const def of config.schema.computedFields || []) {
    const next = replaceFormulaFieldReferences(def.expression || "", names, newKey);
    if (next !== def.expression) {
      def.expression = next;
      changed = true;
    }
  }
  return changed;
}

function replaceFormulaFieldReferences(expression: string, names: Set<string>, newKey: string): string {
  let next = expression.replace(/\[([^\]]+)\]/g, (match, rawName: string) => {
    const name = String(rawName || "").trim();
    return names.has(name) ? `[${newKey}]` : match;
  });
  next = next.replace(/\bfield\(\s*(["'`])([^"'`]+)\1\s*\)/g, (match, quote: string, rawName: string) => {
    const name = String(rawName || "").trim();
    return names.has(name) ? `field(${quote}${newKey}${quote})` : match;
  });
  return next;
}
