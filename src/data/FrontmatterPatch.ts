/**
 * Frontmatter / config patch 的纯校验与应用逻辑（obsidian-free）。
 *
 * 生产 writer（DataSource.patchFrontmatter / patchViewDefConfig）在 processFrontMatter
 * 回调内调用这些纯函数，实现「read → 校验涉及 key 仍符合 expect → apply → 写回」的
 * 原子 read-modify-write（Obsidian 在写锁内执行回调，回调抛错则不落盘）。
 *
 * 独立成模块便于在 vitest 中直接测试冲突检测与应用语义——这是 R2-CO-1 writer
 * 「resolve=已落盘 / reject=未写入」契约在纯逻辑层的表现。
 */
import type { FrontmatterKeySnapshot, FrontmatterWrite } from "./RenameTransaction";

export type FrontmatterVerifyResult =
  | { ok: true }
  | { ok: false; key: string; reason: "exists" | "value" };

/**
 * 校验 currentFm 中涉及 key 仍符合 prepare 快照 expect。
 * 任一 key 的 exists/value 不符 → 返回 conflict（caller 据此抛错、不写）。
 */
export function verifyFrontmatterExpect(
  currentFm: Record<string, unknown>,
  expect: Record<string, FrontmatterKeySnapshot>
): FrontmatterVerifyResult {
  for (const [key, snap] of Object.entries(expect)) {
    const curExists = Object.prototype.hasOwnProperty.call(currentFm, key);
    if (curExists !== snap.exists) return { ok: false, key, reason: "exists" };
    if (snap.exists && !configsDeepEqual(currentFm[key], snap.value)) {
      return { ok: false, key, reason: "value" };
    }
  }
  return { ok: true };
}

/**
 * 把 writes 原地应用到 fm：set → 赋值（含 null），delete → 删除 key。
 * 只动 writes 涉及的 key，不触碰其他字段（并发安全）。
 */
export function applyFrontmatterWrites(
  fm: Record<string, unknown>,
  writes: Record<string, FrontmatterWrite>
): void {
  for (const [key, op] of Object.entries(writes)) {
    if (op.kind === "delete") delete fm[key];
    else fm[key] = op.value;
  }
}

/**
 * 把「期望存在性快照」desired 叠到 frontmatter 上（optimistic overlay 合并）。
 * exists:true → 赋 value（含 null），exists:false → 删除 key。
 * 与 applyFrontmatterWrites 的区别：用 exists/value 状态而非 set/delete 操作，
 * 因此能精确表达「key 存在且值为 null」（set-null），不会被当成删除。
 */
export function mergeFrontmatterDesired(
  frontmatter: Record<string, unknown>,
  desired: Record<string, FrontmatterKeySnapshot>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...frontmatter };
  for (const [key, des] of Object.entries(desired)) {
    if (des.exists) merged[key] = des.value;
    else delete merged[key];
  }
  return merged;
}

/**
 * 深度结构相等（config CAS 用）。对象 key 顺序无关、数组顺序敏感、null 明确处理。
 * 不用 JSON.stringify（其受 key 顺序影响，会把语义相同的配置误判冲突）。
 */
export function configsDeepEqual(a: unknown, b: unknown): boolean {
  // Object.is 额外覆盖 NaN===NaN；computed 保存结果可能合法地是 NaN，不能误报 CAS conflict。
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => configsDeepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const ka = Object.keys(aObj);
    const kb = Object.keys(bObj);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(bObj, k) && configsDeepEqual(aObj[k], bObj[k]));
  }
  return a === b;
}

/**
 * 把 view-def 的 database payload 写入 frontmatter（保留其他无关顶层 key）。
 * 用于 patchViewDefConfig 的 processFrontMatter 回调：只动 db_view/name/database/legacy，
 * 不触碰其他顶层字段（tags/author 等），保证 rename 不误删笔记里其他 frontmatter。
 */
export function applyViewDefDatabasePatch(
  fm: Record<string, unknown>,
  nextPayload: unknown,
  legacyKeys: Iterable<string>
): void {
  fm["db_view"] = true;
  // name 存在 database 对象内，避免顶层冗余。
  delete fm["name"];
  fm["database"] = nextPayload;
  for (const key of legacyKeys) delete fm[key];
}

/**
 * 用当前 cache 状态裁剪 desired：只保留尚未追平的 key。
 * 用于 metadataCache.changed 事件——不能无条件删 overlay（延迟到达的旧 commit 事件会
 * 误删较新的 compensation overlay），只有 cache 确实追上期望状态才移除该 key。
 */
export function reconcileFrontmatterDesired(
  desired: Record<string, FrontmatterKeySnapshot>,
  cached: Record<string, unknown>
): Record<string, FrontmatterKeySnapshot> {
  const remaining: Record<string, FrontmatterKeySnapshot> = {};
  for (const [key, des] of Object.entries(desired)) {
    const cachedHas = Object.prototype.hasOwnProperty.call(cached, key);
    const caughtUp = des.exists
      ? cachedHas && configsDeepEqual(cached[key], des.value)
      : !cachedHas;
    if (!caughtUp) remaining[key] = des;
  }
  return remaining;
}
