import { describe, expect, it, vi } from "vitest";
import { BaseExpressionContext, evaluateBaseFilterExpression } from "../data/BaseExpression";

// eslint-disable-next-line obsidianmd/no-global-this -- test setup needs globalThis to mock globals
const _g = globalThis as unknown as Record<string, unknown>;

vi.mock("obsidian", () => ({
  getAllTags: () => [],
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/+$/, ""),
}));

_g.moment = Object.assign(
  (value: unknown) => {
    const date = new Date(value as string | number | Date);
    return {
      isValid: () => !Number.isNaN(date.getTime()),
      toDate: () => date,
    };
  },
  { isMoment: () => false }
);

interface EvalContext {
  app: {
    metadataCache: {
      getFileCache: () => null;
      getFirstLinkpathDest: () => null;
    };
  };
  file: {
    name: string;
    basename: string;
    path: string;
    extension: string;
    parent: { path: string };
    stat: { size: number; ctime: number; mtime: number };
  };
  frontmatter: Record<string, unknown>;
}

function context(frontmatter: Record<string, unknown>): BaseExpressionContext {
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
  } as unknown as BaseExpressionContext;
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
