import { App, CachedMetadata, getAllTags, normalizePath, TFile } from "obsidian";
import { hasObsidianTagValue, toObsidianTagValues } from "./ColumnTypes";
import { ComputedFieldEngine } from "./ComputedField";
import { isDateLikeColumnType } from "./DateTimeFormat";
import { safeEval } from "./SafeEval";
import { safeString } from "./SafeString";
import { ColumnDef, ComputedFieldDef } from "./types";
import type { MomentConstructor, MomentDurationLike } from "./MomentTypes";

declare const moment: MomentConstructor;

export interface BaseExpressionContext {
  app: App;
  file: TFile;
  frontmatter: Record<string, unknown>;
  thisFile?: TFile;
  thisFrontmatter?: Record<string, unknown>;
  computedFields?: ComputedFieldDef[];
  columns?: ColumnDef[];
  computedValues?: Record<string, unknown>;
}

const DANGEROUS_TOKENS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bconstructor\b/, label: "constructor" },
  { pattern: /\b__proto__\b/, label: "__proto__" },
  { pattern: /\bprototype\b/, label: "prototype" },
  { pattern: /\bFunction\b/, label: "Function" },
  { pattern: /\beval\b/, label: "eval" },
  { pattern: /\bimport\b/, label: "import" },
  { pattern: /\brequire\b/, label: "require" },
  { pattern: /\bsetTimeout\b/, label: "setTimeout" },
  { pattern: /\bsetInterval\b/, label: "setInterval" },
  { pattern: /\bfetch\b/, label: "fetch" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bWorker\b/, label: "Worker" },
  { pattern: /\bprocess\b/, label: "process" },
  { pattern: /\bglobal\b/, label: "global" },
  { pattern: /\bglobalThis\b/, label: "globalThis" },
  { pattern: /\bwhile\b/, label: "while" },
  { pattern: /\bfor\b/, label: "for" },
  { pattern: /\bdo\b/, label: "do" },
  { pattern: /\bclass\b/, label: "class" },
  { pattern: /\bnew\b/, label: "new" },
  { pattern: /\bdebugger\b/, label: "debugger" },
  { pattern: /\bthrow\b/, label: "throw" },
  { pattern: /\bdelete\b/, label: "delete" },
  { pattern: /\byield\b/, label: "yield" },
  { pattern: /\basync\b/, label: "async" },
  { pattern: /\bawait\b/, label: "await" },
];

const RESERVED = new Set([
  "this", "true", "false", "null", "undefined", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "return", "throw", "try",
  "catch", "finally", "new", "delete", "typeof", "instanceof", "void",
  "class", "function", "var", "let", "const", "import", "export", "default",
]);

export function evaluateBaseFilterExpression(expression: string, context: BaseExpressionContext): boolean {
  const value = evaluateBaseExpression(expression, context);
  return !!value;
}

export function evaluateBaseExpression(expression: string, context: BaseExpressionContext): unknown {
  validateBaseExpression(expression);
  const normalized = normalizeBaseExpression(expression);
  validateBaseExpression(normalized, true);
  const vars = createBaseContext(context);
  return safeEval(normalized, createBaseScope(vars));
}

export function evaluateBaseComputedFields(
  defs: ComputedFieldDef[],
  context: BaseExpressionContext,
  seed: Record<string, unknown> = {}
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...seed };
  const baseDefs = defs.filter((def) => def.expressionSyntax === "base");
  for (let pass = 0; pass < Math.max(baseDefs.length, 1); pass += 1) {
    for (const def of baseDefs) {
      try {
        result[def.key] = evaluateBaseExpression(def.expression, {
          ...context,
          computedFields: [],
          computedValues: result,
        });
      } catch {
        result[def.key] = null;
      }
    }
  }
  return result;
}

function normalizeBaseExpression(expression: string): string {
  let source = expression.trim();
  if (source.startsWith("=")) source = source.slice(1).trim();
  source = normalizeBaseIfExpressions(source);
  source = replaceBaseThisReferences(source);
  source = source
    .replace(/(\/(?:\\.|[^/\\\n])+\/[gimsuy]*)\.matches\s*\(/g, "__regexMatches($1,")
    .replace(/\(\s*([A-Za-z_$][\w$]*(?:\(\s*[^()]*\s*\)|(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)?)\s*-\s*([A-Za-z_$][\w$]*(?:\(\s*[^()]*\s*\)|(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)?)\s*\)\.(days|hours|minutes|seconds|milliseconds)\b/g, "__durationBetween($1,$2).$3")
    .replace(/(__durationBetween\(.+?\)\.(?:days|hours|minutes|seconds|milliseconds))\.isType\s*\(/g, "__isType($1,")
    .replace(/(__durationBetween\(.+?\)\.(?:days|hours|minutes|seconds|milliseconds))\.round\s*\(/g, "__round($1,")
    .replace(/(__durationBetween\(.+?\)\.(?:days|hours|minutes|seconds|milliseconds))\.ceil\s*\(\s*\)/g, "Math.ceil(Number($1))")
    .replace(/(__durationBetween\(.+?\)\.(?:days|hours|minutes|seconds|milliseconds))\.floor\s*\(\s*\)/g, "Math.floor(Number($1))")
    .replace(/(__durationBetween\(.+?\)\.(?:days|hours|minutes|seconds|milliseconds))\.abs\s*\(\s*\)/g, "Math.abs(Number($1))");
  source = normalizeBaseDateDifferenceExpressions(source);
  source = normalizeBaseDateArithmeticExpressions(source);
  source = normalizeBaseEqualityExpressions(source);
  source = normalizeBaseListExpressions(source);
  source = normalizeBaseNoArgMethodExpressions(source);
  return source
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.isTruthy\s*\(\s*\)/g, "Boolean($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.isType\s*\(/g, "__isType($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.toString\s*\(\s*\)/g, "String($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.contains\s*\(/g, "__containsValue($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.containsAll\s*\(/g, "__containsAll($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.containsAny\s*\(/g, "__containsAny($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.startsWith\s*\(/g, "__startsWith($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.endsWith\s*\(/g, "__endsWith($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.split\s*\(/g, "__split($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.join\s*\(/g, "__join($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.slice\s*\(/g, "__slice($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.repeat\s*\(/g, "__repeat($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.replace\s*\(/g, "__replace($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.isEmpty\s*\(\s*\)/g, "__isEmpty($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.trim\s*\(\s*\)/g, "__trim($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.lower\s*\(\s*\)/g, "__lower($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.title\s*\(\s*\)/g, "__title($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.reverse\s*\(\s*\)/g, "__reverse($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.keys\s*\(\s*\)/g, "__keys($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.values\s*\(\s*\)/g, "__values($1)")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.round\s*\(/g, "__round($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.toFixed\s*\(/g, "__toFixed($1,")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.ceil\s*\(\s*\)/g, "Math.ceil(Number($1))")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.floor\s*\(\s*\)/g, "Math.floor(Number($1))")
    .replace(/((?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)|(?:\([^()]*\))|(?:"[^"]*")|(?:'[^']*')|(?:-?\d+(?:\.\d+)?)|(?:\{[^{}]*\}))\.abs\s*\(\s*\)/g, "Math.abs(Number($1))");
}

function normalizeBaseIfExpressions(source: string): string {
  let current = source;
  let guard = 0;
  while (guard < 50) {
    guard += 1;
    const found = findNextIfCall(current);
    if (!found) return current;
    const closeParen = findMatchingRight(current, found.openParen, "(", ")");
    if (closeParen < 0) return current;
    const args = splitTopLevelArgs(current.slice(found.openParen + 1, closeParen));
    if (args.length < 2) return current;
    const replacement = `((${args[0]}) ? (${args[1]}) : (${args[2] ?? "null"}))`;
    current = current.slice(0, found.startIndex) + replacement + current.slice(closeParen + 1);
  }
  return current;
}

function findNextIfCall(source: string): { startIndex: number; openParen: number } | undefined {
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (!source.startsWith("if", index)) continue;
    if (isIdentifierCharacter(source[index - 1]) || isIdentifierCharacter(source[index + 2])) continue;
    let cursor = index + 2;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] === "(") return { startIndex: index, openParen: cursor };
  }
  return undefined;
}

function replaceBaseThisReferences(source: string): string {
  let result = "";
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      result += char;
      if (char === "\\") {
        index += 1;
        if (index < source.length) result += source[index];
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      result += char;
      continue;
    }
    if (char === "/" && isRegexLiteralStart(source, index)) {
      const end = findRegexLiteralEnd(source, index);
      if (end >= 0) {
        result += source.slice(index, end);
        index = end - 1;
        continue;
      }
    }
    if (
      source.startsWith("this", index) &&
      !isIdentifierCharacter(source[index - 1]) &&
      !isIdentifierCharacter(source[index + 4])
    ) {
      result += "__thisFile";
      index += "this".length - 1;
      continue;
    }
    result += char;
  }
  return result;
}

function isRegexLiteralStart(source: string, slashIndex: number): boolean {
  let index = slashIndex - 1;
  while (index >= 0 && /\s/.test(source[index])) index -= 1;
  if (index < 0) return true;
  return /[([{,:;!?=<>+\-*%&|^~]/.test(source[index]);
}

function findRegexLiteralEnd(source: string, slashIndex: number): number {
  let inClass = false;
  for (let index = slashIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "]") {
      inClass = false;
      continue;
    }
    if (char === "/" && !inClass) {
      index += 1;
      while (index < source.length && /[A-Za-z]/.test(source[index])) index += 1;
      return index;
    }
    if (char === "\n") return -1;
  }
  return -1;
}

function normalizeBaseDateArithmeticExpressions(source: string): string {
  let current = source;
  let guard = 0;
  while (guard < 100) {
    guard += 1;
    const found = findNextDateDurationOperation(current);
    if (!found) return current;
    current = current.slice(0, found.leftStart) +
      `__dateAdd(${found.left}, ${found.amount})` +
      current.slice(found.rightEnd);
  }
  return current;
}

function findNextDateDurationOperation(source: string): {
  leftStart: number;
  left: string;
  amount: string;
  rightEnd: number;
} | undefined {
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char !== "+" && char !== "-") continue;
    const leftStart = findDateArithmeticLeftStart(source, index);
    if (leftStart < 0) continue;
    let rightStart = index + 1;
    while (rightStart < source.length && /\s/.test(source[rightStart])) rightStart += 1;
    const right = parseBaseDurationOperand(source, rightStart, char);
    if (!right) continue;
    return {
      leftStart,
      left: source.slice(leftStart, index).trim(),
      amount: right.amount,
      rightEnd: right.end,
    };
  }
  return undefined;
}

function findDateArithmeticLeftStart(source: string, operatorIndex: number): number {
  let index = operatorIndex - 1;
  while (index >= 0 && /\s/.test(source[index])) index -= 1;
  if (index < 0) return -1;
  if (source[index] === "\"" || source[index] === "'" || source[index] === "`") return -1;
  if (source[index] === ")" || source[index] === "]") {
    const open = findMatchingLeft(source, index, source[index] === ")" ? "(" : "[", source[index]);
    if (open < 0) return -1;
    return extendReceiverPrefix(source, open);
  }
  while (index >= 0 && /[A-Za-z0-9_$.\]]/.test(source[index])) {
    if (source[index] === "]") {
      const open = findMatchingLeft(source, index, "[", "]");
      if (open < 0) return -1;
      index = open - 1;
      continue;
    }
    index -= 1;
  }
  return index + 1;
}

function parseBaseDurationOperand(source: string, start: number, sign: "+" | "-"): { amount: string; end: number } | undefined {
  const stringDuration = parseBaseDurationStringLiteral(source, start, sign);
  if (stringDuration) return stringDuration;
  if (source.startsWith("duration", start)) {
    const open = start + "duration".length;
    if (source[open] !== "(") return undefined;
    const close = findMatchingRight(source, open, "(", ")");
    if (close < 0) return undefined;
    const expression = source.slice(start, close + 1);
    return { amount: sign === "-" ? `-(${expression})` : expression, end: close + 1 };
  }
  if (source[start] === "(") {
    const close = findMatchingRight(source, start, "(", ")");
    if (close < 0) return undefined;
    const expression = source.slice(start, close + 1);
    if (!/^\(\s*duration\(\s*["'][^"']+["']\s*\)\s*[*/]\s*-?\d+(?:\.\d+)?\s*\)$/.test(expression)) return undefined;
    return { amount: sign === "-" ? `-(${expression})` : expression, end: close + 1 };
  }
  return undefined;
}

function parseBaseDurationStringLiteral(source: string, start: number, sign: "+" | "-"): { amount: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== "\"" && quote !== "'") return undefined;
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source[index] === quote) break;
    index += 1;
  }
  if (index >= source.length) return undefined;
  const content = source.slice(start + 1, index);
  if (!/^\s*-?\d+\s*(?:y|year|years|M|month|months|d|day|days|w|week|weeks|h|hour|hours|m|minute|minutes|s|second|seconds)\s*$/.test(content)) {
    return undefined;
  }
  const raw = source.slice(start, index + 1);
  if (sign === "+") return { amount: raw, end: index + 1 };
  return { amount: raw.replace(/(["'])\s*/, "$1-"), end: index + 1 };
}

function normalizeBaseDateDifferenceExpressions(source: string): string {
  let current = source;
  let guard = 0;
  while (guard < 100) {
    guard += 1;
    const found = findNextDateDifferenceOperation(current);
    if (!found) return current;
    current = current.slice(0, found.leftStart) +
      `__durationBetween(${found.left}, ${found.right})` +
      current.slice(found.rightEnd);
  }
  return current;
}

function findNextDateDifferenceOperation(source: string): {
  leftStart: number;
  left: string;
  right: string;
  rightEnd: number;
} | undefined {
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char !== "-") continue;
    const leftStart = findDateArithmeticLeftStart(source, index);
    if (leftStart < 0) continue;
    let rightStart = index + 1;
    while (rightStart < source.length && /\s/.test(source[rightStart])) rightStart += 1;
    if (parseBaseDurationOperand(source, rightStart, "-")) continue;
    const rightEnd = findDateDifferenceRightEnd(source, rightStart);
    if (rightEnd < 0) continue;
    const left = source.slice(leftStart, index).trim();
    const right = source.slice(rightStart, rightEnd).trim();
    if (!isObviousBaseDateExpression(left) || !isObviousBaseDateExpression(right)) continue;
    return { leftStart, left, right, rightEnd };
  }
  return undefined;
}

function findDateDifferenceRightEnd(source: string, start: number): number {
  let index = start;
  let depth = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return index;
      depth -= 1;
      index += 1;
      continue;
    }
    if (depth === 0 && (char === "," || char === "?" || char === ":" || char === "+" || char === "-" || char === "*" || char === "/" || char === "%" || char === "<" || char === ">" || char === "=" || char === "!")) return index;
    if (depth === 0 && ((char === "&" && source[index + 1] === "&") || (char === "|" && source[index + 1] === "|"))) return index;
    index += 1;
  }
  return source.length;
}

function isObviousBaseDateExpression(expression: string): boolean {
  const source = stripOuterParens(expression.trim());
  if (/^(?:now|today)\s*\(\s*\)$/.test(source)) return true;
  if (/^date\s*\(/.test(source)) return true;
  if (/^(?:file|__thisFile)\.(?:ctime|created|mtime|modified)\b/.test(source)) return true;
  if (/\.date\s*\(\s*\)$/.test(source)) return true;
  return false;
}

function stripOuterParens(source: string): string {
  let current = source;
  while (current.startsWith("(") && current.endsWith(")")) {
    const close = findMatchingRight(current, 0, "(", ")");
    if (close !== current.length - 1) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

type BaseEqualityOperator = "===" | "!==" | "==" | "!=";

function normalizeBaseEqualityExpressions(source: string): string {
  let current = source;
  let guard = 0;
  while (guard < 100) {
    guard += 1;
    const found = findNextBaseEquality(current);
    if (!found) return current;
    const strict = found.operator === "===" || found.operator === "!==";
    const comparison = `${strict ? "__baseStrictEquals" : "__baseEquals"}(${found.left}, ${found.right})`;
    const replacement = found.operator === "!=" || found.operator === "!==" ? `!${comparison}` : comparison;
    current = current.slice(0, found.leftStart) + replacement + current.slice(found.rightEnd);
  }
  return current;
}

function findNextBaseEquality(source: string): {
  leftStart: number;
  left: string;
  operator: BaseEqualityOperator;
  right: string;
  rightEnd: number;
} | undefined {
  let quote: string | null = null;
  for (let index = 0; index < source.length - 1; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    const tripleOperator = source.slice(index, index + 3);
    const doubleOperator = source.slice(index, index + 2);
    const operator: BaseEqualityOperator | undefined =
      tripleOperator === "===" || tripleOperator === "!=="
        ? tripleOperator
        : doubleOperator === "==" || doubleOperator === "!="
          ? doubleOperator
          : undefined;
    if (!operator) continue;
    const before = source[index - 1] || "";
    const after = source[index + operator.length] || "";
    if (before === "=" || before === "!" || before === "<" || before === ">" || after === "=") continue;
    const leftStart = findEqualityLeftStart(source, index);
    const rightEnd = findEqualityRightEnd(source, index + operator.length);
    if (leftStart < 0 || rightEnd < 0) continue;
    const left = source.slice(leftStart, index).trim();
    const right = source.slice(index + operator.length, rightEnd).trim();
    if (!left || !right) continue;
    return { leftStart, left, operator, right, rightEnd };
  }
  return undefined;
}

function findEqualityLeftStart(source: string, operatorIndex: number): number {
  let index = operatorIndex - 1;
  let depth = 0;
  let quote: string | null = null;
  while (index >= 0) {
    const char = source[index];
    if (quote) {
      if (char === quote && !isEscaped(source, index)) quote = null;
      index -= 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      index -= 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth += 1;
      index -= 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      if (depth === 0) return char === "(" ? extendReceiverPrefix(source, index) : index;
      depth -= 1;
      index -= 1;
      continue;
    }
    if (depth === 0) {
      if (char === "," || char === "?" || char === ":") return index + 1;
      if ((char === "&" && source[index - 1] === "&") || (char === "|" && source[index - 1] === "|")) return index + 1;
    }
    index -= 1;
  }
  return 0;
}

function findEqualityRightEnd(source: string, start: number): number {
  let index = start;
  let depth = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return index;
      depth -= 1;
      index += 1;
      continue;
    }
    if (depth === 0) {
      if (char === "," || char === "?" || char === ":") return index;
      if ((char === "&" && source[index + 1] === "&") || (char === "|" && source[index + 1] === "|")) return index;
    }
    index += 1;
  }
  return source.length;
}

function validateBaseExpression(expression: string, allowInternalArrow = false): void {
  const code = maskStringLiterals(expression);
  for (const { pattern, label } of DANGEROUS_TOKENS) {
    if (pattern.test(code)) throw new Error(`Unsupported Bases expression token: ${label}`);
  }
  if (/\bfunction\b/.test(code)) throw new Error("Unsupported Bases expression token: function");
  if (!allowInternalArrow && /=>/.test(code)) throw new Error("Unsupported Bases expression token: arrow function");
}

function normalizeBaseListExpressions(source: string): string {
  let current = source;
  let guard = 0;
  while (guard < 50) {
    guard += 1;
    const found = findNextListMethod(current);
    if (!found) return current;
    const openParen = found.dotIndex + found.method.length + 1;
    const closeParen = findMatchingRight(current, openParen, "(", ")");
    if (closeParen < 0) return current;
    const receiverStart = findReceiverStart(current, found.dotIndex);
    if (receiverStart < 0) return current;
    const receiver = current.slice(receiverStart, found.dotIndex).trim();
    const args = splitTopLevelArgs(current.slice(openParen + 1, closeParen));
    let replacement: string | undefined;
    if (found.method === "map" && args.length >= 1) {
      replacement = `__listMap(${receiver}, (value, index) => (${args[0]}))`;
    } else if (found.method === "filter" && args.length >= 1) {
      replacement = `__listFilter(${receiver}, (value, index) => (${args[0]}))`;
    } else if (found.method === "reduce" && args.length >= 2) {
      replacement = `__listReduce(${receiver}, (acc, value, index) => (${args[0]}), ${args.slice(1).join(", ")})`;
    } else if (found.method === "contains" && args.length >= 1) {
      replacement = `__containsValue(${receiver}, ${args[0]})`;
    } else if (found.method === "containsAll") {
      replacement = `__containsAll(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "containsAny") {
      replacement = `__containsAny(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "round") {
      replacement = `__round(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "toFixed") {
      replacement = `__toFixed(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "startsWith") {
      replacement = `__startsWith(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "endsWith") {
      replacement = `__endsWith(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "split") {
      replacement = `__split(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "join") {
      replacement = `__join(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "slice") {
      replacement = `__slice(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "repeat") {
      replacement = `__repeat(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "replace") {
      replacement = `__replace(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    } else if (found.method === "isType") {
      replacement = `__isType(${receiver}${args.length ? `, ${args.join(", ")}` : ""})`;
    }
    if (!replacement) return current;
    current = current.slice(0, receiverStart) + replacement + current.slice(closeParen + 1);
  }
  return current;
}

function normalizeBaseNoArgMethodExpressions(source: string): string {
  let current = source;
  let guard = 0;
  while (guard < 50) {
    guard += 1;
    const found = findNextNoArgMethod(current);
    if (!found) return current;
    const openParen = found.dotIndex + found.method.length + 1;
    const closeParen = findMatchingRight(current, openParen, "(", ")");
    if (closeParen < 0) return current;
    const args = current.slice(openParen + 1, closeParen).trim();
    if (args) {
      const nextIndex = closeParen + 1;
      current = current.slice(0, nextIndex) + current.slice(nextIndex);
      continue;
    }
    const receiverStart = findReceiverStart(current, found.dotIndex);
    if (receiverStart < 0) return current;
    const receiver = current.slice(receiverStart, found.dotIndex).trim();
    const helper = getBaseNoArgMethodHelper(found.method);
    current = current.slice(0, receiverStart) + `${helper}(${receiver})` + current.slice(closeParen + 1);
  }
  return current;
}

type BaseArgMethod =
  "map" | "filter" | "reduce" |
  "contains" | "containsAll" | "containsAny" |
  "startsWith" | "endsWith" | "split" | "join" | "slice" | "repeat" | "replace" |
  "isType" |
  "round" | "toFixed";

function findNextListMethod(source: string): { dotIndex: number; method: BaseArgMethod } | undefined {
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    for (const method of [
      "containsAll",
      "containsAny",
      "startsWith",
      "endsWith",
      "toFixed",
      "contains",
      "replace",
      "isType",
      "filter",
      "reduce",
      "repeat",
      "round",
      "split",
      "slice",
      "join",
      "map",
    ] as const) {
      if (source.startsWith(`.${method}(`, index)) return { dotIndex: index, method };
    }
  }
  return undefined;
}

type BaseNoArgMethod = "flat" | "sort" | "unique" | "reverse" | "isEmpty" | "keys" | "values" | "lower" | "trim" | "title" | "abs" | "ceil" | "floor" | "isTruthy" | "toString";

function getBaseNoArgMethodHelper(method: BaseNoArgMethod): string {
  switch (method) {
    case "flat":
      return "__flat";
    case "sort":
      return "__sort";
    case "unique":
      return "__unique";
    case "reverse":
      return "__reverse";
    case "isEmpty":
      return "__isEmpty";
    case "keys":
      return "__keys";
    case "values":
      return "__values";
    case "lower":
      return "__lower";
    case "trim":
      return "__trim";
    case "title":
      return "__title";
    case "abs":
      return "__abs";
    case "ceil":
      return "__ceil";
    case "floor":
      return "__floor";
    case "isTruthy":
      return "__isTruthy";
    case "toString":
      return "__toString";
  }
}

function findNextNoArgMethod(source: string): { dotIndex: number; method: BaseNoArgMethod } | undefined {
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    for (const method of ["isTruthy", "toString", "isEmpty", "unique", "reverse", "values", "lower", "title", "trim", "floor", "ceil", "keys", "flat", "sort", "abs"] as const) {
      if (source.startsWith(`.${method}(`, index)) return { dotIndex: index, method };
    }
  }
  return undefined;
}

function findReceiverStart(source: string, dotIndex: number): number {
  let index = dotIndex - 1;
  while (index >= 0 && /\s/.test(source[index])) index -= 1;
  if (index < 0) return -1;
  if (source[index] === "\"" || source[index] === "'" || source[index] === "`") {
    const open = findStringLiteralStart(source, index);
    return open < 0 ? -1 : open;
  }
  if (source[index] === ")" || source[index] === "]") {
    const open = findMatchingLeft(source, index, source[index] === ")" ? "(" : "[", source[index]);
    if (open < 0) return -1;
    return extendReceiverPrefix(source, open);
  }
  while (index >= 0) {
    const char = source[index];
    if (char === "]" || char === ")" || char === "}") {
      const open = findMatchingLeft(
        source,
        index,
        char === ")" ? "(" : char === "]" ? "[" : "{",
        char
      );
      if (open < 0) return -1;
      index = open - 1;
      continue;
    }
    if (/[A-Za-z0-9_$.]/.test(char)) {
      index -= 1;
      continue;
    }
    break;
  }
  return index + 1;
}

function extendReceiverPrefix(source: string, start: number): number {
  let index = start - 1;
  while (index >= 0) {
    while (index >= 0 && /\s/.test(source[index])) index -= 1;
    if (index < 0) break;
    if (/[A-Za-z0-9_$.]/.test(source[index])) {
      index -= 1;
      continue;
    }
    if (source[index] === "]" || source[index] === ")" || source[index] === "}") {
      const open = findMatchingLeft(
        source,
        index,
        source[index] === ")" ? "(" : source[index] === "]" ? "[" : "{",
        source[index]
      );
      if (open < 0) return index + 1;
      index = open - 1;
      continue;
    }
    break;
  }
  return index + 1;
}

function findStringLiteralStart(source: string, closeIndex: number): number {
  const quote = source[closeIndex];
  for (let index = closeIndex - 1; index >= 0; index -= 1) {
    if (source[index] === quote && !isEscaped(source, index)) return index;
  }
  return -1;
}

function findMatchingRight(source: string, openIndex: number, left: string, right: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === left) depth += 1;
    if (char === right) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findMatchingLeft(source: string, closeIndex: number, left: string, right: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = closeIndex; index >= 0; index -= 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && !isEscaped(source, index)) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === right) depth += 1;
    if (char === left) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelArgs(source: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(source.slice(start).trim());
  return args.filter((arg) => arg.length > 0);
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function maskStringLiterals(expression: string): string {
  let result = "";
  let index = 0;
  let quote: string | null = null;
  while (index < expression.length) {
    const char = expression[index];
    if (quote) {
      if (char === "\\") {
        result += "  ";
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
        result += char;
      } else {
        result += " ";
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
    result += char;
    index += 1;
  }
  return result;
}

function createBaseContext(context: BaseExpressionContext): Record<string, unknown> {
  const properties = normalizeBasePropertyRecord(context, context.frontmatter);
  const note = createPropertyProxy(properties);
  const formulaValues = context.computedValues || evaluateFormulaValues(context);
  const file = createBaseFileValue(context, context.file, context.frontmatter);
  const thisFile = context.thisFile
    ? createBaseFileValue(context, context.thisFile, context.thisFrontmatter)
    : file;
  const vars: Record<string, unknown> = {
    Array,
    Boolean,
    Math,
    Number,
    Object,
    String,
    ...Object.fromEntries(
      Object.entries(properties)
        .filter(([key]) => isIdentifierSafe(key))
        .map(([key, value]) => [key, value])
    ),
    file,
    __thisFile: thisFile,
    note,
    properties: note,
    formula: createPropertyProxy(formulaValues),
    IF: (condition: unknown, trueValue: unknown, falseValue: unknown = null) => condition ? trueValue : falseValue,
    date: (value: unknown) => toBaseDate(value),
    duration: (value: string) => toDuration(value),
    html: (value: unknown) => safeString(value),
    image: (value: unknown) => value,
    icon: (value: string) => value,
    link: (path: unknown, display?: unknown) => createBaseLinkValue(context, path, display),
    list: (value: unknown): unknown[] => Array.isArray(value) ? value : [value],
    max: Math.max,
    min: Math.min,
    now: () => toBaseDate(Date.now()),
    number: (value: unknown) => Number(value),
    today: () => toBaseDate(moment().startOf("day")),
    random: Math.random,
    escapeHTML: (value: unknown) => safeString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;"),
    __dateAdd: (value: unknown, amount: unknown) => toBaseDate(moment(toDate(value)).add(toMomentDuration(amount))),
    __durationBetween: (left: unknown, right: unknown) => toDuration(moment.duration(toDate(left).getTime() - toDate(right).getTime())),
    __regexMatches: (pattern: RegExp, value: unknown) => {
      pattern.lastIndex = 0;
      return pattern.test(safeString(value));
    },
    __isType: (value: unknown, type: string) => {
      const normalizedType = safeString(type).trim().toLowerCase();
      if (normalizedType === "list" || normalizedType === "array") return Array.isArray(value);
      if (normalizedType === "date") return value instanceof BaseDateValue || value instanceof Date || moment.isMoment(value);
      if (normalizedType === "duration") return isBaseDurationValue(value) || moment.isDuration(value);
      if (normalizedType === "file") return isBaseFileValue(value);
      if (normalizedType === "link") return isBaseLinkValue(value);
      if (normalizedType === "null") return value == null;
      if (normalizedType === "number") return typeof value === "number" && Number.isFinite(value);
      if (normalizedType === "boolean" || normalizedType === "bool" || normalizedType === "checkbox") return typeof value === "boolean";
      if (normalizedType === "string" || normalizedType === "text") return typeof value === "string";
      return typeof value === normalizedType;
    },
    __containsAll: (value: unknown, ...needles: unknown[]) => expandNeedles(needles).every((needle) => containsValue(value, needle)),
    __containsAny: (value: unknown, ...needles: unknown[]) => expandNeedles(needles).some((needle) => containsValue(value, needle)),
    __containsValue: containsValue,
    __isTruthy: (value: unknown) => Boolean(value),
    __toString: (value: unknown) => safeString(value),
    __startsWith: (value: unknown, query: unknown) => value != null && safeString(value).startsWith(safeString(query)),
    __endsWith: (value: unknown, query: unknown) => value != null && safeString(value).endsWith(safeString(query)),
    __trim: (value: unknown) => safeString(value).trim(),
    __split: (value: unknown, separator: unknown, limit?: unknown) => safeString(value).split(safeString(separator), limit == null ? undefined : Number(limit)),
    __join: (value: unknown, separator: unknown = ",") => toList(value).map((item) => safeString(item)).join(safeString(separator)),
    __slice: (value: unknown, start?: unknown, end?: unknown) => {
      const from = start == null ? undefined : Number(start);
      const to = end == null ? undefined : Number(end);
      return Array.isArray(value) ? value.slice(from, to) : safeString(value).slice(from, to);
    },
    __repeat: (value: unknown, count: unknown) => {
      const times = Number(count);
      return safeString(value).repeat(Number.isFinite(times) ? Math.max(0, Math.floor(times)) : 0);
    },
    __baseEquals: baseValuesLooseEqual,
    __baseStrictEquals: baseValuesEqual,
    __replace: replaceBaseString,
    __isEmpty: isEmptyValue,
    __keys: (value: unknown) => value != null && typeof value === "object" ? Object.keys(value) : [],
    __values: (value: unknown) => value != null && typeof value === "object" ? Object.values(value as Record<string, unknown>) : [],
    __lower: (value: unknown) => safeString(value).toLowerCase(),
    __title: (value: unknown) => safeString(value).replace(/\b\w/g, (char) => char.toUpperCase()),
    __reverse: (value: unknown): unknown[] | string => Array.isArray(value) ? [...(value as unknown[])].reverse() : safeString(value).split("").reverse().join(""),
    __flat: (value: unknown) => toList(value).flat(),
    __sort: (value: unknown) => [...toList(value)].sort((left, right) => compareBaseValues(left, right)),
    __unique: uniqueBaseListValues,
    __listMap: (value: unknown, mapper: (value: unknown, index: number) => unknown) => toList(value).map(mapper),
    __listFilter: (value: unknown, predicate: (value: unknown, index: number) => unknown) => toList(value).filter((item, index) => !!predicate(item, index)),
    __listReduce: (value: unknown, reducer: (acc: unknown, value: unknown, index: number) => unknown, initial: unknown) => (
      toList(value).reduce((acc, item, index) => reducer(acc, item, index), initial)
    ),
    __abs: (value: unknown) => Math.abs(Number(value)),
    __ceil: (value: unknown) => Math.ceil(Number(value)),
    __floor: (value: unknown) => Math.floor(Number(value)),
    __round: (value: unknown, digits = 0) => {
      const factor = Math.pow(10, Number(digits) || 0);
      return Math.round(Number(value) * factor) / factor;
    },
    __toFixed: (value: unknown, precision = 0) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return "";
      const digits = Math.max(0, Math.min(100, Math.trunc(Number(precision) || 0)));
      return number.toFixed(digits);
    },
  };
  for (const [key, value] of Object.entries(formulaValues)) {
    if (isIdentifierSafe(key) && vars[key] === undefined) vars[key] = value;
  }
  return vars;
}

function createBaseScope(vars: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(vars, {
    has(_target, key) {
      return key !== Symbol.unscopables;
    },
    get(target, key) {
      if (key === Symbol.unscopables) return undefined;
      if (typeof key === "string" && Object.prototype.hasOwnProperty.call(target, key)) return target[key];
      return undefined;
    },
  });
}

function evaluateFormulaValues(context: BaseExpressionContext): Record<string, unknown> {
  if (!context.computedFields?.length) return {};
  const result: Record<string, unknown> = {};
  const standardDefs = context.computedFields.filter((def) => def.expressionSyntax !== "base");
  try {
    Object.assign(result, new ComputedFieldEngine(standardDefs, context.columns || []).evaluate(context.frontmatter));
  } catch {
    // Keep evaluating imported Bases formulas below.
  }
  return evaluateBaseComputedFields(context.computedFields, context, result);
}

function createPropertyProxy(source: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(source, {
    get(target, key) {
      if (typeof key === "string") return target[key];
      return undefined;
    },
  });
}

function normalizeBasePropertyRecord(context: BaseExpressionContext, source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, normalizeBasePropertyValue(context, value, key)])
  );
}

function normalizeBasePropertyValue(context: BaseExpressionContext, value: unknown, key?: string): unknown {
  if (key && isBaseDateProperty(context, key) && !isEmptyValue(value)) return toBaseDateIfValid(value);
  if (typeof value === "string" && isWikiLinkText(value)) return createBaseLinkValue(context, value);
  if (Array.isArray(value)) return value.map((item) => normalizeBasePropertyValue(context, item));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeBasePropertyValue(context, item)])
    );
  }
  return value;
}

function isBaseDateProperty(context: BaseExpressionContext, key: string): boolean {
  return context.columns?.some((column) => column.key === key && isDateLikeColumnType(column.type)) || false;
}

function isWikiLinkText(value: string): boolean {
  return /^\s*\[\[[^\]]+\]\]\s*$/.test(value);
}

type BaseFileValue = ((path: unknown) => Record<string, unknown>) & Record<string, unknown>;

function createBaseFileValue(context: BaseExpressionContext, sourceFile: TFile, frontmatter?: Record<string, unknown>): Record<string, unknown> {
  const fileFn = ((path: unknown) => {
    const resolved = resolveBaseFile(context, path);
    return resolved ? createBaseFileValue(context, resolved) : createBaseLinkValue(context, path);
  }) as unknown as BaseFileValue;
  const cache = context.app.metadataCache.getFileCache(sourceFile);
  const fm = frontmatter || (cache?.frontmatter) || {};
  const properties = normalizeBasePropertyRecord(context, fm);
  const tags = getFileTags(cache, fm);
  Object.defineProperty(fileFn, "name", {
    value: sourceFile.name,
    enumerable: true,
    configurable: true,
  });
  Object.assign(fileFn, {
    basename: sourceFile.basename,
    path: sourceFile.path,
    resolvedPath: sourceFile.path,
    folder: sourceFile.parent?.path || "",
    ext: sourceFile.extension,
    extension: sourceFile.extension,
    size: sourceFile.stat.size,
    ctime: toBaseDate(sourceFile.stat.ctime),
    created: toBaseDate(sourceFile.stat.ctime),
    mtime: toBaseDate(sourceFile.stat.mtime),
    modified: toBaseDate(sourceFile.stat.mtime),
    properties,
    file: fileFn,
    tags,
    links: getFileLinks(cache).map((link) => createBaseLinkValue(context, link, undefined, sourceFile.path)),
    backlinks: getFileBacklinks(context.app, sourceFile).map((link) => createBaseLinkValue(context, link, undefined, link)),
    embeds: getFileEmbeds(cache).map((link) => createBaseLinkValue(context, link, undefined, sourceFile.path)),
    asLink: (display?: unknown) => createBaseLinkValue(context, sourceFile.path, display || sourceFile.basename, sourceFile.path),
    hasTag: (...values: string[]) => values.some((value) => hasObsidianTagValue(tags, value)),
    inFolder: (folder: string) => isInFolder(sourceFile, folder),
    hasProperty: (name: string) => Object.prototype.hasOwnProperty.call(fm, name),
    hasLink: (target: unknown) => hasLink(context.app, sourceFile, cache, target),
  });
  return new Proxy(fileFn, {
    get(target, key, receiver): unknown {
      if (typeof key !== "string" || key in target) return Reflect.get(target, key, receiver) as unknown;
      return properties[key];
    },
    has(target, key) {
      return key in target || (typeof key === "string" && Object.prototype.hasOwnProperty.call(properties, key));
    },
    ownKeys(target) {
      return Array.from(new Set([...Reflect.ownKeys(target), ...Object.keys(properties)]));
    },
    getOwnPropertyDescriptor(target, key) {
      return Reflect.getOwnPropertyDescriptor(target, key) || (
        typeof key === "string" && Object.prototype.hasOwnProperty.call(properties, key)
          ? { configurable: true, enumerable: true, writable: false, value: properties[key] }
          : undefined
      );
    },
  });
}

function createBaseLinkValue(context: BaseExpressionContext, path: unknown, display?: unknown, sourcePath?: string): Record<string, unknown> {
  const parsed = parseLinkTarget(path);
  const rawPath = parsed.target;
  const displayText = display ?? parsed.display ?? rawPath;
  const resolved = resolveBaseFile(context, rawPath, sourcePath);
  return {
    path: rawPath,
    resolvedPath: resolved?.path,
    display: displayText,
    asFile: () => {
      return resolved ? createBaseFileValue(context, resolved) : null;
    },
    linksTo: (target: unknown) => {
      const resolved = resolveBaseFile(context, rawPath, sourcePath);
      if (!resolved) return false;
      return hasLink(context.app, resolved, context.app.metadataCache.getFileCache(resolved), target);
    },
    toString: () => safeString(displayText),
    valueOf: () => rawPath,
    [Symbol.toPrimitive]: (hint: string) => hint === "string" ? safeString(displayText) : rawPath,
  };
}

function isBaseFileValue(value: unknown): value is BaseFileValue {
  if (!value || typeof value !== "function") return false;
  const source = value as unknown as Record<string, unknown>;
  return typeof source.path === "string" && typeof source.asLink === "function";
}

function isBaseLinkValue(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return typeof source.path === "string" && typeof source.asFile === "function" && typeof source.linksTo === "function";
}

function resolveBaseFile(context: BaseExpressionContext, path: unknown, sourcePath = context.file.path): TFile | null {
  const target = getLinkTargetText(path);
  if (!target) return null;
  const vault = context.app.vault as unknown as { getAbstractFileByPath?: (path: string) => unknown };
  const direct = vault.getAbstractFileByPath?.(normalizePath(stripLinkSubpath(target)));
  if (direct instanceof TFile) return direct;
  const linked = context.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  return linked || null;
}

function getFileTags(cache: CachedMetadata | null, frontmatter: Record<string, unknown>): string[] {
  return toObsidianTagValues([
    ...toObsidianTagValues(frontmatter["tags"]),
    ...(cache ? getAllTags(cache) || [] : []),
  ]);
}

function getFileLinks(cache: CachedMetadata | null): string[] {
  const links = [
    ...(cache?.links || []).map((link) => link.link),
    ...Object.values(cache?.frontmatterLinks || {}).map((link) => link.link),
  ];
  return Array.from(new Set(links.filter(Boolean)));
}

function getFileEmbeds(cache: CachedMetadata | null): string[] {
  return Array.from(new Set((cache?.embeds || []).map((link) => link.link).filter(Boolean)));
}

function getFileBacklinks(app: App, file: TFile): string[] {
  const links = (app.metadataCache as unknown as { resolvedLinks?: Record<string, Record<string, number>> }).resolvedLinks || {};
  return Object.entries(links)
    .filter(([_source, targets]) => targets && Object.prototype.hasOwnProperty.call(targets, file.path))
    .map(([source]) => source)
    .sort();
}

function hasLink(app: App, file: TFile, cache: CachedMetadata | null, target: unknown): boolean {
  const targetText = getLinkTargetText(target);
  if (!targetText) return false;
  return getFileLinks(cache).some((link) => {
    const dest = app.metadataCache.getFirstLinkpathDest(link, file.path);
    return link === targetText ||
      normalizePath(link) === normalizePath(targetText) ||
      dest?.path === normalizePath(targetText) ||
      dest?.basename === targetText ||
      dest?.name === targetText;
  });
}

function getLinkTargetText(target: unknown): string {
  return parseLinkTarget(target).target;
}

function parseLinkTarget(target: unknown): { target: string; display?: string } {
  if (target && (typeof target === "object" || typeof target === "function")) {
    const source = target as Record<string, unknown>;
    if (typeof source.path === "string") return parseLinkTargetText(source.path);
    if (typeof source.name === "string") return parseLinkTargetText(source.name);
  }
  return parseLinkTargetText(safeString(target));
}

function parseLinkTargetText(value: string): { target: string; display?: string } {
  const trimmed = value.trim();
  const wikilink = trimmed.match(/^\[\[([\s\S]*?)\]\]$/);
  const inner = wikilink ? wikilink[1].trim() : trimmed;
  const separator = findWikiLinkAliasSeparator(inner);
  if (separator >= 0) {
    const target = inner.slice(0, separator).trim();
    const display = inner.slice(separator + 1).trim();
    return { target, display: display || undefined };
  }
  return { target: inner };
}

function findWikiLinkAliasSeparator(value: string): number {
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") return index;
  }
  return -1;
}

function stripLinkSubpath(value: string): string {
  return value.split("#", 1)[0];
}

function isInFolder(file: TFile, folder: string): boolean {
  const normalized = normalizePath(folder || "").replace(/^\/+/, "");
  if (!normalized || normalized === "/") return true;
  const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return file.path.startsWith(prefix);
}

function containsValue(value: unknown, needle: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => baseValuesEqual(item, needle));
  return safeString(value).includes(safeString(needle));
}

function replaceBaseString(value: unknown, pattern: unknown, replacement: unknown): string {
  const source = safeString(value);
  const next = safeString(replacement);
  if (pattern instanceof RegExp) return source.replace(pattern, next);
  const search = safeString(pattern);
  if (search === "") return `${next}${source.split("").join(next)}${next}`;
  return source.split(search).join(next);
}

function baseValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  const leftDate = getComparableDateTime(left);
  const rightDate = getComparableDateTime(right);
  if (leftDate != null && rightDate != null) return leftDate === rightDate;
  const leftDuration = getComparableDurationMilliseconds(left);
  const rightDuration = getComparableDurationMilliseconds(right);
  if (leftDuration != null && rightDuration != null) return leftDuration === rightDuration;
  const leftTarget = getComparableLinkTarget(left);
  const rightTarget = getComparableLinkTarget(right);
  if (leftTarget && rightTarget && linkTargetsEqual(leftTarget, rightTarget)) return true;
  return false;
}

function baseValuesLooseEqual(left: unknown, right: unknown): boolean {
  if (baseValuesEqual(left, right)) return true;
  if (getComparableLinkTarget(left) || getComparableLinkTarget(right)) return false;
  if (isDurationComparable(left) || isDurationComparable(right)) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
  }
  return safeString(left) === safeString(right);
}

function isDurationComparable(value: unknown): boolean {
  return isBaseDurationValue(value) || typeof value === "number";
}

function getComparableDateTime(value: unknown): number | undefined {
  if (!(value instanceof Date) && !(value instanceof BaseDateValue)) return undefined;
  const time = Number(value);
  return Number.isFinite(time) ? time : undefined;
}

function getComparableDurationMilliseconds(value: unknown): number | undefined {
  return isBaseDurationValue(value) && Number.isFinite(value.milliseconds) ? value.milliseconds : undefined;
}

interface ComparableLinkTarget {
  target: string;
  resolvedPath?: string;
}

function getComparableLinkTarget(value: unknown): ComparableLinkTarget | undefined {
  if (typeof value === "string") return isWikiLinkText(value) ? { target: getLinkTargetText(value) } : undefined;
  if (value && (typeof value === "object" || typeof value === "function")) {
    const source = value as Record<string, unknown>;
    if (typeof source.path === "string" || typeof source.name === "string") {
      return {
        target: getLinkTargetText(value),
        resolvedPath: typeof source.resolvedPath === "string" ? source.resolvedPath : undefined,
      };
    }
  }
  return undefined;
}

function linkTargetsEqual(left: ComparableLinkTarget, right: ComparableLinkTarget): boolean {
  const normalizeTarget = (value: string) => normalizePath(stripLinkSubpath(value)).replace(/\.md$/i, "");
  if (left.resolvedPath && right.resolvedPath) {
    return normalizeTarget(left.resolvedPath) === normalizeTarget(right.resolvedPath);
  }
  if (left.resolvedPath || right.resolvedPath) {
    const resolved = left.resolvedPath || right.resolvedPath || "";
    const unresolved = left.resolvedPath ? right.target : left.target;
    return normalizeTarget(resolved) === normalizeTarget(unresolved);
  }
  return normalizeTarget(left.target) === normalizeTarget(right.target);
}

function expandNeedles(needles: unknown[]): unknown[] {
  return needles.flatMap((needle) => Array.isArray(needle) ? (needle as unknown[]) : [needle]);
}

function toList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function uniqueBaseListValues(value: unknown): unknown[] {
  const result: unknown[] = [];
  for (const item of toList(value)) {
    if (!result.some((existing) => baseValuesEqual(existing, item))) result.push(item);
  }
  return result;
}

function compareBaseValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return safeString(left).localeCompare(safeString(right), undefined, { numeric: true });
}

function isEmptyValue(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Date || value instanceof BaseDateValue) return false;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

class BaseDateValue {
  constructor(private readonly value: Date) {}

  get year(): number { return moment(this.value).year(); }
  get month(): number { return moment(this.value).month() + 1; }
  get day(): number { return moment(this.value).date(); }
  get hour(): number { return moment(this.value).hour(); }
  get minute(): number { return moment(this.value).minute(); }
  get second(): number { return moment(this.value).second(); }
  get millisecond(): number { return moment(this.value).millisecond(); }

  date(): BaseDateValue {
    return toBaseDate(moment(this.value).startOf("day"));
  }

  format(format: string): string {
    return moment(this.value).format(format);
  }

  time(): string {
    return moment(this.value).format("HH:mm:ss");
  }

  relative(): string {
    return moment(this.value).fromNow();
  }

  isEmpty(): boolean {
    return false;
  }

  valueOf(): number {
    return this.value.getTime();
  }

  toString(): string {
    return moment(this.value).format("YYYY-MM-DD HH:mm:ss");
  }

  [Symbol.toPrimitive](hint: string): number | string {
    return hint === "string" ? this.toString() : this.valueOf();
  }
}

interface BaseDurationValue {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  valueOf(): number;
  toString(): string;
  [Symbol.toPrimitive](): number;
}

function toBaseDate(value: unknown): BaseDateValue {
  return new BaseDateValue(toDate(value));
}

function toBaseDateIfValid(value: unknown): BaseDateValue | null {
  const date = toDate(value);
  return Number.isFinite(date.getTime()) ? new BaseDateValue(date) : null;
}

function toDuration(value: unknown): BaseDurationValue {
  const duration = toMomentDuration(value);
  const milliseconds = duration.asMilliseconds();
  return {
    days: duration.asDays(),
    hours: duration.asHours(),
    minutes: duration.asMinutes(),
    seconds: duration.asSeconds(),
    milliseconds,
    valueOf: () => milliseconds,
    toString: () => String(milliseconds),
    [Symbol.toPrimitive]: () => milliseconds,
  };
}

function toMomentDuration(value: unknown): MomentDurationLike {
  if (isBaseDurationValue(value)) return moment.duration(value.milliseconds);
  if (moment.isDuration(value)) return value;
  if (typeof value === "number") return moment.duration(value);
  return parseBaseDuration(safeString(value));
}

function isBaseDurationValue(value: unknown): value is BaseDurationValue {
  return !!value &&
    typeof value === "object" &&
    typeof (value as BaseDurationValue).milliseconds === "number" &&
    typeof (value as BaseDurationValue).valueOf === "function";
}

function parseBaseDuration(value: string): MomentDurationLike {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(y|year|years|M|month|months|d|day|days|w|week|weeks|h|hour|hours|m|minute|minutes|s|second|seconds)$/);
  if (!match) return moment.duration(value);
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "y" || unit === "year" || unit === "years") return moment.duration({ years: amount });
  if (unit === "M" || unit === "month" || unit === "months") return moment.duration({ months: amount });
  if (unit === "d" || unit === "day" || unit === "days") return moment.duration({ days: amount });
  if (unit === "w" || unit === "week" || unit === "weeks") return moment.duration({ weeks: amount });
  if (unit === "h" || unit === "hour" || unit === "hours") return moment.duration({ hours: amount });
  if (unit === "m" || unit === "minute" || unit === "minutes") return moment.duration({ minutes: amount });
  return moment.duration({ seconds: amount });
}

function toDate(value: unknown): Date {
  if (value instanceof BaseDateValue) return new Date(value.valueOf());
  if (value instanceof Date) return value;
  if (moment.isMoment(value)) return value.toDate();
  const parsed = moment(value);
  return parsed.isValid() ? parsed.toDate() : new Date(safeString(value));
}

function isIdentifierSafe(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !RESERVED.has(name);
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return !!value && /[A-Za-z0-9_$]/.test(value);
}
