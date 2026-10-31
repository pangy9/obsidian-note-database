import { getLocalDateKey } from "./CalendarDateTime";
import { QueryEngine } from "./QueryEngine";
import { ConditionalFormatRule, DatabaseConfig, RowData, StatusColor, ViewConfig } from "./types";

export interface ConditionalFormatMatch {
  color: StatusColor;
  ruleId: string;
}

const queryEngine = new QueryEngine();

const sharedColorProperties = [
  "--card-bg", "--card-accent", "--db-calendar-event-bg", "--db-calendar-event-accent",
] as const;

// Conditional formatting temporarily overrides colors owned by the renderer.
// Keep their original values so unmatched/removed rules restore the event color,
// including when the same element is formatted repeatedly.
const baseColors = new WeakMap<HTMLElement, Array<{ property: string; value: string; priority: string }>>();

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
  const previousColors = baseColors.get(element);
  if (previousColors) {
    for (const { property, value, priority } of previousColors) {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
    baseColors.delete(element);
  }
  element.removeClass("db-conditional-format");
  element.style.removeProperty("--db-conditional-format-bg");
  element.style.removeProperty("--db-conditional-format-fg");
  element.removeAttribute("data-note-database-conditional-rule");
  const match = getConditionalFormatMatch(row, config, database, targetField);
  if (!match) return;
  baseColors.set(element, sharedColorProperties.map((property) => ({
    property,
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  })));
  element.addClass("db-conditional-format");
  element.style.setProperty("--db-conditional-format-bg", `var(--status-color-bg-${match.color})`);
  element.style.setProperty("--db-conditional-format-fg", `var(--status-color-fg-${match.color})`);
  element.style.setProperty("--card-bg", `var(--status-color-bg-${match.color})`);
  element.style.setProperty("--card-accent", `var(--status-color-fg-${match.color})`);
  element.style.setProperty("--db-calendar-event-bg", `var(--status-color-bg-${match.color})`);
  element.style.setProperty("--db-calendar-event-accent", `var(--status-color-fg-${match.color})`);
  element.setAttribute("data-note-database-conditional-rule", match.ruleId);
}
