import { getColumnDisplayType } from "./ColumnDisplay";
import { ColumnDef, ViewConfig } from "./types";

/** Fields offered by rule editors must also be accepted by the row pipeline. */
export function getQueryColumns(config: ViewConfig, fileNameLabel = "file.name"): ColumnDef[] {
  const columns = config.schema.columns.filter((column) => column.type !== "button");
  if (columns.some((column) => column.key === "file.name")) return columns;
  return [{ key: "file.name", label: fileNameLabel, type: "text" }, ...columns];
}

export function getTypedQueryColumns(config: ViewConfig): ColumnDef[] {
  return getQueryColumns(config).map(col => col.type === "computed" || col.type === "rollup"
    ? { ...col, type: getColumnDisplayType(col, config.schema.computedFields) }
    : col);
}
