import { describe, expect, it } from "vitest";
import {
  ChatStreamAccumulator,
  EMPTY_ASSISTANT_RESPONSE,
  extractChatMessage,
  parseChatSseLine,
  parseThinkContent,
} from "./chatStream";

const CURRENT_REASONING_ONLY_FIXTURE = [
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1788776862,"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning":"我先分析问题。"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1788776862,"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"content":null,"reasoning":"答案需要简明。"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1788776862,"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}',
  "data: [DONE]",
];

const CURRENT_REASONING_THEN_CONTENT_FIXTURE = [
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1788776862,"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning":"先组织一句回答。"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1788776862,"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"content":"天空呈蓝色，"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1788776862,"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"content":"主要因为短波蓝光更容易被大气散射。"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","created":1788776862,"model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  "data: [DONE]",
];

function consumeFixture(lines: string[]): ChatStreamAccumulator {
  const stream = new ChatStreamAccumulator();
  for (const line of lines) {
    const event = parseChatSseLine(line);
    if (event.kind === "payload") {
      stream.push(event.payload);
    }
  }
  return stream;
}

describe("current vLLM streaming protocol", () => {
  it("renders current delta.reasoning when the stream ends before answer content", () => {
    const stream = consumeFixture(CURRENT_REASONING_ONLY_FIXTURE);
    expect(stream.content).toBe("");
    expect(stream.reasoning).toBe("我先分析问题。答案需要简明。");
    expect(stream.visibleContent()).toBe("我先分析问题。答案需要简明。");
  });

  it("prefers answer content after current delta.reasoning", () => {
    const stream = consumeFixture(CURRENT_REASONING_THEN_CONTENT_FIXTURE);
    expect(stream.reasoning).toBe("先组织一句回答。");
    expect(stream.visibleContent()).toBe(
      "天空呈蓝色，主要因为短波蓝光更容易被大气散射。"
    );
  });

  it("retains legacy delta.reasoning_content compatibility", () => {
    const stream = consumeFixture([
      'data: {"choices":[{"delta":{"reasoning_content":"旧协议推理仍可见。"},"finish_reason":"length"}]}',
      "data: [DONE]",
    ]);
    expect(stream.visibleContent()).toBe("旧协议推理仍可见。");
  });

  it("uses the current field once when both spellings are present", () => {
    const stream = consumeFixture([
      'data: {"choices":[{"delta":{"reasoning":"当前字段","reasoning_content":"旧字段"}}]}',
      "data: [DONE]",
    ]);
    expect(stream.reasoning).toBe("当前字段");
  });

  it("never finalizes a successful empty stream as an empty bubble", () => {
    const stream = consumeFixture(["data: [DONE]"]);
    expect(stream.visibleContent()).toBe(EMPTY_ASSISTANT_RESPONSE);
    expect(stream.visibleContent().trim().length).toBeGreaterThan(0);
  });
});

describe("chat text compatibility", () => {
  it("uses reasoning in non-stream responses when content is empty", () => {
    expect(
      extractChatMessage({
        choices: [{ message: { content: "", reasoning: "非流式推理结果" } }],
      })
    ).toEqual({ content: "", reasoning: "非流式推理结果" });
  });

  it("extracts inline think tags without losing the answer", () => {
    expect(parseThinkContent("<think>分析</think>最终答案")).toEqual({
      think: "分析",
      main: "最终答案",
    });
  });

  it("uses inline thinking as a fallback when no answer follows", () => {
    const stream = consumeFixture([
      'data: {"choices":[{"delta":{"content":"<think>仍在分析"}}]}',
      "data: [DONE]",
    ]);
    expect(stream.visibleContent()).toBe("仍在分析");
  });
});
