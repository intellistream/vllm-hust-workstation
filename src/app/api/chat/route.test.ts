// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const metrics = vi.hoisted(() => ({
  beginChatRequest: vi.fn(),
  estimateTokenCount: vi.fn(() => 7),
  finishChatRequest: vi.fn(),
  recordApiRequest: vi.fn(),
  recordUpstreamRequest: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  SERVER_CONFIG: { baseUrl: "http://upstream.invalid" },
}));
vi.mock("@/lib/runtimeSecret", () => ({ getServerApiKey: () => "test-key" }));
vi.mock("@/lib/server/webSearch", () => ({ getWebSearchContext: vi.fn() }));
vi.mock("@/lib/metrics", () => metrics);

import { POST } from "./route";

const CURRENT_REASONING_ONLY_SSE = [
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"content":null,"reasoning":"先分析。"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"reasoning":"再确认。"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}',
  "data: [DONE]",
  "",
].join("\n");

function request(stream = true): NextRequest {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "测试" }],
      model: "Qwen/Qwen3.8-27B",
      stream,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  metrics.estimateTokenCount.mockReturnValue(7);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat proxy reasoning protocol", () => {
  it("passes current reasoning SSE through unchanged and counts it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(CURRENT_REASONING_ONLY_SSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      )
    );

    const response = await POST(request());
    expect(await response.text()).toBe(CURRENT_REASONING_ONLY_SSE);
    expect(metrics.estimateTokenCount).toHaveBeenCalledWith("先分析。再确认。");
    expect(metrics.finishChatRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "Qwen/Qwen3.8-27B",
        approxTokens: 7,
        status: "completed",
      })
    );
  });

  it("counts both reasoning and answer text in non-stream responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { reasoning: "分析", content: "答案" } }],
        })
      )
    );

    const response = await POST(request(false));
    expect(response.status).toBe(200);
    expect(metrics.estimateTokenCount).toHaveBeenCalledWith("分析\n答案");
  });
});
