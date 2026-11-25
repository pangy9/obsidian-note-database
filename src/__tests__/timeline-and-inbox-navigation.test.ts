import {it, expect, vi, afterEach} from "vitest";
import {setLocale} from "../i18n";
setLocale("en");
import {MarkdownView} from "obsidian";
import {CalendarTimelineRenderer} from "../views/CalendarTimelineRenderer";
import {openDatabaseCardNote} from "../views/DatabaseNoteReturn";
import type {ViewConfig} from "../data/types";

vi.mock("obsidian", () => ({ Plugin: class {}, FuzzySuggestModal: class {}, PluginSettingTab: class {}, FileView: class {}, MarkdownRenderChild: class {}, Component: class {}, Scope: class {register(){}}, addIcon(){}, MarkdownView: class {}, Modal: class {constructor(readonly app:unknown){}}, Notice: class {}, TFile: class {}, WorkspaceWindow: class {}, Platform: { isMobile: false }, setIcon() {}, setTooltip() {} }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("does not remember the default Today date merely because initial centre scroll fires its native scroll event", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 25, 12));
  const state = new Map<string,string>();
  const storage = {getItem:(k:string)=>state.get(k) ?? null, setItem:(k:string,v:string)=>state.set(k,v), removeItem:(k:string)=>state.delete(k)};
  const callbacks: (()=>void)[] = [];
  const win = {localStorage:storage, requestAnimationFrame:(cb:()=>void)=>callbacks.push(cb),
    setTimeout,clearTimeout, addEventListener(){},removeEventListener(){},getComputedStyle:()=>({})};
  const ownerDocument = {defaultView:win,addEventListener(){},removeEventListener(){}};
  function open() {
    const renderer = new CalendarTimelineRenderer({openRow(){}});
    const conf = { id:"A", name:"A", sourceFolder:"", viewType:"timeline", timelineScale:"week", timelineContinuous:true,
      timelineStartDateField:"due",schema:{columns:[{key:"due",label:"Due",type:"date"}],computedFields:[]}} as ViewConfig;
    // Let the pinned renderer elect the live anchor. Stop once we reach its unrelated no-row DOM path.
    const container = {ownerDocument, toggleClass(){},getBoundingClientRect:()=>({width:500})};
    const r = renderer as any;
    r.renderEmpty = () => {};
    renderer.renderTimeline(container as any,conf,[]);
    const {anchor}=r.panState;
    const wrap = {style:{setProperty(){}},querySelector:()=>null};
    let left = 0;
    const scroll = {ownerDocument, clientWidth:500, scrollWidth:1500, isConnected:true,setAttribute(){},addEventListener(){},removeEventListener(){},onscroll:()=>{},
      get scrollLeft(){return left;},
      set scrollLeft(value:number){ if(left !== value){left=value; callbacks.push(()=>this.onscroll());} }};
    r.timelineRoot = wrap;
    r.installTimelinePan(scroll,wrap,container,conf,[],{scale:"week",startDateKey:anchor,startMinutes:0},5,100,[]);
    for (const cb of callbacks.splice(0)) cb();
    r.panPositionStore.flush();
    return anchor;
  }
  vi.stubGlobal("window",win);
  open();
  vi.setSystemTime(new Date(2026,10,26,12));
  const reopened=open();
  expect(reopened).toBe("2026-11-24");
});

it("remembers the final position when a fast drag ends before the native scroll event", () => {
  vi.stubGlobal("Element", class {});
  const doc = { defaultView: {} };
  const wrap = { style: { setProperty() {} }, querySelector: () => null };
  const scroll = { ownerDocument: doc, isConnected: true, scrollLeft: 0, clientWidth: 500,
    scrollWidth: 1500, setAttribute() {}, setPointerCapture() {}, addEventListener() {}, removeEventListener() {},
    onpointerdown: (_event: object) => {}, onpointerup: (_event: object) => {} };
  const renderer = new CalendarTimelineRenderer({ openRow() {} }) as any;
  renderer.panState = { anchor: "2026-11-23", offset: 0, minutes: 0 };
  renderer.panPositionStore = { schedule: vi.fn() };
  renderer.renderTimeline = vi.fn();
  renderer.timelineRoot = wrap;
  const config = { timelineContinuous: true, timelineScale: "week" };
  renderer.installTimelinePan(scroll, wrap, {}, config, [], { scale: "week", startDateKey: "2026-11-18" }, 5, 100, []);
  expect(renderer.panPositionStore.schedule).not.toHaveBeenCalled();
  scroll.onpointerdown({ button: 0, pointerType: "mouse", pointerId: 1, clientX: 100,
    target: { instanceOf: () => true, closest: () => true }, preventDefault() {} });
  scroll.scrollLeft = 10;
  // A pointer release is delivered first; no scroll event has run yet.
  scroll.onpointerup({ pointerId: 1 });
  expect(renderer.renderTimeline).toHaveBeenCalledOnce();
  expect(renderer.panPositionStore.schedule).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ anchor: "2026-11-19" }));
  expect(renderer.panPositionStore.schedule.mock.calls[0][0].offsetUnits).toBeCloseTo(-0.9);
});

it("can rebase after replacing a scroll surface during a pointer drag", () => {
  vi.stubGlobal("Element", class {});
  const callbacks: (() => void)[] = [];
  const ownerDocument = { defaultView: { requestAnimationFrame: (callback: () => void) => callbacks.push(callback) } };
  const surface = () => ({
    wrap: { style: { setProperty() {} }, querySelector: () => null },
    scroll: { ownerDocument, isConnected: true, scrollLeft: 0, clientWidth: 500, scrollWidth: 1500,
      setAttribute() {}, setPointerCapture() {}, addEventListener() {}, removeEventListener() {}, onpointerdown: (_event: object) => {}, onscroll: () => {} },
  });
  const renderer = new CalendarTimelineRenderer({ openRow() {} }) as any;
  renderer.panState = { anchor: "2026-11-23", offset: 0, minutes: 0 };
  renderer.renderTimeline = vi.fn();
  const install = ({ wrap, scroll }: ReturnType<typeof surface>) => {
    renderer.timelineRoot = wrap;
    renderer.installTimelinePan(scroll, wrap, {}, { timelineContinuous: true, timelineScale: "week" }, [],
      { scale: "week", startDateKey: "2026-11-18" }, 5, 100, []);
  };
  const old = surface();
  install(old);
  old.scroll.onpointerdown({ button: 0, pointerType: "mouse", pointerId: 1, clientX: 100,
    target: { instanceOf: () => true, closest: () => true }, preventDefault() {} });
  // Removing the captured element delivers lostpointercapture to the document
  // rather than its old listener; the replacement is not being dragged.
  old.scroll.isConnected = false;
  const next = surface();
  install(next);
  next.scroll.scrollLeft = 10;
  next.scroll.onscroll();
  callbacks.shift()?.();
  expect(renderer.renderTimeline).toHaveBeenCalledOnce();
});

it.each([false, true])("recenters a touch scroll only after the finger and inertia settle (scrollend: %s)", sendsScrollEnd => {
  vi.useFakeTimers();
  const win = { setTimeout, clearTimeout, requestAnimationFrame: vi.fn() };
  const listeners = new Map<string, (event: { touches: unknown[] }) => void>();
  const scroll = {
    ownerDocument: { defaultView: win }, isConnected: true, scrollLeft: 0, clientWidth: 500,
    scrollWidth: 1500, setAttribute() {}, onscroll() {},
    addEventListener(type: string, handler: (event: { touches: unknown[] }) => void) { listeners.set(type, handler); },
    removeEventListener(type: string) { listeners.delete(type); },
  };
  const wrap = { style: { setProperty() {} }, querySelector: () => null };
  const renderer = new CalendarTimelineRenderer({openRow() {}}) as any;
  renderer.timelineRoot = wrap;
  renderer.panState = { anchor: "2026-11-23", offset: 0, minutes: 0 };
  renderer.renderTimeline = vi.fn();
  renderer.installTimelinePan(scroll, wrap, {}, {timelineContinuous: true, timelineScale: "week"}, [],
    {scale: "week", startDateKey: "2026-11-18"}, 5, 100, []);
  listeners.get("touchstart")?.({touches: [1]});
  scroll.scrollLeft = 925;
  scroll.onscroll();
  vi.advanceTimersByTime(300);
  listeners.get("scrollend")?.({touches: [1]});
  expect(renderer.renderTimeline).not.toHaveBeenCalled();
  listeners.get("touchend")?.({touches: []});
  vi.advanceTimersByTime(100);
  scroll.scrollLeft = 980;
  scroll.onscroll();
  vi.advanceTimersByTime(150);
  expect(renderer.renderTimeline).not.toHaveBeenCalled();
  if (sendsScrollEnd) listeners.get("scrollend")?.({touches: []});
  else vi.advanceTimersByTime(60);
  expect(renderer.renderTimeline).toHaveBeenCalledOnce();
  expect(renderer.panState.anchor).toBe("2026-11-27");
  expect(renderer.panState.offset).toBe(80);
  renderer.clearTimelinePanListeners();
  expect(listeners.size).toBe(0);
});

it("does not steal focus when another visible editor activates before delayed Back focus restoration", async () => {
  let frame = 0;
  const frames = new Map<number, ()=>void>();
  const activeCallbacks = new Set<(leaf:unknown)=>void>();
  const win = { innerWidth:1000,innerHeight:750,getComputedStyle:()=>({visibility:"visible"}),
    requestAnimationFrame: (cb:()=>void) => { frames.set(++frame,cb); return frame; },
    cancelAnimationFrame:(handle:number)=>frames.delete(handle),addEventListener(){},removeEventListener(){} };
  const nextFrame = () => { const callbacks=[...frames.values()]; frames.clear(); callbacks.forEach(cb=>cb()); };
  const buttons: any[] = [];
  const capsule={setCssProps(){},remove(){},createEl(){const button={createSpan(){return{};},onclick(){}};buttons.push(button);return button;}};
  const doc={defaultView:win,body:{createDiv:()=>capsule}};
  const host={ownerDocument:doc,querySelectorAll:()=>[]};
  let originVisible = true;
  const el=(origin=false)=>({ownerDocument:doc,isConnected:true,getClientRects:()=>({length:origin&&!originVisible?0:1}),
    getBoundingClientRect:()=>({left:100,top:100,right:760,bottom:650,width:660,height:550}),
    contains:(candidate:unknown)=>origin&&candidate===host});
  const file={path:"Task.md"};
  const origin = {view:{containerEl:el(true)},getContainer:()=>({})};
  const target = {view:Object.assign(new MarkdownView({} as never),{file,containerEl:el()}),getContainer:()=>({})};
  const third = {view:{containerEl:el()},getContainer:()=>({})};
  let current: any=origin;
  const leaves=(visit:(leaf:unknown)=>void)=>[origin,target,third].forEach(visit);
  const workspace={iterateAllLeaves:leaves,iterateRootLeaves:leaves,getLeavesOfType:()=>[target],getMostRecentLeaf:()=>current,
    setActiveLeaf(leaf:unknown) {current=leaf; if(leaf===origin)originVisible=true;if(leaf===target)originVisible=false; activeCallbacks.forEach(cb=>cb(leaf));},
    on(name:string,cb:(leaf:unknown)=>void){ if(name==="active-leaf-change")activeCallbacks.add(cb);return cb; },
    offref:(cb:(leaf:unknown)=>void)=>activeCallbacks.delete(cb)};
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
  await openDatabaseCardNote({app:{workspace,vault:{on(){},offref(){}}} as any,file:file as any,
    host:host as any,anchor:{getAttribute:()=>null} as any,view:"timeline",openNormally(){}});
  nextFrame();
  expect(buttons).toHaveLength(2);
  buttons[0].onclick();
  expect(current).toBe(origin);
  workspace.setActiveLeaf(third);
  nextFrame();
  nextFrame();
  expect(current).toBe(third);
});

it("shows the inbox when reopening it via the command while a record note has parked it", async () => {
  const [{default:Plugin}, {RecordReminderInbox}] = await Promise.all([
    import("../main"), import("../views/modals/RecordReminderInbox"),
  ]);
  const classes = new Set<string>();
  const strip = {createEl(){return {createSpan(){return {};},onclick(){}};},remove(){}};
  const doc = {body:{createDiv:()=>strip,appendChild(){}},querySelectorAll:()=>[]};
  const origin = {};
  const file = {path:"A.md"};
  const leaf = {view:{containerEl:{ownerDocument:doc},getState:()=>({file:"A.md"})}, async openFile(){}};
  const workspace={getMostRecentLeaf:()=>origin,getLeavesOfType:()=>[leaf],on(){},offref(){},setActiveLeaf(){},
    iterateAllLeaves:(visit: (leaf: unknown) => void) => [origin, leaf].forEach(visit)};
  const app={workspace,vault:{getFileByPath:()=>file},keymap:{popScope(){},pushScope(){}}};
  const service={isOriginalRecord: () => true};
  const inbox = new RecordReminderInbox(app as any,service as any,()=>false) as any;
  Object.assign(inbox,{containerEl:{ownerDocument:doc,isConnected:true,addClass:(c:string)=>classes.add(c),removeClass:(c:string)=>classes.delete(c)},
    contentEl:{ownerDocument:doc}, refresh(){}, focusRow(){}});
  await inbox.openNote({path:"A.md"});
  expect(classes.has("db-ri-parked")).toBe(true);
  const plugin=Object.assign(Object.create(Plugin.prototype),{reminderInbox:inbox,recordReminderService:service,
    getRecordReminderPreferences:()=>({enabled:true})});
  plugin.showRecordReminders(); // same action used by the palette checkCallback
  expect(classes.has("db-ri-parked")).toBe(false);
});
