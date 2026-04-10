/**
 * Edit tool utilities for fuzzy matching and error recovery.
 * Helps minimize agent errors by providing better feedback and handling
 * common LLM mistakes like indentation issues.
 */

import { SequenceMatcher } from "./sequence-matcher.js";

export interface SimilarLinesResult {
	/** The closest matching region */
	matchedLines: string[];
	/** 0-based line number where match starts */
	startLine: number;
	/** 0-based line number where match ends (exclusive) */
	endLine: number;
	/** Similarity ratio 0.0 - 1.0 */
	similarity: number;
}

/**
 * Find the closest matching region in content to the search text.
 * Returns the region with highest similarity score above the threshold.
 */
export function findSimilarLines(
	content: string,
	searchText: string,
	threshold = 0.7,
	contextLines = 3,
): SimilarLinesResult | null {
	const contentLines = content.split("\n");
	const searchLines = searchText.split("\n");

	if (searchLines.length === 0) {
		return null;
	}

	let bestSimilarity = 0;
	let bestStart = -1;

	// Slide search window across content
	for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
		const chunk = contentLines.slice(i, i + searchLines.length);
		const similarity = new SequenceMatcher(searchLines, chunk).ratio();

		if (similarity > bestSimilarity) {
			bestSimilarity = similarity;
			bestStart = i;
		}
	}

	if (bestStart === -1 || bestSimilarity < threshold) {
		return null;
	}

	// Expand with context lines
	const expandedStart = Math.max(0, bestStart - contextLines);
	const expandedEnd = Math.min(contentLines.length, bestStart + searchLines.length + contextLines);

	return {
		matchedLines: contentLines.slice(expandedStart, expandedEnd),
		startLine: bestStart,
		endLine: bestStart + searchLines.length,
		similarity: bestSimilarity,
	};
}

export interface IndentationOffset {
	/** Lines to add (positive) or remove (negative) */
	offset: number;
	/** Whether this is a valid uniform offset */
	valid: boolean;
}

/**
 * Get minimum indentation level (leading spaces) from non-empty lines.
 */
function getMinIndentation(text: string): number {
	const lines = text.split("\n");
	const indentations = lines.filter((l) => l.trim().length > 0).map((l) => l.length - l.trimStart().length);
	if (indentations.length === 0) return 0;
	return Math.min(...indentations);
}

/**
 * Check if all non-empty lines have consistent indentation (uniform offset from minimum).
 */
function hasUniformIndentation(text: string): boolean {
	const lines = text.split("\n");
	const indentations = lines.filter((l) => l.trim().length > 0).map((l) => l.length - l.trimStart().length);
	if (indentations.length === 0) return true;
	const min = Math.min(...indentations);
	return indentations.every((i) => i - min >= 0);
}

/**
 * Detect if content has different uniform indentation than oldText.
 * Used for auto-fixing when LLM under/over-indented the edit blocks.
 *
 * Example: Content has 2 spaces, oldText has 0 spaces -> offset=-2 (remove 2)
 */
export function detectIndentationMismatch(content: string, oldText: string): IndentationOffset | null {
	const contentMin = getMinIndentation(content);
	const oldMin = getMinIndentation(oldText);

	// Both must have uniform indentation
	if (!hasUniformIndentation(content) || !hasUniformIndentation(oldText)) {
		return null;
	}

	// Calculate offset: how many spaces to add to oldText to match content's indentation
	const offset = contentMin - oldMin;

	// No adjustment needed if already matching
	if (offset === 0) {
		return null;
	}

	return { offset, valid: true };
}

/**
 * @deprecated Use detectIndentationMismatch(content, oldText) instead.
 * This version compares oldText vs newText for relative indentation, not absolute.
 */
export function detectUniformIndentation(oldText: string, newText: string): IndentationOffset | null {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");

	const oldIndentations = oldLines.filter((l) => l.trim().length > 0).map((l) => l.length - l.trimStart().length);
	const newIndentations = newLines.filter((l) => l.trim().length > 0).map((l) => l.length - l.trimStart().length);

	if (oldIndentations.length === 0 || newIndentations.length === 0) {
		return null;
	}

	const oldMin = Math.min(...oldIndentations);
	const newMin = Math.min(...newIndentations);

	if (!hasUniformIndentation(oldText) || !hasUniformIndentation(newText)) {
		return null;
	}

	const offset = newMin - oldMin;
	if (offset === 0) {
		return null;
	}

	return { offset, valid: true };
}

/**
 * Apply indentation fix to all non-empty lines in text.
 * Positive offset = add spaces, negative = remove spaces.
 */
export function applyIndentationFix(text: string, offset: number): string {
	if (offset === 0) {
		return text;
	}

	const lines = text.split("\n");
	const fixedLines = lines.map((line) => {
		if (line.trim().length === 0) {
			return line;
		}
		if (offset > 0) {
			return " ".repeat(offset) + line;
		} else {
			// Remove |offset| spaces from beginning
			const spacesToRemove = Math.min(Math.abs(offset), line.length - line.trimStart().length);
			return line.slice(spacesToRemove);
		}
	});

	return fixedLines.join("\n");
}

/**
 * Format a "did you mean" suggestion for error messages.
 */
export function formatDidYouMean(_searchText: string, suggestion: SimilarLinesResult, fence = ["```", "```"]): string {
	const lineNums =
		suggestion.startLine + 1 === suggestion.endLine
			? `line ${suggestion.startLine + 1}`
			: `lines ${suggestion.startLine + 1}-${suggestion.endLine}`;

	const lines = [
		`Similar ${lineNums} (${Math.round(suggestion.similarity * 100)}% match):`,
		"",
		fence[0],
		...suggestion.matchedLines,
		fence[1],
		"",
	].join("\n");

	return lines;
}
