import { App, CachedMetadata, getAllTags, normalizePath, TFile } from "obsidian";
import { toValidObsidianTagValues } from "./ColumnTypes";
import { stringifyValue } from "./Stringify";
import { ColumnDef, RowData } from "./types";

export const BASE_FILE_FIELD_KEYS = new Set([
  "file.file",
  "file.name",
  "file.basename",
  "file.path",
  "file.folder",
  "file.ext",
  "file.extension",
  "file.ctime",
  "file.created",
  "file.mtime",
  "file.modified",
  "file.size",
  "file.tags",
  "file.links",
  "file.backlinks",
  "file.embeds",
  "file.properties",
]);

const EDITABLE_FILE_FIELD_KEYS = new Set(["file.name", "file.tags"]);
const FILE_LINK_LIST_FIELD_KEYS = new Set(["file.links", "file.backlinks", "file.embeds"]);
/** Read-only file identity fields rendered as a link that opens the row's own file. */
const FILE_SELF_LINK_FIELD_KEYS = new Set(["file.file", "file.path", "file.basename"]);

/** Any file.* key is reserved for virtual file metadata, even if unsupported. */
export function isFileFieldKey(key: string): boolean {
  return key.startsWith("file.");
}

/** Supported built-in file fields that the plugin knows how to resolve. */
export function isSupportedFileField(key: string): boolean {
  return BASE_FILE_FIELD_KEYS.has(key);
}

/** File fields that have an explicit write path outside normal frontmatter properties. */
export function isEditableFileField(key: string): boolean {
  return EDITABLE_FILE_FIELD_KEYS.has(key);
}

/** Readonly file metadata fields, including unsupported reserved file.* keys. */
export function isReadonlyFileField(key: string): boolean {
  return isFileFieldKey(key) && !isEditableFileField(key);
}

/** File fields that should render as Obsidian links instead of option badges. */
export function isFileLinkListField(key: string): boolean {
  return FILE_LINK_LIST_FIELD_KEYS.has(key);
}

/** Read-only file fields (file.file/path/basename) rendered as a link to the row's file. */
export function isFileSelfLinkField(key: string): boolean {
  return FILE_SELF_LINK_FIELD_KEYS.has(key);
}

export function isBaseFileField(key: string): boolean {
  return BASE_FILE_FIELD_KEYS.has(key);
}

export function getFileFieldFixedType(key: string): ColumnDef["type"] {
  if (key === "file.ctime" || key === "file.created" || key === "file.mtime" || key === "file.modified") return "date";
  if (key === "file.size") return "number";
  if (key === "file.tags") return "multi-select";
  return "text";
}

export function getBaseFileFieldType(key: string): ColumnDef["type"] {
  return getFileFieldFixedType(key);
}

export function getFileFieldValue(
  file: TFile,
  key: string,
  frontmatter?: Record<string, unknown>,
  cache?: CachedMetadata | null,
  app?: App
): unknown {
  if (key === "file.name") return file.name;
  if (key === "file.file") return file.path;
  if (key === "file.basename") return file.basename || file.name.replace(/\.md$/i, "");
  if (key === "file.path") return file.path;
  if (key === "file.folder") return file.parent?.path || "";
  if (key === "file.ext" || key === "file.extension") return file.extension;
  if (key === "file.ctime" || key === "file.created") return file.stat.ctime;
  if (key === "file.mtime" || key === "file.modified") return file.stat.mtime;
  if (key === "file.size") return file.stat.size;
  if (key === "file.tags") {
    return toValidObsidianTagValues([
      ...toValidObsidianTagValues(frontmatter?.["tags"]),
      ...(cache ? getAllTags(cache) || [] : []),
    ]);
  }
  if (key === "file.links") return getFileLinks(cache);
  if (key === "file.embeds") return getFileEmbeds(cache);
  if (key === "file.backlinks") return getFileBacklinks(app, file);
  if (key === "file.properties") return frontmatter || {};
  return undefined;
}

export function getRowFileFieldValue(row: RowData, key: string): unknown {
  return getFileFieldValue(row.file, key, row.frontmatter, row.cache, row.app);
}

export function fileHasLink(app: App | undefined, file: TFile, target: unknown, cache?: CachedMetadata | null): boolean {
  if (!app) return false;
  const targetText = getLinkTargetText(target);
  if (!targetText) return false;
  return getFileLinks(cache).some((link) => {
    const dest = app.metadataCache.getFirstLinkpathDest(link, file.path);
    return link === targetText ||
      normalizePath(stripLinkSubpath(link)) === normalizePath(stripLinkSubpath(targetText)) ||
      dest?.path === normalizePath(stripLinkSubpath(targetText)) ||
      dest?.basename === targetText ||
      dest?.name === targetText;
  });
}

function getFileLinks(cache?: CachedMetadata | null): string[] {
  const links = [
    ...(cache?.links || []).map((link) => link.link),
    ...Object.values(cache?.frontmatterLinks || {}).map((link) => link.link),
  ];
  return Array.from(new Set(links.filter(Boolean)));
}

function getFileEmbeds(cache?: CachedMetadata | null): string[] {
  return Array.from(new Set((cache?.embeds || []).map((link) => link.link).filter(Boolean)));
}

function getFileBacklinks(app: App | undefined, file: TFile): string[] {
  const resolvedLinks = app?.metadataCache.resolvedLinks;
  if (!resolvedLinks) return [];
  return Object.entries(resolvedLinks)
    .filter(([_source, targets]) => targets && Object.prototype.hasOwnProperty.call(targets, file.path))
    .map(([source]) => source)
    .sort();
}

function getLinkTargetText(target: unknown): string {
  if (target && typeof target === "object") {
    const source = target as Record<string, unknown>;
    if (typeof source.path === "string") return parseLinkTargetText(source.path);
    if (typeof source.name === "string") return parseLinkTargetText(source.name);
  }
  return parseLinkTargetText(stringifyValue(target));
}

function parseLinkTargetText(value: string): string {
  const trimmed = value.trim();
  const wikilink = trimmed.match(/^\[\[([\s\S]*?)\]\]$/);
  const inner = wikilink ? wikilink[1].trim() : trimmed;
  const separator = inner.indexOf("|");
  return separator >= 0 ? inner.slice(0, separator).trim() : inner;
}

function stripLinkSubpath(value: string): string {
  return value.split("#", 1)[0];
}
