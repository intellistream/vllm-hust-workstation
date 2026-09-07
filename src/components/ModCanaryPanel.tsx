"use client";

import { useCallback, useEffect, useState } from "react";
import type { CanaryLifecycleAction, CanaryLifecycleStatus } from "@/lib/hostBrokerClient";
import { useDialogFocus } from "./useDialogFocus";

export default function ModCanaryPanel({ token, onAuthorizationExpired }: {
  token: string; onAuthorizationExpired: () => void;
}) {
  const [status, setStatus] = useState<CanaryLifecycleStatus | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [action, setAction] = useState<CanaryLifecycleAction | null>(null);
  const [password, setPassword] = useState("");
  const close = useCallback(() => { if (!pending) { setAction(null); setPassword(""); } }, [pending]);
  const dialogRef = useDialogFocus(Boolean(action), close);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/mod-canary", { cache: "no-store", headers: { "X-Workstation-Admin-Token": token } });
      const body = await response.json();
      if (response.status === 401) { onAuthorizationExpired(); throw new Error("管理员权限已失效，请重新登录。"); }
      if (!response.ok) throw new Error(body.error || "自检状态暂不可用。");
      setStatus(body); setError("");
    } catch (reason) { setStatus(null); setError(reason instanceof Error ? reason.message : "自检状态暂不可用。"); }
  }, [token, onAuthorizationExpired]);
  useEffect(() => { void load(); }, [load]);
  const available = Boolean(status?.available && status.registered && status.controllerStatus === "ready" && !pending);
  const run = async () => {
    if (!action || !available || !password.trim()) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/mod-canary", { method: "POST", headers: { "Content-Type": "application/json", "X-Workstation-Admin-Token": token },
        body: JSON.stringify({ action, targetId: "inert-canary", modId: "lifecycle-self-test", confirmation: password.trim() }) });
      const body = await response.json();
      if (response.status === 401) { onAuthorizationExpired(); throw new Error("管理员二次确认失败，请重新登录。"); }
      if (!response.ok) throw new Error(body.error || "生命周期自检未完成。");
      setStatus(body); setAction(null); setPassword("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "生命周期自检未完成。"); }
    finally { setPending(false); }
  };
  return <section aria-label="生命周期自检 canary" className="app-surface-muted mt-4 rounded-xl border app-border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-medium">生命周期自检</p><p className="app-text-muted mt-1 text-xs leading-5">CPU 隔离 canary · 只验证审批、一次性授权、Owner 执行与回滚链路，不安装或启用 Mod。</p></div>
      <span className="app-text-secondary text-xs">{status?.available ? status.state === "running" ? "自检进程运行中" : "自检进程已停止" : "受控窗口未开放"}</span>
    </div>
    <dl className="app-text-muted mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div><dt>目标</dt><dd>inert-canary</dd></div><div><dt>Generation</dt><dd>{status?.generation ?? "—"}</dd></div>
      <div><dt>健康证明</dt><dd>{status?.healthy ? "PID / start-ticks 已核验" : "—"}</dd></div><div><dt>Mod 生效</dt><dd>否</dd></div>
    </dl>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="app-control rounded-lg border px-4 py-2 text-sm" disabled={!available || status?.state !== "stopped"} onClick={() => setAction("start")}>启动自检</button>
      <button type="button" className="app-control rounded-lg border px-4 py-2 text-sm" disabled={!available || status?.state !== "running"} onClick={() => setAction("stop")}>停止自检</button>
      <button type="button" className="app-control rounded-lg border px-4 py-2 text-sm" disabled={!available || status?.state !== "running"} onClick={() => setAction("restart")}>重启自检</button>
      <button type="button" className="app-control rounded-lg border px-4 py-2 text-sm" disabled={!available || status?.state !== "running"} onClick={() => setAction("rollback")}>回滚到停止态</button>
      <button type="button" className="app-control rounded-lg border px-4 py-2 text-sm" disabled={pending} onClick={() => void load()}>刷新自检</button>
    </div>
    {status?.replayRejected && <p role="status" className="mt-3 text-xs" style={{ color: "var(--success)" }}>操作已提交，旧授权重放已拒绝。</p>}
    {error && <p role="alert" className="mt-3 text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    {action && <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--overlay)" }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="生命周期自检确认" tabIndex={-1} className="app-surface-raised w-full max-w-lg rounded-xl border app-border p-5">
        <h2 className="font-medium">确认{{ start: "启动", stop: "停止", restart: "重启", rollback: "回滚" }[action]} CPU 生命周期自检</h2>
        <p className="app-text-secondary mt-3 text-sm leading-6">仅操作固定 inert-canary，不连接模型、容器、推理服务或 NPU。授权绑定本次 operation 与 generation，使用一次后失效。</p>
        <label className="app-text-secondary mt-4 block text-sm">再次输入管理员密码<input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} className="app-control mt-2 block w-full rounded-lg border px-3 py-2" /></label>
        <div className="mt-4 flex gap-3"><button type="button" className="app-control rounded-lg border px-4 py-2 text-sm" disabled={!available || !password.trim()} onClick={() => void run()}>{pending ? "执行中…" : "确认自检"}</button><button type="button" className="app-control rounded-lg border px-4 py-2 text-sm" disabled={pending} onClick={close}>取消</button></div>
      </section>
    </div>}
  </section>;
}
