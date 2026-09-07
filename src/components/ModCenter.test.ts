import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ModCenter from "./ModCenter";
import { MOD_CATALOG } from "@/lib/modCatalog";

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
const currentRuntimeCompatibility = { status: "unknown", label: "未核验", reason: "当前生产没有候选运行见证。", evaluatedAgainst: {} };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({
    catalog: MOD_CATALOG.map(mod => ({ ...mod, currentRuntimeState: { installed: false, configured: false, enabled: false, runtimeEffective: null }, currentRuntimeCompatibility })),
    administrator: false, storageReady: true, tasks: [], runtime: { status: "unverified" },
  }) });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it("renders the reviewed 19-entry catalog with independent qualification axes", async () => {
  await act(async () => root.render(createElement(ModCenter)));
  const cards = [...host.querySelectorAll("article")];
  expect(cards).toHaveLength(19);
  expect(cards[0].textContent).toContain("可用性");
  expect(cards[0].textContent).toContain("当前模型适用性");
  expect(cards[0].textContent).toContain("功能资格");
  expect(cards[0].textContent).toContain("效果资格");
  expect(cards[0].textContent).toContain("推荐等级");
  expect(cards[0].textContent).toContain("当前实例状态");
  expect(cards[0].textContent).toContain("已测配置不推荐");
  expect(cards.find(card => card.textContent?.includes("Pipeline Microbatch"))?.textContent).toContain("组织目录与安装入口已发布");
  expect(cards.find(card => card.textContent?.includes("Pipeline Microbatch"))?.textContent).toContain("当前部署不适用");
  expect(cards.find(card => card.textContent?.includes("Adaptive Quantized KV"))?.textContent).toContain("目录预览");
  expect(cards.find(card => card.textContent?.includes("PegaFlow"))?.textContent).toContain("健康检查尚未接入");
});

it("filters availability, current-model applicability, intent categories, and preview entries", async () => {
  await act(async () => root.render(createElement(ModCenter)));
  const select = host.querySelector("select")!;
  const filter = async (value: string) => {
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
    return [...host.querySelectorAll("article")];
  };
  expect([...select.options].map(option => option.value)).not.toContain("qualified-unpublished");
  expect(await filter("available")).toHaveLength(4);
  expect(await filter("preview")).toHaveLength(14);
  const applicable = await filter("applicable");
  expect(applicable).toHaveLength(2);
  expect(applicable.map(card => card.querySelector("h2")?.textContent)).toEqual(["BidKV", "DiffSpec"]);
  expect((await filter("observability")).map(card => card.querySelector("h2")?.textContent)).toEqual(expect.arrayContaining(["PegaFlow", "KV Transfer Observability", "Scheduler Policy Lab"]));
});

it("does not turn historical-range presentation into activation or public mutation authority", async () => {
  await act(async () => root.render(createElement(ModCenter)));
  expect(host.textContent).not.toContain("官方 vLLM 暂不支持");
  expect(host.textContent).not.toContain("runtime effective / performance neutral");
  expect([...host.querySelectorAll("button")].some(button => /安装到|启用意图|卸载/.test(button.textContent || ""))).toBe(false);
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/mods")).toHaveLength(1);
  expect(fetchMock.mock.calls.every(([, options]) => options.method === undefined)).toBe(true);
});

it("requires an explicit performance-risk opt-in before an administrator can prepare a degraded candidate", async () => {
  fetchMock.mockImplementation(async (_url: string, options: RequestInit = {}) => ({ ok: true, status: 200, json: async () => ({
    catalog: MOD_CATALOG.map(mod => ({ ...mod, currentRuntimeState: { installed: false, configured: false, enabled: false, runtimeEffective: null }, currentRuntimeCompatibility })),
    administrator: Boolean((options.headers as Record<string, string> | undefined)?.["X-Workstation-Admin-Token"]), storageReady: true, tasks: [], runtime: { status: "unverified" },
  }) }));
  await act(async () => root.render(createElement(ModCenter)));
  const login = [...host.querySelectorAll("button")].find(item => item.textContent === "管理员登录")!;
  await act(async () => login.click());
  const password = host.querySelector('input[type="password"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(password, "fixture-token");
    password.dispatchEvent(new Event("input", { bubbles: true }));
    password.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const prepare = [...host.querySelectorAll("button")].find(item => item.textContent === "仍然准备")!;
  await act(async () => prepare.click());
  const confirm = [...host.querySelectorAll("button")].find(item => item.textContent === "确认操作") as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
  await act(async () => checkbox.click());
  expect(confirm.disabled).toBe(false);
  await act(async () => confirm.click());
  const [, request] = fetchMock.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(JSON.parse(String(request.body))).toMatchObject({ id: "bidkv", action: "install", riskAcknowledged: true });
});
