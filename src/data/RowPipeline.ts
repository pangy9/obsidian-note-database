import { App, TFile } from "obsidian";
import { evaluateComputedFields } from "./ComputedEvaluator";
import { NoteRecord } from "./DataSource";
import { QueryEngine } from "./QueryEngine";
import { ColumnDef, RowData, ViewConfig } from "./types";
import { DatabaseViewState } from "../views/ViewStateStore";
import { getEffectiveFilterRules } from "./FilterRules";
import { sortByManualRank } from "./ManualOrder";

export class RowPipeline {
  private queryEngine = new QueryEngine();

  build(records: NoteRecord[], config: ViewConfig, state: DatabaseViewState, app?: App): RowData[] {
    let rows = this.buildRows(records, config, app);
    const queryColumns = this.withComputedResultTypes(config);

    if (state.sortRules.length > 0) {
      rows = this.queryEngine.sortByRules(rows, queryColumns, state.sortRules);
    } else if (state.sortColumn) {
      const col = queryColumns.find((c) => c.key === state.sortColumn);
      if (col) rows = this.queryEngine.sort(rows, col, state.sortDirection || "asc");
    } else if (config.manualOrder?.ranks && Object.keys(config.manualOrder.ranks).length > 0) {
      rows = sortByManualRank(rows, config.manualOrder.ranks);
    }

    if (state.searchText) {
      const q = state.searchText.toLowerCase();
      rows = rows.filter((row) => row.file.name.toLowerCase().includes(q));
    }

    if (state.statusFilter) {
      rows = rows.filter((row) => row.frontmatter["status"] === state.statusFilter);
    }

    const validFields = new Set(config.schema.columns.map((col) => col.key));
    const effectiveFilters = getEffectiveFilterRules(state.filters, validFields);
    if (effectiveFilters.length > 0) {
      rows = this.queryEngine.applyFilters(rows, effectiveFilters, state.filterLogic, queryColumns);
    }

    if (typeof config.resultLimit === "number" && Number.isFinite(config.resultLimit) && config.resultLimit > 0) {
      rows = rows.slice(0, Math.floor(config.resultLimit));
    }

    return rows;
  }

  private buildRows(records: NoteRecord[], config: ViewConfig, app?: App): RowData[] {
    const thisFile = app && config.baseThisFilePath
      ? app.vault.getAbstractFileByPath(config.baseThisFilePath)
      : null;
    const thisFrontmatter = thisFile instanceof TFile
      ? app?.metadataCache.getFileCache(thisFile)?.frontmatter as Record<string, unknown> | undefined
      : undefined;
    return records.map((record) => ({
      app,
      file: record.file,
      frontmatter: record.frontmatter,
      cache: app?.metadataCache.getFileCache(record.file) ?? null,
      computed: evaluateComputedFields(config.schema.computedFields, config.schema.columns, record.frontmatter, {
        app,
        file: record.file,
        thisFile: thisFile instanceof TFile ? thisFile : undefined,
        thisFrontmatter,
      }),
    }));
  }

  private withComputedResultTypes(config: ViewConfig): ColumnDef[] {
    return config.schema.columns.map((col) => {
      if (col.type !== "computed") return col;
      const computedKey = col.computedKey || col.key;
      const computedType = config.schema.computedFields.find((field) => field.key === computedKey)?.type;
      return computedType ? { ...col, type: computedType } : col;
    });
  }
}
