import { lstat, readFile, readdir, realpath, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { MOD_CATALOG, MOD_MANAGER_SHA } from "./modCatalog";
import { assessModCompatibility, assessTargetArtifactCompatibility, currentCompatibility } from "./modCompatibility";
import { describeHostTarget } from "./hostBrokerClient";
import { ModError, modRoot } from "./modStore";
import { getRuntimeProvenance } from "./runtimeProvenance";
import { fetchUpstreamModels } from "./upstream";
import type { ModPreparationTask, ModRuntimePayload } from "./modRuntimeTypes";

interface TargetConfig {
  schema: "workstation.mod-runtime-config/v1";
  target: { id: string; label: string; ownership: "shared" | "dedicated"; containerName: string; pythonBin: string; upstreamUrl: string };
}

interface DeploymentProfile {
  receiptId: string;
  receiptSha256: string;
  model: string;
  coreSha: string;
  pluginSha: string;
  tensorParallelSize: number;
  pipelineParallelSize: number;
  executionMode: "graph";
  physicalDeviceCount: number;
}

function upstreamIdentity(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) throw new Error("invalid upstream");
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.origin + url.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function sameModel(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/^.*\//, "");
  return normalize(left) === normalize(right);
}

export async function runtimeConfig(): Promise<TargetConfig | null> {
  const file = process.env.WORKSTATION_MOD_RUNTIME_CONFIG?.trim();
  if (!file) return null;
  const info = await lstat(file);
  if (!path.isAbsolute(file) || !info.isFile() || info.isSymbolicLink() || await realpath(file) !== file || info.mode & 0o077 || info.uid !== process.getuid?.() || info.size > 16384) throw new ModError("实例登记文件必须由部署端私有管理。", 503);
  const config = JSON.parse(await readFile(file, "utf8")) as TargetConfig;
  const target = config?.target;
  if (config.schema !== "workstation.mod-runtime-config/v1" || !target || Object.keys(config).sort().join() !== "schema,target" || Object.keys(target).sort().join() !== "containerName,id,label,ownership,pythonBin,upstreamUrl" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(target.id) || typeof target.label !== "string" || !target.label.trim() || target.label.length > 100 ||
      !["shared", "dedicated"].includes(target.ownership) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(target.containerName) ||
      !/^\/[A-Za-z0-9_./-]+\/python[0-9.]*$/.test(target.pythonBin) || target.pythonBin.includes("/../") ||
      target.containerName !== process.env.WORKSTATION_RUNTIME_CONTAINER || upstreamIdentity(target.upstreamUrl) !== upstreamIdentity(process.env.VLLM_HUST_BASE_URL || "http://localhost:8080")) {
    throw new ModError("登记实例与工作站上游部署不一致。", 503);
  }
  return config;
}

async function deploymentProfile(file: string | undefined, provenance: Awaited<ReturnType<typeof getRuntimeProvenance>>): Promise<DeploymentProfile | undefined> {
  if (!file || !provenance.components) return undefined;
  const info = await lstat(file);
  const processUid = process.getuid?.();
  if (!info.isFile() || info.isSymbolicLink() || await realpath(file) !== file || info.size > 1_000_000 ||
      (info.mode & 0o022) !== 0 || (info.uid !== 0 && info.uid !== processUid)) throw new Error("invalid deployment receipt file");
  const value = JSON.parse(await readFile(file, "utf8")) as { receipts?: unknown[] };
  if (!Array.isArray(value.receipts) || value.receipts.length > 1000) throw new Error("invalid deployment receipt index");
  const active = [...value.receipts].reverse().find((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && (entry as Record<string, unknown>).status === "active"));
  if (!active || active.schema_version !== "vllm-hust.deployment-receipt/v1" || typeof active.receipt_id !== "string" || !/^deploy-[a-f0-9]{20}$/.test(active.receipt_id) ||
      typeof active.content_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(active.content_sha256) || typeof active.served_model !== "string" ||
      active.engine_commit !== provenance.components.core.commit || active.plugin_commit !== provenance.components.plugin.commit ||
      !Number.isInteger(active.accelerator_count) || !Number.isInteger(active.tensor_parallel_size) || !Number.isInteger(active.data_parallel_size) ||
      !Array.isArray(active.physical_device_ids) || active.physical_device_ids.length !== active.accelerator_count || active.graph_mode !== "graph" ||
      active.tensor_parallel_size !== active.accelerator_count || active.data_parallel_size !== 1) throw new Error("deployment receipt does not match current runtime");
  return { receiptId: active.receipt_id, receiptSha256: active.content_sha256, model: active.served_model,
    coreSha: active.engine_commit as string, pluginSha: active.plugin_commit as string,
    tensorParallelSize: active.tensor_parallel_size as number, pipelineParallelSize: 1, executionMode: "graph",
    physicalDeviceCount: active.accelerator_count as number };
}

async function savedConfiguration(root: string | undefined, modId: string): Promise<unknown> {
  if (!root) return undefined;
  try {
    const file = path.join(root, modId, "configuration.json");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) return undefined;
    return JSON.parse(await readFile(file, "utf8"));
  } catch { return undefined; }
}

export async function runtimeRoot(): Promise<string> {
  const root = process.env.WORKSTATION_MOD_RUNTIME_DIR?.trim();
  if (!root || !path.isAbsolute(root) || path.resolve(root) === "/") throw new ModError("实例制品存储未配置。", 503);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root || info.mode & 0o077 || info.uid !== process.getuid?.()) throw new ModError("实例制品存储必须为部署端私有目录。", 503);
  return root;
}

interface PrivateTask extends ModPreparationTask {
  schema: "workstation.mod-preparation-task/v1";
  expectedIdentity: { id: string; startedAt: string; imageId: string };
  sourceSha: string;
  managerSha: string;
  receiptPath?: string;
}

async function taskRecords(root: string): Promise<PrivateTask[]> {
  const directory = path.join(root, "tasks");
  try {
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("invalid task directory");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const names = (await readdir(directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
  if (names.length > 1000) throw new ModError("准备任务记录需要维护。", 503);
  const records = await Promise.all(names.map(async name => {
    const file = path.join(directory, name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077 || info.size > 100_000) throw new Error("invalid task file");
    const task = JSON.parse(await readFile(file, "utf8")) as PrivateTask;
    if (task.schema !== "workstation.mod-preparation-task/v1" || task.id + ".json" !== name || !["queued", "preparing", "prepared", "failed", "superseded", "interrupted"].includes(task.status) || !Array.isArray(task.logs)) throw new Error("invalid preparation record");
    return task;
  }));
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function projectTask(task: PrivateTask, current?: { imageId?: string; containerId?: string; startedAt?: string }): ModPreparationTask {
  const mod = MOD_CATALOG.find(item => item.id === task.modId);
  const reasons: string[] = [];
  if (task.status === "prepared" && current) {
    if (!mod?.sha || task.sourceSha !== mod.sha) reasons.push("资格源码已更新");
    if (task.managerSha !== MOD_MANAGER_SHA) reasons.push("Extension Manager 来源锁已更新");
    if (task.baseImageId !== current.imageId || task.expectedIdentity.imageId !== current.imageId ||
        task.expectedIdentity.id !== current.containerId || task.expectedIdentity.startedAt !== current.startedAt) reasons.push("目标容器或基础镜像已变化");
  }
  const status = reasons.length ? "superseded" as const : task.status;
  const logs = reasons.length ? [...task.logs, `只读状态投影：${reasons.join("；")}，该候选不能应用。`] : task.logs;
  return { id: task.id, targetId: task.targetId, modId: task.modId, status, createdAt: task.createdAt, updatedAt: task.updatedAt,
    baseImageId: task.baseImageId, imageId: task.imageId, logs: logs.slice(-40) };
}

export async function getModRuntime(administrator: boolean): Promise<ModRuntimePayload> {
  const config = await runtimeConfig();
  const closedLifecycle = { status: "unavailable" as const, brokerAvailable: false, instanceRegistered: false,
    identityLive: false, rollbackReady: false, oneUseAuthorization: false, reason: "运行控制尚未就绪。" };
  if (!config) return { administrator, target: null, preparationAvailable: false, applicationAvailable: false,
    lifecycle: closedLifecycle, mods: [], message: "尚未登记推理实例。", tasks: [] };
  const [provenance, models, broker] = await Promise.all([getRuntimeProvenance(), fetchUpstreamModels(), describeHostTarget(config.target.id)]);
  const receiptProfile = await deploymentProfile(process.env.WORKSTATION_DEPLOYMENT_RECEIPT_FILE?.trim(), provenance).catch(() => undefined);
  const profile = receiptProfile && models.reachable && models.ids.some(model => sameModel(model, receiptProfile.model)) ? receiptProfile : undefined;
  const verified = provenance.available && provenance.verification?.status === "verified" && provenance.container?.name === config.target.containerName;
  let root: string | undefined;
  try { root = await runtimeRoot(); await modRoot(); } catch { root = undefined; }
  const target: NonNullable<ModRuntimePayload["target"]> = { id: config.target.id, label: config.target.label, ownership: config.target.ownership, identityVerified: Boolean(verified),
    ...(verified ? { imageId: provenance.image!.id, coreSha: provenance.components!.core.commit, pluginSha: provenance.components!.plugin.commit, checkedAt: provenance.verification!.checkedAt } : {}),
    models: models.reachable ? models.ids : [], ...(profile ? { deploymentProfile: { receiptId: profile.receiptId, receiptSha256: profile.receiptSha256,
      tensorParallelSize: profile.tensorParallelSize, pipelineParallelSize: profile.pipelineParallelSize, executionMode: profile.executionMode,
      physicalDeviceCount: profile.physicalDeviceCount } } : {}), observedMods: null };
  const mods = await Promise.all(MOD_CATALOG.filter(mod => mod.sha).map(async mod => {
    const witness = target.observedMods?.find(item => item.id === mod.id)?.runtimeEffective ?? null;
    const targetArtifactCompatibility = assessTargetArtifactCompatibility(mod.id, provenance, { models: target.models,
      tensorParallelSize: profile?.tensorParallelSize, pipelineParallelSize: profile?.pipelineParallelSize,
      executionMode: profile?.executionMode, configuration: await savedConfiguration(root, mod.id) });
    return {
      id: mod.id,
      artifactQualification: mod.artifactQualification,
      targetArtifactCompatibility,
      currentRuntimeCompatibility: currentCompatibility(assessModCompatibility(mod.id, provenance), witness).status,
    };
  }));
  const lifecycle = { status: "unavailable" as const, brokerAvailable: broker.available, instanceRegistered: broker.registered,
    identityLive: Boolean(verified), rollbackReady: false, oneUseAuthorization: false,
    reason: !verified ? "实例身份待核验。" : !broker.registered ? "当前实例尚未纳入运行控制。" : "回滚基线尚未验收。" };
  return { administrator, target, preparationAvailable: Boolean(root && verified), applicationAvailable: false, lifecycle, mods,
    message: !verified ? "实例身份暂未核验，准备操作已暂停。" : !root ? "实例制品存储尚未就绪。" : "运行环境可准备；服务切换需通过全部运行门控。",
    tasks: root && administrator ? (await taskRecords(root)).filter(task => task.targetId === target.id).slice(0, 30).map(task => projectTask(task, verified ? {
      imageId: provenance.image!.id, containerId: provenance.container!.id, startedAt: provenance.container!.startedAt,
    } : undefined)) : [] };
}

export async function startRuntimePreparation(targetId: string, modId: string, riskAcknowledged = false): Promise<ModPreparationTask> {
  const config = await runtimeConfig();
  if (!config || config.target.id !== targetId) throw new ModError("实例未登记。", 404);
  const mod = MOD_CATALOG.find(item => item.id === modId);
  if (!mod || !mod.sha) throw new ModError("该扩展不支持实例镜像准备。", 400);
  if (mod.effectiveness.status === "not-beneficial-in-tested-cell" && riskAcknowledged !== true) throw new ModError("该资格制品在已测单元中性能退化；需要显式确认风险。", 409);
  const provenance = await getRuntimeProvenance();
  if (!provenance.available || provenance.verification?.status !== "verified" || provenance.container?.name !== config.target.containerName) throw new ModError("实例身份未核验，请刷新后重试。");
  const root = await runtimeRoot();
  const library = await modRoot();
  if ((await taskRecords(root)).some(task => ["queued", "preparing", "interrupted"].includes(task.status))) throw new ModError("已有准备任务执行中；中断任务需先核查。");
  const task: PrivateTask = { schema: "workstation.mod-preparation-task/v1", id: randomUUID(), targetId, modId, status: "queued",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), baseImageId: provenance.image!.id,
    expectedIdentity: { id: provenance.container!.id, startedAt: provenance.container!.startedAt, imageId: provenance.image!.id },
    sourceSha: mod.sha, managerSha: MOD_MANAGER_SHA, logs: ["准备任务已排队；不会切换推理实例。"] };
  await mkdir(path.join(root, "tasks"), { recursive: true, mode: 0o700 });
  const file = path.join(root, "tasks", task.id + ".json");
  await writeFile(file, JSON.stringify(task), { flag: "wx", mode: 0o600 });
  const worker = path.resolve(process.cwd(), "scripts/mod_runtime_worker.py");
  const child = spawn("/usr/bin/python3", [worker, root, task.id], { detached: true, stdio: ["pipe", "ignore", "ignore"],
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", PYTHONNOUSERSITE: "1", NODE_ENV: "production" } });
  child.on("error", () => { task.status = "failed"; task.logs.push("无法启动实例准备执行器。"); void writeFile(file, JSON.stringify(task)).catch(() => {}); });
  child.on("exit", code => {
    if (code === 0) return;
    // A confirmed child exit is not proof that its Docker daemon build stopped.
    // Preserve an unresolved state; never auto-retry based on age or timeout.
    void (async () => {
      const current = JSON.parse(await readFile(file, "utf8")) as PrivateTask;
      if (!["queued", "preparing"].includes(current.status)) return;
      current.status = "interrupted"; current.updatedAt = new Date().toISOString();
      current.logs.push("执行器异常退出，候选构建需先核查；不会自动重试。");
      await writeFile(file, JSON.stringify(current));
    })().catch(() => {});
  });
  child.stdin?.on("error", () => { /* The child records failures after launch; no credentials inherited. */ });
  child.stdin?.end(JSON.stringify({ target: config.target, library, mod, managerSha: MOD_MANAGER_SHA }));
  child.unref();
  return projectTask(task);
}
