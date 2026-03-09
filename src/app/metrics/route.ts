import { DEFAULT_MODEL_ID } from "@/lib/config";
import { getPrometheusMetrics, setWorkstationInfo } from "@/lib/metrics";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  setWorkstationInfo(
    process.env.DEFAULT_MODEL || DEFAULT_MODEL_ID,
    process.env.BACKEND_TYPE || "CPU"
  );
  const { body, contentType } = await getPrometheusMetrics();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}