import { describe, expect, it } from "vitest";
import { resolveBoardContainerDropOrder, resolveBoardCardDropIntent, resolveBoardColumnByPoint } from "../data/BoardContainerDrop";
import type { BoardDropCandidate, BoardDropRow } from "../data/BoardContainerDrop";

// 构造最小行 —— 容器拖拽决策只关心 file.path。用结构类型避免引入 obsidian 依赖，便于纯单测。
function row(path: string): BoardDropRow {
  return { file: { path } };
}

describe("resolveBoardContainerDropOrder", () => {
  // Bug 1 核心：卡片拖回「同列空白区」（非某张卡片上）时必须保持原位，
  // 不能被无条件重排到末尾。只有跨分组（列/子分组）才追加到目标分组末尾。
  const rows = [row("a.md"), row("b.md"), row("c.md")];

  it("keeps the card in place when dropped on its own column's empty area", () => {
    const result = resolveBoardContainerDropOrder({
      rows,
      draggedPath: "b.md",
      fromGroup: "todo",
      groupKey: "todo",
      fromSubgroup: undefined,
      subgroupKey: undefined,
    });
    expect(result).toEqual({ keepInPlace: true });
  });

  it("keeps the card in place within the same subgroup", () => {
    const result = resolveBoardContainerDropOrder({
      rows,
      draggedPath: "b.md",
      fromGroup: "todo",
      groupKey: "todo",
      fromSubgroup: "high",
      subgroupKey: "high",
    });
    expect(result).toEqual({ keepInPlace: true });
  });

  it("appends to the end when dropping into a different column's empty area", () => {
    const result = resolveBoardContainerDropOrder({
      rows,
      draggedPath: "x.md",
      fromGroup: "todo",
      groupKey: "done",
      fromSubgroup: undefined,
      subgroupKey: undefined,
    });
    expect(result).toEqual({ keepInPlace: false, order: ["a.md", "b.md", "c.md", "x.md"] });
  });

  it("moves across subgroups within the same column (append to target subgroup end)", () => {
    const result = resolveBoardContainerDropOrder({
      rows,
      draggedPath: "x.md",
      fromGroup: "todo",
      groupKey: "todo",
      fromSubgroup: "high",
      subgroupKey: "low",
    });
    expect(result).toEqual({ keepInPlace: false, order: ["a.md", "b.md", "c.md", "x.md"] });
  });

  it("places the dragged card alone when the target group is empty", () => {
    const result = resolveBoardContainerDropOrder({
      rows: [],
      draggedPath: "x.md",
      fromGroup: "todo",
      groupKey: "done",
      fromSubgroup: undefined,
      subgroupKey: undefined,
    });
    expect(result).toEqual({ keepInPlace: false, order: ["x.md"] });
  });

  it("preserves the existing order when appending to the end", () => {
    const ordered = [row("z.md"), row("y.md"), row("a.md")];
    const result = resolveBoardContainerDropOrder({
      rows: ordered,
      draggedPath: "m.md",
      fromGroup: "todo",
      groupKey: "done",
      fromSubgroup: undefined,
      subgroupKey: undefined,
    });
    expect(result).toEqual({ keepInPlace: false, order: ["z.md", "y.md", "a.md", "m.md"] });
  });
});

// 卡片 drop 决策：把卡片拖到「某张卡片上」时，区分跨组移动、同组重排序与忽略。
// 核心修复：跨组移动只改分组值、与排序规则无关，即使处于显式排序状态也必须允许；
// 同组重排序在显式排序状态下应忽略（manual order 被排序覆盖，重排无意义）。
describe("resolveBoardCardDropIntent", () => {
  it("allows cross-group move even when explicitly sorted", () => {
    expect(
      resolveBoardCardDropIntent({ fromGroup: "todo", targetGroupKey: "done", explicitlySorted: true })
    ).toBe("cross-group-move");
  });

  it("allows cross-group move when not sorted", () => {
    expect(
      resolveBoardCardDropIntent({ fromGroup: "todo", targetGroupKey: "done", explicitlySorted: false })
    ).toBe("cross-group-move");
  });

  it("allows same-group reorder when not sorted", () => {
    expect(
      resolveBoardCardDropIntent({ fromGroup: "todo", targetGroupKey: "todo", explicitlySorted: false })
    ).toBe("same-group-reorder");
  });

  it("ignores same-group reorder when explicitly sorted", () => {
    expect(
      resolveBoardCardDropIntent({ fromGroup: "todo", targetGroupKey: "todo", explicitlySorted: true })
    ).toBe("ignore");
  });

  it("treats missing fromGroup as same-group (never a cross-group move)", () => {
    expect(
      resolveBoardCardDropIntent({ fromGroup: undefined, targetGroupKey: "todo", explicitlySorted: false })
    ).toBe("same-group-reorder");
    expect(
      resolveBoardCardDropIntent({ fromGroup: undefined, targetGroupKey: "todo", explicitlySorted: true })
    ).toBe("ignore");
  });
});

// 看板容器空白（列下方/上方 board 区域）的几何命中：仅 x 落在某列水平范围内才归属该列；
// 两列间水平 gap 返回 null（不处理）；列下方/上方空白按 y 最近候选归属；子分组按 y 细分。
describe("resolveBoardColumnByPoint", () => {
  const candidate = (key: string, left: number, right: number, top = 0, bottom = 100): BoardDropCandidate => ({
    key,
    rect: { left, right, top, bottom },
  });

  it("hits the column whose horizontal range contains x", () => {
    const cs = [candidate("todo", 0, 200), candidate("done", 212, 412)]; // 12px gap 200..212
    expect(resolveBoardColumnByPoint(cs, 100, 50)).toBe("todo");
    expect(resolveBoardColumnByPoint(cs, 300, 50)).toBe("done");
  });

  it("returns null for x in the gap between two columns (gap not handled)", () => {
    const cs = [candidate("todo", 0, 200), candidate("done", 212, 412)];
    expect(resolveBoardColumnByPoint(cs, 206, 50)).toBeNull();
  });

  it("returns null for x outside the board (no column hit)", () => {
    const cs = [candidate("todo", 0, 200), candidate("done", 212, 412)];
    expect(resolveBoardColumnByPoint(cs, -50, 50)).toBeNull();
    expect(resolveBoardColumnByPoint(cs, 999, 50)).toBeNull();
  });

  it("resolves column-below empty space to that column (y beyond column bottom)", () => {
    const cs = [candidate("todo", 0, 200, 0, 100), candidate("done", 212, 412, 0, 100)];
    expect(resolveBoardColumnByPoint(cs, 100, 400)).toBe("todo");
    expect(resolveBoardColumnByPoint(cs, 300, 400)).toBe("done");
  });

  it("resolves column-above empty space to that column (y above column top)", () => {
    const cs = [candidate("todo", 0, 200, 100, 200)];
    expect(resolveBoardColumnByPoint(cs, 100, 20)).toBe("todo");
  });

  it("returns null when there are no candidates", () => {
    expect(resolveBoardColumnByPoint([], 100, 50)).toBeNull();
  });

  it("refines to the subgroup hit by y when candidates share a column's x range", () => {
    const cs = [
      candidate("todo::high", 0, 200, 0, 100),
      candidate("todo::low", 0, 200, 108, 208),
    ];
    expect(resolveBoardColumnByPoint(cs, 100, 50)).toBe("todo::high");
    expect(resolveBoardColumnByPoint(cs, 100, 160)).toBe("todo::low");
    // 列底空白（y 超出所有子分组）→ 最近的最后一个子分组。
    expect(resolveBoardColumnByPoint(cs, 100, 400)).toBe("todo::low");
  });
});
