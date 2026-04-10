import { describe, expect, it } from "vitest";
import {
	applyIndentationFix,
	detectUniformIndentation,
	findSimilarLines,
	formatDidYouMean,
} from "../src/core/tools/edit-utils.js";
import { compareArrays, compareLines, SequenceMatcher } from "../src/core/tools/sequence-matcher.js";

describe("SequenceMatcher", () => {
	it("returns 1.0 for identical arrays", () => {
		const a = ["hello", "world"];
		const b = ["hello", "world"];
		const sm = new SequenceMatcher(a, b);
		expect(sm.ratio()).toBe(1.0);
	});

	it("returns 0.0 for completely different arrays", () => {
		const a = ["a", "b", "c"];
		const b = ["x", "y", "z"];
		const sm = new SequenceMatcher(a, b);
		expect(sm.ratio()).toBe(0.0);
	});

	it("returns correct ratio for partial matches", () => {
		const a = ["hello", "world", "foo", "bar"];
		const b = ["hello", "world", "baz", "qux"];
		const sm = new SequenceMatcher(a, b);
		const ratio = sm.ratio();
		expect(ratio).toBeGreaterThan(0.3);
		expect(ratio).toBeLessThan(1.0);
	});

	it("handles empty arrays", () => {
		const sm = new SequenceMatcher([], []);
		expect(sm.ratio()).toBe(1.0);
	});

	it("handles single element match", () => {
		const sm = new SequenceMatcher(["a"], ["a"]);
		expect(sm.ratio()).toBe(1.0);
	});
});

describe("compareArrays", () => {
	it("returns 1.0 for identical arrays", () => {
		const a = [1, 2, 3];
		const b = [1, 2, 3];
		expect(compareArrays(a, b)).toBe(1.0);
	});

	it("returns lower ratio for different arrays", () => {
		const a = [1, 2, 3];
		const b = [4, 5, 6];
		const ratio = compareArrays(a, b);
		expect(ratio).toBeLessThan(1.0);
	});
});

describe("compareLines", () => {
	it("returns 1.0 for identical lines", () => {
		const a = ["line1", "line2", "line3"];
		const b = ["line1", "line2", "line3"];
		expect(compareLines(a, b)).toBe(1.0);
	});

	it("returns partial ratio for similar code blocks", () => {
		const a = ["function foo() {", "  return 42;", "}"];
		const b = ["function foo()", "  return 42;", "}"]; // missing brace
		const ratio = compareLines(a, b);
		expect(ratio).toBeGreaterThan(0.5);
		expect(ratio).toBeLessThan(1.0);
	});
});

describe("findSimilarLines", () => {
	it("finds exact match", () => {
		const content = "line1\nline2\nline3";
		const search = "line2";
		const result = findSimilarLines(content, search, 0.5);
		expect(result).not.toBeNull();
		expect(result!.similarity).toBe(1.0);
		expect(result!.startLine).toBe(1);
	});

	it("returns null when similarity below threshold", () => {
		const content = "completely different content here";
		const search = "xyz123 does not exist";
		const result = findSimilarLines(content, search, 0.9);
		expect(result).toBeNull();
	});

	it("returns similar region when close match exists", () => {
		const content = "function foo() {\n  return 42;\n}\nfunction bar() {\n  return 100;\n}";
		const search = "function foo() {\n  return 99;\n}";
		const result = findSimilarLines(content, search, 0.5);
		expect(result).not.toBeNull();
		expect(result!.similarity).toBeGreaterThan(0.5);
		expect(result!.startLine).toBe(0);
	});

	it("includes context lines around match", () => {
		const content = "line1\nline2\nline3\nline4\nline5";
		const search = "line3";
		const result = findSimilarLines(content, search, 0.5, 1);
		expect(result).not.toBeNull();
		expect(result!.matchedLines.length).toBeGreaterThan(1);
	});
});

describe("formatDidYouMean", () => {
	it("formats single line suggestion", () => {
		const suggestion = {
			matchedLines: ["  target line"],
			startLine: 5,
			endLine: 6,
			similarity: 0.85,
		};
		const result = formatDidYouMean("search", suggestion);
		expect(result).toContain("line 6");
		expect(result).toContain("85%");
		expect(result).toContain("```");
	});

	it("formats multi-line suggestion", () => {
		const suggestion = {
			matchedLines: ["line1", "line2", "line3"],
			startLine: 0,
			endLine: 3,
			similarity: 0.9,
		};
		const result = formatDidYouMean("search", suggestion);
		expect(result).toContain("lines 1-3");
		expect(result).toContain("90%");
	});
});

describe("detectUniformIndentation", () => {
	it("returns null for matching indentation", () => {
		const oldText = "  line1\n  line2";
		const newText = "  line1\n  line2";
		const result = detectUniformIndentation(oldText, newText);
		expect(result).toBeNull();
	});

	it("detects uniform over-indentation", () => {
		const oldText = "line1\nline2";
		const newText = "    line1\n    line2"; // 4 spaces extra
		const result = detectUniformIndentation(oldText, newText);
		expect(result).not.toBeNull();
		expect(result!.offset).toBe(4);
		expect(result!.valid).toBe(true);
	});

	it("returns null for non-uniform indentation", () => {
		const oldText = "line1\n    line2";
		const newText = "line1\nline2";
		const result = detectUniformIndentation(oldText, newText);
		expect(result).toBeNull(); // non-uniform in old
	});
});

describe("applyIndentationFix", () => {
	it("adds spaces for positive offset", () => {
		const text = "line1\nline2";
		const result = applyIndentationFix(text, 4);
		expect(result.split("\n")[0]).toBe("    line1");
	});

	it("removes spaces for negative offset", () => {
		const text = "    line1\n    line2";
		const result = applyIndentationFix(text, -4);
		expect(result.split("\n")[0]).toBe("line1");
	});

	it("keeps empty lines unchanged", () => {
		const text = "line1\n\nline2";
		const result = applyIndentationFix(text, 4);
		expect(result.split("\n")[1]).toBe("");
	});
});
