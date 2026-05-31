import { App } from "obsidian";
import { ColumnDef, SourceRule } from "./types";

/** Filter markdown files by source folder. Empty sourceFolder matches all files. */
function filterByFolder<T extends { path: string }>(files: T[], sourceFolder: string): T[] {
	if (!sourceFolder) return files;
	return files.filter(f => f.path.startsWith(sourceFolder + "/"));
}

/** Check if a frontmatter record matches source rules (type filter). */
function matchesRules(fm: Record<string, unknown>, rules: SourceRule[] | undefined): boolean {
	if (!rules) return true;
	for (const rule of rules) {
		if (rule.op === "eq" && rule.field === "type" && fm["type"] !== rule.value) return false;
	}
	return true;
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
	fileCounts: Map<string, number> = new Map()
): void {
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = cache?.frontmatter as Record<string, unknown> | undefined;
		if (!fm) continue;
		if (!matchesRules(fm, sourceRules)) continue;
		for (const key of Object.keys(fm)) {
			if (!key || key.startsWith("_") || key === "db_view") continue;
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

/** Infer a column type from a key name and sampled frontmatter values. */
export function inferColumnType(key: string, sampleValues: unknown[] = []): ColumnDef["type"] {
	if (sampleValues.length > 0) {
		const nonNull = sampleValues.filter((v) => v != null && v !== "");
		if (nonNull.length > 0) {
			if (key === "tags") return "multi-select";
			if (nonNull.some((v) => Array.isArray(v))) return "multi-select";
			if (nonNull.every((v) => typeof v === "string" && /\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(Date.parse(v)))) return "date";
			if (nonNull.every((v) => typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== ""))) return "number";
			if (nonNull.every((v) => typeof v === "boolean")) return "checkbox";
		}
	}

	const lower = key.toLowerCase();
	if (lower === "file.name") return "text";
	if (lower.includes("date") || lower.includes("time") || key.includes("日期") || key.includes("时间")) return "date";
	if (lower.includes("price") || lower.includes("cost") || lower.includes("amount") || key.includes("费用") || key.includes("金额") || key.includes("花费")) return "currency";
	if (lower.includes("count") || lower.includes("days") || key.includes("天数")) return "number";
	return "text";
}

/** Collect all unique tags from frontmatter in a folder. */
export function getVaultTags(
	app: App,
	sourceFolder: string,
	sourceRules: SourceRule[] | undefined
): string[] {
	const tagSet = new Set<string>();
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = cache?.frontmatter as Record<string, unknown> | undefined;
		if (!fm) continue;
		if (!matchesRules(fm, sourceRules)) continue;
		const tags = fm?.["tags"];
		if (Array.isArray(tags)) {
			for (const t of tags) if (typeof t === "string") tagSet.add(t);
		} else if (typeof tags === "string") {
			for (const t of tags.split(/[,\\s]+/).filter(Boolean)) tagSet.add(t);
		}
		const fmTags = cache?.frontmatter?.tags;
		if (Array.isArray(fmTags)) {
			for (const t of fmTags) if (typeof t === "string") tagSet.add(t.replace(/^#/, ""));
		}
	}
	return Array.from(tagSet).sort();
}

/** Collect unique string values for a field across all source files (for status/select options). */
export function collectUniqueStringValues(
	app: App,
	fieldKey: string,
	sourceFolder: string,
	sourceRules: SourceRule[] | undefined
): string[] {
	const valueSet = new Set<string>();
	const rules = sourceRules || [];
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = cache?.frontmatter as Record<string, unknown> | undefined;
		if (!fm) continue;
		if (!matchesRules(fm, rules)) continue;
		const val = fm[fieldKey];
		if (val == null || val === "") continue;
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
	sourceRules: SourceRule[] | undefined
): string[] {
	const valueSet = new Set<string>();
	const files = filterByFolder(app.vault.getMarkdownFiles(), sourceFolder);
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const fm = cache?.frontmatter as Record<string, unknown> | undefined;
		if (!fm) continue;
		if (!matchesRules(fm, sourceRules)) continue;
		const val = fm[fieldKey];
		if (Array.isArray(val)) {
			for (const item of val) if (typeof item === "string" && item) valueSet.add(item);
		}
	}
	return Array.from(valueSet).sort();
}
