import { App, TFile } from "obsidian";
import { evaluateComputedFields } from "./ComputedEvaluator";
import { NoteRecord } from "./DataSource";
import { QueryEngine } from "./QueryEngine";
import { ColumnDef, RowData, ViewConfig } from "./types";
import { DatabaseViewState } from "../views/ViewStateStore";
import { getEffectiveFilterRules } from "./FilterRules";
import { sortByManualRank } from "./ManualOrder";
import { stringifyValue } from "./Stringify";
import { isFileFieldKey, getFileFieldFixedType, getRowFileFieldValue } from "./FileFields";
import { parseDateTimeParts } from "./DateTimeFormat";
import { getDefaultEventDateField } from "./CalendarTimelineModel";
import { getColumnDisplayType } from "./ColumnDisplay";
import { getDateSearchDisplayText, isDateSearchColumn, matchesDateSearch, normalizeSearchQuery } from "./Search";

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

    const q = normalizeSearchQuery(state.searchText);
    if (q) {
      // Calendar/timeline hide the property panel — event cards only show start/end/title.
      // Treat all other columns as hidden for search by expanding the hidden set inline.
      const isCalendarTimeline = config.viewType === "calendar" || config.viewType === "timeline";
      const hidden = new Set(state.hiddenColumns);
      if (isCalendarTimeline) {
        const titleField = this.getCalendarTimelineTitleField(config);
        const visibleKeys = new Set([
          config.timelineStartDateField || config.calendarStartDateField || getDefaultEventDateField(config),
          config.timelineEndDateField || config.calendarEndDateField,
          titleField,
        ].filter(Boolean) as string[]);
        for (const col of config.schema.columns) {
          if (!visibleKeys.has(col.key)) hidden.add(col.key);
        }
      }
      const searchCols = config.schema.columns.filter((col) => !hidden.has(col.key));
      rows = rows.filter((row) => {
        if (isCalendarTimeline) {
          const title = this.getCalendarTimelineSearchTitle(row, config);
          if (title.toLowerCase().includes(q)) return true;
        } else if (row.file.name.toLowerCase().includes(q)) {
          return true;
        }
        for (const col of searchCols) {
          const displayType = this.getSearchDisplayType(config, col);
          const val = col.type === "computed"
            ? row.computed[col.computedKey || col.key]
            : isFileFieldKey(col.key)
              ? getRowFileFieldValue(row, col.key)
              : row.frontmatter[col.key];
          if (val == null || val === "") continue;
          // Date values (from Obsidian's YAML parser) or date/datetime columns:
          // search visible display text plus explicit date forms only. NEVER
          // stringify Date objects — toISOString() may contain timezone-shifted
          // digits the user never sees (e.g., local midnight in UTC-X → T10:00Z).
          if (isDateSearchColumn(displayType, val)) {
            const parts = parseDateTimeParts(val);
            const display = getDateSearchDisplayText(val, displayType);
            if (display.toLowerCase().includes(q)) return true;
            if (matchesDateSearch(parts, q)) return true;
            continue;
          }
          if (stringifyValue(val).toLowerCase().includes(q)) return true;
        }
        return false;
      });
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
      ? app?.metadataCache.getFileCache(thisFile)?.frontmatter
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

  private getSearchDisplayType(config: ViewConfig, col: ColumnDef): ColumnDef["type"] {
    if (isFileFieldKey(col.key)) return getFileFieldFixedType(col.key);
    return getColumnDisplayType(col, config.schema.computedFields);
  }

  private getCalendarTimelineTitleField(config: ViewConfig): string | undefined {
    if (config.viewType === "timeline") {
      return config.timelineTitleField || config.calendarTitleField || config.titleField;
    }
    return config.calendarTitleField || config.titleField;
  }

  private getCalendarTimelineSearchTitle(row: RowData, config: ViewConfig): string {
    const titleField = this.getCalendarTimelineTitleField(config);
    if (titleField) {
      const value = stringifyValue(this.getSearchFieldValue(row, config, titleField)).trim();
      if (value) return value;
    }
    return row.file.basename || row.file.name.replace(/\.md$/i, "");
  }

  private getSearchFieldValue(row: RowData, config: ViewConfig, field: string): unknown {
    const column = config.schema.columns.find((col) => col.key === field);
    if (column?.type === "computed") return row.computed[column.computedKey || column.key];
    if (isFileFieldKey(field)) {
      if (field === "file.name" || field === "file.basename") {
        return row.file.basename || row.file.name.replace(/\.md$/i, "");
      }
      return getRowFileFieldValue(row, field);
    }
    return row.frontmatter[field];
  }
}
