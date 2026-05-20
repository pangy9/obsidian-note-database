import { FilterRule } from "./types";

export function isEffectiveFilterRule(rule: FilterRule, validFields?: Set<string>): boolean {
  if (!rule?.field) return false;
  if (validFields && !validFields.has(rule.field)) return false;
  if (rule.op === "empty" || rule.op === "notempty") return true;
  return String(rule.value ?? "").trim().length > 0;
}

export function getEffectiveFilterRules(rules: FilterRule[] | undefined, validFields?: Set<string>): FilterRule[] {
  return (rules || []).filter((rule) => isEffectiveFilterRule(rule, validFields));
}
