import { normalizePath } from "obsidian";
import { getBaseFileFieldType, isBaseFileField } from "./FileFields";
import { ColumnDef, ComputedFieldDef, SourceRule, SourceRuleExpression, SourceRuleGroup, SourceRuleNode, SourceRuleNot, SourceRuleOperator, SourceRuleValueType } from "./types";

const SOURCE_RULE_OPERATORS = new Set<SourceRuleOperator>([
  "inFolder",
  "hasTag",
  "hasProperty",
  "hasLink",
  "eq",
  "neq",
  "strictEq",
  "strictNeq",
  "contains",
  "startsWith",
  "endsWith",
  "matches",
  "isType",
  "gt",
  "gte",
  "lt",
  "lte",
  "empty",
  "notempty",
  "truthy",
]);

const SOURCE_RULE_VALUE_TYPES = new Set<SourceRuleValueType>(["string", "number", "boolean", "null", "date"]);

export function isSourceRuleGroup(node: SourceRuleNode): node is SourceRuleGroup {
  return "type" in node && node.type === "group";
}

export function isSourceRuleNot(node: SourceRuleNode): node is SourceRuleNot {
  return "type" in node && node.type === "not";
}

export function isSourceRuleExpression(node: SourceRuleNode): node is SourceRuleExpression {
  return "type" in node && node.type === "expression";
}

export function isSourceRuleLeaf(node: SourceRuleNode): node is SourceRule {
  return !("type" in node);
}

export function createLegacySourceRuleTree(
  rules: SourceRule[] | undefined,
  logic: "and" | "or" = "and"
): SourceRuleNode | undefined {
  if (!rules?.length) return undefined;
  if (rules.length === 1) return { ...rules[0] };
  return {
    type: "group",
    logic,
    rules: rules.map((rule) => ({ ...rule })),
  };
}

export function getSourceRuleTree(
  tree: SourceRuleNode | undefined,
  rules?: SourceRule[],
  logic: "and" | "or" = "and"
): SourceRuleNode | undefined {
  return tree || createLegacySourceRuleTree(rules, logic);
}

export function combineSourceRuleTrees(...trees: Array<SourceRuleNode | undefined>): SourceRuleNode | undefined {
  const rules: SourceRuleNode[] = [];
  for (const tree of trees) {
    if (!tree) continue;
    if (rules.some((existing) => sourceRuleTreesEqual(existing, tree))) continue;
    rules.push(tree);
  }
  if (rules.length === 0) return undefined;
  if (rules.length === 1) return rules[0];
  return { type: "group", logic: "and", rules };
}

export function sourceRuleTreesEqual(left: SourceRuleNode | undefined, right: SourceRuleNode | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function matchesSourceRuleTree(
  tree: SourceRuleNode,
  matchesLeaf: (rule: SourceRule) => boolean,
  matchesExpression: (rule: SourceRuleExpression) => boolean = () => false
): boolean {
  if (isSourceRuleLeaf(tree)) return matchesLeaf(tree);
  if (isSourceRuleExpression(tree)) return matchesExpression(tree);
  if (isSourceRuleNot(tree)) return !matchesSourceRuleTree(tree.rule, matchesLeaf, matchesExpression);
  if (tree.rules.length === 0) return tree.logic === "and";
  return tree.logic === "or"
    ? tree.rules.some((rule) => matchesSourceRuleTree(rule, matchesLeaf, matchesExpression))
    : tree.rules.every((rule) => matchesSourceRuleTree(rule, matchesLeaf, matchesExpression));
}

/** Rules that every matching record must satisfy and can safely seed new records. */
export function getRequiredSourceRules(tree: SourceRuleNode | undefined): SourceRule[] {
  if (!tree || isSourceRuleNot(tree)) return [];
  if (isSourceRuleLeaf(tree)) return [tree];
  if (isSourceRuleExpression(tree)) return [];
  if (tree.logic === "or") return tree.rules.length === 1 ? getRequiredSourceRules(tree.rules[0]) : [];
  return tree.rules.flatMap((rule) => getRequiredSourceRules(rule));
}

export function getAllSourceRules(tree: SourceRuleNode | undefined): SourceRule[] {
  if (!tree) return [];
  if (isSourceRuleLeaf(tree)) return [tree];
  if (isSourceRuleExpression(tree)) return [];
  if (isSourceRuleNot(tree)) return getAllSourceRules(tree.rule);
  return tree.rules.flatMap((rule) => getAllSourceRules(rule));
}

/** Positive leaves that can be applied as best-effort defaults for newly created records. */
export function getPositiveSourceRules(tree: SourceRuleNode | undefined): SourceRule[] {
  if (!tree || isSourceRuleNot(tree)) return [];
  if (isSourceRuleLeaf(tree)) return [tree];
  if (isSourceRuleExpression(tree)) return [];
  return tree.rules.flatMap((rule) => getPositiveSourceRules(rule));
}

export function updateSourceRuleTreeKeyReferences(
  tree: SourceRuleNode | undefined,
  oldKey: string,
  newKey: string
): boolean {
  if (!tree) return false;
  if (isSourceRuleLeaf(tree)) {
    if (tree.field !== oldKey) return false;
    tree.field = newKey;
    return true;
  }
  if (isSourceRuleExpression(tree)) {
    const replaced = replaceExpressionKeyReference(tree.expression, oldKey, newKey);
    if (replaced === tree.expression) return false;
    tree.expression = replaced;
    return true;
  }
  if (isSourceRuleNot(tree)) return updateSourceRuleTreeKeyReferences(tree.rule, oldKey, newKey);
  let changed = false;
  for (const rule of tree.rules) {
    changed = updateSourceRuleTreeKeyReferences(rule, oldKey, newKey) || changed;
  }
  return changed;
}

export function removeSourceRuleTreeReferences(
  tree: SourceRuleNode | undefined,
  key: string
): SourceRuleNode | undefined {
  if (!tree) return undefined;
  if (isSourceRuleLeaf(tree)) return tree.field === key ? undefined : tree;
  if (isSourceRuleExpression(tree)) return expressionReferencesKey(tree.expression, key) ? undefined : tree;
  if (isSourceRuleNot(tree)) {
    const rule = removeSourceRuleTreeReferences(tree.rule, key);
    return rule ? { ...tree, rule } : undefined;
  }
  const rules = tree.rules
    .map((rule) => removeSourceRuleTreeReferences(rule, key))
    .filter((rule): rule is SourceRuleNode => !!rule);
  if (rules.length === 0) return undefined;
  if (rules.length === 1) return rules[0];
  return { ...tree, rules };
}

export function parseSourceRuleTree(value: unknown): SourceRuleNode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source["type"] === "expression") {
    const expression = String(source["expression"] || "").trim();
    return expression ? { type: "expression", expression } : undefined;
  }
  if (source["type"] === "group") {
    const logic = source["logic"] === "or" ? "or" : "and";
    const rules = Array.isArray(source["rules"])
      ? source["rules"].map(parseSourceRuleTree).filter((rule): rule is SourceRuleNode => !!rule)
      : [];
    return { type: "group", logic, rules };
  }
  if (source["type"] === "not") {
    const rule = parseSourceRuleTree(source["rule"]);
    return rule ? { type: "not", rule } : undefined;
  }
  const field = String(source["field"] || "").trim();
  const op = source["op"];
  if (!field || typeof op !== "string" || !SOURCE_RULE_OPERATORS.has(op as SourceRuleOperator)) return undefined;
  const valueType = source["valueType"];
  return {
    field,
    op: op as SourceRuleOperator,
    value: source["value"] == null ? undefined : String(source["value"]),
    valueType: typeof valueType === "string" && SOURCE_RULE_VALUE_TYPES.has(valueType as SourceRuleValueType)
      ? valueType as SourceRuleValueType
      : undefined,
  };
}

export function getSourceRuleTypedValue(rule: SourceRule): unknown {
  const raw = String(rule.value ?? "");
  if (rule.valueType === "null") return null;
  if (rule.valueType === "number") return Number(raw);
  if (rule.valueType === "boolean") return raw === "true";
  return raw;
}

export function sourceRuleValuesStrictEqual(value: unknown, rule: SourceRule): boolean {
  if (Array.isArray(value)) return false;
  const expected = getSourceRuleTypedValue(rule);
  if (value === expected) return true;
  return !!getComparableLinkTarget(expected) && sourceRuleValuesEqual(value, expected);
}

export function sourceRuleValuesLooseEqual(value: unknown, rule: SourceRule): boolean {
  return sourceRuleValuesLooseEqualValue(value, getSourceRuleTypedValue(rule));
}

export function sourceRuleContainsValue(value: unknown, rule: SourceRule): boolean {
  if (!rule.valueType) {
    return String(value ?? "").toLowerCase().includes(String(rule.value ?? "").toLowerCase());
  }
  const typedValue = getSourceRuleTypedValue(rule);
  if (Array.isArray(value)) return value.some((item) => sourceRuleValuesEqual(item, typedValue));
  return String(value ?? "").includes(String(typedValue ?? ""));
}

export function matchesBaseSourceType(
  value: unknown,
  rawType: string,
  field?: string,
  columns?: ColumnDef[],
  computedFields?: ComputedFieldDef[]
): boolean {
  const type = rawType.trim().toLowerCase();
  const declaredType = getDeclaredSourceFieldType(field, columns, computedFields);
  if (type === "list" || type === "array") return Array.isArray(value);
  if (type === "date") return declaredType === "date" && hasFiniteDateValue(value);
  if (type === "duration") return false;
  if (type === "null") return value == null;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean" || type === "bool" || type === "checkbox") {
    return typeof value === "boolean" || (declaredType === "checkbox" && value != null && value !== "");
  }
  if (type === "string" || type === "text") return typeof value === "string";
  if (type === "object") return value != null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

function getDeclaredSourceFieldType(
  field?: string,
  columns?: ColumnDef[],
  computedFields?: ComputedFieldDef[]
): ColumnDef["type"] | ComputedFieldDef["type"] | undefined {
  if (!field) return undefined;
  if (isBaseFileField(field)) return getBaseFileFieldType(field);
  const column = columns?.find((candidate) => candidate.key === field);
  if (field.startsWith("formula.")) {
    const key = field.slice("formula.".length);
    return computedFields?.find((computed) => computed.key === key)?.type || column?.type;
  }
  if (column?.type === "computed") {
    const key = column.computedKey || column.key;
    return computedFields?.find((computed) => computed.key === key)?.type || column.type;
  }
  return column?.type;
}

function hasFiniteDateValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return Number.isFinite(new Date(value as any).getTime());
}

function sourceRuleValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  const leftTarget = getComparableLinkTarget(left);
  const rightTarget = getComparableLinkTarget(right);
  if (!leftTarget && !rightTarget) return false;
  return linkTargetsEqual(leftTarget || String(left ?? ""), rightTarget || String(right ?? ""));
}

function sourceRuleValuesLooseEqualValue(left: unknown, right: unknown): boolean {
  if (sourceRuleValuesEqual(left, right)) return true;
  if (getComparableLinkTarget(left) || getComparableLinkTarget(right)) return false;
  return String(left ?? "") === String(right ?? "");
}

function getComparableLinkTarget(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const wikilink = value.trim().match(/^\[\[([\s\S]*?)\]\]$/);
  if (!wikilink) return undefined;
  const inner = wikilink[1].trim();
  const separator = inner.indexOf("|");
  return separator >= 0 ? inner.slice(0, separator).trim() : inner;
}

function linkTargetsEqual(left: string, right: string): boolean {
  const normalizeTarget = (value: string) => normalizePath(value.split("#", 1)[0]).replace(/\.md$/i, "");
  return normalizeTarget(left) === normalizeTarget(right);
}

function replaceExpressionKeyReference(expression: string, oldKey: string, newKey: string): string {
  const oldJson = JSON.stringify(oldKey);
  const newJson = JSON.stringify(newKey);
  const escaped = oldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let next = expression
    .replace(new RegExp(`\\b(note|properties)\\.${escaped}\\b`, "g"), (_match, prefix) => `${prefix}[${newJson}]`)
    .replace(new RegExp(`\\b(note|properties)\\[\\s*(["'])${escaped}\\2\\s*\\]`, "g"), (_match, prefix) => `${prefix}[${newJson}]`);
  if (oldKey.startsWith("formula.")) {
    const oldFormulaKey = oldKey.slice("formula.".length);
    const newFormulaKey = newKey.startsWith("formula.") ? newKey.slice("formula.".length) : newKey;
    const newFormulaJson = JSON.stringify(newFormulaKey);
    const escapedFormulaKey = oldFormulaKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next
      .replace(new RegExp(`\\bformula\\.${escapedFormulaKey}\\b`, "g"), `formula[${newFormulaJson}]`)
      .replace(new RegExp(`\\bformula\\[\\s*(["'])${escapedFormulaKey}\\1\\s*\\]`, "g"), `formula[${newFormulaJson}]`);
    return next;
  }
  return replaceBareIdentifierOutsideStrings(next, oldKey, newKey);
}

function expressionReferencesKey(expression: string, key: string): boolean {
  const marker = `__deleted_${key.replace(/[^A-Za-z0-9_$]/g, "_")}__`;
  return replaceExpressionKeyReference(expression, key, marker) !== expression;
}

function replaceBareIdentifierOutsideStrings(expression: string, oldKey: string, newKey: string): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(oldKey)) return expression;
  let result = "";
  let index = 0;
  let quote: string | null = null;
  while (index < expression.length) {
    const char = expression[index];
    if (quote) {
      result += char;
      if (char === "\\") {
        index += 1;
        if (index < expression.length) result += expression[index];
      } else if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      result += char;
      index += 1;
      continue;
    }
    if (
      expression.startsWith(oldKey, index) &&
      !isIdentifierChar(expression[index - 1]) &&
      !isIdentifierChar(expression[index + oldKey.length]) &&
      expression[index - 1] !== "."
    ) {
      result += newKey;
      index += oldKey.length;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function isIdentifierChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_$]/.test(char);
}
