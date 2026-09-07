import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ModRuntimePanel from "./ModRuntimePanel";
import type { ModRuntimePayload } from "@/lib/modRuntimeTypes";

let host: HTMLDivElement;
let root: Root;
let payload: ModRuntimePayload;
let fail = false;
const fetchMock = vi.fn();
const expired = vi.fn();
const changed = vi.fn();
function button(label: string) {
  const node = [...host.querySelectorAll("button")].find(item => item.textContent === label);
  if (!node) throw new Error("missing button " + label);
  return node;
}
async function render(token = "") {
  await act(async () => root.render(createElement(ModRuntimePanel, { token, onAuthorizationExpired: expired, onLibraryChanged: changed })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fail = false; expired.mockReset(); changed.mockReset();
  payload = { administrator: false, target: { id: "current", label: "工作站实例", ownership: "shared", identityVerified: true, models: ["model"], observedMods: null, imageId: "sha256:" + "a".repeat(64) }, preparationAvailable: true, applicationAvailable: false,
    lifecycle: { status: "unavailable", brokerAvailable: false, instanceRegistered: false, identityLive: true, rollbackReady: false, oneUseAuthorization: false, reason: "当前实例尚未纳入运行控制。" },
    mods: [{ id: "diffspec", artifactQualification: { status: "passed", label: "功能兼容性已通过", scope: "fixture" }, targetArtifactCompatibility: { status: "unknown", label: "待核验", reason: "fixture", evaluatedAgainst: { coreSha: "", pluginSha: "", coreVersion: "", pluginVersion: "", models: [] } }, currentRuntimeCompatibility: "unknown" }], message: "运行环境可准备", tasks: [] };
  fetchMock.mockReset().mockImplementation(async (url: string, options: RequestInit) => {
    if (fail) return { ok: false, status: 503, json: async () => ({ error: "实例暂不可用" }) };
    if (url === "/api/mod-canary") return { ok: true, status: 200, json: async () => ({ available: false, registered: false, state: "unavailable", healthy: false, effective: false }) };
    if (options.method === "POST") {
      const request = JSON.parse(String(options.body));
      if (["start", "stop", "restart"].includes(request.action)) return { ok: true, status: 202, json: async () => ({ id: "lifecycle-fixture" }) };
      payload.tasks = [{ id: "fixture", targetId: "current", modId: "diffspec", status: "prepared", baseImageId: "sha256:" + "a".repeat(64), imageId: "sha256:" + "b".repeat(64), createdAt: "2026-09-03T00:00:00Z", updatedAt: "2026-09-03T00:00:01Z", logs: ["fixture only"] }];
      return { ok: true, status: 202, json: async () => ({ id: "fixture" }) };
    }
    const token = (options.headers as Record<string, string>)["X-Workstation-Admin-Token"];
    return { ok: true, status: 200, json: async () => ({ ...payload, administrator: Boolean(token) }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("shows public target identity without mutation controls or a false effective Mod", async () => {
  await render();
  expect(host.textContent).toContain("工作站实例");
  expect(host.textContent).toContain("生效 Mod：待核验");
  expect(host.textContent).not.toContain("准备运行镜像");
  expect(host.querySelector("select")).toBeNull();
  expect(host.textContent).not.toContain("目标绑定、兼容性验收与重启审批");
  expect(host.textContent).not.toContain("生命周期自检");
});

it("requires confirmation and sends only target/Mod/action IDs with administrator authentication", async () => {
  await render("fixture-token");
  await act(async () => button("准备运行镜像").click());
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(fetchMock.mock.calls.filter(([, options]) => options.method)).toHaveLength(0);
  expect(button("确认准备").disabled).toBe(true);
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  await act(async () => button("确认准备").click());
  const [, request] = fetchMock.mock.calls.find(([, options]) => options.method === "POST")!;
  expect(JSON.parse(request.body)).toEqual({ action: "prepare", targetId: "current", modId: "diffspec", riskAcknowledged: true });
  expect(request.headers["X-Workstation-Admin-Token"]).toBe("fixture-token");
  expect(host.textContent).toContain("已准备 · 未应用");
  expect(host.textContent).toContain("生效 Mod：待核验");
  expect(host.textContent).toContain("接管协议未完整验收前不显示应用、停用或回滚按钮");
  expect([...host.querySelectorAll("button")].some(item => ["启动", "停止", "重启"].includes(item.textContent || ""))).toBe(false);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("clears stale target and controls on read failure and clears admin state on logout", async () => {
  await render("fixture-token"); fail = true;
  await act(async () => button("刷新实例").click());
  expect(host.textContent).toContain("实例暂不可用");
  expect(host.textContent).not.toContain("准备运行镜像");
  expect(host.textContent).not.toContain("容器身份已核验");
  fail = false; await render("");
  expect(host.querySelector("select")).toBeNull();
});
