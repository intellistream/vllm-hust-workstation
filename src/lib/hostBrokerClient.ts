import { createConnection } from "node:net";

const PROTOCOL = "vllm-hust.host-broker/v1";
const MAX_RESPONSE = 16_384;

export interface HostTargetStatus {
  available: boolean;
  registered: boolean;
  state: "running" | "stopped" | "unavailable" | "identity_lost";
  healthy: boolean;
  policySha256?: string;
}

export interface CanaryLifecycleStatus extends HostTargetStatus {
  generation?: number;
  controllerStatus?: "ready" | "changing" | "recovery_required";
  operationId?: string | null;
  effective: false;
  replayRejected?: true;
}

async function brokerRequest(value: Record<string, unknown>): Promise<Record<string, unknown>> {
  const socketPath = (process.env.WORKSTATION_HOST_BROKER_SOCKET || "/run/vllm-hust-host-broker/control.sock").trim();
  if (!socketPath.startsWith("/") || socketPath.includes("\0") || socketPath.split("/").includes("..")) throw new Error("invalid broker socket");
  const payload = JSON.stringify(value);
  const raw = await new Promise<string>((resolve, reject) => {
    const client = createConnection(socketPath);
    let response = "";
    const timer = setTimeout(() => client.destroy(new Error("timeout")), 1500);
    client.setEncoding("utf8");
    client.on("connect", () => client.end(payload));
    client.on("data", chunk => {
      response += chunk;
      if (Buffer.byteLength(response) > MAX_RESPONSE) client.destroy(new Error("response too large"));
    });
    client.on("error", reject);
    client.on("end", () => resolve(response));
    client.on("close", () => clearTimeout(timer));
  });
  const result = JSON.parse(raw) as Record<string, unknown>;
  if (!result || result.protocol !== PROTOCOL || result.ok !== true || "grant" in result) throw new Error("invalid broker response");
  return result;
}

export async function describeHostTarget(instanceId: string): Promise<HostTargetStatus> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(instanceId)) return { available: false, registered: false, state: "unavailable", healthy: false };
  try {
    const value = await brokerRequest({ schema: PROTOCOL, action: "describe", instance_id: instanceId });
    if (value.instanceId !== instanceId || typeof value.healthy !== "boolean" || typeof value.policySha256 !== "string") {
      return { available: true, registered: false, state: "unavailable", healthy: false };
    }
    const state = value.state === "running" ? "running" : value.state === "stopped" ? "stopped" : value.state === "identity_lost" ? "identity_lost" : "unavailable";
    return { available: true, registered: true, state, healthy: value.healthy, policySha256: value.policySha256 };
  } catch {
    return { available: false, registered: false, state: "unavailable", healthy: false };
  }
}

function projectCanary(value: Record<string, unknown>): CanaryLifecycleStatus {
  if (value.instanceId !== "inert-canary" || typeof value.healthy !== "boolean" || value.effective !== false ||
      typeof value.policySha256 !== "string" || !Number.isInteger(value.generation) ||
      !["ready", "changing", "recovery_required"].includes(String(value.controllerStatus))) throw new Error("invalid canary response");
  const state = value.state === "running" ? "running" : value.state === "stopped" ? "stopped" : value.state === "identity_lost" ? "identity_lost" : "unavailable";
  return { available: true, registered: true, state, healthy: value.healthy as boolean,
    policySha256: value.policySha256 as string, generation: value.generation as number,
    controllerStatus: value.controllerStatus as CanaryLifecycleStatus["controllerStatus"],
    operationId: typeof value.operationId === "string" ? value.operationId : null, effective: false,
    ...(value.replayRejected === true ? { replayRejected: true as const } : {}) };
}

export async function describeCanaryTarget(): Promise<CanaryLifecycleStatus> {
  try { return projectCanary(await brokerRequest({ schema: PROTOCOL, action: "canary_status", instance_id: "inert-canary" })); }
  catch { return { available: false, registered: false, state: "unavailable", healthy: false, effective: false }; }
}

export type CanaryLifecycleAction = "start" | "stop" | "restart" | "rollback";

export async function runCanaryLifecycle(action: CanaryLifecycleAction): Promise<CanaryLifecycleStatus> {
  const value = await brokerRequest({ schema: PROTOCOL, action: "canary_lifecycle", instance_id: "inert-canary", lifecycle_action: action });
  if (value.phase !== "committed" || value.replayRejected !== true || typeof value.operationId !== "string" || !/^[a-f0-9]{32}$/.test(value.operationId)) throw new Error("canary operation not committed");
  return projectCanary(value);
}
