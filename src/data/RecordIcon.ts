import { ColumnDef, DatabaseConfig, ViewConfig } from "./types";

export const RECORD_ICON_COLORS = [
  "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink",
  "red", "slate", "cyan", "teal", "lime", "indigo", "violet", "rose",
] as const;

export type RecordIconColor = typeof RECORD_ICON_COLORS[number];

export type ParsedRecordIcon =
  | { kind: "emoji"; emoji: string }
  | { kind: "lucide"; icon: string; color: RecordIconColor };

const LUCIDE_TOKEN = /^lucide:([a-z0-9-]+)(?:@([a-z]+))?$/;
const EMOJI_COMPONENT = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
type SegmenterInstance = { segment(input: string): Iterable<unknown> };
type SegmenterConstructor = new (locale?: string, options?: { granularity: "grapheme" }) => SegmenterInstance;
let graphemeSegmenter: SegmenterInstance | null = null;

function isSingleEmojiGrapheme(value: string): boolean {
  if (!value || !EMOJI_COMPONENT.test(value)) return false;
  const Segmenter = (Intl as unknown as { Segmenter: SegmenterConstructor }).Segmenter;
  graphemeSegmenter ??= new Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(graphemeSegmenter.segment(value)).length === 1;
}

export function parseRecordIconToken(value: unknown, validLucideIds: ReadonlySet<string>): ParsedRecordIcon | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  const lucide = token.match(LUCIDE_TOKEN);
  if (lucide) {
    const icon = lucide[1];
    const color = (lucide[2] || "gray") as RecordIconColor;
    if (!validLucideIds.has(icon) || !RECORD_ICON_COLORS.includes(color)) return null;
    return { kind: "lucide", icon, color };
  }
  return isSingleEmojiGrapheme(token) ? { kind: "emoji", emoji: token } : null;
}

export function serializeLucideIconToken(icon: string, color: RecordIconColor): string {
  return `lucide:${icon}@${color}`;
}

export function isWritableRecordIconColumn(view: ViewConfig, key: string | undefined): boolean {
  if (!key || key.startsWith("file.")) return false;
  return view.schema.columns.some((column) => column.key === key && column.type === "text");
}

export function resolveRecordIconField(database: DatabaseConfig, view: ViewConfig): string | undefined {
  const key = view.recordIconFieldOverrideEnabled === true
    ? view.recordIconField
    : database.recordIconField;
  return isWritableRecordIconColumn(view, key) ? key : undefined;
}

export function getRecordIconFieldLabel(database: DatabaseConfig, view: ViewConfig): string | undefined {
  const key = resolveRecordIconField(database, view);
  if (!key) return undefined;
  const column = view.schema.columns.find((candidate) => candidate.key === key);
  return column ? column.label || column.key : undefined;
}

export function getOrderedRecordIconColumns(view: ViewConfig, current?: string): ColumnDef[] {
  return view.schema.columns
    .filter((column) => column.type === "text" && !column.key.startsWith("file."))
    .sort((a, b) => {
      const rank = (column: ColumnDef) => column.key === "icon" ? 0 : column.key === current ? 1 : 2;
      return rank(a) - rank(b) || (a.label || a.key).localeCompare(b.label || b.key);
    });
}

export function updateDatabaseRecordIconFieldReference(
  database: DatabaseConfig,
  oldKey: string,
  newKey: string,
): boolean {
  if (database.recordIconField !== oldKey || oldKey === newKey) return false;
  database.recordIconField = newKey;
  return true;
}

export function removeDatabaseRecordIconFieldReference(database: DatabaseConfig, key: string): boolean {
  if (database.recordIconField !== key) return false;
  database.recordIconField = undefined;
  return true;
}
