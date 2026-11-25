import { getAllSourceRules } from "./SourceRules";
import type { DatabaseConfig, FilterRule, SourceRule, ViewConfig, ViewModeStateDef } from "./types";

const OPTION_COMPARISONS = new Set(["eq", "neq", "gt", "gte", "lt", "lte"]);
const SOURCE_EQUALITIES = new Set(["eq", "neq", "strictEq", "strictNeq"]);

/** Migrate explicit references to a shared option in the same database transaction as its values. */
export function remapOptionValueReferences(
  database: DatabaseConfig, field: string, renames: ReadonlyArray<{ from: string; to: string }>,
): void {
  if (!renames.length) return;
  const mapping = new Map(renames.map(({ from, to }) => [from, to]));
  const rename = (value: string): string => mapping.get(value) ?? value;
  const visited = new Set<FilterRule | SourceRule>();
  const rewrite = (rule: FilterRule | SourceRule, operators: ReadonlySet<string>): void => {
    if (visited.has(rule)) return;
    visited.add(rule);
    if (rule.field === field && typeof rule.value === "string" && operators.has(rule.op)) rule.value = rename(rule.value);
  };
  const rewriteSource = (owner: DatabaseConfig | ViewConfig): void => {
    for (const rule of [...(owner.sourceRules ?? []), ...getAllSourceRules(owner.sourceRuleTree)]) {
      if (rule.valueType === undefined || rule.valueType === "string") rewrite(rule, SOURCE_EQUALITIES);
    }
  };
  const rewriteViewState = (state: ViewConfig | ViewModeStateDef): void => {
    for (const rule of state.filters ?? []) rewrite(rule, OPTION_COMPARISONS);
    // The legacy status filter always reads the literal "status" frontmatter key.
    if (field === "status" && state.statusFilter) state.statusFilter = rename(state.statusFilter);
  };
  const rewriteLabels = (group: Record<string, string[]> | undefined): void => {
    if (group && Object.prototype.hasOwnProperty.call(group, field)) {
      group[field] = [...new Set(group[field].map(rename))];
    }
  };
  const remapKeys = <T>(record: Record<string, T>, merge: (left: T, right: T) => T): Record<string, T> => {
    const entries = new Map<string, T>();
    for (const [key, value] of Object.entries(record)) {
      const next = rename(key);
      const previous = entries.get(next);
      entries.set(next, previous === undefined ? value : merge(previous, value));
    }
    return Object.fromEntries(entries);
  };
  rewriteSource(database);
  for (const view of database.views) {
    rewriteSource(view);
    for (const rule of view.conditionalFormats ?? []) {
      if (rule.valueSource !== "today") rewrite(rule.condition, OPTION_COMPARISONS);
    }
    rewriteViewState(view);
    for (const state of Object.values(view.viewStates ?? {})) {
      if (state) rewriteViewState(state);
    }
    rewriteLabels(view.groupOrders);
    rewriteLabels(view.collapsedGroups);
    if (view.expandedGroupRows && Object.prototype.hasOwnProperty.call(view.expandedGroupRows, field)) {
      view.expandedGroupRows[field] = remapKeys(view.expandedGroupRows[field], (a, b) => a === -1 || b === -1 ? -1 : Math.max(a, b));
    }
    if (view.boardCardOrders && Object.prototype.hasOwnProperty.call(view.boardCardOrders, field)) {
      view.boardCardOrders[field] = remapKeys(view.boardCardOrders[field], (a, b) => [...new Set([...a, ...b])]);
    }
    if (view.chartGroupField === field && view.chartHiddenGroups) {
      view.chartHiddenGroups = remapKeys(view.chartHiddenGroups, (left) => left);
    }
  }
}
