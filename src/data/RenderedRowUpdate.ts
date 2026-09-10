/**
 * 渲染行的 frontmatter 乐观更新 —— 不可变替换（obsidian-free 纯函数）。
 *
 * Bug 根因（分组下赋值后其他条目串显、刷新不恢复）：Obsidian metadataCache 对
 * 内容相同的文件返回**同一个共享 frontmatter 对象**（multi-select 值数组同样
 * 共享）。DataSource.toRawRecord 直接持有该引用 → RowPipeline 把它交给表格行 →
 * 乐观更新原地 `row.frontmatter[key] = 新值` → **污染 Obsidian 缓存本身**：
 * 共享该对象的其他文件渲染出新值（磁盘无此值），且 invalidate recordCache 后
 * re-seed 仍读到同一被污染对象，任何刷新都无法恢复。
 *
 * 修复语义：对 path 匹配的行做**浅拷贝替换** frontmatter（行对象也换新），
 * 绝不修改传入的任何对象；值经 cloneValue 深克隆（隔离共享数组）。
 * 失败回滚复用同一函数（回滚也是一次 change）。
 */
export interface RenderedFrontmatterChange {
  /** 目标条目文件路径。 */
  path: string;
  /** 字段 key。 */
  key: string;
  /** null = 删除该 key；其他 = 设置为该值。 */
  newValue: unknown;
}

export interface RenderedRowLike {
  file: { path: string };
  frontmatter: Record<string, unknown>;
}

export function applyFrontmatterChangeToRows<T extends RenderedRowLike>(
  rows: readonly T[],
  change: RenderedFrontmatterChange,
  cloneValue: (value: unknown) => unknown
): T[] {
  return rows.map((row) => {
    if (row.file.path !== change.path) return row;
    const next: Record<string, unknown> = { ...row.frontmatter };
    if (change.newValue === null) delete next[change.key];
    else next[change.key] = cloneValue(change.newValue);
    return { ...row, frontmatter: next };
  });
}
