import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import { DEFAULT_MODEL_ID } from "@/lib/config";

type MetricsStore = {
  registry: Registry;
  apiRequestsTotal: Counter<"route" | "method" | "status">;
  apiRequestDurationSeconds: Histogram<"route" | "method">;
  upstreamRequestDurationSeconds: Histogram<"route" | "upstream" | "status_class">;
  activeChatRequests: Gauge;
  chatStreamDurationSeconds: Histogram<"model">;
  chatApproxTokensTotal: Counter<"model">;
  workstationInfo: Gauge<"model" | "backend">;
  state: {
    startedAtMs: number;
    activeChatRequests: number;
    completedChatRequests: number;
    failedChatRequests: number;
    totalApproxTokens: number;
    lastTokensPerSecond: number;
    totalLatencyMs: number;
    latencySamples: number;
    modelName: string;
    backendType: string;
  };
};

const globalMetrics = globalThis as typeof globalThis & {
  __sagellmWorkstationMetrics?: MetricsStore;
};

function createMetricsStore(): MetricsStore {
  const registry = new Registry();
  collectDefaultMetrics({
    register: registry,
    prefix: "sagellm_workstation_nodejs_",
  });

  return {
    registry,
    apiRequestsTotal: new Counter({
      name: "sagellm_workstation_api_requests_total",
      help: "Total number of workstation API requests handled.",
      labelNames: ["route", "method", "status"],
      registers: [registry],
    }),
    apiRequestDurationSeconds: new Histogram({
      name: "sagellm_workstation_api_request_duration_seconds",
      help: "End-to-end request duration for workstation API routes.",
      labelNames: ["route", "method"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers: [registry],
    }),
    upstreamRequestDurationSeconds: new Histogram({
      name: "sagellm_workstation_upstream_request_duration_seconds",
      help: "Latency of upstream sagellm-gateway requests issued by workstation.",
      labelNames: ["route", "upstream", "status_class"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers: [registry],
    }),
    activeChatRequests: new Gauge({
      name: "sagellm_workstation_active_chat_requests",
      help: "Current number of in-flight chat streaming requests.",
      registers: [registry],
    }),
    chatStreamDurationSeconds: new Histogram({
      name: "sagellm_workstation_chat_stream_duration_seconds",
      help: "Streaming duration for successful chat requests.",
      labelNames: ["model"],
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
      registers: [registry],
    }),
    chatApproxTokensTotal: new Counter({
      name: "sagellm_workstation_chat_approx_tokens_total",
      help: "Approximate number of generated tokens emitted by workstation chat streams.",
      labelNames: ["model"],
      registers: [registry],
    }),
    workstationInfo: new Gauge({
      name: "sagellm_workstation_info",
      help: "Static workstation metadata with model and backend labels.",
      labelNames: ["model", "backend"],
      registers: [registry],
    }),
    state: {
      startedAtMs: Date.now(),
      activeChatRequests: 0,
      completedChatRequests: 0,
      failedChatRequests: 0,
      totalApproxTokens: 0,
      lastTokensPerSecond: 0,
      totalLatencyMs: 0,
      latencySamples: 0,
      modelName: process.env.DEFAULT_MODEL || DEFAULT_MODEL_ID,
      backendType: process.env.BACKEND_TYPE || "CPU",
    },
  };
}

function getMetricsStore(): MetricsStore {
  if (!globalMetrics.__sagellmWorkstationMetrics) {
    globalMetrics.__sagellmWorkstationMetrics = createMetricsStore();
  }
  return globalMetrics.__sagellmWorkstationMetrics;
}

export function setWorkstationInfo(modelName: string, backendType: string): void {
  const metrics = getMetricsStore();
  metrics.state.modelName = modelName;
  metrics.state.backendType = backendType;
  metrics.workstationInfo.reset();
  metrics.workstationInfo.set({ model: modelName, backend: backendType }, 1);
}

export function recordApiRequest(
  route: string,
  method: string,
  status: number,
  durationSeconds: number
): void {
  const metrics = getMetricsStore();
  metrics.apiRequestsTotal.inc({ route, method, status: String(status) });
  metrics.apiRequestDurationSeconds.observe({ route, method }, durationSeconds);
}

export function recordUpstreamRequest(
  route: string,
  upstream: string,
  status: number,
  durationSeconds: number
): void {
  const metrics = getMetricsStore();
  metrics.upstreamRequestDurationSeconds.observe(
    {
      route,
      upstream,
      status_class: `${Math.floor(status / 100)}xx`,
    },
    durationSeconds
  );
}

export function beginChatRequest(): void {
  const metrics = getMetricsStore();
  metrics.state.activeChatRequests += 1;
  metrics.activeChatRequests.inc();
}

export function finishChatRequest(params: {
  model: string;
  durationSeconds: number;
  approxTokens: number;
  status: "completed" | "failed";
}): void {
  const metrics = getMetricsStore();
  metrics.state.modelName = params.model;
  metrics.state.activeChatRequests = Math.max(0, metrics.state.activeChatRequests - 1);
  metrics.activeChatRequests.set(metrics.state.activeChatRequests);

  if (params.status === "completed") {
    metrics.state.completedChatRequests += 1;
    metrics.state.totalApproxTokens += params.approxTokens;
    metrics.state.lastTokensPerSecond =
      params.durationSeconds > 0 ? params.approxTokens / params.durationSeconds : 0;
    metrics.state.totalLatencyMs += params.durationSeconds * 1000;
    metrics.state.latencySamples += 1;
    metrics.chatStreamDurationSeconds.observe({ model: params.model }, params.durationSeconds);
    if (params.approxTokens > 0) {
      metrics.chatApproxTokensTotal.inc({ model: params.model }, params.approxTokens);
    }
  } else {
    metrics.state.failedChatRequests += 1;
  }
}

export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function getInternalMetricsSnapshot() {
  const metrics = getMetricsStore();
  const avgLatencyMs =
    metrics.state.latencySamples > 0
      ? metrics.state.totalLatencyMs / metrics.state.latencySamples
      : 0;

  return {
    tokensPerSecond: metrics.state.lastTokensPerSecond,
    pendingRequests: metrics.state.activeChatRequests,
    uptimeSeconds: Math.floor((Date.now() - metrics.state.startedAtMs) / 1000),
    totalRequestsServed: metrics.state.completedChatRequests,
    avgLatencyMs,
    modelName: metrics.state.modelName,
    backendType: metrics.state.backendType,
  };
}

export async function getPrometheusMetrics(): Promise<{ contentType: string; body: string }> {
  const metrics = getMetricsStore();
  return {
    contentType: metrics.registry.contentType,
    body: await metrics.registry.metrics(),
  };
}
