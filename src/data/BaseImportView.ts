import { isRecord, safeString } from "./SafeString";
import { ColumnDef } from "./types";

/** 导入确认窗口的属性列表排序方式。 */
export type BaseImportSortKey = "default" | "key-asc" | "key-desc" | "count-desc" | "count-asc";

export const BASE_IMPORT_SORT_KEYS: readonly BaseImportSortKey[] = [
  "default", "key-asc", "key-desc", "count-desc", "count-asc",
];


interface BaseImportColumnLike extends ColumnDef {
  fileCount: number;
}

export type BaseImportSelectionErrorCode = "unsupported-formula-type" | "virtual-property" | "duplicate-property";

/** 纯导入逻辑返回结构化错误，由 UI 层负责本地化。 */
export class BaseImportSelectionError extends Error {
  constructor(
    readonly code: BaseImportSelectionErrorCode,
    readonly property: string,
    readonly propertyType?: string
  ) {
    super(`${code}: ${property}`);
    this.name = "BaseImportSelectionError";
  }
}

/** Resolve selected columns without writing notes or changing formula definitions. */
export function resolveBaseImportSelection<T extends ColumnDef>(columns: readonly T[]): T[] {
  const keys = new Set<string>(["file.name"]);
  return columns.map((column) => {
    const next = { ...column };
    if (next.computedKey && next.type !== "computed") {
      if (next.type !== "text") throw new BaseImportSelectionError("unsupported-formula-type", next.key, next.type);
      next.key = next.computedKey;
      delete next.computedKey;
      // file.* keys are virtual fields, never ordinary frontmatter columns.
      if (next.key.startsWith("file.")) throw new BaseImportSelectionError("virtual-property", next.key);
    }
    if (keys.has(next.key)) throw new BaseImportSelectionError("duplicate-property", next.key);
    keys.add(next.key);
    return next;
  });
}

/**
 * 按搜索词与排序方式返回导入确认窗口应显示的列（原数组不被修改）。
 *
 * 搜索词对 key、列标题与类型显示名做大小写无关的包含匹配；"default" 排序保持
 * 传入顺序（sort 稳定，扫描/导入的自然顺序即用户在 .base 中熟悉的顺序）。
 */
export function orderBaseImportColumns<T extends BaseImportColumnLike>(
  columns: readonly T[],
  query: string,
  sortKey: BaseImportSortKey,
  typeLabel: (type: ColumnDef["type"]) => string
): T[] {
  const text = query.trim().toLowerCase();
  const visible = text
    ? columns.filter((col) => `${col.key}\n${col.label || ""}\n${typeLabel(col.type)}`.toLowerCase().includes(text))
    : [...columns];
  const byKey = (a: T, b: T): number => a.key.localeCompare(b.key);
  switch (sortKey) {
    case "key-asc":
      visible.sort(byKey);
      break;
    case "key-desc":
      visible.sort((a, b) => byKey(b, a));
      break;
    case "count-desc":
      visible.sort((a, b) => b.fileCount - a.fileCount || byKey(a, b));
      break;
    case "count-asc":
      visible.sort((a, b) => a.fileCount - b.fileCount || byKey(a, b));
      break;
    default:
      break;
  }
  return visible;
}

/**
 * 从 .base 顶级 properties 段解析属性显示名（列标题），未声明时返回 fallback。
 *
 * 官方格式中 note 属性不带前缀（`status:`）、file/formula 属性带前缀
 * （`file.ext:`、`formula.x:`），但 order/filter 等引用处又允许带 note./properties.
 * 前缀——不同 Obsidian 版本写出的 properties 段键形制不一，因此对同一逻辑键
 * 依次尝试 raw、清洗后的键与各前缀变体，任一命中即采用其 displayName。
 */
export function resolveBasePropertyDisplayName(
  properties: Record<string, unknown>,
  rawKey: string,
  cleanKey: string,
  fallback: string
): string {
  const candidates = [rawKey, cleanKey];
  if (cleanKey.startsWith("formula.")) {
    candidates.push(`formula.${cleanKey.slice("formula.".length)}`);
  } else {
    candidates.push(`note.${cleanKey}`, `properties.${cleanKey}`, `file.properties.${cleanKey}`);
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    const prop = properties?.[candidate];
    if (isRecord(prop) && prop["displayName"] != null) return safeString(prop["displayName"]);
  }
  return fallback;
}
