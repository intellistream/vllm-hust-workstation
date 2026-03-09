"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, PackageOpen, X } from "lucide-react";
import clsx from "clsx";
import type { ModelHubModel } from "@/types";

interface CatalogPayload {
  modelsDir: string;
  catalog: ModelHubModel[];
}

interface ModelHubModalProps {
  open: boolean;
  currentModel: string;
  onClose: () => void;
  onActivate: (modelId: string) => void;
}

export default function ModelHubModal({
  open,
  currentModel,
  onClose,
  onActivate,
}: ModelHubModalProps) {
  const [catalog, setCatalog] = useState<ModelHubModel[]>([]);
  const [modelsDir, setModelsDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/hub/catalog", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: CatalogPayload = await res.json();
      setCatalog(data.catalog || []);
      setModelsDir(data.modelsDir || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型库加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    setActionMessage("");
    void loadCatalog();
  }, [open, loadCatalog]);

  const hasDownloading = useMemo(
    () => catalog.some((item) => item.download?.status === "downloading"),
    [catalog]
  );

  useEffect(() => {
    if (!open || !hasDownloading) {
      return;
    }
    const id = window.setInterval(() => {
      void loadCatalog();
    }, 1500);
    return () => window.clearInterval(id);
  }, [open, hasDownloading, loadCatalog]);

  const startDownload = async (modelId: string) => {
    setActionMessage("");
    const res = await fetch(`/api/hub/download/${encodeURIComponent(modelId)}`, { method: "POST" });
    if (!res.ok) {
      const text = await res.text();
      setActionMessage(`启动下载失败：${text.slice(0, 160)}`);
      return;
    }
    const data = await res.json();
    setActionMessage(data.message === "started" ? "已开始下载，请等待进度刷新。" : "下载任务已存在，正在刷新状态。");
    await loadCatalog();
  };

  const cancelDownload = async (modelId: string) => {
    setActionMessage("");
    const res = await fetch(`/api/hub/download/${encodeURIComponent(modelId)}`, { method: "DELETE" });
    if (!res.ok) {
      setActionMessage("取消下载失败，请稍后重试。");
      return;
    }
    setActionMessage("已取消下载任务。");
    await loadCatalog();
  };

  const activateModel = async (modelId: string) => {
    setActionMessage("");
    const res = await fetch(`/api/hub/activate/${encodeURIComponent(modelId)}`, { method: "POST" });
    if (res.ok) {
      onActivate(modelId);
      setActionMessage(`已切换默认模型为 ${modelId}。重启 Gateway 后生效。`);
      await loadCatalog();
      return;
    }
    setActionMessage("设置当前模型失败，请稍后重试。");
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-6xl max-h-[88vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl shadow-black/40 flex flex-col">
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-white text-xl font-semibold">模型库</h2>
            <p className="text-white/40 text-sm mt-1">主流大模型目录 · 一键下载 · 下载后可设为当前模型</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl border border-white/10 text-white/50 hover:text-white hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-white/10 flex items-center justify-between text-sm">
          <div className="text-white/35 break-all">保存目录：{modelsDir || "—"}</div>
          <button
            type="button"
            onClick={() => void loadCatalog()}
            className="text-sky-300 hover:text-sky-200"
          >
            刷新列表
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading && catalog.length === 0 && (
            <div className="text-white/40 text-sm">正在加载模型库…</div>
          )}
          {error && (
            <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
          {actionMessage && (
            <div className="mb-4 rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-100 whitespace-pre-wrap">
              {actionMessage}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {catalog.map((item) => {
              const download = item.download;
              const isCurrent = item.id === currentModel || item.active;
              const isDownloading = download?.status === "downloading";
              const progress = download?.pct ?? 0;

              return (
                <article
                  key={item.id}
                  className={clsx(
                    "rounded-2xl border bg-white/[0.03] p-5",
                    isCurrent ? "border-sky-400/35" : "border-white/10"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-white text-lg font-semibold">{item.name}</h3>
                        <span className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/60">
                          {item.params}
                        </span>
                        {isCurrent && (
                          <span className="text-xs px-2 py-1 rounded-full bg-sky-400/15 border border-sky-400/20 text-sky-200">
                            当前模型
                          </span>
                        )}
                        {item.installed && !isCurrent && (
                          <span className="text-xs px-2 py-1 rounded-full bg-emerald-400/15 border border-emerald-400/20 text-emerald-200">
                            已下载
                          </span>
                        )}
                      </div>
                      <p className="text-white/40 text-xs mt-2">{item.repoId}</p>
                    </div>
                    <div className="text-right text-xs text-white/45 space-y-1">
                      <div>权重约 {item.sizeGb} GB</div>
                      <div>建议显存 {item.vramGb} GB</div>
                    </div>
                  </div>

                  <p className="mt-4 text-sm text-white/70 leading-6">{item.description}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2.5 py-1 rounded-full border"
                        style={{ borderColor: `${item.color}55`, color: item.color, background: `${item.color}15` }}
                      >
                        {tag}
                      </span>
                    ))}
                    {item.requiresAuth && (
                      <span className="text-xs px-2.5 py-1 rounded-full border border-amber-400/25 text-amber-200 bg-amber-400/10">
                        需要 HF_TOKEN
                      </span>
                    )}
                  </div>

                  {download?.status === "error" && download.error && (
                    <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100 whitespace-pre-wrap">
                      {download.error}
                    </div>
                  )}

                  {isDownloading && (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-white/45">
                        <span>{download.currentFile || "下载中…"}</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="text-xs text-white/35">
                        {download.speedMbps ? `${download.speedMbps} MB/s` : "等待速度统计"}
                      </div>
                    </div>
                  )}

                  <div className="mt-5 flex items-center gap-3">
                    {!item.installed && !isDownloading && (
                      <button
                        type="button"
                        onClick={() => void startDownload(item.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-sm"
                      >
                        <Download size={15} />
                        一键下载
                      </button>
                    )}

                    {isDownloading && (
                      <>
                        <button
                          type="button"
                          disabled
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/80 text-white text-sm cursor-default"
                        >
                          <LoaderCircle size={15} className="animate-spin" />
                          下载中
                        </button>
                        <button
                          type="button"
                          onClick={() => void cancelDownload(item.id)}
                          className="px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:bg-white/5 text-sm"
                        >
                          取消
                        </button>
                      </>
                    )}

                    {item.installed && !isCurrent && (
                      <button
                        type="button"
                        onClick={() => void activateModel(item.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm"
                      >
                        <PackageOpen size={15} />
                        设为当前
                      </button>
                    )}

                    {isCurrent && (
                      <div className="text-sm text-emerald-200">当前已选中该模型</div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}