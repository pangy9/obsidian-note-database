/**
 * 列重命名（key/label 变更）时的引用更新 —— obsidian-free 纯逻辑。
 *
 * 独立成模块的原因与 FormulaRename / FrontmatterOverride 相同：ColumnConfig.ts
 * 经 FileFields 依赖 obsidian 运行时，无法在 vitest(node) 中导入。把这些只操作
 * config/state 数据结构、不碰 obsidian API 的引用更新函数抽出，既让 R2-CO-1
 * 的 plan builder（在克隆上计算 after）可单测，也避免两份实现漂移。
 *
 * 依赖注入：updateColumnKeyReferences 的 sourceRuleTree 更新通过 deps 传入——
 * 真实 updateSourceRuleTreeKeyReferences 所在的 SourceRules.ts 耦合 obsidian，
 * 故不由本模块直接 import；生产侧（ColumnConfig wrapper）注入，测试可传 fake。
 */
import type { DatabaseConfig, SourceRule, ViewConfig } from "./types";
import type { DatabaseViewState } from "../views/ViewStateStore";
import { buildRenameKnownFields, replaceFormulaFieldReferences } from "./FormulaRename";

/** sourceRuleTree 引用更新器（必传，注入以规避 SourceRules 的 obsidian 耦合）。
 *  必传而非可选：避免 plan builder 忘记注入导致 sourceRuleTree 被静默遗漏。 */
export interface ColumnKeyReferenceDeps {
  updateSourceRuleTree: (tree: unknown, oldKey: string, newKey: string) => boolean;
}

/**
 * 把 ViewConfig/ViewState 中所有指向 oldKey 的引用改为 newKey（就地修改）。
 * 覆盖：columnOrder/title/icon/group/sort/calendar/timeline/chart 等字段、
 * sourceRules、sourceRuleTree（注入）、filters/sortRules、各种 group/map、
 * viewStates、活动 state、computed formula。返回是否有改动。
 */
export function updateColumnKeyReferences(
  config: ViewConfig,
  state: DatabaseViewState | undefined,
  oldKey: string,
  newKey: string,
  deps: ColumnKeyReferenceDeps,
  oldLabel?: string,
  newLabel?: string
): boolean {
  if (oldKey === newKey) {
    return updateComputedFormulaReferences(config, oldKey, newKey, oldLabel, newLabel);
  }
  let changed = false;
  const replaceValue = (value: string | undefined): string | undefined => {
    if (value !== oldKey) return value;
    changed = true;
    return newKey;
  };
  const replaceKeys = (keys: string[] | undefined): string[] | undefined => {
    if (!keys?.includes(oldKey)) return keys;
    changed = true;
    return keys.map((key) => key === oldKey ? newKey : key);
  };
  config.columnOrder = replaceKeys(config.columnOrder);
  config.titleField = replaceValue(config.titleField);
  config.recordIconField = replaceValue(config.recordIconField);
  config.galleryImageField = replaceValue(config.galleryImageField);
  config.boardImageField = replaceValue(config.boardImageField);
  config.boardGroupField = replaceValue(config.boardGroupField);
  config.boardSubgroupField = replaceValue(config.boardSubgroupField);
  config.chartGroupField = replaceValue(config.chartGroupField);
  config.chartStackField = replaceValue(config.chartStackField);
  config.chartSeriesField = replaceValue(config.chartSeriesField);
  config.chartValueField = replaceValue(config.chartValueField);
  config.chartSecondaryValueField = replaceValue(config.chartSecondaryValueField);
  config.calendarStartDateField = replaceValue(config.calendarStartDateField);
  config.calendarEndDateField = replaceValue(config.calendarEndDateField);
  config.calendarTitleField = replaceValue(config.calendarTitleField);
  config.calendarColorField = replaceValue(config.calendarColorField);
  config.timelineStartDateField = replaceValue(config.timelineStartDateField);
  config.timelineEndDateField = replaceValue(config.timelineEndDateField);
  config.timelineGroupField = replaceValue(config.timelineGroupField);
  config.timelineTitleField = replaceValue(config.timelineTitleField);
  config.timelineColorField = replaceValue(config.timelineColorField);
  config.groupByField = replaceValue(config.groupByField);
  config.sortColumn = replaceValue(config.sortColumn);
  config.sortColumnOrder = replaceValue(config.sortColumnOrder);
  changed = updateSourceRuleKeyReferences(config.sourceRules, oldKey, newKey) || changed;
  changed = deps.updateSourceRuleTree(config.sourceRuleTree, oldKey, newKey) || changed;
  for (const rule of config.filters || []) {
    if (rule.field === oldKey) {
      rule.field = newKey;
      changed = true;
    }
  }
  for (const rule of config.sortRules || []) {
    if (rule.field === oldKey) {
      rule.field = newKey;
      changed = true;
    }
  }

  config.hiddenColumns = replaceKeys(config.hiddenColumns);
  if (config.groupOrders?.[oldKey]) {
    config.groupOrders[newKey] = config.groupOrders[oldKey];
    delete config.groupOrders[oldKey];
    changed = true;
  }
  if (config.showEmptyGroups && oldKey in config.showEmptyGroups) {
    config.showEmptyGroups[newKey] = config.showEmptyGroups[oldKey];
    delete config.showEmptyGroups[oldKey];
    changed = true;
  }
  if (config.collapsedGroups?.[oldKey]) {
    config.collapsedGroups[newKey] = config.collapsedGroups[oldKey];
    delete config.collapsedGroups[oldKey];
    changed = true;
  }
  if (config.dateGroupModes && oldKey in config.dateGroupModes) {
    config.dateGroupModes[newKey] = config.dateGroupModes[oldKey];
    delete config.dateGroupModes[oldKey];
    changed = true;
  }
  if (config.expandedGroupRows && oldKey in config.expandedGroupRows) {
    config.expandedGroupRows[newKey] = config.expandedGroupRows[oldKey];
    delete config.expandedGroupRows[oldKey];
    changed = true;
  }
  if (config.boardCardOrders?.[oldKey]) {
    config.boardCardOrders[newKey] = config.boardCardOrders[oldKey];
    delete config.boardCardOrders[oldKey];
    changed = true;
  }
  for (const rule of config.summaryRules || []) {
    if (rule.field === oldKey) {
      rule.field = newKey;
      changed = true;
    }
  }
  for (const viewState of Object.values(config.viewStates || {})) {
    if (!viewState) continue;
    viewState.sortColumn = replaceValue(viewState.sortColumn);
    viewState.groupByField = replaceValue(viewState.groupByField);
    viewState.hiddenColumns = replaceKeys(viewState.hiddenColumns);
    for (const rule of viewState.sortRules || []) {
      if (rule.field === oldKey) {
        rule.field = newKey;
        changed = true;
      }
    }
    for (const rule of viewState.filters || []) {
      if (rule.field === oldKey) {
        rule.field = newKey;
        changed = true;
      }
    }
  }
  if (state) {
    const hiddenChanged = state.hiddenColumns.delete(oldKey);
    if (hiddenChanged) {
      state.hiddenColumns.add(newKey);
      changed = true;
    }
    state.groupByField = replaceValue(state.groupByField) || "";
    state.sortColumn = replaceValue(state.sortColumn);
    for (const rule of state.sortRules) {
      if (rule.field === oldKey) {
        rule.field = newKey;
        changed = true;
      }
    }
    for (const rule of state.filters) {
      if (rule.field === oldKey) {
        rule.field = newKey;
        changed = true;
      }
    }
  }
  return updateComputedFormulaReferences(config, oldKey, newKey, oldLabel, newLabel) || changed;
}

export function updateSourceRuleKeyReferences(
  rules: SourceRule[] | undefined,
  oldKey: string,
  newKey: string
): boolean {
  let changed = false;
  for (const rule of rules || []) {
    if (rule.field !== oldKey) continue;
    rule.field = newKey;
    changed = true;
  }
  return changed;
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
  const knownFields = buildRenameKnownFields(config.schema.columns, names);
  let changed = false;
  for (const def of config.schema.computedFields || []) {
    const next = replaceFormulaFieldReferences(def.expression || "", names, newKey, knownFields);
    if (next !== def.expression) {
      def.expression = next;
      changed = true;
    }
  }
  return changed;
}

export function updateSummaryFormulaReferences(
  database: Pick<DatabaseConfig, "summaryFormulas" | "schema">,
  oldKey: string,
  newKey: string,
  oldLabel?: string,
  _newLabel?: string
): boolean {
  const names = new Set([oldKey, oldLabel].filter((value): value is string => !!value && value !== newKey));
  if (names.size === 0 || !database.summaryFormulas) return false;
  const knownFields = buildRenameKnownFields(database.schema?.columns || [], names);
  let changed = false;
  for (const [summaryName, expression] of Object.entries(database.summaryFormulas)) {
    const next = replaceFormulaFieldReferences(expression || "", names, newKey, knownFields);
    if (next !== expression) {
      database.summaryFormulas[summaryName] = next;
      changed = true;
    }
  }
  return changed;
}
