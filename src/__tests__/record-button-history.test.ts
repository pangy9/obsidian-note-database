import { setLocale } from "../i18n";
import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { DataSource } from "../data/DataSource";
import { EmbeddedDataOperations } from "../views/EmbeddedDataOperations";
import { applyFrontmatterWrites, verifyFrontmatterExpect } from "../data/FrontmatterPatch";
import type { FrontmatterKeySnapshot, FrontmatterWrite } from "../data/RenameTransaction";
import type { ColumnDef, RecordButtonConfig } from "../data/types";
setLocale("en");
vi.mock("obsidian", () => ({ TFile: class {}, Notice: class {}, normalizePath: (path: string) => path }));

function fixture() {
  const button: RecordButtonConfig = { label: "Finish", actions: [
    { field: "count", fieldType: "number", operation: "increment", value: 1 },
    { field: "done", fieldType: "checkbox", operation: "set", value: true },
    { field: "empty", fieldType: "text", operation: "clear" },
  ] };
  const columns: ColumnDef[] = [
    { key: "count", label: "Count", type: "number" }, { key: "done", label: "Done", type: "checkbox" },
    { key: "empty", label: "Empty", type: "text" }, { key: "button", label: "Button", type: "button", buttonConfig: button },
  ];
  const fm: Record<string, unknown> = { count: 3, empty: null, unrelated: "keep" };
  const file = new TFile();
  const app = { vault: { getAbstractFileByPath: () => file } } as unknown as App;
  const data = {
    readViewDefSnapshot: vi.fn(async () => ({ typedConfig: { id: "db", schema: { columns } } })),
    readFrontmatterKeySnapshots: vi.fn(async (_path: string, keys: string[]) => Object.fromEntries(keys.map((key) => [key, Object.prototype.hasOwnProperty.call(fm, key) ? { exists: true, value: structuredClone(fm[key]) } : { exists: false }]))),
    patchFrontmatter: vi.fn(async (_path: string, expected: Record<string, FrontmatterKeySnapshot>, writes: Record<string, FrontmatterWrite>, guard?: () => void) => {
      guard?.();
      if (!verifyFrontmatterExpect(fm, expected).ok) throw new Error("Conflict");
      applyFrontmatterWrites(fm, writes);
    }),
  };
  let writable = true;
  const operations = new EmbeddedDataOperations(app, data as unknown as DataSource, "test", () => ({ path: "DB.md", dbId: "db", viewId: "view" }), () => writable, vi.fn());
  return { fm, columns, button, data, operations, readonly: () => { writable = false; } };
}

describe("production embedded button history", () => {
  it("commits all actions once, undoes exactly including null/absent, and redoes", async () => {
    const f = fixture();
    expect(await f.operations.runButton("record.md", "button", f.button)).toBe(true);
    expect(f.data.patchFrontmatter).toHaveBeenCalledTimes(1);
    expect(f.fm).toEqual({ count: 4, done: true, unrelated: "keep" });
    expect(f.operations.undoLabel).toBe("Finish");
    await f.operations.replay("undo");
    expect(f.fm).toEqual({ count: 3, empty: null, unrelated: "keep" });
    expect(f.operations.canUndo).toBe(false);
    expect(f.operations.canRedo).toBe(true);
    await f.operations.replay("redo");
    expect(f.fm).toEqual({ count: 4, done: true, unrelated: "keep" });
  });
  it("does not pop undo or overwrite a later external edit", async () => {
    const f = fixture();
    await f.operations.runButton("record.md", "button", f.button);
    f.fm.count = 99;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await f.operations.replay("undo"); } finally { log.mockRestore(); }
    expect(f.fm).toEqual({ count: 99, done: true, unrelated: "keep" });
    expect(f.operations.canUndo).toBe(true);
    expect(f.operations.canRedo).toBe(false);
  });
  it("does not execute in a read-only embed", async () => {
    const f = fixture(); f.readonly();
    expect(await f.operations.runButton("record.md", "button", f.button)).toBe(false);
    expect(f.data.patchFrontmatter).not.toHaveBeenCalled();
  });
  it("rejects a removed target without writing or adding history", async () => {
    const f = fixture(); f.columns.splice(1, 1);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(await f.operations.runButton("record.md", "button", f.button)).toBe(false); } finally { log.mockRestore(); }
    expect(f.data.patchFrontmatter).not.toHaveBeenCalled();
    expect(f.operations.canUndo).toBe(false);
  });
});
