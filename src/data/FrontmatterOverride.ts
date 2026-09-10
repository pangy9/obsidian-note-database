/**
 * Frontmatter 乐观 overlay 的纯逻辑（diff / merge / 相等 / 深拷贝）。
 *
 * 独立成 obsidian-free 模块的原因与 FormulaRename 相同：DataSource 经
 * metadataCache/vault 依赖 obsidian 运行时，无法在 vitest(node) 中实例化。
 * 把这些不依赖 this 的纯函数抽出，既便于单元测试锁住「清空→删除」等
 * 稳态语义，也避免两份实现漂移。
 *
 * 这些函数被 DataSource.rememberFrontmatterUpdates / applyFrontmatterOverride
 * 等握手逻辑复用——U1-SEL-2（清空后旧值残留）的稳态根因即由它们保证：
 * diff 把清空记为 {key:null}，merge 把 null 记为 delete。
 */

/** 规范化 nullish 标量后比较；结构值（数组/对象）按 JSON 内容比较。 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === "object") || (b && typeof b === "object")) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return (a ?? null) === (b ?? null);
}

/** YAML 兼容值的深拷贝（数组递归，对象走 JSON 往返，标量原样）。 */
export function cloneFrontmatterValue(value: unknown): unknown {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) {
    return value.map((entry) => entry === undefined ? null : cloneFrontmatterValue(entry));
  }
  if (value && typeof value === "object") {
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      // YAML/JSON 对象不会持久化 undefined。事务 raw CAS 快照必须与实际落盘结构一致，
      // 否则写入时被省略、undo 时仍保留该 key，会产生虚假的 config conflict。
      if (entry === undefined) continue;
      cloned[key] = cloneFrontmatterValue(entry);
    }
    return cloned;
  }
  return value;
}

/** 顶层 frontmatter 快照深拷贝（突变前留底，保证数组/对象按内容比较可靠）。 */
export function cloneFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    clone[key] = cloneFrontmatterValue(value);
  }
  return clone;
}

/**
 * 计算 before → after 的顶层变更。
 * 只跟踪顶层 key，使 overlay 形状与 Obsidian 解析出的 frontmatter 一致。
 * 关键：after 中删除的 key（beforeHas && !afterHas）记为 null，表示「删除」，
 * 而非 undefined。这是清空单元格后 overlay 能正确反映「key 已删」的根基。
 */
export function diffFrontmatter(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const beforeHas = Object.prototype.hasOwnProperty.call(before, key);
    const afterHas = Object.prototype.hasOwnProperty.call(after, key);
    if (!afterHas) {
      if (beforeHas) updates[key] = null;
      continue;
    }
    if (!beforeHas || !valuesEqual(before[key], after[key])) {
      updates[key] = cloneFrontmatterValue(after[key]);
    }
  }
  return updates;
}

/**
 * 把 overlay values 叠到 frontmatter 快照上。
 * null = 删除该 key；其余 = 覆盖/新增。返回新对象，不修改入参。
 */
export function mergeFrontmatterOverride(
  frontmatter: Record<string, unknown>,
  values: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...frontmatter };
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}
