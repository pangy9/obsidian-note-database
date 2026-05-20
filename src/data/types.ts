import { TFile } from "obsidian";
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
  | "red";

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
  type: "number" | "text" | "date";
}

export interface RowData {
  file: TFile;
  frontmatter: Record<string, unknown>;
  computed: Record<string, unknown>;
}

export type FilterOperator = "eq" | "neq" | "contains" | "gt" | "lt" | "gte" | "lte" | "empty" | "notempty";

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

export type DatabaseViewType = "table" | "board" | "gallery" | "list";
export type GroupOrderMode = "text-asc" | "text-desc" | "number-asc" | "number-desc" | "date-asc" | "date-desc" | "checkbox-false-first" | "checkbox-true-first" | "option-asc" | "option-desc" | "multi-select-priority";
export const NO_TITLE_FIELD = "__none";

export type SourceRuleOperator = "inFolder" | "hasTag" | "eq" | "neq" | "contains" | "empty" | "notempty";

export interface SourceRule {
  field: string;
  op: SourceRuleOperator;
  value?: string;
}

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
  newRecordFolder?: string;
  typeFilter?: string;
  schema: RecordSchema;
  syncComputedToFrontmatter?: boolean;
  /** Database-specific status presets. Global presets are used when this is empty. */
  statusPresets?: StatusPresetDef[];
  /** Default status preset id for new status properties in this database. */
  defaultStatusPresetId?: string;
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
  newRecordFolder?: string;
  typeFilter?: string;
  schema: RecordSchema;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  /** Ordered multi-sort rules. Preferred over legacy sortColumn/sortDirection. */
  sortRules?: SortRule[];
  /** Sync computed column results back to note frontmatter when the view is rendered. */
  syncComputedToFrontmatter?: boolean;
  /** View-specific status presets. Database/global presets are used when this is empty. */
  statusPresets?: StatusPresetDef[];
  /** Default status preset id for new status properties created while this view is active. */
  defaultStatusPresetId?: string;
  /** Current visual representation for this view. */
  viewType?: DatabaseViewType;
  displayWidth?: "default" | "wide";
  dashboardDisplayWidth?: "default" | "wide";
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
  /** Per-renderer state so table and board can keep independent visible columns, filters, and sorting. */
  viewStates?: Partial<Record<DatabaseViewType, ViewModeStateDef>>;
}

export interface PluginSettings {
  databases: DatabaseConfig[];
  databaseFolder: string;
  databaseFileOrder?: string[];
  statusPresets?: StatusPresetDef[];
  defaultStatusPresetId?: string;
  language?: LocaleCode;
  trashedDatabases?: TrashedDatabase[];
}

export interface TrashedDatabase {
  database: DatabaseConfig;
  deletedAt: number;
}

/** Generate a unique ID for database/view entities */
export function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
