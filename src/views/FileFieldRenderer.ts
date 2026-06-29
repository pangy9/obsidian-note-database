import type { App } from "obsidian";
import { normalizeOptionValueForKey, toValidObsidianTagValues } from "../data/ColumnTypes";
import { isFileLinkListField, isFileSelfLinkField } from "../data/FileFields";
import { stringifyValue } from "../data/Stringify";
import { ColumnDef, RowData } from "../data/types";
import { setFieldTooltip } from "./FieldTooltip";

interface ParsedFileLink {
  label: string;
  target: string;
}

export interface FileFieldRenderContext {
  tagsContainerClass?: string;
  linkContainerClass?: string;
  linkItemClass?: string;
}

export function shouldRenderSpecialFileField(col: ColumnDef): boolean {
  return col.key === "file.tags" || isFileLinkListField(col.key) || isFileSelfLinkField(col.key);
}

export function renderSpecialFileFieldValue(
  parent: HTMLElement,
  app: App | undefined,
  row: RowData,
  col: ColumnDef,
  value: unknown,
  context: FileFieldRenderContext = {}
): boolean {
  if (col.key === "file.tags") {
    renderFileTags(parent, value, col, context);
    return true;
  }
  if (isFileLinkListField(col.key)) {
    renderFileLinkList(parent, app, row, value, context);
    return true;
  }
  if (isFileSelfLinkField(col.key)) {
    renderFileSelfLink(parent, app, row, value, context);
    return true;
  }
  return false;
}

export function renderFileTags(parent: HTMLElement, value: unknown, col: ColumnDef, context: FileFieldRenderContext = {}): void {
  const values = toValidObsidianTagValues(value);
  const wrap = parent.createDiv({ cls: context.tagsContainerClass || "db-file-tags db-multi-select-values" });
  setFieldTooltip(wrap, values);
  for (const item of values) {
    const badge = wrap.createSpan({ cls: "status-badge", text: item });
    const option = col.statusOptions?.find((candidate) => normalizeOptionValueForKey("file.tags", candidate.value) === item);
    if (option?.color && option.color !== "gray") badge.addClass(`status-color-${option.color}`);
    badge.addClass("db-file-tag-badge");
    badge.title = item;
  }
}

export function renderFileLinkList(
  parent: HTMLElement,
  app: App | undefined,
  row: RowData,
  value: unknown,
  context: FileFieldRenderContext = {}
): void {
  const links = normalizeFileLinkValues(value);
  const wrap = context.linkContainerClass
    ? parent.createDiv({ cls: context.linkContainerClass })
    : context.linkItemClass
      ? parent
      : parent.createDiv({ cls: "db-file-link-list" });
  setFieldTooltip(wrap, links.map((link) => link.label));
  for (const link of links) {
    const itemClass = context.linkItemClass || "db-file-link-list-item";
    const anchor = wrap.createEl("a", { cls: `internal-link ${itemClass}`, text: link.label, attr: { title: link.target } });
    anchor.href = "#";
    anchor.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void app?.workspace.openLinkText(link.target, row.file.path, false);
    };
  }
}

/** Render file.file/file.path/file.basename as a link that opens the row's own file. */
export function renderFileSelfLink(
  parent: HTMLElement,
  app: App | undefined,
  row: RowData,
  value: unknown,
  context: FileFieldRenderContext = {}
): void {
  const text = stringifyValue(value).trim();
  if (!text) return;
  const itemClass = context.linkItemClass || "db-file-self-link";
  const anchor = parent.createEl("a", {
    cls: `internal-link ${itemClass}`,
    text,
    attr: { title: row.file.path, href: "#" },
  });
  anchor.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void app?.workspace.getLeaf(false).openFile(row.file);
  };
}

function normalizeFileLinkValues(value: unknown): ParsedFileLink[] {
  const entries = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const links: ParsedFileLink[] = [];
  for (const entry of entries) {
    const parsed = parseFileLinkValue(entry);
    if (!parsed || seen.has(parsed.target)) continue;
    seen.add(parsed.target);
    links.push(parsed);
  }
  return links;
}

function parseFileLinkValue(value: unknown): ParsedFileLink | null {
  const raw = typeof value === "object" && value
    ? getObjectLinkText(value as Record<string, unknown>)
    : stringifyValue(value);
  const text = raw.trim();
  if (!text) return null;

  const wikilink = text.match(/^\[\[([\s\S]*?)\]\]$/);
  if (wikilink) return parseWikilinkInner(wikilink[1]);

  const markdownLink = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (markdownLink) {
    const target = markdownLink[2].trim();
    const label = markdownLink[1].trim() || target;
    return target ? { label, target } : null;
  }

  return { label: getLinkLabel(text), target: text };
}

function getObjectLinkText(value: Record<string, unknown>): string {
  if (typeof value.path === "string") return value.path;
  if (typeof value.link === "string") return value.link;
  if (typeof value.name === "string") return value.name;
  return stringifyValue(value);
}

function parseWikilinkInner(inner: string): ParsedFileLink | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf("|");
  if (separator >= 0) {
    const target = trimmed.slice(0, separator).trim();
    const label = trimmed.slice(separator + 1).trim() || getLinkLabel(target);
    return target ? { label, target } : null;
  }
  return { label: getLinkLabel(trimmed), target: trimmed };
}

function getLinkLabel(target: string): string {
  const withoutSubpath = target.split("#", 1)[0] || target;
  const basename = withoutSubpath.split("/").filter(Boolean).pop() || target;
  return basename.replace(/\.md$/i, "") || target;
}
