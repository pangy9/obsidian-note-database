import { App, CachedMetadata, TFile } from "obsidian";
import { LocaleCode } from "../i18n";

export interface RecordSchema {
  columns: ColumnDef[];
  computedFields: ComputedFieldDef[];
}

export interface ColumnDef {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "currency" | "select" | "multi-select" | "status" | "checkbox" | "computed";
  width?: number;
  urgency?: { enabled: boolean; thresholdDays: number };
  dateFormat?: string;
  computedKey?: string;
  /** Explicit status preset selected for this column. Undefined means custom/no preset. */
  statusPresetId?: string;
  statusOptions?: StatusOptionDef[];
  wrap?: boolean;
}

export type StatusColor =
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red"
  | "slate"
  | "cyan"
  | "teal"
  | "lime"
  | "indigo"
  | "violet"
  | "rose";

export interface StatusOptionDef {
  value: string;
  color: StatusColor;
}

export interface StatusPresetDef {
  id: string;
  name: string;
  options: StatusOptionDef[];
}

export interface ComputedFieldDef {
  key: string;
  label: string;
  expression: string;
  type: "number" | "text" | "date" | "checkbox";
  /** Expression language. Bases imports keep their native formula syntax. */
  expressionSyntax?: "note-database" | "base";
}

export type ComputedSyncMode = "automatic" | "display-only" | "manual";

export interface RowData {
  app?: App;
  file: TFile;
  frontmatter: Record<string, unknown>;
  cache?: CachedMetadata | null;
  computed: Record<string, unknown>;
}

export interface CreateEntryPosition {
  /** Insert before this rendered record when manual order is active. */
  beforePath?: string;
  /** Insert after this rendered record when manual order is active. */
  afterPath?: string;
}

export type FilterOperator = "eq" | "neq" | "contains" | "hasTag" | "gt" | "lt" | "gte" | "lte" | "empty" | "notempty";

export interface FilterRule {
  field: string;
  op: FilterOperator;
  value?: string;
}

export interface SortRule {
  field: string;
  direction: "asc" | "desc";
}

export interface ViewModeStateDef {
  hiddenColumns?: string[];
  statusFilter?: string;
  searchText?: string;
  groupByField?: string;
  filterLogic?: "and" | "or";
  filters?: FilterRule[];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  sortRules?: SortRule[];
}

export type DatabaseViewType = "table" | "board" | "gallery" | "list" | "chart";
export type ChartType = "bar" | "horizontal-bar" | "line" | "area" | "pie" | "donut" | "number" | "stacked-bar" | "grouped-bar" | "percent-stacked-bar" | "mixed";
export type ChartAggregation =
  | "count"
  | "sum"
  | "avg"
  | "median"
  | "min"
  | "max"
  | "range"
  | "unique"
  | "empty"
  | "not-empty"
  | "percent-empty"
  | "percent-not-empty"
  | "checked"
  | "unchecked"
  | "percent-checked";
export type ChartDateBucket = "day" | "week" | "month" | "quarter" | "year";
export type ChartNumberBucket = "auto" | "fixed";
export type ChartSortBy = "value-desc" | "value-asc" | "label-asc" | "label-desc" | "option-order";
export type ChartHeight = "small" | "medium" | "large" | "xlarge";
export type ChartGridLines = "none" | "value" | "both";
export type ChartAxisNames = "none" | "x" | "y" | "both";
export type ChartDataLabelMode = "value" | "percent" | "label-value";
export type ChartDataLabelColor = "auto" | "dark" | "light" | "accent";
export type ChartColorPalette = "auto" | "accent" | "colorful" | "pastel" | "vivid" | "warm" | "cool" | "mono" | "option";
export type ChartDonutCenterMode = "hidden" | "total" | "aggregation";
export type ChartValueAxisRange = "auto" | "zero-based" | "custom";
export type ChartReferenceLineType = "constant" | "average" | "median" | "min" | "max";
export type ChartReferenceLineStyle = "solid" | "dashed" | "dotted";
export type GroupOrderMode = "text-asc" | "text-desc" | "number-asc" | "number-desc" | "date-asc" | "date-desc" | "checkbox-false-first" | "checkbox-true-first" | "option-asc" | "option-desc" | "multi-select-priority";
export const NO_TITLE_FIELD = "__none";

export type SourceRuleOperator =
  "inFolder" | "hasTag" | "hasProperty" | "hasLink" |
  "eq" | "neq" | "strictEq" | "strictNeq" | "contains" | "startsWith" | "endsWith" | "matches" |
  "isType" | "gt" | "gte" | "lt" | "lte" |
  "empty" | "notempty" | "truthy";

export type SourceRuleValueType = "string" | "number" | "boolean" | "null" | "date";

export interface SourceRule {
  field: string;
  op: SourceRuleOperator;
  value?: string;
  valueType?: SourceRuleValueType;
}

export interface ChartReferenceLine {
  id: string;
  type: ChartReferenceLineType;
  value?: number;
  label?: string;
  color?: string;
  style?: ChartReferenceLineStyle;
}

export interface SourceRuleGroup {
  type: "group";
  logic: "and" | "or";
  rules: SourceRuleNode[];
}

export interface SourceRuleNot {
  type: "not";
  rule: SourceRuleNode;
}

export interface SourceRuleExpression {
  type: "expression";
  expression: string;
}

export type SourceRuleNode = SourceRule | SourceRuleGroup | SourceRuleNot | SourceRuleExpression;

/**
 * 数据库配置：包含数据来源定义 + 属性定义 + 多个视图。
 * 对应一个数据库配置。
 */
export interface DatabaseConfig {
  id: string;
  name: string;
  description?: string;
  sourceFolder: string;
  sourceRules?: SourceRule[];
  sourceLogic?: "and" | "or";
  /** Recursive source rules used by advanced filters. Takes precedence over legacy flat rules. */
  sourceRuleTree?: SourceRuleNode;
  /** Runtime-only file path used for Bases `this`; not persisted. */
  baseThisFilePath?: string;
  newRecordFolder?: string;
  typeFilter?: string;
  schema: RecordSchema;
  /** Database-specific status presets. Global presets are used when this is empty. */
  statusPresets?: StatusPresetDef[];
  /** Default status preset id for new status properties in this database. */
  defaultStatusPresetId?: string;
  /** Controls whether evaluated computed fields are written back to record frontmatter. */
  computedSyncMode?: ComputedSyncMode;
  /** Custom summary formulas imported from Obsidian Bases. */
  summaryFormulas?: Record<string, string>;
  /** 1~15 个视图，每个有独立的排序/筛选/显示配置 */
  views: ViewConfig[];
}

/**
 * 视图配置：一种观察数据库的方式。
 * 包含独立的排序/筛选/属性可见性/分组/看板配置。
 * 数据库级别属性（sourceFolder、schema 等）从所属的 DatabaseConfig 获取。
 *
 * 注意：当前阶段仍保留数据库级属性（sourceFolder、schema 等）以保持子组件兼容性，
 * 后续 commit 会逐步将它们移至 DatabaseConfig 专属访问。
 */
export interface ViewConfig {
  id?: string;
  name: string;
  sourceFolder: string;
  /** File collection rules. When absent, sourceFolder/typeFilter are used for backwards compatibility. */
  sourceRules?: SourceRule[];
  sourceLogic?: "and" | "or";
  /** Recursive source rules used by advanced filters. Takes precedence over legacy flat rules. */
  sourceRuleTree?: SourceRuleNode;
  /** Runtime-only file path used for Bases `this`; not persisted. */
  baseThisFilePath?: string;
  newRecordFolder?: string;
  typeFilter?: string;
  schema: RecordSchema;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  /** Ordered multi-sort rules. Preferred over legacy sortColumn/sortDirection. */
  sortRules?: SortRule[];
  /** View-specific status presets. Database/global presets are used when this is empty. */
  statusPresets?: StatusPresetDef[];
  /** Default status preset id for new status properties created while this view is active. */
  defaultStatusPresetId?: string;
  /** Current visual representation for this view. */
  viewType?: DatabaseViewType;
  displayWidth?: "default" | "wide";
  /** Board grouping property. Falls back to groupByField/status when absent. */
  boardGroupField?: string;
  /** Optional secondary board grouping property rendered inside each board column. */
  boardSubgroupField?: string;
  /** Shared board column width in pixels. */
  boardColumnWidth?: number;
  /** Default display width applied to all properties in the active view. */
  defaultColumnWidth?: number;
  /** Explicit column key order. When absent, schema.columns array order is used. */
  columnOrder?: string[];
  /** Per-view property widths imported from Obsidian Bases columnSize. Falls back to shared column widths. */
  columnWidths?: Record<string, number>;
  /** Persisted hidden column keys. */
  hiddenColumns?: string[];
  /** Legacy ordering field kept for older saved configs. */
  sortColumnOrder?: string;
  /** Persisted status filter for this view. */
  statusFilter?: string;
  /** Persisted text search for this view. */
  searchText?: string;
  /** Persisted group-by property key. */
  groupByField?: string;
  /** Explicit group display order keyed by grouped property. */
  groupOrders?: Record<string, string[]>;
  /** Collapsed group keys keyed by grouped property. */
  collapsedGroups?: Record<string, string[]>;
  /** Manual board card order keyed by board group field and group key. */
  boardCardOrders?: Record<string, Record<string, string[]>>;
  /** Manual row ordering. Key = file.path, value = base62 rank string. */
  manualOrder?: { ranks?: Record<string, string> };
  /** Gallery cover image property. */
  galleryImageField?: string;
  /** Optional card/list title property. When absent, renderers fall back to visible file.name. */
  titleField?: string;
  /** Gallery cover aspect ratio as width / height. */
  galleryImageAspectRatio?: number;
  /** Gallery card width in pixels. */
  galleryCardSize?: number;
  /** Gallery cover image fit mode. */
  galleryImageFit?: "cover" | "contain";
  /** Render currently visible properties on cards/lists even when the value is empty. */
  showEmptyFields?: boolean;
  /** Persisted advanced filter logic. */
  filterLogic?: "and" | "or";
  /** Persisted advanced filters. */
  filters?: FilterRule[];
  /** Optional maximum number of rows shown by this view, imported from Obsidian Bases limit. */
  resultLimit?: number;
  /** Property -> summary name mapping imported from Obsidian Bases view summaries. */
  summaryRules?: Record<string, string>;
  /** Chart type for chart views. */
  chartType?: ChartType;
  /** Field key used to group rows before chart aggregation. */
  chartGroupField?: string;
  /** Date grouping granularity used when chartGroupField points to a date property. */
  chartDateBucket?: ChartDateBucket;
  /** Numeric grouping mode used when chartGroupField points to a number/currency property. */
  chartNumberBucket?: ChartNumberBucket;
  /** Bucket size used when chartNumberBucket is fixed. */
  chartNumberBucketSize?: number;
  /** Secondary categorical field used to split stacked bar segments. */
  chartStackField?: string;
  /** Secondary categorical field used to split chart data into series. Falls back to chartStackField for legacy views. */
  chartSeriesField?: string;
  /** Aggregation method for chart views. Stored explicitly even when only "count" is available. */
  chartAggregation?: ChartAggregation;
  /** Numeric field used by SUM/AVG/MIN/MAX chart aggregations. */
  chartValueField?: string;
  /** Secondary aggregation used by mixed charts for the line series. */
  chartSecondaryAggregation?: ChartAggregation;
  /** Secondary numeric field used by mixed charts for the line series. */
  chartSecondaryValueField?: string;
  /** Sort mode used after chart aggregation. */
  chartSortBy?: ChartSortBy;
  /** Hidden chart group or series keys. */
  chartHiddenGroups?: Record<string, true>;
  /** Hide zero-value groups after aggregation. */
  chartOmitZeroValues?: boolean;
  /** Render cumulative values for supported chart types. */
  chartCumulative?: boolean;
  /** Chart viewport height preset. */
  chartHeight?: ChartHeight;
  /** Grid line display mode. */
  chartGridLines?: ChartGridLines;
  /** Axis title display mode. */
  chartAxisNames?: ChartAxisNames;
  /** Show generated chart title. Defaults to true. */
  chartShowTitle?: boolean;
  /** Optional custom chart title. When empty, the generated title is used. */
  chartTitle?: string;
  /** Show value labels on chart marks. */
  chartShowDataLabels?: boolean;
  /** Label display mode for donut charts. */
  chartDataLabelMode?: ChartDataLabelMode;
  /** Color strategy for chart data labels. */
  chartDataLabelColor?: ChartDataLabelColor;
  /** Smooth line interpolation. */
  chartSmoothLine?: boolean;
  /** Fill line/area series with a subtle gradient. */
  chartGradientArea?: boolean;
  /** Show chart legend. */
  chartShowLegend?: boolean;
  /** Palette used for chart marks. */
  chartColorPalette?: ChartColorPalette;
  /** Use value intensity when coloring single-series marks. */
  chartColorByValue?: boolean;
  /** Show aggregate value in donut center. */
  chartShowDonutCenter?: boolean;
  /** Donut center display mode. Legacy chartShowDonutCenter=true maps to total. */
  chartDonutCenterMode?: ChartDonutCenterMode;
  /** Value axis range behavior for charts with axes. */
  chartValueAxisRange?: ChartValueAxisRange;
  /** Custom value axis minimum when chartValueAxisRange is custom. */
  chartValueAxisMin?: number;
  /** Custom value axis maximum when chartValueAxisRange is custom. */
  chartValueAxisMax?: number;
  /** Optional reference lines drawn on the value axis. */
  chartReferenceLines?: ChartReferenceLine[];
  /** Per-renderer state so table and board can keep independent visible columns, filters, and sorting. */
  viewStates?: Partial<Record<DatabaseViewType, ViewModeStateDef>>;
}

export interface PluginSettings {
  /** @deprecated Always empty after migration to file-based storage. Kept for migration read-back. */
  databases: DatabaseConfig[];
  databaseFolder: string;
  databaseFileOrder?: string[];
  /** Open db_view Markdown files in a fresh tab when launched from the file explorer. */
  databaseFilesAlwaysOpenInNewTab?: boolean;
  /** Reuse an existing database-file tab instead of opening another one. */
  databaseFilesPreventDuplicateTabs?: boolean;
  statusPresets?: StatusPresetDef[];
  defaultStatusPresetId?: string;
  language?: LocaleCode;
  trashedDatabases?: TrashedDatabase[];
  /** Set to true after databases have been migrated from settings to files. */
  databasesMigrated?: boolean;
}

export interface TrashedDatabase {
  database: DatabaseConfig;
  deletedAt: number;
}

/** Generate a unique ID for database/view entities */
export function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
