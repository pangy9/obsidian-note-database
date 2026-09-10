/**
 * R2-CO-1 rename 事务 plan builder（obsidian-free 纯逻辑）。
 *
 * 生产层只收集「输入事实」（RenamePlanInput：请求参数、列 facts、primary/external
 * typedBefore + rawBefore、records 的候选 key 快照）；本 builder 负责所有决策与计算：
 * 迁移模式、frontmatter changes、config 引用更新、raw CAS payload、migration 统计。
 *
 * 不导入 DataSource/TFile/Notice；不修改任何输入（在深克隆上更新）；sourceRuleTree、
 * recordIcon、config serializer 经 deps 显式注入（这三者所在模块耦合 obsidian）。
 *
 * B1.3a：类型 + 迁移 mode 决策 + frontmatter plan 生成 + 输入验证。
 * B1.3b：config 引用更新（applyRenameToConfig）+ buildRenamePlan 组装 + raw after + stats。
 */
import type { ColumnDef, DatabaseConfig } from "./types";
import type { DatabaseViewState } from "../views/ViewStateStore";
import { createRenameHistoryPayload, executeRenameTransaction } from "./RenameTransaction";
import type {
  ConfigWriteStep,
  FrontmatterChange,
  FrontmatterKeySnapshot,
  FrontmatterWriteStep,
  RenameHistoryPayload,
  RenamePlan,
  TransactionFailure,
  TransactionWriter,
} from "./RenameTransaction";
import { updateColumnKeyReferences, updateSourceRuleKeyReferences, updateSummaryFormulaReferences } from "./ColumnKeyReferences";
import { cloneFrontmatterValue } from "./FrontmatterOverride";

// ─── 输入类型 ────────────────────────────────────────────────────────────

/** 单条记录：仅含事务可能涉及的候选 key 快照（oldKey/newKey 或 old/newComputedKey）。 */
export interface RenameRecordInput {
  path: string;
  values: Record<string, FrontmatterKeySnapshot>;
}

export interface RenameRequest {
  oldKey: string;
  oldLabel: string;
  newKey: string;
  newLabel: string;
  wrap?: boolean;
  migrateValues: boolean;
  renameSavedComputedProperty: boolean;
}

/** 列事实（输入），迁移模式由 builder 据 facts+request 决定，收集层不直接生成 writes。 */
export interface RenameFacts {
  columnType: ColumnDef["type"];
  oldComputedKey: string;
  newComputedKey: string;
  oldIsFileField: boolean;
  newIsFileField: boolean;
  displayOnlyComputed: boolean;
}

export interface RenamePrimaryInput {
  path: string;
  typedBefore: DatabaseConfig;
  rawBefore: unknown;
  activeViewId: string;
  stateBefore: DatabaseViewState;
  /** 生产 writer 的 peer notify 上下文；纯 builder 仅透传并快照。 */
  mutation?: unknown;
}

export interface RenameExternalConfigInput {
  path: string;
  typedBefore: DatabaseConfig;
  rawBefore: unknown;
  mutation?: unknown;
}

export interface RenamePlanInput {
  request: RenameRequest;
  facts: RenameFacts;
  primary: RenamePrimaryInput;
  records: RenameRecordInput[];
  externalConfigs: RenameExternalConfigInput[];
}

/** builder 注入依赖（规避 obsidian 耦合）。 */
export interface RenamePlanBuilderDeps {
  /** sourceRuleTree 引用更新（SourceRules.ts 耦合 obsidian）。 */
  updateSourceRuleTree: (tree: unknown, oldKey: string, newKey: string) => boolean;
  /** recordIcon 字段引用更新（RecordIcon.ts）。 */
  updateRecordIcon: (db: DatabaseConfig, oldKey: string, newKey: string) => boolean;
  /** 确定性纯 serializer：typed config → raw database payload（生产 dataSource.toDatabasePayload）。 */
  serializeConfig: (config: DatabaseConfig) => unknown;
  /** file field 固定类型解析（FileFields.ts 耦合，转 file field 时用）。 */
  getFileFieldFixedType: (key: string) => ColumnDef["type"];
}

export type FrontmatterMigrationMode = "rename" | "delete-old" | "rename-computed" | "none";

// ─── 迁移模式决策（对齐 renameColumn 147-180 的实际写入分支）─────────────────

/**
 * 决定 frontmatter 迁移模式。对应 renameColumn：
 *   - convertingToFileField && !isComputed → 删 oldKey（propertySync.delete）
 *   - computed saved property rename → oldComputedKey→newComputedKey（force）
 *   - migrateValues → oldKey→newKey（迁移值）
 *   - migrateValues=false && oldKey!==newKey → 删 oldKey
 *   - rollup / display-only computed / 纯 label / file field → 不迁移
 */
export function decideFrontmatterMigrationMode(
  facts: RenameFacts,
  request: RenameRequest
): FrontmatterMigrationMode {
  const isComputed = facts.columnType === "computed";
  const isRollup = facts.columnType === "rollup";
  const convertingToFileField = !facts.oldIsFileField && facts.newIsFileField;
  const useFrontmatterMigration = !facts.oldIsFileField && !facts.newIsFileField && !isRollup;
  if (convertingToFileField && !isComputed) return "delete-old";
  if (useFrontmatterMigration && isComputed && !facts.displayOnlyComputed
    && request.renameSavedComputedProperty && facts.oldComputedKey !== facts.newComputedKey) {
    return "rename-computed";
  }
  if (useFrontmatterMigration && !isComputed && request.migrateValues && request.oldKey !== request.newKey) return "rename";
  if (useFrontmatterMigration && !isComputed && request.oldKey !== request.newKey) return "delete-old";
  return "none";
}

/** 各模式需要的候选 key。 */
export function requiredCandidateKeys(
  mode: FrontmatterMigrationMode,
  request: RenameRequest,
  facts: RenameFacts
): string[] {
  if (mode === "rename") return [request.oldKey, request.newKey];
  if (mode === "delete-old") return [request.oldKey];
  if (mode === "rename-computed") return [facts.oldComputedKey, facts.newComputedKey];
  return [];
}

// ─── frontmatter plan 生成 ────────────────────────────────────────────────

/** 单 record → 该模式下的逐 key change（before=候选快照，write=决策操作）。 */
export function buildRecordChanges(
  record: RenameRecordInput,
  mode: FrontmatterMigrationMode,
  request: RenameRequest,
  facts: RenameFacts
): Record<string, FrontmatterChange> | null {
  const requireKey = (key: string): FrontmatterKeySnapshot => {
    const snap = record.values[key];
    if (!snap) throw new Error(`rename plan: record ${record.path} missing candidate key '${key}'`);
    return snap;
  };
  if (mode === "rename") {
    const oldSnap = requireKey(request.oldKey);
    const newSnap = requireKey(request.newKey);
    // 对齐 PropertyService.renameKey/getRenameKeyChanges：源 key 不存在的记录不写入。
    if (!oldSnap.exists) return null;
    return {
      [request.oldKey]: { before: cloneValue(oldSnap), write: { kind: "delete" } },
      [request.newKey]: { before: cloneValue(newSnap), write: { kind: "set", value: cloneValue(oldSnap.value) } },
    };
  }
  if (mode === "delete-old") {
    const oldSnap = requireKey(request.oldKey);
    if (!oldSnap.exists) return null;
    return { [request.oldKey]: { before: cloneValue(oldSnap), write: { kind: "delete" } } };
  }
  if (mode === "rename-computed") {
    const oldSnap = requireKey(facts.oldComputedKey);
    const newSnap = requireKey(facts.newComputedKey);
    if (!oldSnap.exists) return null;
    return {
      [facts.oldComputedKey]: { before: cloneValue(oldSnap), write: { kind: "delete" } },
      [facts.newComputedKey]: { before: cloneValue(newSnap), write: { kind: "set", value: cloneValue(oldSnap.value) } },
    };
  }
  throw new Error(`rename plan: mode ${mode} produces no frontmatter changes`);
}

/** 由 records + mode 生成 frontmatter plan。mode=none → 空数组（无 frontmatter 写入）。 */
export function buildFrontmatterPlan(
  records: RenameRecordInput[],
  mode: FrontmatterMigrationMode,
  request: RenameRequest,
  facts: RenameFacts
): FrontmatterWriteStep[] {
  if (mode === "none") return [];
  const steps: FrontmatterWriteStep[] = [];
  for (const record of records) {
    const changes = buildRecordChanges(record, mode, request, facts);
    if (!changes) continue;
    steps.push({ path: record.path, changes });
  }
  return steps;
}

// ─── 输入验证 ────────────────────────────────────────────────────────────

/** 验证 primary/external/record path 全局唯一 + 各 record 候选 key 齐全。 */
export function validateRenamePlanInput(input: RenamePlanInput): Error | null {
  if (!input.request.newKey) return new Error("rename plan: new key is required");
  const targetColumns = input.primary.typedBefore.schema.columns.filter((column) => column.key === input.request.oldKey);
  if (targetColumns.length === 0) return new Error(`rename plan: target column '${input.request.oldKey}' not found`);
  if (input.request.oldKey !== input.request.newKey && input.primary.typedBefore.schema.columns.some((column) => column.key === input.request.newKey)) {
    return new Error(`rename plan: target key '${input.request.newKey}' already exists`);
  }
  if (!input.primary.typedBefore.views.some((view) => view.id === input.primary.activeViewId)) {
    return new Error(`rename plan: active view '${input.primary.activeViewId}' not found`);
  }
  const paths = new Set<string>();
  const checkPath = (path: string, label: string): Error | null => {
    if (paths.has(path)) return new Error(`rename plan: duplicate path '${path}' (${label})`);
    paths.add(path);
    return null;
  };
  let err = checkPath(input.primary.path, "primary");
  if (err) return err;
  for (const ec of input.externalConfigs) {
    err = checkPath(ec.path, "external");
    if (err) return err;
  }
  const mode = decideFrontmatterMigrationMode(input.facts, input.request);
  const required = requiredCandidateKeys(mode, input.request, input.facts);
  for (const record of input.records) {
    err = checkPath(record.path, "record");
    if (err) return err;
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(record.values, key)) {
        return new Error(`rename plan: record '${record.path}' missing candidate key '${key}'`);
      }
    }
  }
  return null;
}

// ─── B1.3b：config 引用更新 + plan 组装 ──────────────────────────────────

export interface RenamePlanResult {
  plan: RenamePlan;
  /** 成功后同步回活动 ViewStateStore 的状态快照。 */
  stateAfter: DatabaseViewState;
  /** migration 统计（基于实际产生 frontmatter step 的 record 数；B1.5 Notice 用）。 */
  stats: { moved: number; deleted: number };
}

/** 显式克隆 DatabaseViewState：hiddenColumns 是 Set、filters/sortRules 是 rule 数组，
 *  不能用 JSON 深拷贝（Set 会丢失）。rule 浅克隆即可（builder 只改顶层 field）。 */
function cloneViewState(state: DatabaseViewState): DatabaseViewState {
  const cloneRules = <R>(rules: R[] | undefined): R[] =>
    rules ? rules.map((r) => ({ ...r })) : [];
  return {
    ...state,
    filters: cloneRules(state.filters),
    hiddenColumns: new Set(state.hiddenColumns),
    sortRules: cloneRules(state.sortRules),
  };
}

/** 深克隆 DatabaseConfig（纯数据，无 Set；JSON 往返足够）。 */
function cloneDatabaseConfig(config: DatabaseConfig): DatabaseConfig {
  return JSON.parse(JSON.stringify(config)) as DatabaseConfig;
}

/** YAML/config 兼容纯数据深拷贝。 */
function cloneValue<T>(value: T): T {
  return cloneFrontmatterValue(value) as T;
}

function normalizeComputedKey(key: string): string {
  return key.startsWith("formula.") ? key.slice("formula.".length) : key;
}

/** 对齐 ensureColumnOrder：只在活动 view 上补齐/规范化顺序。 */
function ensureViewColumnOrder(view: DatabaseConfig["views"][number]): void {
  const validKeys = new Set(view.schema.columns.map((column) => column.key));
  if (!view.columnOrder?.length) {
    view.columnOrder = view.schema.columns.map((column) => column.key);
    return;
  }
  const normalized = view.columnOrder.filter((key, index, keys) => validKeys.has(key) && keys.indexOf(key) === index);
  for (const column of view.schema.columns) {
    if (!normalized.includes(column.key)) normalized.push(column.key);
  }
  view.columnOrder = normalized;
}

/** 对齐 ViewStateStore.persist，但保持 builder obsidian-free。 */
function persistViewState(view: DatabaseConfig["views"][number], state: DatabaseViewState): void {
  const hiddenColumns = Array.from(state.hiddenColumns);
  const persisted = {
    hiddenColumns: hiddenColumns.length > 0 ? hiddenColumns : undefined,
    statusFilter: state.statusFilter || undefined,
    groupByField: state.groupByField || undefined,
    filterLogic: state.filterLogic === "or" ? "or" as const : undefined,
    filters: state.filters.length > 0 ? state.filters.map((rule) => ({ ...rule })) : undefined,
    sortColumn: state.sortColumn || undefined,
    sortDirection: state.sortColumn ? state.sortDirection : undefined,
    sortRules: state.sortRules.length > 0 ? state.sortRules.map((rule) => ({ ...rule })) : undefined,
  };
  view.viewStates = { ...(view.viewStates || {}) };
  view.viewStates[view.viewType || "table"] = persisted;
  view.hiddenColumns = persisted.hiddenColumns;
  view.statusFilter = persisted.statusFilter;
  view.groupByField = persisted.groupByField;
  view.filterLogic = persisted.filterLogic;
  view.filters = persisted.filters;
  view.sortColumn = persisted.sortColumn;
  view.sortDirection = persisted.sortDirection;
  view.sortRules = persisted.sortRules;
}

/**
 * 在 typedBefore 的深克隆上应用 rename 的全部引用更新（复现 renameColumn 182-243），
 * 返回 typedAfter。不修改 typedBefore。schema 在 clone 后重新共享（views.schema → db.schema）。
 */
function applyRenameToConfig(
  before: DatabaseConfig,
  input: RenamePlanInput,
  deps: RenamePlanBuilderDeps
): { config: DatabaseConfig; state: DatabaseViewState } {
  const db = cloneDatabaseConfig(before);
  if (db.views) for (const v of db.views) v.schema = db.schema;
  const { request, facts } = input;
  const oldKey = request.oldKey;
  const newKey = request.newKey;
  const oldLabel = request.oldLabel;
  const newLabel = request.newLabel;
  const targetCol = db.schema.columns.find((c) =>
    c.key === oldKey &&
    c.type === facts.columnType &&
    (c.label || c.key) === (oldLabel || oldKey) &&
    (c.type !== "computed" || (c.computedKey || c.key) === facts.oldComputedKey)
  ) || db.schema.columns.find((c) => c.key === oldKey);
  const stateClone = cloneViewState(input.primary.stateBefore);
  const activeView = db.views.find((view) => view.id === input.primary.activeViewId);
  if (!targetCol) throw new Error(`rename plan: target column '${oldKey}' not found`);
  if (!activeView) throw new Error(`rename plan: active view '${input.primary.activeViewId}' not found`);
  ensureViewColumnOrder(activeView);

  // 跨 views 引用更新（活动 view 传 state；含 computed/sourceRules/sourceRuleTree via deps）
  for (const view of db.views || []) {
    const isActive = view.id === input.primary.activeViewId;
    const changed = updateColumnKeyReferences(view, isActive ? stateClone : undefined, oldKey, newKey, {
      updateSourceRuleTree: deps.updateSourceRuleTree,
    }, oldLabel, newLabel);
    if (isActive && changed) persistViewState(view, stateClone);
  }
  // db 级 sourceRules / sourceRuleTree（updateColumnKeyReferences 处理 view.sourceRules/sourceRuleTree）
  updateSourceRuleKeyReferences(db.sourceRules, oldKey, newKey);
  if (db.sourceRuleTree) deps.updateSourceRuleTree(db.sourceRuleTree, oldKey, newKey);
  deps.updateRecordIcon(db, oldKey, newKey);
  updateSummaryFormulaReferences(db, oldKey, newKey, oldLabel, newLabel);
  // conditionalFormats
  for (const view of db.views || []) {
    for (const rule of view.conditionalFormats || []) {
      if (rule.condition?.field === oldKey) rule.condition.field = newKey;
    }
  }
  // rollup relationField / targetField（本库 schema，仅 targetDatabaseId===db.id 的本库关系）
  for (const candidate of db.schema.columns) {
    if (candidate.rollupConfig?.relationField === oldKey) candidate.rollupConfig.relationField = newKey;
    if (candidate.type === "rollup" && candidate.rollupConfig?.targetField === oldKey) {
      const relCol = db.schema.columns.find((c) => c.key === candidate.rollupConfig?.relationField);
      if (relCol?.relationConfig?.targetDatabaseId === db.id) {
        candidate.rollupConfig.targetField = newKey;
      }
    }
  }
  // 对齐 removeDuplicateSchemaColumns：保留目标列，移除其他同 oldKey 的陈旧副本。
  db.schema.columns = db.schema.columns.filter((candidate) => candidate === targetCol || candidate.key !== oldKey);
  targetCol.key = newKey;
  targetCol.label = newLabel;
  targetCol.wrap = request.wrap || undefined;
  if (facts.newIsFileField) {
    targetCol.type = deps.getFileFieldFixedType(newKey);
    targetCol.statusOptions = undefined;
    targetCol.statusPresetId = undefined;
  }
  if (targetCol.type === "computed") {
    const oldStorageKey = normalizeComputedKey(facts.oldComputedKey);
    const computedMatches = (db.schema.computedFields || []).filter((field) =>
      normalizeComputedKey(field.key) === oldStorageKey
    );
    if (computedMatches.length !== 1) {
      throw new Error(
        computedMatches.length === 0
          ? `rename plan: computed definition '${facts.oldComputedKey}' not found`
          : `rename plan: multiple computed definitions match '${facts.oldComputedKey}'`
      );
    }
    const computed = computedMatches[0];
    computed.key = normalizeComputedKey(facts.newComputedKey);
    computed.label = newLabel;
    targetCol.computedKey = facts.newComputedKey;
  }
  for (const view of db.views) view.schema = db.schema;
  // ensureColumnOrder 在 rename 前可能从含陈旧重复列的 schema 生成重复 oldKey；
  // 目标列改名并清理副本后再规范化一次活动 view，避免得到重复 newKey。
  ensureViewColumnOrder(activeView);
  return { config: db, state: stateClone };
}

/** 外部数据库 config：仅更新引用本库 oldKey 的 rollup targetField（跨库 rollup）。 */
function applyRollupToExternal(before: DatabaseConfig, input: RenamePlanInput): { config: DatabaseConfig; changed: boolean } {
  const db = cloneDatabaseConfig(before);
  if (db.views) for (const v of db.views) v.schema = db.schema;
  const oldKey = input.request.oldKey;
  const newKey = input.request.newKey;
  const targetDatabaseId = input.primary.typedBefore.id;
  const relationKeys = new Set(
    db.schema.columns
      .filter((column) => column.type === "relation" && column.relationConfig?.targetDatabaseId === targetDatabaseId)
      .map((column) => column.key)
  );
  let changed = false;
  for (const candidate of db.schema.columns) {
    if (candidate.type !== "rollup" || candidate.rollupConfig?.targetField !== oldKey) continue;
    if (!relationKeys.has(candidate.rollupConfig.relationField)) continue;
    candidate.rollupConfig.targetField = newKey;
    changed = true;
  }
  return { config: db, changed };
}

/** migration 统计：rename/rename-computed → moved；delete-old → deleted；none → 0。 */
function computeMigrationStats(frontmatter: FrontmatterWriteStep[], mode: FrontmatterMigrationMode): { moved: number; deleted: number } {
  if (mode === "rename" || mode === "rename-computed") return { moved: frontmatter.length, deleted: 0 };
  if (mode === "delete-old") return { moved: 0, deleted: frontmatter.length };
  return { moved: 0, deleted: 0 };
}

/**
 * 构建 rename 事务 plan（obsidian-free，不修改输入）。
 * 输入验证失败抛错；成功返回 { plan, stats }。
 * primary/external 的 casAfter = deps.serializeConfig(typedAfter)（注入确定性纯 serializer）。
 */
export function buildRenamePlan(
  input: RenamePlanInput,
  deps: RenamePlanBuilderDeps,
  undoLabel = ""
): RenamePlanResult {
  const err = validateRenamePlanInput(input);
  if (err) throw err;
  const mode = decideFrontmatterMigrationMode(input.facts, input.request);
  const frontmatter = buildFrontmatterPlan(input.records, mode, input.request, input.facts);
  const appliedPrimary = applyRenameToConfig(input.primary.typedBefore, input, deps);
  const primaryAfter = appliedPrimary.config;
  const primaryConfig: ConfigWriteStep = {
    path: input.primary.path,
    before: cloneDatabaseConfig(input.primary.typedBefore),
    after: primaryAfter,
    casBefore: cloneValue(input.primary.rawBefore),
    casAfter: cloneValue(deps.serializeConfig(primaryAfter)),
    mutation: cloneValue(input.primary.mutation),
  };
  const externalConfigs: ConfigWriteStep[] = [];
  for (const ec of input.externalConfigs) {
    const applied = applyRollupToExternal(ec.typedBefore, input);
    if (!applied.changed) continue;
    externalConfigs.push({
      path: ec.path,
      before: cloneDatabaseConfig(ec.typedBefore),
      after: applied.config,
      casBefore: cloneValue(ec.rawBefore),
      casAfter: cloneValue(deps.serializeConfig(applied.config)),
      mutation: cloneValue(ec.mutation),
    });
  }
  const stats = computeMigrationStats(frontmatter, mode);
  return {
    plan: { frontmatter, primaryConfig, externalConfigs, undoLabel },
    stateAfter: cloneViewState(appliedPrimary.state),
    stats,
  };
}

// ─── 纯 coordinator（obsidian-free，可自动化测试生产链路）──────────────────
//
// runRenameOperation 把 buildRenamePlan + executeRenameTransaction + history 串联，
// 是生产 renameColumn 的可测核心：成功恰好一个 history payload；任一步失败无 history；
// builder 输入失败零 writer 调用；undo/redo 复用同一 executor（forward/reverse）。
// 只有 DataSource 磁盘读取、UI 同步、Obsidian callback 行为留手工 QA。

export interface RenameOperationInput {
  input: RenamePlanInput;
  builderDeps: RenamePlanBuilderDeps;
  writer: TransactionWriter;
  undoLabel?: string;
}

export type RenameOperationResult =
  | { ok: true; plan: RenamePlan; history: RenameHistoryPayload; stateAfter: DatabaseViewState; stats: { moved: number; deleted: number } }
  | { ok: false; transactionFailure: TransactionFailure };

/**
 * 执行一次 rename 操作（build → execute → history）。
 * builder 输入校验失败 → {ok:false, transactionFailure.kind:"plan"}（零 writer 调用）；
 * 任一持久化步骤失败 → executor 补偿后返回 {ok:false, transactionFailure}（无 history）；
 * 全部成功 → {ok:true, plan, history, stateAfter, stats}（恰好一个 history payload）。
 */
export async function runRenameOperation(op: RenameOperationInput): Promise<RenameOperationResult> {
  let built: RenamePlanResult;
  try {
    built = buildRenamePlan(op.input, op.builderDeps, op.undoLabel ?? "");
  } catch (err) {
    // builder 输入校验失败：零 writer 调用，包装为 plan 失败形式
    return {
      ok: false,
      transactionFailure: { ok: false, primaryError: err, failedStep: { kind: "plan" }, compensationErrors: [] },
    };
  }
  const tx = await executeRenameTransaction(built.plan, op.writer);
  if (!tx.ok) return { ok: false, transactionFailure: tx };
  return {
    ok: true,
    plan: built.plan,
    history: createRenameHistoryPayload(built.plan),
    stateAfter: built.stateAfter,
    stats: built.stats,
  };
}
