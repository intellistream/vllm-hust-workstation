"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import clsx from "clsx";
import type { AgentLog, BenchmarkScenario, ScenarioResult } from "@/lib/agentPipeline";

type AgentRunReport = {
  goal: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  logs: AgentLog[];
  scenarios: BenchmarkScenario[];
  results: ScenarioResult[];
  recommendations: string[];
};

interface AgentLabModalProps {
  open: boolean;
  currentModel: string;
  accentColor: string;
  onClose: () => void;
}

export default function AgentLabModal({
  open,
  currentModel,
  accentColor,
  onClose,
}: AgentLabModalProps) {
  const [goal, setGoal] = useState("针对多智能体 AGI4S 场景定位 vllm-hust 的尾延迟与吞吐瓶颈");
  const [rounds, setRounds] = useState(2);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<AgentRunReport | null>(null);

  const durationMs = useMemo(() => {
    if (!report) {
      return 0;
    }
    return new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  }, [report]);

  if (!open) {
    return null;
  }

  const runAgents = async () => {
    const text = goal.trim();
    if (!text || running) {
      return;
    }

    setRunning(true);
    setError("");

    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text, model: currentModel, rounds }),
      });

      const payload = (await res.json()) as AgentRunReport | { error?: string };
      if (!res.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : `HTTP ${res.status}`);
      }
      setReport(payload as AgentRunReport);
    } catch (e: unknown) {
      setError((e as Error)?.message || "multi-agent run failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col">
        <div
          className="px-5 py-4 border-b border-white/10 flex items-center justify-between"
          style={{ background: `linear-gradient(135deg, ${accentColor}24 0%, rgba(15,23,42,1) 100%)` }}
        >
          <div>
            <p className="text-white text-base font-semibold">Multi-Agent Optimization Lab</p>
            <p className="text-white/50 text-xs mt-1">Planner → Benchmarker → Diagnoser → Optimizer</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white/90 transition-colors text-sm"
          >
            关闭
          </button>
        </div>

        <div className="grid grid-cols-12 gap-0 min-h-0 flex-1">
          <section className="col-span-4 border-r border-white/10 p-5 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-white/70 text-xs mb-2 uppercase tracking-wider">优化目标</label>
              <textarea
                value={goal}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setGoal(e.target.value)}
                rows={6}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 text-white/90 text-sm p-3 focus:outline-none focus:border-white/30"
              />
            </div>

            <div>
              <label className="block text-white/70 text-xs mb-2 uppercase tracking-wider">每场景轮数</label>
              <input
                type="number"
                min={1}
                max={5}
                value={rounds}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setRounds(Math.max(1, Math.min(5, Number(e.target.value) || 1)))
                }
                className="w-full rounded-xl border border-white/10 bg-white/5 text-white/90 text-sm px-3 py-2 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60 leading-5">
              <p>当前模型：{currentModel}</p>
              <p>执行方式：调用本地 vllm-hust OpenAI 兼容接口，不依赖云端 orchestrator。</p>
            </div>

            {error && <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</div>}

            <button
              type="button"
              onClick={runAgents}
              disabled={running || !goal.trim()}
              className={clsx(
                "w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                running || !goal.trim()
                  ? "bg-white/10 text-white/40"
                  : "text-white"
              )}
              style={!running && goal.trim() ? { background: accentColor } : undefined}
            >
              {running ? "执行中..." : "运行多智能体实验"}
            </button>
          </section>

          <section className="col-span-8 p-5 overflow-y-auto space-y-5">
            {!report && !running && (
              <div className="h-full min-h-[360px] flex items-center justify-center text-center text-white/40 text-sm leading-7">
                运行后将在这里展示 agent 日志、场景指标和优化建议
              </div>
            )}

            {running && (
              <div className="rounded-xl border border-sky-400/25 bg-sky-400/10 px-4 py-3 text-sky-200 text-sm">
                正在执行多智能体链路，请稍候...
              </div>
            )}

            {report && (
              <>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
                  <p>目标：{report.goal}</p>
                  <p className="text-white/50 text-xs mt-1">
                    耗时 {(durationMs / 1000).toFixed(1)}s · 场景 {report.scenarios.length} 个
                  </p>
                </div>

                <section className="space-y-2">
                  <p className="text-white/70 text-xs uppercase tracking-wider">Agent 日志</p>
                  <div className="space-y-2">
                    {report.logs.map((log, idx) => (
                      <div key={`${log.role}-${idx}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                        <p className="text-sm text-white/85">[{log.role}] {log.title}</p>
                        <p className="text-xs text-white/45 mt-1">{log.detail}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-white/70 text-xs uppercase tracking-wider">场景结果</p>
                  <div className="rounded-xl border border-white/10 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-white/5 text-white/55">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">场景</th>
                          <th className="text-left px-3 py-2 font-medium">轮数</th>
                          <th className="text-left px-3 py-2 font-medium">平均延迟(ms)</th>
                          <th className="text-left px-3 py-2 font-medium">P95(ms)</th>
                          <th className="text-left px-3 py-2 font-medium">吞吐(tok/s)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.results.map((item) => (
                          <tr key={item.name} className="border-t border-white/10 text-white/85">
                            <td className="px-3 py-2">{item.name}</td>
                            <td className="px-3 py-2">{item.runs}</td>
                            <td className="px-3 py-2">{item.avgLatencyMs.toFixed(1)}</td>
                            <td className="px-3 py-2">{item.p95LatencyMs.toFixed(1)}</td>
                            <td className="px-3 py-2">{item.avgTokensPerSecond.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-white/70 text-xs uppercase tracking-wider">优化建议</p>
                  <div className="space-y-2">
                    {report.recommendations.map((item, idx) => (
                      <div key={`${idx}-${item}`} className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5 text-sm text-emerald-100">
                        {idx + 1}. {item}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
