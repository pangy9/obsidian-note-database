// 单元格/表单值的写前规范化纯函数：从 DatabaseView 的同名私有方法提取，供快速采集
// 表单（FormModel）使用并可直接在 vitest 测试。零 obsidian 运行时依赖。
import type { ColumnDef } from "./types";
import { isFileFieldKey } from "./FileFields";
import {
  normalizeOptionValueForKey,
  toMultiSelectValuesForKey,
  toValidObsidianTagValues,
} from "./ColumnTypes";

/** frontmatter 实际写键：file.tags 虚拟列落到原生 tags 键，其余原样。 */
export function getFrontmatterWriteKey(col: ColumnDef): string {
  return col.key === "file.tags" ? "tags" : col.key;
}

/** 该列是否可写入：computed/rollup 派生列与只读 file 字段不可写（file.tags 例外）。 */
export function canFillColumn(col: ColumnDef): boolean {
  if (col.type === "computed" || col.type === "rollup") return false;
  if (!isFileFieldKey(col.key)) return true;
  return col.key === "file.tags";
}

/** 显式 UI 输入的值规范化：tags 合法化、multi-select 数组化、select/status 选项值规整。 */
export function normalizeCellValueForChange(col: ColumnDef, value: unknown): unknown {
  if (value == null) return value;
  if (col.key === "file.tags") return toValidObsidianTagValues(value);
  if (col.type === "multi-select") return toMultiSelectValuesForKey(col.key, value);
  if (col.type === "select" || col.type === "status") return normalizeOptionValueForKey(col.key, value);
  return value;
}
