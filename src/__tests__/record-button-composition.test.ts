import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { buttonValueToken, composeButtonValue, insertButtonToken, parseButtonText, removeButtonToken, serializeButtonText } from "../data/RecordButtonComposition";
import { renderButtonComposition, buttonTokenOptions } from "../views/modals/RecordButtonValueEditor";
import { buttonActionSummary } from "../views/modals/RecordButtonActionEditor";
import { resolveButtonValue, type ButtonValueContext } from "../data/RecordButtonValue";
import { getPropertyDropdownIcon } from "../views/PropertyTypeIcon";

vi.mock("../views/RecordButtonMenuIcons", async (original) => ({ ...await original<typeof import("../views/RecordButtonMenuIcons")>(), renderButtonMenuIcon: vi.fn() }));
vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../views/DropdownField", () => ({ openDropdownMenu: vi.fn() }));
vi.mock("../views/TextInputCaret", () => ({ getTextInputContentWidth: vi.fn(() => 24) }));
setLocale("en");
import { openDropdownMenu } from "../views/DropdownField";
beforeEach(() => { vi.clearAllMocks(); vi.mocked(openDropdownMenu).mockImplementation(() => vi.fn()); });
const ctx: ButtonValueContext = { trigger: { path: "Notes/中文标题.md", frontmatter: { tags: ["A", "B"], count: 3, done: false }, body: "# 正文\n{{today}} is literal note content" }, variables: new Map(), now: new Date(2026, 9, 30, 12, 34) };

describe("visual button value composition", () => {
  it("summarizes nested operations with readable values, including relative dates and false", () => {
    const base = { field: "status", fieldType: "text" as const, operation: "set" as const, value: "Done" };
    expect(buttonActionSummary(base, { trigger: [] }, [])).toContain("Done");
    expect(buttonActionSummary({ ...base, value: false }, { trigger: [] }, [])).toContain("Unchecked");
    expect(buttonActionSummary({ ...base, dynamic: { source: "trigger", value: "file.basename" } }, { trigger: [] }, [])).toContain("Note title");
    expect(buttonActionSummary({ ...base, dynamic: { source: "date", value: "today", offsetDays: 3 } }, { trigger: [] }, [])).toContain("3");
    expect(buttonActionSummary({ ...base, operation: "clear" }, { trigger: [] }, [])).not.toContain("Done");
  });
  it("round trips legacy templates including spaces, unknown references and multiline text", () => {
    const template = "前缀 {{ trigger.file.basename }}\n{{var.unavailable}} / {{today}} 后缀";
    expect(serializeButtonText(parseButtonText(template))).toBe(template);
  });
  it("inserts at a selection and merges text when deleting a chip", () => {
    const parts = insertButtonToken(parseButtonText("before replace after"), 0, 7, 14, "trigger.file.basename");
    expect(serializeButtonText(parts)).toBe("before {{trigger.file.basename}} after");
    expect(serializeButtonText(removeButtonToken(parts, 1))).toBe("before  after");
  });
  it("keeps typed references until combined with text", () => {
    for (const key of ["tags", "count", "done"]) {
      const single = composeButtonValue(parseButtonText(`{{trigger.${key}}}`));
      expect(resolveButtonValue(single, ctx)).toEqual(ctx.trigger.frontmatter[key]);
    }
    expect(resolveButtonValue(composeButtonValue(parseButtonText("Count: {{trigger.count}}")), ctx)).toBe("Count: 3");
  });
  it("preserves relative dates when adding and removing surrounding text", () => {
    const key = buttonValueToken({ source: "date", value: "today", offsetDays: -2 })!;
    expect(resolveButtonValue(composeButtonValue(parseButtonText(`Due {{${key}}}`)), ctx)).toBe("Due 2026-10-28");
    expect(composeButtonValue(parseButtonText(`{{${key}}}`))).toEqual({ source: "date", value: "today", offsetDays: -2 });
  });
  it("inserts body verbatim without recursively evaluating its contents", () => {
    expect(resolveButtonValue(composeButtonValue(parseButtonText("{{trigger.file.body}}")), ctx)).toBe(ctx.trigger.body);
    expect(resolveButtonValue(composeButtonValue(parseButtonText("Copy\n{{trigger.file.body}}")), ctx)).toBe(`Copy\n${ctx.trigger.body}`);
  });
  it("offers only scopes available at this step", () => {
    const options = buttonTokenOptions({ trigger: [] }, ["result"]);
    expect(options.some(o => o.value === "trigger.file.body")).toBe(true);
    expect(options.some(o => o.value === "var.result")).toBe(true);
    expect(options.some(o => /^(target|created)\./.test(o.value))).toBe(false);
  });
  it("keeps dynamic property icons consistent across source scopes and date values", () => {
    const fields = [{ key: "status", label: "Status", type: "status" as const }, { key: "count", label: "Count", type: "number" as const }];
    const options = buttonTokenOptions({ trigger: fields, target: fields, created: fields }, ["result"]);
    const icon = (value: string) => options.find(option => option.value === value)?.icon;
    for (const scope of ["trigger", "target", "created"]) {
      for (const field of fields) expect(icon(`${scope}.${field.key}`)).toBe(getPropertyDropdownIcon(field.type));
      expect(icon(`${scope}.file.basename`)).toBe(getPropertyDropdownIcon("text"));
      expect(icon(`${scope}.file.link`)).toBe(getPropertyDropdownIcon("relation"));
    }
    expect(icon("today")).toBe(getPropertyDropdownIcon("date"));
    expect(icon("now")).toBe(getPropertyDropdownIcon("datetime"));
    expect(options.every(option => option.icon)).toBe(true);
  });
});

class Node {
  children: Node[] = [];
  style: Record<string, string> = {};
  value = "";
  text = "";
  selectionStart = 0;
  selectionEnd = 0;
  scrollHeight = 28;
  onclick?: () => void;
  oninput?: () => void;
  onkeydown?: (event: unknown) => void;
  onfocus?: () => void;
  onblur?: () => void;
  events: Record<string, () => void> = {};
  addEventListener(type: string, callback: () => void): void { this.events[type] = callback; }
  createEl(_tag: string, options?: { text?: string }): Node { const node = new Node(); node.text = options?.text || ""; this.children.push(node); return node; }
  createDiv(options?: { text?: string }): Node { return this.createEl("div", options); }
  createSpan(options?: { text?: string }): Node { return this.createEl("span", options); }
  addClass(): void {}
  setCssProps(props: Record<string, string>): void { Object.assign(this.style, props); }
  empty(): void { this.children = []; }
  focus(): void { this.onfocus?.(); }
  setSelectionRange(start: number, end: number): void { this.selectionStart = start; this.selectionEnd = end; }
}

describe("composition renderer callbacks", () => {
  it("opens for a typed brace, replaces that brace, and suppresses automatic reopening after Escape", () => {
    const parent = new Node(); const change = vi.fn();
    renderButtonComposition(parent as unknown as HTMLElement, "Title", "Task ", { trigger: [] }, [], change);
    const host = parent.children[0].children[1]; const surface = host.children[0]; const input = surface.children[0];
    input.focus(); expect(openDropdownMenu).not.toHaveBeenCalled();
    input.value = "Task {"; input.setSelectionRange(6, 6); input.oninput!();
    expect(openDropdownMenu).toHaveBeenCalledOnce();
    expect(vi.mocked(openDropdownMenu).mock.calls[0][0].caretLineAnchor).toBe(surface);
    vi.mocked(openDropdownMenu).mock.calls[0][0].onChange("today");
    expect(serializeButtonText(change.mock.calls.at(-1)![0])).toBe("Task {{today}}");
    const after = surface.children[2]; after.value = "{"; after.setSelectionRange(1, 1); after.oninput!();
    const count = vi.mocked(openDropdownMenu).mock.calls.length;
    after.onkeydown!({ key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    after.value = "{{"; after.setSelectionRange(2, 2); after.oninput!();
    expect(openDropdownMenu).toHaveBeenCalledTimes(count);
    host.children[1].onclick!(); expect(openDropdownMenu).toHaveBeenCalledTimes(count + 1);
  });
  it("adds chips at the text caret and deletes them without losing adjacent Chinese text", () => {
    const parent = new Node(); const change = vi.fn();
    renderButtonComposition(parent as unknown as HTMLElement, "Title", "前缀后缀", { trigger: [] }, [], change);
    const host = parent.children[0].children[1]; const surface = host.children[0];
    expect(host.children).toHaveLength(3);
    surface.children[0].setSelectionRange(2, 2); surface.children[0].focus(); host.children[1].onclick!();
    vi.mocked(openDropdownMenu).mock.calls.at(-1)![0].onChange("trigger.file.basename");
    expect(serializeButtonText(change.mock.calls.at(-1)![0])).toBe("前缀{{trigger.file.basename}}后缀");
    surface.children[1].children.at(-1)!.onclick!();
    expect(serializeButtonText(change.mock.calls.at(-1)![0])).toBe("前缀后缀");
  });
  it("opens only on editing, preserves caret selection, and pauses for IME", () => {
    const parent = new Node(); const change = vi.fn();
    renderButtonComposition(parent as unknown as HTMLElement, "Title", "甲乙", { trigger: [] }, [], change);
    expect(openDropdownMenu).not.toHaveBeenCalled();
    const input = parent.children[0].children[1].children[0].children[0];
    input.setSelectionRange(0, 1); input.focus();
    expect(openDropdownMenu).not.toHaveBeenCalled();
    parent.children[0].children[1].children[1].onclick!();
    const menu = vi.mocked(openDropdownMenu).mock.calls.at(-1)![0];
    expect(menu.followCaret).toBe(true); expect(menu.anchor).toBe(input);
    const close = vi.mocked(openDropdownMenu).mock.results.at(-1)!.value;
    input.events.compositionstart(); expect(close).toHaveBeenCalledOnce();
    input.events.compositionend(); expect(openDropdownMenu).toHaveBeenCalledTimes(1);
    parent.children[0].children[1].children[1].onclick!();
    expect(openDropdownMenu).toHaveBeenCalledTimes(2);
    vi.mocked(openDropdownMenu).mock.calls.at(-1)![0].onChange("today");
    expect(serializeButtonText(change.mock.calls.at(-1)![0])).toBe("{{today}}乙");
    const surface = parent.children[0].children[1].children[0];
    expect(surface.children[0].style.width).toBe("2px");
  });
  it("joins multiline text with Backspace without deleting adjacent chips", () => {
    const parent = new Node(); const change = vi.fn();
    renderButtonComposition(parent as unknown as HTMLElement, "Body", "第一行\n第二行{{today}}", { trigger: [] }, [], change, true);
    const surface = parent.children[0].children[1].children[0];
    const input = surface.children[1].children[0]; input.setSelectionRange(0, 0);
    input.onkeydown!({ key: "Backspace", preventDefault: vi.fn() });
    expect(serializeButtonText(change.mock.calls.at(-1)![0])).toBe("第一行第二行{{today}}");
    expect(surface.children).toHaveLength(1);
  });
  it("keeps user-entered text when adding several values in sequence", () => {
    const parent = new Node(); const change = vi.fn();
    renderButtonComposition(parent as unknown as HTMLElement, "Body", "", { trigger: [] }, [], change, true);
    const host = parent.children[0].children[1]; const surface = host.children[0];
    expect(host.children).toHaveLength(3);
    surface.children[0].children[0].focus(); host.children[1].onclick!();
    vi.mocked(openDropdownMenu).mock.calls.at(-1)![0].onChange("trigger.file.basename");
    const input = surface.children[0].children[2]; input.value = "\n说明："; input.setSelectionRange(input.value.length, input.value.length); input.oninput!();
    surface.children[1].children[0].focus(); host.children[1].onclick!();
    vi.mocked(openDropdownMenu).mock.calls.at(-1)![0].onChange("trigger.file.body");
    expect(serializeButtonText(change.mock.calls.at(-1)![0])).toBe("{{trigger.file.basename}}\n说明：{{trigger.file.body}}");
    expect(surface.children).toHaveLength(2);
    expect(surface.children[1].children[0].value).toBe("说明：");
  });
});
