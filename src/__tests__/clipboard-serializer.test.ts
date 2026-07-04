import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseClipboardTable, serializeCellMatrix } from "../data/ClipboardSerializer";

vi.mock("obsidian", () => ({}));

describe("ClipboardSerializer", () => {
  it("treats a single-line markdown sentence with commas as one plain-text cell", () => {
    const text = "**Bold**, *italic*, ==highlight==, ~~strike~~, `code`, [a link](Note), and $E=mc^2$ math.";

    expect(parseClipboardTable(text)).toEqual([[text]]);
  });

  it("parses explicit quoted CSV but leaves unquoted single-line comma text intact", () => {
    expect(parseClipboardTable('"a,b","c"')).toEqual([["a,b", "c"]]);
    expect(parseClipboardTable("a,b")).toEqual([["a,b"]]);
  });

  it("keeps multiline one-column clipboard text with commas as one cell per line", () => {
    expect(parseClipboardTable("alpha, beta\ngamma, delta")).toEqual([
      ["alpha, beta"],
      ["gamma, delta"],
    ]);
  });

  it("keeps newlines inside quoted CSV cells", () => {
    expect(parseClipboardTable('"line 1\nline 2","next"')).toEqual([["line 1\nline 2", "next"]]);
  });

  it("parses TSV rows with quoted tabs and newlines", () => {
    const text = '"a\tb"\t"line 1\nline 2"\tplain';

    expect(parseClipboardTable(text)).toEqual([["a\tb", "line 1\nline 2", "plain"]]);
  });

  it("parses markdown tables as data rows and respects escaped pipes", () => {
    const text = [
      "| A | B |",
      "| --- | --- |",
      "| a\\|b | c |",
    ].join("\n");

    expect(parseClipboardTable(text)).toEqual([["a|b", "c"]]);
  });

  it("round-trips serialized TSV, CSV, and Markdown table content", () => {
    const matrix = [["a\tb", "line 1\nline 2", 'quote "x"', "a|b", "comma, text"]];

    expect(parseClipboardTable(serializeCellMatrix("tsv", matrix))).toEqual(matrix);
    expect(parseClipboardTable(serializeCellMatrix("csv", matrix))).toEqual(matrix);
    expect(parseClipboardTable(serializeCellMatrix("markdown", matrix, ["A", "B", "C", "D", "E"]))).toEqual([[
      "a\tb",
      "line 1 line 2",
      'quote "x"',
      "a|b",
      "comma, text",
    ]]);
  });

  it("serializes CSV cells with quotes so simple copied columns paste back as columns", () => {
    const matrix = [["a", "b"]];

    expect(serializeCellMatrix("csv", matrix)).toBe('"a","b"');
    expect(parseClipboardTable(serializeCellMatrix("csv", matrix))).toEqual(matrix);
  });

  it("wires table copy and paste through shared clipboard helpers", () => {
    const dashboard = readFileSync(new URL("../views/DatabaseView.ts", import.meta.url), "utf8");
    const embedded = readFileSync(new URL("../views/EmbeddedDatabaseRenderer.ts", import.meta.url), "utf8");

    expect(dashboard).toContain("parseClipboardTable(text)");
    expect(dashboard).toContain("serializeClipboardSelectedCells(");
    expect(dashboard).not.toContain("private parseClipboardTable(");
    expect(dashboard).not.toContain("private parseCsvLine(");
    expect(embedded).toContain("serializeSelectedCells(format");
  });
});
