import { App, Notice, setIcon } from "obsidian";
import { getRelationDisplayLabel, parseRelationValues } from "../data/RelationLinks";
import { resolveRelationItemStates } from "../data/RelationItemState";
import { RowData } from "../data/types";
import { t } from "../i18n";
import { setFieldTooltip } from "./FieldTooltip";
import { markNoteHoverLink } from "./HoverLinkPreview";

export interface RelationValueRenderOptions {
  /** 目标数据库内的条目路径集合；提供时启用 missing/out-of-scope 标识（U1-REL-1）。 */
  scopePaths?: ReadonlySet<string>;
  /** 点击失效链接的替代入口（默认仅 Notice 提示）。可编辑场景传入打开编辑面板。 */
  onInvalidClick?: (target: string) => void;
}

export function renderRelationValue(
  parent: HTMLElement,
  app: App | undefined,
  row: RowData,
  value: unknown,
  compact = false,
  options: RelationValueRenderOptions = {},
): boolean {
  const links = parseRelationValues(value);
  if (links.length === 0) return false;
  const wrap = parent.createDiv({ cls: `db-relation-values${compact ? " is-compact" : ""}` });
  // 两个问题拆开：文件能否解析（决定 missing）与是否属于目标库（仅范围集合可用时
  // 才能判定）。不知道目标库范围 ≠ 文件存在——无 scopePaths 时仍做 missing 检测，
  // 存在的文件按 valid 处理（不误判范围）。
  const items = resolveRelationItemStates(
    links,
    (target, sourcePath) => app?.metadataCache.getFirstLinkpathDest(target, sourcePath) ?? undefined,
    (file) => (options.scopePaths ? options.scopePaths.has(file.path) : true),
    row.file.path,
  );
  setFieldTooltip(wrap, links.map((link) => link.alias || link.target));
  links.forEach((link, index) => {
    const state = items?.[index]?.state;
    const canPreview = state === "valid" || state === "out-of-scope";
    const anchor = wrap.createEl("a", {
      cls: `db-relation-link${canPreview ? " internal-link" : ""}${state ? ` is-${state}` : ""}`,
      attr: {
        ...(canPreview ? { href: link.target, "data-href": link.target } : { role: "link", tabindex: "0" }),
        title: state ? t(`relation.state.${state}`, { target: link.target }) : link.target,
      },
    });
    // 范围外文件仍存在，允许正常预览；按引用所在笔记解析目标，missing 不注册预览。
    if (canPreview) markNoteHoverLink(anchor, link.target, row.file.path);
    const icon = anchor.createSpan({ cls: "db-relation-link-icon" });
    // missing：强制 triangle-alert（不受"隐藏记录图标"影响）；out-of-scope 弱提示。
    setIcon(icon, state === "missing" ? "triangle-alert" : state === "out-of-scope" ? "file-question" : "file-text");
    anchor.createSpan({
      cls: "db-relation-link-label",
      text: getRelationDisplayLabel(link),
    });
    anchor.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state === "missing") {
        // 仅 missing 阻断 openLinkText——Obsidian 会为不存在的目标创建新文件。
        // out-of-scope 的文件实际存在：保留打开行为，只显示范围警告标识。
        new Notice(t("relation.state.missing", { target: link.target }));
        options.onInvalidClick?.(link.target);
        return;
      }
      void app?.workspace.openLinkText(link.target, row.file.path);
      if (state === "out-of-scope") {
        new Notice(t("relation.state.out-of-scope", { target: link.target }), 2500);
      }
    };
  });
  return true;
}
