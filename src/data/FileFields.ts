import { ColumnDef } from "./types";
// 运行时求值函数（依赖 obsidian API：getAllTags/normalizePath）在 FileFieldObsidian.ts；
// 调用方直接从该文件导入。本文件保持纯判定与固定类型映射，供查询/创建链与 vitest 直测。

/** File properties presented as quick-add options in the column manager. */
export const QUICK_ADD_FILE_FIELDS: Array<{ key: string }> = [
  { key: "file.name" },
  { key: "file.path" },
  { key: "file.ctime" },
  { key: "file.mtime" },
  { key: "file.size" },
  { key: "file.folder" },
  { key: "file.ext" },
  { key: "file.basename" },
  { key: "file.tags" },
  { key: "file.links" },
  { key: "file.backlinks" },
  { key: "file.embeds" },
  { key: "aliases" },
];

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
const FILE_SELF_LINK_FIELD_KEYS = new Set(["file.file", "file.path"]);

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

/** Read-only file fields (file.file/path) rendered as a link to the row's file. */
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
