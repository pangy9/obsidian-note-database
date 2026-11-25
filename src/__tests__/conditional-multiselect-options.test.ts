import { it, expect, vi } from "vitest";
import { setLocale } from "../i18n";
setLocale("en");

import { ViewConfigPanelRenderer } from "../views/ViewConfigPanelRenderer";
import type { ColumnDef, DatabaseConfig, ViewConfig } from "../data/types";
import type { DropdownFieldOptions } from "../views/DropdownField";

const { dropdown } = vi.hoisted(() => ({ dropdown: vi.fn<(options: DropdownFieldOptions) => object>(() => ({ button: {} })) }));
vi.mock("obsidian", () => ({ TFile: class {}, TFolder: class {}, Modal: class {}, FuzzySuggestModal: class {}, SuggestModal: class {}, Notice: class {}, setIcon() {}, setTooltip() {}, addIcon() {}, normalizePath: (s: string) => s }));
vi.mock("../views/DropdownField", () => ({ createDropdownField: dropdown, closeDropdownForRoot() {} }));
vi.mock("../views/DateValuePicker", () => ({ closeActiveDateValuePicker() {}, renderDateValuePicker() {} }));

class ElementStub {
  children: ElementStub[] = [];
  disabled = false;
  value = "";
  ownerDocument = {};
  constructor(readonly tag = "div", readonly options?: { cls?: string; text?: string; attr?: Record<string, string> }) {}
  private add(tag:string, opts?: ElementStub["options"]) { const child = new ElementStub(tag, opts); this.children.push(child); return child; }
  createEl(tag:string,opts?:ElementStub["options"]) { return this.add(tag,opts); }
  createDiv(opts?:ElementStub["options"]) { return this.add("div",opts); }
  createSpan(opts?:ElementStub["options"]) { return this.add("span",opts); }
  empty() { this.children = []; }
  walk(): ElementStub[] { return [this, ...this.children.flatMap(c => c.walk())]; }
}
it("keeps existing choices selectable when a multiselect condition uses the normal Contains operator", () => {
  const columns: ColumnDef[] = [{ key: "topic", label: "Topic", type: "multi-select", statusOptions: [{value:"Science",color:"green"},{value:"History",color:"gray"}] }];
  const schema = { columns, computedFields: [] };
  const config: ViewConfig = { name: "View", sourceFolder: "", schema, conditionalFormats: [{ id:"contains", target:"record", color:"red", condition:{field:"topic",op:"contains",value:"Science"} }] };
  const db: DatabaseConfig = { name:"DB",id:"db",sourceFolder:"",schema,views:[config] };
  const host = new ElementStub();
  (new ViewConfigPanelRenderer() as unknown as {renderConditionalFormatting(...args: unknown[]): void}).renderConditionalFormatting(host, config, db, {onChange: vi.fn()}, false);
  const choices = dropdown.mock.calls.find(([config]) => config.className?.includes("db-conditional-format-value"))?.[0].options.map(option => option.value);
  expect(choices).toEqual(["","Science","History"]);
});
