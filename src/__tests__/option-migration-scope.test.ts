import {expect, it, vi} from "vitest";
import {TFile} from "obsidian";
import {EmbeddedDataOperations} from "../views/EmbeddedDataOperations";
import {DatabaseView} from "../views/DatabaseView";
import {DataSource} from "../data/DataSource";
import {setLocale} from "../i18n";
import {ViewStateStore} from "../views/ViewStateStore";
import type {DatabaseConfig} from "../data/types";
setLocale("en");


vi.mock("obsidian", () => ({
  Plugin: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {}, FileView: class {},
  MarkdownRenderChild: class {}, Component: class {}, Scope: class {}, Modal: class {},
  MarkdownView: class {}, TFile: class {}, TFolder: class {}, Platform: {isMobile: false},
  Notice: class {}, normalizePath: (p: string) => p, addIcon() {}
}));

function fixture() {
  const option = (value: string) => ({value,color:"gray" as const});
  const previousOptions = ["Done","Next","Later"].map(option);
  const nextOptions = ["Finished","Next","Later"].map(option);
  const definition = "DB.md", selected = "Tasks/Selected.md", hidden = "Tasks/Hidden.md", untouched = "Outside/Other.md";
  const files = Object.fromEntries([definition,selected,hidden,untouched].map(path => [path,Object.assign(new TFile(), {path,extension:"md",basename:path.slice(0,-3).split("/").at(-1)})])) as Record<string,TFile>;
  const raw: Record<string, Record<string, unknown>> = {
    [definition]: {db_view:true,database:{id:"tasks",name:"Tasks",sourceFolder:"Tasks",
      columns:[{key:"status",label:"Status",type:"status",statusOptions:previousOptions}],
      views:[
        {id:"table",name:"Table",viewType:"table",viewSourceRulesEnabled:true,sourceRules:[{field:"team",op:"eq",value:"A"}]},
        {id:"done",name:"Done work",viewType:"table",viewSourceRulesEnabled:true,
          sourceRuleTree:{type:"not",rule:{field:"status",op:"strictNeq",value:"Done",valueType:"string"}},
          filters:[{field:"status",op:"eq",value:"Done"},{field:"status",op:"contains",value:"Done"}],
          viewStates:{board:{filters:[{field:"status",op:"neq",value:"Done"}],statusFilter:"Done"}},
          conditionalFormats:[{id:"cf",condition:{field:"status",op:"eq",value:"Done"},color:"gray",target:"record"}],
          groupOrders:{status:["Done","Next"]}},
      ]}},
    [selected]:{status:"Next",team:"A"},[hidden]:{status:"Done",team:"B"},[untouched]:{status:"Done",team:"B"},
  };
  const app = {vault:{getMarkdownFiles:()=>Object.values(files),getAbstractFileByPath:(p:string)=>files[p]},
    metadataCache:{getFileCache:(f:TFile)=>({frontmatter:raw[f.path]})}};
  const source = new DataSource(app as any);
  const db = source.getViewDefFiles()[0].config;
  const column = db.schema.columns[0];
  const mutations : string[] = [];
  const readDb = () => new DataSource(app as any).parseDatabaseConfig(raw[definition])!;
  Object.assign(source, {
    readFrontmatterKeySnapshots: async (p:string, keys:string[]) =>
      Object.fromEntries(keys.map(key=>[key,{exists:Object.prototype.hasOwnProperty.call(raw[p],key),value:raw[p][key]}])),
    readViewDefSnapshot:async () => ({typedConfig: readDb(),rawPayload:structuredClone(raw[definition].database)}),
    patchViewDefConfig:async (_:string, _before:unknown, next:unknown, _typed:unknown, _mut:unknown, guard:()=>void) => {
      guard(); raw[definition].database = next;
    },
    patchFrontmatter:async (p:string, _expect:unknown, patches:Record<string,{kind:"set",value:unknown}>, guard:()=>void) => {
      guard(); mutations.push(p); Object.entries(patches).forEach(([key,patch])=>{raw[p][key]=patch.value;});
    },
  });
  return {option,previousOptions,nextOptions,definition,selected,hidden,untouched,raw,app,source,db,column,mutations,files,readDb};
}

it("纯改名的批量确认应计入实际写入的记录", async () => {
  const f = fixture();
  const operation = new EmbeddedDataOperations(f.app as any, f.source, "audit",
    () => ({path:f.definition,dbId:"tasks",viewId:"table"}),()=>true,()=>{});
  const reported:number[] = [];
  const ok = await operation.editField([f.selected], f.column, undefined, {
    setValue:false,value:undefined,previousOptions:f.previousOptions,nextOptions:f.nextOptions,
    renameValues:[{from:"Done",to:"Finished"}],
  }, async count => {reported.push(count); return true;});
  expect(ok).toBe(true);
  expect(reported).toEqual([1]);
  expect(f.mutations).toEqual([f.hidden]);
  expect(f.raw[f.hidden].status).toBe("Finished");
  expect(f.raw[f.selected].status).toBe("Next");
  expect(f.raw[f.untouched].status).toBe("Done");
});

it("删除另一选项的记录范围不应因同表单中附带改名而扩大", () => {
  const f = fixture();
  const view = Object.assign(Object.create(DatabaseView.prototype), {
    dataSource:f.source,getActiveDb:()=>f.db,getConfig:()=>f.db.views[0],getCurrentEntry:()=>({sourcePath:f.definition}),
  });
  const plan = view.buildColumnOptionMutation(f.column,f.previousOptions,["Next","Future"].map(f.option),
    {renameValues:[{from:"Later",to:"Future"}]});
  const proposed = plan.cleanupChanges.map((change:any)=>[change.path,change.newValue]);
  expect(proposed).toEqual([]);
});


function assertSibling(f: ReturnType<typeof fixture>, expected: string): void {
  const db = f.readDb();
  const sibling = db.views[1];
  const renderer = Object.assign(Object.create(DatabaseView.prototype), {getCurrentEntry:()=>({sourcePath:f.definition})});
  const effective = renderer.getEffectiveConfig(db, sibling);
  const records = new DataSource(f.app as any).getRecordsForDatabase(effective);
  expect(records.map(r => r.file.path)).toEqual([f.hidden]);
  expect(sibling.filters?.map(rule => rule.value)).toEqual([expected,"Done"]);
  expect(sibling.viewStates?.board?.filters?.[0].value).toBe(expected);
  expect(sibling.viewStates?.board?.statusFilter).toBe(expected);
  expect(sibling.conditionalFormats?.[0].condition.value).toBe(expected);
  expect(sibling.groupOrders?.status).toEqual([expected,"Next"]);
  expect(f.raw[f.untouched].status).toBe("Done");
}

it("embedded option rename updates sibling view references and restores them on undo and redo", async () => {
  const f = fixture();
  assertSibling(f,"Done");
  const op = new EmbeddedDataOperations(f.app as any, f.source, "audit",
    () => ({path:f.definition,dbId:"tasks",viewId:"table"}),()=>true,()=>{});
  expect(await op.editField([f.selected], f.column, undefined, {
    setValue:false,value:undefined,previousOptions:f.previousOptions,nextOptions:f.nextOptions,
    renameValues:[{from:"Done",to:"Finished"}],
  })).toBe(true);
  assertSibling(f,"Finished");
  await op.replay("undo");
  assertSibling(f,"Done");
  await op.replay("redo");
  assertSibling(f,"Finished");
});

it("full database commits and undoes the same option, record and sibling view changes", async () => {
  const f = fixture();
  const viewStateStore = new ViewStateStore();
  viewStateStore.get(0,1,f.db.views[1]).searchText = "keep me";
  const pushHistory = vi.fn();
  const updateConfig = vi.fn(async (_file: TFile, config: DatabaseConfig, _mutation?: unknown) => {
    f.raw[f.definition].database = f.source.serializeDatabaseConfig(config);
  });
  Object.assign(f.source, {
    updateViewDefFile: updateConfig,
    updateFrontmatter: async (file: TFile, updates: Record<string,unknown>) => Object.assign(f.raw[file.path],updates),
  });
  const view = Object.assign(Object.create(DatabaseView.prototype), {
    app:f.app, dataSource:f.source, viewEntries:[{config:f.db,sourcePath:f.definition}],
    currentDbIndex:0,currentViewIndex:0, instanceId:"audit", viewStateStore,
    configSnapshots:new Map(), suppressDataReload:vi.fn(), applyReminderCompletionRename:vi.fn(),
    pushHistory, clearCellSelection:vi.fn(), refreshAfterSave:vi.fn(), rerenderToolbar:vi.fn(), renderViewConfigPanel:vi.fn(),
    toolbarRenderer:{closePopovers(){}},chartToolbarRenderer:{closePopover(){}},calendarToolbarRenderer:{closePopover(){}},
    applyFrontmatterChangesAtomically: async (changes: Array<{path:string;key:string;oldValue:unknown;newValue:unknown}>, dir:"old"|"new") => {
      for (const change of changes) f.raw[change.path][change.key] = dir === "old" ? change.oldValue : change.newValue;
    },
  });
  await view.commitColumnOptionsTransaction(f.column,f.previousOptions,f.nextOptions,{renameValues:[{from:"Done",to:"Finished"}]});
  assertSibling(f,"Finished");
  expect(updateConfig.mock.calls[0][2]).not.toHaveProperty("viewId");
  expect(viewStateStore.get(0,1,f.db.views[1])).toMatchObject({searchText:"keep me",filters:[{value:"Finished"},{value:"Done"}]});
  const [[history]] = pushHistory.mock.calls;
  await view.applyConfigHistoryEntry(history,"undo");
  assertSibling(f,"Done");
  await view.applyConfigHistoryEntry(history,"redo");
  assertSibling(f,"Finished");
});
