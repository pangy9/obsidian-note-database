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

function rowWithCtime(path: string, ctime: number): RowData {
  const base = row(path, {});
  (base.file as unknown as { stat: { ctime: number; mtime: number; size: number } }).stat = { ctime, mtime: 0, size: 0 };
  return base;
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

describe("QueryEngine checkbox filters", () => {
  it("treats false / empty-string / null / missing key all as unchecked (empty), true as checked (notempty)", () => {
    // Regression: previously `false` was stringified to "false" and counted as not-empty,
    // so two equally-unchecked notes (one `""`, one `false`) landed in different buckets.
    const engine = new QueryEngine();
    const columns: ColumnDef[] = [{ key: "done", label: "Done", type: "checkbox" }];
    const rows = [
      row("checked.md", { done: true }),
      row("false.md", { done: false }),
      row("empty-string.md", { done: "" }),
      row("missing.md", {}),
    ];
    const filter = (op: "empty" | "notempty") =>
      engine.applyFilters(rows, [{ field: "done", op }], "and", columns).map((item) => item.file.path);

    expect(filter("empty")).toEqual(["false.md", "empty-string.md", "missing.md"]);
    expect(filter("notempty")).toEqual(["checked.md"]);
  });
});

describe("QueryEngine date sorting", () => {
  it("sorts a date column ascending by local timestamp", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "due", label: "Due", type: "date" };
    const rows = [
      row("c.md", { due: "2026-06-06" }),
      row("a.md", { due: "2026-06-04" }),
      row("b.md", { due: "2026-06-05" }),
    ];
    expect(engine.sort(rows, col, "asc").map((r) => r.file.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("sorts datetime values within the same day by time of day", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "due", label: "Due", type: "datetime" };
    const rows = [
      row("late.md", { due: "2026-06-04T18:00" }),
      row("noon.md", { due: "2026-06-04T12:00" }),
      row("morn.md", { due: "2026-06-04T09:00" }),
    ];
    expect(engine.sort(rows, col, "asc").map((r) => r.file.path)).toEqual(["morn.md", "noon.md", "late.md"]);
  });

  it("keeps empty date values first when ascending", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "due", label: "Due", type: "date" };
    const rows = [
      row("b.md", { due: "2026-06-05" }),
      row("empty.md", { due: "" }),
      row("a.md", { due: "2026-06-04" }),
    ];
    expect(engine.sort(rows, col, "asc")[0].file.path).toBe("empty.md");
  });
});

describe("QueryEngine date filtering", () => {
  it("compares datetime values with gt/lt using local wall-clock time", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "due", label: "Due", type: "datetime" };
    const rows = [
      row("early.md", { due: "2026-06-04T09:00" }),
      row("late.md", { due: "2026-06-04T18:00" }),
    ];
    expect(engine.applyFilters(rows, [{ field: "due", op: "lt", value: "2026-06-04T12:00" }], "and", [col]).map((r) => r.file.path)).toEqual(["early.md"]);
  });

  it("lets file.ctime (millisecond number) be compared with gt/lt", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "file.ctime", label: "Created", type: "date" };
    const rows = [rowWithCtime("old.md", 1000), rowWithCtime("new.md", 2000)];
    expect(engine.applyFilters(rows, [{ field: "file.ctime", op: "gt", value: "1500" }], "and", [col]).map((r) => r.file.path)).toEqual(["new.md"]);
  });
});

describe("QueryEngine date column grouping", () => {
  it("merges same-day values for a date column (cleans dirty timed values)", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "due", label: "Due", type: "date" };
    const rows = [
      row("a.md", { due: "2026-06-04" }),
      row("b.md", { due: "2026-06-04T09:30" }),
      row("c.md", { due: "2026-06-05" }),
    ];
    expect(engine.groupBy(rows, "due", [], col).map((g) => g.key).sort()).toEqual(["2026-06-04", "2026-06-05"]);
  });

  it("keeps datetime column keys distinct (no merge)", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "due", label: "Due", type: "datetime" };
    const rows = [
      row("a.md", { due: "2026-06-04T09:00" }),
      row("b.md", { due: "2026-06-04T18:00" }),
    ];
    expect(engine.groupBy(rows, "due", [], col).map((g) => g.key).sort()).toEqual(["2026-06-04T09:00", "2026-06-04T18:00"]);
  });

  it("merges datetime values by date when dateGroupMode is 'date'", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "due", label: "Due", type: "datetime" };
    const config = { dateGroupModes: { due: "date" } } as never;
    const rows = [
      row("a.md", { due: "2026-06-04T09:00" }),
      row("b.md", { due: "2026-06-04T18:00" }),
      row("c.md", { due: "2026-06-05T12:00" }),
    ];
    // "date" mode ignores the time → same-day values merge into one dateKey group.
    expect(engine.groupBy(rows, "due", [], col, config).map((g) => g.key).sort()).toEqual(["2026-06-04", "2026-06-05"]);
  });

  it("normalizes file.ctime grouping to date keys", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "file.ctime", label: "Created", type: "date" };
    const rows = [
      rowWithCtime("a.md", new Date(2026, 5, 4, 9, 30).getTime()),
      rowWithCtime("b.md", new Date(2026, 5, 4, 18, 0).getTime()),
      rowWithCtime("c.md", new Date(2026, 5, 5).getTime()),
    ];
    expect(engine.groupBy(rows, "file.ctime", [], col).map((g) => g.key).sort()).toEqual(["2026-06-04", "2026-06-05"]);
  });
});

describe("QueryEngine uncategorized grouping", () => {
  it("keeps uncategorized groups for rows without a group value", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "tags", label: "Tags", type: "multi-select" };
    const rows = [
      row("a.md", { tags: ["Alpha"] }),
      row("b.md", { tags: [] }),
      row("c.md", {}),
      row("d.md", { tags: ["Alpha", "Beta"] }),
    ];

    const groups = engine.groupBy(rows, "tags", [], col);
    expect(groups.map((group) => group.key).sort()).toEqual(["Alpha", "Beta", "Uncategorized"]);
    expect(groups.find((group) => group.key === "Alpha")?.rows.map((item) => item.file.path)).toEqual(["a.md", "d.md"]);
    expect(groups.find((group) => group.key === "Uncategorized")?.rows.map((item) => item.file.path)).toEqual(["b.md", "c.md"]);
  });

  it("uses uncategorized for empty scalar option values", () => {
    const engine = new QueryEngine();
    const col: ColumnDef = { key: "status", label: "Status", type: "status" };
    const rows = [
      row("a.md", { status: "Todo" }),
      row("b.md", { status: "" }),
      row("c.md", {}),
    ];

    expect(engine.groupBy(rows, "status", [], col).map((group) => group.key).sort()).toEqual(["Todo", "Uncategorized"]);
  });
});

describe("QueryEngine aliases", () => {
  it("treats a comma-string aliases value as a list for filtering and grouping", () => {
    const engine = new QueryEngine();
    const columns: ColumnDef[] = [{ key: "aliases", label: "Aliases", type: "multi-select" }];
    const rows = [
      row("ab.md", { aliases: "alpha, beta" }),
      row("g.md", { aliases: "gamma" }),
      row("arr.md", { aliases: ["alpha", "delta"] }),
    ];

    // eq matches by list element; the comma-string row must match "alpha" like the array row.
    expect(engine.applyFilters(rows, [{ field: "aliases", op: "eq", value: "alpha" }], "and", columns).map((r) => r.file.path).sort()).toEqual(["ab.md", "arr.md"]);

    // grouping splits the comma-string into separate groups (not one "alpha, beta" group).
    expect(engine.groupBy(rows, "aliases", [], columns[0]).map((group) => group.key).sort()).toEqual(["alpha", "beta", "delta", "gamma"]);

    // contains must not substring-match across the comma boundary of the combined string.
    expect(engine.applyFilters(rows, [{ field: "aliases", op: "contains", value: "lpha, b" }], "and", columns)).toEqual([]);
  });
});
