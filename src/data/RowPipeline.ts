import { ComputedFieldEngine } from "./ComputedField";
import { NoteRecord } from "./DataSource";
import { QueryEngine } from "./QueryEngine";
import { RowData, ViewConfig } from "./types";
import { DatabaseViewState } from "../views/ViewStateStore";
import { getEffectiveFilterRules } from "./FilterRules";
import { sortByManualRank } from "./ManualOrder";

export class RowPipeline {
  private queryEngine = new QueryEngine();

  build(records: NoteRecord[], config: ViewConfig, state: DatabaseViewState): RowData[] {
    let rows = this.buildRows(records, config);

    if (state.sortRules.length > 0) {
      rows = this.queryEngine.sortByRules(rows, config.schema.columns, state.sortRules);
    } else if (state.sortColumn) {
      const col = config.schema.columns.find((c) => c.key === state.sortColumn);
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
      rows = this.queryEngine.applyFilters(rows, effectiveFilters, state.filterLogic, config.schema.columns);
    }

    return rows;
  }

  private buildRows(records: NoteRecord[], config: ViewConfig): RowData[] {
    const engine = new ComputedFieldEngine(config.schema.computedFields, config.schema.columns);
    return records.map((record) => ({
      file: record.file,
      frontmatter: record.frontmatter,
      computed: engine.evaluate(record.frontmatter),
    }));
  }
}
