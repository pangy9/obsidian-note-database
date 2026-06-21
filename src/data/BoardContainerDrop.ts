// 看板容器拖拽目标决策。
//
// 把卡片拖到看板列 / 子分组的「空白区」（非某张卡片上）时，决定卡片是保持原位
// 还是追加到目标分组末尾。这是 Bug 1 的核心修复：原先容器空白区 drop 会无条件把
// 卡片重排到末尾，导致「拖回原位 → 跑到末尾」。
//
// 用结构类型 BoardDropRow 而非 RowData，避免引入 obsidian 依赖，便于纯单测
// （见 src/__tests__/board-container-drop.test.ts）。RowData 满足该结构，可直接传入。

/** 容器拖拽决策只需要行的 file.path。 */
export interface BoardDropRow {
  file: { path: string };
}

/** 容器空白区 drop 的目标位置。keepInPlace=true 时调用方应跳过重排，保持原顺序。 */
export type BoardContainerDropOrder =
  | { keepInPlace: true }
  | { keepInPlace: false; order: string[] };

/**
 * 计算拖到容器空白区后卡片的目标顺序。
 *
 * - 同分组（同 group 且同 subgroup）→ 保持原位，不重排；
 * - 跨分组（列或子分组不同）→ 追加到目标分组末尾。
 *
 * 仅由 drop handler 在「空白区」路径调用；拖到某张卡片上走精确插入（getCardDropOrder），
 * 不在本函数职责内。
 */
export function resolveBoardContainerDropOrder(params: {
  rows: BoardDropRow[];
  draggedPath: string;
  fromGroup: string | undefined;
  groupKey: string;
  fromSubgroup: string | undefined;
  subgroupKey: string | undefined;
}): BoardContainerDropOrder {
  const sameGroup =
    params.fromGroup === params.groupKey && params.fromSubgroup === params.subgroupKey;
  if (sameGroup) return { keepInPlace: true };
  const others = params.rows
    .map((row) => row.file.path)
    .filter((path) => path !== params.draggedPath);
  return { keepInPlace: false, order: [...others, params.draggedPath] };
}

/** 把卡片拖到「某张卡片上」时的 drop 意图。 */
export type BoardCardDropIntent = "cross-group-move" | "same-group-reorder" | "ignore";

/**
 * 决定卡片 drop 到某张卡片上时的行为意图。
 *
 * - 跨组（fromGroup 有值且与目标分组不同）→ "cross-group-move"：只改分组值，与排序
 *   规则无关，显式排序状态下也允许（移到目标组后组内位置由排序决定）。
 * - 同组 + 未显式排序 → "same-group-reorder"：组内精确重排序。
 * - 同组 + 显式排序 → "ignore"：manual order 被排序覆盖，重排无意义。
 *
 * 与 resolveBoardContainerDropOrder 的区别：本函数只判定「拖到卡片上」的意图（是否
 * 允许、移动还是重排），不计算具体插入顺序（顺序仍由 getCardDropOrder 计算）。
 */
export function resolveBoardCardDropIntent(params: {
  fromGroup: string | undefined;
  targetGroupKey: string;
  explicitlySorted: boolean;
}): BoardCardDropIntent {
  const crossGroup = params.fromGroup != null && params.fromGroup !== params.targetGroupKey;
  if (crossGroup) return "cross-group-move";
  if (params.explicitlySorted) return "ignore";
  return "same-group-reorder";
}

/** 几何命中的候选矩形（一列或一个子分组）；key 由调用方解释（列 key 或 `group::subgroup`）。 */
export interface BoardDropCandidate {
  key: string;
  rect: { left: number; right: number; top: number; bottom: number };
}

/**
 * 把鼠标坐标解析到目标列 / 子分组，供 .db-board 容器空白区的兜底 drop handler 使用。
 *
 * 算法（**两列间水平 gap 不处理**）：
 * - 候选为空 → null。
 * - 筛选 x 落在 `[left, right]` 水平范围内的候选；**无命中（x 在两列 gap 或看板左右外）
 *   → 返回 null**，调用方据此不 preventDefault，gap 保持不可 drop。
 * - x 命中的候选中：y 落在 `[top, bottom]` → 该候选；否则（列上方 / 下方空白）→ 取 y 最近的
 *   候选——无子分组时即该列（**列下方空白归该列**），有子分组时按 y 细分到具体子分组
 *   （列底空白归最后一个子分组）。
 *
 * 用最小 rect 结构（不依赖 DOMRect），便于纯单测。
 */
export function resolveBoardColumnByPoint(
  candidates: BoardDropCandidate[],
  x: number,
  y: number
): string | null {
  if (candidates.length === 0) return null;
  // x 必须落在某候选水平范围内；两列之间的 gap（不属于任何列）不处理。
  const xHits = candidates.filter((c) => x >= c.rect.left && x <= c.rect.right);
  if (xHits.length === 0) return null;
  // 优先取 y 正好落在 [top, bottom] 内的候选（命中列/子分组 box 内）。
  const yHit = xHits.find((c) => y >= c.rect.top && y <= c.rect.bottom);
  if (yHit) return yHit.key;
  // y 在所有 x 命中候选之外（列上方/下方空白）→ 取 y 最近的候选。
  let best = xHits[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of xHits) {
    const dist = Math.min(Math.abs(y - c.rect.top), Math.abs(y - c.rect.bottom));
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best.key;
}
