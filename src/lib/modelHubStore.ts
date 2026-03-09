import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { DEFAULT_MODEL_ID } from "@/lib/config";
import { MODEL_CATALOG, getModelHubDir, idleDownloadState } from "@/lib/modelHub";
import type { ModelHubDownloadState, ModelHubModel } from "@/types";

type RuntimeDownload = {
  state: ModelHubDownloadState;
  process?: ChildProcessWithoutNullStreams;
  timer?: NodeJS.Timeout;
};

type Store = {
  downloads: Record<string, RuntimeDownload>;
};

const globalStore = globalThis as typeof globalThis & { __sagellmModelHubStore?: Store };

function getStore(): Store {
  if (!globalStore.__sagellmModelHubStore) {
    globalStore.__sagellmModelHubStore = { downloads: {} };
  }
  return globalStore.__sagellmModelHubStore;
}

async function walkDir(dirPath: string): Promise<string[]> {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function dirSize(dirPath: string): Promise<number> {
  try {
    const files = await walkDir(dirPath);
    let size = 0;
    for (const file of files) {
      if (file.endsWith(".lock")) {
        continue;
      }
      size += (await fsp.stat(file)).size;
    }
    return size;
  } catch {
    return 0;
  }
}

async function containsWeights(dirPath: string): Promise<boolean> {
  try {
    const files = await walkDir(dirPath);
    return files.some((file) => file.endsWith(".safetensors") || file.endsWith(".bin"));
  } catch {
    return false;
  }
}

function getDownloadState(modelId: string): ModelHubDownloadState {
  return getStore().downloads[modelId]?.state ?? idleDownloadState();
}

export async function getCatalog(): Promise<{ modelsDir: string; catalog: ModelHubModel[] }> {
  const modelsDir = getModelHubDir();
  const activeModel = process.env.DEFAULT_MODEL || DEFAULT_MODEL_ID;
  const catalog = await Promise.all(
    MODEL_CATALOG.map(async (item) => {
      const installed = await containsWeights(path.join(modelsDir, item.id));
      return {
        ...item,
        installed,
        active: item.id === activeModel,
        download: installed
          ? { status: "done", pct: 100 }
          : getDownloadState(item.id),
      } satisfies ModelHubModel;
    })
  );
  return { modelsDir, catalog };
}

export function cancelDownload(modelId: string): boolean {
  const runtime = getStore().downloads[modelId];
  if (!runtime) {
    return false;
  }
  runtime.process?.kill("SIGTERM");
  if (runtime.timer) {
    clearInterval(runtime.timer);
  }
  runtime.state = { ...runtime.state, status: "cancelled" };
  return true;
}

export async function activateModel(modelId: string): Promise<void> {
  const envPath = path.join(process.cwd(), ".env");
  let text = "";
  try {
    text = await fsp.readFile(envPath, "utf8");
  } catch {
    text = "";
  }

  if (/^DEFAULT_MODEL=/m.test(text)) {
    text = text.replace(/^DEFAULT_MODEL=.*$/m, `DEFAULT_MODEL=${modelId}`);
  } else {
    text += `${text.endsWith("\n") || !text ? "" : "\n"}DEFAULT_MODEL=${modelId}\n`;
  }

  await fsp.writeFile(envPath, text, "utf8");
  process.env.DEFAULT_MODEL = modelId;
}

export async function startDownload(modelId: string): Promise<{ ok: boolean; message: string }> {
  const store = getStore();
  const existing = store.downloads[modelId];
  if (existing?.state.status === "downloading") {
    return { ok: true, message: "already downloading" };
  }

  const model = MODEL_CATALOG.find((item) => item.id === modelId);
  if (!model) {
    return { ok: false, message: "model not found" };
  }

  const targetDir = path.join(getModelHubDir(), model.id);
  await fsp.mkdir(targetDir, { recursive: true });

  const runtime: RuntimeDownload = {
    state: {
      status: "downloading",
      pct: 0,
      speedMbps: 0,
      downloadedBytes: 0,
      totalBytes: Math.round(model.sizeGb * 1_000_000_000),
      currentFile: "正在准备下载…",
    },
  };
  store.downloads[modelId] = runtime;

  let previousBytes = 0;
  let previousTs = Date.now();
  runtime.timer = setInterval(async () => {
    const downloadedBytes = await dirSize(targetDir);
    const now = Date.now();
    const deltaBytes = Math.max(downloadedBytes - previousBytes, 0);
    const deltaSeconds = Math.max((now - previousTs) / 1000, 0.001);
    runtime.state.downloadedBytes = downloadedBytes;
    runtime.state.speedMbps = Number((deltaBytes / deltaSeconds / 1_000_000).toFixed(1));
    runtime.state.pct = Math.min(
      99,
      Math.floor((downloadedBytes / Math.max(runtime.state.totalBytes || 1, 1)) * 100)
    );
    runtime.state.currentFile = downloadedBytes > 0 ? "下载中…" : "等待远端响应…";
    previousBytes = downloadedBytes;
    previousTs = now;
  }, 1000);

  const py = spawn(
    "python3",
    [
      "-c",
      [
        "import os, sys",
        "from huggingface_hub import snapshot_download",
        "repo_id, local_dir = sys.argv[1], sys.argv[2]",
        "kwargs = {'repo_id': repo_id, 'local_dir': local_dir, 'token': os.environ.get('HF_TOKEN') or None}",
        "try:",
        "    snapshot_download(local_dir_use_symlinks=False, **kwargs)",
        "except TypeError:",
        "    snapshot_download(**kwargs)",
      ].join("\n"),
      model.repoId,
      targetDir,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HF_ENDPOINT: process.env.HF_ENDPOINT || "",
        HF_TOKEN: process.env.HF_TOKEN || "",
      },
    }
  );

  runtime.process = py;
  runtime.state.currentFile = `正在拉取 ${model.repoId}`;

  let stderr = "";
  py.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  py.on("close", async (code, signal) => {
    if (runtime.timer) {
      clearInterval(runtime.timer);
    }
    const finalBytes = await dirSize(targetDir);
    runtime.state.downloadedBytes = finalBytes;
    runtime.state.pct = code === 0 ? 100 : runtime.state.pct;
    runtime.state.currentFile = code === 0 ? "下载完成 ✓" : signal ? "已取消" : "下载失败";
    if (signal) {
      runtime.state.status = "cancelled";
    } else if (code === 0) {
      runtime.state.status = "done";
    } else {
      runtime.state.status = "error";
      runtime.state.error = stderr.trim() || "下载失败，请确认已安装 huggingface_hub 并检查网络连接";
    }
    runtime.process = undefined;
  });

  py.on("error", (error) => {
    if (runtime.timer) {
      clearInterval(runtime.timer);
    }
    runtime.state.status = "error";
    runtime.state.error = error.message;
  });

  return { ok: true, message: "started" };
}