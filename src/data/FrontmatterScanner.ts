import { App, CachedMetadata, getAllTags, normalizePath, TFile } from "obsidian";
import { evaluateBaseFilterExpression } from "./BaseExpression";
import { evaluateComputedFields } from "./ComputedEvaluator";
import { ColumnDef, ComputedFieldDef, SourceRule, SourceRuleNode } from "./types";
import { hasObsidianTagValue, isObsidianTagsKey, toObsidianTagValues } from "./ColumnTypes";
import { hasDateTimeValue } from "./DateTimeFormat";
import { getSourceRuleTree, matchesBaseSourceType, matchesSourceRuleTree, sourceRuleContainsValue, sourceRuleValuesLooseEqual, sourceRuleValuesStrictEqual } from "./SourceRules";
import { fileHasLink, getFileFieldFixedType, getFileFieldValue, isBaseFileField, isFileFieldKey } from "./FileFields";
import { stringifyValue } from "./Stringify";

const MAX_SOURCE_RULE_MATCH_TEXT_LENGTH = 10000;

type SourceLogic = "and" | "or";

/** Treat empty or "/" as the vault root and keep stored paths vault-relative. */
function normalizeVaultFolder(folderPath: string): string {
	const normalized = normalizePath(folderPath || "");
	return normalized === "/" ? "" : normalized.replace(/^\/+/, "");
}

/** Check whether a Markdown file belongs to a vault-relative folder. */
function isInFolder(file: TFile, folderPath: string): boolean {
	const folder = normalizeVaultFolder(folderPath);
	if (!folder) return true;
	return file.path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

/** Filter markdown files by source folder. Empty sourceFolder matches all files. */
function filterByFolder<T extends TFile>(files: T[], sourceFolder: string): T[] {
	return files.filter((file) => isInFolder(file, sourceFolder));
}

/** Remove only a folder rule already enforced by sourceFolder. */
function getEffectiveRules(sourceFolder: string, rules: SourceRule[] | undefined): SourceRule[] {
	const folder = normalizeVaultFolder(sourceFolder);
	if (!folder) return rules || [];
	return (rules || []).filter((rule) => (
		rule.op !== "inFolder" ||
		normalizeVaultFolder(stringifyValue(rule.value)) !== folder
	));
}

/** Collect normalized frontmatter and inline tags for source-rule matching. */
function getTags(fm: Record<string, unknown>, cache?: CachedMetadata | null): string[] {
	return toObsidianTagValues([
		...toObsidianTagValues(fm["tags"]),
		...(cache ? getAllTags(cache) || [] : []),
	]);
}

function getBaseComputedEvaluationContext(app: App, file: TFile, baseThisFile?: TFile): {
	app: App;
	file: TFile;
	thisFile?: TFile;
	thisFrontmatter?: Record<string, unknown>;
} {
	return {
		app,
		file,
		thisFile: baseThisFile,
		thisFrontmatter: baseThisFile
			? app.metadataCache.getFileCache(baseThisFile)?.frontmatter
			: undefined,
	};
}

/** Read file.* and frontmatter values used by source rules. */
function getSourceFieldValue(
	file: TFile,
	fm: Record<string, unknown>,
	field: string,
	cache?: CachedMetadata | null,
	app?: App,
	computedFields?: ComputedFieldDef[],
	columns?: ColumnDef[],
	baseThisFile?: TFile
): unknown {
	if (field.startsWith("formula.")) {
		const key = field.slice("formula.".length);
		if (!app || !computedFields?.some((computed) => computed.key === key)) return undefined;
		return evaluateComputedFields(computedFields, columns || [], fm, getBaseComputedEvaluationContext(app, file, baseThisFile))[key];
	}
	if (isBaseFileField(field)) return getFileFieldValue(file, field, fm, cache, app);
	if (field === "folder") return file.parent?.path || "";
	if (field === "tags") return getTags(fm, cache).join(" ");
	return fm[field];
}

/** Match source rules using the same operators as DataSource database queries. */
function matchesRule(
	file: TFile,
	fm: Record<string, unknown>,
	rule: SourceRule,
	cache?: CachedMetadata | null,
	app?: App,
	columns?: ColumnDef[],
	computedFields?: ComputedFieldDef[],
	baseThisFile?: TFile
): boolean {
	const value = getSourceFieldValue(file, fm, rule.field, cache, app, computedFields, columns, baseThisFile);
	const expected = stringifyValue(rule.value);
	if (rule.op === "inFolder") return isInFolder(file, expected);
	if (rule.op === "hasTag") return hasObsidianTagValue(getTags(fm, cache), expected);
	if (rule.op === "hasProperty") return Object.prototype.hasOwnProperty.call(fm, rule.field);
	if (rule.op === "hasLink") return fileHasLink(app, file, expected, cache);
	if (rule.op === "eq") return baseSourceValuesEqual(value, rule, columns);
	if (rule.op === "neq") return !baseSourceValuesEqual(value, rule, columns);
	if (rule.op === "strictEq") return sourceRuleValuesStrictEqual(value, rule);
	if (rule.op === "strictNeq") return !sourceRuleValuesStrictEqual(value, rule);
	if (rule.op === "contains") return sourceRuleContainsValue(value, rule);
	if (rule.op === "startsWith") return matchesStringSourceRuleValue(value, (text) => text.startsWith(expected));
	if (rule.op === "endsWith") return matchesStringSourceRuleValue(value, (text) => text.endsWith(expected));
	if (rule.op === "matches") {
		const regex = parseSourceRuleRegex(expected);
		return regex ? matchesStringSourceRuleValue(value, (text) => {
			regex.lastIndex = 0;
			return regex.test(text);
		}) : false;
	}
	if (rule.op === "isType") return matchesBaseSourceType(value, expected, rule.field, columns, computedFields);
	if (rule.op === "gt") return compareSourceRuleValue(value, rule, columns, (result) => result > 0);
	if (rule.op === "gte") return compareSourceRuleValue(value, rule, columns, (result) => result >= 0);
	if (rule.op === "lt") return compareSourceRuleValue(value, rule, columns, (result) => result < 0);
	if (rule.op === "lte") return compareSourceRuleValue(value, rule, columns, (result) => result <= 0);
	if (rule.op === "empty") return isBaseSourceEmptyValue(value);
	if (rule.op === "notempty") return !isBaseSourceEmptyValue(value);
	if (rule.op === "truthy") return Boolean(value);
	return true;
}

function isBaseSourceEmptyValue(value: unknown): boolean {
	if (value == null || value === "") return true;
	if (typeof value === "number") return !Number.isFinite(value);
	if (Array.isArray(value)) return value.length === 0;
	if (value instanceof Date) return !Number.isFinite(value.getTime());
	if (value && typeof value === "object") return Object.keys(value).length === 0;
	return false;
}

function baseSourceValuesEqual(value: unknown, rule: SourceRule, columns?: ColumnDef[]): boolean {
	if (Array.isArray(value)) return value.length === 1 && baseSourceScalarValuesEqual(value[0], rule, columns);
	return baseSourceScalarValuesEqual(value, rule, columns);
}

function baseSourceScalarValuesEqual(value: unknown, rule: SourceRule, columns?: ColumnDef[]): boolean {
	const expected = String(rule.value ?? "");
	if (shouldCompareSourceRuleAsDate(rule, columns)) {
		const leftDate = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(stringifyValue(value));
		const rightDate = Date.parse(expected);
		if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate === rightDate;
	}
	if (rule.valueType) return sourceRuleValuesLooseEqual(value, rule);
	return stringifyValue(value) === expected;
}

function shouldCompareSourceRuleAsDate(rule: SourceRule, columns?: ColumnDef[]): boolean {
	if (rule.valueType === "date") return true;
	return isFileFieldKey(rule.field) && getFileFieldFixedType(rule.field) === "date";
}

function matchesStringSourceRuleValue(value: unknown, predicate: (text: string) => boolean): boolean {
	const values = Array.isArray(value) ? value : [value];
	return values.some((item) => {
		if (item == null) return false;
		const text = stringifyValue(item);
		return text.length <= MAX_SOURCE_RULE_MATCH_TEXT_LENGTH && predicate(text);
	});
}

function parseSourceRuleRegex(expected: string): RegExp | undefined {
	const literal = expected.match(/^\/((?:\\.|[^/\\\n])*)\/([a-z]*)$/);
	try {
		return literal ? new RegExp(literal[1], literal[2]) : new RegExp(expected);
	} catch {
		return undefined;
	}
}

function compareSourceRuleValue(value: unknown, rule: SourceRule, columns: ColumnDef[] | undefined, predicate: (result: number) => boolean): boolean {
	const expected = stringifyValue(rule.value);
	const values = Array.isArray(value) ? value : [value];
	return values.some((item) => {
		if (item == null || item === "") return false;
		return predicate(compareScalarSourceRuleValue(item, expected, shouldCompareSourceRuleAsDate(rule, columns)));
	});
}

function compareScalarSourceRuleValue(value: unknown, expected: string, preferDate: boolean): number {
	if (preferDate) {
		const leftDate = value instanceof Date ? value.getTime() : Date.parse(stringifyValue(value));
		const rightDate = Date.parse(expected);
		if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
	}
	const leftNumber = typeof value === "number" ? value : Number(value);
	const rightNumber = Number(expected);
	if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
	const rightDate = Date.parse(expected);
	const leftDate = value instanceof Date
		? value.getTime()
		: typeof value === "number" && Number.isFinite(rightDate)
			? value
			: Date.parse(stringifyValue(value));
	if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
	return stringifyValue(value).localeCompare(expected);
}

/** Check if a file and its frontmatter match the configured source rules. */
function matchesRules(
	file: TFile,
	fm: Record<string, unknown>,
	sourceFolder: string,
	rules: SourceRule[] | undefined,
	logic: SourceLogic = "and",
	sourceRuleTree?: SourceRuleNode,
	cache?: CachedMetadata | null,
	app?: App,
	computedFields?: ComputedFieldDef[],
	columns?: ColumnDef[],
	baseThisFile?: TFile
): boolean {
	const effectiveRules = getEffectiveRules(sourceFolder, rules);
	const tree = getSourceRuleTree(sourceRuleTree, effectiveRules, logic);
	return tree ? matchesSourceRuleTree(
		tree,
		(rule) => matchesRule(file, fm, rule, cache, app, columns, computedFields, baseThisFile),
		(rule) => {
			if (!app) return false;
			try {
				const thisFrontmatter = baseThisFile
					? app.metadataCache.getFileCache(baseThisFile)?.frontmatter
					: undefined;
				return evaluateBaseFilterExpression(rule.expression, { app, file, frontmatter: fm, thisFile: baseThisFile, thisFrontmatter, computedFields, columns });
			} catch {
				return false;
			}
		}
	) : true;
}

/**
 * Scan markdown files in a folder and collect all frontmatter keys,
 * sample values (up to 10 per key), and file counts per key.
 * When sourceFolder is empty, scans all vault markdown files.
 */
export function collectFileFrontmatterKeys(
	app: App,
	sourceFolder: string,
	sourceRules: SourceRule[] | undefined,
	allKeys: Map<string, string>,
	sampleValues: Map<string, unknown[]>,
	fileCounts: Map<string, number> = new Map(),
	sourceLogic: SourceLogic = "and",
	sourceRuleTree?: SourceRuleNode,
	computedFields?: ComputedFieldDef[],
	columns?: ColumnDef[],
	baseThisFile?: TFile
): void {
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = cache?.frontmatter;
		if (!fm || fm["db_view"] === true) continue;
		if (!matchesRules(f, fm, sourceFolder, sourceRules, sourceLogic, sourceRuleTree, cache, app, computedFields, columns, baseThisFile)) continue;
		for (const key of Object.keys(fm)) {
			if (!key || key.startsWith("_") || key === "db_view") continue;
			if (isFileFieldKey(key)) continue;
			if (!allKeys.has(key)) {
				allKeys.set(key, key);
			}
			if (!sampleValues.has(key)) sampleValues.set(key, []);
			const samples = sampleValues.get(key)!;
			if (samples.length < 10 && fm[key] != null) {
				samples.push(fm[key]);
			}
			fileCounts.set(key, (fileCounts.get(key) || 0) + 1);
		}
	}
}

export function collectComputedFieldSamples(
	app: App,
	sourceFolder: string,
	sourceRules: SourceRule[] | undefined,
	sourceLogic: SourceLogic = "and",
	sourceRuleTree: SourceRuleNode | undefined,
	computedFields: ComputedFieldDef[],
	columns: ColumnDef[],
	limit = 10,
	baseThisFile?: TFile
): Map<string, unknown[]> {
	const samples = new Map<string, unknown[]>();
	if (computedFields.length === 0) return samples;
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = (cache?.frontmatter) || {};
		if (fm["db_view"] === true) continue;
		if (!matchesRules(f, fm, sourceFolder, sourceRules, sourceLogic, sourceRuleTree, cache, app, computedFields, columns, baseThisFile)) continue;
		const computed = evaluateComputedFields(computedFields, columns, fm, getBaseComputedEvaluationContext(app, f, baseThisFile));
		for (const def of computedFields) {
			const value = computed[def.key];
			if (value == null || value === "") continue;
			const list = samples.get(def.key) || [];
			if (list.length >= limit) continue;
			list.push(normalizeComputedSampleValue(value));
			samples.set(def.key, list);
		}
		if (computedFields.every((def) => (samples.get(def.key)?.length || 0) >= limit)) break;
	}
	return samples;
}

function normalizeComputedSampleValue(value: unknown): unknown {
	if (value instanceof Date) return value;
	if (value && typeof value === "object" && typeof (value as { toString?: unknown }).toString === "function") {
		const text = stringifyValue(value);
		if (/^\d{4}-\d{2}-\d{2}/.test(text) && !Number.isNaN(Date.parse(text))) return text;
	}
	return value;
}

/** Infer a column type from a key name and sampled frontmatter values. */
export function inferColumnType(key: string, sampleValues: unknown[] = []): ColumnDef["type"] {
	if (sampleValues.length > 0) {
		const nonNull = sampleValues.filter((v) => v != null && v !== "");
		if (nonNull.length > 0) {
			if (isObsidianTagsKey(key)) return "multi-select";
			if (nonNull.some((v) => Array.isArray(v))) return "multi-select";
			if (nonNull.every((v) => v instanceof Date || (typeof v === "string" && /\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(Date.parse(v))))) {
				return nonNull.some((v) => hasDateTimeValue(v)) ? "datetime" : "date";
			}
			if (nonNull.every((v) => typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== ""))) return "number";
			if (nonNull.every((v) => typeof v === "boolean")) return "checkbox";
		}
	}

	const lower = key.toLowerCase();
	if (isFileFieldKey(lower)) return getFileFieldFixedType(lower);
	if (lower.includes("datetime") || lower.includes("date_time") || lower.includes("date-time")) return "datetime";
	if (lower.includes("date") || lower.includes("time") || key.includes("日期") || key.includes("时间")) return "date";
	if (lower.includes("price") || lower.includes("cost") || lower.includes("amount") || key.includes("费用") || key.includes("金额") || key.includes("花费")) return "currency";
	if (lower.includes("count") || lower.includes("days") || key.includes("天数")) return "number";
	return "text";
}

/** Collect all unique tags from frontmatter in a folder. */
export function getVaultTags(
	app: App,
	sourceFolder: string,
	sourceRules: SourceRule[] | undefined,
	sourceLogic: SourceLogic = "and",
	sourceRuleTree?: SourceRuleNode,
	computedFields?: ComputedFieldDef[],
	columns?: ColumnDef[],
	baseThisFile?: TFile
): string[] {
	const tagSet = new Set<string>();
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = cache?.frontmatter;
		if (!fm || fm["db_view"] === true) continue;
		if (!matchesRules(f, fm, sourceFolder, sourceRules, sourceLogic, sourceRuleTree, cache, app, computedFields, columns, baseThisFile)) continue;
		for (const tag of getTags(fm, cache)) tagSet.add(tag);
	}
	return Array.from(tagSet).sort();
}

/** Collect unique string values for a field across all source files (for status/select options). */
export function collectUniqueStringValues(
	app: App,
	fieldKey: string,
	sourceFolder: string,
	sourceRules: SourceRule[] | undefined,
	sourceLogic: SourceLogic = "and",
	sourceRuleTree?: SourceRuleNode,
	computedFields?: ComputedFieldDef[],
	columns?: ColumnDef[],
	baseThisFile?: TFile
): string[] {
	const valueSet = new Set<string>();
	const rules = sourceRules || [];
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = (cache?.frontmatter) || {};
		if (fm["db_view"] === true) continue;
		if (!matchesRules(f, fm, sourceFolder, rules, sourceLogic, sourceRuleTree, cache, app, computedFields, columns, baseThisFile)) continue;
		const val = getSourceFieldValue(f, fm, fieldKey, cache, app, computedFields, columns, baseThisFile);
		if (val == null || val === "") continue;
		if (isObsidianTagsKey(fieldKey)) {
			for (const tag of toObsidianTagValues(val)) valueSet.add(tag);
			continue;
		}
		if (Array.isArray(val)) {
			for (const item of val) if (typeof item === "string" && item) valueSet.add(item);
		} else if (typeof val === "string") {
			valueSet.add(val);
		}
	}
	return Array.from(valueSet).sort();
}

/** Collect unique list values for a field across all source files. */
export function collectUniqueListValues(
	app: App,
	fieldKey: string,
	sourceFolder: string,
	sourceRules: SourceRule[] | undefined,
	sourceLogic: SourceLogic = "and",
	sourceRuleTree?: SourceRuleNode,
	computedFields?: ComputedFieldDef[],
	columns?: ColumnDef[],
	baseThisFile?: TFile
): string[] {
	const valueSet = new Set<string>();
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = (cache?.frontmatter) || {};
		if (fm["db_view"] === true) continue;
		if (!matchesRules(f, fm, sourceFolder, sourceRules, sourceLogic, sourceRuleTree, cache, app, computedFields, columns, baseThisFile)) continue;
		const val = getSourceFieldValue(f, fm, fieldKey, cache, app, computedFields, columns, baseThisFile);
		if (isObsidianTagsKey(fieldKey)) {
			for (const tag of toObsidianTagValues(val)) valueSet.add(tag);
		} else if (Array.isArray(val)) {
			for (const item of val) if (typeof item === "string" && item) valueSet.add(item);
		}
	}
	return Array.from(valueSet).sort();
}
