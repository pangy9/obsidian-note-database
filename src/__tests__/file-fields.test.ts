import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";

vi.mock("obsidian", () => ({
  getAllTags: vi.fn(() => []),
  normalizePath: (path: string) => path.replace(/\/+/g, "/"),
}));

import {
  getInvalidObsidianTagValues,
  normalizeValidObsidianTagValue,
  toValidObsidianTagValues,
  validateObsidianTagValue,
} from "../data/ColumnTypes";
import {
  collectFileFrontmatterKeys,
} from "../data/FrontmatterScanner";
import {
  getFileFieldFixedType,
  isEditableFileField,
  isFileFieldKey,
  isFileLinkListField,
  isReadonlyFileField,
  isSupportedFileField,
} from "../data/FileFields";
import { PropertyService } from "../data/PropertyService";

describe("file field classification", () => {
  it("recognizes the reserved file namespace", () => {
    expect(isFileFieldKey("file.name")).toBe(true);
    expect(isFileFieldKey("file.unknown")).toBe(true);
    expect(isFileFieldKey("status")).toBe(false);
  });

  it("separates supported, editable, readonly, and link-list file fields", () => {
    expect(isSupportedFileField("file.name")).toBe(true);
    expect(isSupportedFileField("file.tags")).toBe(true);
    expect(isSupportedFileField("file.unknown")).toBe(false);

    expect(isEditableFileField("file.name")).toBe(true);
    expect(isEditableFileField("file.tags")).toBe(true);
    expect(isEditableFileField("file.path")).toBe(false);

    expect(isReadonlyFileField("file.path")).toBe(true);
    expect(isReadonlyFileField("file.unknown")).toBe(true);
    expect(isReadonlyFileField("file.tags")).toBe(false);

    expect(isFileLinkListField("file.links")).toBe(true);
    expect(isFileLinkListField("file.backlinks")).toBe(true);
    expect(isFileLinkListField("file.embeds")).toBe(true);
    expect(isFileLinkListField("file.tags")).toBe(false);
  });

  it("fixes file field types without sample inference", () => {
    expect(getFileFieldFixedType("file.tags")).toBe("multi-select");
    expect(getFileFieldFixedType("file.links")).toBe("text");
    expect(getFileFieldFixedType("file.backlinks")).toBe("text");
    expect(getFileFieldFixedType("file.embeds")).toBe("text");
    expect(getFileFieldFixedType("file.ctime")).toBe("date");
    expect(getFileFieldFixedType("file.size")).toBe("number");
    expect(getFileFieldFixedType("file.unknown")).toBe("text");
  });
});

describe("file.tags validation", () => {
  it("uses Obsidian tag rules for new file.tags values", () => {
    expect(validateObsidianTagValue("1984").valid).toBe(false);
    expect(validateObsidianTagValue("#1984").valid).toBe(false);
    expect(validateObsidianTagValue("tag with space").valid).toBe(false);

    expect(validateObsidianTagValue("y1984").valid).toBe(true);
    expect(validateObsidianTagValue("1abc").valid).toBe(true);
    expect(validateObsidianTagValue("2024/02").valid).toBe(true);
    expect(validateObsidianTagValue("project-alpha").valid).toBe(true);
  });

  it("normalizes valid tags and reports invalid tags without preserving them", () => {
    expect(normalizeValidObsidianTagValue("#project-alpha")).toBe("project-alpha");
    expect(toValidObsidianTagValues(["#alpha", "123", "tag with space", "2024/02"])).toEqual(["alpha", "2024/02"]);
    expect(getInvalidObsidianTagValues(["#alpha", "123", "tag with space", "2024/02"])).toEqual(["123", "tag with space"]);
  });
});

describe("frontmatter scanning for file fields", () => {
  it("skips reserved file.* frontmatter keys", () => {
    const file = { path: "Projects/task.md" };
    const app = {
      vault: { getMarkdownFiles: () => [file] },
      metadataCache: {
        getFileCache: () => ({
          frontmatter: {
            "file.path": "bad",
            "file.tags": ["bad"],
            status: "todo",
          },
        }),
      },
    };
    const allKeys = new Map<string, string>();
    const sampleValues = new Map<string, unknown[]>();
    const fileCounts = new Map<string, number>();

    collectFileFrontmatterKeys(
      app as never,
      "",
      undefined,
      allKeys,
      sampleValues,
      fileCounts
    );

    expect([...allKeys.keys()]).toEqual(["status"]);
    expect(sampleValues.get("status")).toEqual(["todo"]);
    expect(fileCounts.get("status")).toBe(1);
  });
});

describe("PropertyService file field guards", () => {
  it("does not mutate frontmatter or property types for file.* keys", async () => {
    const mutate = vi.fn();
    const service = new PropertyService({
      vault: {
        adapter: {
          exists: vi.fn(),
          read: vi.fn(),
          write: vi.fn(),
        },
        configDir: ".obsidian",
      },
    } as never, mutate);
    const files = [{ path: "Projects/task.md" }] as never[];

    await service.setObsidianPropertyType("file.path", "text");
    await service.renameKey(files, "file.path", "path", undefined, true);
    await service.ensureKey(files, "file.path");
    await service.copyKey(files, "file.path", "path_copy");
    await service.convertKeyType(files, "file.path", "text");
    await service.deleteKey(files, "file.path");

    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("DatabaseView file field write guards", () => {
  it("allows only file.tags to write through the real tags frontmatter key", () => {
    const source = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");

    expect(source).toContain('return col.key === "file.tags"');
    expect(source).toContain('return col.key === "file.tags" ? "tags" : col.key');
    expect(source).toContain('if (target.key === "file.tags")');
    expect(source).toContain("!isReadonlyFileField(change.key)");
  });

  it("validates file.tags writes and shows labels in readonly notices", () => {
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const cellRenderer = readFileSync(new URL("../views/CellRenderer.ts", import.meta.url), "utf8");

    expect(databaseView).toContain("getInvalidObsidianTagValues");
    expect(databaseView).toContain("showInvalidFileTagsNotice");
    expect(cellRenderer).toContain("normalizeValidObsidianTagValue");
    expect(cellRenderer).toContain("MetadataCacheWithTags");
    expect(cellRenderer).toContain("metadataCache?.getTags?.()");
    expect(cellRenderer).toContain("getVaultTagOptionValues");
    expect(cellRenderer).toContain('t("fileField.readonly", { label: col.label || col.key })');
  });

  it("allows manual file.tags colors without treating tags as normal managed options", () => {
    const databaseView = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const cellRenderer = readFileSync(new URL("../views/CellRenderer.ts", import.meta.url), "utf8");

    expect(cellRenderer).toContain("getFileTagDraftOptions");
    expect(cellRenderer).toContain("persistFileTagColorOptions");
    expect(cellRenderer).not.toContain('if (isFileTags) dot.addClass("is-hidden")');
    expect(databaseView).toContain("normalizeFileTagColorOptions");
    expect(databaseView).toContain("transaction.nextOptions");
    expect(databaseView).toContain('if (color === "gray") continue');
  });

  it("warns when converting a normal property to a file field ignores migration", () => {
    const columnOperations = readFileSync(new URL("../views/ColumnOperations.ts", import.meta.url), "utf8");

    expect(columnOperations).toContain("fileField.migrationIgnored");
    expect(columnOperations).toContain("!oldIsFileField && newIsFileField && result.migrateValues");
  });
});

describe("FormulaModal file.tags help", () => {
  it("shows dedicated file.tags help instead of normal empty options text", () => {
    const formulaModal = readFileSync(new URL("../views/modals/FormulaModal.ts", import.meta.url), "utf8");

    expect(formulaModal).toContain('col.key === "file.tags"');
    expect(formulaModal).toContain("formula.fileTagsHint");
    expect(formulaModal).toContain("return []");
  });
});
