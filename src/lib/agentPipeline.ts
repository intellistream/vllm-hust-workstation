import { SERVER_CONFIG } from "@/lib/config";

export type AgentRole = "planner" | "benchmarker" | "diagnoser" | "optimizer";

export interface AgentLog {
  role: AgentRole;
  title: string;
  detail: string;
}

export interface BenchmarkScenario {
  name: string;
  prompt: string;
  maxTokens: number;
}

export interface ScenarioResult {
  name: string;
  runs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgTokensPerSecond: number;
}

export interface AgentRunReport {
  goal: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  logs: AgentLog[];
  scenarios: BenchmarkScenario[];
  results: ScenarioResult[];
  recommendations: string[];
}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type UpstreamChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  // Mixed zh/en approximation: keep it simple and deterministic.
  return Math.max(1, Math.round(trimmed.length / 4));
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx];
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/```$/, "").trim();
}

function parseScenarioJson(raw: string): BenchmarkScenario[] {
  try {
    const parsed = JSON.parse(stripCodeFence(raw)) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const scenarios: BenchmarkScenario[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as Record<string, unknown>;
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const prompt = typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
      const maxTokensRaw = typeof candidate.maxTokens === "number" ? candidate.maxTokens : 128;
      const maxTokens = Math.max(32, Math.min(1024, Math.round(maxTokensRaw)));
      if (!name || !prompt) {
        continue;
      }
      scenarios.push({ name, prompt, maxTokens });
    }
    return scenarios.slice(0, 3);
  } catch {
    return [];
  }
}

async function callUpstreamChat(params: {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
}): Promise<string> {
  const res = await fetch(`${SERVER_CONFIG.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVER_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens,
      temperature: 0.2,
      stream: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`upstream chat failed: ${res.status} ${detail}`);
  }

  const data = (await res.json()) as UpstreamChatResponse;
  return data.choices?.[0]?.message?.content?.trim() || "";
}

function defaultScenarios(goal: string): BenchmarkScenario[] {
  return [
    {
      name: "长上下文推理",
      prompt:
        `请阅读以下需求并给出结构化执行计划，要求至少 8 个步骤，覆盖输入约束、错误处理和性能注意事项。需求：${goal}`,
      maxTokens: 512,
    },
    {
      name: "工具调用风格输出",
      prompt:
        "请以 JSON 数组输出三个工具调用计划，每个元素包含 tool_name, reason, expected_latency_ms。",
      maxTokens: 256,
    },
    {
      name: "代码生成与解释",
      prompt:
        "请实现一个可流式处理日志窗口聚合的 Python 类，并解释复杂度与并发安全策略。",
      maxTokens: 384,
    },
  ];
}

function buildRecommendations(results: ScenarioResult[]): string[] {
  const recs: string[] = [];
  const worst = [...results].sort((a, b) => b.p95LatencyMs - a.p95LatencyMs)[0];
  const slow = results.filter((x) => x.avgLatencyMs > 2500).length;
  const lowTps = results.filter((x) => x.avgTokensPerSecond < 18).length;

  if (slow > 0) {
    recs.push(
      "优先压缩首 token 路径：检查 scheduler 入队与 prefill 阶段，减少不必要的 CPU<->设备同步，并开启更激进的连续批处理策略。"
    );
  }
  if (lowTps > 0) {
    recs.push(
      "吞吐偏低，建议针对 attention/paged-kv 相关路径做 profile，对比 eager 与图执行模式，并核查长上下文下的内存碎片。"
    );
  }
  if (worst) {
    recs.push(
      `场景「${worst.name}」p95 延迟最高，建议在 vllm-hust 中为该类请求增加独立压测模板和回归门槛。`
    );
  }
  if (recs.length === 0) {
    recs.push("当前基线较稳定，下一步建议扩大并发和上下文长度，继续观察尾延迟与吞吐退化拐点。");
  }
  return recs;
}

export async function runAgentPipeline(params: {
  goal: string;
  model: string;
  rounds: number;
}): Promise<AgentRunReport> {
  const startedAt = new Date().toISOString();
  const logs: AgentLog[] = [];

  logs.push({
    role: "planner",
    title: "规划实验场景",
    detail: "从 AGI4S 多智能体负载中抽取可复现实验任务。",
  });

  let scenarios = defaultScenarios(params.goal);

  try {
    const plannerRaw = await callUpstreamChat({
      model: params.model,
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content:
            "你是性能评测规划器。请输出 JSON 数组，每个元素字段: name, prompt, maxTokens。不要输出额外文字。",
        },
        {
          role: "user",
          content: `目标: ${params.goal}\n请给 3 个压力测试场景，覆盖长上下文、结构化输出、代码生成。`,
        },
      ],
    });

    const parsed = parseScenarioJson(plannerRaw);
    if (parsed.length > 0) {
      scenarios = parsed;
    }
  } catch {
    logs.push({
      role: "planner",
      title: "规划器降级",
      detail: "上游规划调用失败，已使用内置场景模板继续执行。",
    });
  }

  logs.push({
    role: "benchmarker",
    title: "执行基准回放",
    detail: `共 ${scenarios.length} 个场景，每个场景 ${params.rounds} 轮。`,
  });

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const latencies: number[] = [];
    const tpsList: number[] = [];

    for (let i = 0; i < params.rounds; i += 1) {
      const begin = performance.now();
      const text = await callUpstreamChat({
        model: params.model,
        maxTokens: scenario.maxTokens,
        messages: [{ role: "user", content: scenario.prompt }],
      });
      const elapsedMs = performance.now() - begin;
      latencies.push(elapsedMs);

      const tokens = estimateTokens(text);
      const tps = elapsedMs > 0 ? (tokens * 1000) / elapsedMs : 0;
      tpsList.push(tps);
    }

    const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const avgTokensPerSecond = tpsList.reduce((a, b) => a + b, 0) / tpsList.length;

    results.push({
      name: scenario.name,
      runs: latencies.length,
      avgLatencyMs,
      p95LatencyMs: percentile(latencies, 95),
      avgTokensPerSecond,
    });
  }

  logs.push({
    role: "diagnoser",
    title: "瓶颈归因",
    detail: "结合场景级延迟/吞吐输出规则化归因结论。",
  });

  const baseRecommendations = buildRecommendations(results);

  logs.push({
    role: "optimizer",
    title: "优化建议生成",
    detail: "把压测结论映射为 vllm-hust 可执行改造项。",
  });

  const recommendations = [...baseRecommendations];

  try {
    const optimizerText = await callUpstreamChat({
      model: params.model,
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content:
            "你是 vllm-hust 性能优化专家。根据输入指标给出最多 4 条可执行建议，每条一行，不要解释。",
        },
        {
          role: "user",
          content: `目标: ${params.goal}\n结果: ${JSON.stringify(results)}`,
        },
      ],
    });

    const extra = optimizerText
      .split(/\n+/)
      .map((x) => x.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 4);

    if (extra.length > 0) {
      recommendations.splice(0, recommendations.length, ...extra);
    }
  } catch {
    logs.push({
      role: "optimizer",
      title: "优化器降级",
      detail: "上游优化建议调用失败，已返回规则化建议。",
    });
  }

  return {
    goal: params.goal,
    model: params.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    logs,
    scenarios,
    results,
    recommendations,
  };
}
