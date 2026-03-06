"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import {
  Send,
  Paperclip,
  Bot,
  User,
  Square,
  RotateCcw,
  Copy,
  CheckCheck,
} from "lucide-react";
import type { Message } from "@/types";
import clsx from "clsx";

interface ChatPanelProps {
  messages: Message[];
  loading: boolean;
  accentColor: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-white/70 ml-2"
    >
      {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
    </button>
  );
}

function MessageBubble({ msg, accentColor }: { msg: Message; accentColor: string }) {
  const isUser = msg.role === "user";
  return (
    <div
      className={clsx(
        "flex gap-3 animate-slide-up",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div
        className={clsx(
          "w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5",
          isUser ? "bg-white/10" : "rounded-lg"
        )}
        style={!isUser ? { background: `${accentColor}30` } : undefined}
      >
        {isUser ? (
          <User size={16} className="text-white/70" />
        ) : (
          <Bot size={16} style={{ color: accentColor }} />
        )}
      </div>

      <div
        className={clsx(
          "group max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-white/10 text-white/90 rounded-tr-sm"
            : "bg-white/5 text-white/85 rounded-tl-sm border border-white/8"
        )}
      >
        {/* Render content — basic markdown-lite: code blocks */}
        <FormattedContent content={msg.content} />

        <div
          className={clsx(
            "flex items-center gap-2 mt-1.5 text-[11px] text-white/25",
            isUser ? "justify-end" : "justify-start"
          )}
        >
          <span>
            {new Date(msg.timestamp).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {msg.tokensUsed && <span>{msg.tokensUsed} tokens</span>}
          {msg.latencyMs && <span>{msg.latencyMs}ms</span>}
          {!isUser && <CopyButton text={msg.content} />}
        </div>
      </div>
    </div>
  );
}

// Minimal content formatter: handles ```code``` blocks + inline `code`
function FormattedContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return (
    <div className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const code = part.slice(3, -3).replace(/^\w+\n/, "");
          return (
            <pre
              key={i}
              className="my-2 p-3 bg-black/30 rounded-lg text-xs font-mono overflow-x-auto text-emerald-300"
            >
              {code}
            </pre>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="px-1.5 py-0.5 bg-black/30 rounded text-xs font-mono text-amber-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

export default function ChatPanel({
  messages,
  loading,
  accentColor,
  onSend,
  onStop,
  onClear,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    onSend(text);
  }, [input, loading, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-20">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
              style={{ background: `${accentColor}20` }}
            >
              <Bot size={32} style={{ color: accentColor }} />
            </div>
            <div>
              <p className="text-white/60 text-sm">私有 AI 工作站已就绪</p>
              <p className="text-white/30 text-xs mt-1">所有对话均在本地推理，数据不出境</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {[
                "帮我写一份项目立项报告",
                "用 Python 实现快速排序",
                "分析这段数据的趋势",
                "总结以下文档内容",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-xs rounded-full border border-white/8 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} accentColor={accentColor} />
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex gap-3 animate-fade-in">
            <div
              className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
              style={{ background: `${accentColor}30` }}
            >
              <Bot size={16} style={{ color: accentColor }} />
            </div>
            <div className="flex items-center gap-1.5 px-4 py-3 bg-white/5 rounded-2xl rounded-tl-sm border border-white/8">
              <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 pb-6 pt-2 border-t border-white/8">
        <div className="flex items-end gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 focus-within:border-white/20 transition-colors">
          <button className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 mb-0.5">
            <Paperclip size={18} />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
            rows={1}
            className="flex-1 bg-transparent text-white/90 text-sm placeholder-white/25 resize-none focus:outline-none leading-relaxed"
            style={{ minHeight: "24px", maxHeight: "180px" }}
          />
          <div className="flex items-center gap-2 flex-shrink-0 mb-0.5">
            {messages.length > 0 && (
              <button
                onClick={onClear}
                className="text-white/25 hover:text-white/60 transition-colors"
                title="清空对话"
              >
                <RotateCcw size={16} />
              </button>
            )}
            <button
              onClick={loading ? onStop : handleSend}
              disabled={!loading && !input.trim()}
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-30"
              style={
                loading || input.trim()
                  ? { background: accentColor }
                  : { background: "rgba(255,255,255,0.1)" }
              }
            >
              {loading ? (
                <Square size={14} className="text-white" />
              ) : (
                <Send size={14} className="text-white" />
              )}
            </button>
          </div>
        </div>
        <p className="text-center text-white/15 text-xs mt-2">
          本地私有推理 · 端到端加密 · 零数据上报
        </p>
      </div>
    </div>
  );
}
