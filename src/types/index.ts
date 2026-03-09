export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokensUsed?: number;
  latencyMs?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ModelHubDownloadState {
  status: "idle" | "downloading" | "done" | "error" | "cancelled";
  pct: number;
  speedMbps?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  currentFile?: string;
  error?: string;
}

export interface ModelHubModel {
  id: string;
  name: string;
  repoId: string;
  params: string;
  sizeGb: number;
  vramGb: number;
  description: string;
  tags: string[];
  color: string;
  requiresAuth?: boolean;
  installed?: boolean;
  active?: boolean;
  download?: ModelHubDownloadState;
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
  gatewayAvailable?: boolean;
}

export interface AppConfig {
  brandName: string;
  brandLogo: string | null;
  accentColor: string;
  baseUrl: string;
  defaultModel: string;
  searchEnabled: boolean;
}
