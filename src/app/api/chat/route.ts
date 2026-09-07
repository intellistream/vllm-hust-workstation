import { SERVER_CONFIG } from "@/lib/config";
import { getServerApiKey } from "@/lib/runtimeSecret";
import { getWebSearchContext } from "@/lib/server/webSearch";
import {
  beginChatRequest,
  estimateTokenCount,
  finishChatRequest,
  recordApiRequest,
  recordUpstreamRequest,
} from "@/lib/metrics";
import { NextRequest } from "next/server";
import type { SearchResult } from "@/types";
import {
  extractChatMessage,
  extractChatStreamDelta,
  parseChatSseLine,
} from "@/lib/chatStream";
 

export const runtime = "nodejs";

const DEFAULT_CHAT_MAX_TOKENS = Number(process.env.WORKSTATION_DEFAULT_MAX_TOKENS || "4096");

/** System prompt to keep Qwen3 thinking concise on resource-constrained NPU hardware */
const THINKING_BUDGET_SYSTEM_PROMPT =
  process.env.WORKSTATION_SYSTEM_PROMPT ||
  "你是一个有用的AI助手。思考时请简明扼要，将内部推理控制在200字以内，然后直接给出清晰完整的回答。";
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { messages, model, stream = true } = body;
  const doSearch = Boolean(body.web_search);
  const enableThinking = body.enable_thinking !== false; // default true
  const encoder = new TextEncoder();

  let searchResults: SearchResult[] = [];
  let searchQuery = "";
  let searchAttempted = false;
  let outboundMessages = Array.isArray(messages) ? [...messages] : [];

  // Prepend system prompt if none exists to constrain thinking verbosity
  if (!outboundMessages.some((m: { role: string }) => m.role === "system") && THINKING_BUDGET_SYSTEM_PROMPT) {
    outboundMessages = [
      { role: "system", content: THINKING_BUDGET_SYSTEM_PROMPT },
      ...outboundMessages,
    ];
  }

  if (doSearch) {
    const lastUserMessage = [...outboundMessages].reverse().find((message) => message?.role === "user");
    searchQuery = typeof lastUserMessage?.content === "string" ? lastUserMessage.content.slice(0, 200).trim() : "";
    if (searchQuery) {
      const searchContext = await getWebSearchContext(searchQuery, true);
      searchAttempted = searchContext.attempted;
      searchResults = searchContext.results;
      searchQuery = searchContext.query;
      if (searchContext.context) {
        outboundMessages = outboundMessages.map((message, index) => {
          if (index === outboundMessages.lastIndexOf(lastUserMessage)) {
            return {
              ...message,
              content: `${searchContext.context}\n用户问题：${message.content}`,
            };
          }
          return message;
        });
      }
    }
  }

  const upstream = `${SERVER_CONFIG.baseUrl}/v1/chat/completions`;

  const requestStart = performance.now();
  beginChatRequest();

  try {
    const upstreamStart = performance.now();
    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getServerApiKey()}`,
      },
      body: JSON.stringify({
        ...body,
        model,
        messages: outboundMessages,
        stream,
        max_tokens:
          typeof body?.max_tokens === "number" && Number.isFinite(body.max_tokens)
            ? body.max_tokens
            : DEFAULT_CHAT_MAX_TOKENS,
        chat_template_kwargs: { enable_thinking: enableThinking },
      }),
    });
    recordUpstreamRequest(
      "/api/chat",
      "/v1/chat/completions",
      response.status,
      (performance.now() - upstreamStart) / 1000
    );

    if (!response.ok || !response.body) {
      const err = await response.text();
      const totalDurationSeconds = (performance.now() - requestStart) / 1000;
      finishChatRequest({
        model,
        durationSeconds: totalDurationSeconds,
        approxTokens: 0,
        status: "failed",
      });
      recordApiRequest("/api/chat", "POST", response.status, totalDurationSeconds);
      const errorText = err.slice(0, 240).replace(/\n/g, " ");
      return Response.json(
        {
          error: errorText || "上游服务返回错误",
          search: searchAttempted
            ? {
                query: searchQuery,
                results: searchResults,
              }
            : undefined,
        },
        { status: response.status || 502 }
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!stream && contentType.includes("application/json")) {
      const payload = await response.json();
      const generatedFields = extractChatMessage(payload);
      const generated = [generatedFields.reasoning, generatedFields.content]
        .filter(Boolean)
        .join("\n");
      const totalDurationSeconds = (performance.now() - requestStart) / 1000;
      finishChatRequest({
        model,
        durationSeconds: totalDurationSeconds,
        approxTokens: estimateTokenCount(generated),
        status: "completed",
      });
      recordApiRequest("/api/chat", "POST", 200, totalDurationSeconds);

      if (!searchAttempted) {
        return Response.json(payload);
      }

      return Response.json({
        ...payload,
        search: {
          query: searchQuery,
          results: searchResults,
        },
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-cache");
    headers.set("Connection", "keep-alive");

    let sseBuffer = "";
    let generatedText = "";
    let generatedReasoning = "";
    let finalized = false;

    const finalize = (status: "completed" | "failed") => {
      if (finalized) {
        return;
      }
      finalized = true;
      const durationSeconds = (performance.now() - requestStart) / 1000;
      const approxTokens = estimateTokenCount(
        [generatedReasoning, generatedText].filter(Boolean).join("\n")
      );
      finishChatRequest({
        model,
        durationSeconds,
        approxTokens,
        status,
      });
      recordApiRequest(
        "/api/chat",
        "POST",
        status === "completed" ? 200 : 499,
        durationSeconds
      );
    };

    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (searchAttempted) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "search_results", query: searchQuery, results: searchResults })}\n\n`
              )
            );
          }

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              finalize("completed");
              controller.close();
              return;
            }

            if (value) {
              const chunk = decoder.decode(value, { stream: true });
              sseBuffer += chunk;
              const lines = sseBuffer.split("\n");
              sseBuffer = lines.pop() ?? "";

              for (const line of lines) {
                const event = parseChatSseLine(line);
                if (event.kind !== "payload") {
                  continue;
                }
                const delta = extractChatStreamDelta(event.payload);
                generatedText += delta.content;
                generatedReasoning += delta.reasoning;
              }
              controller.enqueue(value);
            }
          }
        } catch (error) {
          finalize("failed");
          controller.error(error);
        }
      },
      async cancel(reason) {
        finalize("failed");
        await reader.cancel(reason);
      },
    });

    return new Response(streamBody, {
      status: 200,
      headers,
    });
  } catch (error) {
    const totalDurationSeconds = (performance.now() - requestStart) / 1000;
    finishChatRequest({
      model,
      durationSeconds: totalDurationSeconds,
      approxTokens: 0,
      status: "failed",
    });
    recordApiRequest("/api/chat", "POST", 500, totalDurationSeconds);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "upstream request failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
