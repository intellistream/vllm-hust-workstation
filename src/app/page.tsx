// Server Component — reads config server-side, passes to client
import { getAppConfig } from "@/lib/config";
import WorkstationClient from "@/components/WorkstationClient";

export default function Page() {
  const cfg = getAppConfig();
  return <WorkstationClient config={cfg} />;
}
const METRICS_INTERVAL = 3000; // ms
const HISTORY_MAX = 60;

type HistoryPoint = { time: number; tps: number; latency: number; gpu: number };

export default function WorkstationPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[]>(["default"]);
  const [model, setModel] = useState("default");
  const [online, setOnline] = useState(false);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<HistoryPoint[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  // Load models
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        const ids: string[] = (data?.data ?? []).map((m: { id: string }) => m.id);
        if (ids.length > 0) {
          setModels(ids);
          setModel(ids[0]);
          setOnline(true);
        }
      })
      .catch(() => setOnline(false));
  }, []);

  // Poll metrics
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/metrics");
        if (!res.ok) return;
        const snap: MetricsSnapshot = await res.json();
        setMetrics(snap);
        setOnline(true);
        setMetricsHistory((prev) => {
          const next = [
            ...prev,
            {
              time: Date.now(),
              tps: snap.tokensPerSecond,
              latency: snap.avgLatencyMs,
              gpu: snap.gpuUtilPct,
            },
          ];
          return next.slice(-HISTORY_MAX);
        });
      } catch {
        // ignore — metrics endpoint not available
      }
    };
    poll();
    const id = setInterval(poll, METRICS_INTERVAL);
    return () => clearInterval(id);
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
      let firstToken = true;
      let firstTokenTs = 0;

      // Placeholder assistant message for streaming
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", timestamp: Date.now() },
      ]);

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
          body: JSON.stringify({ messages: history, model, stream: true }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                if (firstToken) {
                  firstTokenTs = Date.now();
                  firstToken = false;
                }
                fullContent += delta;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: fullContent } : m
                  )
                );
              }
            } catch {
              // Malformed JSON chunk — skip
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== "AbortError") {
          const errMsg =
            "抱歉，推理服务暂时无法响应。请确认 sagellm-gateway 已启动。";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: errMsg } : m
            )
          );
        }
      } finally {
        const endTs = Date.now();
        const totalMs = endTs - startTs;
        const ttft = firstTokenTs ? firstTokenTs - startTs : totalMs;
        const words = fullContent.split(/\s+/).filter(Boolean).length;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: fullContent || m.content,
                  latencyMs: ttft,
                  tokensUsed: words,
                }
              : m
          )
        );
        setLoading(false);
        abortRef.current = null;
      }
    },
    [messages, model]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header
        brandName={BRAND}
        brandLogo={BRAND_LOGO}
        accentColor={ACCENT}
        model={model}
        models={models}
        onModelChange={setModel}
        online={online}
      />

      <main className="flex flex-1 overflow-hidden">
        <ChatPanel
          messages={messages}
          loading={loading}
          accentColor={ACCENT}
          onSend={handleSend}
          onStop={handleStop}
          onClear={handleClear}
        />
        <MetricsDashboard
          snapshot={metrics}
          history={metricsHistory}
          accentColor={ACCENT}
        />
      </main>
    </div>
  );
}
