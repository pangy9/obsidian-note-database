/**
 * 表单弹层需要挂到 body 才不会被 Modal/表单滚动区裁切；同时既有选项和日历
 * 样式以 .note-database-container 为作用域。零尺寸 portal 同时满足两者，
 * 不参与页面布局，关闭弹层时由调用方移除。
 */
export function createFormPopoverPortal(doc: Document): HTMLElement {
  const portal = doc.createElement("div");
  portal.className = "note-database-container db-form-popover-portal";
  doc.body.appendChild(portal);
  return portal;
}
