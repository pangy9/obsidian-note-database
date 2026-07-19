import { App } from "obsidian";
import { parseRelationValues } from "../data/RelationLinks";
import { RowData } from "../data/types";
import { setFieldTooltip } from "./FieldTooltip";

export function renderRelationValue(
  parent: HTMLElement,
  app: App | undefined,
  row: RowData,
  value: unknown,
  compact = false,
): boolean {
  const links = parseRelationValues(value);
  if (links.length === 0) return false;
  const wrap = parent.createDiv({ cls: `db-relation-values${compact ? " is-compact" : ""}` });
  setFieldTooltip(wrap, links.map((link) => link.alias || link.target));
  for (const link of links) {
    const anchor = wrap.createEl("a", {
      cls: "db-relation-link internal-link",
      text: link.alias || link.target.split("/").pop() || link.target,
      attr: { href: "#", title: link.target },
    });
    anchor.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void app?.workspace.openLinkText(link.target, row.file.path);
    };
  }
  return true;
}
