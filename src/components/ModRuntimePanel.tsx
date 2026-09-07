"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MOD_CATALOG } from "@/lib/modCatalog";
import type { ModRuntimePayload } from "@/lib/modRuntimeTypes";
import { useDialogFocus } from "./useDialogFocus";
import ModCanaryPanel from "./ModCanaryPanel";

const phases: Record<string, string> = { queued: "排队中", preparing: "准备中", prepared: "已准备 · 未应用", superseded: "目标已变化", failed: "准备失败", interrupted: "执行中断 · 待核查" };

export default function ModRuntimePanel({ token, onAuthorizationExpired, onLibraryChanged }: {
  token: string; onAuthorizationExpired: () => void; onLibraryChanged: () => void;
}) {
  const [data, setData] = useState<ModRuntimePayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [modId, setModId] = useState("diffspec");
  const [confirmation, setConfirmation] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const epoch = useRef(0);
  const invalidate = useCallback(() => { ++epoch.current; }, []);
  const completed = useRef(new Set<string>());
  const closeConfirmation = useCallback(() => { if (!pending) { setConfirmation(false); setRiskAcknowledged(false); } }, [pending]);
  const dialogRef = useDialogFocus(confirmation, closeConfirmation);
  const load = useCallback(async () => {
    const current = ++epoch.current;
    setLoading(true);
    try {
      const response = await fetch("/api/mod-runtime", { cache: "no-store", headers: token ? { "X-Workstation-Admin-Token": token } : {} });
      const body = await response.json();
      if (current !== epoch.current) return;
      if (response.status === 401) { onAuthorizationExpired(); throw new Error("管理员权限已失效，请重新登录。"); }
      if (!response.ok) throw new Error(body.error || "实例状态暂不可用。");
      setData(body); setError("");
      if ((body as ModRuntimePayload).tasks.some(task => task.status === "prepared" && !completed.current.has(task.id))) onLibraryChanged();
      for (const task of (body as ModRuntimePayload).tasks) if (task.status === "prepared") completed.current.add(task.id);
    } catch (err) {
      if (current === epoch.current) { setData(null); setError(err instanceof Error ? err.message : "实例状态暂不可用。"); }
    } finally { if (current === epoch.current) setLoading(false); }
  }, [token, onAuthorizationExpired, onLibraryChanged]);
  useEffect(() => {
    setData(null); setConfirmation(false); setRiskAcknowledged(false);
    void load();
    return invalidate;
  }, [load, invalidate]);
  const busy = Boolean(data?.tasks.some(task => ["queued", "preparing"].includes(task.status)));
  const recoveryRequired = Boolean(data?.tasks.some(task => task.status === "interrupted"));
  useEffect(() => {
    if (!busy || pending) return;
    const timer = window.setInterval(() => { void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [busy, pending, load]);
  const administrator = Boolean(token && data?.administrator);
  const target = data?.target;
  const canPrepare = Boolean(administrator && target && data?.preparationAvailable && !busy && !recoveryRequired && !pending && !loading);
  const candidateCompatibility = data?.mods?.find(item => item.id === modId)?.targetArtifactCompatibility?.status || "unknown";
  const mod = MOD_CATALOG.find(item => item.id === modId)!;
  const prepare = async () => {
    if (!canPrepare || !target || !riskAcknowledged) return;
    const current = epoch.current;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/mod-runtime", { method: "POST", headers: { "Content-Type": "application/json", "X-Workstation-Admin-Token": token }, body: JSON.stringify({ action: "prepare", targetId: target.id, modId, riskAcknowledged: true }) });
      const body = await response.json();
      if (current !== epoch.current) return;
      if (response.status === 401) { onAuthorizationExpired(); throw new Error("管理员权限已失效，请重新登录。"); }
      if (!response.ok) throw new Error(body.error || "准备任务未提交。");
      setConfirmation(false); await load();
    } catch (err) { if (current === epoch.current) setError(err instanceof Error ? err.message : "准备任务未提交。"); }
    finally { setPending(false); }
  };
  return <section aria-label="推理实例" className="app-surface rounded-2xl border app-border p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="app-text-muted text-xs">目标实例</p><h2 className="mt-2 text-lg font-semibold">{target?.label || "推理实例"}</h2></div>
      <button type="button" onClick={() => void load()} disabled={loading || pending} className="app-control rounded-lg border px-3 py-2 text-sm">刷新实例</button>
    </div>
    {loading && !data && <p role="status" className="app-text-muted mt-3 text-sm">正在核验实例…</p>}
    {error && <p role="alert" className="mt-3 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    {data && !target && <p className="app-text-secondary mt-3 text-sm">{data.message}</p>}
    {target && <>
      <div className="app-text-secondary mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <span>{target.ownership === "shared" ? "共享实例" : "独立实例"}</span>
        <span>{target.identityVerified ? "容器身份已核验" : "容器身份待核验"}</span>
        <span>生效 Mod：待核验</span>
      </div>
      <p className="app-text-muted mt-2 break-words text-sm">{target.models.length ? target.models.join(" · ") : "模型列表暂不可用"}</p>
      {target.identityVerified && <details className="mt-3 text-xs"><summary className="app-text-secondary cursor-pointer py-2">运行版本</summary>
        <dl className="app-text-muted mt-2 space-y-2 break-all"><div><dt>镜像 ID</dt><dd>{target.imageId}</dd></div><div><dt>Core / Ascend SHA</dt><dd>{target.coreSha} / {target.pluginSha}</dd></div></dl>
      </details>}
      {administrator && <div className="mt-4 border-t app-border pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-full min-w-0 text-sm app-text-secondary sm:w-auto sm:flex-1">目标 Mod<select aria-label="选择实例 Mod" className="app-control mt-2 block w-full rounded-lg border px-3 py-2" value={modId} disabled={pending || busy} onChange={event => setModId(event.target.value)}>{MOD_CATALOG.filter(item => item.sha).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button type="button" className="app-control rounded-lg border px-4 py-2 text-sm" disabled={!canPrepare} onClick={() => setConfirmation(true)}>{recoveryRequired ? "中断任务待核查" : busy ? "准备任务执行中" : "准备运行镜像"}</button>
        </div>
        <div className="mt-4 rounded-xl app-surface-muted p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">运行接管</p><p className="app-text-muted mt-1 text-xs">{data.lifecycle.reason}</p></div><span className="app-text-secondary text-xs">候选资格：{candidateCompatibility === "compatible" ? "可部署" : candidateCompatibility === "incompatible" ? "不兼容" : candidateCompatibility === "not-applicable" ? "不适用" : "待核验"}</span></div>
          <dl className="app-text-muted mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div><dt>实例身份</dt><dd>{data.lifecycle.identityLive ? "live" : "待核验"}</dd></div><div><dt>Owner 登记</dt><dd>{data.lifecycle.instanceRegistered ? "已登记" : "未登记"}</dd></div><div><dt>回滚基线</dt><dd>{data.lifecycle.rollbackReady ? "就绪" : "待核验"}</dd></div><div><dt>一次性授权</dt><dd>{data.lifecycle.oneUseAuthorization ? "就绪" : "未签发"}</dd></div></dl>
          {!data.applicationAvailable && <p className="app-text-muted mt-3 text-xs leading-5">当前只开放候选镜像准备；接管协议未完整验收前不显示应用、停用或回滚按钮。</p>}
        </div>
        <p className="app-text-muted mt-3 text-xs leading-5">{data.message}</p>
      </div>}
      {administrator && data.tasks.length > 0 && <div className="mt-4 space-y-2" aria-label="实例准备任务">{data.tasks.map(task => <details key={task.id} className="app-surface-muted rounded-lg p-3 text-xs" open={task.status === "preparing" || task.status === "failed"}>
        <summary className="app-text-secondary cursor-pointer py-1">{MOD_CATALOG.find(item => item.id === task.modId)?.name || task.modId} · {phases[task.status]}<span className="app-text-muted ml-2">{new Date(task.createdAt).toLocaleString()}</span></summary>
        {task.imageId && <p className="app-text-muted mt-2 break-all">候选镜像 {task.imageId}</p>}
        <pre className="app-text-secondary mt-2 whitespace-pre-wrap break-words leading-5">{task.logs.join("\n")}</pre>
      </details>)}</div>}
      {administrator && <ModCanaryPanel token={token} onAuthorizationExpired={onAuthorizationExpired} />}
    </>}
    {confirmation && administrator && target && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--overlay)" }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="准备运行镜像确认" tabIndex={-1} className="app-surface-raised max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border app-border p-5">
        <h2 className="font-medium">准备 {mod.name} · {target.label}</h2>
        <p className="app-text-secondary mt-3 text-sm leading-6">获取固定版本制品，并基于此实例的镜像构建运行环境。可能占用数 GiB 磁盘；不会切换模型或重启实例。</p>
        <p className="mt-3 rounded-lg border p-3 text-sm leading-6 text-amber-300" style={{ borderColor: "var(--warning)" }}>已测性能风险：{mod.effectiveness.detail}</p>
        <label className="app-text-secondary mt-4 flex items-start gap-3 text-sm leading-5"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={riskAcknowledged} onChange={event => setRiskAcknowledged(event.target.checked)} />我理解该测试单元性能退化，且准备镜像不代表生产应用。</label>
        <div className="mt-4 flex flex-wrap gap-3"><button type="button" className="app-control w-full rounded-lg border px-4 py-2 text-sm sm:w-auto" disabled={!canPrepare || !riskAcknowledged} onClick={() => void prepare()}>{pending ? "提交中…" : "确认准备"}</button><button type="button" className="app-control w-full rounded-lg border px-4 py-2 text-sm sm:w-auto" disabled={pending} onClick={closeConfirmation}>取消</button></div>
      </section>
    </div>}
  </section>;
}
