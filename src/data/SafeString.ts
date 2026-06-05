/**
 * Safely convert an unknown value to a string.
 *
 * Returns the value itself if it is already a string,
 * converts numbers and booleans with String(),
 * serializes Date objects to ISO format,
 * and returns the fallback for objects, null, and undefined.
 *
 * This avoids the "[object Object]" pitfall of String() on plain objects.
 */
export function safeString(value: unknown, fallback = ""): string {
	if (value == null) return fallback;
	if (typeof value === "string") return value || fallback;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value instanceof Date) return value.toISOString();
	return fallback;
}

/**
 * Type guard: check if a value is a record (plain object, not array, not null).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}
