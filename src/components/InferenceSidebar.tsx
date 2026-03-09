"use client";

import clsx from "clsx";
import type { SearchResult } from "@/types";

export interface ProcessStep {
  id: string;
  icon: string;
  label: string;
  state: "pending" | "active" | "done" | "error";
  detail?: string;
}

interface InferenceSidebarProps {
  open: boolean;
  onToggle: () => void;
  processSteps: ProcessStep[];
  searchQuery: string;
  searchResults: SearchResult[];
  thinkText: string;
}

function statusClass(state: ProcessStep["state"]) {
  switch (state) {
    case "active":
      return "border-sky-400/30 bg-sky-400/10 text-sky-200";
    case "done":
      return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
    case "error":
      return "border-red-400/25 bg-red-400/10 text-red-200";
    default:
      return "border-white/10 bg-white/5 text-white/60";
  }
}

export default function InferenceSidebar({
  open,
  onToggle,
  processSteps,
  searchQuery,
  searchResults,
  thinkText,
}: InferenceSidebarProps) {
  const hasContent = processSteps.length > 0 || searchResults.length > 0 || Boolean(thinkText.trim());

  return (
    <aside
      className={clsx(
        "border-r border-white/10 bg-slate-950/60 transition-all duration-300 ease-out overflow-hidden flex-shrink-0",
        open ? "w-80 min-w-[320px]" : "w-12"
      )}
    >
      <div className="h-full flex">
        <button
          type="button"
          onClick={onToggle}
          className="w-12 border-r border-white/10 flex flex-col items-center justify-center gap-2 text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          title={open ? "收起推理面板" : "展开推理面板"}
        >
          <span className="text-base">🔭</span>
          <span className="text-[11px] tracking-widest [writing-mode:vertical-rl]">
            推理
          </span>
        </button>

        {open && (
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-white/85 text-sm font-semibold">推理过程</p>
                <p className="text-white/35 text-xs mt-1">处理流程 / 搜索来源 / 思考过程</p>
              </div>
              <button
                type="button"
                onClick={onToggle}
                className="text-white/35 hover:text-white/70 transition-colors"
                title="收起"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {!hasContent && (
                <div className="h-full min-h-[240px] flex items-center justify-center text-center text-white/35 text-sm leading-7">
                  <div>
                    发送消息后
                    <br />
                    这里会显示推理过程
                  </div>
                </div>
              )}

              {processSteps.length > 0 && (
                <section className="space-y-3">
                  <div className="text-xs font-semibold tracking-widest text-white/55 uppercase">
                    ⚙️ 处理流程
                  </div>
                  <div className="space-y-2">
                    {processSteps.map((step) => (
                      <div
                        key={step.id}
                        className={clsx(
                          "rounded-xl border px-3 py-2.5 transition-colors",
                          statusClass(step.state)
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-sm leading-5">{step.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm leading-5">{step.label}</div>
                            {step.detail && (
                              <div className="text-xs mt-1 opacity-75 break-words">{step.detail}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {searchResults.length > 0 && (
                <section className="space-y-3">
                  <div className="text-xs font-semibold tracking-widest text-white/55 uppercase">
                    🌐 搜索来源
                  </div>
                  {searchQuery && (
                    <div className="rounded-lg bg-white/5 border border-white/8 px-3 py-2 text-xs text-white/45 break-words">
                      “{searchQuery}”
                    </div>
                  )}
                  <div className="space-y-2.5">
                    {searchResults.map((result, index) => (
                      <article
                        key={`${result.url}-${index}`}
                        className="rounded-xl border border-white/8 bg-white/5 px-3 py-3"
                      >
                        <div className="text-sm text-white/85 leading-5">
                          <span className="text-sky-300 mr-2">[{index + 1}]</span>
                          {result.title}
                        </div>
                        {result.snippet && (
                          <p className="mt-2 text-xs text-white/50 leading-5 whitespace-pre-wrap break-words">
                            {result.snippet}
                          </p>
                        )}
                        {result.url && (
                          <a
                            href={result.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 block text-xs text-sky-300/90 break-all hover:text-sky-200"
                          >
                            {result.url}
                          </a>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {thinkText.trim() && (
                <section className="space-y-3">
                  <div className="text-xs font-semibold tracking-widest text-white/55 uppercase">
                    💭 思考过程
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-3 text-sm text-white/75 leading-6 whitespace-pre-wrap break-words max-h-[360px] overflow-y-auto">
                    {thinkText.trim()}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}