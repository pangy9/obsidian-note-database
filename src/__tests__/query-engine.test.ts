import { describe, expect, it, vi } from "vitest";
import { QueryEngine } from "../data/QueryEngine";
import { ColumnDef, RowData } from "../data/types";

vi.mock("obsidian", () => ({
  normalizePath: (path: string) => path.replace(/\/+/g, "/"),
  getAllTags: (cache?: RowData["cache"]) => (cache?.tags || []).map((tag) => tag.tag),
}));

function row(path: string, frontmatter: Record<string, unknown>, cache?: RowData["cache"]): RowData {
  return {
    file: {
      path,
      name: path.split("/").pop() || path,
      basename: (path.split("/").pop() || path).replace(/\.md$/i, ""),
      extension: "md",
      parent: { path: path.includes("/") ? path.split("/").slice(0, -1).join("/") : "" },
      stat: { ctime: 0, mtime: 0, size: 0 },
    } as RowData["file"],
    frontmatter,
    cache,
    computed: {},
  };
}

describe("QueryEngine filters", () => {
  it("matches hasTag filters for frontmatter tags and file.tags with nested tag semantics", () => {
    const engine = new QueryEngine();
    const columns: ColumnDef[] = [
      { key: "tags", label: "Tags", type: "multi-select" },
      { key: "file.tags", label: "File tags", type: "multi-select" },
    ];
    const rows = [
      row("a.md", { tags: ["project/client"] }),
      row("b.md", { tags: ["archive"] }, { tags: [{ tag: "#project/research" }] } as RowData["cache"]),
      row("c.md", { tags: ["other"] }),
    ];

    expect(engine.applyFilters(rows, [{ field: "tags", op: "hasTag", value: "#project" }], "and", columns).map((item) => item.file.path)).toEqual(["a.md"]);
    expect(engine.applyFilters(rows, [{ field: "file.tags", op: "hasTag", value: "project" }], "and", columns).map((item) => item.file.path)).toEqual(["a.md", "b.md"]);
  });

  it("does not treat unrelated text values as equal just because they contain no digits", () => {
    const engine = new QueryEngine();
    const columns: ColumnDef[] = [
      { key: "service", label: "Service", type: "text" },
    ];
    const rows = [
      row("glm.md", { service: "GLM pro" }),
      row("qq.md", { service: "QQ 音乐绿钻" }),
      row("chatgpt.md", { service: "ChatGPT" }),
    ];

    expect(engine.applyFilters(rows, [{ field: "service", op: "eq", value: "QQ 音乐绿钻" }], "and", columns).map((item) => item.file.path)).toEqual(["qq.md"]);
  });
});
