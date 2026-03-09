import { activateModel } from "@/lib/modelHubStore";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await context.params;
  await activateModel(modelId);
  return Response.json({ ok: true, modelId });
}