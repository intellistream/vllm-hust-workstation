"use client";

import { ShieldCheck, Cpu, ChevronDown } from "lucide-react";

interface HeaderProps {
  brandName: string;
  brandLogo: string | null;
  accentColor: string;
  model: string;
  models: string[];
  onModelChange: (m: string) => void;
  online: boolean;
}

export default function Header({
  brandName,
  brandLogo,
  accentColor,
  model,
  models,
  onModelChange,
  online,
}: HeaderProps) {
  return (
    <header
      className="flex items-center justify-between px-6 py-3 border-b border-white/10"
      style={{ background: `linear-gradient(135deg, ${accentColor}22 0%, #0f172a 100%)` }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3">
        {brandLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brandLogo} alt="logo" className="h-8 w-auto" />
        ) : (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
            style={{ background: accentColor }}
          >
            AI
          </div>
        )}
        <span className="text-white font-semibold text-lg tracking-tight">
          {brandName}
        </span>
      </div>

      {/* Center badges */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-400/20">
          <ShieldCheck size={13} />
          数据不出境
        </span>
        <span className="flex items-center gap-1.5 text-sky-400 text-xs font-medium bg-sky-400/10 px-3 py-1.5 rounded-full border border-sky-400/20">
          <Cpu size={13} />
          国产算力
        </span>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border ${
            online
              ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
              : "text-red-400 bg-red-400/10 border-red-400/20"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${online ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`}
          />
          {online ? "在线" : "离线"}
        </span>
      </div>

      {/* Model selector */}
      <div className="relative">
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="appearance-none bg-white/5 border border-white/10 text-white text-sm px-4 py-2 pr-8 rounded-lg cursor-pointer focus:outline-none focus:border-white/30 hover:bg-white/10 transition-colors"
        >
          {models.map((m) => (
            <option key={m} value={m} className="bg-slate-800">
              {m}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
      </div>
    </header>
  );
}
