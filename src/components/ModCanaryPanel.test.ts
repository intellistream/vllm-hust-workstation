import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ModCanaryPanel from "./ModCanaryPanel";

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fetchMock.mockReset().mockImplementation(async (_url: string, options: RequestInit = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({
      available: true,
      registered: true,
      state: "running",
      healthy: true,
      generation: options.method === "POST" ? 4 : 3,
      controllerStatus: "ready",
      operationId: options.method === "POST" ? "b".repeat(32) : null,
      effective: false,
      ...(options.method === "POST" ? { replayRejected: true } : {}),
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("enables only state-valid controls and sends the fixed restart request", async () => {
  await act(async () => root.render(createElement(ModCanaryPanel, {
    token: "fixture-admin-token",
    onAuthorizationExpired: vi.fn(),
  })));
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label) as HTMLButtonElement;
  expect(button("启动自检").disabled).toBe(true);
  expect(button("停止自检").disabled).toBe(false);
  expect(button("重启自检").disabled).toBe(false);
  expect(button("回滚到停止态").disabled).toBe(false);

  await act(async () => button("重启自检").click());
  const password = host.querySelector('input[type="password"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(password, "fixture-confirmation");
    password.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("确认自检").click());
  const [, request] = fetchMock.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(JSON.parse(String(request.body))).toEqual({
    action: "restart",
    targetId: "inert-canary",
    modId: "lifecycle-self-test",
    confirmation: "fixture-confirmation",
  });
  expect(host.textContent).toContain("旧授权重放已拒绝");
});
