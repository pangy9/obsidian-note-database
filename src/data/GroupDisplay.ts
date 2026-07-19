import { t } from "../i18n";
import { getColumnDisplayType } from "./ColumnDisplay";
import { formatDateTimeValueDisplay, formatDateValueDisplay } from "./DateTimeFormat";
import { stringifyValue } from "./Stringify";
import { toBooleanValue } from "./ColumnTypes";
import { DateGroupMode, ViewConfig } from "./types";
import { parseRelationLink } from "./RelationLinks";

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
  if (displayType === "checkbox") return toBooleanValue(key) ? t("common.true") : t("common.false");
  if (displayType === "relation") {
    const link = parseRelationLink(key);
    return link?.alias || link?.target.split("/").pop() || key;
  }
  return key;
}

/** Build create-entry defaults for a group key, matching the query/groupBy口径. */
export function resolveGroupCreateDefaults(config: ViewConfig, groupField: string, groupKey: string): Record<string, unknown> {
  if (groupKey === t("common.uncategorized")) return { [groupField]: "" };
  const col = config.schema.columns.find((candidate) => candidate.key === groupField);
  if (col?.type === "multi-select" || col?.type === "relation") return { [groupField]: [groupKey] };
  if (col?.type === "checkbox") return { [groupField]: toBooleanValue(groupKey) };
  return { [groupField]: groupKey };
}

/** Whether the group field is formula-driven (computed) and thus not directly writable. */
export function isComputedGroupField(config: ViewConfig, field: string | undefined): boolean {
  if (!field) return false;
  if (field.startsWith("formula.")) return true;
  const col = config.schema.columns.find((candidate) => candidate.key === field);
  return col?.type === "computed" || col?.type === "rollup";
}
