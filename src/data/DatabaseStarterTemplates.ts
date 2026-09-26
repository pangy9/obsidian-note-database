import { t } from "../i18n";
import type { ColumnDef, DatabaseConfig, StatusPresetDef, ViewConfig } from "./types";
import { getStarterArtworkFiles } from "./DatabaseStarterArtwork";
import { serializeLucideIconToken } from "./RecordIcon";

export type StarterTemplateId = "project-tracker" | "content-calendar" | "reading-library" | "research-library" | "lightweight-crm" | "task-planner";
export interface StarterSampleRecord {
  filename: string;
  frontmatter: Record<string, unknown>;
  body: string;
  coverArtwork?: number;
}
export interface StarterTemplate {
  id: StarterTemplateId;
  version: 1;
  name: string;
  description: string;
  icon: string;
  columns: ColumnDef[];
  views: Array<Pick<ViewConfig, "name" | "viewType"> & Partial<ViewConfig>>;
  samples: StarterSampleRecord[];
}

function dateAfter(days: number, today: Date): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Built-in starters are bundled with the plugin; no network or executable template code. */
export function getStarterTemplates(today: Date = new Date()): StarterTemplate[] {
  const name: ColumnDef = { key: "file.name", label: t("defaults.nameColumn"), type: "text" };
  const projectStatus = [t("starter.status.todo"), t("starter.status.doing"), t("starter.status.done")];
  const contentStatus = [t("starter.status.idea"), t("starter.status.draft"), t("starter.status.scheduled"), t("starter.status.published")];
  const readingStatus = [t("starter.status.toRead"), t("starter.status.reading"), t("starter.status.finished")];
  const colors = ["gray", "blue", "green", "orange"] as const;
  const options = (values: string[]) => values.map((value, index) => ({ value, color: colors[index % colors.length] }));
  const sample = (filename: string, frontmatter: Record<string, unknown>, coverArtwork?: number): StarterSampleRecord => ({
    filename, frontmatter, body: `# ${filename}\n`, coverArtwork,
  });
  return [
    {
      id: "project-tracker", version: 1,
      name: t("starter.project.name"), description: t("starter.project.desc"), icon: "folder-kanban",
      columns: [name,
        { key: "status", label: t("starter.field.status"), type: "status", statusOptions: options(projectStatus) },
        { key: "priority", label: t("starter.field.priority"), type: "select", statusOptions: options([t("starter.priority.high"), t("starter.priority.medium"), t("starter.priority.low")]) },
        { key: "due", label: t("starter.field.due"), type: "date" },
        { key: "effort", label: t("starter.field.effort"), type: "number" },
        { key: "owner", label: t("starter.field.owner"), type: "text" },
        { key: "notes", label: t("starter.field.notes"), type: "text", wrap: true },
      ],
      views: [
        { name: t("common.tableView"), viewType: "table" },
        { name: t("common.boardView"), viewType: "board", boardGroupField: "status" },
        { name: t("common.calendarView"), viewType: "calendar", calendarStartDateField: "due" },
        { name: t("starter.view.projectEffort"), viewType: "chart", chartType: "horizontal-bar", chartGroupField: "status", chartAggregation: "sum", chartValueField: "effort" },
      ],
      samples: [
        sample(t("starter.sample.scope"), { status: projectStatus[0], priority: t("starter.priority.high"), due: dateAfter(3, today), effort: 4 }),
        sample(t("starter.sample.milestone"), { status: projectStatus[1], priority: t("starter.priority.medium"), due: dateAfter(7, today), effort: 8 }),
        sample(t("starter.sample.review"), { status: projectStatus[0], priority: t("starter.priority.low"), due: dateAfter(14, today), effort: 2 }),
      ],
    },
    {
      id: "content-calendar", version: 1,
      name: t("starter.content.name"), description: t("starter.content.desc"), icon: "calendar-days",
      columns: [name,
        { key: "status", label: t("starter.field.status"), type: "status", statusOptions: options(contentStatus) },
        { key: "channel", label: t("starter.field.channel"), type: "select", statusOptions: options([t("starter.channel.blog"), t("starter.channel.video"), t("starter.channel.social")]) },
        { key: "publishDate", label: t("starter.field.publishDate"), type: "date" },
        { key: "notes", label: t("starter.field.notes"), type: "text", wrap: true },
      ],
      views: [
        { name: t("common.calendarView"), viewType: "calendar", calendarStartDateField: "publishDate", calendarColorField: "status" },
        { name: t("common.boardView"), viewType: "board", boardGroupField: "status" },
        { name: t("common.tableView"), viewType: "table" },
        { name: t("starter.view.contentChannel"), viewType: "chart", chartType: "bar", chartGroupField: "channel", chartAggregation: "count" },
        { name: t("starter.view.contentPace"), viewType: "chart", chartType: "line", chartGroupField: "publishDate", chartDateBucket: "day", chartAggregation: "count" },
      ],
      samples: [
        sample(t("starter.sample.idea"), { status: contentStatus[0], channel: t("starter.channel.blog"), publishDate: dateAfter(2, today) }),
        sample(t("starter.sample.outline"), { status: contentStatus[1], channel: t("starter.channel.video"), publishDate: dateAfter(5, today) }),
        sample(t("starter.sample.publish"), { status: contentStatus[2], channel: t("starter.channel.social"), publishDate: dateAfter(9, today) }),
      ],
    },
    {
      id: "reading-library", version: 1,
      name: t("starter.reading.name"), description: t("starter.reading.desc"), icon: "library-big",
      columns: [name,
        { key: "status", label: t("starter.field.status"), type: "status", statusOptions: options(readingStatus) },
        { key: "mediaType", label: t("starter.field.mediaType"), type: "select", statusOptions: options([t("starter.media.book"), t("starter.media.article"), t("starter.media.video")]) },
        { key: "author", label: t("starter.field.author"), type: "text" },
        { key: "rating", label: t("starter.field.rating"), type: "number", numberDisplayStyle: "rating" },
        { key: "cover", label: t("starter.field.cover"), type: "text" },
        { key: "notes", label: t("starter.field.notes"), type: "text", wrap: true },
      ],
      views: [
        { name: t("common.galleryView"), viewType: "gallery", galleryImageField: "cover" },
        { name: t("common.tableView"), viewType: "table" },
        { name: t("common.listView"), viewType: "list" },
      ],
      samples: [
        sample(t("starter.sample.book"), { status: readingStatus[0], mediaType: t("starter.media.book") }, 1),
        sample(t("starter.sample.article"), { status: readingStatus[1], mediaType: t("starter.media.article") }, 2),
        sample(t("starter.sample.video"), { status: readingStatus[2], mediaType: t("starter.media.video"), rating: 4 }, 3),
      ],
    },
    {
      id: "research-library", version: 1,
      name: t("starter.research.name"), description: t("starter.research.desc"), icon: "microscope",
      columns: [name,
        { key: "status", label: t("starter.field.status"), type: "status", statusOptions: options([t("starter.status.toRead"), t("starter.status.reading"), t("starter.status.finished")]) },
        { key: "topic", label: t("starter.field.topic"), type: "select", statusOptions: options([t("starter.topic.method"), t("starter.topic.data"), t("starter.topic.application")]) },
        { key: "year", label: t("starter.field.year"), type: "number" },
        { key: "source", label: t("starter.field.source"), type: "text" },
        { key: "notes", label: t("starter.field.notes"), type: "text", wrap: true },
      ],
      views: [
        { name: t("common.tableView"), viewType: "table" },
        { name: t("common.boardView"), viewType: "board", boardGroupField: "status" },
        { name: t("starter.view.researchTopics"), viewType: "chart", chartType: "bar", chartGroupField: "topic", chartAggregation: "count" },
        { name: t("starter.view.researchProgress"), viewType: "chart", chartType: "donut", chartGroupField: "status", chartAggregation: "count" },
      ],
      samples: [
        sample(t("starter.sample.paperA"), { status: readingStatus[0], topic: t("starter.topic.method"), year: today.getFullYear() }),
        sample(t("starter.sample.paperB"), { status: readingStatus[1], topic: t("starter.topic.data"), year: today.getFullYear() - 1 }),
        sample(t("starter.sample.paperC"), { status: readingStatus[2], topic: t("starter.topic.application"), year: today.getFullYear() - 2 }),
      ],
    },
    {
      id: "lightweight-crm", version: 1,
      name: t("starter.crm.name"), description: t("starter.crm.desc"), icon: "contact-round",
      columns: [name,
        { key: "stage", label: t("starter.field.stage"), type: "status", statusOptions: options([t("starter.stage.new"), t("starter.stage.contacted"), t("starter.stage.followUp"), t("starter.stage.closed")]) },
        { key: "organization", label: t("starter.field.organization"), type: "text" },
        { key: "email", label: t("starter.field.email"), type: "text" },
        { key: "nextContact", label: t("starter.field.nextContact"), type: "date" },
        { key: "notes", label: t("starter.field.notes"), type: "text", wrap: true },
      ],
      views: [
        { name: t("common.tableView"), viewType: "table" },
        { name: t("common.boardView"), viewType: "board", boardGroupField: "stage" },
        { name: t("starter.view.crmPipeline"), viewType: "chart", chartType: "donut", chartGroupField: "stage", chartAggregation: "count" },
        { name: t("common.formView"), viewType: "form", formTitle: t("starter.crm.formTitle"), formRequiredFields: ["organization"] },
      ],
      samples: [
        sample(t("starter.sample.contactA"), { stage: t("starter.stage.new"), organization: t("starter.sample.orgA"), nextContact: dateAfter(1, today) }),
        sample(t("starter.sample.contactB"), { stage: t("starter.stage.contacted"), organization: t("starter.sample.orgB"), nextContact: dateAfter(4, today) }),
        sample(t("starter.sample.contactC"), { stage: t("starter.stage.followUp"), organization: t("starter.sample.orgC"), nextContact: dateAfter(8, today) }),
      ],
    },
    {
      id: "task-planner", version: 1,
      name: t("starter.tasks.name"), description: t("starter.tasks.desc"), icon: "list-todo",
      columns: [name,
        { key: "status", label: t("starter.field.status"), type: "status", statusOptions: options(projectStatus) },
        { key: "priority", label: t("starter.field.priority"), type: "select", statusOptions: options([t("starter.priority.high"), t("starter.priority.medium"), t("starter.priority.low")]) },
        { key: "due", label: t("starter.field.due"), type: "date" },
        { key: "effort", label: t("starter.field.effort"), type: "number" },
      ],
      views: [
        { name: t("common.tableView"), viewType: "table" },
        { name: t("common.calendarView"), viewType: "calendar", calendarStartDateField: "due" },
        { name: t("starter.view.taskProgress"), viewType: "chart", chartType: "donut", chartGroupField: "status", chartAggregation: "count" },
        { name: t("starter.view.taskEffort"), viewType: "chart", chartType: "horizontal-bar", chartGroupField: "priority", chartAggregation: "sum", chartValueField: "effort" },
      ],
      samples: [
        sample(t("starter.sample.taskA"), { status: projectStatus[0], priority: t("starter.priority.high"), due: dateAfter(1, today), effort: 2 }),
        sample(t("starter.sample.taskB"), { status: projectStatus[1], priority: t("starter.priority.medium"), due: dateAfter(3, today), effort: 3 }),
        sample(t("starter.sample.taskC"), { status: projectStatus[2], priority: t("starter.priority.low"), due: dateAfter(5, today), effort: 1 }),
      ],
    },
  ];
}

export function getStarterTemplate(id: string | undefined, today: Date = new Date()): StarterTemplate | undefined {
  return getStarterTemplates(today).find((starter) => starter.id === id);
}

export function getStarterRecordFolder(databaseFolder: string, databaseName: string): string {
  const base = databaseFolder.replace(/^\/+|\/+$/g, "");
  const safe = databaseName.replace(/[\\/:*?"<>|#^]/g, "-").replace(/\.+$/g, "").trim() || "Database";
  return [base, "records", safe].filter(Boolean).join("/");
}

export function getStarterStatusPreset(starter: StarterTemplate): StatusPresetDef | undefined {
  const statusColumn = starter.columns.find((column) => column.type === "status" && column.statusOptions?.length);
  if (!statusColumn?.statusOptions) return undefined;
  return {
    id: `starter-${starter.id}-status`,
    name: t("starter.workflowPreset", { name: starter.name }),
    options: structuredClone(statusColumn.statusOptions),
  };
}

export function buildStarterDatabaseConfig(
  starter: StarterTemplate,
  databaseName: string,
  sourceFolder: string,
  newId: () => string,
): DatabaseConfig {
  const schema = {
    columns: starter.columns.map((column) => structuredClone(column)),
    computedFields: [],
  };
  const preset = getStarterStatusPreset(starter);
  const iconColors: Record<StarterTemplateId, "teal" | "orange" | "green" | "blue" | "brown" | "indigo"> = {
    "project-tracker": "teal", "content-calendar": "orange", "reading-library": "green",
    "research-library": "blue", "lightweight-crm": "brown", "task-planner": "indigo",
  };
  return {
    id: newId(), name: databaseName, icon: serializeLucideIconToken(`lucide-${starter.icon}`, iconColors[starter.id]),
    coverImage: getStarterArtworkFiles(starter.id, sourceFolder)[0].path,
    sourceFolder, newRecordFolder: sourceFolder, schema,
    statusPresets: preset ? [preset] : undefined,
    defaultStatusPresetId: preset?.id,
    views: starter.views.map((definition) => ({
      ...definition,
      id: newId(),
      sourceFolder: "",
      schema,
      columnOrder: schema.columns.map((column) => column.key),
    })),
  };
}
