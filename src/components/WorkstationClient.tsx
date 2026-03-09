"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import ChatPanel from "@/components/ChatPanel";
import MetricsDashboard from "@/components/MetricsDashboard";
import InferenceSidebar, { type ProcessStep } from "@/components/InferenceSidebar";
import ModelHubModal from "@/components/ModelHubModal";
import type { AppConfig, Message, MetricsSnapshot, SearchResult } from "@/types";

const METRICS_INTERVAL = 3000;
const HISTORY_MAX = 60;

type HistoryPoint = { time: number; tps: number; latency: number; gpu: number };

function parseThinkContent(raw: string): { think: string; main: string } {
  const open = raw.indexOf("<think>");
  if (open === -1) {
    return { think: "", main: raw };
  }
  const close = raw.indexOf("</think>", open);
  if (close === -1) {
    return { think: raw.slice(open + 7), main: raw.slice(0, open) };
  }
  return {
    think: raw.slice(open + 7, close),
    main: raw.slice(0, open) + raw.slice(close + 8),
  };
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
  const { brandName, brandLogo, accentColor, defaultModel, searchEnabled } = config;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>([defaultModel]);
  const [model, setModel] = useState(defaultModel);
  const [online, setOnline] = useState(false);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<HistoryPoint[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [processSteps, setProcessSteps] = useState<ProcessStep[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [thinkText, setThinkText] = useState("");
  const [modelHubOpen, setModelHubOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!searchEnabled) {
      return;
    }
    try {
      setWebSearch(window.localStorage.getItem("sagellm_web_search") === "1");
    } catch {
      // ignore localStorage errors
    }
  }, [searchEnabled]);

  // Load models list from gateway
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        const ids: string[] = (data?.data ?? []).map((m: { id: string }) => m.id);
        const merged = Array.from(new Set([...ids, defaultModel].filter(Boolean)));
        if (merged.length > 0) {
          setModels(merged);
          setModel((prev) => {
            if (prev && ids.includes(prev)) {
              return prev;
            }
            if (ids.length > 0) {
              return ids[0];
            }
            return merged.includes(prev) ? prev : merged[0];
          });
        }
        setOnline(Boolean(data?.upstreamAvailable));
      })
      .catch(() => setOnline(false));
  }, [defaultModel]);

  // Poll metrics
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/metrics");
        if (!res.ok) return;
        const snap: MetricsSnapshot = await res.json();
        setMetrics(snap);
        setOnline(Boolean(snap.gatewayAvailable));
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
        window.localStorage.setItem("sagellm_web_search", next ? "1" : "0");
      } catch {
        // ignore localStorage errors
      }
      return next;
    });
  }, [searchEnabled]);

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
      let rawContent = "";
      let streamThink = "";
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
          body: JSON.stringify({ messages: history, model, stream: true, web_search: webSearch }),
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
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const json = JSON.parse(data);
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

              const reasoningDelta = json.choices?.[0]?.delta?.reasoning_content ?? "";
              if (typeof reasoningDelta === "string" && reasoningDelta) {
                streamThink += reasoningDelta;
                setThinkText(streamThink);
              }

              const delta = json.choices?.[0]?.delta?.content ?? "";
              if (delta) {
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
                rawContent += delta;
                const parsed = parseThinkContent(rawContent);
                fullContent = parsed.main.trimStart() || parsed.main;
                if (parsed.think) {
                  setThinkText(parsed.think);
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
            : "抱歉，推理服务暂时无法响应。\n请确认 sagellm-gateway 已正常启动。";
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
    [messages, model, webSearch]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const handleClear = useCallback(() => setMessages([]), []);

  const handleActivateModel = useCallback((modelId: string) => {
    setModel(modelId);
    setModels((prev) => (prev.includes(modelId) ? prev : [modelId, ...prev]));
    setModelHubOpen(false);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        brandName={brandName}
        brandLogo={brandLogo}
        accentColor={accentColor}
        model={model}
        models={models}
        onModelChange={setModel}
        onOpenModelHub={() => setModelHubOpen(true)}
        online={online}
      />
      <main className="flex flex-1 overflow-hidden">
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
          onSend={handleSend}
          onStop={handleStop}
          onClear={handleClear}
          onToggleWebSearch={handleToggleWebSearch}
        />
        <MetricsDashboard
          snapshot={metrics}
          history={metricsHistory}
          accentColor={accentColor}
          model={model}
          models={models}
          online={online}
          onModelChange={setModel}
        />
      </main>
      <ModelHubModal
        open={modelHubOpen}
        currentModel={model}
        onClose={() => setModelHubOpen(false)}
        onActivate={handleActivateModel}
      />
    </div>
  );
}
