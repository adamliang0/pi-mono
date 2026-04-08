/**
 * Shared utilities for compaction and branch summarization.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";

// ============================================================================
// File Operation Tracking
// ============================================================================

export interface FileOperations {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

export function createFileOps(): FileOperations {
	return {
		read: new Set(),
		written: new Set(),
		edited: new Set(),
	};
}

/**
 * Extract likely file paths from a bash command using simple command-specific heuristics.
 * This is intentionally conservative and only covers common file-oriented commands.
 */
function extractFileOpsFromBashCommand(command: string, fileOps: FileOperations): void {
	const readOnlyCommands = new Set(["cat", "head", "tail", "less", "more", "wc", "stat", "ls"]);
	const modifyCommands = new Set(["rm", "touch", "mkdir", "rmdir", "chmod", "chown"]);
	const copyCommands = new Set(["cp", "mv"]);
	const commandPattern =
		/(^|[;&|]{1,2})\s*(cat|head|tail|less|more|wc|stat|ls|cp|mv|rm|touch|mkdir|rmdir|chmod|chown)\s+([^;&|]+)/g;

	for (const match of command.matchAll(commandPattern)) {
		const cmd = match[2];
		const argsText = match[3]?.trim();
		if (!argsText) continue;

		const tokens = Array.from(argsText.matchAll(/"([^"]+)"|'([^']+)'|([^\s]+)/g))
			.map((tokenMatch) => tokenMatch[1] ?? tokenMatch[2] ?? tokenMatch[3] ?? "")
			.map((token) => token.trim())
			.filter((token) => token.length > 0 && !token.startsWith("-"));
		if (tokens.length === 0) continue;

		if (readOnlyCommands.has(cmd)) {
			for (const token of tokens) {
				fileOps.read.add(token);
			}
			continue;
		}

		if (modifyCommands.has(cmd)) {
			for (const token of tokens) {
				fileOps.edited.add(token);
			}
			continue;
		}

		if (copyCommands.has(cmd)) {
			if (tokens.length >= 1) fileOps.read.add(tokens[0]);
			if (tokens.length >= 2) fileOps.edited.add(tokens[tokens.length - 1]);
		}
	}
}

/**
 * Extract file operations from tool calls in an assistant message.
 */
export function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
	if (message.role !== "assistant") return;
	if (!("content" in message) || !Array.isArray(message.content)) return;

	for (const block of message.content) {
		if (typeof block !== "object" || block === null) continue;
		if (!("type" in block) || block.type !== "toolCall") continue;
		if (!("arguments" in block) || !("name" in block)) continue;

		const args = block.arguments as Record<string, unknown> | undefined;
		if (!args) continue;

		const path = typeof args.path === "string" ? args.path : undefined;

		switch (block.name) {
			case "read":
				if (path) fileOps.read.add(path);
				break;
			case "write":
				if (path) fileOps.written.add(path);
				break;
			case "edit":
				if (path) fileOps.edited.add(path);
				break;
			case "bash": {
				const command = typeof args.command === "string" ? args.command : undefined;
				if (command) extractFileOpsFromBashCommand(command, fileOps);
				break;
			}
		}
	}
}

/**
 * Compute final file lists from file operations.
 * Returns readFiles (files only read, not modified) and modifiedFiles.
 */
export function computeFileLists(fileOps: FileOperations): { readFiles: string[]; modifiedFiles: string[] } {
	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const readOnly = [...fileOps.read].filter((f) => !modified.has(f)).sort();
	const modifiedFiles = [...modified].sort();
	return { readFiles: readOnly, modifiedFiles };
}

/**
 * Format file operations as XML tags for summary.
 */
export function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
	const sections: string[] = [];
	if (readFiles.length > 0) {
		sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	}
	if (modifiedFiles.length > 0) {
		sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	}
	if (sections.length === 0) return "";
	return `\n\n${sections.join("\n\n")}`;
}

// ============================================================================
// Message Serialization
// ============================================================================

/** Maximum characters for a single serialized tool result in summaries. */
const TOOL_RESULT_MAX_CHARS = 2000;
/** Minimum characters for a single serialized tool result in summaries. */
const TOOL_RESULT_MIN_CHARS = 500;
/** Total character budget allocated across serialized tool results. */
const TOOL_RESULT_TOTAL_BUDGET_CHARS = 12000;
/** Maximum characters for a single serialized tool argument value. */
const TOOL_ARGUMENT_MAX_CHARS = 200;

/**
 * Truncate text to a maximum character length for summarization.
 * Keeps the beginning and appends a truncation marker.
 */
function truncateForSummary(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const truncatedChars = text.length - maxChars;
	return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

/**
 * Serialize LLM messages to text for summarization.
 * This prevents the model from treating it as a conversation to continue.
 * Call convertToLlm() first to handle custom message types.
 *
 * Tool results are truncated to keep the summarization request within
 * reasonable token budgets. Full content is not needed for summarization.
 */
function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function serializeToolArgumentValue(value: unknown): string {
	const serialized = JSON.stringify(value) ?? String(value);
	return truncateForSummary(serialized, TOOL_ARGUMENT_MAX_CHARS);
}

export function serializeConversation(messages: Message[]): string {
	const parts: string[] = [];
	const toolResultCount = messages.filter((message) => message.role === "toolResult").length;
	const toolResultMaxChars = clamp(
		Math.floor(TOOL_RESULT_TOTAL_BUDGET_CHARS / Math.max(toolResultCount, 1)),
		TOOL_RESULT_MIN_CHARS,
		TOOL_RESULT_MAX_CHARS,
	);
	let previousToolResultContent: string | undefined;

	for (const msg of messages) {
		if (msg.role !== "toolResult") {
			previousToolResultContent = undefined;
		}

		if (msg.role === "user") {
			const content =
				typeof msg.content === "string"
					? msg.content
					: msg.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("");
			if (content) parts.push(`[User]: ${content}`);
		} else if (msg.role === "assistant") {
			const textParts: string[] = [];
			const toolCalls: string[] = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					textParts.push(block.text);
				} else if (block.type === "toolCall") {
					const args = block.arguments as Record<string, unknown>;
					const argsStr = Object.entries(args)
						.map(([k, v]) => `${k}=${serializeToolArgumentValue(v)}`)
						.join(", ");
					toolCalls.push(`${block.name}(${argsStr})`);
				}
			}

			if (textParts.length > 0) {
				parts.push(`[Assistant]: ${textParts.join("\n")}`);
			}
			if (toolCalls.length > 0) {
				parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
			}
		} else if (msg.role === "toolResult") {
			const content = msg.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("");
			if (content) {
				const serializedContent = truncateForSummary(content, toolResultMaxChars);
				if (serializedContent !== previousToolResultContent) {
					parts.push(`[Tool result]: ${serializedContent}`);
					previousToolResultContent = serializedContent;
				}
			}
		}
	}

	return parts.join("\n\n");
}

// ============================================================================
// Summarization System Prompt
// ============================================================================

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;
