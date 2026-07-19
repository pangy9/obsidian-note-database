import { getLocalDateKey } from "./CalendarDateTime";
import { QueryEngine } from "./QueryEngine";
import { ConditionalFormatRule, DatabaseConfig, RowData, StatusColor, ViewConfig } from "./types";

export interface ConditionalFormatMatch {
  color: StatusColor;
  ruleId: string;
}

const queryEngine = new QueryEngine();

function resolveRule(rule: ConditionalFormatRule): ConditionalFormatRule {
  if (rule.valueSource !== "today") return rule;
  return {
    ...rule,
    condition: {
      ...rule.condition,
      value: getLocalDateKey(new Date()),
    },
  };
}

export function getConditionalFormatMatch(
  row: RowData,
  config: ViewConfig,
  database: DatabaseConfig | undefined,
  targetField?: string,
): ConditionalFormatMatch | null {
  const rules = config.conditionalFormats || [];
  for (const rawRule of rules) {
    if (!rawRule?.id || !rawRule.condition?.field) continue;
    if (targetField) {
      if (rawRule.target !== "field" || rawRule.condition.field !== targetField) continue;
    } else if (rawRule.target !== "record") {
      continue;
    }
    const rule = resolveRule(rawRule);
    if (queryEngine.applyFilters([row], [rule.condition], "and", config.schema.columns).length === 0) continue;
    return { color: rule.color || "gray", ruleId: rule.id };
  }
  return null;
}

export function applyConditionalFormat(
  element: HTMLElement,
  row: RowData,
  config: ViewConfig,
  database: DatabaseConfig | undefined,
  targetField?: string,
): void {
  element.removeClass("db-conditional-format");
  element.style.removeProperty("--db-conditional-format-bg");
  element.style.removeProperty("--db-conditional-format-fg");
  element.style.removeProperty("--card-bg");
  element.style.removeProperty("--card-accent");
  element.style.removeProperty("--db-calendar-event-bg");
  element.style.removeProperty("--db-calendar-event-accent");
  element.removeAttribute("data-note-database-conditional-rule");
  const match = getConditionalFormatMatch(row, config, database, targetField);
  if (!match) return;
  element.addClass("db-conditional-format");
  element.style.setProperty("--db-conditional-format-bg", `var(--status-color-bg-${match.color})`);
  element.style.setProperty("--db-conditional-format-fg", `var(--status-color-fg-${match.color})`);
  element.style.setProperty("--card-bg", `var(--status-color-bg-${match.color})`);
  element.style.setProperty("--card-accent", `var(--status-color-fg-${match.color})`);
  element.style.setProperty("--db-calendar-event-bg", `var(--status-color-bg-${match.color})`);
  element.style.setProperty("--db-calendar-event-accent", `var(--status-color-fg-${match.color})`);
  element.setAttribute("data-note-database-conditional-rule", match.ruleId);
}
