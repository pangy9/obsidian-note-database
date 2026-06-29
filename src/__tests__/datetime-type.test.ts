import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  getAllTags: vi.fn(() => []),
  normalizePath: (path: string) => path.replace(/\/+/g, "/"),
}));

import { inferColumnType } from "../data/FrontmatterScanner";

describe("datetime column type", () => {
  it("infers datetime from frontmatter values that include time", () => {
    expect(inferColumnType("starts_at", ["2026-06-04T09:30:00"])).toBe("datetime");
    expect(inferColumnType("starts_at", ["2026-06-04 09:30"])).toBe("datetime");
  });

  it("keeps date-only values as date", () => {
    expect(inferColumnType("due", ["2026-06-04"])).toBe("date");
  });
});

describe("aliases column type", () => {
  it("forces the built-in aliases list to multi-select (with or without samples)", () => {
    expect(inferColumnType("aliases", ["alpha, beta"])).toBe("multi-select");
    expect(inferColumnType("aliases", [["alpha", "beta"]])).toBe("multi-select");
    expect(inferColumnType("aliases", [])).toBe("multi-select");
  });
});
