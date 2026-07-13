import { RowData } from "./types";

/**
 * LexoRank-like manual ordering using variable-length base62 strings.
 *
 * CHARSET order: 0–9 (0–9), A–Z (10–35), a–z (36–61).
 * Ranks are compared using `<` / `>` (ASCII byte order, which matches CHARSET order).
 */

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = CHARSET.length; // 62

function charIndex(ch: string): number {
	const code = ch.charCodeAt(0);
	if (code >= 48 && code <= 57) return code - 48; // '0'-'9'
	if (code >= 65 && code <= 90) return code - 65 + 10; // 'A'-'Z'
	if (code >= 97 && code <= 122) return code - 97 + 36; // 'a'-'z'
	return 0;
}

/**
 * Generate evenly-spaced ranks for the given path list in order.
 * Uses 4-character ranks initially (62^4 ≈ 14.7M positions).
 */
export function generateRanks(paths: string[]): Record<string, string> {
	if (paths.length === 0) return {};
	const ranks: Record<string, string> = {};
	const totalSlots = Math.pow(BASE, 4);
	const step = Math.max(1, Math.floor(totalSlots / (paths.length + 1)));
	for (let i = 0; i < paths.length; i++) {
		const value = step * (i + 1);
		ranks[paths[i]] = intToRank(value, 4);
	}
	return ranks;
}

/**
 * Produce a rank between `a` and `b`.
 * - If `a` is undefined: generate a rank before `b`.
 * - If `b` is undefined: generate a rank after `a`.
 * - If both undefined: return a mid-range rank.
 *
 * Returns `null` if rebalancing is needed (ranks too dense).
 */
export function rankBetween(a?: string, b?: string): string | null {
	if (a == null && b == null) return CHARSET[Math.floor(BASE / 2)];
	if (a == null) return rankBefore(b!);
	if (b == null) return `${a}${CHARSET[Math.floor(BASE / 2)]}`;

	// Both present: ensure a < b
	if (a >= b) return null;
	const rank = midString(a, b);
	return rank && a < rank && rank < b ? rank : null;
}

export function resolveNewEntryRankBounds(
  ranks: Record<string, string>,
  position: { beforePath?: string; afterPath?: string } | undefined,
  fallbackLastPath?: string,
): { lower?: string; upper?: string } {
  const lower = position?.afterPath ? ranks[position.afterPath] : undefined;
  const upper = position?.beforePath ? ranks[position.beforePath] : undefined;
  return {
    lower: lower ?? (upper ? undefined : fallbackLastPath ? ranks[fallbackLastPath] : undefined),
    upper,
  };
}

/** Generate a non-empty rank before `b`, or request a rebalance at the absolute lower edge. */
function rankBefore(b: string): string | null {
	let prefix = "";
	for (const ch of b) {
		const index = charIndex(ch);
		if (index > 0) {
			const lower = Math.floor(index / 2);
			return `${prefix}${CHARSET[lower]}${CHARSET[Math.floor(BASE / 2)]}`;
		}
		prefix += CHARSET[0];
	}
	return null;
}

/**
 * Rebalance all ranks to be evenly spaced.
 * Keeps the same relative order but redistributes ranks uniformly.
 */
export function rebalanceRanks(ranks: Record<string, string>): Record<string, string> {
	const entries = Object.entries(ranks).sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
	if (entries.length === 0) return {};
	const paths = entries.map(([path]) => path);
	return generateRanks(paths);
}

/**
 * Sort rows by their manual rank. Rows with a rank come first (sorted by rank),
 * rows without a rank keep their original order and are appended at the end.
 */
export function sortByManualRank(rows: RowData[], ranks: Record<string, string>): RowData[] {
	const ranked: RowData[] = [];
	const unranked: RowData[] = [];
	for (const row of rows) {
		if (ranks[row.file.path] != null) {
			ranked.push(row);
		} else {
			unranked.push(row);
		}
	}
	ranked.sort((a, b) => {
		const ra = ranks[a.file.path] || "";
		const rb = ranks[b.file.path] || "";
		return ra < rb ? -1 : ra > rb ? 1 : 0;
	});
	return [...ranked, ...unranked];
}

/**
 * 判断视图是否处于「显式排序」状态：存在 sortColumn，或 sortRules 中至少一条
 * 有效规则（field 与 direction 均非空）。
 *
 * 显式排序生效时 manual order（手动排序）会被覆盖、组内重排序应禁用；但跨组
 * 移动只改分组值、与排序规则无关，不应受此约束。
 *
 * 供 table / board / gallery / list / timeline 统一判断，避免各 renderer 各写
 * 一份导致口径不一致（如旧看板漏过滤无效 sortRule 而误禁用拖拽）。
 */
export function isExplicitlySorted(config: {
  sortColumn?: string;
  sortRules?: Array<{ field?: string; direction?: string }>;
}): boolean {
  if (config.sortColumn) return true;
  return (config.sortRules || []).some((rule) => Boolean(rule.field && rule.direction));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a non-negative integer to a fixed-length base62 string.
 */
function intToRank(value: number, length: number): string {
	let result = "";
	let remaining = value;
	for (let i = 0; i < length; i++) {
		result = CHARSET[remaining % BASE] + result;
		remaining = Math.floor(remaining / BASE);
	}
	return result;
}

/**
 * Find a base62 string that sorts between `a` and `b` (where a < b).
 * Returns `null` if no midpoint can be found without excessive length.
 */
function midString(a: string, b: string): string | null {
	const maxLen = Math.max(a.length, b.length, 1);
	const pa = a.padEnd(maxLen, CHARSET[0]);
	const pb = b.padEnd(maxLen, CHARSET[0]);

	const result: number[] = [];

	for (let i = 0; i < maxLen; i++) {
		const ia = charIndex(pa[i]);
		const ib = charIndex(pb[i]);

		if (ia === ib) {
			result.push(ia);
			continue;
		}

		// ia < ib (guaranteed since a < b)
		const mid = Math.floor((ia + ib) / 2);

		if (mid > ia) {
			// Gap at this position — take midpoint and done
			result.push(mid);
			return result.map((idx) => CHARSET[idx]).join("");
		}

		// mid === ia, meaning ib === ia + 1
		// No gap at this position. Take a's char and continue to next.
		result.push(ia);
	}

	// All positions matched or diff-by-1 — extend with a mid character
	result.push(Math.floor(BASE / 2));

	if (result.length > maxLen + 2) return null;

	return result.map((idx) => CHARSET[idx]).join("");
}
