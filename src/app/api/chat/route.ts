import { SERVER_CONFIG } from "@/lib/config";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { messages, model, stream = true } = body;

  const upstream = `${SERVER_CONFIG.baseUrl}/v1/chat/completions`;

  const startTime = Date.now();

  const response = await fetch(upstream, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVER_CONFIG.apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream }),
  });

  if (!response.ok) {
    const err = await response.text();
    return new Response(JSON.stringify({ error: err }), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pass through the SSE stream with added latency header
  const headers = new Headers(response.headers);
  headers.set("X-Request-Start", String(startTime));
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");

  return new Response(response.body, {
    status: 200,
    headers,
  });
}
