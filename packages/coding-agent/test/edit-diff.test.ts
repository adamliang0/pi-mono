import { describe, expect, it } from "vitest";
import {
	applyEditsToNormalizedContent,
	type Edit,
	EditApplyError,
	fuzzyFindText,
} from "../src/core/tools/edit-diff.js";

describe("fuzzyFindText", () => {
	it("finds exact match", () => {
		const content = "hello world";
		const result = fuzzyFindText(content, "hello", "hi");
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(false);
	});

	it("returns fuzzy match with Unicode normalization", () => {
		const content = "function foo() {\n  return 42;\n}";
		const oldText = "function foo() {\n\u2003\u2003return 42;\n}"; // em-dash spaces
		const result = fuzzyFindText(content, oldText, "hi");
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
	});

	it("handles indentation fix", () => {
		// Content has 2-space indentation, oldText has 0-space
		// Should detect offset=2 and apply it to oldText
		const content = "  hello\n  world";
		const oldText = "hello\nworld";
		const newText = "goodbye\nworld";
		const result = fuzzyFindText(content, oldText, newText);
		expect(result.found).toBe(true);
		expect(result.indentationFix).toBeDefined();
		expect(result.indentationFix!.offset).toBe(2); // need to add 2 spaces
	});

	it("returns not found when no match exists", () => {
		const content = "some content";
		const result = fuzzyFindText(content, "xyz123", "abc");
		expect(result.found).toBe(false);
	});
});

describe("applyEditsToNormalizedContent", () => {
	it("applies single edit successfully", () => {
		const content = "hello world";
		const edits: Edit[] = [{ oldText: "hello", newText: "hi" }];
		const result = applyEditsToNormalizedContent(content, edits, "test.txt");
		expect(result.newContent).toBe("hi world");
	});

	it("applies multiple disjoint edits", () => {
		const content = "line1\nline2\nline3\nline4";
		const edits: Edit[] = [
			{ oldText: "line1", newText: "FIRST" },
			{ oldText: "line3", newText: "THIRD" },
		];
		const result = applyEditsToNormalizedContent(content, edits, "test.txt");
		expect(result.newContent).toBe("FIRST\nline2\nTHIRD\nline4");
	});

	it("throws EditApplyError with suggestion when not found", () => {
		const content = "function foo() {\n  return 42;\n}";
		const edits: Edit[] = [{ oldText: "function bar()", newText: "function baz()" }];
		expect(() => applyEditsToNormalizedContent(content, edits, "test.ts")).toThrow(EditApplyError);
	});

	it("throws EditApplyError for duplicate occurrences", () => {
		const content = "foo\nfoo\nfoo";
		const edits: Edit[] = [{ oldText: "foo", newText: "bar" }];
		expect(() => applyEditsToNormalizedContent(content, edits, "test.txt")).toThrow(EditApplyError);
	});

	it("throws EditApplyError for empty oldText", () => {
		const content = "some content";
		const edits: Edit[] = [{ oldText: "", newText: "something" }];
		expect(() => applyEditsToNormalizedContent(content, edits, "test.txt")).toThrow(EditApplyError);
	});

	it("throws EditApplyError for overlapping edits", () => {
		const content = "line1\nline2\nline3";
		const edits: Edit[] = [
			{ oldText: "line1\nline2", newText: "FIRST" },
			{ oldText: "line2\nline3", newText: "SECOND" },
		];
		expect(() => applyEditsToNormalizedContent(content, edits, "test.txt")).toThrow(EditApplyError);
	});

	it("throws EditApplyError when replacement produces no change", () => {
		const content = "hello";
		const edits: Edit[] = [{ oldText: "hello", newText: "hello" }];
		expect(() => applyEditsToNormalizedContent(content, edits, "test.txt")).toThrow(EditApplyError);
	});

	it("handles indentation auto-fix", () => {
		// Content has proper 2-space indentation, but oldText/newText have 0-space
		const content = "  function test() {\n    return 1;\n  }";
		const edits: Edit[] = [
			{ oldText: "function test() {\n  return 1;\n}", newText: "function test() {\n  return 2;\n}" },
		];
		const result = applyEditsToNormalizedContent(content, edits, "test.ts");
		// The indentation should be auto-fixed
		expect(result.newContent).toContain("return 2");
	});
});

describe("EditApplyError", () => {
	it("contains path and editIndex", () => {
		const error = new EditApplyError("test error", "file.txt", 0);
		expect(error.path).toBe("file.txt");
		expect(error.editIndex).toBe(0);
	});

	it("contains suggestion when available", () => {
		const suggestion = {
			matchedLines: ["target"],
			startLine: 5,
			endLine: 6,
			similarity: 0.8,
		};
		const error = new EditApplyError("test", "file.txt", 0, suggestion);
		expect(error.suggestions).toBeDefined();
		expect(error.suggestions!.similarity).toBe(0.8);
	});
});
