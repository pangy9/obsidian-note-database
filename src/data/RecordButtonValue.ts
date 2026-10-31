import { stringifyValue } from "./Stringify";
import type { ColumnDef, RecordButtonAction, RecordButtonValue } from "./types";
import { planRecordButton } from "./RecordButton";
import { t } from "../i18n";

export interface ButtonValueRecord { path: string; frontmatter: Record<string, unknown>; body?: string }
export interface ButtonValueContext {
  trigger: ButtonValueRecord;
  target?: ButtonValueRecord;
  created?: ButtonValueRecord;
  variables: Map<string, unknown>;
  now: Date;
  schemas?: { trigger: ColumnDef[]; target?: ColumnDef[]; created?: ColumnDef[] };
}
export function buttonDate(now: Date, timestamp = false, offset = 0): string {
  if (!Number.isInteger(offset) || Math.abs(offset) > 365000) throw new Error(t("button.workflow.invalidDate"));
  const date = new Date(now); date.setDate(date.getDate() + offset);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return timestamp ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : day;
}
function field(record: ButtonValueRecord | undefined, key: string, columns?: ColumnDef[]): unknown {
  if (!record || !key || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error(t("button.workflow.missingValue", { value: key }));
  if (key === "file.body") return record.body ?? "";
  if (key === "file.path") return record.path;
  if (key === "file.name") return record.path.split("/").pop();
  if (key === "file.basename") return record.path.split("/").pop()!.replace(/\.md$/i, "");
  if (key === "file.link") return `[[${record.path.replace(/\.md$/i, "")}]]`;
  if (columns && !columns.some(column => column.key === key && !["button", "computed", "rollup"].includes(column.type))) throw new Error(t("button.missingField", { field: key }));
  return Object.prototype.hasOwnProperty.call(record.frontmatter, key) ? structuredClone(record.frontmatter[key]) : "";
}
function token(value: string, ctx: ButtonValueContext): unknown {
  const date = /^(today|now)([+-]\d+)?$/.exec(value);
  if (date) return buttonDate(ctx.now, date[1] === "now", Number(date[2] || 0));
  const match = /^(trigger|target|created|var)\.(.+)$/.exec(value);
  if (!match) throw new Error(t("button.workflow.missingValue", { value }));
  if (match[1] === "var") {
    if (!ctx.variables.has(match[2])) throw new Error(t("button.workflow.missingValue", { value }));
    return structuredClone(ctx.variables.get(match[2]));
  }
  const scope = match[1] as "trigger" | "target" | "created";
  return field(ctx[scope], match[2], ctx.schemas?.[scope]);
}
export function resolveButtonTemplate(template: string, ctx: ButtonValueContext): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    const value = token(key, ctx);
    return Array.isArray(value) ? value.join(", ") : value == null ? "" : stringifyValue(value);
  });
}
export function resolveButtonValue(value: RecordButtonValue, ctx: ButtonValueContext): unknown {
  switch (value.source) {
    case "literal": return structuredClone(value.value);
    case "template": return resolveButtonTemplate(String(value.value), ctx);
    case "variable": return token(`var.${String(value.value)}`, ctx);
    case "trigger": case "target": case "created": return field(ctx[value.source], String(value.value), ctx.schemas?.[value.source]);
    case "date": return buttonDate(ctx.now, value.value === "now", value.offsetDays ?? 0);
    default: throw new Error(t("button.workflow.missingValue", { value: String(value.source) }));
  }
}
export function resolveButtonAction(action: RecordButtonAction, column: ColumnDef, ctx: ButtonValueContext): RecordButtonAction {
  if (!action.dynamic) return action;
  let value = resolveButtonValue(action.dynamic, ctx);
  if (column.type === "number" || column.type === "currency") {
    if (typeof value === "string" && value.trim()) value = Number(value);
  } else if (column.type === "checkbox") {
    if (value === "true") value = true;
    if (value === "false") value = false;
  } else if (column.type === "multi-select" || column.type === "relation") {
    if (typeof value === "string") value = value ? [value] : [];
  } else if (value instanceof Date) value = buttonDate(value, column.type === "datetime");
  else if (typeof value === "number" || typeof value === "boolean") value = stringifyValue(value);
  return { ...action, dynamic: undefined, value: value as RecordButtonAction["value"] };
}
/** Target values see earlier actions in this step. Trigger stays the original click snapshot. */
export function applyButtonActions(actions: RecordButtonAction[], columns: ColumnDef[], ctx: ButtonValueContext): void {
  if (!ctx.target) throw new Error(t("button.workflow.missingValue", { value: "target" }));
  for (const action of actions) {
    const column = columns.find(c => c.key === action.field);
    if (!column) throw new Error(t("button.missingField", { field: action.field }));
    const resolved = resolveButtonAction(action, column, ctx);
    const updates = planRecordButton({ label: "step", actions: [resolved] }, columns, ctx.target.frontmatter, ctx.now);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) delete ctx.target.frontmatter[key]; else ctx.target.frontmatter[key] = value;
    }
  }
}
