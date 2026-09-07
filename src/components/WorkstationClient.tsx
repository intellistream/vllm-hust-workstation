"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import ChatPanel from "@/components/ChatPanel";
import MetricsDashboard from "@/components/MetricsDashboard";
import InferenceSidebar, { type ProcessStep } from "@/components/InferenceSidebar";
import ModelHubModal from "@/components/ModelHubModal";
import AgentLabModal from "@/components/AgentLabModal";
import type { AppConfig, Message, MetricsSnapshot, SearchResult, ServiceProbeStatus } from "@/types";
import type { RuntimeProvenance } from "@/lib/runtimeProvenance";
import {
  ChatStreamAccumulator,
  STOPPED_ASSISTANT_RESPONSE,
  parseChatSseLine,
} from "@/lib/chatStream";

const METRICS_INTERVAL = 3000;
const HISTORY_MAX = 60;

type HistoryPoint = { time: number; tps: number; latency: number; gpu: number };
type Theme = "light" | "dark";

const unavailableProvenance: RuntimeProvenance = {
  available: false,
  source: "unavailable",
  vllmHust: "unavailable",
  vllmAscendHust: "unavailable",
};

function shortSha(value?: string): string {
  return value ? value.slice(0, 10) : "unavailable";
}

function shortDigest(value?: string): string {
  return value ? `${value.slice(0, 18)}…` : "unavailable";
}

function createSteps(params: {
  webSearch: boolean;
  stage: "preparing" | "searching" | "generating" | "done" | "error";
  resultCount?: number;
  query?: string;
  detail?: string;
}): ProcessStep[] {
  const steps: ProcessStep[] = [];
  if (params.webSearch) {
    const searchState =
      params.stage === "searching"
        ? "active"
        : params.stage === "error"
          ? "error"
          : "done";
    steps.push({
      id: "search",
      icon: params.stage === "error" ? "❌" : "🔍",
      label:
        params.stage === "searching"
          ? "正在检索网络"
          : params.resultCount !== undefined
            ? `找到 ${params.resultCount} 条搜索结果`
            : "已完成联网检索",
      state: searchState,
      detail: params.query,
    });
  } else {
    steps.push({
      id: "prepare",
      icon: params.stage === "preparing" ? "💭" : "✅",
      label: "正在准备回答",
      state: params.stage === "preparing" ? "active" : "done",
    });
  }

  if (params.stage === "preparing") {
    return steps;
  }

  steps.push({
    id: "generate",
    icon: params.stage === "error" ? "❌" : params.stage === "done" ? "✅" : "✍️",
    label:
      params.stage === "error"
        ? "生成失败"
        : params.stage === "done"
          ? "生成完成"
          : "正在生成回答",
    state:
      params.stage === "error"
        ? "error"
        : params.stage === "done"
          ? "done"
          : "active",
    detail: params.detail,
  });

  return steps;
}

export default function WorkstationClient({ config }: { config: AppConfig }) {
  const { brandName, brandLogo, accentColor, searchEnabled } = config;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [serviceStatus, setServiceStatus] = useState<ServiceProbeStatus>("checking");
  const [modelsChecked, setModelsChecked] = useState(false);
  const [liveModelSwitchSupported, setLiveModelSwitchSupported] = useState(false);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<HistoryPoint[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [processSteps, setProcessSteps] = useState<ProcessStep[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [thinkText, setThinkText] = useState("");
  const [modelHubOpen, setModelHubOpen] = useState(false);
  const [agentLabOpen, setAgentLabOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [runtimeProvenance, setRuntimeProvenance] = useState<RuntimeProvenance>(unavailableProvenance);
  const [provenanceChecked, setProvenanceChecked] = useState(false);
  const [hardware, setHardware] = useState<{ npu: string; cpu: string; memory: string }>({
    npu: "", cpu: "", memory: "",
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current);
  }, []);

  useEffect(() => {
    if (!searchEnabled) {
      return;
    }
    try {
      setWebSearch(window.localStorage.getItem("vllm_hust_web_search") === "1");
    } catch {
      // ignore localStorage errors
    }
  }, [searchEnabled]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("vllm_hust_thinking");
      if (stored !== null) {
        setThinkingEnabled(stored !== "0");
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  // Fetch immutable runtime provenance captured from the serving container.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => fetch("/api/versions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: RuntimeProvenance) => { if (!cancelled) { setRuntimeProvenance(d); setProvenanceChecked(true); } })
      .catch(() => { if (!cancelled) { setRuntimeProvenance(unavailableProvenance); setProvenanceChecked(true); } });
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // Fetch hardware info for the footer
  useEffect(() => {
    fetch("/api/hardware")
      .then((r) => r.json())
      .then((d) => setHardware({ npu: d.npu ?? "", cpu: d.cpu ?? "", memory: d.memory ?? "" }))
      .catch(() => {});
  }, []);

  // Load models list from gateway
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        const ids: string[] = (data?.data ?? []).map((m: { id: string }) => m.id);
        if (ids.length > 0) {
          setModels(ids);
          setModel((prev) => {
            if (prev && ids.includes(prev)) {
              return prev;
            }
            return ids[0];
          });
        }
        setServiceStatus(Boolean(data?.engineReady && ids.length > 0) ? "online" : "offline");
        setModelsChecked(true);
        setLiveModelSwitchSupported(Boolean(data?.liveModelSwitchSupported));
      })
      .catch(() => {
        setServiceStatus("offline");
        setModelsChecked(true);
        setLiveModelSwitchSupported(false);
      });
  }, []);

  // Poll metrics
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/metrics");
        if (!res.ok) return;
        const snap: MetricsSnapshot = await res.json();
        setMetrics(snap);
        setServiceStatus(Boolean(snap.gatewayAvailable) ? "online" : "offline");
        setMetricsHistory((prev) =>
          [
            ...prev,
            {
              time: Date.now(),
              tps: snap.tokensPerSecond,
              latency: snap.avgLatencyMs,
              gpu: snap.gpuUtilPct,
            },
          ].slice(-HISTORY_MAX)
        );
      } catch {
        // metrics endpoint unavailable - keep last known state
      }
    };
    poll();
    const id = setInterval(poll, METRICS_INTERVAL);
    return () => clearInterval(id);
  }, []);

  const handleToggleWebSearch = useCallback(() => {
    if (!searchEnabled) {
      return;
    }
    setWebSearch((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("vllm_hust_web_search", next ? "1" : "0");
      } catch {
        // ignore localStorage errors
      }
      return next;
    });
  }, [searchEnabled]);

  const handleToggleThinking = useCallback(() => {
    setThinkingEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("vllm_hust_thinking", next ? "1" : "0");
      } catch {
        // ignore localStorage errors
      }
      return next;
    });
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((previous) => {
      const next = previous === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      try {
        window.localStorage.setItem("vllm_hust_theme", next);
      } catch {
        // Keep the in-memory theme when storage is unavailable.
      }
      return next;
    });
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      const assistantId = crypto.randomUUID();
      const startTs = Date.now();
      let fullContent = "";
      const chatStream = new ChatStreamAccumulator();
      let firstToken = true;
      let firstTokenTs = 0;
      let resultCount: number | undefined;
      let effectiveQuery = text;
      let sseBuffer = "";
      let failed = false;
      let aborted = false;

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", timestamp: Date.now() },
      ]);
      setPanelOpen(true);
      setSearchResults([]);
      setSearchQuery(text);
      setThinkText("");
      setProcessSteps(
        createSteps({
          webSearch,
          stage: webSearch ? "searching" : "preparing",
          query: webSearch ? text : undefined,
        })
      );

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const history = [...messages, userMsg].map(({ role, content }) => ({
          role,
          content,
        }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, model, stream: true, web_search: webSearch, enable_thinking: thinkingEnabled }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          let detail = `HTTP ${res.status}`;
          try {
            const payload = await res.json();
            if (payload?.search) {
              const results = Array.isArray(payload.search.results) ? payload.search.results : [];
              resultCount = results.length;
              effectiveQuery =
                typeof payload.search.query === "string" && payload.search.query.trim()
                  ? payload.search.query
                  : text;
              setSearchQuery(effectiveQuery);
              setSearchResults(results);
            }
            if (typeof payload?.error === "string" && payload.error.trim()) {
              detail = payload.error.trim();
            }
          } catch {
            // ignore non-json error body
          }
          throw new Error(detail);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";

          for (const line of lines) {
            const event = parseChatSseLine(line);
            if (event.kind !== "payload") continue;

            try {
              const json = event.payload as { type?: string; results?: unknown; query?: unknown };
              if (json.type === "search_results") {
                const results = Array.isArray(json.results) ? json.results : [];
                resultCount = results.length;
                effectiveQuery = typeof json.query === "string" && json.query.trim() ? json.query : text;
                setSearchQuery(effectiveQuery);
                setSearchResults(results);
                setProcessSteps(
                  createSteps({
                    webSearch,
                    stage: "generating",
                    resultCount,
                    query: effectiveQuery,
                  })
                );
                continue;
              }

              const delta = chatStream.push(json);
              if (delta.reasoning) {
                setThinkText(chatStream.thinking);
                if (firstToken) {
                  firstTokenTs = Date.now();
                  firstToken = false;
                  setProcessSteps(
                    createSteps({
                      webSearch,
                      stage: "generating",
                      resultCount,
                      query: effectiveQuery,
                    })
                  );
                }
              }

              if (delta.content) {
                if (firstToken) {
                  firstTokenTs = Date.now();
                  firstToken = false;
                  setProcessSteps(
                    createSteps({
                      webSearch,
                      stage: "generating",
                      resultCount,
                      query: effectiveQuery,
                    })
                  );
                }
                fullContent = chatStream.content;
                if (chatStream.thinking) {
                  setThinkText(chatStream.thinking);
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: fullContent } : m
                  )
                );
              }
            } catch {
              // Malformed SSE chunk — skip
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== "AbortError") {
          failed = true;
          const errMsg = (err as Error)?.message?.trim()
            ? `抱歉，推理服务暂时无法响应。\n${(err as Error).message.trim()}`
            : "抱歉，推理服务暂时无法响应。\n请确认 vllm-hust-gateway 已正常启动。";
          setProcessSteps(
            createSteps({
              webSearch,
              stage: "error",
              resultCount,
              query: effectiveQuery,
              detail: errMsg,
            })
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: errMsg } : m
            )
          );
        } else {
          aborted = true;
          setProcessSteps(
            createSteps({
              webSearch,
              stage: "error",
              resultCount,
              query: effectiveQuery,
              detail: "已停止当前生成",
            })
          );
        }
      } finally {
        if (!failed) {
          fullContent = chatStream.visibleContent(
            aborted ? STOPPED_ASSISTANT_RESPONSE : undefined
          );
        }
        const finalContent = fullContent.trim();
        const ttft = firstTokenTs ? firstTokenTs - startTs : Date.now() - startTs;
        const words = finalContent.split(/\s+/).filter(Boolean).length;
        if (!failed && !aborted) {
          setProcessSteps(
            createSteps({
              webSearch,
              stage: "done",
              resultCount,
              query: effectiveQuery,
              detail: `${words} tokens · TTFT ${ttft}ms`,
            })
          );
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: fullContent || m.content, latencyMs: ttft, tokensUsed: words }
              : m
          )
        );
        setLoading(false);
        abortRef.current = null;
      }
    },
    [messages, model, webSearch, thinkingEnabled]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const handleClear = useCallback(() => setMessages([]), []);
  const displayedServiceStatus: ServiceProbeStatus = provenanceChecked && modelsChecked ? serviceStatus : "checking";
  const displayedModel = displayedServiceStatus === "online" ? model : "";

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden">
      <Header
        brandName={brandName}
        brandLogo={brandLogo}
        accentColor={accentColor}
        model={displayedModel}
        models={models}
        liveModelSwitchSupported={liveModelSwitchSupported}
        onModelChange={setModel}
        onOpenModelHub={() => setModelHubOpen(true)}
        onOpenAgentLab={() => setAgentLabOpen(true)}
        onOpenMetrics={() => setMetricsOpen(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        serviceStatus={displayedServiceStatus}
      />
      <main className="relative flex flex-1 min-w-0 overflow-hidden">
        <InferenceSidebar
          open={panelOpen}
          onToggle={() => setPanelOpen((prev) => !prev)}
          processSteps={processSteps}
          searchQuery={searchQuery}
          searchResults={searchResults}
          thinkText={thinkText}
        />
        <ChatPanel
          messages={messages}
          loading={loading}
          accentColor={accentColor}
          webSearch={webSearch}
          searchEnabled={searchEnabled}
          thinkingEnabled={thinkingEnabled}
          onSend={handleSend}
          onStop={handleStop}
          onClear={handleClear}
          onToggleWebSearch={handleToggleWebSearch}
          onToggleThinking={handleToggleThinking}
          onOpenInference={() => setPanelOpen(true)}
          onOpenMetrics={() => setMetricsOpen(true)}
          serviceStatus={displayedServiceStatus}
          model={displayedModel}
          hardware={hardware}
        />
        <MetricsDashboard
          snapshot={metrics}
          history={metricsHistory}
          accentColor={accentColor}
          model={displayedModel}
          models={models}
          liveModelSwitchSupported={liveModelSwitchSupported}
          serviceStatus={displayedServiceStatus}
          onModelChange={setModel}
          open={metricsOpen}
          onClose={() => setMetricsOpen(false)}
          runtimeProvenance={runtimeProvenance}
        />
      </main>
      <footer className="app-surface app-border relative flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t px-3 py-2 text-[11px] sm:text-xs">
        {(hardware.npu || hardware.cpu || hardware.memory) && (
          <div className="app-text-muted hidden items-center gap-3 font-mono sm:flex">
            {hardware.npu && <span>{hardware.npu}</span>}
            {hardware.cpu && <span>{hardware.cpu}</span>}
            {hardware.memory && <span>{hardware.memory}</span>}
          </div>
        )}
        {runtimeProvenance.available && runtimeProvenance.components && runtimeProvenance.image ? (
          <div className="app-text-muted flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="hidden sm:inline">运行来源</span>
            <a href={runtimeProvenance.components.core.commitUrl} target="_blank" rel="noopener noreferrer" className="app-text-secondary whitespace-nowrap hover:underline">
              core <code>{shortSha(runtimeProvenance.components.core.commit)}</code>
            </a>
            <a href={runtimeProvenance.components.plugin.commitUrl} target="_blank" rel="noopener noreferrer" className="app-text-secondary whitespace-nowrap hover:underline">
              plugin <code>{shortSha(runtimeProvenance.components.plugin.commit)}</code>
            </a>
            <details className="runtime-details" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
              <summary className="app-text-secondary cursor-pointer whitespace-nowrap">image {shortDigest(runtimeProvenance.image.digest)}</summary>
              <div className="app-card absolute bottom-[calc(100%+0.6rem)] right-3 z-50 max-h-[75vh] overflow-y-auto w-[min(44rem,calc(100vw-1.5rem))] rounded-xl p-4 text-left shadow-2xl">
                <p className="app-text text-sm font-semibold">运行来源 · 容器身份已核验</p>
                <p className="app-text-muted mt-2 text-xs leading-5">{runtimeProvenance.verification?.message}</p>
                <p className="app-text-muted mt-1 text-xs">源码为构建时冻结快照；通道名不代表当前 latest main。</p>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[7rem_1fr]">
                  <dt className="app-text-muted">容器</dt><dd className="app-text-secondary break-all">{runtimeProvenance.container?.name}</dd>
                  <dt className="app-text-muted">镜像</dt><dd className="app-text-secondary break-all">{runtimeProvenance.image.reference}</dd>
                  <dt className="app-text-muted">Image digest</dt><dd className="app-text-secondary break-all font-mono">{runtimeProvenance.image.digest}<br />{runtimeProvenance.image.digestKind === "image-config" ? "本地 image ID；非 registry manifest" : "registry manifest"}</dd>
                  <dt className="app-text-muted">稳定兼容基线</dt><dd className="app-text-secondary">{runtimeProvenance.compatibility?.stableRelease}</dd>
                  <dt className="app-text-muted">兼容说明</dt><dd className="app-text-secondary">{runtimeProvenance.compatibility?.base}</dd>
                  <dt className="app-text-muted">活跃源码通道</dt><dd className="app-text-secondary">{runtimeProvenance.compatibility?.sourceProfile}</dd>
                  <dt className="app-text-muted">构建时间</dt><dd className="app-text-secondary">{runtimeProvenance.image.createdAt}</dd>
                  <dt className="app-text-muted">Core SHA</dt><dd className="app-text-secondary break-all font-mono">{runtimeProvenance.components.core.commit}</dd>
                  <dt className="app-text-muted">Core source</dt><dd className="app-text-secondary break-all font-mono">{runtimeProvenance.components.core.version}</dd>
                  <dt className="app-text-muted">Core package</dt><dd className="app-text-secondary break-all font-mono">{runtimeProvenance.compatibility?.vllmPackage}</dd>
                  <dt className="app-text-muted">Plugin SHA</dt><dd className="app-text-secondary break-all font-mono">{runtimeProvenance.components.plugin.commit}</dd>
                  <dt className="app-text-muted">Plugin source</dt><dd className="app-text-secondary break-all font-mono">{runtimeProvenance.components.plugin.version}</dd>
                  <dt className="app-text-muted">Plugin package</dt><dd className="app-text-secondary break-all font-mono">{runtimeProvenance.compatibility?.vllmAscendPackage}</dd>
                  <dt className="app-text-muted">证据时间</dt><dd className="app-text-secondary">{runtimeProvenance.capturedAt}</dd>
                  <dt className="app-text-muted">身份核验时间</dt><dd className="app-text-secondary">{runtimeProvenance.verification?.checkedAt}</dd>
                </dl>
              </div>
            </details>
          </div>
        ) : (
          <span className="text-amber-300" role="status">运行来源未核验：{runtimeProvenance.reason || "正在读取凭据"}</span>
        )}
      </footer>
      <ModelHubModal
        open={modelHubOpen}
        currentModel={displayedModel}
        onClose={() => setModelHubOpen(false)}
      />
      <AgentLabModal
        open={agentLabOpen}
        currentModel={displayedModel}
        accentColor={accentColor}
        onClose={() => setAgentLabOpen(false)}
      />
    </div>
  );
}
