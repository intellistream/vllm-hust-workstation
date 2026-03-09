"use client";

import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { Zap, Clock, Activity, HardDrive, Database, Server } from "lucide-react";
import type { MetricsSnapshot } from "@/types";

interface MetricsDashboardProps {
  snapshot: MetricsSnapshot | null;
  history: { time: number; tps: number; latency: number; gpu: number }[];
  accentColor: string;
  model: string;
  models: string[];
  online: boolean;
  onModelChange: (model: string) => void;
}

function StatCard({
  icon,
  label,
  value,
  unit,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/8 hover:bg-white/8 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg" style={{ background: `${color}20` }}>
          <div style={{ color }}>{icon}</div>
        </div>
        <span className="text-white/50 text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="flex items-end gap-1.5">
        <span className="text-white text-2xl font-bold tabular-nums leading-none">
          {value}
        </span>
        {unit && (
          <span className="text-white/40 text-sm pb-0.5">{unit}</span>
        )}
      </div>
      {sub && <p className="text-white/30 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function MiniChart({
  data,
  dataKey,
  color,
  label,
}: {
  data: { time: number; [key: string]: number }[];
  dataKey: string;
  color: string;
  label: string;
}) {
  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/8">
      <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-3">
        {label}
      </p>
      <ResponsiveContainer width="100%" height={60}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={["auto", "auto"]} hide />
          <Tooltip
            contentStyle={{
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "12px",
              padding: "4px 10px",
            }}
            formatter={(v: number) => [v.toFixed(1), label]}
            labelFormatter={() => ""}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#grad-${dataKey})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function GpuBar({ used, total, color }: { used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/8">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg" style={{ background: `${color}20` }}>
          <HardDrive size={14} style={{ color }} />
        </div>
        <span className="text-white/50 text-xs font-medium uppercase tracking-wider">
          显存占用
        </span>
      </div>
      <div className="flex justify-between items-end mb-2">
        <span className="text-white text-2xl font-bold tabular-nums">
          {used.toFixed(1)}
        </span>
        <span className="text-white/40 text-sm">/ {total.toFixed(0)} GB</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <p className="text-white/30 text-xs mt-1.5 text-right">{pct.toFixed(0)}%</p>
    </div>
  );
}

export default function MetricsDashboard({
  snapshot,
  history,
  accentColor,
  model,
  models,
  online,
  onModelChange,
}: MetricsDashboardProps) {
  const s = snapshot;

  return (
    <aside className="w-80 min-w-[280px] max-w-xs border-l border-white/10 flex flex-col overflow-y-auto bg-slate-900/50">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-white/70 text-xs font-semibold uppercase tracking-widest">
          实时监控
        </h2>
      </div>

      <div className="px-4 pb-4 flex flex-col gap-3">
        <div className="bg-white/5 rounded-xl p-4 border border-white/8 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-white/55 text-xs font-medium uppercase tracking-wider">
              模型选择
            </span>
            <span className={online ? "text-emerald-300 text-xs" : "text-red-300 text-xs"}>
              {online ? "在线可切换" : "离线兜底"}
            </span>
          </div>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="w-full appearance-none bg-slate-950/60 border border-white/10 text-white text-sm px-3 py-2 rounded-lg cursor-pointer focus:outline-none focus:border-white/30"
          >
            {models.map((item) => (
              <option key={item} value={item} className="bg-slate-900">
                {item}
              </option>
            ))}
          </select>
          <p className="text-white/30 text-xs leading-5">
            右侧保留模型切换入口，避免重构后只能在页头操作。
          </p>
        </div>

        {/* TPS + Latency */}
        <StatCard
          icon={<Zap size={14} />}
          label="吞吐率"
          value={s ? s.tokensPerSecond.toFixed(1) : "—"}
          unit="tok/s"
          color="#a78bfa"
        />
        <StatCard
          icon={<Clock size={14} />}
          label="平均延迟"
          value={s ? s.avgLatencyMs.toFixed(0) : "—"}
          unit="ms"
          sub="P50 首 token 延迟"
          color="#38bdf8"
        />
        <StatCard
          icon={<Activity size={14} />}
          label="GPU 利用率"
          value={s ? s.gpuUtilPct.toFixed(0) : "—"}
          unit="%"
          color="#34d399"
        />

        {/* GPU memory bar */}
        {s && (
          <GpuBar
            used={s.gpuMemUsedGb}
            total={s.gpuMemTotalGb}
            color={accentColor}
          />
        )}

        {/* Charts */}
        <MiniChart
          data={history}
          dataKey="tps"
          color="#a78bfa"
          label="吞吐率趋势 (tok/s)"
        />
        <MiniChart
          data={history}
          dataKey="latency"
          color="#38bdf8"
          label="延迟趋势 (ms)"
        />

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<Database size={14} />}
            label="已服务请求"
            value={s ? s.totalRequestsServed : "—"}
            color="#fb923c"
          />
          <StatCard
            icon={<Server size={14} />}
            label="排队中"
            value={s ? s.pendingRequests : "—"}
            color="#f472b6"
          />
        </div>

        {/* Model info */}
        {s && (
          <div className="bg-white/5 rounded-xl p-4 border border-white/8 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-white/40">模型</span>
              <span className="text-white/80 font-mono truncate max-w-[140px]">
                {s.modelName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">后端</span>
              <span className="text-emerald-400 font-medium">{s.backendType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">运行时长</span>
              <span className="text-white/80">
                {Math.floor(s.uptimeSeconds / 3600)}h{" "}
                {Math.floor((s.uptimeSeconds % 3600) / 60)}m
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
