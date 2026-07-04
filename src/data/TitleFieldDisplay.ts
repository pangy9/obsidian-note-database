import { stringifyValue } from "./Stringify";
import { ColumnDef, NO_TITLE_FIELD, RowData, ViewConfig } from "./types";

export const EMPTY_TITLE_PLACEHOLDER = "—";

export interface TitleFieldDisplay {
  field: string | undefined;
  text: string;
  isEmpty: boolean;
  isFileTitle: boolean;
  isHidden: boolean;
}

export function resolveTitleFieldDisplay(row: RowData, config: ViewConfig, titleField: string | undefined): TitleFieldDisplay {
  if (titleField === NO_TITLE_FIELD) {
    return { field: titleField, text: "", isEmpty: false, isFileTitle: false, isHidden: true };
  }

  const field = titleField || "file.name";
  if (field === "file.name" || field === "file.basename") {
    return {
      field,
      text: getFileTitleText(row),
      isEmpty: false,
      isFileTitle: true,
      isHidden: false,
    };
  }

  const value = getTitleFieldValue(row, config, field);
  const text = stringifyValue(value).trim();
  return {
    field,
    text: text || EMPTY_TITLE_PLACEHOLDER,
    isEmpty: !text,
    isFileTitle: false,
    isHidden: false,
  };
}

function getFileTitleText(row: RowData): string {
  return row.file.basename || row.file.name.replace(/\.md$/i, "");
}

function getTitleFieldValue(row: RowData, config: ViewConfig, field: string): unknown {
  if (isTitleFileFieldKey(field)) return getTitleFileFieldValue(row, field);
  const col = config.schema.columns.find((candidate) => candidate.key === field);
  if (!col) return undefined;
  return getColumnValue(row, col);
}

function getColumnValue(row: RowData, col: ColumnDef): unknown {
  if (isTitleFileFieldKey(col.key)) return getTitleFileFieldValue(row, col.key);
  if (col.type === "computed") return row.computed[col.computedKey || col.key];
  return row.frontmatter[col.key];
}

function isTitleFileFieldKey(key: string): boolean {
  return key.startsWith("file.");
}

function getTitleFileFieldValue(row: RowData, key: string): unknown {
  if (key === "file.name") return row.file.name;
  if (key === "file.file") return row.file.path;
  if (key === "file.basename") return row.file.basename || row.file.name.replace(/\.md$/i, "");
  if (key === "file.path") return row.file.path;
  if (key === "file.folder") return row.file.parent?.path || "";
  if (key === "file.ext" || key === "file.extension") return row.file.extension;
  if (key === "file.ctime" || key === "file.created") return row.file.stat.ctime;
  if (key === "file.mtime" || key === "file.modified") return row.file.stat.mtime;
  if (key === "file.size") return row.file.stat.size;
  if (key === "file.tags") return row.frontmatter.tags;
  if (key === "file.links") return row.cache?.links?.map((link) => link.link) || [];
  if (key === "file.embeds") return row.cache?.embeds?.map((link) => link.link) || [];
  if (key === "file.properties") return row.frontmatter;
  return undefined;
}
