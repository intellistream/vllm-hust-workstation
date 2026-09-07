// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { describeCanaryTarget, runCanaryLifecycle } from "@/lib/hostBrokerClient";

vi.mock("@/lib/hostBrokerClient", () => ({ describeCanaryTarget: vi.fn(), runCanaryLifecycle: vi.fn() }));
const request = (body: unknown, token = "test-admin") => new Request("http://localhost/api/mod-canary", {
  method: "POST", headers: { "x-workstation-admin-token": token }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("WORKSTATION_ADMIN_TOKEN", "test-admin");
  vi.mocked(describeCanaryTarget).mockResolvedValue({ available: true, registered: true, state: "stopped", healthy: false, generation: 2, controllerStatus: "ready", operationId: null, effective: false });
  vi.mocked(runCanaryLifecycle).mockResolvedValue({ available: true, registered: true, state: "running", healthy: true, generation: 3, controllerStatus: "ready", operationId: "b".repeat(32), effective: false, replayRejected: true });
});

it("requires administrator authentication for reads and mutations", async () => {
  expect((await GET(new Request("http://localhost/api/mod-canary"))).status).toBe(401);
  expect((await POST(request({ action: "start", targetId: "inert-canary", modId: "lifecycle-self-test", confirmation: "test-admin" }, "wrong"))).status).toBe(401);
  expect(runCanaryLifecycle).not.toHaveBeenCalled();
});

it("accepts only fixed canary IDs and a second credential", async () => {
  for (const body of [
    { action: "start", targetId: "shared-qwen", modId: "lifecycle-self-test", confirmation: "test-admin" },
    { action: "start", targetId: "inert-canary", modId: "bidkv", confirmation: "test-admin" },
    { action: "apply", targetId: "inert-canary", modId: "lifecycle-self-test", confirmation: "test-admin" },
    { action: "start", targetId: "inert-canary", modId: "lifecycle-self-test", confirmation: "wrong" },
    { action: "start", targetId: "inert-canary", modId: "lifecycle-self-test", confirmation: "test-admin", grant: "attacker" },
  ]) expect((await POST(request(body))).status).toBe(body.confirmation === "wrong" ? 401 : 400);
  expect(runCanaryLifecycle).not.toHaveBeenCalled();
});

it("forwards only a fixed action after both administrator checks", async () => {
  for (const action of ["start", "stop", "restart", "rollback"] as const) {
    const response = await POST(request({ action, targetId: "inert-canary", modId: "lifecycle-self-test", confirmation: "test-admin" }));
    expect(response.status).toBe(200);
    expect(runCanaryLifecycle).toHaveBeenLastCalledWith(action);
    expect(await response.json()).toMatchObject({ state: "running", replayRejected: true, effective: false });
  }
});
