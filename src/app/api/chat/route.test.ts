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
const webSearch = vi.hoisted(() => ({ getWebSearchContext: vi.fn() }));

vi.mock("@/lib/config", () => ({
  SERVER_CONFIG: { baseUrl: "http://upstream.invalid" },
}));
vi.mock("@/lib/runtimeSecret", () => ({ getServerApiKey: () => "test-key" }));
vi.mock("@/lib/server/webSearch", () => webSearch);
vi.mock("@/lib/metrics", () => metrics);

import { POST } from "./route";

const CURRENT_REASONING_ONLY_SSE = [
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"content":null,"reasoning":"先分析。"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{"reasoning":"再确认。"},"finish_reason":null}]}',
  'data: {"id":"chatcmpl-live","object":"chat.completion.chunk","model":"Qwen/Qwen3.8-27B","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}',
  "data: [DONE]",
  "",
].join("\n");

function request(stream = true, overrides: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "测试" }],
      model: "Qwen/Qwen3.8-27B",
      stream,
      ...overrides,
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

describe("chat search context injection", () => {
  const question = "请只用一句中文回答：天空为什么是蓝色？";

  it("leaves the original question untouched when retrieval has no relevant result", async () => {
    webSearch.getWebSearchContext.mockResolvedValue({
      enabled: true,
      attempted: true,
      mode: "workstation-context",
      query: "天空为什么是蓝色",
      results: [],
      context: "",
    });
    const upstreamFetch = vi.fn().mockResolvedValue(
      Response.json({ choices: [{ message: { content: "蓝光更容易被大气散射。" } }] })
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(
      request(false, {
        web_search: true,
        messages: [{ role: "user", content: question }],
      })
    );
    const upstreamBody = JSON.parse(
      (upstreamFetch.mock.calls[0][1] as RequestInit).body as string
    );
    expect(upstreamBody.messages.at(-1)).toEqual({ role: "user", content: question });
    expect(await response.json()).toMatchObject({
      search: { query: "天空为什么是蓝色", results: [] },
    });
  });

  it("injects only the relevance-gated context while preserving the user question", async () => {
    const context = "【联网搜索参考】相关结果。";
    webSearch.getWebSearchContext.mockResolvedValue({
      enabled: true,
      attempted: true,
      mode: "workstation-context",
      query: "天空为什么是蓝色",
      results: [
        { title: "天空为何呈蓝色", url: "https://example.com/sky", snippet: "瑞利散射" },
      ],
      context,
    });
    const upstreamFetch = vi.fn().mockResolvedValue(
      Response.json({ choices: [{ message: { content: "蓝光更容易被大气散射。" } }] })
    );
    vi.stubGlobal("fetch", upstreamFetch);

    await POST(
      request(false, {
        web_search: true,
        messages: [{ role: "user", content: question }],
      })
    );
    const upstreamBody = JSON.parse(
      (upstreamFetch.mock.calls[0][1] as RequestInit).body as string
    );
    expect(upstreamBody.messages.at(-1)).toEqual({
      role: "user",
      content: `${context}\n用户问题：${question}`,
    });
  });
});
