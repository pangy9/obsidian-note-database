/**
 * Relation 条目链接的失效状态判定（obsidian-free 纯函数，U1-REL-1）。
 *
 * 场景：A 库的 relation 列存有指向其他库条目的链接，目标文件可能在别处被删除
 * （missing）或已移出目标数据库的来源范围（out-of-scope）。单元格渲染与编辑器
 * 需要按状态标识：missing 淡橙 + 警告图标、out-of-scope 弱提示，两者都可逐项
 * 取消；点击 missing 不得触发 openLinkText 创建新文件。
 *
 * 判定注入（生产侧 CellRenderer 提供）：
 *   - resolveTarget(target, sourcePath)：app.metadataCache.getFirstLinkpathDest
 *   - isInScope(file)：目标数据库 records 是否包含该文件
 */
export type RelationItemState = "valid" | "missing" | "out-of-scope";

export interface RelationItem<TFile = unknown> {
  /** 原始链接值（保存时按原样/原顺序写回）。 */
  raw: string;
  /** 链接目标（不含别名）。 */
  target: string;
  /** 解析出的文件（missing 时为 undefined）。 */
  file?: TFile;
  /** 解析出的路径（missing 时为 undefined）。 */
  resolvedPath?: string;
  state: RelationItemState;
}

export function resolveRelationItemStates<TFile extends { path: string }>(
  links: ReadonlyArray<{ raw: string; target: string }>,
  resolveTarget: (target: string, sourcePath: string) => TFile | undefined,
  isInScope: (file: TFile) => boolean,
  sourcePath: string
): RelationItem<TFile>[] {
  return links.map((link) => {
    const file = resolveTarget(link.target, sourcePath);
    if (!file) return { raw: link.raw, target: link.target, state: "missing" as const };
    if (!isInScope(file)) {
      return { raw: link.raw, target: link.target, file, resolvedPath: file.path, state: "out-of-scope" as const };
    }
    return { raw: link.raw, target: link.target, file, resolvedPath: file.path, state: "valid" as const };
  });
}

/** 编辑器保存时的序列化输入（与 CellRenderer.editRelationPopover 的 orderedItems 同构）。 */
export interface RelationEditorItem {
  raw: string;
  target: string;
  resolvedPath?: string;
  selected: boolean;
  state: RelationItemState;
}

/**
 * 序列化编辑器选择结果（纯函数，U1-REL-1 审查修正）：
 *   - valid：按 selectedPaths 保存（与有效记录列表勾选联动）；
 *   - missing / out-of-scope：**按自身 selected 保存**——它们不进 selectedPaths，
 *     打开编辑器不做任何修改直接保存必须得到等价数组（不得误删仍被勾选的失效引用）；
 *   - 原顺序优先：先按 orderedItems 原始交织顺序输出仍保留的项（raw 原样，
 *     别名/子路径/重复项不丢），再按选择顺序追加新增的有效记录。
 */
export function serializeRelationEditorSelection(
  items: ReadonlyArray<RelationEditorItem>,
  selectedPaths: ReadonlySet<string>,
  selectedOrder: ReadonlyArray<string>,
  existingRawByPath: ReadonlyMap<string, string>
): unknown[] {
  const seenPaths = new Set<string>();
  const values: unknown[] = [];
  for (const item of items) {
    if (item.state === "valid") {
      if (!item.selected) continue;
      if (item.resolvedPath && !selectedPaths.has(item.resolvedPath)) continue;
      if (item.resolvedPath) seenPaths.add(item.resolvedPath);
    } else if (!item.selected) {
      continue;
    }
    values.push(item.raw);
  }
  for (const path of selectedOrder) {
    if (seenPaths.has(path)) continue;
    values.push(existingRawByPath.get(path) || `[[${path.replace(/\.md$/i, "")}]]`);
  }
  return values;
}
