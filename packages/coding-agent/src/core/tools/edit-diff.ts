/**
 * Shared diff computation utilities for the edit tool.
 * Used by both edit.ts (for execution) and tool-execution.ts (for preview rendering).
 *
 * Features:
 * - Exact and fuzzy text matching with Unicode normalization
 * - Uniform indentation detection and auto-fix
 * - "Did you mean" suggestions on match failure
 */

import * as Diff from "diff";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import {
	applyIndentationFix,
	detectIndentationMismatch,
	findSimilarLines,
	formatDidYouMean,
	type SimilarLinesResult,
} from "./edit-utils.js";
import { resolveToCwd } from "./path-utils.js";

export function detectLineEnding(content: string): "\r\n" | "\n" {
	const crlfIdx = content.indexOf("\r\n");
	const lfIdx = content.indexOf("\n");
	if (lfIdx === -1) return "\n";
	if (crlfIdx === -1) return "\n";
	return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/**
 * Normalize text for fuzzy matching. Applies progressive transformations:
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes to ASCII equivalents
 * - Normalize Unicode dashes/hyphens to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
export function normalizeForFuzzyMatch(text: string): string {
	return (
		text
			.normalize("NFKC")
			// Strip trailing whitespace per line
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n")
			// Smart single quotes → '
			.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
			// Smart double quotes → "
			.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
			// Various dashes/hyphens → -
			// U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
			// U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
			.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
			// Special spaces → regular space
			// U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
			// U+205F medium math space, U+3000 ideographic space
			.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
	);
}

export interface FuzzyMatchResult {
	/** Whether a match was found */
	found: boolean;
	/** The index where the match starts */
	index: number;
	/** Length of the matched text */
	matchLength: number;
	/** Whether fuzzy matching was used */
	usedFuzzyMatch: boolean;
	/** The content to use for replacement operations */
	contentForReplacement: string;
	/** Indentation fix that was applied, if any */
	indentationFix?: {
		offset: number;
		fixedOldText: string;
		fixedNewText: string;
	};
}

export interface Edit {
	oldText: string;
	newText: string;
}

interface MatchedEdit {
	editIndex: number;
	matchIndex: number;
	matchLength: number;
	newText: string;
	indentationFix?: {
		offset: number;
		fixedOldText: string;
		fixedNewText: string;
	};
}

export interface AppliedEditsResult {
	baseContent: string;
	newContent: string;
}

export class EditApplyError extends Error {
	constructor(
		message: string,
		public readonly path: string,
		public readonly editIndex: number,
		public readonly suggestions?: SimilarLinesResult,
	) {
		super(message);
		this.name = "EditApplyError";
	}
}

// Re-export types from edit-utils for extension access
export type { SimilarLinesResult } from "./edit-utils.js";

/**
 * Find oldText in content with multiple fallback strategies:
 * 1. Exact match
 * 2. Fuzzy match (Unicode normalization)
 * 3. Indentation-corrected match
 */
export function fuzzyFindText(content: string, oldText: string, newText: string): FuzzyMatchResult {
	// Strategy 1: Exact match
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) {
		return {
			found: true,
			index: exactIndex,
			matchLength: oldText.length,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	// Strategy 2: Fuzzy match with Unicode normalization
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

	if (fuzzyIndex !== -1) {
		return {
			found: true,
			index: fuzzyIndex,
			matchLength: fuzzyOldText.length,
			usedFuzzyMatch: true,
			contentForReplacement: fuzzyContent,
		};
	}

	// Strategy 3: Try indentation mismatch fix (content vs oldText)
	const indentFix = detectIndentationMismatch(content, oldText);
	if (indentFix?.valid) {
		const fixedOldText = applyIndentationFix(oldText, indentFix.offset);
		const fixedIndex = content.indexOf(fixedOldText);
		if (fixedIndex !== -1) {
			const fixedNewText = applyIndentationFix(newText, indentFix.offset);
			return {
				found: true,
				index: fixedIndex,
				matchLength: fixedOldText.length,
				usedFuzzyMatch: false,
				contentForReplacement: content,
				indentationFix: { offset: indentFix.offset, fixedOldText, fixedNewText },
			};
		}

		// Also try fuzzy on fixed text
		const fuzzyFixedOldText = normalizeForFuzzyMatch(fixedOldText);
		const fuzzyFixedIndex = fuzzyContent.indexOf(fuzzyFixedOldText);
		if (fuzzyFixedIndex !== -1) {
			const fuzzyFixedContent = normalizeForFuzzyMatch(content);
			const fixedNewText = applyIndentationFix(newText, indentFix.offset);
			return {
				found: true,
				index: fuzzyFixedIndex,
				matchLength: fuzzyFixedOldText.length,
				usedFuzzyMatch: true,
				contentForReplacement: fuzzyFixedContent,
				indentationFix: { offset: indentFix.offset, fixedOldText, fixedNewText },
			};
		}
	}

	return {
		found: false,
		index: -1,
		matchLength: 0,
		usedFuzzyMatch: false,
		contentForReplacement: content,
	};
}

/** Strip UTF-8 BOM if present */
export function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

function countOccurrences(content: string, oldText: string): number {
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	return fuzzyContent.split(fuzzyOldText).length - 1;
}

function formatNotFoundError(
	path: string,
	editIndex: number,
	totalEdits: number,
	suggestion: SimilarLinesResult | undefined,
): Error {
	const prefix = totalEdits === 1 ? "" : `edits[${editIndex}] `;

	if (suggestion) {
		const suggestionText = formatDidYouMean("", suggestion);
		return new EditApplyError(`Could not find ${prefix}in ${path}.\n${suggestionText}`, path, editIndex, suggestion);
	}

	const baseMessage =
		totalEdits === 1
			? `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`
			: `Could not find ${prefix}in ${path}. The oldText must match exactly including all whitespace and newlines.`;

	return new EditApplyError(baseMessage, path, editIndex, undefined);
}

function formatDuplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
	const prefix = totalEdits === 1 ? "" : `edits[${editIndex}] `;
	const message =
		totalEdits === 1
			? `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`
			: `Found ${occurrences} occurrences of ${prefix}in ${path}. Each oldText must be unique. Please provide more context to make it unique.`;

	return new EditApplyError(message, path, editIndex);
}

function formatEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
	const prefix = totalEdits === 1 ? "oldText" : `edits[${editIndex}].oldText`;
	return new EditApplyError(`${prefix} must not be empty in ${path}.`, path, editIndex);
}

function formatNoChangeError(path: string, totalEdits: number): Error {
	const message =
		totalEdits === 1
			? `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`
			: `No changes made to ${path}. The replacements produced identical content.`;

	return new EditApplyError(message, path, -1);
}

/**
 * Apply one or more exact-text replacements to LF-normalized content.
 *
 * Strategies tried:
 * 1. Exact match
 * 2. Fuzzy match (Unicode normalization)
 * 3. Uniform indentation-corrected match
 */
export function applyEditsToNormalizedContent(
	normalizedContent: string,
	edits: Edit[],
	path: string,
): AppliedEditsResult {
	const normalizedEdits = edits.map((edit) => ({
		oldText: normalizeToLF(edit.oldText),
		newText: normalizeToLF(edit.newText),
	}));

	// Validate no empty oldText
	for (let i = 0; i < normalizedEdits.length; i++) {
		if (normalizedEdits[i].oldText.length === 0) {
			throw formatEmptyOldTextError(path, i, normalizedEdits.length);
		}
	}

	// First pass: find matches with fallback strategies
	const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText, edit.newText));

	// Determine if we need fuzzy content space
	const useFuzzyContent = initialMatches.some((match) => match.usedFuzzyMatch);
	const baseContent = useFuzzyContent ? normalizeForFuzzyMatch(normalizedContent) : normalizedContent;

	// Second pass: validate all matches and collect results
	const matchedEdits: MatchedEdit[] = [];
	for (let i = 0; i < normalizedEdits.length; i++) {
		const edit = normalizedEdits[i];
		const matchResult = fuzzyFindText(baseContent, edit.oldText, edit.newText);

		if (!matchResult.found) {
			// Try to find a suggestion
			const suggestion = findSimilarLines(
				normalizedContent,
				edit.oldText,
				0.6, // 60% similarity threshold for suggestions
			);
			throw formatNotFoundError(path, i, normalizedEdits.length, suggestion ?? undefined);
		}

		const occurrences = countOccurrences(baseContent, edit.oldText);
		if (occurrences > 1) {
			throw formatDuplicateError(path, i, normalizedEdits.length, occurrences);
		}

		matchedEdits.push({
			editIndex: i,
			matchIndex: matchResult.index,
			matchLength: matchResult.matchLength,
			newText: matchResult.indentationFix?.fixedNewText ?? edit.newText,
			indentationFix: matchResult.indentationFix,
		});
	}

	// Check for overlapping edits
	matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
	for (let i = 1; i < matchedEdits.length; i++) {
		const previous = matchedEdits[i - 1];
		const current = matchedEdits[i];
		if (previous.matchIndex + previous.matchLength > current.matchIndex) {
			throw new EditApplyError(
				`edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
				path,
				previous.editIndex,
			);
		}
	}

	// Apply edits in reverse order to preserve indices
	let newContent = baseContent;
	for (let i = matchedEdits.length - 1; i >= 0; i--) {
		const edit = matchedEdits[i];
		newContent =
			newContent.substring(0, edit.matchIndex) +
			edit.newText +
			newContent.substring(edit.matchIndex + edit.matchLength);
	}

	if (baseContent === newContent) {
		throw formatNoChangeError(path, normalizedEdits.length);
	}

	return { baseContent, newContent };
}

/**
 * Generate a unified diff string with line numbers and context.
 */
export function generateDiffString(
	oldContent: string,
	newContent: string,
	contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];

	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;

	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") {
			raw.pop();
		}

		if (part.added || part.removed) {
			if (firstChangedLine === undefined) {
				firstChangedLine = newLineNum;
			}

			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
					output.push(`+${lineNum} ${line}`);
					newLineNum++;
				} else {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
			const hasLeadingChange = lastWasChange;
			const hasTrailingChange = nextPartIsChange;

			if (hasLeadingChange && hasTrailingChange) {
				if (raw.length <= contextLines * 2) {
					for (const line of raw) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				} else {
					const leadingLines = raw.slice(0, contextLines);
					const trailingLines = raw.slice(raw.length - contextLines);
					const skippedLines = raw.length - leadingLines.length - trailingLines.length;

					for (const line of leadingLines) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}

					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;

					for (const line of trailingLines) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				}
			} else if (hasLeadingChange) {
				const shownLines = raw.slice(0, contextLines);
				const skippedLines = raw.length - shownLines.length;

				for (const line of shownLines) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}

				if (skippedLines > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;
				}
			} else if (hasTrailingChange) {
				const skippedLines = Math.max(0, raw.length - contextLines);
				if (skippedLines > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;
				}

				for (const line of raw.slice(skippedLines)) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			} else {
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}

			lastWasChange = false;
		}
	}

	return { diff: output.join("\n"), firstChangedLine };
}

export interface EditDiffResult {
	diff: string;
	firstChangedLine: number | undefined;
}

export interface EditDiffError {
	error: string;
}

/**
 * Compute the diff for one or more edit operations without applying them.
 */
export async function computeEditsDiff(
	path: string,
	edits: Edit[],
	cwd: string,
): Promise<EditDiffResult | EditDiffError> {
	const absolutePath = resolveToCwd(path, cwd);

	try {
		try {
			await access(absolutePath, constants.R_OK);
		} catch {
			return { error: `File not found: ${path}` };
		}

		const rawContent = await readFile(absolutePath, "utf-8");
		const { text: content } = stripBom(rawContent);
		const normalizedContent = normalizeToLF(content);
		const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);

		return generateDiffString(baseContent, newContent);
	} catch (err) {
		if (err instanceof EditApplyError) {
			return { error: err.message };
		}
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Compute the diff for a single edit operation without applying it.
 */
export async function computeEditDiff(
	path: string,
	oldText: string,
	newText: string,
	cwd: string,
): Promise<EditDiffResult | EditDiffError> {
	return computeEditsDiff(path, [{ oldText, newText }], cwd);
}
