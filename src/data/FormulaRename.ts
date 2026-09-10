import type { ColumnDef } from "./types";
import { FORMULA_BUILTIN_CONSTANTS, scanFormulaSegments } from "./FormulaTokenizer";
import { FORMULA_FILE_FIELDS } from "./FormulaFields";

/**
 * 把公式表达式中对 `names`（旧 key/label）的字段引用统一改写为 `newKey`。
 *
 * 独立成模块（而非放在 ColumnConfig.ts）是因为它只依赖 obsidian-free 的
 * FormulaTokenizer / FormulaFields，便于单元测试直接导入——ColumnConfig.ts
 * 经 FileFields 间接依赖 `obsidian` 运行时，无法在 vitest（node 环境）中解析。
 *
 * 全部走 schema-aware scanFormulaSegments（跳过字符串/注释/正则、递归模板、
 * member-ref 由扫描器产生），不再对原始表达式跑正则。修复 GPT 复核：
 *   ① 字符串内引用不改写；
 *   ② [多词标签] 不破坏；
 *   ③ 内置/语言字面量不随同名列改写；
 *   ④ 字符串内 note.price 不被正则误改；
 *   ⑤ 传入 schema 字段集合后 [2024 price] 解析为整体字段引用而非数组，避免把
 *      内部的裸 price 误改成 cost（而真正被引用的完整字段 2024 price 不应改动）。
 */
export function replaceFormulaFieldReferences(
  expression: string,
  names: Set<string>,
  newKey: string,
  knownFields: ReadonlySet<string>
): string {
  const segments = scanFormulaSegments(expression, knownFields);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const seg of segments) {
    if (seg.kind === "bracket-ref") {
      if (names.has(seg.name)) replacements.push({ start: seg.start, end: seg.end, text: `[${newKey}]` });
    } else if (seg.kind === "field-call") {
      if (names.has(seg.name)) replacements.push({ start: seg.start, end: seg.end, text: `field(${seg.quote}${newKey}${seg.quote})` });
    } else if (seg.kind === "member-ref") {
      // formula.total 的重命名集合用完整键 formula.total，需匹配 object.name；其余（note.x/properties.x）按 name。
      const fullKey = seg.object === "formula" ? `formula.${seg.name}` : seg.name;
      if (seg.object === "formula" ? names.has(fullKey) : names.has(seg.name)) {
        const text = seg.object === "formula"
          ? `formula[${JSON.stringify(newKey.startsWith("formula.") ? newKey.slice("formula.".length) : newKey)}]`
          : `${seg.object}[${JSON.stringify(newKey)}]`;
        replacements.push({ start: seg.start, end: seg.end, text });
      }
    } else if (seg.kind === "identifier" && !seg.isCall && !seg.isMember && !FORMULA_BUILTIN_CONSTANTS.has(seg.text) && names.has(seg.text)) {
      const replacement = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newKey) ? newKey : `note[${JSON.stringify(newKey)}]`;
      replacements.push({ start: seg.start, end: seg.end, text: replacement });
    }
  }
  let result = expression;
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    result = result.slice(0, replacements[i].start) + replacements[i].text + result.slice(replacements[i].end);
  }
  return result;
}

/**
 * 为列重命名构建 schema-aware 字段名集合。
 * 必须额外包含 names（旧 key/label），因为执行重命名时 schema 可能已保存了新 key，
 * 旧 key 不再出现在 columns 中——但仍需让扫描器把 [oldKey] 识别为字段引用。
 * 同步纳入文件字段 key/label，确保 [file.name] 之类不被当成数组。
 */
export function buildRenameKnownFields(columns: ColumnDef[], names: ReadonlySet<string>): Set<string> {
  const fields = new Set<string>(names);
  for (const col of columns) {
    fields.add(col.key);
    if (col.label) fields.add(col.label);
  }
  for (const f of FORMULA_FILE_FIELDS) {
    fields.add(f.key);
    if (f.label) fields.add(f.label);
  }
  return fields;
}
