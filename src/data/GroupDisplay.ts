import { t } from "../i18n";
import { getColumnDisplayType } from "./ColumnDisplay";
import { formatDateTimeValueDisplay, formatDateValueDisplay } from "./DateTimeFormat";
import { stringifyValue } from "./Stringify";
import { DateGroupMode, ViewConfig } from "./types";

export interface GroupDisplayOptions {
  uncategorizedLabel?: string;
  uncategorizedKeys?: string[];
}

/** Date grouping mode for a field; defaults to "exact". */
export function getDateGroupMode(config: ViewConfig, field: string | undefined): DateGroupMode {
  return (field && config.dateGroupModes?.[field]) || "exact";
}

export function formatGroupKeyDisplay(
  config: ViewConfig,
  groupField: string | undefined,
  groupKey: string,
  options: GroupDisplayOptions = {}
): string {
  const key = stringifyValue(groupKey).trim();
  const uncategorizedLabel = options.uncategorizedLabel || t("common.uncategorized");
  if (!key || key === t("common.uncategorized") || options.uncategorizedKeys?.includes(key)) return uncategorizedLabel;

  const column = groupField ? config.schema.columns.find((candidate) => candidate.key === groupField) : undefined;
  const displayType = column ? getColumnDisplayType(column, config.schema.computedFields) : undefined;
  if (displayType === "date") return formatDateValueDisplay(key);
  if (displayType === "datetime") {
    // "date" mode groups by dateKey (time ignored) → show as a date, not a datetime.
    if (getDateGroupMode(config, groupField) === "date") return formatDateValueDisplay(key);
    return formatDateTimeValueDisplay(key, { mode: "full", showTimeWhenMissing: true });
  }
  return key;
}
