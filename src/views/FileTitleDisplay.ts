import { RowData } from "../data/types";

export interface FileTitleDisplay {
  name: string;
  folderPrefix: string;
  folderPath: string;
  fullPath: string;
  displayPath: string;
  hasDuplicateName: boolean;
}

/** Build the visible file title pieces; duplicate basenames get a muted folder prefix. */
export function getFileTitleDisplay(row: RowData, rows: RowData[]): FileTitleDisplay {
  const name = row.file.basename || row.file.name.replace(/\.md$/, "");
  const fullPath = row.file.path;
  const displayPath = row.file.path.replace(/\.md$/, "");
  const hasDuplicateName = rows.some((candidate) =>
    candidate.file.path !== row.file.path && candidate.file.basename === row.file.basename
  );
  const slash = row.file.path.lastIndexOf("/");
  const folderPrefix = slash >= 0 ? `${row.file.path.slice(0, slash)}/` : "/";
  return {
    name,
    folderPath: folderPrefix,
    fullPath,
    displayPath,
    hasDuplicateName,
    folderPrefix: hasDuplicateName ? folderPrefix : "",
  };
}

/** Render table-style one-line titles with an optional low-emphasis folder prefix. */
export function renderInlineFileTitle(parent: HTMLElement, info: FileTitleDisplay, alwaysShowPath = false): void {
  parent.empty();
  parent.addClass("db-file-title-inline");
  const folderPath = alwaysShowPath ? info.folderPath : info.folderPrefix;
  parent.toggleClass("has-folder-prefix", Boolean(folderPath));
  if (folderPath) {
    if (folderPath === "/") {
      parent.createSpan({ cls: "db-file-title-prefix", text: "" });
    } else {
      parent.createSpan({ cls: "db-file-title-prefix", text: folderPath });
    }
  }
  parent.createSpan({ cls: "db-file-title-name", text: info.name });
}

/** Render card/list titles with the filename as primary text and the path as a footnote. */
export function renderStackedFileTitle(parent: HTMLElement, info: FileTitleDisplay, alwaysShowPath = false): void {
  parent.empty();
  parent.addClass("db-file-title-stacked");
  parent.toggleClass("has-folder-prefix", alwaysShowPath || Boolean(info.folderPrefix));
  parent.createDiv({ cls: "db-file-title-name", text: info.name });
  const folderPath = alwaysShowPath ? info.folderPath : info.folderPrefix;
  if (folderPath) {
    if (folderPath === "/") {
      parent.createDiv({ cls: "db-file-title-prefix", text: "" });
    } else {
      parent.createDiv({ cls: "db-file-title-prefix", text: folderPath });
    }
  }
}
