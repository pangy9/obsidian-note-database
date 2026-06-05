/**
 * SafeEval — A safe recursive-descent parser and evaluator for
 * JavaScript-like expressions.  Replaces `new Function()` / `eval()`
 * with a controlled interpreter that only supports safe operations.
 *
 * Supported: number / string / regex / template literals, identifiers,
 * member access (dot & bracket & optional chaining `?.`), function calls,
 * unary / binary / ternary / nullish-coalescing operators, arrays,
 * objects, arrow functions, `typeof`, `if … else`, and `return`.
 */

// ─── Token ─────────────────────────────────────────────────────

enum TT {
	Number,
	String,
	Regex,
	Ident,
	True,
	False,
	Null,
	Undef,
	Typeof,
	// Arithmetic
	Add,
	Sub,
	Mul,
	Div,
	Mod,
	Pow,
	// Comparison
	Lt,
	Gt,
	Le,
	Ge,
	Eq,
	Ne,
	Seq,
	Sne,
	// Logical
	And,
	Or,
	Not,
	Nullish,     // ??
	// Ternary / delimiters
	Question,
	Colon,
	OptChain,    // ?.
	LParen,
	RParen,
	LBracket,
	RBracket,
	LBrace,
	RBrace,
	Dot,
	Comma,
	Semi,
	Arrow,
	Spread,
	// Template literal
	Template,    // carries cooked parts + raw expression strings
	// Statement keywords
	If,
	Else,
	Return,
	// End
	EOF,
}

interface Token {
	type: TT;
	value: string;
	/** For Template tokens: alternating cooked strings and raw expression texts */
	parts?: Array<{ cooked: string } | { raw: string }>;
}

// ─── AST Node Types ────────────────────────────────────────────

type ASTNode =
	| { type: "Literal"; value: unknown }
	| { type: "Ident"; name: string }
	| { type: "Unary"; op: string; arg: ASTNode }
	| { type: "Binary"; op: string; left: ASTNode; right: ASTNode }
	| { type: "Cond"; test: ASTNode; cons: ASTNode; alt: ASTNode }
	| { type: "Call"; callee: ASTNode; args: ASTNode[]; optional: boolean }
	| { type: "Member"; obj: ASTNode; prop: ASTNode; computed: boolean; optional: boolean }
	| { type: "Array"; elements: ASTNode[] }
	| { type: "Object"; props: Array<{ key: string | ASTNode; value: ASTNode; computed: boolean }> }
	| { type: "Arrow"; params: string[]; body: ASTNode }
	| { type: "Regex"; pattern: string; flags: string }
	| { type: "Spread"; arg: ASTNode }
	| { type: "Return"; value: ASTNode }
	| { type: "If"; test: ASTNode; cons: ASTNode; alt: ASTNode | null }
	| { type: "Template"; parts: Array<string | ASTNode> };

// ─── Tokenizer ─────────────────────────────────────────────────

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let pos = 0;
	let prevWasValue = false;

	const len = source.length;

	while (pos < len) {
		const ch = source[pos];

		// ── whitespace ──
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			pos += 1;
			continue;
		}

		// ── semicolon ──
		if (ch === ";") {
			tokens.push({ type: TT.Semi, value: ";" });
			pos += 1;
			prevWasValue = false;
			continue;
		}

		// ── numbers ──
		if (ch >= "0" && ch <= "9") {
			let num = "";
			if (ch === "0" && pos + 1 < len && (source[pos + 1] === "x" || source[pos + 1] === "X")) {
				pos += 2;
				while (pos < len && /[0-9a-fA-F]/.test(source[pos])) num += source[pos++];
				tokens.push({ type: TT.Number, value: parseInt(num, 16).toString() });
				prevWasValue = true;
				continue;
			}
			while (pos < len && source[pos] >= "0" && source[pos] <= "9") num += source[pos++];
			if (pos < len && source[pos] === ".") {
				num += source[pos++];
				while (pos < len && source[pos] >= "0" && source[pos] <= "9") num += source[pos++];
			}
			if (pos < len && (source[pos] === "e" || source[pos] === "E")) {
				num += source[pos++];
				if (pos < len && (source[pos] === "+" || source[pos] === "-")) num += source[pos++];
				while (pos < len && source[pos] >= "0" && source[pos] <= "9") num += source[pos++];
			}
			tokens.push({ type: TT.Number, value: num });
			prevWasValue = true;
			continue;
		}

		// ── dot-starting numbers (.5) or spread (...) or dot ──
		if (ch === ".") {
			if (pos + 2 < len && source[pos + 1] === "." && source[pos + 2] === ".") {
				tokens.push({ type: TT.Spread, value: "..." });
				pos += 3;
				prevWasValue = false;
				continue;
			}
			if (pos + 1 < len && source[pos + 1] >= "0" && source[pos + 1] <= "9") {
				let num = ".";
				pos += 1;
				while (pos < len && source[pos] >= "0" && source[pos] <= "9") num += source[pos++];
				if (pos < len && (source[pos] === "e" || source[pos] === "E")) {
					num += source[pos++];
					if (pos < len && (source[pos] === "+" || source[pos] === "-")) num += source[pos++];
					while (pos < len && source[pos] >= "0" && source[pos] <= "9") num += source[pos++];
				}
				tokens.push({ type: TT.Number, value: num });
				prevWasValue = true;
				continue;
			}
			tokens.push({ type: TT.Dot, value: "." });
			pos += 1;
			prevWasValue = false;
			continue;
		}

		// ── strings (single / double quote) ──
		if (ch === '"' || ch === "'") {
			const str = scanQuoteString(source, pos);
			tokens.push({ type: TT.String, value: str.value });
			pos = str.end;
			prevWasValue = true;
			continue;
		}

		// ── template literal (backtick) ──
		if (ch === "`") {
			const tpl = scanTemplateLiteral(source, pos);
			if (tpl.parts.length === 1 && "cooked" in tpl.parts[0]) {
				// No interpolation — plain string
				tokens.push({ type: TT.String, value: (tpl.parts[0] as { cooked: string }).cooked });
			} else {
				tokens.push({ type: TT.Template, value: source.slice(pos, tpl.end), parts: tpl.parts });
			}
			pos = tpl.end;
			prevWasValue = true;
			continue;
		}

		// ── regex (disambiguate from division) ──
		if (ch === "/" && !prevWasValue) {
			const rx = scanRegex(source, pos);
			if (rx) {
				tokens.push({ type: TT.Regex, value: rx.value });
				pos = rx.end;
				prevWasValue = true;
				continue;
			}
		}

		// ── operators and punctuation ──
		const two = pos + 1 < len ? source[pos + 1] : "";
		const three = pos + 2 < len ? source[pos + 2] : "";

		// 3-char operators
		if (three && ((ch === "=" && two === "=" && three === "=") || (ch === "!" && two === "=" && three === "="))) {
			tokens.push({ type: ch === "=" ? TT.Seq : TT.Sne, value: ch + two + three });
			pos += 3;
			prevWasValue = false;
			continue;
		}

		// 2-char operators
		if (two) {
			const pair = ch + two;
			if (pair === "??") { tokens.push({ type: TT.Nullish, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === "?.") { tokens.push({ type: TT.OptChain, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === "==") { tokens.push({ type: TT.Eq, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === "!=") { tokens.push({ type: TT.Ne, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === "<=") { tokens.push({ type: TT.Le, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === ">=") { tokens.push({ type: TT.Ge, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === "&&") { tokens.push({ type: TT.And, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === "||") { tokens.push({ type: TT.Or, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === "**") { tokens.push({ type: TT.Pow, value: pair }); pos += 2; prevWasValue = false; continue; }
			if (pair === "=>") { tokens.push({ type: TT.Arrow, value: pair }); pos += 2; prevWasValue = false; continue; }
		}

		// 1-char operators
		switch (ch) {
			case "+": tokens.push({ type: TT.Add, value: "+" }); pos += 1; prevWasValue = false; continue;
			case "-": tokens.push({ type: TT.Sub, value: "-" }); pos += 1; prevWasValue = false; continue;
			case "*": tokens.push({ type: TT.Mul, value: "*" }); pos += 1; prevWasValue = false; continue;
			case "/": tokens.push({ type: TT.Div, value: "/" }); pos += 1; prevWasValue = false; continue;
			case "%": tokens.push({ type: TT.Mod, value: "%" }); pos += 1; prevWasValue = false; continue;
			case "<": tokens.push({ type: TT.Lt, value: "<" }); pos += 1; prevWasValue = false; continue;
			case ">": tokens.push({ type: TT.Gt, value: ">" }); pos += 1; prevWasValue = false; continue;
			case "!": tokens.push({ type: TT.Not, value: "!" }); pos += 1; prevWasValue = false; continue;
			case "?": tokens.push({ type: TT.Question, value: "?" }); pos += 1; prevWasValue = false; continue;
			case ":": tokens.push({ type: TT.Colon, value: ":" }); pos += 1; prevWasValue = false; continue;
			case "(": tokens.push({ type: TT.LParen, value: "(" }); pos += 1; prevWasValue = false; continue;
			case ")": tokens.push({ type: TT.RParen, value: ")" }); pos += 1; prevWasValue = true; continue;
			case "[": tokens.push({ type: TT.LBracket, value: "[" }); pos += 1; prevWasValue = false; continue;
			case "]": tokens.push({ type: TT.RBracket, value: "]" }); pos += 1; prevWasValue = true; continue;
			case "{": tokens.push({ type: TT.LBrace, value: "{" }); pos += 1; prevWasValue = false; continue;
			case "}": tokens.push({ type: TT.RBrace, value: "}" }); pos += 1; prevWasValue = true; continue;
			case ",": tokens.push({ type: TT.Comma, value: "," }); pos += 1; prevWasValue = false; continue;
		}

		// ── identifiers / keywords ──
		if (ch === "_" || ch === "$" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
			let id = "";
			while (pos < len && (source[pos] === "_" || source[pos] === "$" || (source[pos] >= "a" && source[pos] <= "z") || (source[pos] >= "A" && source[pos] <= "Z") || (source[pos] >= "0" && source[pos] <= "9"))) {
				id += source[pos++];
			}
			switch (id) {
				case "true": tokens.push({ type: TT.True, value: id }); break;
				case "false": tokens.push({ type: TT.False, value: id }); break;
				case "null": tokens.push({ type: TT.Null, value: id }); break;
				case "undefined": tokens.push({ type: TT.Undef, value: id }); break;
				case "typeof": tokens.push({ type: TT.Typeof, value: id }); break;
				case "if": tokens.push({ type: TT.If, value: id }); break;
				case "else": tokens.push({ type: TT.Else, value: id }); break;
				case "return": tokens.push({ type: TT.Return, value: id }); break;
				default: tokens.push({ type: TT.Ident, value: id }); break;
			}
			prevWasValue = true;
			continue;
		}

		throw new SyntaxError(`Unexpected character '${ch}'`);
	}

	tokens.push({ type: TT.EOF, value: "" });
	return tokens;
}

// ── String scanning (single / double quote) ──

function scanQuoteString(source: string, start: number): { value: string; end: number } {
	const quote = source[start];
	let pos = start + 1;
	let raw = "";
	const len = source.length;

	while (pos < len) {
		const ch = source[pos];
		if (ch === "\\") {
			pos += 1;
			if (pos >= len) break;
			raw += scanEscape(source, pos);
			const esc = source[pos];
			if (esc === "u" && pos + 1 < len && source[pos + 1] === "{") {
				const close = source.indexOf("}", pos + 2);
				pos = close >= 0 ? close + 1 : pos + 1;
			} else if (esc === "u") {
				pos += 5;
			} else if (esc === "\r" && pos + 1 < len && source[pos + 1] === "\n") {
				pos += 2;
			} else {
				pos += 1;
			}
		} else if (ch === quote) {
			return { value: raw, end: pos + 1 };
		} else {
			raw += ch;
			pos += 1;
		}
	}

	throw new SyntaxError("Unterminated string literal");
}

function scanEscape(source: string, pos: number): string {
	const esc = source[pos];
	switch (esc) {
		case "n": return "\n";
		case "t": return "\t";
		case "r": return "\r";
		case "b": return "\b";
		case "f": return "\f";
		case "v": return "\v";
		case "0": return "\0";
		case "\n": return "";
		case "\r": return "";
		case "u": {
			if (pos + 1 < source.length && source[pos + 1] === "{") {
				const close = source.indexOf("}", pos + 2);
				if (close >= 0) return String.fromCodePoint(parseInt(source.slice(pos + 2, close), 16));
			}
			if (pos + 4 < source.length) return String.fromCharCode(parseInt(source.slice(pos + 1, pos + 5), 16));
			return esc;
		}
		default: return esc;
	}
}

// ── Template literal scanning ──

function scanTemplateLiteral(source: string, start: number): {
	parts: Array<{ cooked: string } | { raw: string }>;
	end: number;
} {
	let pos = start + 1; // skip opening `
	const len = source.length;
	const parts: Array<{ cooked: string } | { raw: string }> = [];
	let cooked = "";

	while (pos < len) {
		const ch = source[pos];
		if (ch === "\\") {
			pos += 1;
			if (pos >= len) break;
			cooked += scanEscape(source, pos);
			const esc = source[pos];
			if (esc === "u" && pos + 1 < len && source[pos + 1] === "{") {
				const close = source.indexOf("}", pos + 2);
				pos = close >= 0 ? close + 1 : pos + 1;
			} else if (esc === "u") {
				pos += 5;
			} else if (esc === "\r" && pos + 1 < len && source[pos + 1] === "\n") {
				pos += 2;
			} else {
				pos += 1;
			}
		} else if (ch === "`") {
			parts.push({ cooked });
			return { parts, end: pos + 1 };
		} else if (ch === "$" && pos + 1 < len && source[pos + 1] === "{") {
			// Start interpolation
			parts.push({ cooked });
			cooked = "";
			pos += 2; // skip ${
			// Find matching } while respecting nested braces
			const rawExpr = scanTemplateExpression(source, pos);
			parts.push({ raw: rawExpr.text });
			pos = rawExpr.end;
			// Continue scanning after the }
		} else {
			cooked += ch;
			pos += 1;
		}
	}

	throw new SyntaxError("Unterminated template literal");
}

function scanTemplateExpression(source: string, start: number): { text: string; end: number } {
	let pos = start;
	let depth = 1;
	const len = source.length;
	const exprStart = start;

	while (pos < len && depth > 0) {
		const ch = source[pos];
		if (ch === "{" ) depth += 1;
		else if (ch === "}") { depth -= 1; if (depth === 0) break; }
		else if (ch === "'" || ch === '"' || ch === "`") {
			// Skip string literal
			const quote = ch;
			pos += 1;
			while (pos < len) {
				if (source[pos] === "\\") { pos += 2; continue; }
				if (source[pos] === quote) break;
				pos += 1;
			}
		} else if (ch === "/" && pos + 1 < len && source[pos + 1] === "/") {
			// Skip line comment
			while (pos < len && source[pos] !== "\n") pos += 1;
			continue;
		} else if (ch === "/" && pos + 1 < len && source[pos + 1] === "*") {
			// Skip block comment
			pos += 2;
			while (pos + 1 < len && !(source[pos] === "*" && source[pos + 1] === "/")) pos += 1;
			pos += 2;
			continue;
		}
		pos += 1;
	}

	if (depth !== 0) throw new SyntaxError("Unterminated template expression");
	return { text: source.slice(exprStart, pos), end: pos + 1 }; // skip closing }
}

// ── Regex scanning ──

function scanRegex(source: string, start: number): { value: string; end: number } | null {
	if (source[start] !== "/") return null;
	let pos = start + 1;
	const len = source.length;
	let inClass = false;

	while (pos < len) {
		const ch = source[pos];
		if (ch === "\\") { pos += 2; continue; }
		if (ch === "[") { inClass = true; pos += 1; continue; }
		if (ch === "]") { inClass = false; pos += 1; continue; }
		if (ch === "/" && !inClass) {
			pos += 1;
			while (pos < len && /[gimsuy]/.test(source[pos])) pos += 1;
			return { value: source.slice(start, pos), end: pos };
		}
		if (ch === "\n") return null;
		pos += 1;
	}
	return null;
}

// ─── Parser ────────────────────────────────────────────────────

class Parser {
	private tokens: Token[];
	private pos = 0;

	constructor(tokens: Token[]) {
		this.tokens = tokens;
	}

	parse(): ASTNode {
		const node = this.parseStatement();
		if (this.peek().type !== TT.EOF) {
			throw new SyntaxError(`Unexpected token '${this.peek().value}'`);
		}
		return node;
	}

	// ── Statement-level parsing ──

	private parseStatement(): ASTNode {
		if (this.peek().type === TT.Return) {
			this.advance();
			const value = this.parseExpression();
			this.skipSemis();
			if (this.peek().type !== TT.EOF) {
				throw new SyntaxError("Unexpected token after return");
			}
			return { type: "Return", value };
		}

		if (this.peek().type === TT.If) {
			return this.parseIfStatement();
		}

		return this.parseExpression();
	}

	private parseIfStatement(): ASTNode {
		this.expect(TT.If);
		this.expect(TT.LParen);
		const test = this.parseExpression();
		this.expect(TT.RParen);
		this.skipSemis();

		let cons: ASTNode;
		if (this.peek().type === TT.Return) {
			this.advance();
			cons = { type: "Return", value: this.parseExpression() };
		} else {
			cons = this.parseExpression();
		}
		this.skipSemis();

		let alt: ASTNode | null = null;
		if (this.peek().type === TT.Else) {
			this.advance();
			this.skipSemis();
			if (this.peek().type === TT.Return) {
				this.advance();
				alt = { type: "Return", value: this.parseExpression() };
			} else if (this.peek().type === TT.If) {
				alt = this.parseIfStatement();
			} else {
				alt = this.parseExpression();
			}
		}

		return { type: "If", test, cons, alt };
	}

	private skipSemis(): void {
		while (this.peek().type === TT.Semi) this.advance();
	}

	// ── Expression parsing (operator precedence) ──
	// Precedence (lowest → highest):
	//   comma → ternary → nullish(??) → logical OR → logical AND →
	//   equality → relational → additive → multiplicative →
	//   exponential → unary → call/member → primary

	private parseExpression(): ASTNode {
		return this.parseTernary();
	}

	private parseTernary(): ASTNode {
		let node = this.parseNullishCoalescing();
		if (this.peek().type === TT.Question) {
			this.advance();
			const cons = this.parseExpression();
			this.expect(TT.Colon);
			const alt = this.parseExpression();
			return { type: "Cond", test: node, cons, alt };
		}
		return node;
	}

	private parseNullishCoalescing(): ASTNode {
		let left = this.parseLogicalOr();
		while (this.peek().type === TT.Nullish) {
			const op = this.advance().value;
			const right = this.parseLogicalOr();
			left = { type: "Binary", op, left, right };
		}
		return left;
	}

	private parseLogicalOr(): ASTNode {
		let left = this.parseLogicalAnd();
		while (this.peek().type === TT.Or) {
			const op = this.advance().value;
			const right = this.parseLogicalAnd();
			left = { type: "Binary", op, left, right };
		}
		return left;
	}

	private parseLogicalAnd(): ASTNode {
		let left = this.parseEquality();
		while (this.peek().type === TT.And) {
			const op = this.advance().value;
			const right = this.parseEquality();
			left = { type: "Binary", op, left, right };
		}
		return left;
	}

	private parseEquality(): ASTNode {
		let left = this.parseRelational();
		while ([TT.Eq, TT.Ne, TT.Seq, TT.Sne].includes(this.peek().type)) {
			const op = this.advance().value;
			const right = this.parseRelational();
			left = { type: "Binary", op, left, right };
		}
		return left;
	}

	private parseRelational(): ASTNode {
		let left = this.parseAdditive();
		while ([TT.Lt, TT.Gt, TT.Le, TT.Ge].includes(this.peek().type)) {
			const op = this.advance().value;
			const right = this.parseAdditive();
			left = { type: "Binary", op, left, right };
		}
		return left;
	}

	private parseAdditive(): ASTNode {
		let left = this.parseMultiplicative();
		while (this.peek().type === TT.Add || this.peek().type === TT.Sub) {
			const op = this.advance().value;
			const right = this.parseMultiplicative();
			left = { type: "Binary", op, left, right };
		}
		return left;
	}

	private parseMultiplicative(): ASTNode {
		let left = this.parseExponential();
		while (this.peek().type === TT.Mul || this.peek().type === TT.Div || this.peek().type === TT.Mod) {
			const op = this.advance().value;
			const right = this.parseExponential();
			left = { type: "Binary", op, left, right };
		}
		return left;
	}

	private parseExponential(): ASTNode {
		let left = this.parseUnary();
		if (this.peek().type === TT.Pow) {
			const op = this.advance().value;
			const right = this.parseExponential(); // Right-associative
			left = { type: "Binary", op, left, right };
		}
		return left;
	}

	private parseUnary(): ASTNode {
		if (this.peek().type === TT.Not) {
			const op = this.advance().value;
			return { type: "Unary", op, arg: this.parseUnary() };
		}
		if (this.peek().type === TT.Sub) {
			const op = this.advance().value;
			return { type: "Unary", op, arg: this.parseUnary() };
		}
		if (this.peek().type === TT.Add) {
			this.advance(); // Unary plus
			return this.parseUnary();
		}
		if (this.peek().type === TT.Typeof) {
			const op = this.advance().value;
			return { type: "Unary", op, arg: this.parseUnary() };
		}
		return this.parseCallMember();
	}

	private parseCallMember(): ASTNode {
		let node = this.parsePrimary();

		while (true) {
			if (this.peek().type === TT.Dot) {
				this.advance();
				const name = this.expect(TT.Ident).value;
				node = { type: "Member", obj: node, prop: { type: "Literal", value: name }, computed: false, optional: false };
			} else if (this.peek().type === TT.OptChain) {
				// Optional chaining: ?.prop  ?.[expr]  ?.(args)
				this.advance();
				const next = this.peek();
				if (next.type === TT.Ident) {
					const name = this.advance().value;
					node = { type: "Member", obj: node, prop: { type: "Literal", value: name }, computed: false, optional: true };
				} else if (next.type === TT.LBracket) {
					this.advance();
					const prop = this.parseExpression();
					this.expect(TT.RBracket);
					node = { type: "Member", obj: node, prop, computed: true, optional: true };
				} else if (next.type === TT.LParen) {
					const args = this.parseCallArgs();
					node = { type: "Call", callee: node, args, optional: true };
				} else {
					throw new SyntaxError(`Unexpected token after '?.': '${next.value}'`);
				}
			} else if (this.peek().type === TT.LBracket) {
				this.advance();
				const prop = this.parseExpression();
				this.expect(TT.RBracket);
				node = { type: "Member", obj: node, prop, computed: true, optional: false };
			} else if (this.peek().type === TT.LParen) {
				const args = this.parseCallArgs();
				node = { type: "Call", callee: node, args, optional: false };
			} else {
				break;
			}
		}

		return node;
	}

	private parseCallArgs(): ASTNode[] {
		this.expect(TT.LParen);
		const args: ASTNode[] = [];
		if (this.peek().type !== TT.RParen) {
			args.push(this.parseArg());
			while (this.peek().type === TT.Comma) {
				this.advance();
				args.push(this.parseArg());
			}
		}
		this.expect(TT.RParen);
		return args;
	}

	private parseArg(): ASTNode {
		if (this.peek().type === TT.Spread) {
			this.advance();
			return { type: "Spread", arg: this.parseExpression() };
		}
		return this.parseExpression();
	}

	// ── Primary expressions ──

	private parsePrimary(): ASTNode {
		const tok = this.peek();

		// Number
		if (tok.type === TT.Number) {
			this.advance();
			return { type: "Literal", value: parseFloat(tok.value) };
		}

		// String
		if (tok.type === TT.String) {
			this.advance();
			return { type: "Literal", value: tok.value };
		}

		// Template literal with interpolation
		if (tok.type === TT.Template) {
			this.advance();
			return this.buildTemplateNode(tok.parts || []);
		}

		// Regex
		if (tok.type === TT.Regex) {
			this.advance();
			const lastSlash = tok.value.lastIndexOf("/");
			const pattern = tok.value.slice(1, lastSlash);
			const flags = tok.value.slice(lastSlash + 1);
			return { type: "Regex", pattern, flags };
		}

		// Keywords
		if (tok.type === TT.True) { this.advance(); return { type: "Literal", value: true }; }
		if (tok.type === TT.False) { this.advance(); return { type: "Literal", value: false }; }
		if (tok.type === TT.Null) { this.advance(); return { type: "Literal", value: null }; }
		if (tok.type === TT.Undef) { this.advance(); return { type: "Literal", value: undefined }; }

		// Identifier — might be start of arrow function: ident => body
		if (tok.type === TT.Ident) {
			this.advance();
			if (this.peek().type === TT.Arrow) {
				this.advance();
				const body = this.parseExpression();
				return { type: "Arrow", params: [tok.value], body };
			}
			return { type: "Ident", name: tok.value };
		}

		// Parenthesized expression OR arrow function (params) => body
		if (tok.type === TT.LParen) {
			if (this.isArrowFunction()) {
				return this.parseArrowFunction();
			}
			this.advance();
			const expr = this.parseExpression();
			this.expect(TT.RParen);
			return expr;
		}

		// Array literal
		if (tok.type === TT.LBracket) {
			return this.parseArrayLiteral();
		}

		// Object literal
		if (tok.type === TT.LBrace) {
			return this.parseObjectLiteral();
		}

		throw new SyntaxError(`Unexpected token '${tok.value}'`);
	}

	/** Build a Template AST node from parts (alternating cooked strings and raw expressions) */
	private buildTemplateNode(parts: Array<{ cooked: string } | { raw: string }>): ASTNode {
		const astParts: Array<string | ASTNode> = [];
		for (const part of parts) {
			if ("cooked" in part) {
				astParts.push(part.cooked);
			} else {
				// Parse the raw expression text into an AST node
				const subTokens = tokenize(part.raw);
				const subAst = new Parser(subTokens).parse();
				astParts.push(subAst);
			}
		}
		return { type: "Template", parts: astParts };
	}

	private isArrowFunction(): boolean {
		let depth = 0;
		let i = this.pos;
		while (i < this.tokens.length) {
			const t = this.tokens[i];
			if (t.type === TT.LParen) depth += 1;
			else if (t.type === TT.RParen) {
				depth -= 1;
				if (depth === 0) {
					return i + 1 < this.tokens.length && this.tokens[i + 1].type === TT.Arrow;
				}
			}
			i += 1;
		}
		return false;
	}

	private parseArrowFunction(): ASTNode {
		this.expect(TT.LParen);
		const params: string[] = [];
		if (this.peek().type !== TT.RParen) {
			params.push(this.expect(TT.Ident).value);
			while (this.peek().type === TT.Comma) {
				this.advance();
				params.push(this.expect(TT.Ident).value);
			}
		}
		this.expect(TT.RParen);
		this.expect(TT.Arrow);
		const body = this.parseExpression();
		return { type: "Arrow", params, body };
	}

	private parseArrayLiteral(): ASTNode {
		this.expect(TT.LBracket);
		const elements: ASTNode[] = [];
		if (this.peek().type !== TT.RBracket) {
			elements.push(this.parseArg());
			while (this.peek().type === TT.Comma) {
				this.advance();
				if (this.peek().type === TT.RBracket) break;
				elements.push(this.parseArg());
			}
		}
		this.expect(TT.RBracket);
		return { type: "Array", elements };
	}

	private parseObjectLiteral(): ASTNode {
		this.expect(TT.LBrace);
		const props: Array<{ key: string | ASTNode; value: ASTNode; computed: boolean }> = [];
		if (this.peek().type !== TT.RBrace) {
			props.push(this.parseObjectProperty());
			while (this.peek().type === TT.Comma) {
				this.advance();
				if (this.peek().type === TT.RBrace) break;
				props.push(this.parseObjectProperty());
			}
		}
		this.expect(TT.RBrace);
		return { type: "Object", props };
	}

	private parseObjectProperty(): { key: string | ASTNode; value: ASTNode; computed: boolean } {
		if (this.peek().type === TT.LBracket) {
			this.advance();
			const key = this.parseExpression();
			this.expect(TT.RBracket);
			this.expect(TT.Colon);
			const value = this.parseExpression();
			return { key, value, computed: true };
		}
		if (this.peek().type === TT.String) {
			const key = this.advance().value;
			this.expect(TT.Colon);
			const value = this.parseExpression();
			return { key, value, computed: false };
		}
		if (this.peek().type === TT.Number) {
			const key = this.advance().value;
			this.expect(TT.Colon);
			const value = this.parseExpression();
			return { key, value, computed: false };
		}
		if (this.peek().type === TT.Ident) {
			const name = this.advance().value;
			if (this.peek().type === TT.Colon) {
				this.advance();
				const value = this.parseExpression();
				return { key: name, value, computed: false };
			}
			return { key: name, value: { type: "Ident", name }, computed: false };
		}
		throw new SyntaxError(`Unexpected token '${this.peek().value}' in object literal`);
	}

	// ── Helpers ──

	private peek(): Token {
		return this.tokens[this.pos];
	}

	private advance(): Token {
		return this.tokens[this.pos++];
	}

	private expect(type: TT): Token {
		const tok = this.peek();
		if (tok.type !== type) {
			throw new SyntaxError(`Expected ${TT[type]} but got '${tok.value}'`);
		}
		return this.advance();
	}
}

// ─── Evaluator ─────────────────────────────────────────────────

class ReturnSignal extends Error {
	constructor(public readonly value: unknown) {
		super("ReturnSignal");
	}
}

function evalNode(node: ASTNode, scope: Record<string, unknown>): unknown {
	switch (node.type) {
		case "Literal":
			return node.value;

		case "Ident":
			return scope[node.name];

		case "Unary": {
			const val = evalNode(node.arg, scope);
			if (node.op === "!") return !val;
			if (node.op === "-") return -toNumber(val);
			if (node.op === "typeof") {
				if (val === undefined) return "undefined";
				return typeof val;
			}
			return val;
		}

		case "Binary": {
			// Short-circuit for logical / nullish operators
			if (node.op === "&&") return evalNode(node.left, scope) && evalNode(node.right, scope);
			if (node.op === "||") return evalNode(node.left, scope) || evalNode(node.right, scope);
			if (node.op === "??") {
				const left = evalNode(node.left, scope);
				return (left !== null && left !== undefined) ? left : evalNode(node.right, scope);
			}

			const left = evalNode(node.left, scope);
			const right = evalNode(node.right, scope);

			switch (node.op) {
				case "+": return addValues(left, right);
				case "-": return toNumber(left) - toNumber(right);
				case "*": return toNumber(left) * toNumber(right);
				case "/": return toNumber(left) / toNumber(right);
				case "%": return toNumber(left) % toNumber(right);
				case "**": return toNumber(left) ** toNumber(right);
				case "<": return (left as number) < (right as number);
				case ">": return (left as number) > (right as number);
				case "<=": return (left as number) <= (right as number);
				case ">=": return (left as number) >= (right as number);
				case "==": return left == right;
				case "!=": return left != right;
				case "===": return left === right;
				case "!==": return left !== right;
				default: throw new Error(`Unknown operator: ${node.op}`);
			}
		}

		case "Cond": {
			const test = evalNode(node.test, scope);
			return test ? evalNode(node.cons, scope) : evalNode(node.alt, scope);
		}

		case "Call": {
			// Preserve 'this' binding for method calls (obj.method())
			let callee: unknown;
			let thisObj: unknown = undefined;
			const isMember = node.callee.type === "Member";
			if (isMember) {
				const m = node.callee as { type: "Member"; obj: ASTNode; prop: ASTNode; computed: boolean; optional: boolean };
				thisObj = evalNode(m.obj, scope);
				if (thisObj == null) {
					if (m.optional || node.optional) return undefined;
					throw new TypeError("Cannot read properties of null (reading '" + memberKey(node.callee, scope) + "')");
				}
				const key = m.computed ? evalNode(m.prop, scope) : (m.prop as { type: "Literal"; value: string }).value;
				callee = (thisObj as Record<string, unknown>)[key as string];
				if (callee == null) {
					if (node.optional) return undefined;
				}
			} else {
				callee = evalNode(node.callee, scope);
				if (callee == null && node.optional) return undefined;
			}
			if (typeof callee !== "function") {
				const name = node.callee.type === "Ident" ? node.callee.name : "";
				throw new TypeError(`${name || "value"} is not a function`);
			}
			const args: unknown[] = [];
			for (const a of node.args) {
				if (a.type === "Spread") {
					args.push(...evalSpread(a.arg, scope));
				} else {
					args.push(evalNode(a, scope));
				}
			}
			return (callee as { apply(thisArg: unknown, args: unknown[]): unknown }).apply(thisObj, args);
		}

		case "Member": {
			const obj = evalNode(node.obj, scope);
			if (obj == null) {
				if (node.optional) return undefined;
				throw new TypeError("Cannot read properties of null (reading '" + memberKey(node, scope) + "')");
			}
			const key = node.computed ? evalNode(node.prop, scope) : (node.prop as { type: "Literal"; value: string }).value;
			return (obj as Record<string, unknown>)[key as string];
		}

		case "Array":
			return node.elements.map((e) => (e.type === "Spread" ? evalSpread(e.arg, scope) : evalNode(e, scope))).flat();

		case "Object": {
			const result: Record<string, unknown> = {};
			for (const prop of node.props) {
				const key = prop.computed ? String(evalNode(prop.key as ASTNode, scope)) : (prop.key as string);
				result[key] = evalNode(prop.value, scope);
			}
			return result;
		}

		case "Arrow":
			return (...args: unknown[]) => {
				const childScope: Record<string, unknown> = Object.create(scope);
				for (let i = 0; i < node.params.length; i++) {
					childScope[node.params[i]] = args[i];
				}
				return evalNode(node.body, childScope);
			};

		case "Regex":
			return new RegExp(node.pattern, node.flags);

		case "Spread":
			return evalNode(node.arg, scope);

		case "Template": {
			let result = "";
			for (const part of node.parts) {
				if (typeof part === "string") {
					result += part;
				} else {
					const val = evalNode(part, scope);
					result += val == null ? "" : String(val);
				}
			}
			return result;
		}

		case "Return":
			throw new ReturnSignal(evalNode(node.value, scope));

		case "If": {
			const test = evalNode(node.test, scope);
			if (test) {
				return evalStatement(node.cons, scope);
			}
			return node.alt ? evalStatement(node.alt, scope) : undefined;
		}

		default:
			throw new Error(`Unknown AST node type: ${(node as ASTNode).type}`);
	}
}

function evalStatement(node: ASTNode, scope: Record<string, unknown>): unknown {
	if (node.type === "Return" || node.type === "If") {
		return evalNode(node, scope);
	}
	return evalNode(node, scope);
}

function evalSpread(node: ASTNode, scope: Record<string, unknown>): unknown[] {
	const val = evalNode(node, scope);
	if (Array.isArray(val)) return val;
	throw new TypeError(`${typeof val} is not iterable`);
}

function memberKey(node: ASTNode, scope: Record<string, unknown>): string {
	const member = node as { type: "Member"; obj: ASTNode; prop: ASTNode; computed: boolean };
	if (!member.computed) return (member.prop as { type: "Literal"; value: string }).value;
	return String(evalNode(member.prop, scope));
}

function toNumber(val: unknown): number {
	return Number(val);
}

function addValues(left: unknown, right: unknown): unknown {
	if (typeof left === "string" || typeof right === "string") {
		return String(left ?? "") + String(right ?? "");
	}
	return toNumber(left) + toNumber(right);
}

// ─── Public API ────────────────────────────────────────────────

export interface SafeEvalOptions {
	/**
	 * If true, wrap evaluation in ReturnSignal catcher so
	 * `if (cond) return val; else return val2` works.
	 */
	allowStatements?: boolean;
}

/**
 * Safely evaluate a JavaScript-like expression string against a
 * variable scope, without using `eval()` or `new Function()`.
 */
export function safeEval(
	expression: string,
	scope: Record<string, unknown>,
	options?: SafeEvalOptions,
): unknown {
	const tokens = tokenize(expression);
	const ast = new Parser(tokens).parse();

	if (options?.allowStatements) {
		try {
			return evalNode(ast, scope);
		} catch (e) {
			if (e instanceof ReturnSignal) return e.value;
			throw e;
		}
	}

	return evalNode(ast, scope);
}
