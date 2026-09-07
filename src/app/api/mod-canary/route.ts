import { hasValidAdminCredential, requireAdmin } from "@/lib/adminAuth";
import { describeCanaryTarget, runCanaryLifecycle } from "@/lib/hostBrokerClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  return Response.json(await describeCanaryTarget(), { headers });
}

export async function POST(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return Response.json({ error: "请求过大。" }, { status: 413, headers });
    const body = JSON.parse(raw);
    if (!body || Object.keys(body).sort().join() !== "action,confirmation,modId,targetId" ||
        !["start", "stop", "restart", "rollback"].includes(body.action) || body.targetId !== "inert-canary" ||
        body.modId !== "lifecycle-self-test" || typeof body.confirmation !== "string") {
      return Response.json({ error: "仅允许固定生命周期自检目标。" }, { status: 400, headers });
    }
    if (!hasValidAdminCredential(body.confirmation)) return Response.json({ error: "管理员二次确认失败。" }, { status: 401, headers });
    return Response.json(await runCanaryLifecycle(body.action), { status: 200, headers });
  } catch {
    return Response.json({ error: "生命周期自检未完成；请核对受控运维窗口。" }, { status: 503, headers });
  }
}
