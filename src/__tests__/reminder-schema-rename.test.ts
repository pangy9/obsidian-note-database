import {afterEach, expect, it, vi} from "vitest";
import {TFile} from "obsidian";
import Plugin from "../main";
import {DataSource} from "../data/DataSource";
import {RecordReminderService} from "../data/RecordReminderService";
import {RecordReminderSettingsModal} from "../views/modals/RecordReminderModal";
import {DatabaseView} from "../views/DatabaseView";
import {ColumnOperations} from "../views/ColumnOperations";
import {ViewStateStore} from "../views/ViewStateStore";
import {setLocale} from "../i18n";
setLocale("en");


const notice = vi.hoisted(() => ({notification: vi.fn()}));
vi.mock("obsidian", () => ({
  Plugin: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {}, FileView: class {},
  MarkdownRenderChild: class {}, Component: class {}, Scope: class {}, Modal: class {},
  MarkdownView: class {}, TFile: class {}, TFolder: class {}, Platform: {isMobile: false},
  addIcon(){}, normalizePath(path: string){return path;},
  Notice: class {constructor(_message: unknown, ms?: number){if (ms === 10000) notice.notification();} hide(){}},
}));

afterEach(() => {vi.useRealTimers(); notice.notification.mockClear();});

function fixture({restricted, complete, legacy = false}: {restricted: boolean; complete: boolean; legacy?: boolean}) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 25, 12));
  const file = (path: string) => Object.assign(new TFile(), {path, extension:"md", basename:path.split("/").at(-1)!.slice(0,-3)});
  const [definition, a, b] = ["DB.md","Tasks/A.md",legacy ? "Archive/B.md" : "Tasks/B.md"].map(file);
  const due = "2026-11-25T11:00";
  const raw = new Map([
    [definition.path, {db_view:true,database:{
      id:"tasks",name:"Tasks",sourceFolder:legacy ? "" : "Tasks",
      columns:[{key:"due",label:"Due",type:"datetime"},{key:"done",label:"Done",type:"checkbox"}],
      views:[{id:"one",name:"One",viewType:"table",sourceFolder:legacy ? "Tasks" : "",viewSourceRulesEnabled:restricted,sourceRules:[{field:"team",op:"eq",value:"A"}]},
        {id:"all",name:"All",viewType:"table",sourceFolder:legacy ? "Tasks" : ""}],
    }}],
    [a.path,{due,done:!legacy,team:"A"}],
    [b.path,{due,done:complete,team:"B"}],
  ] as Array<[string, Record<string, unknown>]>);
  const workspace = {containerEl:{ownerDocument:{createDocumentFragment:() => ({createEl:() => ({addClass(){},onclick:null})})}}};
  const app = {workspace,vault:{getMarkdownFiles:()=>[definition,a,b]},metadataCache:{ getFileCache:(f: TFile) => ({frontmatter:raw.get(f.path)}) }};
  const source = new DataSource(app as any);
  // Only the Obsidian storage boundary is replaced. Both queries are DataSource's actual implementation.
  const dbStart = source.getViewDefFiles()[0].config;
  const hooks: { betweenRecordWrites?: () => Promise<void> } = {};
  Object.assign(source,{
    readViewDefSnapshot: async (path: string) => ({typedConfig:source.getViewDefFiles()[0].config,rawPayload:structuredClone(raw.get(path)!.database)}),
    readFrontmatterKeySnapshots: async (path: string, keys: string[]) => Object.fromEntries(keys.map(key => [key,{exists:Object.prototype.hasOwnProperty.call(raw.get(path)!,key),value:raw.get(path)![key]}])),
    patchViewDefConfig: async (path: string, _before:unknown, after:unknown, _typed:unknown, mutation:any) => {
      raw.get(path)!.database=structuredClone(after);
      source.invalidateRecordCache();
      source.notifyViewConfigChanged(mutation);
    },
    patchFrontmatter: async (path: string, _before:unknown, writes:Record<string, {kind:string; value?:unknown}>) => {
      for (const [key, write] of Object.entries(writes)) {
        if (write.kind === "set") raw.get(path)![key]=write.value; else delete raw.get(path)![key];
      }
      source.invalidateRecordCache();
      if (path === a.path) await hooks.betweenRecordWrites?.();
    },
  });
  const view = Object.assign(Object.create(DatabaseView.prototype),{
    dataSource:source,getActiveDb:()=>dbStart,getConfig:()=>dbStart.views[0],getCurrentEntry:()=>({sourcePath:definition.path}),
  });
  const settings={recordReminders:{rules:[{id:"r",databaseId:"tasks",enabled:true,dateField:"due",
    completionField:"done",completedValues:[],dateOnlyTime:"09:00",advanceMinutes:0,offsets:[0],activatedAt:+new Date(2026,10,24)}],states:{}}};
  const plugin=Object.assign(Object.create(Plugin.prototype),{settings,settingsWriteTail:Promise.resolve(),saveData:vi.fn(async()=>{})});
  const service=new RecordReminderService(app as any,source,()=>settings.recordReminders,async()=>{},()=>{});
  plugin.recordReminderService=service;
  const published=vi.fn();
  const noop=()=>{};
  const operations=new ColumnOperations({
    app, dataSource:source, getActiveDb:()=>dbStart, getMutableConfig:()=>dbStart.views[0],
    getFilesForConfig:(config:unknown)=>view.getFilesForConfig(config),
    getState:()=>new ViewStateStore().get(0,0,dbStart.views[0]), getActiveDatabaseSourcePath:()=>definition.path,
    getConfigMutationVersion:()=>0, getDatabaseMutation:()=>({dbPath:definition.path,dbId:"tasks"}),
    beginRenameConfigTransaction:noop,endRenameConfigTransaction:noop,saveConfigImmediately:async()=>{},
    refreshSchemaChanged:noop,refreshColumnManager:noop,applyRenameTransactionSuccess:published,
    renameColumnKeyReferences:(rename:unknown)=>plugin.renameReminderField(rename),
  } as any);
  const rename=async (from: string, to: string) => {
    const column = dbStart.schema.columns.find(col => col.key === from)!;
    await operations.renameColumn(column, { key: to, label: to, type: column.type, wrap: false, migrateValues: true });
    expect(published).toHaveBeenCalledOnce();
  };
  return {service,source,rename,raw,view,dbStart,settings,hooks};
}

it("迁移完成字段不应把视图外的已完成记录变成待提醒", async () => {
  const {service,rename,raw,view,dbStart,settings}=fixture({restricted:true,complete:true});
  expect(view.getFilesForConfig(dbStart.views[0]).map((f:TFile)=>f.path)).toEqual(["Tasks/A.md"]);
  expect(service.pending()).toEqual([]);
  await rename("done","completed");
  expect(settings.recordReminders.rules[0].completionField).toBe("completed");
  expect(raw.get("Tasks/A.md")!.completed).toBe(true);
  expect(raw.get("Tasks/B.md")!.completed).toBe(true);
  expect(service.pending().map((r)=>r.path)).toEqual([]);
  service.destroy();
});

it("迁移日期字段不应丢失视图外未完成记录的提醒", async () => {
  const {service,rename,raw,settings}=fixture({restricted:true,complete:false});
  expect(service.pending().map((r)=>r.path)).toEqual(["Tasks/B.md"]);
  await rename("due","deadline");
  expect(settings.recordReminders.rules[0].dateField).toBe("deadline");
  expect(raw.get("Tasks/A.md")!.deadline).toBe("2026-11-25T11:00");
  expect(raw.get("Tasks/B.md")!.deadline).toBe("2026-11-25T11:00");
  expect(service.pending().map((r)=>r.path)).toEqual(["Tasks/B.md"]);
  service.destroy();
});

it("重命名日期字段但日期未变，不应再次通知已报过的时点", async () => {
  const {service,rename}=fixture({restricted:false,complete:false});
  service.tick();
  expect(notice.notification).toHaveBeenCalledOnce();
  await rename("due","deadline");
  expect(service.pending().map((r)=>r.path)).toEqual(["Tasks/B.md"]);
  expect(notice.notification).toHaveBeenCalledOnce();
  service.destroy();
});

it("迁移完成字段期间不应把已迁移的完成任务提前通知", async () => {
  const {service,rename,raw,settings,hooks}=fixture({restricted:false,complete:true});
  let started!:()=>void, resume!:()=>void;
  const reachedWrite=new Promise<void>(resolve=>started=resolve);
  const nextWrite=new Promise<void>(resolve=>resume=resolve);
  hooks.betweenRecordWrites=async()=>{started();await nextWrite;};
  expect(service.pending()).toEqual([]);
  const active=rename("done","completed");
  await reachedWrite;
  expect(settings.recordReminders.rules[0].completionField).toBe("done");
  expect(raw.get("Tasks/A.md")!.completed).toBe(true);
  service.tick(); // existing 30s timer may run as the next asynchronous file write is pending.
  const midCommit = service.pending().map(r=>r.path);
  resume();
  await active;
  expect(service.pending()).toEqual([]);
  expect(midCommit).toEqual([]);
  expect(notice.notification).not.toHaveBeenCalled();
  service.destroy();
});

it("does not include unrelated notes in reminders or migration when old databases store their folder on the views", async () => {
  const {service, source, view, dbStart, settings, rename, raw} = fixture({ restricted: false, complete: false, legacy: true });
  expect(view.getFilesForConfig(dbStart.views[0]).map((f: TFile) => f.path)).toEqual(["Tasks/A.md"]);
  expect(service.pending().map(item => item.path)).toEqual(["Tasks/A.md"]);
  let previewCounts = "";
  const element = {
    createDiv: () => element, createEl: () => element, createSpan: () => element,
    setText(text: string) { previewCounts = text; }, setAttribute() {},
  };
  const modal = Object.assign(Object.create(RecordReminderSettingsModal.prototype), {
    databaseId: dbStart.id, source, settings: settings.recordReminders, button: () => element,
  });
  modal.db = modal.findDatabase();
  modal.renderPreview(element, settings.recordReminders.rules[0], "Test")(true);
  expect(previewCounts).toBe("Due now 1, Skipped 0, Later 0, Excluded 0");
  await rename("due", "deadline");
  expect(raw.get("Tasks/A.md")).toHaveProperty("deadline", "2026-11-25T11:00");
  expect(raw.get("Archive/B.md")).toHaveProperty("due", "2026-11-25T11:00");
  expect(raw.get("Archive/B.md")).not.toHaveProperty("deadline");
  service.destroy();
});
