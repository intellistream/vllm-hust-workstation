import { cancelDownload, startDownload } from "@/lib/modelHubStore";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await context.params;
  const result = await startDownload(modelId);
  return Response.json(result, { status: result.ok ? 200 : 404 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await context.params;
  const ok = cancelDownload(modelId);
  return Response.json({ ok });
}