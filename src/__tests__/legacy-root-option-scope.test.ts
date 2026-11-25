import {expect,it,vi} from "vitest";
import {TFile} from "obsidian";
import {DatabaseView} from "../views/DatabaseView";
import {DataSource} from "../data/DataSource";
import {setLocale} from "../i18n";
setLocale("en");
vi.mock("obsidian", () => ({
  Plugin: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {}, FileView: class {},
  MarkdownRenderChild: class {}, Component: class {}, Scope: class {}, Modal: class {},
  MarkdownView: class {}, TFile: class {}, TFolder: class {}, Platform: {isMobile: false},
  Notice: class {}, normalizePath: (p: string) => p, addIcon() {}
}));
it("updates an option used by two visible records in an all-vault view of a legacy database", () => {
  const option = (value: string) => ({value,color:"gray" as const});
  const before = ["Done","Next"].map(option);
  const after = ["Finished","Next"].map(option);
  const definition = "DB.md", scoped = "Tasks/Some.md", omitted = "Inbox/Visible.md";
  const files = Object.fromEntries([definition,scoped,omitted].map(path => [path,Object.assign(new TFile(), {path,extension:"md",basename:path.slice(0,-3).split("/").at(-1)})])) as Record<string,TFile>;
  const raw: Record<string, Record<string, unknown>> = {
    [definition]: {db_view:true,database:{id:"tasks",name:"Tasks",sourceFolder:"",
      columns:[{key:"status",label:"Status",type:"status",statusOptions:before}],
      views:[{id:"all",name:"All notes",viewType:"table",sourceFolder:""},
        {id:"task",name:"Tasks",viewType:"table",sourceFolder:"Tasks"}]}},
    [scoped]:{status:"Done"},[omitted]:{status:"Done"},
  };
  const app = {vault:{getMarkdownFiles:()=>Object.values(files),getAbstractFileByPath:(p:string)=>files[p]},
    metadataCache:{getFileCache:(f:TFile)=>({frontmatter:raw[f.path]})}};
  const dataSource = new DataSource(app as any);
  const config = dataSource.getViewDefFiles()[0].config;
  const view = Object.assign(Object.create(DatabaseView.prototype), {
    dataSource,getActiveDb:()=>config,getConfig:()=>config.views[0],getCurrentEntry:()=>({sourcePath:definition}),
  });
  const visible = view.getRecordsForActiveDatabase().map((record:any)=>record.file.path);
  const planned = view.buildColumnOptionMutation(config.schema.columns[0],before,after,
    {renameValues:[{from:"Done",to:"Finished"}]}).cleanupChanges.map((change:any)=>change.path);
  expect(visible).toContain(omitted);
  expect(planned).toEqual(visible);
});
