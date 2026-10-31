import { ColumnDef, ViewConfig } from "../data/types";
import { t } from "../i18n";
import { DatabaseViewState } from "./ViewStateStore";

/** Canonical property list shared by the filter panel, sort panel and active rail. */
export function getViewRuleColumns(config: ViewConfig): ColumnDef[] {
  const columns = (config.schema?.columns || []).filter((column) => column.type !== "button");
  if (columns.some((column) => column.key === "file.name")) return columns;
  return [{ key: "file.name", label: t("defaults.nameColumn"), type: "text" }, ...columns];
}

export function removeFilterRuleAt(state: DatabaseViewState, index: number): boolean {
  if (index < 0 || index >= state.filters.length) return false;
  state.filters.splice(index, 1);
  return true;
}

export function removeSortRuleAt(state: DatabaseViewState, index: number): boolean {
  if (index < 0 || index >= state.sortRules.length) return false;
  state.sortRules.splice(index, 1);
  if (state.sortRules.length === 0) {
    state.sortColumn = undefined;
    state.sortDirection = "asc";
  }
  return true;
}
