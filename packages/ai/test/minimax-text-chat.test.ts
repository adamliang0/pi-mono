import { afterEach, describe, expect, it, vi } from "vitest";
import { streamMiniMax } from "../src/providers/minimax.js";
import type { Context, Model, TextContent } from "../src/types.js";

const testModel: Model<"minimax"> = {
	id: "M2-her",
	name: "M2-her",
	api: "minimax",
	provider: "minimax",
	baseUrl: "https://api.minimax.io",
	reasoning: false,
	input: ["text"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 128000,
	maxTokens: 2048,
};

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const text = chunks.map((c) => `data: ${c}\n\n`).join("");
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(text));
			controller.close();
		},
	});
}

describe("minimax-text-chat", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("streams text deltas and completes with usage", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				sseBody([
					JSON.stringify({
						id: "chunk-1",
						object: "chat.completion.chunk",
						choices: [{ index: 0, delta: { content: "Hello" } }],
					}),
					JSON.stringify({
						id: "chunk-1",
						object: "chat.completion.chunk",
						choices: [{ index: 0, finish_reason: "stop", delta: { content: " world" } }],
						usage: { total_tokens: 42 },
					}),
				]),
				{
					status: 200,
					headers: { "content-type": "text/event-stream" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const context: Context = {
			messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
		};

		const events = streamMiniMax(testModel, context, {
			apiKey: "test-key",
		});

		const collected: string[] = [];
		for await (const ev of events) {
			if (ev.type === "text_delta") {
				collected.push(ev.delta);
			}
			if (ev.type === "done") {
				const textJoined = ev.message.content
					.filter((c): c is TextContent => c.type === "text")
					.map((c) => c.text)
					.join("");
				expect(textJoined).toBe("Hello world");
				expect(ev.message.usage.totalTokens).toBe(42);
				expect(ev.message.stopReason).toBe("stop");
			}
		}

		expect(collected.join("")).toBe("Hello world");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const raw = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(raw[0]).toBe("https://api.minimax.io/v1/text/chatcompletion_v2");
		expect(raw[1].method).toBe("POST");
		const body = JSON.parse(String(raw[1].body)) as Record<string, unknown>;
		expect(body.model).toBe("M2-her");
		expect(body.stream).toBe(true);
		expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
	});

	it("surfaces base_resp errors from stream chunks", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				sseBody([
					JSON.stringify({
						base_resp: { status_code: 1004, status_msg: "auth failed" },
						choices: [],
					}),
				]),
				{
					status: 200,
					headers: { "content-type": "text/event-stream" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const context: Context = {
			messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
		};

		const events = streamMiniMax(testModel, context, { apiKey: "x" });
		let sawError = false;
		for await (const ev of events) {
			if (ev.type === "error") {
				sawError = true;
				expect(ev.error.errorMessage).toContain("1004");
				expect(ev.error.errorMessage).toContain("auth failed");
			}
		}
		expect(sawError).toBe(true);
	});
});
