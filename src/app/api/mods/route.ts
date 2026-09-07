import { getModCatalog, ModError, startModAction } from "@/lib/modStore";
import { hasValidAdminToken, requireAdmin } from "@/lib/adminAuth";
import type { ModAction } from "@/lib/modCatalog";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  if (request.headers.has("x-workstation-admin-token") && !hasValidAdminToken(request)) return requireAdmin(request)!;
  try { return Response.json(await getModCatalog(hasValidAdminToken(request)), { headers }); }
  catch { return Response.json({ error: "Mod 状态读取失败，请稍后刷新。" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 20_000) throw new ModError("请求过大。", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new ModError("请求不是有效 JSON。", 400); }
    if (!body || typeof body.id !== "string" || typeof body.action !== "string") throw new ModError("缺少 Mod 或操作。", 400);
    return Response.json(await startModAction(body.id, body.action as ModAction, body.configuration, body.riskAcknowledged === true), { status: 202, headers });
  } catch (error) { return Response.json({ error: error instanceof ModError ? error.message : "Mod 操作未完成，请检查存储或执行器配置。" }, { status: error instanceof ModError ? error.status : 503, headers }); }
}
