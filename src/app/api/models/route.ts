import { SERVER_CONFIG } from "@/lib/config";

export const runtime = "nodejs";
export const revalidate = 30;

export async function GET() {
  try {
    const res = await fetch(`${SERVER_CONFIG.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${SERVER_CONFIG.apiKey}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error("upstream error");
    const data = await res.json();
    return Response.json(data);
  } catch {
    // Return a sensible default when engine is unreachable
    return Response.json({
      object: "list",
      data: [
        { id: process.env.DEFAULT_MODEL || "default", object: "model" },
      ],
    });
  }
}
