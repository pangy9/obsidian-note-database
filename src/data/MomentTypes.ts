/**
 * Minimal type declarations for Obsidian's bundled moment.js global.
 * Covers only the methods used by this plugin (ComputedField / BaseExpression).
 * No npm package required — moment is provided by the Obsidian runtime.
 */

/** Minimal interface for a moment duration object. */
export interface MomentDurationLike {
	asDays(): number;
	asHours(): number;
	asMinutes(): number;
	asSeconds(): number;
	asMilliseconds(): number;
	humanize(withSuffix?: boolean): string;
}

/** Minimal interface for a moment date object. */
export interface MomentLike {
	year(): number;
	month(): number;
	date(): number;
	hour(): number;
	minute(): number;
	second(): number;
	millisecond(): number;
	day(): number;
	quarter(): number;
	isoWeek(): number;
	format(template: string): string;
	fromNow(): string;
	isValid(): boolean;
	toDate(): Date;
	startOf(unit: string): MomentLike;
	endOf(unit: string): MomentLike;
	add(amount: number | MomentDurationLike, unit?: string): MomentLike;
	subtract(amount: number | MomentDurationLike, unit?: string): MomentLike;
	diff(other: unknown, unit?: string, floating?: boolean): number;
}

/** Constructor / static interface for the global `moment`. */
export interface MomentConstructor {
	(input?: unknown, format?: string | string[], strict?: boolean): MomentLike;
	(input: { year?: number; month?: number; day?: number }): MomentLike;
	duration(input: number | string | { years?: number; months?: number; weeks?: number; days?: number; hours?: number; minutes?: number; seconds?: number; milliseconds?: number }): MomentDurationLike;
	isMoment(value: unknown): value is MomentLike;
	isDuration(value: unknown): value is MomentDurationLike;
	ISO_8601: string;
}
