import { expect, it } from "vitest";
import { collectDueRecordReminders, getRecordReminderRulePreview } from "../data/RecordReminders";
import type { DatabaseConfig } from "../data/types";
import type { NoteRecord } from "../data/DataSource";

const db: DatabaseConfig = { id:"db", name:"Tasks", sourceFolder:"",
  schema:{columns:[{key:"due",label:"Due",type:"date"},{key:"done",label:"Done",type:"checkbox"}],computedFields:[]},views:[] };
const rule = {id:"r",databaseId:"db",enabled:true,dateField:"due",completionField:"done",completedValues:[],
  dateOnlyTime:"09:00",advanceMinutes:0,offsets:[0],activatedAt:+new Date(2026,1,26,9)};
const record = (value: string): NoteRecord => ({file:{path:"Task.md",basename:"Task"},frontmatter:{due:value,done:false}} as unknown as NoteRecord);
const now = +new Date(2026,2,2,10);
const examine = (date: string) => {
  const records = [record(date)];
  const preview = getRecordReminderRulePreview(rule,db,records,now);
  return {
    previewNow:preview.now.map(r=>[r.reason, r.dueAt && new Date(r.dueAt).toISOString()]),
    previewExcluded:preview.excluded.map(r=>r.reason),
    pending:collectDueRecordReminders({rules:[rule],states:{}},[{database:db,records}],now)
      .map(r=>new Date(r.dueAt).toISOString()),
  };
};
it("纯日期不能把不存在的 2026/02/30 当成 3 月 2 日触发提醒", () => {
  expect(examine("2026-02-30")).toEqual({previewNow:[],previewExcluded:["noDate"],pending:[]});
  expect(examine("2026/03/02").pending).toEqual([new Date(2026,2,2,9).toISOString()]);
  const actual = examine("2026/02/30");
  expect(actual).toEqual({previewNow:[],previewExcluded:["noDate"],pending:[]});
});

it("纯日期提醒不会截取损坏日期的有效前缀", () => {
  for (const input of ["2026-03-020", "2026-03-02xyz", "2026/03/020", "2026-03-02 99:00"]) {
    expect(examine(input)).toEqual({ previewNow: [], previewExcluded: ["noDate"], pending: [] });
  }
  expect(examine("2026-3-2").pending).toEqual([new Date(2026, 2, 2, 9).toISOString()]);
});
