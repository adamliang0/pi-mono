import { jsonSchema, parseJsonEventStream } from "ai";

const SSE_JSON_OBJECT_SCHEMA = jsonSchema<Record<string, unknown>>({
	type: "object",
	additionalProperties: true,
});

/**
 * Read a ReadableStream as async iteration. Pair with streams from
 * `parseJsonEventStream` (AI SDK: bytes → TextDecoderStream → EventSourceParserStream → JSON).
 */
export async function* iterateReadableStream<T>(readable: ReadableStream<T>): AsyncGenerator<T> {
	const reader = readable.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * SSE `data:` lines with JSON objects (OpenAI-style / Codex / MiniMax Text Chat v2).
 * Skips `[DONE]` and malformed events (same as prior hand-rolled parsers).
 */
export async function* parseSseJsonObjectRecordsFromBody(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
	const chunkStream = parseJsonEventStream({
		stream: body,
		schema: SSE_JSON_OBJECT_SCHEMA,
	});
	for await (const parseResult of iterateReadableStream(chunkStream)) {
		if (!parseResult.success) {
			continue;
		}
		yield parseResult.value;
	}
}

/**
 * Same as {@link parseSseJsonObjectRecordsFromBody} but no-op if `response.body` is missing
 * (matches legacy `parseSSE` early return).
 */
export async function* parseSseJsonObjectRecords(response: Response): AsyncGenerator<Record<string, unknown>> {
	const body = response.body;
	if (!body) {
		return;
	}
	yield* parseSseJsonObjectRecordsFromBody(body);
}
