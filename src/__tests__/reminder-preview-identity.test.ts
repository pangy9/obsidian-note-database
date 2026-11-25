import { expect, it, vi } from "vitest";
import { LiveReminderRuleDetails } from "../views/modals/LiveReminderRuleDetails";
import { setLocale } from "../i18n";
setLocale("en");
import { getRecordReminderRulePreview } from "../data/RecordReminders";
import type { DatabaseConfig } from "../data/types";
import type { NoteRecord } from "../data/DataSource";

const notice = vi.hoisted(() => vi.fn());
vi.mock("obsidian", () => ({ Component: class {}, Notice: class { constructor(message: string) { notice(message); } }, setIcon() {}, getIconIds: () => [] }));
class ElementStub {
  children: ElementStub[] = [];
  onclick?: () => void;
  inert = false;
  constructor(readonly attrs: Record<string, string> = {}) {}
  createEl(_tag: string, opts?: {attr?: Record<string,string>}) { const node = new ElementStub(opts?.attr); this.children.push(node); return node; }
  createDiv(opts?: {attr?: Record<string,string>}) { return this.createEl("div", opts); }
  createSpan(opts?: {attr?: Record<string,string>}) { return this.createEl("span", opts); }
  setAttribute() {}
  focus() {}
}
const schema = { columns: [{key:"due",label:"Due",type:"datetime"},{key:"done",label:"Done",type:"checkbox"}], computedFields: [] };
const db = { id:"d",name:"Tasks",sourceFolder:"",views:[],schema } as DatabaseConfig;
const rule = { id:"r",databaseId:"d",enabled:true,dateField:"due",completionField:"done",completedValues:[],dateOnlyTime:"09:00",advanceMinutes:0,offsets:[0] };
const path = "Tasks/Invoice.md";
const now = +new Date(2026,10,25,12);
const frontmatter = { due:"2026-11-25T11:00", done:false };

it("已展开预览明细不得打开同路径下内容不同的新笔记", () => {
  const original = {path,basename:"Invoice",body:"Original invoice"};
  const replacement = {path,basename:"Invoice",body:"Other invoice"};
  let file: typeof original | null = original;
  const openNote = vi.fn(async () => {});
  const render = vi.fn();
  const readResult = () => getRecordReminderRulePreview(rule, db, file ? [{file,frontmatter} as unknown as NoteRecord] : [], now);
  const current = readResult();
  const panel = new ElementStub();
  const preview = Object.assign(Object.create(LiveReminderRuleDetails.prototype), {
    app: { vault:{ getFileByPath: (input: string) => input === file?.path ? file : null } },
    panel: Object.assign(panel, {ownerDocument: {activeElement: null}}), hoverParent: { hoverPopover: null },
    hoverRows: new WeakMap(), duplicated: new Set(), list: { scrollTop: 0 }, host: new ElementStub(), recordIcons: { visible:false }, openNote,
    result: current, readResult, render,
    formatter: new Intl.DateTimeFormat("en"), repositionEvent: () => {},
  });
  preview.openEvent(new ElementStub(), current.now[0]);
  preview.event.launch.onclick();
  expect(openNote).toHaveBeenCalledExactlyOnceWith(original);
  openNote.mockClear();
  // Sync/file-manager batch deletes the original and creates a different TFile at the same path
  // before the DataSource's 80ms debounced notification. Its reminder-visible metadata is unchanged.
  file = replacement;
  expect(readResult()).toEqual(current);
  preview.refresh();
  expect(render).toHaveBeenCalledOnce();
  preview.event.launch.onclick();
  expect(openNote).not.toHaveBeenCalled();
  expect(notice).toHaveBeenCalledOnce();
});
