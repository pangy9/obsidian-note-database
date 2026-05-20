import { ColumnDef, ComputedFieldDef } from "./types";
import { t } from "../i18n";

declare const moment: any;

export interface ComputedFieldEvaluationResult {
  value: unknown;
  error?: string;
}

/**
 * Parse a date string with strict ISO_8601 first, then fallback formats.
 * This allows frontmatter dates in YYYY-MM-DD, YYYY/MM/DD, or YYYY年M月D日.
 */
function parseMoment(value: string): any {
  if (value == null) return null;
  const m = moment(value, moment.ISO_8601, true);
  if (m.isValid()) return m;
  // Fallback: try common formats
  const m2 = moment(value, ["YYYY-MM-DD", "YYYY/MM/DD", "YYYY年M月D日"]);
  return m2.isValid() ? m2 : null;
}

/**
 * Simple expression evaluator for computed fields.
 *
 * Available in expressions:
 *   today            - current date as ISO string
 *   now()            - current datetime string
 *   round(n, d)      - round number to d decimals
 *   floor(n)         - round down
 *   ceil(n)          - round up
 *   abs(n)           - absolute value
 *   max(a, b, ...)   - maximum of values
 *   min(a, b, ...)   - minimum of values
 *   sum(a, b, ...)   - sum all arguments
 *   avg(a, b, ...)   - average of all arguments
 *   days(a, b)       - signed days between date a and b (b - a)
 *   daysFromNow(d)   - days from now to date d (d - today)
 *   addMonths(d, n)  - add n months to date d
 *   addYears(d, n)   - add n years to date d
 *   year(d)          - extract year from date
 *   month(d)         - extract month (1-12)
 *   day(d)           - extract day of month
 *   if(cond, t, f)   - conditional (cond ? t : f)
 *   concat(a, b, ...)- string concatenation
 *   trim(s)          - trim whitespace from string
 *   upper(s)         - convert string to uppercase
 *   lower(s)         - convert string to lowercase
 *   proper(s)        - capitalize first letter of each word
 *   len(s)           - string length
 *   contains(s, sub) - check if string contains substring
 *   startsWith(s, p) - check if string starts with prefix
 *   endsWith(s, p)   - check if string ends with suffix
 *   replace(s, f, r) - replace all occurrences in string
 *   eomonth(d, n)    - end of month, n months from date d
 *   weekday(d)       - day of week (0=Sun, 1=Mon, ..., 6=Sat)
 *   quarter(d)       - quarter of year (1-4)
 *   weeknum(d)       - ISO week number
 *   iferror(v, fb)   - return v if valid, else fallback
 *   rand()          - random number between 0 and 1
 *   randBetween(m,n)- random integer between m and n inclusive
 *   mod(a, b)       - modulo (a % b, handles negatives properly)
 *   pow(a, b)       - a raised to power b
 *   sign(n)         - sign of number: -1, 0, or 1
 *   pi              - π constant
 *   e               - Euler's number
 *
 * Field values from the note are available as variables.
 */
export class ComputedFieldEngine {
  private defs: ComputedFieldDef[];

  constructor(defs: ComputedFieldDef[], private columns: ColumnDef[] = []) {
    this.defs = defs;
  }

  setDefinitions(defs: ComputedFieldDef[]): void {
    this.defs = defs;
  }

  /**
   * Evaluate all computed fields for a given record's frontmatter.
   */
  /** Reserved words that can't be used as variable names */
  private static RESERVED = new Set([
    "this", "true", "false", "null", "undefined", "if", "else", "for", "while",
    "do", "switch", "case", "break", "continue", "return", "throw", "try",
    "catch", "finally", "new", "delete", "typeof", "instanceof", "void",
    "class", "function", "var", "let", "const", "import", "export", "default",
  ]);

  evaluate(frontmatter: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const context = this.createContext(frontmatter);

    for (const def of this.defs) {
      const evaluated = this.evaluateExpressionDetailed(def.expression, context);
      if (evaluated.error) {
        console.warn(`ComputedField "${def.key}" evaluation failed:`, evaluated.error, `expression:`, def.expression);
        result[def.key] = null;
      } else {
        result[def.key] = evaluated.value;
        context[def.key] = evaluated.value;
      }
    }

    return result;
  }

  evaluateSingle(
    expression: string,
    frontmatter: Record<string, unknown>,
    computed: Record<string, unknown> = {}
  ): unknown {
    return this.evaluateSingleDetailed(expression, frontmatter, computed).value;
  }

  evaluateSingleDetailed(
    expression: string,
    frontmatter: Record<string, unknown>,
    computed: Record<string, unknown> = {}
  ): ComputedFieldEvaluationResult {
    const context = this.createContext(frontmatter, computed);
    return this.evaluateExpressionDetailed(expression, context);
  }

  private createContext(
    frontmatter: Record<string, unknown>,
    computed: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {
      // Spread frontmatter fields first (lower priority — built-ins override them)
      ...Object.fromEntries(
        Object.entries(frontmatter)
          .filter(([k]) => !ComputedFieldEngine.RESERVED.has(k))
          .map(([k, v]) => [k, this.coerceValue(v)])
      ),
      // Built-in functions (higher priority)
      today: moment().format("YYYY-MM-DD"),
      pi: Math.PI,
      e: Math.E,
      field: (name: string) => this.getFieldValue(context, frontmatter, computed, name),
      now: () => moment().format("YYYY-MM-DD HH:mm:ss"),
      round: (n: number, d: number) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d),
      floor: Math.floor,
      ceil: Math.ceil,
      abs: Math.abs,
      max: Math.max,
      min: Math.min,
      sum: (...args: number[]) => args.reduce((a, b) => a + (Number(b) || 0), 0),
      avg: (...args: number[]) => {
        const nums = args.map(Number).filter(n => !isNaN(n));
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      },
      rand: () => Math.random(),
      randBetween: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
      mod: (a: number, b: number) => ((a % b) + b) % b,
      pow: (a: number, b: number) => Math.pow(a, b),
      sign: (n: number) => n > 0 ? 1 : n < 0 ? -1 : 0,
      days: (a: string, b: string) => {
        if (a == null || b == null) return null;
        const mda = parseMoment(a);
        const mdb = parseMoment(b);
        if (!mda || !mdb) return null;
        // Signed difference: positive when b is after a
        return mdb.diff(mda, "days");
      },
      daysFromNow: (d: string) => {
        if (d == null) return null;
        const md = parseMoment(d);
        if (!md) return null;
        return Math.round(md.diff(moment(), "days", true));
      },
      addMonths: (d: string, n: number) => {
        if (d == null) return "";
        const md = parseMoment(d);
        if (!md) return "";
        return md.add(n, "months").format("YYYY-MM-DD");
      },
      addYears: (d: string, n: number) => {
        if (d == null) return "";
        const md = parseMoment(d);
        if (!md) return "";
        return md.add(n, "years").format("YYYY-MM-DD");
      },
      addDays: (d: string, n: number) => this.addDays(d, n),
      adddays: (d: string, n: number) => this.addDays(d, n),
      dateAdd: (date: string, amount: number, unit = "days") => this.dateAdd(date, amount, unit),
      dateadd: (date: string, amount: number, unit = "days") => this.dateAdd(date, amount, unit),
      year: (d: string) => {
        if (d == null) return null;
        const md = parseMoment(d);
        return md ? md.year() : null;
      },
      month: (d: string) => {
        if (d == null) return null;
        const md = parseMoment(d);
        return md ? md.month() + 1 : null;
      },
      day: (d: string) => {
        if (d == null) return null;
        const md = parseMoment(d);
        return md ? md.date() : null;
      },
      concat: (...args: string[]) => args.filter(a => a != null).join(""),
      // String functions
      trim: (s: unknown) => (s != null ? String(s).trim() : ""),
      upper: (s: unknown) => (s != null ? String(s).toUpperCase() : ""),
      lower: (s: unknown) => (s != null ? String(s).toLowerCase() : ""),
      proper: (s: unknown) => {
        if (s == null) return "";
        return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
      },
      len: (s: unknown) => (s != null ? String(s).length : 0),
      contains: (s: unknown, sub: unknown) => {
        if (s == null || sub == null) return false;
        return String(s).includes(String(sub));
      },
      startsWith: (s: unknown, prefix: unknown) => {
        if (s == null || prefix == null) return false;
        return String(s).startsWith(String(prefix));
      },
      endsWith: (s: unknown, suffix: unknown) => {
        if (s == null || suffix == null) return false;
        return String(s).endsWith(String(suffix));
      },
      replace: (s: unknown, find: unknown, repl: unknown) => {
        if (s == null) return "";
        if (find == null) return String(s);
        return String(s).split(String(find)).join(String(repl ?? ""));
      },
      // Date functions
      eomonth: (d: string, n: number) => {
        if (d == null) return "";
        const md = parseMoment(d);
        if (!md) return "";
        return md.add(n || 0, "months").endOf("month").format("YYYY-MM-DD");
      },
      weekday: (d: string) => {
        if (d == null) return null;
        const md = parseMoment(d);
        return md ? md.day() : null;
      },
      quarter: (d: string) => {
        if (d == null) return null;
        const md = parseMoment(d);
        return md ? md.quarter() : null;
      },
      weeknum: (d: string) => {
        if (d == null) return null;
        const md = parseMoment(d);
        return md ? md.isoWeek() : null;
      },
      // Error handling
      iferror: (value: unknown, fallback: unknown) => {
        try {
          // If the value is an Error or null/undefined from a failed computation
          if (value instanceof Error) return fallback;
          if (value === null || value === undefined) return fallback;
          if (typeof value === "number" && !Number.isFinite(value)) return fallback;
          return value;
        } catch {
          return fallback;
        }
      },
    };
    for (const [key, value] of Object.entries(computed)) {
      if (context[key] === undefined) context[key] = this.coerceValue(value);
    }

    Object.assign(context, {
      TODAY: () => context.today,
      NOW: context.now,
      ROUND: context.round,
      ROUNDUP: (n: number, d = 0) => Math.ceil(Number(n) * Math.pow(10, d)) / Math.pow(10, d),
      ROUNDDOWN: (n: number, d = 0) => Math.floor(Number(n) * Math.pow(10, d)) / Math.pow(10, d),
      INT: context.floor,
      FLOOR: context.floor,
      CEILING: context.ceil,
      ABS: context.abs,
      MAX: context.max,
      MIN: context.min,
      SUM: context.sum,
      AVERAGE: context.avg,
      AVG: context.avg,
      IF: (cond: unknown, t: unknown, f: unknown) => cond ? t : f,
      IFERROR: context.iferror,
      AND: (...args: unknown[]) => args.every(Boolean),
      OR: (...args: unknown[]) => args.some(Boolean),
      NOT: (value: unknown) => !value,
      CONCAT: context.concat,
      CONCATENATE: context.concat,
      TEXTJOIN: (delimiter: string, ignoreEmpty: boolean, ...args: unknown[]) =>
        args.filter((arg) => !ignoreEmpty || (arg != null && arg !== "")).join(delimiter),
      TEXT: (value: unknown, format: string) => this.formatText(value, format),
      VALUE: (value: unknown) => Number(value),
      LEN: context.len,
      TRIM: context.trim,
      UPPER: context.upper,
      LOWER: context.lower,
      PROPER: context.proper,
      LEFT: (value: unknown, count = 1) => String(value ?? "").slice(0, Number(count)),
      RIGHT: (value: unknown, count = 1) => String(value ?? "").slice(-Number(count)),
      MID: (value: unknown, start = 1, count = 1) =>
        String(value ?? "").slice(Number(start) - 1, Number(start) - 1 + Number(count)),
      FIND: (find: unknown, value: unknown) => String(value ?? "").indexOf(String(find ?? "")) + 1,
      SEARCH: (find: unknown, value: unknown) =>
        String(value ?? "").toLowerCase().indexOf(String(find ?? "").toLowerCase()) + 1,
      SUBSTITUTE: context.replace,
      CONTAINS: context.contains,
      STARTSWITH: context.startsWith,
      ENDSWITH: context.endsWith,
      REPLACE: context.replace,
      DATE: (year: number, month: number, day: number) =>
        moment({ year: Number(year), month: Number(month) - 1, day: Number(day) }).format("YYYY-MM-DD"),
      DATEADD: (date: string, amount: number, unit = "days") => this.dateAdd(date, amount, unit),
      ADDDAYS: (date: string, days: number) => this.addDays(date, days),
      ADD_DAYS: (date: string, days: number) => this.addDays(date, days),
      YEAR: context.year,
      MONTH: context.month,
      DAY: context.day,
      EOMONTH: context.eomonth,
      WEEKDAY: context.weekday,
      WEEKNUM: context.weeknum,
      DAYS: context.days,
      DAYSFROMNOW: context.daysFromNow,
      MOD: context.mod,
      POWER: context.pow,
      POW: context.pow,
      SIGN: context.sign,
      COUNT: (...args: unknown[]) => args.filter((arg) => typeof Number(arg) === "number" && !isNaN(Number(arg))).length,
      COUNTA: (...args: unknown[]) => args.filter((arg) => arg != null && arg !== "").length,
      COUNTIF: (values: unknown, criterion: unknown) => this.countIf(values, criterion),
    });
    return context;
  }

  private isIdentifierSafe(name: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) &&
           !ComputedFieldEngine.RESERVED.has(name);
  }

  private evaluateExpressionDetailed(
    expr: string,
    context: Record<string, unknown>
  ): ComputedFieldEvaluationResult {
    const normalizedExpr = this.normalizeFormula(expr);
    if (!normalizedExpr) return { value: null, error: t("formula.error.empty") };
    // Only use safe identifiers as function parameters
    const varNames = Object.keys(context).filter((k) => this.isIdentifierSafe(k));
    const varValues = varNames.map((k) => context[k]);

    let expressionError: unknown;
    try {
      const fn = new Function(...varNames, `return (${normalizedExpr});`);
      const result = fn(...varValues);
      return { value: result };
    } catch (err) {
      expressionError = err;
      // Try as statement (for expressions like `if(...)`)
      try {
        const fn = new Function(...varNames, `${normalizedExpr}`);
        return { value: fn(...varValues) };
      } catch (statementErr) {
        return { value: null, error: this.formatEvaluationError(statementErr || expressionError) };
      }
    }
  }

  private formatEvaluationError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || "");
    const errorName = error instanceof Error ? error.constructor.name : "";

    // Undefined variable/field
    const ref = message.match(/^([A-Za-z_$][A-Za-z0-9_$]*) is not defined$/);
    if (ref) return t("formula.error.undefinedVar", { name: ref[1] });

    // Syntax errors
    if (error instanceof SyntaxError || errorName === "SyntaxError") {
      if (message.includes("Unexpected end")) return t("formula.error.unexpectedEnd");
      if (message.includes("Unexpected token")) return t("formula.error.unexpectedToken", { message });
      return t("formula.error.incomplete");
    }

    // Type errors (e.g. calling non-function, wrong operand type)
    if (errorName === "TypeError") {
      if (message.includes("is not a function")) {
        const fnMatch = message.match(/([A-Za-z_$][A-Za-z0-9_$]*) is not a function/);
        if (fnMatch) return t("formula.error.notFunction", { name: fnMatch[1] });
      }
      if (message.includes("Cannot read propert")) {
        return t("formula.error.nullProperty");
      }
      if (message.includes("is not iterable")) return t("formula.error.notIterable");
      return t("formula.error.typeError", { message });
    }

    // Range errors
    if (errorName === "RangeError") {
      if (message.includes("Invalid date")) return t("formula.error.invalidDate");
      return t("formula.error.rangeError", { message });
    }

    if (message) return t("formula.error.generic", { message });
    return t("formula.error.genericShort");
  }

  private normalizeFormula(expr: string): string {
    let formula = expr.trim();
    if (formula.startsWith("=")) formula = formula.slice(1).trim();
    return formula.replace(/\[([^\]]+)\]/g, (_match, name: string) =>
      `field(${JSON.stringify(String(name).trim())})`
    );
  }

  private getFieldValue(
    context: Record<string, unknown>,
    frontmatter: Record<string, unknown>,
    computed: Record<string, unknown>,
    name: string
  ): unknown {
    const key = String(name).trim();
    const column = this.columns.find((col) => col.label === key || col.key === key);
    if (column) {
      if (Object.prototype.hasOwnProperty.call(frontmatter, column.key)) {
        return this.coerceValue(frontmatter[column.key]);
      }
      if (column.computedKey && Object.prototype.hasOwnProperty.call(computed, column.computedKey)) {
        return this.coerceValue(computed[column.computedKey]);
      }
      if (Object.prototype.hasOwnProperty.call(computed, column.key)) {
        return this.coerceValue(computed[column.key]);
      }
    }
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) return this.coerceValue(frontmatter[key]);
    if (Object.prototype.hasOwnProperty.call(computed, key)) return this.coerceValue(computed[key]);
    const direct = context[key];
    if (direct !== undefined) return this.coerceValue(direct);
    return undefined;
  }

  private coerceValue(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text) return "";
    const numeric = text.replace(/[,¥￥$\s]/g, "");
    if (/^[+-]?\d+(?:\.\d+)?$/.test(numeric)) return Number(numeric);
    return value;
  }

  private addDays(date: string, days: number): string {
    if (date == null) return "";
    const md = parseMoment(date);
    if (!md) return "";
    return md.add(Number(days) || 0, "days").format("YYYY-MM-DD");
  }

  private dateAdd(date: string, amount: number, unit: unknown): string {
    if (date == null) return "";
    const md = parseMoment(date);
    if (!md) return "";
    const normalizedUnit = String(unit || "days").toLowerCase();
    const safeUnit = normalizedUnit.startsWith("month")
      ? "months"
      : normalizedUnit.startsWith("year")
        ? "years"
        : normalizedUnit.startsWith("week")
          ? "weeks"
          : "days";
    return md.add(Number(amount) || 0, safeUnit).format("YYYY-MM-DD");
  }

  private formatText(value: unknown, format: string): string {
    if (value == null) return "";
    const md = typeof value === "string" ? parseMoment(value) : null;
    if (md && /[YMDHms]/.test(format)) return md.format(format);
    const num = Number(value);
    if (!isNaN(num) && /^0(?:\.0+)?$/.test(format)) {
      const decimals = format.includes(".") ? format.split(".")[1].length : 0;
      return num.toFixed(decimals);
    }
    return String(value);
  }

  private countIf(values: unknown, criterion: unknown): number {
    const items = Array.isArray(values) ? values : [values];
    const rule = String(criterion ?? "");
    return items.filter((item) => this.matchesCriterion(item, rule)).length;
  }

  private matchesCriterion(value: unknown, criterion: string): boolean {
    const text = String(value ?? "");
    const num = Number(value);
    const match = criterion.match(/^(>=|<=|<>|>|<|=)(.*)$/);
    if (!match) return text === criterion;
    const [, op, raw] = match;
    const compareText = raw.trim();
    const compareNum = Number(compareText);
    const useNumber = !isNaN(num) && !isNaN(compareNum);
    const left = useNumber ? num : text;
    const right = useNumber ? compareNum : compareText;
    if (op === ">") return left > right;
    if (op === "<") return left < right;
    if (op === ">=") return left >= right;
    if (op === "<=") return left <= right;
    if (op === "<>") return left !== right;
    return left === right;
  }
}
