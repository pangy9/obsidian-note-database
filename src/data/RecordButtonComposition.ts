import type { RecordButtonValue } from "./types";

export type ButtonTextPart = { kind: "text"; text: string } | { kind: "token"; key: string; raw: string };

/** Keep original token spelling so opening/saving an existing configuration is lossless. */
export function parseButtonText(text: string): ButtonTextPart[] {
  const parts: ButtonTextPart[] = [];
  let end = 0;
  for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    parts.push({ kind: "text", text: text.slice(end, match.index) });
    parts.push({ kind: "token", key: match[1], raw: match[0] });
    end = match.index + match[0].length;
  }
  parts.push({ kind: "text", text: text.slice(end) });
  return parts;
}
export function serializeButtonText(parts: ButtonTextPart[]): string {
  return parts.map(part => part.kind === "text" ? part.text : part.raw).join("");
}
export function buttonValueToken(value: RecordButtonValue): string | undefined {
  if (["trigger", "target", "created"].includes(value.source)) return `${value.source}.${String(value.value)}`;
  if (value.source === "variable") return `var.${String(value.value)}`;
  if (value.source === "date") return `${String(value.value)}${value.offsetDays ? (value.offsetDays > 0 ? "+" : "") + value.offsetDays : ""}`;
  return undefined;
}
export function buttonTokenValue(key: string): RecordButtonValue | undefined {
  const date = /^(today|now)([+-]\d+)?$/.exec(key);
  if (date) return { source: "date", value: date[1], offsetDays: Number(date[2] || 0) };
  const match = /^(trigger|target|created|var)\.(.+)$/.exec(key);
  if (!match) return undefined;
  return { source: match[1] === "var" ? "variable" : match[1] as "trigger" | "target" | "created", value: match[2] };
}
/** A lone reference keeps arrays/booleans/numbers; mixed content becomes text. */
export function composeButtonValue(parts: ButtonTextPart[]): RecordButtonValue {
  const meaningful = parts.filter(part => part.kind === "token" || part.text !== "");
  if (meaningful.length === 1 && meaningful[0].kind === "token") {
    const value = buttonTokenValue(meaningful[0].key);
    if (value) return value;
  }
  return { source: parts.some(part => part.kind === "token") ? "template" : "literal", value: serializeButtonText(parts) };
}
/** Insert at the selected text range, preserving all surrounding text and references. */
export function insertButtonToken(parts: ButtonTextPart[], index: number, start: number, end: number, key: string): ButtonTextPart[] {
  const part = parts[index];
  if (!part || part.kind !== "text") return parts;
  return [...parts.slice(0, index), { kind: "text", text: part.text.slice(0, start) }, { kind: "token", key, raw: `{{${key}}}` }, { kind: "text", text: part.text.slice(end) }, ...parts.slice(index + 1)];
}
export function removeButtonToken(parts: ButtonTextPart[], index: number): ButtonTextPart[] {
  return parseButtonText(serializeButtonText(parts.filter((_, i) => i !== index)));
}
