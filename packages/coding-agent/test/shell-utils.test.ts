/**
 * Regression tests for shell utilities: sanitizeBinaryOutput, waitForChildProcess,
 * truncateTail, truncateHead.
 *
 * These tests protect the behavior that bash.ts, bash-executor.ts, and related
 * tools depend on after recent lifecycle/cache changes.
 */

import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail } from "../src/core/tools/truncate.js";
import { waitForChildProcess } from "../src/utils/child-process.js";
import { sanitizeBinaryOutput } from "../src/utils/shell.js";

describe("sanitizeBinaryOutput", () => {
	// Note: ANSI escape codes are stripped by stripAnsi BEFORE calling sanitizeBinaryOutput.
	// sanitizeBinaryOutput handles: control chars (0x00-0x1F except \t\n\r),
	// lone surrogates, and Unicode format chars (0xFFF9-0xFFFB).

	it("filters control characters 0x00-0x1F except tab, newline, carriage return", () => {
		// \u0000 (NUL), \u0001 (SOH), \u0002 (STX), \u001b (ESC=0x1B) all in 0x00-0x1F
		const input = "before\u0000\u0001\u0002\u001bafter";
		const output = sanitizeBinaryOutput(input);
		expect(output).toBe("beforeafter");
	});

	it("preserves tab, newline, carriage return", () => {
		const input = "line1\tline2\nline3\rline4";
		const output = sanitizeBinaryOutput(input);
		expect(output).toBe(input);
	});

	it("removes Unicode format characters U+FFFA and U+FFFB", () => {
		// U+FFFA and U+FFFB are in the filtered range (0xFFF9-0xFFFB)
		// U+FFFC is NOT filtered
		const input = "before\uFFFA\uFFFBuafter\uFFFC";
		const output = sanitizeBinaryOutput(input);
		expect(output).toBe("beforeuafter\uFFFC");
	});

	it("handles lone high surrogate", () => {
		// Lone surrogates are NOT filtered by sanitizeBinaryOutput because
		// 0xD800 is not <= 0x1F and not in 0xFFF9-0xFFFB range.
		const input = "hello\uD800world";
		const output = sanitizeBinaryOutput(input);
		// The lone surrogate is preserved (not removed).
		expect(output).toBe(input);
	});

	it("handles lone low surrogate", () => {
		const input = "hello\uDFFFworld";
		const output = sanitizeBinaryOutput(input);
		expect(output).toBe(input);
	});

	it("preserves valid multi-byte UTF-8 characters", () => {
		const input = "hello\u4e16\u754c\tworld\n";
		const output = sanitizeBinaryOutput(input);
		expect(output).toBe("hello\u4e16\u754c\tworld\n");
	});

	it("handles empty string", () => {
		expect(sanitizeBinaryOutput("")).toBe("");
	});

	it("preserves ASCII printable text", () => {
		const input = "Hello, World! 123";
		expect(sanitizeBinaryOutput(input)).toBe(input);
	});

	it("removes NUL and SOH control chars from mixed content", () => {
		const input = "START\u0000NULL\u0001END";
		const output = sanitizeBinaryOutput(input);
		expect(output).toBe("STARTNULLEND");
	});

	it("removes format char U+FFFA from output", () => {
		const input = "hello\uFFFAworld";
		const output = sanitizeBinaryOutput(input);
		expect(output).toBe("helloworld");
	});
});

describe("waitForChildProcess", () => {
	it("resolves with exit code when child exits normally", async () => {
		const child = spawn("true");
		const code = await waitForChildProcess(child);
		expect(code).toBe(0);
	});

	it("resolves with exit code when child exits with error", async () => {
		const child = spawn("false");
		const code = await waitForChildProcess(child);
		expect(code).toBe(1);
	});

	it("resolves with exit code from echo command", async () => {
		const child = spawn("echo", ["hello"]);
		const code = await waitForChildProcess(child);
		expect(code).toBe(0);
	});

	it("resolves when child exits after receiving SIGTERM", async () => {
		const child = spawn("sleep", ["60"]);
		// Register listeners BEFORE killing by starting the race first.
		const result = Promise.race([
			waitForChildProcess(child).then((code) => ({ resolved: true, code }) as const),
			new Promise<{ resolved: false }>((resolve) => setTimeout(() => resolve({ resolved: false }), 2000)),
		]);
		// Give child a moment to initialize, then kill.
		// The listeners are already registered via the race above.
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
		child.kill("SIGTERM");

		const finalResult = await result;
		expect(finalResult.resolved).toBe(true);
		expect((finalResult as { resolved: true; code: number | null }).code).toBeNull();
	});

	it("rejects when child fails to spawn", async () => {
		const child = spawn("/nonexistent-binary-xyz123");
		await expect(waitForChildProcess(child)).rejects.toThrow();
	});

	it("handles rapid spawn-exit cycles without hanging", async () => {
		const child = spawn("sh", ["-c", "exit 0"]);
		const code = await waitForChildProcess(child);
		expect(code).toBe(0);
	});
});

describe("truncateTail", () => {
	it("returns content unchanged when under limits", () => {
		const content = "line1\nline2\nline3";
		const result = truncateTail(content);
		expect(result.truncated).toBe(false);
		expect(result.content).toBe(content);
		expect(result.truncatedBy).toBeNull();
	});

	it("truncates by line count when lines exceed limit", () => {
		const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateTail(lines);

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("lines");
		expect(result.totalLines).toBe(3000);
		expect(result.outputLines).toBe(DEFAULT_MAX_LINES);
		expect(result.content.split("\n").length).toBe(DEFAULT_MAX_LINES);
	});

	it("truncates by byte count when bytes exceed limit", () => {
		const content = "x".repeat(DEFAULT_MAX_BYTES * 2);
		const result = truncateTail(content);

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.totalBytes).toBe(DEFAULT_MAX_BYTES * 2);
		expect(result.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	});

	it("returns partial last line when last line alone exceeds byte limit", () => {
		// A single line that is larger than maxBytes
		const longLine = "x".repeat(DEFAULT_MAX_BYTES * 2);
		const result = truncateTail(longLine);

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.lastLinePartial).toBe(true);
		expect(result.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	});

	it("returns accurate metadata", () => {
		const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateTail(lines);

		expect(result.totalLines).toBe(3000);
		expect(result.totalBytes).toBeGreaterThan(0);
		expect(result.maxLines).toBe(DEFAULT_MAX_LINES);
		expect(result.maxBytes).toBe(DEFAULT_MAX_BYTES);
	});

	it("respects custom options", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateTail(lines, { maxLines: 10 });

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("lines");
		expect(result.outputLines).toBe(10);
	});

	it("handles empty string", () => {
		const result = truncateTail("");
		expect(result.truncated).toBe(false);
		expect(result.content).toBe("");
	});

	it("handles single line under byte limit", () => {
		const result = truncateTail("hello world");
		expect(result.truncated).toBe(false);
		expect(result.content).toBe("hello world");
	});

	it("handles single line exceeding byte limit", () => {
		const longLine = "x".repeat(DEFAULT_MAX_BYTES * 2);
		const result = truncateTail(longLine);

		expect(result.truncated).toBe(true);
		expect(result.lastLinePartial).toBe(true);
	});
});

describe("truncateHead", () => {
	it("returns content unchanged when under limits", () => {
		const content = "line1\nline2\nline3";
		const result = truncateHead(content);
		expect(result.truncated).toBe(false);
		expect(result.content).toBe(content);
	});

	it("truncates by line count from the end when lines exceed limit", () => {
		const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateHead(lines);

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("lines");
		expect(result.totalLines).toBe(3000);
		expect(result.outputLines).toBe(DEFAULT_MAX_LINES);
	});

	it("truncates by byte count when bytes exceed limit", () => {
		const content = "x".repeat(DEFAULT_MAX_BYTES * 2);
		const result = truncateHead(content);

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	});

	it("returns empty content when first line exceeds byte limit", () => {
		const longLine = "x".repeat(DEFAULT_MAX_BYTES * 2);
		const result = truncateHead(longLine);

		expect(result.truncated).toBe(true);
		expect(result.firstLineExceedsLimit).toBe(true);
		expect(result.content).toBe("");
	});

	it("returns accurate metadata", () => {
		const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateHead(lines);

		expect(result.totalLines).toBe(3000);
		expect(result.totalBytes).toBeGreaterThan(0);
		expect(result.maxLines).toBe(DEFAULT_MAX_LINES);
		expect(result.maxBytes).toBe(DEFAULT_MAX_BYTES);
	});

	it("respects custom options", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateHead(lines, { maxLines: 10 });

		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("lines");
		expect(result.outputLines).toBe(10);
	});

	it("handles empty string", () => {
		const result = truncateHead("");
		expect(result.truncated).toBe(false);
		expect(result.content).toBe("");
	});

	it("never returns partial lines", () => {
		// truncateHead should always return complete lines
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
		const result = truncateHead(lines);

		// Content should be joinable without partial lines
		expect(result.content.split("\n").length).toBe(result.outputLines);
	});
});

describe("DEFAULT_MAX_BYTES and DEFAULT_MAX_LINES", () => {
	it("DEFAULT_MAX_BYTES is 50KB", () => {
		expect(DEFAULT_MAX_BYTES).toBe(50 * 1024);
	});

	it("DEFAULT_MAX_LINES is 2000", () => {
		expect(DEFAULT_MAX_LINES).toBe(2000);
	});
});
