import { App, FileSystemAdapter, Notice, TFile, normalizePath } from "obsidian";
import { t } from "../i18n";

export interface SavedZipResult {
  path: string;
  file: TFile | null;
  external: boolean;
}

type RequireFn = (id: string) => any;

interface SaveDialogResult {
  canceled?: boolean;
  filePath?: string;
}

/**
 * Save a generated ZIP with a desktop save dialog when available.
 * Falls back to writing inside the vault so mobile or restricted environments still work.
 */
export async function saveZipWithPicker(
  app: App,
  zip: ArrayBuffer,
  defaultFilename: string,
  fallbackVaultFolder: string
): Promise<SavedZipResult | null> {
  const targetPath = await chooseExternalSavePath(app, defaultFilename);
  if (targetPath === null) return null;
  if (targetPath) {
    await writeExternalBinary(targetPath, zip);
    new Notice(t("notice.exportedCsvMarkdownZipExternal", { path: targetPath }));
    return { path: targetPath, file: null, external: true };
  }

  const path = await writeVaultBinary(app, zip, fallbackVaultFolder, defaultFilename);
  const file = app.vault.getAbstractFileByPath(path);
  new Notice(t("notice.exportedCsvMarkdownZip", { path }));
  return { path, file: file instanceof TFile ? file : null, external: false };
}

async function chooseExternalSavePath(app: App, defaultFilename: string): Promise<string | null | undefined> {
  const requireFn = getRequire();
  if (!requireFn) return undefined;
  try {
    const electron = requireFn("electron");
    const dialog = electron?.remote?.dialog || electron?.dialog;
    if (!dialog?.showSaveDialog) return undefined;
    const defaultPath = getDesktopDefaultPath(app, defaultFilename, requireFn);
    const result = await dialog.showSaveDialog({
      title: t("csvMarkdownExport.chooseLocation"),
      defaultPath,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    }) as SaveDialogResult;
    if (result?.canceled || !result?.filePath) return null;
    return result.filePath;
  } catch (err) {
    console.warn("Note Database: save dialog unavailable, falling back to vault export", err);
    return undefined;
  }
}

async function writeExternalBinary(path: string, zip: ArrayBuffer): Promise<void> {
  const requireFn = getRequire();
  if (!requireFn) throw new Error("File system access is unavailable");
  const fs = requireFn("fs");
  const bufferCtor = requireFn("buffer").Buffer as typeof Buffer;
  await fs.promises.writeFile(path, bufferCtor.from(new Uint8Array(zip)));
}

async function writeVaultBinary(
  app: App,
  zip: ArrayBuffer,
  folder: string,
  filename: string
): Promise<string> {
  const path = getAvailableVaultPath(app, folder, filename);
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (parent) await ensureFolder(app, parent);
  await app.vault.adapter.writeBinary(path, zip);
  return path;
}

function getDesktopDefaultPath(app: App, filename: string, requireFn: RequireFn): string {
  const adapter = app.vault.adapter;
  const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
  if (!basePath) return filename;
  try {
    const path = requireFn("path");
    return path.join(basePath, filename);
  } catch {
    return `${basePath}/${filename}`;
  }
}

function getAvailableVaultPath(app: App, folder: string, filename: string): string {
  const safeFolder = normalizePath(folder || "").replace(/^\/+|\/+$/g, "");
  const dot = filename.lastIndexOf(".");
  const name = dot >= 0 ? filename.slice(0, dot) : filename;
  const ext = dot >= 0 ? filename.slice(dot) : "";
  let candidate = normalizePath(safeFolder ? `${safeFolder}/${filename}` : filename);
  let index = 1;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = normalizePath(safeFolder ? `${safeFolder}/${name} ${index}${ext}` : `${name} ${index}${ext}`);
    index++;
  }
  return candidate;
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = normalizePath(folderPath || "").split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

function getRequire(): RequireFn | null {
  return (window as Window & { require?: RequireFn }).require ||
    null;
}
