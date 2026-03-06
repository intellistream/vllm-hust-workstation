export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface MetricsSnapshot {
  tokensPerSecond: number;
  pendingRequests: number;
  gpuUtilPct: number;
  gpuMemUsedGb: number;
  gpuMemTotalGb: number;
  uptimeSeconds: number;
  totalRequestsServed: number;
  avgLatencyMs: number;
  modelName: string;
  backendType: string;
}

export interface AppConfig {
  brandName: string;
  brandLogo: string | null;
  accentColor: string;
  baseUrl: string;
  defaultModel: string;
}
