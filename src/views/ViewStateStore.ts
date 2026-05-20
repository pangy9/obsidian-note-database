import { FilterRule, SortRule, ViewConfig } from "../data/types";

export interface DatabaseViewState {
  searchText: string;
  statusFilter: string;
  groupByField: string;
  filters: FilterRule[];
  hiddenColumns: Set<string>;
  filterLogic: "and" | "or";
  sortColumn?: string;
  sortDirection: "asc" | "desc";
  sortRules: SortRule[];
}

export class ViewStateStore {
  private states = new Map<string, DatabaseViewState>();

  /** Get or create state for a specific view within a database */
  get(dbIndex: number, viewIndex: number, viewConfig?: ViewConfig): DatabaseViewState {
    const key = this.getKey(dbIndex, viewIndex);
    let state = this.states.get(key);
    if (!state) {
      state = this.create(viewConfig);
      this.states.set(key, state);
    }
    // Prune hidden columns that no longer exist in current schema
    if (state && viewConfig) {
      const validKeys = new Set(viewConfig.schema.columns.map(c => c.key));
      for (const key of state.hiddenColumns) {
        if (!validKeys.has(key)) state.hiddenColumns.delete(key);
      }
    }
    return state;
  }

  /** Remove all cached states */
  clear(): void {
    this.states.clear();
  }

  /** Remove cached state for a specific database+view */
  delete(dbIndex: number, viewIndex: number): void {
    this.states.delete(this.getKey(dbIndex, viewIndex));
  }

  persist(viewConfig: ViewConfig, state: DatabaseViewState): void {
    const persisted = this.toPersistedState(state);
    viewConfig.viewStates = { ...(viewConfig.viewStates || {}) };
    // Store under current viewType key for backwards compat
    const mode = viewConfig.viewType || "table";
    viewConfig.viewStates[mode] = persisted;
    // Also write to top-level for legacy access
    viewConfig.hiddenColumns = persisted.hiddenColumns;
    viewConfig.statusFilter = persisted.statusFilter;
    viewConfig.searchText = persisted.searchText;
    viewConfig.groupByField = persisted.groupByField;
    viewConfig.filterLogic = persisted.filterLogic;
    viewConfig.filters = persisted.filters;
    viewConfig.sortColumn = persisted.sortColumn;
    viewConfig.sortDirection = persisted.sortDirection;
    viewConfig.sortRules = persisted.sortRules;
  }

  private create(viewConfig: ViewConfig | undefined): DatabaseViewState {
    return {
      searchText: viewConfig?.searchText ?? "",
      statusFilter: viewConfig?.statusFilter ?? "",
      groupByField: viewConfig?.groupByField ?? "",
      filters: this.copyFilters(viewConfig?.filters),
      hiddenColumns: new Set(viewConfig?.hiddenColumns ?? []),
      filterLogic: viewConfig?.filterLogic ?? "and",
      sortColumn: viewConfig?.sortColumn,
      sortDirection: viewConfig?.sortDirection ?? "asc",
      sortRules: this.copySortRules(viewConfig?.sortRules),
    };
  }

  private toPersistedState(state: DatabaseViewState): import("../data/types").ViewModeStateDef {
    const hiddenColumns = Array.from(state.hiddenColumns);
    return {
      hiddenColumns: hiddenColumns.length > 0 ? hiddenColumns : undefined,
      statusFilter: state.statusFilter || undefined,
      searchText: state.searchText || undefined,
      groupByField: state.groupByField || undefined,
      filterLogic: state.filterLogic === "or" ? "or" : undefined,
      filters: state.filters.length > 0 ? this.copyFilters(state.filters) : undefined,
      sortColumn: state.sortColumn || undefined,
      sortDirection: state.sortColumn ? state.sortDirection : undefined,
      sortRules: state.sortRules.length > 0 ? this.copySortRules(state.sortRules) : undefined,
    };
  }

  private copyFilters(filters: FilterRule[] | undefined): FilterRule[] {
    return filters ? filters.map((filter) => ({ ...filter })) : [];
  }

  private copySortRules(rules: SortRule[] | undefined): SortRule[] {
    return rules ? rules.map((rule) => ({ ...rule })) : [];
  }

  private getKey(dbIndex: number, viewIndex: number): string {
    return `${dbIndex}:${viewIndex}`;
  }
}
