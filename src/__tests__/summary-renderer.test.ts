import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line import/no-nodejs-modules
import { readFileSync } from "node:fs";
import { SummaryRenderer } from "../views/SummaryRenderer";
import { RowData, ViewConfig } from "../data/types";
import { setLocale, t } from "../i18n";

vi.mock("obsidian", () => ({
  getAllTags: () => [],
  normalizePath: (value: string) => value,
  TFile: class {},
}));

class FakeElement {
  readonly children: FakeElement[] = [];
  textContent = "";
  parent: FakeElement | null = null;
  className = "";

  constructor(readonly tagName: string) {}

  createDiv(options?: { cls?: string; text?: string }): FakeElement {
    return this.createChild("div", options);
  }

  createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeElement {
    return this.createChild("span", options);
  }

  querySelector(selector: string): FakeElement | null {
    const cls = selector.startsWith(".") ? selector.slice(1) : selector;
    return this.find((element) => element.className.split(/\s+/).includes(cls));
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }

  allText(): string[] {
    return [
      ...(this.textContent ? [this.textContent] : []),
      ...this.children.flatMap((child) => child.allText()),
    ];
  }

  private createChild(tagName: string, options?: { cls?: string; text?: string }): FakeElement {
    const child = new FakeElement(tagName);
    child.parent = this;
    child.className = options?.cls || "";
    child.textContent = options?.text || "";
    this.children.push(child);
    return child;
  }

  private find(predicate: (element: FakeElement) => boolean): FakeElement | null {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child.find(predicate);
      if (match) return match;
    }
    return null;
  }
}

function row(path: string, frontmatter: Record<string, unknown>): RowData {
  return {
    file: { path, name: path.split("/").pop() || path } as RowData["file"],
    frontmatter,
    computed: {},
  };
}

function config(summaryRules?: Record<string, string>): ViewConfig {
  return {
    name: "Table",
    sourceFolder: "",
    viewType: "table",
    schema: {
      columns: [
        { key: "file.name", label: "Name", type: "text" },
        { key: "amount", label: "Amount", type: "number" },
      ],
      computedFields: [],
    },
    summaryRules,
  };
}

describe("SummaryRenderer", () => {
  it("shows the record total without enabling optional numeric summaries", () => {
    const container = new FakeElement("div");

    new SummaryRenderer().render(container as unknown as HTMLElement, [
      row("a.md", { amount: 2 }),
      row("b.md", { amount: 3 }),
    ], config());

    expect(container.allText()).toEqual(["Total", "2"]);
  });

  it("does not render summaries for calendar and timeline views", () => {
    for (const viewType of ["calendar", "timeline"] as const) {
      const container = new FakeElement("div");
      const renderer = new SummaryRenderer();
      renderer.render(container as unknown as HTMLElement, [
        row("a.md", { amount: 2 }),
      ], config());

      renderer.render(container as unknown as HTMLElement, [
        row("a.md", { amount: 2 }),
      ], { ...config({ amount: "SUM" }), viewType });

      expect(container.allText()).toEqual([]);
    }
  });

  it("renders an opt-in SUM summary from view summaryRules", () => {
    const container = new FakeElement("div");

    new SummaryRenderer().render(container as unknown as HTMLElement, [
      row("a.md", { amount: 2 }),
      row("b.md", { amount: 3 }),
    ], config({ amount: "SUM" }));

    expect(container.allText()).toEqual(["Total", "2", "Amount Sum", "5"]);
  });

  it("renders flexible built-in summaries from view summaryRules", () => {
    const container = new FakeElement("div");

    new SummaryRenderer().render(container as unknown as HTMLElement, [
      row("a.md", { amount: 2, status: "todo" }),
      row("b.md", { amount: 4, status: "done" }),
      row("c.md", { amount: 6, status: "done" }),
    ], {
      ...config(),
      schema: {
        columns: [
          { key: "file.name", label: "Name", type: "text" },
          { key: "amount", label: "Amount", type: "number" },
          { key: "status", label: "Status", type: "status" },
        ],
        computedFields: [],
      },
      summaryRules: { amount: "AVERAGE", status: "UNIQUE" },
    });

    expect(container.allText()).toEqual(["Total", "3", "Amount Average", "4", "Status Unique", "2"]);
  });

  it("uses the shared summary renderer in dashboard and embedded render paths", () => {
    for (const file of ["DatabaseView.ts", "EmbeddedDatabaseRenderer.ts"]) {
      const source = readFileSync(new URL(`../views/${file}`, import.meta.url), "utf8");
      expect(source).toContain("new SummaryRenderer()");
      expect(source).toContain("this.summaryRenderer.render");
    }
  });

  it("exposes field-first summary selection instead of flattening every field aggregation", () => {
    const summary = readFileSync(new URL("../views/SummaryRenderer.ts", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    expect(summary).toContain("getSummaryKindsForColumn");
    expect(summary).toContain("getSummaryFieldOptions");
    expect(summary).toContain("getSummaryAggregationOptions");
    expect(summary).toContain("openSummaryFieldMenu");
    expect(summary).toContain("openSummaryAggregationMenu");
    expect(summary).not.toContain("flatMap((col) => getSummaryKindsForColumn");
    expect(summary).toContain("SUM");
    expect(summary).toContain("AVERAGE");
    expect(summary).toContain("MEDIAN");
    expect(summary).toContain("STDDEV");
    expect(summary).toContain("CHECKED");
    expect(summary).toContain("EARLIEST");
    expect(dashboard).toContain("onChange: () =>");
    expect(embedded).toContain("onChange: () =>");
  });

  it("defines summary settings labels in all locales", () => {
    for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
      setLocale(locale);
      expect(t("viewConfig.summarySumField")).not.toBe("viewConfig.summarySumField");
      expect(t("viewConfig.summarySumFieldNone")).not.toBe("viewConfig.summarySumFieldNone");
      expect(t("viewConfig.summaryField")).not.toBe("viewConfig.summaryField");
      expect(t("viewConfig.summaryFieldNone")).not.toBe("viewConfig.summaryFieldNone");
      expect(t("viewConfig.summaryAdd")).not.toBe("viewConfig.summaryAdd");
      expect(t("viewConfig.summaryStddev")).not.toBe("viewConfig.summaryStddev");
    }
    setLocale("system");
  });
});
