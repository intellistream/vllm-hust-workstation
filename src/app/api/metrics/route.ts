import { DEFAULT_MODEL_ID, SERVER_CONFIG } from "@/lib/config";
import {
  getInternalMetricsSnapshot,
  recordApiRequest,
  recordUpstreamRequest,
  setWorkstationInfo,
} from "@/lib/metrics";
import type { MetricsSnapshot } from "@/types";

export const runtime = "nodejs";
export const revalidate = 0;

function compactMetrics<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null)
  ) as Partial<T>;
}

// Pull gateway Prometheus metrics when available, then merge with workstation-native metrics.
async function fetchLiveMetrics(): Promise<Partial<MetricsSnapshot>> {
  try {
    const start = performance.now();
    const res = await fetch(`${SERVER_CONFIG.baseUrl}/metrics`, {
      signal: AbortSignal.timeout(2000),
    });
    recordUpstreamRequest(
      "/api/metrics",
      "/metrics",
      res.status,
      (performance.now() - start) / 1000
    );
    if (!res.ok) return {};
    const text = await res.text();

    const parse = (key: string): number | undefined => {
      const m = text.match(new RegExp(`^${key}\\s+([\\d.]+)`, "m"));
      return m ? parseFloat(m[1]) : undefined;
    };

    return compactMetrics({
      tokensPerSecond: parse("sagellm_tokens_per_second"),
      pendingRequests: parse("sagellm_pending_requests"),
      gpuUtilPct: parse("sagellm_gpu_util_pct"),
      gpuMemUsedGb: parse("sagellm_gpu_mem_used_bytes") !== undefined
        ? (parse("sagellm_gpu_mem_used_bytes")! / 1e9)
        : undefined,
      gpuMemTotalGb: parse("sagellm_gpu_mem_total_bytes") !== undefined
        ? (parse("sagellm_gpu_mem_total_bytes")! / 1e9)
        : undefined,
      totalRequestsServed: parse("sagellm_requests_total"),
      avgLatencyMs: parse("sagellm_latency_p50_ms"),
    });
  } catch {
    return {};
  }
}

// Also try OpenAI-compatible /v1/stats (sagellm extension)
async function fetchV1Stats(): Promise<Partial<MetricsSnapshot>> {
  try {
    const start = performance.now();
    const res = await fetch(`${SERVER_CONFIG.baseUrl}/v1/stats`, {
      headers: { Authorization: `Bearer ${SERVER_CONFIG.apiKey}` },
      signal: AbortSignal.timeout(2000),
    });
    recordUpstreamRequest(
      "/api/metrics",
      "/v1/stats",
      res.status,
      (performance.now() - start) / 1000
    );
    if (!res.ok) return {};
    return compactMetrics(await res.json());
  } catch {
    return {};
  }
}

async function fetchEngineHealth(): Promise<boolean | null> {
  try {
    const res = await fetch(`${SERVER_CONFIG.baseUrl}/v1/management/engines`, {
      headers: { Authorization: `Bearer ${SERVER_CONFIG.apiKey}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      const detail = await res.text();
      if (detail.includes("Control Plane not initialized")) {
        return false;
      }
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data?.engines)) {
      return false;
    }
    return data.engines.some(
      (engine: { is_healthy?: boolean; engine_kind?: string }) =>
        engine?.is_healthy && (engine?.engine_kind ?? "llm") === "llm"
    );
  } catch {
    return null;
  }
}

export async function GET() {
  const start = performance.now();
  const [live, stats, engineHealthy] = await Promise.all([
    fetchLiveMetrics(),
    fetchV1Stats(),
    fetchEngineHealth(),
  ]);
  const internal = getInternalMetricsSnapshot();
  setWorkstationInfo(
    internal.modelName || process.env.DEFAULT_MODEL || DEFAULT_MODEL_ID,
    internal.backendType || process.env.BACKEND_TYPE || "CPU"
  );

  const merged = { ...compactMetrics(internal), ...live, ...stats };
  const gatewayAvailable =
    engineHealthy === null
      ? Object.keys(live).length > 0 || Object.keys(stats).length > 0
      : engineHealthy;

  const snapshot: MetricsSnapshot = {
    tokensPerSecond: merged.tokensPerSecond ?? 0,
    pendingRequests: merged.pendingRequests ?? 0,
    gpuUtilPct: merged.gpuUtilPct ?? 0,
    gpuMemUsedGb: merged.gpuMemUsedGb ?? 0,
    gpuMemTotalGb: merged.gpuMemTotalGb ?? 0,
    uptimeSeconds: merged.uptimeSeconds ?? 0,
    totalRequestsServed: merged.totalRequestsServed ?? 0,
    avgLatencyMs: merged.avgLatencyMs ?? 0,
    modelName: merged.modelName ?? (process.env.DEFAULT_MODEL || DEFAULT_MODEL_ID),
    backendType: merged.backendType ?? (process.env.BACKEND_TYPE || "CPU"),
    gatewayAvailable,
  };

  recordApiRequest("/api/metrics", "GET", 200, (performance.now() - start) / 1000);
  return Response.json(snapshot);
}
