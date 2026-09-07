// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getModCatalog, modRoot, startModAction } from "./modStore";
import { MOD_CATALOG } from "./modCatalog";
import { GET, POST } from "@/app/api/mods/route";
import { getRuntimeProvenance } from "./runtimeProvenance";
vi.mock("./runtimeProvenance", () => ({ getRuntimeProvenance: vi.fn() }));
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "mod-unit-")); vi.stubEnv("WORKSTATION_MOD_DIR", root); vi.stubEnv("WORKSTATION_ADMIN_TOKEN", "test-secret"); vi.mocked(getRuntimeProvenance).mockResolvedValue({ available: false, source: "unavailable", vllmHust: "unavailable", vllmAscendHust: "unavailable" }); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, {recursive: true, force: true}); });
it("requires explicit storage and rejects root/symlink paths", async () => {
  vi.stubEnv("WORKSTATION_MOD_DIR", ""); await expect(modRoot()).rejects.toThrow();
  expect((await getModCatalog(false)).storageReady).toBe(false);
  vi.stubEnv("WORKSTATION_MOD_DIR", "/"); await expect(modRoot()).rejects.toThrow();
  await symlink(root, path.join(root, "alias")); vi.stubEnv("WORKSTATION_MOD_DIR", path.join(root, "alias")); await expect(modRoot()).rejects.toThrow();
});
it("does not expose receipt internals or task logs to anonymous users", async () => {
  await mkdir(path.join(root, "bidkv/env/bin"), {recursive: true});
  await writeFile(path.join(root, "bidkv/env/bin/python"), "fixture");
  await writeFile(path.join(root, "bidkv/receipt.json"), JSON.stringify({installed: true, enabled: true, configured: true, sha: MOD_CATALOG[0].sha, manifest: {path: "/private/host"}}));
  const data = await getModCatalog(false);
  expect(data.catalog[0].currentRuntimeState.enabled).toBe(true);
  expect(JSON.stringify(data)).not.toContain("/private/"); expect(data.tasks).toEqual([]);
  expect(data.runtime.status).toBe("unverified");
});
it("fails closed on corrupt installation metadata", async () => {
  await mkdir(path.join(root, "bidkv")); await writeFile(path.join(root, "bidkv/receipt.json"), "{}");
  const mod = (await getModCatalog(true)).catalog[0]; expect(mod.currentRuntimeState.installed).toBe(false); expect(mod.stateError).toBeTruthy();
});
it("rejects all mutations before parsing without administrator credentials", async () => {
  for (const action of ["install", "configure", "enable", "disable", "uninstall", "run"]) {
    expect((await POST(new Request("http://localhost/api/mods", {method: "POST", body: JSON.stringify({id: "bidkv", action})}))).status).toBe(401);
  }
  expect((await GET(new Request("http://localhost/api/mods", {headers: {"x-workstation-admin-token": "wrong"}}))).status).toBe(401);
});
it("authenticates read-only catalog and rejects invalid commands and external service mutations", async () => {
  const response = await GET(new Request("http://localhost/api/mods", {headers: {"x-workstation-admin-token": "test-secret"}}));
  expect((await response.json()).administrator).toBe(true);
  await expect(startModAction("../../etc", "install")).rejects.toMatchObject({status: 404});
  await expect(startModAction("pegaflow", "uninstall")).rejects.toThrow("外部服务");
  await expect(startModAction("bidkv", "run")).rejects.toThrow("不会重启共享服务");
  await expect(startModAction("bidkv", "configure", [])).rejects.toMatchObject({status: 400});
});
it("keeps running gate closed even with a valid password", async () => {
  const response = await POST(new Request("http://localhost/api/mods", {method: "POST", headers: {"x-workstation-admin-token": "test-secret"}, body: JSON.stringify({id: "bidkv", action: "run"})}));
  expect(response.status).toBe(409);
});
it("fails closed before saving enable intent when current compatibility is not proven", async () => {
  await expect(startModAction("bidkv", "enable", undefined, true)).rejects.toThrow(/未核验.*启用意图未保存/);
  const mod = (await getModCatalog(true)).catalog[0];
  expect(mod.currentRuntimeCompatibility).toMatchObject({ status: "unknown", label: "未核验" });
  expect(mod.artifactQualification.status).toBe("passed");
});
it("returns explicit current-instance compatibility from verified server provenance", async () => {
  vi.mocked(getRuntimeProvenance).mockResolvedValue({
    available: true,
    source: "docker-inspect-receipt",
    vllmHust: "762f85b311fbab0bcf8921dd216f5093cd58b9b8",
    vllmAscendHust: "4e57439e58ed3d78e675f9fd7b4614fb183c5394",
    components: {
      core: { name: "vLLM-HUST", repository: "", commitUrl: "", commit: "762f85b311fbab0bcf8921dd216f5093cd58b9b8", version: "0.28.1rc1.dev319+g762f85b31" },
      plugin: { name: "vLLM-Ascend-HUST", repository: "", commitUrl: "", commit: "4e57439e58ed3d78e675f9fd7b4614fb183c5394", version: "0.25.1rc1+hust.20260903.4" },
    },
    verification: { status: "verified", checkedAt: "2026-09-04T00:00:00Z", receiptAgeSeconds: 1, message: "fixture", processSource: "not-attested" },
  });
  const response = await GET(new Request("http://localhost/api/mods"));
  const data = await response.json();
  expect(data.catalog).toHaveLength(19);
  expect(data.catalog.every((mod: { currentRuntimeCompatibility: { status: string } }) => mod.currentRuntimeCompatibility.status === "unknown")).toBe(true);
  expect(data.catalog[0].currentRuntimeCompatibility.reason).toMatch(/运行生效/);
  expect(data.catalog[1].currentRuntimeState.installed).toBe(false);
});
it("serializes management work and projects stale tasks as interrupted", async () => {
  await mkdir(path.join(root, "tasks"));
  const file = path.join(root, "tasks/11111111-1111-1111-1111-111111111111.json");
  const task = {id: "test", modId: "bidkv", action: "install", status: "running", createdAt: new Date().toISOString(), logs: []};
  await writeFile(file, JSON.stringify(task));
  await expect(startModAction("bidkv", "install", undefined, true)).rejects.toThrow("已有 Mod 任务");
  await writeFile(file, JSON.stringify({...task, createdAt: "2020-01-01T00:00:00Z"}));
  expect((await getModCatalog(true)).tasks[0].status).toBe("interrupted");
});
