import { getColumnDisplayType } from "./ColumnDisplay";
import { getDefaultGroupOrder } from "./GroupOrder";
import { ColumnDef, RowData, ViewConfig } from "./types";

export interface GroupLike {
  key: string;
  rows: RowData[];
  count: number;
}

export function isEmptyGroupVisibilityColumn(config: ViewConfig, column: ColumnDef | undefined): boolean {
  if (!column) return false;
  const displayType = getColumnDisplayType(column, config.schema.computedFields);
  return displayType === "status" || displayType === "select" || displayType === "multi-select";
}

export function getDefaultShowEmptyGroups(config: ViewConfig, column: ColumnDef | undefined): boolean {
  if (!column) return true;
  const displayType = getColumnDisplayType(column, config.schema.computedFields);
  if (displayType === "multi-select") return false;
  return true;
}

export function shouldShowEmptyGroups(config: ViewConfig, field: string): boolean {
  const column = config.schema.columns.find((col) => col.key === field);
  if (!isEmptyGroupVisibilityColumn(config, column)) return true;
  const configured = config.showEmptyGroups?.[field];
  if (typeof configured === "boolean") return configured;
  return getDefaultShowEmptyGroups(config, column);
}

export function setShowEmptyGroups(config: ViewConfig, field: string, value: boolean): void {
  const column = config.schema.columns.find((col) => col.key === field);
  if (!isEmptyGroupVisibilityColumn(config, column)) {
    if (config.showEmptyGroups) {
      delete config.showEmptyGroups[field];
      if (Object.keys(config.showEmptyGroups).length === 0) config.showEmptyGroups = undefined;
    }
    return;
  }
  const defaultValue = getDefaultShowEmptyGroups(config, column);
  if (value === defaultValue) {
    if (config.showEmptyGroups) {
      delete config.showEmptyGroups[field];
      if (Object.keys(config.showEmptyGroups).length === 0) config.showEmptyGroups = undefined;
    }
    return;
  }
  config.showEmptyGroups = { ...(config.showEmptyGroups || {}), [field]: value };
}

export function withEmptyOptionGroups<T extends GroupLike>(config: ViewConfig, field: string, groups: T[]): T[] {
  const column = config.schema.columns.find((col) => col.key === field);
  if (!isEmptyGroupVisibilityColumn(config, column) || !shouldShowEmptyGroups(config, field)) return groups;
  const existing = new Set(groups.map((group) => group.key));
  const additions = getDefaultGroupOrder(config, field)
    .filter((key) => !existing.has(key))
    .map((key) => ({ key, rows: [], count: 0 } as unknown as T));
  return additions.length > 0 ? [...groups, ...additions] : groups;
}

/** Per-group row limit for the view. 0 = no limit (show all). */
export function getGroupRowLimit(config: ViewConfig): number {
  return config.groupRowLimit && config.groupRowLimit > 0 ? config.groupRowLimit : 0;
}

/** How many rows a group should currently show (clamped to totalCount).
 *  expanded === -1 → all; positive M → M; absent → limit; limit 0 → all. */
export function getGroupVisibleCount(config: ViewConfig, field: string, key: string, totalCount: number): number {
  const limit = getGroupRowLimit(config);
  if (limit <= 0) return totalCount;
  const expanded = config.expandedGroupRows?.[field]?.[key];
  if (expanded === -1) return totalCount;
  if (typeof expanded === "number" && expanded > 0) return Math.min(expanded, totalCount);
  return Math.min(limit, totalCount);
}

/** Set a group's expanded row count. count = -1 (fully expanded) or positive M; 0 = reset to limit (clear). */
export function setGroupExpandedCount(config: ViewConfig, field: string, key: string, count: number): void {
  const map = { ...(config.expandedGroupRows?.[field] || {}) };
  if (count === 0) delete map[key];
  else map[key] = count;
  const next = { ...(config.expandedGroupRows || {}) };
  if (Object.keys(map).length > 0) next[field] = map;
  else delete next[field];
  config.expandedGroupRows = Object.keys(next).length > 0 ? next : undefined;
}
