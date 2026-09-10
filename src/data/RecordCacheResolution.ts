/**
 * rename/create 时 recordCache 新记录的解析决策（obsidian-free 纯函数）。
 *
 * 独立成模块的原因与 FormulaRename 等相同：DataSource.ts 耦合 obsidian 运行时，
 * 无法在 vitest(node) 中导入；把决策抽纯后行为可在测试中完整验证。
 *
 * 关键语义（对应「重命名条目后整行清空、刷新才恢复」的 bug）：
 *   - metadataCache 在新路径尚未解析完成时，getFileCache 可能返回 null，
 *     也可能返回缓存对象但 frontmatter === undefined——两种都视为「未就绪」；
 *   - rename 不改变文件内容：旧路径记录即权威值，未就绪时立即迁移，
 *     避免首帧渲染空行（清空→500ms 兜底恢复的可见闪烁）；
 *   - cache.frontmatter 为对象（包括空对象 {}，即「解析完成且确无 frontmatter」
 *     的权威空）时采用新缓存，不迁移、不兜底；
 *   - 一切未就绪路径都需要 needsRecheck：500ms 后从磁盘重读对齐
 *     （权威 metadata 事件先到时由 cancelModifyRecheck 取消）。
 */
export interface RecordCacheResolution {
  /** 权威或迁移得到的 frontmatter；undefined 表示无任何可用来源（调用方暂存空值）。 */
  frontmatter: Record<string, unknown> | undefined;
  /** true = 新路径 metadataCache 未就绪，需要安排磁盘重读兜底。 */
  needsRecheck: boolean;
}

export function resolveRenamedRecordCache(
  cachedFrontmatter: unknown,
  previousFrontmatter: Record<string, unknown> | null | undefined
): RecordCacheResolution {
  if (isFrontmatterObject(cachedFrontmatter)) {
    return { frontmatter: cachedFrontmatter, needsRecheck: false };
  }
  if (isFrontmatterObject(previousFrontmatter)) {
    // 新路径未就绪：rename 内容未变，旧记录即正确值，立即迁移消除首帧清空。
    return { frontmatter: previousFrontmatter, needsRecheck: true };
  }
  return { frontmatter: undefined, needsRecheck: true };
}

function isFrontmatterObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
