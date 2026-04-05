import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getEnvApiKey } from "../env-api-keys.js";
import { calculateCost } from "../models.js";
import type {
	AssistantMessage,
	Context,
	Message,
	Model,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	UserMessage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { isPlainObject } from "../utils/is-plain-object.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { parseSseJsonObjectRecordsFromBody } from "../utils/sse-json-event-stream.js";
import { buildBaseOptions } from "./simple-options.js";
import { transformMessages } from "./transform-messages.js";

const CHAT_COMPLETION_V2_PATH = "/v1/text/chatcompletion_v2";
const MAX_COMPLETION_TOKENS_CAP = 2048;

const minimaxRequestBody = Type.Object(
	{
		model: Type.String(),
		messages: Type.Array(Type.Any()),
		stream: Type.Boolean(),
		max_completion_tokens: Type.Number(),
		temperature: Type.Optional(Type.Number()),
		top_p: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

const minimaxSseBaseResp = Type.Object(
	{
		base_resp: Type.Optional(
			Type.Object(
				{
					status_code: Type.Optional(Type.Number()),
					status_msg: Type.Optional(Type.String()),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
);

const minimaxUsageChunk = Type.Object(
	{
		prompt_tokens: Type.Optional(Type.Number()),
		completion_tokens: Type.Optional(Type.Number()),
		total_tokens: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

const minimaxStreamChoice = Type.Object(
	{
		finish_reason: Type.Optional(Type.String()),
		delta: Type.Optional(Type.Object({ content: Type.Optional(Type.String()) }, { additionalProperties: true })),
		message: Type.Optional(Type.Object({ content: Type.Optional(Type.String()) }, { additionalProperties: true })),
	},
	{ additionalProperties: true },
);

/**
 * Options for MiniMax Text Chat v2 (`chatcompletion_v2`, `M2-her`).
 *
 * MiniMax’s primary integration for supported coding models is the Anthropic-compatible
 * Messages API; use `anthropic-messages` models on `minimax` / `minimax-cn` instead of
 * this module when you need tools, thinking, or the model IDs listed in their docs.
 *
 * @see https://platform.minimax.io/docs/api-reference/text-anthropic-api
 * @see https://platform.minimax.io/docs/api-reference/text-chat
 */
export interface MiniMaxOptions extends StreamOptions {
	/** Nucleus sampling; API default for M2-her is 0.95. */
	topP?: number;
}

interface MinimaxApiMessage {
	role: string;
	name?: string;
	content: string;
}

function createOutput(model: Model<"minimax">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function userMessageToText(msg: UserMessage): string {
	if (typeof msg.content === "string") {
		return sanitizeSurrogates(msg.content);
	}
	const parts: string[] = [];
	for (const part of msg.content) {
		if (part.type === "text") {
			parts.push(part.text);
			continue;
		}
		throw new Error("MiniMax Text Chat v2 does not support image input");
	}
	return sanitizeSurrogates(parts.join(""));
}

function assertNoTools(context: Context): void {
	if (context.tools?.length) {
		throw new Error("MiniMax Text Chat v2 does not support tools");
	}
}

function hasUnsupportedHistory(messages: Message[]): boolean {
	for (const msg of messages) {
		if (msg.role === "toolResult") {
			return true;
		}
		if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (block.type === "toolCall") {
					return true;
				}
			}
		}
	}
	return false;
}

function toMinimaxMessages(context: Context, messages: Message[]): MinimaxApiMessage[] {
	if (hasUnsupportedHistory(messages)) {
		throw new Error("MiniMax Text Chat v2 does not support tool calls or tool results in history");
	}

	const out: MinimaxApiMessage[] = [];

	if (context.systemPrompt?.trim()) {
		out.push({
			role: "system",
			content: sanitizeSurrogates(context.systemPrompt),
		});
	}

	for (const msg of messages) {
		if (msg.role === "user") {
			out.push({ role: "user", content: userMessageToText(msg) });
			continue;
		}

		if (msg.role === "assistant") {
			const textParts: string[] = [];
			for (const block of msg.content) {
				if (block.type === "text") {
					textParts.push(block.text);
					continue;
				}
				if (block.type === "thinking") {
					if (block.redacted) {
						continue;
					}
					if (block.thinking.trim()) {
						textParts.push(block.thinking);
					}
					continue;
				}
				if (block.type === "toolCall") {
					throw new Error("MiniMax v2 does not support tool calls in history");
				}
			}
			const assistantText = sanitizeSurrogates(textParts.join(""));
			if (assistantText.length > 0) {
				out.push({
					role: "assistant",
					content: assistantText,
				});
			}
		}
	}

	return out;
}

function buildUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/$/, "");
	return `${trimmed}${CHAT_COMPLETION_V2_PATH}`;
}

function mapFinishReason(reason: string | undefined): { stopReason: StopReason; errorMessage?: string } {
	if (!reason || reason === "stop") {
		return { stopReason: "stop" };
	}
	if (reason === "length") {
		return { stopReason: "length" };
	}
	return { stopReason: "error", errorMessage: `Unknown finish_reason: ${reason}` };
}

function applyUsageChunk(output: AssistantMessage, model: Model<"minimax">, usageObj: Record<string, unknown>): void {
	const prompt = usageObj.prompt_tokens;
	const completion = usageObj.completion_tokens;
	const total = usageObj.total_tokens;

	let input = 0;
	let outputTok = 0;
	let totalTokens = 0;

	if (typeof prompt === "number" && typeof completion === "number") {
		input = prompt;
		outputTok = completion;
		totalTokens = prompt + completion;
	} else if (typeof total === "number") {
		totalTokens = total;
		input = Math.max(0, Math.floor(total * 0.55));
		outputTok = Math.max(0, total - input);
	}

	if (totalTokens <= 0 && input === 0 && outputTok === 0) {
		return;
	}

	output.usage = {
		input,
		output: outputTok,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: totalTokens > 0 ? totalTokens : input + outputTok,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, output.usage);
}

function readBaseRespError(obj: Record<string, unknown>): string | undefined {
	if (!Value.Check(minimaxSseBaseResp, obj) || !isPlainObject(obj)) {
		return undefined;
	}
	const base = obj.base_resp;
	if (!isPlainObject(base)) {
		return undefined;
	}
	const code = base.status_code;
	if (typeof code !== "number" || code === 0) {
		return undefined;
	}
	const msg = typeof base.status_msg === "string" ? base.status_msg : "";
	return msg ? `MiniMax API error (${code}): ${msg}` : `MiniMax API error (${code})`;
}

export const streamMiniMax: StreamFunction<"minimax", MiniMaxOptions> = (
	model: Model<"minimax">,
	context: Context,
	options?: MiniMaxOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output = createOutput(model);

		try {
			assertNoTools(context);

			const apiKey = options?.apiKey || getEnvApiKey(model.provider);
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const transformed = transformMessages(context.messages, model);
			const messages = toMinimaxMessages(context, transformed);

			const maxCompletion = Math.min(options?.maxTokens ?? MAX_COMPLETION_TOKENS_CAP, MAX_COMPLETION_TOKENS_CAP);

			let body: Record<string, unknown> = {
				model: model.id,
				messages,
				stream: true,
				max_completion_tokens: maxCompletion,
			};

			if (options?.temperature !== undefined) {
				body.temperature = options.temperature;
			}
			if (options?.topP !== undefined) {
				body.top_p = options.topP;
			}

			const nextBody = await options?.onPayload?.(body, model);
			if (nextBody !== undefined) {
				if (!Value.Check(minimaxRequestBody, nextBody) || !isPlainObject(nextBody)) {
					throw new Error(
						"MiniMax onPayload must return a plain object with model (string), messages (array), stream (boolean), and max_completion_tokens (number)",
					);
				}
				body = nextBody;
			}

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			};
			if (model.headers) {
				Object.assign(headers, model.headers);
			}
			if (options?.headers) {
				Object.assign(headers, options.headers);
			}

			const response = await fetch(buildUrl(model.baseUrl), {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: options?.signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`MiniMax Text Chat HTTP ${response.status}: ${errText.slice(0, 2000)}`);
			}

			const contentType = response.headers.get("content-type") ?? "";
			if (!contentType.includes("text/event-stream")) {
				const text = await response.text();
				throw new Error(`MiniMax Text Chat: expected text/event-stream, got ${contentType}: ${text.slice(0, 500)}`);
			}

			const responseBody = response.body;
			if (!responseBody) {
				throw new Error("MiniMax Text Chat: empty response body");
			}

			stream.push({ type: "start", partial: output });

			let textBuffer = "";
			let textBlock: TextContent | null = null;
			const blocks = output.content;
			const ensureTextBlock = (): TextContent => {
				if (textBlock) {
					return textBlock;
				}
				const block: TextContent = { type: "text", text: "" };
				textBlock = block;
				blocks.push(block);
				stream.push({
					type: "text_start",
					contentIndex: blocks.length - 1,
					partial: output,
				});
				return block;
			};

			for await (const raw of parseSseJsonObjectRecordsFromBody(responseBody)) {
				const errMsg = readBaseRespError(raw);
				if (errMsg) {
					throw new Error(errMsg);
				}

				if (typeof raw.id === "string") {
					output.responseId = raw.id;
				}

				const usage = raw.usage;
				if (Value.Check(minimaxUsageChunk, usage) && isPlainObject(usage)) {
					applyUsageChunk(output, model, usage);
				}

				const choices = raw.choices;
				if (!Array.isArray(choices) || choices.length === 0) {
					continue;
				}

				const choice = choices[0];
				if (!Value.Check(minimaxStreamChoice, choice) || !isPlainObject(choice)) {
					continue;
				}

				if (typeof choice.finish_reason === "string") {
					const mapped = mapFinishReason(choice.finish_reason);
					output.stopReason = mapped.stopReason;
					if (mapped.errorMessage) {
						output.errorMessage = mapped.errorMessage;
					}
				}

				const delta = choice.delta;
				if (isPlainObject(delta)) {
					const piece = delta.content;
					if (typeof piece === "string" && piece.length > 0) {
						const block = ensureTextBlock();
						textBuffer += piece;
						block.text = textBuffer;
						stream.push({
							type: "text_delta",
							contentIndex: blocks.length - 1,
							delta: piece,
							partial: output,
						});
					}
				}

				const message = choice.message;
				if (isPlainObject(message)) {
					const full = message.content;
					if (typeof full === "string" && full.length > 0 && textBuffer.length === 0) {
						const block = ensureTextBlock();
						textBuffer = full;
						block.text = full;
						stream.push({
							type: "text_delta",
							contentIndex: blocks.length - 1,
							delta: full,
							partial: output,
						});
					}
				}
			}

			if (textBlock) {
				stream.push({
					type: "text_end",
					contentIndex: blocks.length - 1,
					content: textBuffer,
					partial: output,
				});
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "error") {
				throw new Error(output.errorMessage || "MiniMax error");
			}

			const doneReason = output.stopReason;
			if (doneReason !== "stop" && doneReason !== "length" && doneReason !== "toolUse") {
				throw new Error(output.errorMessage || "MiniMax incomplete");
			}

			stream.push({ type: "done", reason: doneReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleMiniMax: StreamFunction<"minimax", SimpleStreamOptions> = (
	model: Model<"minimax">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, options, apiKey);
	const cappedMax = Math.min(base.maxTokens ?? MAX_COMPLETION_TOKENS_CAP, MAX_COMPLETION_TOKENS_CAP);

	return streamMiniMax(model, context, {
		...base,
		maxTokens: cappedMax,
	});
};
