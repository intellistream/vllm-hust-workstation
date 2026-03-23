import { NextRequest } from "next/server";
import { runAgentPipeline } from "@/lib/agentPipeline";
import { DEFAULT_MODEL_ID } from "@/lib/config";
import { recordApiRequest } from "@/lib/metrics";

export const runtime = "nodejs";

type AgentRunRequest = {
  goal?: string;
  model?: string;
  rounds?: number;
};

export async function POST(req: NextRequest) {
  const start = performance.now();

  try {
    const body = (await req.json()) as AgentRunRequest;
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL_ID;
    const roundsRaw = typeof body.rounds === "number" ? body.rounds : 2;
    const rounds = Math.max(1, Math.min(5, Math.floor(roundsRaw)));

    if (!goal) {
      recordApiRequest("/api/agents/run", "POST", 400, (performance.now() - start) / 1000);
      return Response.json({ error: "goal 不能为空" }, { status: 400 });
    }

    const report = await runAgentPipeline({ goal, model, rounds });
    recordApiRequest("/api/agents/run", "POST", 200, (performance.now() - start) / 1000);
    return Response.json(report);
  } catch (error: unknown) {
    const detail = (error as Error)?.message || "unknown error";
    recordApiRequest("/api/agents/run", "POST", 500, (performance.now() - start) / 1000);
    return Response.json({ error: `multi-agent run failed: ${detail}` }, { status: 500 });
  }
}
