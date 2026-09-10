/**
 * Rename 原子事务（R2-CO-1）—— obsidian-free 的纯逻辑执行器。
 *
 * 当前 renameColumn() 的三大病灶：
 *   ① 先迁移 frontmatter 再保存 config，config 保存失败时 frontmatter 已改、
 *     config 未改 → key 分裂，且 catch 无补偿；
 *   ② PropertyService.renameKey() 逐文件循环、中途抛错即中断，不返回已成功
 *     文件列表 → 无法精确补偿；
 *   ③ saveViewEntryConfig() 在持久化之前 recordConfigHistory() → 失败时遗留
 *     伪 undo history。
 *
 * 本模块只解决「执行 + 补偿」的可测核心（病灶 ①② 的执行侧）：
 *   - plan 由 prepare 阶段生成（纯数据，决策一切冲突/force/stale）；
 *   - executor 按 frontmatter → 当前 config → 外部 config 顺序提交，每步成功
 *     即刻写 journal；
 *   - 任一步失败按 journal 逆序补偿，补偿使用 prepare 捕获的精确 before；
 *   - frontmatter/config 均走 expect→patch（read-modify-write + 冲突校验），
 *     事务期间的外部并发改动不会被覆盖；
 *   - history/refresh/Notice 留给生产侧（B1 接入）在 result.ok 后发布。
 *
 * writer 为注入接口：测试用 fake（可逐文件/逐配置注入失败 + 篡改），生产用
 * 真实 DataSource 适配器。executor 与 DatabaseConfig 内部结构解耦——config 当
 * 不透明持久化对象，只关心 path + before/after（CAS）。
 */
import { cloneFrontmatterValue } from "./FrontmatterOverride";
import { configsDeepEqual } from "./FrontmatterPatch";

// ─── frontmatter 操作：显式 set/delete，避免 null（既是合法值又是删除信号）的歧义 ───

/** 单个涉及 key 的写入操作。set 保留 value（含 null/undefined 之外任意值）；delete 删除 key。 */
export type FrontmatterWrite =
  | { kind: "set"; value: unknown }
  | { kind: "delete" };

/** 单个涉及 key 在 prepare 时刻的存在性/值快照（commit/compensate 校验用）。 */
export interface FrontmatterKeySnapshot {
  exists: boolean;
  value?: unknown;
}

/**
 * 单个涉及 key 的 change：prepare 快照 + 决策操作**绑定在同一对象**，
 * 结构上保证 before/write 的 key 集合永远一致（无法构造出 before 有 key、
 * write 漏 key 或反向的非法 plan）。
 */
export interface FrontmatterChange {
  before: FrontmatterKeySnapshot;
  write: FrontmatterWrite;
}

/** 单文件 frontmatter 写入步骤：path → 逐 key change。只涉及事务相关 key。 */
export interface FrontmatterWriteStep {
  path: string;
  changes: Record<string, FrontmatterChange>;
}

/** 配置文件写入步骤（当前数据库定义文件或外部 rollup 引用库）。
 *  分离 typed before/after（history/内存/override）与 raw casBefore/casAfter（CAS）：
 *  toDatabasePayload 会补默认值，与旧格式/手工编辑的文件 raw payload 不可直接比较，
 *  故 CAS 必须用 prepare 时捕获的文件 raw payload。 */
export interface ConfigWriteStep {
  path: string;
  /** typed config（history/内存同步/override 用）。 */
  before: unknown;
  after: unknown;
  /** raw database payload（CAS expect / commit next 之外的补偿方向）。 */
  casBefore: unknown;
  /** raw database payload（commit next / 补偿 expect）。 */
  casAfter: unknown;
  /** peer notify mutation（生产侧填充，可选）。 */
  mutation?: unknown;
}

/** rename 事务计划（纯数据）。 */
export interface RenamePlan {
  frontmatter: FrontmatterWriteStep[];
  primaryConfig: ConfigWriteStep;
  externalConfigs: ConfigWriteStep[];
  undoLabel: string;
}

/** 已成功落盘的步骤（补偿逆序回放）。 */
export type JournalEntry =
  | { kind: "frontmatter"; path: string; changes: Record<string, FrontmatterChange> }
  | { kind: "config"; path: string; before: unknown; after: unknown; casBefore: unknown; casAfter: unknown; mutation?: unknown };

/** 持久化适配器（注入）。frontmatter 与 config 都走 expect→patch（CAS）。 */
export interface TransactionWriter {
  /** Rollback retains CAS checks but must not inherit forward-only cancellation guards. */
  forCompensation?(): TransactionWriter;
  /** 单文件队列内 read-modify-write：读取当前 frontmatter → 校验涉及 key 仍符合 expect →
   *  apply writes（set/delete）→ 写回。涉及 key 已被并发改动时抛 conflict 错误，不得覆盖。 */
  patchFrontmatter(
    path: string,
    expect: Record<string, FrontmatterKeySnapshot>,
    writes: Record<string, FrontmatterWrite>
  ): Promise<void>;
  /** 配置 CAS：casExpect/casNext 是 raw database payload（与文件 fm.database 比较），
   *  typedNext（typed config）用于生产侧 optimistic override / peer notify。不符抛 conflict，不覆盖。 */
  patchConfig(
    path: string,
    casExpect: unknown,
    casNext: unknown,
    typedNext?: unknown,
    mutation?: unknown
  ): Promise<void>;
}

export interface TransactionSuccess {
  ok: true;
  journal: JournalEntry[];
}

export interface TransactionFailure {
  ok: false;
  /** 触发回滚（或 plan 校验失败）的原始错误。 */
  primaryError: unknown;
  /** 失败位置；kind="plan" 表示零写入前的 plan 校验失败。 */
  failedStep: { kind: "plan" | "frontmatter" | "primaryConfig" | "externalConfig"; path?: string; index?: number };
  /** 补偿过程中再次失败的步骤（plan 失败或补偿全程成功则为空）。 */
  compensationErrors: Array<{ kind: "frontmatter" | "config"; path: string; error: unknown }>;
}

export type TransactionResult = TransactionSuccess | TransactionFailure;

/**
 * 执行 rename 事务。
 * 顺序：plan 校验（零写入）→ frontmatter（逐文件）→ primaryConfig → externalConfigs（逐个）。
 * 任一步失败按 journal 逆序补偿；补偿失败收集到 compensationErrors，绝不静默吞错。
 *
 * 并发安全：commit 时 expect=prepare before，compensate 时 expect=commit 后状态；
 * frontmatter 只 patch 涉及 key，config 走 CAS——事务期间的外部改动一律不覆盖。
 */
export async function executeRenameTransaction(
  plan: RenamePlan,
  writer: TransactionWriter
): Promise<TransactionResult> {
  const planError = validatePlan(plan);
  if (planError) {
    return { ok: false, primaryError: planError, failedStep: { kind: "plan" }, compensationErrors: [] };
  }

  const journal: JournalEntry[] = [];
  const compensationErrors: TransactionFailure["compensationErrors"] = [];

  const fail = async (primaryError: unknown, failedStep: TransactionFailure["failedStep"]): Promise<TransactionFailure> => {
    await compensate(journal, writer.forCompensation?.() ?? writer, compensationErrors);
    return { ok: false, primaryError, failedStep, compensationErrors };
  };

  // 1. frontmatter（逐文件，每成功即刻 journal）
  for (let i = 0; i < plan.frontmatter.length; i += 1) {
    const step = plan.frontmatter[i];
    try {
      await writer.patchFrontmatter(step.path, snapshotExpect(step.changes), commitOps(step.changes));
      journal.push({ kind: "frontmatter", path: step.path, changes: step.changes });
    } catch (err) {
      return await fail(err, { kind: "frontmatter", path: step.path, index: i });
    }
  }
  // 2. 当前数据库配置（CAS：casBefore→casAfter；typed after 用于 override/notify）
  try {
    await writer.patchConfig(plan.primaryConfig.path, plan.primaryConfig.casBefore, plan.primaryConfig.casAfter, plan.primaryConfig.after, plan.primaryConfig.mutation);
    journal.push({ kind: "config", path: plan.primaryConfig.path, before: plan.primaryConfig.before, after: plan.primaryConfig.after, casBefore: plan.primaryConfig.casBefore, casAfter: plan.primaryConfig.casAfter, mutation: plan.primaryConfig.mutation });
  } catch (err) {
    return await fail(err, { kind: "primaryConfig", path: plan.primaryConfig.path });
  }
  // 3. 外部数据库配置（逐个 CAS）
  for (let i = 0; i < plan.externalConfigs.length; i += 1) {
    const step = plan.externalConfigs[i];
    try {
      await writer.patchConfig(step.path, step.casBefore, step.casAfter, step.after, step.mutation);
      journal.push({ kind: "config", path: step.path, before: step.before, after: step.after, casBefore: step.casBefore, casAfter: step.casAfter, mutation: step.mutation });
    } catch (err) {
      return await fail(err, { kind: "externalConfig", path: step.path, index: i });
    }
  }
  return { ok: true, journal };
}

/**
 * Plan 校验：在第一次 writer 调用前拒绝非法 plan（零写入，op log 空）。
 * changes 结构已保证 before/write 同 key；这里额外拒绝 set 的 undefined 值
 * （undefined 不是合法 frontmatter 值，YAML 无对应；null 合法，须保留）。
 */
function validatePlan(plan: RenamePlan): Error | null {
  for (const step of plan.frontmatter) {
    for (const [key, change] of Object.entries(step.changes)) {
      if (change.write.kind === "set" && change.write.value === undefined) {
        return new Error(`invalid rename plan: frontmatter set '${key}' has undefined value`);
      }
    }
  }
  return null;
}

/** journal 逆序补偿：每个已成功步骤 CAS 写回其 before；任一补偿失败记入 errors 但继续回滚其余步骤。 */
async function compensate(
  journal: JournalEntry[],
  writer: TransactionWriter,
  errors: TransactionFailure["compensationErrors"]
): Promise<void> {
  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const entry = journal[i];
    try {
      if (entry.kind === "frontmatter") {
        // expect=commit 后状态（原 write 结果），writes=恢复（从 before 推导）。
        // commit 后这些 key 又被外部改动则报 conflict，不覆盖。
        await writer.patchFrontmatter(entry.path, committedExpect(entry.changes), restoreOps(entry.changes));
      } else {
        // config CAS：casExpect=commit 后的 casAfter，casNext=恢复 casBefore；typedNext=before 用于 override。
        await writer.patchConfig(entry.path, entry.casAfter, entry.casBefore, entry.before, entry.mutation);
      }
    } catch (err) {
      errors.push({ kind: entry.kind, path: entry.path, error: err });
    }
  }
}

// ─── changes → patch 参数推导 ──────────────────────────────────────────────

/** commit 的 expect：每个 key 的 prepare before 快照。 */
function snapshotExpect(changes: Record<string, FrontmatterChange>): Record<string, FrontmatterKeySnapshot> {
  const expect: Record<string, FrontmatterKeySnapshot> = {};
  for (const [key, change] of Object.entries(changes)) {
    expect[key] = change.before;
  }
  return expect;
}

/** commit 的 writes：每个 key 的决策操作。 */
function commitOps(changes: Record<string, FrontmatterChange>): Record<string, FrontmatterWrite> {
  const writes: Record<string, FrontmatterWrite> = {};
  for (const [key, change] of Object.entries(changes)) {
    writes[key] = change.write;
  }
  return writes;
}

/** 补偿的 expect：commit 后这些 key 的预期状态（原 write 的结果）。 */
function committedExpect(changes: Record<string, FrontmatterChange>): Record<string, FrontmatterKeySnapshot> {
  const expect: Record<string, FrontmatterKeySnapshot> = {};
  for (const [key, change] of Object.entries(changes)) {
    expect[key] = change.write.kind === "set"
      ? { exists: true, value: change.write.value }
      : { exists: false };
  }
  return expect;
}

/** 补偿的 writes：把每个 key 恢复为 prepare before（exists→set value，否则 delete）。 */
function restoreOps(changes: Record<string, FrontmatterChange>): Record<string, FrontmatterWrite> {
  const writes: Record<string, FrontmatterWrite> = {};
  for (const [key, change] of Object.entries(changes)) {
    writes[key] = change.before.exists
      ? { kind: "set", value: change.before.value }
      : { kind: "delete" };
  }
  return writes;
}

function cloneTransactionValue<T>(value: T): T {
  return cloneFrontmatterValue(value) as T;
}

// ─── B1.4：reverse plan + history payload ─────────────────────────────────
//
// rename 的 undo/redo 复用同一 executor + CAS + 补偿：首次执行 forward，undo 执行
// reverse，redo 再执行 forward。reverse 由 forward 纯函数反转得到，无需散落恢复字段。

/** 反转 frontmatter step：reverse before = forward commit 后状态，reverse write = 恢复 forward before。 */
function reverseFrontmatterStep(step: FrontmatterWriteStep): FrontmatterWriteStep {
  const expect = committedExpect(step.changes);
  const restore = restoreOps(step.changes);
  const changes: Record<string, FrontmatterChange> = {};
  for (const key of Object.keys(step.changes)) {
    changes[key] = {
      before: cloneTransactionValue(expect[key]),
      write: cloneTransactionValue(restore[key]),
    };
  }
  return { path: step.path, changes };
}

/** 反转 config step：before/after 互换、casBefore/casAfter 互换。 */
function reverseConfigStep(step: ConfigWriteStep): ConfigWriteStep {
  return {
    path: step.path,
    before: cloneTransactionValue(step.after),
    after: cloneTransactionValue(step.before),
    casBefore: cloneTransactionValue(step.casAfter),
    casAfter: cloneTransactionValue(step.casBefore),
    mutation: cloneTransactionValue(step.mutation),
  };
}

/**
 * 由 forward plan 反转出 reverse plan（undo 用）。
 * frontmatter：reverse before = commit 后状态、write = 恢复 forward before；
 * config/external：before↔after、casBefore↔casAfter 互换。
 * redo = 再执行 forward（reverse 的 reverse === forward，因 before/write 互换两次还原）。
 */
export function reverseRenamePlan(forward: RenamePlan): RenamePlan {
  return {
    frontmatter: forward.frontmatter.map(reverseFrontmatterStep),
    primaryConfig: reverseConfigStep(forward.primaryConfig),
    externalConfigs: forward.externalConfigs.map(reverseConfigStep),
    undoLabel: forward.undoLabel,
  };
}

/** rename 专用 history payload：forward + reverse，三条路径（apply/undo/redo）复用同一 executor。 */
export interface RenameHistoryPayload {
  forward: RenamePlan;
  reverse: RenamePlan;
}

/** rename 专用 history entry（DatabaseView applyHistoryEntry 加分支：undo 执行 reverse、redo 执行 forward，
 *  executor 失败抛错；成功后同步 plan 中各 config step 的 after 到 viewEntries/configSnapshots/viewStateStore/UI）。 */
export interface RenameHistoryEntry {
  type: "rename";
  label: string;
  payload: RenameHistoryPayload;
}

/** 为 history 捕获与调用方/live config 隔离的 forward/reverse 快照。 */
export function createRenameHistoryPayload(forward: RenamePlan): RenameHistoryPayload {
  // reverseRenamePlan 每次都会深克隆 step 数据；反转两次得到独立的 forward 快照。
  const forwardSnapshot = reverseRenamePlan(reverseRenamePlan(forward));
  return {
    forward: forwardSnapshot,
    reverse: reverseRenamePlan(forwardSnapshot),
  };
}

/** Undo 前从磁盘读取到的、单个 frontmatter step 涉及 key 的当前快照。 */
export interface RenameCurrentFrontmatter {
  path: string;
  values: Record<string, FrontmatterKeySnapshot>;
}

/**
 * rename 后用户可能继续编辑新 key（computed automatic sync 也会更新保存结果）。
 * 此时直接执行最初 reverse 会因 target value 已变化而 CAS conflict。对标准
 * old→new move step 做安全重基：仅当 old 仍处于 commit 后的“不存在”状态、new
 * 仍存在时，把 new 的当前最新值视为被重命名属性的当前值，生成新的 forward/reverse。
 *
 * 这样 undo 会把最新值迁回 old，并精确恢复 rename 前 new 的值；redo 再把同一最新值
 * 迁到 new。old 被重新创建、new 被删除或 step 形状不明确时不重基，保留原 CAS 冲突。
 */
export function rebaseRenameHistoryForUndo(
  payload: RenameHistoryPayload,
  current: RenameCurrentFrontmatter[]
): RenameHistoryPayload {
  const forward = reverseRenamePlan(reverseRenamePlan(payload.forward));
  const byPath = new Map(current.map((entry) => [entry.path, entry.values]));
  for (const step of forward.frontmatter) {
    const values = byPath.get(step.path);
    if (!values) continue;
    const changes = Object.entries(step.changes);
    const source = changes.find(([, change]) => change.before.exists && change.write.kind === "delete");
    if (!source) continue;
    const target = changes.find(([, change]) =>
      change.write.kind === "set" && configsDeepEqual(change.write.value, source[1].before.value)
    );
    if (!target) continue;
    const [sourceKey, sourceChange] = source;
    const [targetKey, targetChange] = target;
    const currentSource = values[sourceKey];
    const currentTarget = values[targetKey];
    if (!currentSource || currentSource.exists || !currentTarget?.exists) continue;
    sourceChange.before = cloneTransactionValue(currentTarget);
    targetChange.write = { kind: "set", value: cloneTransactionValue(currentTarget.value) };
  }
  return createRenameHistoryPayload(forward);
}
