import { describe, expect, it } from "vitest";
import { safeEval } from "../data/SafeEval";

describe("SafeEval", () => {
	const scope = (vars: Record<string, unknown> = {}) => vars;

	// ── Nullish Coalescing ?? ──

	describe("nullish coalescing ??", () => {
		it("returns left value when not null/undefined", () => {
			expect(safeEval("a ?? b", scope({ a: 1, b: 2 }))).toBe(1);
		});
		it("returns right value when left is null", () => {
			expect(safeEval("a ?? b", scope({ a: null, b: "fallback" }))).toBe("fallback");
		});
		it("returns right value when left is undefined", () => {
			expect(safeEval("a ?? b", scope({ b: 42 }))).toBe(42);
		});
		it("returns left value when it is 0 (falsy but not nullish)", () => {
			expect(safeEval("a ?? b", scope({ a: 0, b: 99 }))).toBe(0);
		});
		it("returns left value when it is empty string", () => {
			expect(safeEval("a ?? b", scope({ a: "", b: "default" }))).toBe("");
		});
		it("returns left value when it is false", () => {
			expect(safeEval("a ?? b", scope({ a: false, b: true }))).toBe(false);
		});
		it("chains with || correctly", () => {
			expect(safeEval("a || b ?? c", scope({ a: 0, b: null, c: 3 }))).toBe(3);
		});
		it("short-circuits: right side not evaluated when left is non-null", () => {
			// If right side were evaluated, referencing 'missing' would give undefined
			expect(safeEval("a ?? missing", scope({ a: 5 }))).toBe(5);
		});
	});

	// ── Optional Chaining ?. ──

	describe("optional chaining ?.", () => {
		it("returns property when object is non-null", () => {
			expect(safeEval("a?.name", scope({ a: { name: "hello" } }))).toBe("hello");
		});
		it("returns undefined when object is null", () => {
			expect(safeEval("a?.name", scope({ a: null }))).toBe(undefined);
		});
		it("returns undefined when object is undefined", () => {
			expect(safeEval("a?.name", scope({}))).toBe(undefined);
		});
		it("works with bracket access", () => {
			expect(safeEval('a?.["key"]', scope({ a: { key: 42 } }))).toBe(42);
		});
		it("returns undefined for bracket access on null", () => {
			expect(safeEval('a?.["key"]', scope({ a: null }))).toBe(undefined);
		});
		it("chains with method calls", () => {
			expect(safeEval("a?.fn()", scope({ a: { fn: () => 99 } }))).toBe(99);
		});
		it("returns undefined for method call on null", () => {
			expect(safeEval("a?.fn()", scope({ a: null }))).toBe(undefined);
		});
		it("chains multiple optional accesses", () => {
			expect(safeEval("a?.b?.c", scope({ a: { b: { c: "deep" } } }))).toBe("deep");
		});
		it("returns undefined in deep chain when middle is null", () => {
			expect(safeEval("a?.b?.c", scope({ a: { b: null } }))).toBe(undefined);
		});
		it("mixed with ??", () => {
			expect(safeEval("a?.name ?? 'default'", scope({ a: null }))).toBe("default");
		});
	});

	// ── Template Literals ──

	describe("template literals", () => {
		it("simple string without interpolation", () => {
			expect(safeEval("`hello world`", scope())).toBe("hello world");
		});
		it("single interpolation", () => {
			expect(safeEval("`Hello ${name}!`", scope({ name: "World" }))).toBe("Hello World!");
		});
		it("multiple interpolations", () => {
			expect(safeEval("`${greeting} ${target}!`", scope({ greeting: "Hi", target: "Obsidian" }))).toBe("Hi Obsidian!");
		});
		it("interpolation with expression", () => {
			expect(safeEval("`Result: ${a + b}`", scope({ a: 3, b: 4 }))).toBe("Result: 7");
		});
		it("interpolation with member access", () => {
			expect(safeEval("`Name: ${obj.name}`", scope({ obj: { name: "test" } }))).toBe("Name: test");
		});
		it("interpolation with null yields empty string", () => {
			expect(safeEval("`Value: ${x}`", scope({ x: null }))).toBe("Value: ");
		});
		it("interpolation with number", () => {
			expect(safeEval("`Count: ${n}`", scope({ n: 42 }))).toBe("Count: 42");
		});
		it("escape sequences in template", () => {
			expect(safeEval("`line1\\nline2`", scope())).toBe("line1\nline2");
		});
	});

	// ── Existing features (regression) ──

	describe("regression", () => {
		it("arithmetic", () => {
			expect(safeEval("2 + 3 * 4", scope())).toBe(14);
		});
		it("comparison", () => {
			expect(safeEval("a > b", scope({ a: 5, b: 3 }))).toBe(true);
		});
		it("ternary", () => {
			expect(safeEval("a > 0 ? 'pos' : 'neg'", scope({ a: -1 }))).toBe("neg");
		});
		it("function call", () => {
			expect(safeEval("fn(1, 2)", scope({ fn: (a: number, b: number) => a + b }))).toBe(3);
		});
		it("arrow function", () => {
			const arr = [1, 2, 3];
			expect(safeEval("arr.map(x => x * 2)", scope({ arr }))).toEqual([2, 4, 6]);
		});
		it("regex", () => {
			expect(safeEval("/test/i.test('TEST')", scope())).toBe(true);
		});
		it("array literal", () => {
			expect(safeEval("[1, 2, 3].length", scope())).toBe(3);
		});
		it("object literal", () => {
			expect(safeEval("({a: 1}).a", scope())).toBe(1);
		});
		it("typeof", () => {
			expect(safeEval("typeof x", scope({ x: 42 }))).toBe("number");
		});
		it("string concatenation", () => {
			expect(safeEval("'hello' + ' ' + 'world'", scope())).toBe("hello world");
		});
	});
});
