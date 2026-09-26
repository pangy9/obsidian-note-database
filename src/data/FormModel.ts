// 快速采集表单的核心纯模块：从视图配置 + 已合并来源规则树规划表单字段（控件映射、
// 必填/锁定/隐藏三分）、组装创建输入、双层校验（表单层即时提示 + 创建计划最终校验）。
// obsidian-free：mergedSourceRuleTree 必须由调用侧按 getCreateContextConfig 语义产出
// （db 规则 + viewSourceRulesEnabled 时的视图规则，mergeDbAndViewSourceRuleTrees）。
import type { ColumnDef, SourceRuleNode, ViewConfig } from "./types";
import { getRequiredSourceRules, getSourceRuleTypedValue } from "./SourceRules";
import { isFileFieldKey } from "./FileFields";
import { getFrontmatterWriteKey, normalizeCellValueForChange } from "./CellValueNormalize";
import { serializeRelationEditorSelection } from "./RelationItemState";

export type FormControlKind =
  | "title" | "text" | "textarea" | "number" | "rating" | "slider" | "ring"
  | "date" | "datetime" | "select" | "multiselect" | "checkbox" | "relation";

/**
 * editable = 可填写；locked = 来源规则锁定值（readonly 展示预填，值自动注入 defaults，
 * 可被隐藏）；readonly = 派生列占位（rollup「提交后自动计算」）；hidden = 不出现在表单。
 */
export type FormFieldAvailability = "editable" | "locked" | "readonly" | "hidden";

export interface FormFieldPlan {
  col: ColumnDef;
  controlKind: FormControlKind;
  availability: FormFieldAvailability;
  /** 红星必填（hasProperty / formRequiredFields）。锁定字段不需要 required——值已定。 */
  required: boolean;
  /** eq/strictEq/hasTag 的锁定预填值（写入 defaults，用户不可改）。 */
  prefilledValue?: unknown;
  /** frontmatter 写键；title 字段为 "file.name"（值走 filenameHint 通道）。 */
  writeKey: string;
  placeholderKey: string;
}

export interface FormPlan {
  fields: FormFieldPlan[];
  /** 包含被隐藏的锁定必填字段；只用于最终计划校验，不参与渲染。 */
  validationFields?: FormFieldPlan[];
  requiredKeys: string[];
  /** 用户在表单设置中勾选的必填：最终值必须非空，区别于 hasProperty 的仅要求键存在。 */
  formRequiredKeys: string[];
  /** 仅来源规则要求的字段；配置面板不能把用户额外勾选的字段误判为规则锁定。 */
  sourceRequiredKeys: string[];
  /** 存在 file.basename / file.name 的 eq/strictEq 精确文件名约束（title 字段隐藏）。 */
  hasFilenameRule: boolean;
}

export interface FormPlanInput {
  config: ViewConfig;
  /** getCreateContextConfig 语义的已合并规则树。 */
  mergedSourceRuleTree: SourceRuleNode | undefined;
  /** ColumnManager 隐藏的列键（required 字段会强制显示，不受隐藏影响）。 */
  hiddenColumnKeys: ReadonlySet<string>;
}

/** 列在表单里是否可由用户填写（锁定/只读/派生列除外）。视图配置面板的必填勾选也用它排除不可填字段。 */
export function isFormWritableColumn(col: ColumnDef): boolean {
  if (col.type === "computed" || col.type === "rollup") return false;
  if (isFileFieldKey(col.key)) return col.key === "file.name" || col.key === "file.tags";
  return true;
}

function resolveControlKind(col: ColumnDef): FormControlKind {
  if (col.key === "file.name") return "title";
  if (col.key === "file.tags") return "multiselect";
  switch (col.type) {
    case "rollup":
    case "computed":
      return "text"; // 调用方按 availability 处理（rollup readonly / computed hidden）
    case "text":
      return col.wrap === true ? "textarea" : "text";
    case "number":
      return col.numberDisplayStyle === "rating" ? "rating"
        : col.numberDisplayStyle === "progress" ? "slider"
        : col.numberDisplayStyle === "ring" ? "ring"
        : "number";
    case "currency":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "select":
    case "status":
      return "select";
    case "multi-select":
      return "multiselect";
    case "checkbox":
      return "checkbox";
    case "relation":
      return "relation";
    default:
      return "text";
  }
}

function placeholderKeyFor(kind: FormControlKind): string {
  return kind === "title" ? "form.placeholder.title"
    : kind === "textarea" ? "form.placeholder.textarea"
    : kind === "number" || kind === "rating" || kind === "slider" || kind === "ring" ? "form.placeholder.number"
    : kind === "date" ? "form.placeholder.date"
    : kind === "datetime" ? "form.placeholder.datetime"
    : kind === "select" ? "form.placeholder.select"
    : kind === "multiselect" ? "form.placeholder.multiSelect"
    : kind === "relation" ? "form.placeholder.relation"
    : "form.placeholder.text";
}

export function planFormFields(input: FormPlanInput): FormPlan {
  const { config } = input;
  // 列序与 ColumnConfig.getColumnsInOrder 同源语义（ColumnConfig 依赖运行时求值模块，
  // 这里内嵌纯版本）：无 columnOrder 用 schema 顺序，否则按序排、未知键追加尾部。
  const columns = !config.columnOrder || config.columnOrder.length === 0
    ? [...config.schema.columns]
    : (() => {
      const orderMap = new Map(config.columnOrder.map((key, index) => [key, index]));
      return [...config.schema.columns].sort((a, b) =>
        (orderMap.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.key) ?? Number.MAX_SAFE_INTEGER));
    })();

  // 必选叶子规则一遍遍历：精确文件名规则、锁定值、hasProperty 必填、hasTag 锁定 tags。
  // 来源规则用 frontmatter 键（tags），列键用 file.tags——统一规范到列键再匹配。
  const canonicalField = (field: string): string => field === "tags" ? "file.tags" : field;
  let hasFilenameRule = false;
  const lockedValues = new Map<string, unknown>();
  const requiredByRules = new Set<string>();
  for (const rule of getRequiredSourceRules(input.mergedSourceRuleTree)) {
    const field = canonicalField(rule.field || "");
    if ((field === "file.basename" || field === "file.name") && (rule.op === "eq" || rule.op === "strictEq")) {
      hasFilenameRule = true;
      continue;
    }
    if (rule.op === "hasTag") {
      // tags 锁定值：与已有锁定合并（数组去重）。
      const tag = rule.value == null ? undefined : String(rule.value).trim().replace(/^#/, "");
      if (!tag) continue;
      const existing = lockedValues.get("file.tags");
      const merged = Array.isArray(existing)
        ? Array.from(new Set([...(existing as unknown[]).map(String), tag]))
        : [tag];
      lockedValues.set("file.tags", merged);
      continue;
    }
    if (rule.op === "hasProperty") {
      if (isFormWritableColumnKey(config, field)) requiredByRules.add(field);
      continue;
    }
    if ((rule.op === "eq" || rule.op === "strictEq") && isFormWritableColumnKey(config, field)) {
      lockedValues.set(field, rule.op === "strictEq" || rule.valueType ? getSourceRuleTypedValue(rule) : rule.value);
    }
  }
  const requiredKeys = new Set<string>([...requiredByRules, ...(config.formRequiredFields || [])]);
  const sourceRequiredKeys = new Set<string>([...requiredByRules, ...lockedValues.keys()]);
  if (hasFilenameRule) sourceRequiredKeys.add("file.name");

  const fields: FormFieldPlan[] = [];
  const validationFields: FormFieldPlan[] = [];
  for (const col of columns) {
    const locked = lockedValues.has(col.key);
    let availability: FormFieldAvailability;
    if (col.type === "computed") {
      continue; // 公式列不开放：提交后自动计算，不出现在表单。
    } else if (col.type === "rollup") {
      availability = "readonly";
    } else if (locked) {
      availability = "locked";
    } else {
      availability = "editable";
    }
    const field: FormFieldPlan = {
      col,
      controlKind: resolveControlKind(col),
      availability,
      required: availability === "editable" && requiredKeys.has(col.key),
      prefilledValue: locked ? lockedValues.get(col.key) : undefined,
      writeKey: getFrontmatterWriteKey(col),
      placeholderKey: placeholderKeyFor(resolveControlKind(col)),
    };
    if (requiredKeys.has(col.key) && isFormWritableColumn(col)) validationFields.push(field);
    // 隐藏列裁剪：required 字段强制显示（用户必须能填），locked 可隐藏（值自动注入）。
    if (availability === "editable" && input.hiddenColumnKeys.has(col.key) && !requiredKeys.has(col.key)) {
      continue;
    }
    if ((availability === "locked" || availability === "readonly") && input.hiddenColumnKeys.has(col.key)) {
      continue;
    }
    if (col.key === "file.name" && hasFilenameRule) {
      continue; // 精确文件名规则：标题由规则决定，不开放填写。
    }
    if (availability === "editable" && !isFormWritableColumn(col)) {
      continue;
    }
    fields.push(field);
  }
  // 锁定字段的 hidden 处理：锁定值仍需注入 defaults——收集在 plan 之外的 lockedValues
  // 通过 fields 暴露（隐藏的锁定字段不在 fields 中，其值由 planCreateEntry 的来源规则
  // 应用链直接写入，无需表单参与）。
  return {
    fields,
    validationFields,
    requiredKeys: Array.from(requiredKeys),
    formRequiredKeys: [...(config.formRequiredFields || [])],
    sourceRequiredKeys: Array.from(sourceRequiredKeys),
    hasFilenameRule,
  };
}

function isFormWritableColumnKey(config: ViewConfig, field: string): boolean {
  if (field.startsWith("formula.")) return false;
  const col = config.schema.columns.find((candidate) => candidate.key === field);
  if (col) return isFormWritableColumn(col);
  return isFileFieldKey(field) ? field === "file.name" || field === "file.tags" : true;
}

export interface FormCreateInput {
  /** frontmatter 默认值（已规范化，含锁定预填）。 */
  defaults: Record<string, unknown>;
  /** 表单标题（file.name 字段值），交由 planCreateEntry.filenameHint 在规则约束下采用。 */
  filenameHint?: string;
}

function isEmptyFormValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && value.length === 0);
}

export function buildFormCreateInput(values: Record<string, unknown>, plan: FormPlan): FormCreateInput {
  const defaults: Record<string, unknown> = {};
  let filenameHint: string | undefined;
  for (const field of plan.fields) {
    if (field.availability === "locked" && field.prefilledValue !== undefined) {
      defaults[field.writeKey] = field.prefilledValue;
      continue;
    }
    if (field.availability !== "editable") continue;
    if (field.controlKind === "title") {
      const title = values[field.col.key];
      if (typeof title === "string" && title.trim()) filenameHint = title;
      continue;
    }
    const raw = values[field.col.key];
    if (isEmptyFormValue(raw)) continue;
    if (field.controlKind === "relation") {
      const paths = Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
      if (paths.length > 0) {
        defaults[field.writeKey] = serializeRelationEditorSelection([], new Set(paths), paths, new Map());
      }
      continue;
    }
    if (field.controlKind === "number" || field.controlKind === "rating" || field.controlKind === "slider" || field.controlKind === "ring") {
      const numeric = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(numeric)) continue;
      defaults[field.writeKey] = numeric;
      continue;
    }
    defaults[field.writeKey] = normalizeCellValueForChange(field.col, raw);
  }
  return { defaults, filenameHint };
}

/** 表单层即时提示（不阻止提交）：列出值为空的 required 字段。 */
export function validateForm(values: Record<string, unknown>, plan: FormPlan): { missing: FormFieldPlan[] } {
  const missing = plan.fields.filter((field) =>
    field.required && field.availability === "editable" && isEmptyFormValue(values[field.col.key])
  );
  return { missing };
}

/**
 * 提交唯一闸门：来源规则 hasProperty 只要求键存在；用户勾选的表单必填要求
 * 合成后的值非空。模板或非空列默认值仍可满足必填。
 */
export function validateCreatedFrontmatter(
  frontmatter: Record<string, unknown>,
  plan: FormPlan,
  filename: string
): { missing: FormFieldPlan[]; ok: boolean } {
  const missing = (plan.validationFields || plan.fields).filter((field) => {
    if (!plan.requiredKeys.includes(field.col.key)) return false;
    if (field.controlKind === "title") return !filename.trim();
    const key = field.col.key === "file.tags" ? "tags" : field.writeKey;
    if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) return true;
    return plan.formRequiredKeys.includes(field.col.key) && isEmptyFormValue(frontmatter[key]);
  });
  return { missing, ok: missing.length === 0 };
}
