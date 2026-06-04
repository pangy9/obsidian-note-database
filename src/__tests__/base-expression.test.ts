import { describe, expect, it, vi } from "vitest";
import { evaluateBaseFilterExpression } from "../data/BaseExpression";

vi.mock("obsidian", () => ({
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
}));

(globalThis as any).moment = Object.assign(
  (value: unknown) => {
    const date = new Date(value as any);
    return {
      isValid: () => !Number.isNaN(date.getTime()),
      toDate: () => date,
    };
  },
  { isMoment: () => false }
);

function context(frontmatter: Record<string, unknown>) {
  return {
    app: {
      metadataCache: {
        getFileCache: () => null,
        getFirstLinkpathDest: () => null,
      },
    },
    file: {
      name: "task.md",
      basename: "task",
      path: "Projects/task.md",
      extension: "md",
      parent: { path: "Projects" },
      stat: { size: 10, ctime: 0, mtime: 0 },
    },
    frontmatter,
  } as any;
}

describe("BaseExpression", () => {
  it("allows reserved words inside string literals", () => {
    expect(evaluateBaseFilterExpression("note.status == 'for' || note.status == \"while\"", context({ status: "for" }))).toBe(true);
  });

  it("still rejects reserved words used as code", () => {
    expect(() => evaluateBaseFilterExpression("for (;;) true", context({}))).toThrow(/Unsupported Bases expression token: for/);
  });

  it("evaluates list containsAny against array values", () => {
    expect(evaluateBaseFilterExpression("['active', 'todo'].containsAny(tags)", context({ tags: ["todo"] }))).toBe(true);
  });

  it("evaluates list containsAll against array values", () => {
    expect(evaluateBaseFilterExpression("['active', 'todo', 'done'].containsAll(tags)", context({ tags: ["active", "todo"] }))).toBe(true);
  });
});
