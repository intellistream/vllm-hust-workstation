import { hasValidAdminToken, requireAdmin } from "@/lib/adminAuth";
import { ModError } from "@/lib/modStore";
import { getModRuntime, startRuntimePreparation } from "@/lib/modRuntimeStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (request.headers.has("x-workstation-admin-token") && !hasValidAdminToken(request)) return requireAdmin(request)!;
  try { return Response.json(await getModRuntime(hasValidAdminToken(request)), { headers }); }
  catch { return Response.json({ error: "实例状态读取失败，请检查部署登记或稍后刷新。" }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 2048) throw new ModError("请求过大。", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new ModError("请求不是有效 JSON。", 400); }
    if (!body || typeof body.targetId !== "string" || typeof body.modId !== "string" || typeof body.action !== "string") throw new ModError("仅允许实例、Mod 和操作 ID。", 400);
    if (["apply", "disable", "rollback", "start", "stop", "restart"].includes(body.action)) throw new ModError("当前实例尚未接入经验证的计划、一次性审批与 owner fencing；运行操作不可用。", 409);
    if (Object.keys(body).sort().join() !== "action,modId,riskAcknowledged,targetId" || body.riskAcknowledged !== true) throw new ModError("准备操作需要显式确认已测性能风险。", 400);
    if (body.action !== "prepare") throw new ModError("不支持的实例操作。", 400);
    return Response.json(await startRuntimePreparation(body.targetId, body.modId, body.riskAcknowledged), { status: 202, headers });
  } catch (error) { return Response.json({ error: error instanceof ModError ? error.message : "实例准备未提交，请检查部署配置。" }, { status: error instanceof ModError ? error.status : 503, headers }); }
}
