import { SERVER_CONFIG } from "@/lib/config";
import type { MetricsSnapshot } from "@/types";

export const runtime = "nodejs";
export const revalidate = 0;

// Try to fetch real metrics from sagellm's /metrics endpoint (Prometheus format)
// Falls back to graceful mock if not available
async function fetchLiveMetrics(): Promise<Partial<MetricsSnapshot>> {
  try {
    const res = await fetch(`${SERVER_CONFIG.baseUrl}/metrics`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return {};
    const text = await res.text();

    const parse = (key: string): number | undefined => {
      const m = text.match(new RegExp(`^${key}\\s+([\\d.]+)`, "m"));
      return m ? parseFloat(m[1]) : undefined;
    };

    return {
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
    };
  } catch {
    return {};
  }
}

// Also try OpenAI-compatible /v1/stats (sagellm extension)
async function fetchV1Stats(): Promise<Partial<MetricsSnapshot>> {
  try {
    const res = await fetch(`${SERVER_CONFIG.baseUrl}/v1/stats`, {
      headers: { Authorization: `Bearer ${SERVER_CONFIG.apiKey}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export async function GET() {
  const [live, stats] = await Promise.all([fetchLiveMetrics(), fetchV1Stats()]);

  const merged = { ...live, ...stats };

  // Fill missing fields with simulated plausible values (for demo without engine)
  const snapshot: MetricsSnapshot = {
    tokensPerSecond: merged.tokensPerSecond ?? 0,
    pendingRequests: merged.pendingRequests ?? 0,
    gpuUtilPct: merged.gpuUtilPct ?? 0,
    gpuMemUsedGb: merged.gpuMemUsedGb ?? 0,
    gpuMemTotalGb: merged.gpuMemTotalGb ?? 0,
    uptimeSeconds: merged.uptimeSeconds ?? 0,
    totalRequestsServed: merged.totalRequestsServed ?? 0,
    avgLatencyMs: merged.avgLatencyMs ?? 0,
    modelName: merged.modelName ?? (process.env.DEFAULT_MODEL || "—"),
    backendType: merged.backendType ?? (process.env.BACKEND_TYPE || "Ascend NPU"),
  };

  return Response.json(snapshot);
}
