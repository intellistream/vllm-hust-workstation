import { getCatalog } from "@/lib/modelHubStore";

export const runtime = "nodejs";

export async function GET() {
  const payload = await getCatalog();
  return Response.json(payload);
}