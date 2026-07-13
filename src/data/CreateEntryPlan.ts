import { isDateLikeColumnType, toDateTimestamp } from "./DateTimeFormat";
import { ColumnDisplayType, getColumnDisplayType } from "./ColumnDisplay";
import {
  isObsidianAliasesKey,
  isObsidianTagsKey,
  toBooleanValue,
  toMultiSelectValuesForKey,
  toValidObsidianTagValues,
} from "./ColumnTypes";
import { isFileFieldKey } from "./FileFields";
import {
  getSourceRuleTypedValue,
  getRequiredSourceRules,
  isSourceRuleExpression,
  isSourceRuleGroup,
  isSourceRuleLeaf,
  isSourceRuleNot,
  sourceRuleValuesLooseEqual,
  sourceRuleValuesStrictEqual,
} from "./SourceRules";
import { stringifyValue } from "./Stringify";
import { ColumnDef, RecordSchema, SourceRule, SourceRuleNode, SourceRuleOperator } from "./types";

/**
 * 来源规则驱动的新建记录创建计划。
 *
 * 在真正写文件之前，把"必选来源规则 + 各创建入口的上下文默认值"统一计算成
 * 文件名、文件夹、frontmatter 和诊断。这样 table/board/gallery/list/calendar/
 * timeline/toolbar/database-file view 的所有创建入口共用同一条逻辑。
 *
 * 设计要点（见 docs/superpowers/specs/2026-07-10-source-rule-create-plan-design.md）：
 * - 只有"每个匹配结果都必须满足"的规则（单叶子、AND、单子 OR）能成为创建约束；
 *   多分支 OR、NOT、expression 不反推创建值，只进诊断。
 * - 只构造能安全、确定生成的值；不可构造的规则记录诊断，创建仍继续，但不宣称
 *   新笔记满足来源范围。
 * - 合并优先级从低到高：列默认值 < 视图筛选/状态/分组/日历入口默认值 < 来源规则。
 *   来源规则覆盖上下文默认值时记冲突诊断（用户应知道点击某分组新增后记录可能
 *   落在另一组）。
 * - tags 与 multi-select 用集合合并，来源规则不会丢失上下文已有的其它值。
 * - newRecordFolder 不再静默覆盖必选 inFolder；冲突时优先保留可满足来源规则的
 *   路径并记录诊断。
 * - 文件名恒为 createNote 安全化并自动追加序号；存在 file.basename/file.name
 *   精确约束时，序号化或非法字符会使规则失效，记诊断。
 */

export type CreateEntryDiagnosticReason =
  | "unappliedRule"
  | "conflictOverride"
  | "conflictSameField"
  | "folderConflict"
  | "filenameSuffix"
  | "filenameInvalid"
  | "filenameNormalized"
  | "filenameEmpty"
  | "unconstructable"
  | "readonlyFileField";

export interface CreateEntryDiagnostic {
  reason: CreateEntryDiagnosticReason;
  field?: string;
  op?: SourceRuleOperator;
  detail?: string;
}

export interface CreateEntryPlan {
  /** 不含路径、不含 .md 扩展名的文件名基部；交给 DataSource.createNote 安全化与追加序号。 */
  filename: string;
  /** 已规范化的目标文件夹；空串表示库根或交由调用方回退。 */
  folder: string;
  /** 最终待写入的 frontmatter。 */
  frontmatter: Record<string, unknown>;
  diagnostics: CreateEntryDiagnostic[];
  /** 是否存在 file.basename / file.name 的 eq/strictEq 精确文件名约束。 */
  hasExactFilenameRule: boolean;
}

export interface CreateEntryPlanInput {
  /** 已合并 db/view 的有效来源规则树（来自 getCreateContextConfig 的归一结果）。 */
  sourceRuleTree: SourceRuleNode | undefined;
  schema: RecordSchema;
  /** 已规范化的来源文件夹；空串表示库根。 */
  sourceFolder: string;
  /** 用户/视图配置的新记录文件夹；未设置传 undefined。 */
  newRecordFolder?: string;
  /** 无任何来源/新记录文件夹时的回退（通常是 databaseFolder）。 */
  fallbackFolder?: string;
  /** 上下文默认值：列默认 + 视图筛选/状态 + 分组 + 日历/时间线入口 defaults，已合并。 */
  contextFrontmatter: Record<string, unknown>;
  /** contextFrontmatter 中显式意图的 key（视图筛选/状态/分组/日历/用户 defaults），不含列
   *  默认空值。来源规则覆盖这些 key 记 conflictOverride；覆盖列默认空值不记（避免把分组
   *  显式传入的 false/""/[] 误判为列默认而漏报）。 */
  intentionalContextKeys: Set<string>;
  /** 无文件名规则时的默认文件名基部（通常是 i18n defaults.untitledNote）。 */
  defaultFilename: string;
  /** 文件夹规范化函数（注入以避免依赖 obsidian normalizePath）。 */
  normalizeFolder: (folder: string) => string;
}

interface RuleApplyContext {
  plan: CreateEntryPlan;
  schema: RecordSchema;
  contextFrontmatter: Record<string, unknown>;
  intentionalContextKeys: Set<string>;
  defaultFilename: string;
  normalizeFolder: (folder: string) => string;
  sourceFolder: string;
  newRecordFolder: string;
  fallbackFolder: string;
  folderCandidates: string[];
  /** field → 已写入的 eq 值（用于检测同字段多个必选 eq 冲突）。 */
  appliedEqValues: Map<string, unknown>;
  /** 负向规则必须等正向规则全部应用后再校验，避免树顺序影响最终诊断。 */
  deferredNegativeRules: SourceRule[];
}

export function planCreateEntry(input: CreateEntryPlanInput): CreateEntryPlan {
  const plan: CreateEntryPlan = {
    filename: "",
    folder: "",
    frontmatter: {},
    diagnostics: [],
    hasExactFilenameRule: false,
  };
  // 上下文默认值是最低优先级基底，先整体拷贝；来源规则在其上叠加。
  for (const [key, value] of Object.entries(input.contextFrontmatter)) {
    plan.frontmatter[key] = value;
  }

  const normalize = input.normalizeFolder;
  const ctx: RuleApplyContext = {
    plan,
    schema: input.schema,
    contextFrontmatter: input.contextFrontmatter,
    intentionalContextKeys: input.intentionalContextKeys,
    defaultFilename: input.defaultFilename,
    normalizeFolder: normalize,
    sourceFolder: normalize(input.sourceFolder || ""),
    newRecordFolder: input.newRecordFolder ? normalize(input.newRecordFolder) : "",
    fallbackFolder: input.fallbackFolder ? normalize(input.fallbackFolder) : "",
    folderCandidates: [],
    appliedEqValues: new Map(),
    deferredNegativeRules: [],
  };

  // 1. 先记录"存在但无法采纳为创建约束"的规则（多分支 OR / NOT / expression），
  //    它们不出现在 getRequiredSourceRules 中，但对用户是可见的来源约束。
  collectUnadoptedRuleDiagnostics(input.sourceRuleTree, plan.diagnostics);

  // 2. 按 stable 树遍历顺序应用每个必选叶子规则。
  for (const rule of getRequiredSourceRules(input.sourceRuleTree)) {
    applyRequiredRule(ctx, rule);
  }

  // 负向规则不负责生成值，但必须检查所有正向规则和默认值合并后的最终候选值。
  // intentionalContextKeys 只决定诊断类型，不能决定是否执行匹配检查。
  for (const rule of ctx.deferredNegativeRules) validateDeferredNegativeRule(ctx, rule);

  // 3. 决定文件夹：必选 inFolder 兼容路径优先，newRecordFolder 不静默覆盖。
  plan.folder = resolveFolder(ctx);

  // 4. 决定文件名。
  plan.filename = resolveFilename(ctx);

  return plan;
}

/** 遍历规则树，把多分支 OR、NOT、expression 记为"无法自动保证"的诊断。 */
function collectUnadoptedRuleDiagnostics(tree: SourceRuleNode | undefined, diagnostics: CreateEntryDiagnostic[]): void {
  if (!tree) return;
  if (isSourceRuleLeaf(tree)) return;
  if (isSourceRuleExpression(tree)) {
    diagnostics.push({ reason: "unappliedRule", detail: tree.expression });
    return;
  }
  if (isSourceRuleNot(tree)) {
    diagnostics.push({ reason: "unappliedRule", op: extractLeafOp(tree.rule) });
    return;
  }
  if (isSourceRuleGroup(tree)) {
    if (tree.logic === "or" && tree.rules.length > 1) {
      // 多分支 OR 不擅自选择业务分支（非目标），整体记为可能不匹配。
      diagnostics.push({ reason: "unappliedRule", detail: "multi-branch OR" });
      return;
    }
    for (const rule of tree.rules) collectUnadoptedRuleDiagnostics(rule, diagnostics);
  }
}

function extractLeafOp(node: SourceRuleNode): SourceRuleOperator | undefined {
  if (isSourceRuleLeaf(node)) return node.op;
  return undefined;
}

function applyRequiredRule(ctx: RuleApplyContext, rule: SourceRule): void {
  const { field, op } = rule;
  const plan = ctx.plan;

  if (op === "inFolder") {
    if (rule.value) ctx.folderCandidates.push(rule.value);
    return;
  }

  // hasTag 与 hasProperty 不依赖 schema 列：hasTag 恒写到 frontmatter tags；
  // hasProperty 创建空值属性即可满足"属性存在"（file.*/formula.*/computed 除外）。
  if (op === "hasTag") {
    if (!mergeTagsInto(plan, rule.value)) {
      // 无效 tag（含空格/纯数字/非法字符）被丢弃会导致笔记不匹配来源规则。
      plan.diagnostics.push({ reason: "unconstructable", field, op, detail: String(rule.value ?? "") });
    }
    return;
  }
  if (op === "hasProperty") {
    applyHasProperty(ctx, rule);
    return;
  }

  // file.* 命名空间：file.name / file.tags 可写，file.basename 影响文件名，
  // 其余只读元数据无法构造。
  if (field === "file.basename") {
    if (op === "eq" || op === "strictEq") {
      const value = rule.value == null ? "" : String(rule.value);
      if (value.trim() === "") {
        plan.diagnostics.push({ reason: "filenameEmpty", field, op });
      } else {
        setFilenameFromRule(plan, field, op, value);
        // createNote 会 trim 文件名，前后空格会使精确 basename 规则失配。
        if (value !== value.trim()) {
          plan.diagnostics.push({ reason: "filenameNormalized", field, op, detail: value });
        }
      }
    } else {
      plan.diagnostics.push({ reason: "unconstructable", field, op });
    }
    return;
  }

  if (field === "file.name") {
    if (op === "eq" || op === "strictEq") {
      const raw = rule.value == null ? "" : String(rule.value);
      if (raw.trim() === "") {
        plan.diagnostics.push({ reason: "filenameEmpty", field, op });
        return;
      }
      if (/\.md$/i.test(raw)) {
        const base = raw.replace(/\.md$/i, "");
        setFilenameFromRule(plan, field, op, base);
        // createNote 固定生成小写 .md 并 trim；规则期望值经归一化改变则精确相等失配。
        if (raw !== `${base}.md` || base !== base.trim()) {
          plan.diagnostics.push({ reason: "filenameNormalized", field, op, detail: raw });
        }
      } else {
        // Markdown 文件的 file.name 恒带 .md，不以 .md 结尾的值无法精确相等。
        plan.diagnostics.push({ reason: "readonlyFileField", field, op, detail: raw });
      }
    } else {
      plan.diagnostics.push({ reason: "unconstructable", field, op });
    }
    return;
  }

  if (field === "file.tags") {
    if (op === "strictEq") {
      // file.tags 的值是数组，而 strictEq 对任何数组恒 false（查询端），无法精确相等。
      plan.diagnostics.push({ reason: "unconstructable", field, op });
    } else if (op === "eq" || op === "contains") {
      if (!mergeTagsInto(plan, rule.value)) {
        plan.diagnostics.push({ reason: "unconstructable", field, op, detail: String(rule.value ?? "") });
      }
    } else {
      plan.diagnostics.push({ reason: "unconstructable", field, op });
    }
    return;
  }

  if (isFileFieldKey(field)) {
    // file.path / file.file / file.ctime / file.mtime / file.size / file.ext /
    // file.links / file.backlinks / file.embeds / file.properties 等只读或外部关系元数据。
    plan.diagnostics.push({ reason: "readonlyFileField", field, op });
    return;
  }

  if (field.startsWith("formula.")) {
    plan.diagnostics.push({ reason: "unconstructable", field, op });
    return;
  }

  // aliases 是内置列表属性，即使没有加入 schema，查询端也会把它归一为数组；
  // 数组对 strictEq 恒为 false，不能落入 schemaless 标量构造路径。
  if (isObsidianAliasesKey(field) && op === "strictEq") {
    plan.diagnostics.push({ reason: "unconstructable", field, op });
    return;
  }

  // 普通属性列。schema 外的 vault 属性（来源规则允许选择未加入 schema 的属性）按
  // 无类型文本处理：eq/strictEq/contains/startsWith/endsWith 仍写入，恢复对 type=book
  // 等规则的预填；其余需要类型信息的 op 记诊断。
  const col = ctx.schema.columns.find((candidate) => candidate.key === field);
  if (!col) {
    applySchemalessRule(ctx, rule);
    return;
  }
  // computed 列的值由公式求值产生，不能在创建时写入。
  if (col.type === "computed") {
    plan.diagnostics.push({ reason: "unconstructable", field, op });
    return;
  }
  const displayType = getColumnDisplayType(col, ctx.schema.computedFields);

  applyPropertyRule(ctx, rule, col, displayType);
}

function applyHasProperty(ctx: RuleApplyContext, rule: SourceRule): void {
  const plan = ctx.plan;
  const { field, op } = rule;
  if (!field || isFileFieldKey(field) || field.startsWith("formula.")) {
    if (field) plan.diagnostics.push({ reason: "unconstructable", field, op });
    return;
  }
  const col = ctx.schema.columns.find((candidate) => candidate.key === field);
  if (col?.type === "computed") {
    plan.diagnostics.push({ reason: "unconstructable", field, op });
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(plan.frontmatter, field)) {
    plan.frontmatter[field] = "";
  }
}

/** 设置精确文件名约束，检测多个文件名规则（file.basename / file.name eq）冲突。 */
function setFilenameFromRule(plan: CreateEntryPlan, field: string, op: SourceRuleOperator, value: string): void {
  if (plan.filename && plan.filename !== value) {
    plan.diagnostics.push({ reason: "conflictSameField", field, op });
  }
  plan.filename = value;
  plan.hasExactFilenameRule = true;
}

/** schema 外的 vault 属性：无类型信息，按文本写入可构造 op，其余记诊断。 */
function applySchemalessRule(ctx: RuleApplyContext, rule: SourceRule): void {
  const { field, op } = rule;
  switch (op) {
    case "eq":
    case "strictEq": {
      if (rule.value == null) return;
      const value = rule.op === "strictEq" || rule.valueType ? getSourceRuleTypedValue(rule) : rule.value;
      setScalarFromRule(ctx, field, value, op);
      return;
    }
    case "contains":
    case "startsWith":
    case "endsWith": {
      if (rule.value == null || String(rule.value) === "") return;
      setScalarFromRule(ctx, field, String(rule.value), op);
      return;
    }
    case "neq":
    case "strictNeq":
    case "empty": {
      ctx.deferredNegativeRules.push(rule);
      return;
    }
    default:
      ctx.plan.diagnostics.push({ reason: "unconstructable", field, op });
  }
}

/** compatible 中存在互不为祖先关系的文件夹时，无法同时满足多个 inFolder 必选规则。 */
function hasSiblingFolderConflict(folders: string[]): boolean {
  return folders.some((a, i) =>
    folders.some((b, j) => i !== j && a !== b && !a.startsWith(`${b}/`) && !b.startsWith(`${a}/`))
  );
}

function applyPropertyRule(
  ctx: RuleApplyContext,
  rule: SourceRule,
  col: ColumnDef,
  displayType: ColumnDisplayType
): void {
  const plan = ctx.plan;
  const { field, op } = rule;

  switch (op) {
    case "eq":
    case "strictEq": {
      if (rule.value == null) return;
      if (op === "strictEq" && (displayType === "multi-select" || isObsidianTagsKey(col.key))) {
        // 数组字段（multi-select/tags/aliases）值是数组，strictEq 对数组恒 false，不可构造。
        plan.diagnostics.push({ reason: "unconstructable", field, op });
        return;
      }
      const value = coerceValueForColumn(rule, col, displayType);
      setScalarFromRule(ctx, field, value, op);
      return;
    }
    case "contains": {
      if (rule.value == null || String(rule.value) === "") return;
      if (displayType === "multi-select" || isObsidianTagsKey(field)) {
        mergeListInto(plan, field, rule.value);
      } else {
        // 文本 contains：写入规则值即满足"包含"。
        setScalarFromRule(ctx, field, String(rule.value), op);
      }
      return;
    }
    case "startsWith":
    case "endsWith": {
      if (rule.value == null) return;
      // 写入规则值本身即可满足 startsWith/endsWith（最小满足值）。
      setScalarFromRule(ctx, field, String(rule.value), op);
      return;
    }
    case "truthy": {
      if (displayType === "checkbox") {
        setScalarFromRule(ctx, field, true, op);
      } else {
        plan.diagnostics.push({ reason: "unconstructable", field, op });
      }
      return;
    }
    case "notempty": {
      // 仅对有可靠最小非空值的类型构造；其余记诊断（不实现通用约束求解）。
      if (displayType === "checkbox") {
        setScalarFromRule(ctx, field, true, op);
      } else if (displayType === "number" || displayType === "currency") {
        setScalarFromRule(ctx, field, 0, op);
      } else {
        plan.diagnostics.push({ reason: "unconstructable", field, op });
      }
      return;
    }
    case "isType": {
      const constructed = constructForIsType(rule, col, displayType);
      if (constructed === undefined) {
        plan.diagnostics.push({ reason: "unconstructable", field, op, detail: String(rule.value ?? "") });
      } else {
        setScalarFromRule(ctx, field, constructed, op);
      }
      return;
    }
    case "gte":
    case "lte": {
      // 边界值本身即可满足 ≥/≤，写入边界值。
      if (displayType === "number" || displayType === "currency") {
        const num = Number(getSourceRuleTypedValue(rule));
        if (Number.isFinite(num)) setScalarFromRule(ctx, field, num, op);
        else plan.diagnostics.push({ reason: "unconstructable", field, op });
      } else if (isDateLikeColumnType(displayType)) {
        // 校验边界日期有效，避免写入查询阶段无法匹配的非法日期。
        if (rule.value && toDateTimestamp(rule.value) != null) {
          setScalarFromRule(ctx, field, String(rule.value), op);
        } else {
          plan.diagnostics.push({ reason: "unconstructable", field, op });
        }
      } else {
        plan.diagnostics.push({ reason: "unconstructable", field, op });
      }
      return;
    }
    case "gt":
    case "lt": {
      // 严格不等：边界值不满足，无法用单值保证。
      plan.diagnostics.push({ reason: "unconstructable", field, op });
      return;
    }
    case "neq":
    case "strictNeq":
    case "empty": {
      // 通常无需写入；延迟到全部正向规则应用后，按最终候选值和查询语义统一校验。
      ctx.deferredNegativeRules.push(rule);
      return;
    }
    case "matches":
    case "hasLink": {
      plan.diagnostics.push({ reason: "unconstructable", field, op });
      return;
    }
    case "inFolder":
      return;
  }
}

/** 把来源规则的 eq/标量值写入 frontmatter，并检测覆盖冲突与同字段冲突。 */
function setScalarFromRule(
  ctx: RuleApplyContext,
  field: string,
  value: unknown,
  op: SourceRuleOperator
): void {
  const plan = ctx.plan;

  // 同字段多个必选 eq/标量给不同值 → 无法同时精确满足。
  const prev = ctx.appliedEqValues.get(field);
  if (prev !== undefined && !valuesEqual(prev, value)) {
    plan.diagnostics.push({ reason: "conflictSameField", field, op });
  } else if (prev === undefined) {
    ctx.appliedEqValues.set(field, value);
  }

  // 来源规则覆盖"显式"上下文默认值（视图筛选/状态/分组/日历/用户 defaults）记冲突。
  // 列默认空值不在 intentionalContextKeys，被覆盖不记。不能靠值是否为空猜测来源——
  // 显式未勾选/未分类分组的 false/""/[] 同样是用户意图，被覆盖应警告。
  if (ctx.intentionalContextKeys.has(field)) {
    const ctxValue = ctx.contextFrontmatter[field];
    if (!valuesEqual(ctxValue, value)) {
      plan.diagnostics.push({ reason: "conflictOverride", field, op });
    }
  }

  plan.frontmatter[field] = value;
}

function mergeTagsInto(plan: CreateEntryPlan, value: unknown): boolean {
  const incoming = toValidObsidianTagValues(value);
  if (incoming.length === 0) return false;
  const existing = toValidObsidianTagValues(plan.frontmatter["tags"]);
  plan.frontmatter["tags"] = Array.from(new Set([...existing, ...incoming]));
  return true;
}

function mergeListInto(plan: CreateEntryPlan, field: string, value: unknown): void {
  const incoming = toMultiSelectValuesForKey(field, value);
  if (incoming.length === 0) return;
  const existing = toMultiSelectValuesForKey(field, plan.frontmatter[field]);
  const seen = new Set(existing);
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item)) {
      seen.add(item);
      merged.push(item);
    }
  }
  plan.frontmatter[field] = merged;
}

function coerceValueForColumn(rule: SourceRule, col: ColumnDef, displayType: ColumnDef["type"]): unknown {
  // strictEq 或显式 valueType：用规则声明的类型值，与查询的严格比较口径一致。
  if (rule.op === "strictEq" || rule.valueType) {
    return getSourceRuleTypedValue(rule);
  }
  if (displayType === "number" || displayType === "currency") return Number(getSourceRuleTypedValue(rule));
  if (displayType === "checkbox") return toBooleanValue(rule.value);
  if (displayType === "multi-select" || isObsidianTagsKey(col.key)) {
    // 单值 eq 落成单元素列表（contains 路径走 mergeListInto）。
    return toMultiSelectValuesForKey(col.key, rule.value);
  }
  return rule.value;
}

function constructForIsType(rule: SourceRule, col: ColumnDef, displayType: ColumnDef["type"]): unknown {
  const type = String(rule.value ?? "").trim().toLowerCase();
  if (!type) return undefined;
  if ((type === "boolean" || type === "bool" || type === "checkbox") && displayType === "checkbox") return true;
  if (type === "number" && (displayType === "number" || displayType === "currency")) return 0;
  if ((type === "string" || type === "text") && displayType === "text") return "";
  if ((type === "list" || type === "array") && (displayType === "multi-select" || isObsidianTagsKey(col.key))) {
    return [];
  }
  // date/datetime 的 isType 没有可靠的最小值（today 不保证落在期望范围），不构造。
  // 列类型与目标类型不兼容时也不构造。
  return undefined;
}

function validateDeferredNegativeRule(ctx: RuleApplyContext, rule: SourceRule): void {
  const value = getCandidateSourceValue(ctx, rule.field);
  const violates = rule.op === "empty"
    ? !isSourceRuleEmptyValue(value)
    : rule.op === "strictNeq"
      ? sourceRuleValuesStrictEqual(value, rule)
      : candidateValuesEqualForRule(value, rule);
  if (!violates) return;

  const reason: CreateEntryDiagnosticReason = ctx.appliedEqValues.has(rule.field)
    ? "conflictSameField"
    : ctx.intentionalContextKeys.has(rule.field)
      ? "conflictOverride"
      : "unconstructable";
  ctx.plan.diagnostics.push({ reason, field: rule.field, op: rule.op });
}

/** 把待写 frontmatter 投影成 DataSource 查询该字段时看到的值。 */
function getCandidateSourceValue(ctx: RuleApplyContext, field: string): unknown {
  const value = ctx.plan.frontmatter[field];
  if (isObsidianTagsKey(field)) return toValidObsidianTagValues(value).join(" ");
  if (isObsidianAliasesKey(field)) return toMultiSelectValuesForKey(field, value);
  return value;
}

/** 对齐 DataSource baseSourceValuesEqual 的 any-element、类型值和日期比较语义。 */
function candidateValuesEqualForRule(value: unknown, rule: SourceRule): boolean {
  if (Array.isArray(value)) return value.some((item) => candidateValuesEqualForRule(item, rule));
  // 对齐 DataSource.shouldCompareSourceRuleAsDate：普通 date/datetime 属性仍按字面比较，
  // 只有显式 valueType=date（file.* 日期字段不会进入该负向创建校验路径）才解析日期。
  if (rule.valueType === "date") {
    const left = toDateTimestamp(value);
    const right = toDateTimestamp(rule.value);
    if (left != null && right != null) return left === right;
  }
  if (rule.valueType) return sourceRuleValuesLooseEqual(value, rule);
  return stringifyValue(value) === stringifyValue(rule.value);
}

/** 对齐 DataSource.isBaseSourceEmptyValue；false 是有效布尔值，不是 empty。 */
function isSourceRuleEmptyValue(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Date) return !Number.isFinite(value.getTime());
  if (value && typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftArr = Array.isArray(left) ? left : [left];
    const rightArr = Array.isArray(right) ? right : [right];
    if (leftArr.length !== rightArr.length) return false;
    return leftArr.every((item, index) => stringifyValue(item) === stringifyValue(rightArr[index]));
  }
  return stringifyValue(left) === stringifyValue(right);
}

function resolveFolder(ctx: RuleApplyContext): string {
  const plan = ctx.plan;
  const sourceFolder = ctx.sourceFolder;

  // 与来源文件夹兼容的 inFolder 候选（等于或为其子目录）。
  const all = ctx.folderCandidates
    .map((folder) => ctx.normalizeFolder(folder))
    .filter((folder) => folder.length > 0);
  const compatible = all.filter(
    (folder) => !sourceFolder || folder === sourceFolder || folder.startsWith(`${sourceFolder}/`)
  );
  // 不在来源范围内的 inFolder 规则无法被查询命中，记录无法构造。
  const incompatible = all.filter((folder) => !compatible.includes(folder));
  if (incompatible.length > 0) {
    plan.diagnostics.push({ reason: "unconstructable", op: "inFolder", detail: incompatible.join(", ") });
  }
  // 兄弟目录冲突：compatible 中存在互不为祖先关系的多个文件夹时无法同时满足。
  if (compatible.length > 1 && hasSiblingFolderConflict(compatible)) {
    plan.diagnostics.push({ reason: "conflictSameField", op: "inFolder", detail: compatible.join(", ") });
  }
  const mostSpecificInFolder = compatible.reduce(
    (current, folder) => (folder.length > current.length ? folder : current),
    ""
  );

  if (mostSpecificInFolder) {
    // 必选 inFolder 存在：优先满足来源规则。newRecordFolder 兼容时取更具体者；
    // 不兼容时不再静默覆盖，保留 inFolder 路径并记录冲突。
    if (ctx.newRecordFolder) {
      if (ctx.newRecordFolder === mostSpecificInFolder || ctx.newRecordFolder.startsWith(`${mostSpecificInFolder}/`)) {
        return ctx.newRecordFolder;
      }
      plan.diagnostics.push({
        reason: "folderConflict",
        detail: `${mostSpecificInFolder} ≠ ${ctx.newRecordFolder}`,
      });
    }
    return mostSpecificInFolder;
  }

  if (ctx.newRecordFolder) return ctx.newRecordFolder;
  if (sourceFolder) return sourceFolder;
  if (ctx.fallbackFolder) return ctx.fallbackFolder;
  return "";
}

function resolveFilename(ctx: RuleApplyContext): string {
  const plan = ctx.plan;
  const raw = plan.filename.trim();
  if (!raw) {
    if (plan.hasExactFilenameRule) {
      // 空文件名规则：退回默认并记录原因。
      plan.diagnostics.push({ reason: "filenameEmpty" });
    }
    return ctx.defaultFilename;
  }
  // createNote 会做 [\\/] → "-" 安全化；精确文件名约束下记录风险。
  if (plan.hasExactFilenameRule && /[\\/]/.test(raw)) {
    plan.diagnostics.push({ reason: "filenameInvalid", detail: raw });
  }
  return raw;
}
