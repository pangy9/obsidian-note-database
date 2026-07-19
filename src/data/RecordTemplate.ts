import { parseYaml } from "obsidian";
import { NewRecordTemplateConfig } from "./types";
import type { MomentConstructor } from "./MomentTypes";

declare const moment: MomentConstructor;

export interface ParsedRecordTemplate {
  frontmatter: Record<string, unknown>;
  body: string;
  engine: NewRecordTemplateConfig["engine"];
}

export function parseRecordTemplate(text: string, engine: NewRecordTemplateConfig["engine"]): ParsedRecordTemplate {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/);
  if (!match) return { frontmatter: {}, body: text, engine };
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatter = { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    throw new Error("Invalid template frontmatter");
  }
  delete frontmatter.db_view;
  delete frontmatter.database;
  return { frontmatter, body: text.slice(match[0].length), engine };
}

function resolveCoreString(value: string, title: string): string {
  return value
    .replace(/\{\{title\}\}/gi, title)
    .replace(/\{\{date(?::([^}]+))?\}\}/gi, (_match, format?: string) =>
      moment().format((format || "YYYY-MM-DD").trim()))
    .replace(/\{\{time(?::([^}]+))?\}\}/gi, (_match, format?: string) =>
      moment().format((format || "HH:mm").trim()));
}

function resolveCoreValue(value: unknown, title: string): unknown {
  if (typeof value === "string") return resolveCoreString(value, title);
  if (Array.isArray(value)) return value.map((entry) => resolveCoreValue(entry, title));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, resolveCoreValue(entry, title)])
    );
  }
  return value;
}

export function resolveCoreRecordTemplate(template: ParsedRecordTemplate, title: string): ParsedRecordTemplate {
  if (template.engine !== "core") return template;
  return {
    ...template,
    frontmatter: resolveCoreValue(template.frontmatter, title) as Record<string, unknown>,
    body: resolveCoreString(template.body, title),
  };
}
