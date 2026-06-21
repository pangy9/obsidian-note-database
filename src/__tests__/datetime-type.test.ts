import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  getAllTags: vi.fn(() => []),
  normalizePath: (path: string) => path.replace(/\/+/g, "/"),
}));

import { inferColumnType } from "../data/FrontmatterScanner";
import { PropertyService } from "../data/PropertyService";

describe("datetime column type", () => {
  it("infers datetime from frontmatter values that include time", () => {
    expect(inferColumnType("starts_at", ["2026-06-04T09:30:00"])).toBe("datetime");
    expect(inferColumnType("starts_at", ["2026-06-04 09:30"])).toBe("datetime");
  });

  it("keeps date-only values as date", () => {
    expect(inferColumnType("due", ["2026-06-04"])).toBe("date");
  });

  it("syncs datetime to Obsidian Date & Time property type", async () => {
    let written = "";
    const app = {
      vault: {
        configDir: ".obsidian",
        adapter: {
          exists: async () => false,
          read: async () => "",
          write: async (_path: string, data: string) => { written = data; },
        },
      },
    };

    await new PropertyService(app as never).setObsidianPropertyType("starts_at", "datetime");

    expect(JSON.parse(written)).toEqual({ types: { starts_at: "datetime" } });
  });
});
