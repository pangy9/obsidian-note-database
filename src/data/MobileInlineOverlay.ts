/**
 * 移动端单元格编辑弹层（inline overlay）的定位计算 —— obsidian-free 纯函数。
 *
 * Bug「移动端文本/时间编辑弹层出现在画面最左侧，用户需右滑回原位」的根因：
 * 弹层 absolute 挂在 overflow:auto 的滚动容器（.note-database-container）内容流里，
 * `left: 0` 是滚动内容的坐标原点而非视口左缘——用户横滑表格到中段点单元格时，
 * 弹层渲染在内容 x=0 处（视觉上的画面最左，甚至视口外）。
 *
 * 修法：弹层要横跨「当前视口」宽度并出现在单元格正下方。视口左缘在内容坐标系中
 * 就是 scrollLeft；垂直沿用原逻辑（td 相对容器 top + 容器自身 scrollTop 补偿，
 * 页面级滚动在 tdRect/containerRect 的减法中天然抵消）。弹层留在内容流中，
 * 后续横滑/竖滚时与单元格同步移动，视觉不错位。
 */
export interface MobileInlineOverlayInput {
  /** 触发单元格的视口矩形（getBoundingClientRect）。 */
  tdRect: { top: number; height: number };
  /** 滚动容器的视口矩形。 */
  containerRect: { top: number };
  /** 滚动容器自身已滚动的像素。 */
  scrollTop: number;
  scrollLeft: number;
  /** 滚动容器的可视宽度（clientWidth）。 */
  clientWidth: number;
  /** 弹层与单元格的下间距，默认 2。 */
  verticalOffset?: number;
  /** 弹层期望最大宽度（px），实际再受视口约束，默认 360。 */
  maxWidth?: number;
  /** 弹层与视口左右的最小留白（px），默认 10。 */
  viewportMargin?: number;
}

export interface MobileInlineOverlayPosition {
  /** 内容坐标系：弹层在当前视口内水平居中。 */
  left: number;
  /** 弹层实际宽度：min(maxWidth, 视口宽 - 2×留白)，不铺满整个视口。 */
  width: number;
  /** 内容坐标系：单元格正下方。 */
  top: number;
}

export function computeMobileInlineOverlayPosition(input: MobileInlineOverlayInput): MobileInlineOverlayPosition {
  const offset = input.verticalOffset ?? 2;
  const margin = input.viewportMargin ?? 10;
  const maxWidth = input.maxWidth ?? 360;
  const width = Math.max(0, Math.min(maxWidth, input.clientWidth - margin * 2));
  const viewportLeft = Math.max(0, input.scrollLeft);
  // 水平居中于当前视口：视口可用区起点 + (可用宽 - 弹层宽)/2，全部换算到内容坐标。
  const left = viewportLeft + Math.max(0, (input.clientWidth - width) / 2);
  return {
    left,
    width,
    top: input.tdRect.top - input.containerRect.top + input.scrollTop + input.tdRect.height + offset,
  };
}
