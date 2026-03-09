import { DEFAULT_MODEL_ID, SERVER_CONFIG } from "@/lib/config";
import { recordApiRequest, recordUpstreamRequest } from "@/lib/metrics";

export const runtime = "nodejs";
export const revalidate = 30;

async function fetchHealthyEngineModels(): Promise<string[] | null> {
  try {
    const res = await fetch(`${SERVER_CONFIG.baseUrl}/v1/management/engines`, {
      headers: { Authorization: `Bearer ${SERVER_CONFIG.apiKey}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      const detail = await res.text();
      if (detail.includes("Control Plane not initialized")) {
        return [];
      }
      return null;
    }
    const data = await res.json();
    const healthyModels = Array.isArray(data?.engines)
      ? data.engines
          .filter((engine: { is_healthy?: boolean; engine_kind?: string; model_id?: string }) => {
            return engine?.is_healthy && (engine?.engine_kind ?? "llm") === "llm" && engine?.model_id;
          })
          .map((engine: { model_id: string }) => engine.model_id)
      : [];
    return Array.from(new Set(healthyModels));
  } catch {
    return null;
  }
}

export async function GET() {
  const start = performance.now();
  try {
    const upstreamStart = performance.now();
    const res = await fetch(`${SERVER_CONFIG.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${SERVER_CONFIG.apiKey}` },
      signal: AbortSignal.timeout(3000),
    });
    recordUpstreamRequest(
      "/api/models",
      "/v1/models",
      res.status,
      (performance.now() - upstreamStart) / 1000
    );
    if (!res.ok) throw new Error("upstream error");
    const data = await res.json();
    const healthyModels = await fetchHealthyEngineModels();
    const ids: string[] = Array.isArray(data?.data)
      ? data.data.map((item: { id: string }) => item.id).filter(Boolean)
      : [];
    const usableIds = healthyModels && healthyModels.length > 0 ? healthyModels : ids;
    recordApiRequest("/api/models", "GET", 200, (performance.now() - start) / 1000);
    return Response.json({
      ...data,
      data: usableIds.map((id) => ({ id, object: "model" })),
      upstreamAvailable: Boolean(healthyModels ? healthyModels.length > 0 : ids.length > 0),
      engineReady: healthyModels ? healthyModels.length > 0 : null,
    });
  } catch {
    // 上游不可达时仍返回兜底模型，避免前端下拉框为空；但必须显式标记离线状态。
    recordApiRequest("/api/models", "GET", 200, (performance.now() - start) / 1000);
    return Response.json({
      object: "list",
      data: [
        { id: process.env.DEFAULT_MODEL || DEFAULT_MODEL_ID, object: "model" },
      ],
      upstreamAvailable: false,
    });
  }
}
