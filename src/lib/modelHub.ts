import os from "node:os";
import path from "node:path";
import type { ModelHubDownloadState, ModelHubModel } from "@/types";

export const MODEL_CATALOG: ModelHubModel[] = [
  {
    id: "Qwen2.5-7B-Instruct",
    name: "Qwen 2.5 7B",
    repoId: "Qwen/Qwen2.5-7B-Instruct",
    params: "7B",
    sizeGb: 15.2,
    vramGb: 10,
    description: "通义千问主流指令模型，中文与代码能力均衡，适合工作站默认使用。",
    tags: ["中文", "代码", "推荐"],
    color: "#f59e0b",
  },
  {
    id: "Qwen2.5-14B-Instruct",
    name: "Qwen 2.5 14B",
    repoId: "Qwen/Qwen2.5-14B-Instruct",
    params: "14B",
    sizeGb: 28.9,
    vramGb: 20,
    description: "比 7B 更稳的综合能力，适合更高质量写作与分析。",
    tags: ["中文", "多语言"],
    color: "#f59e0b",
  },
  {
    id: "DeepSeek-R1-Distill-Qwen-7B",
    name: "DeepSeek-R1 7B",
    repoId: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    params: "7B",
    sizeGb: 15.3,
    vramGb: 10,
    description: "偏推理/数学/代码的轻量模型，适合需要思考链输出的场景。",
    tags: ["推理", "数学", "代码"],
    color: "#3b82f6",
  },
  {
    id: "DeepSeek-R1-Distill-Qwen-14B",
    name: "DeepSeek-R1 14B",
    repoId: "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
    params: "14B",
    sizeGb: 28.9,
    vramGb: 20,
    description: "更强的推理与自然语言表现，适合复杂问答。",
    tags: ["推理", "进阶"],
    color: "#3b82f6",
  },
  {
    id: "Mistral-7B-Instruct-v0.3",
    name: "Mistral 7B Instruct",
    repoId: "mistralai/Mistral-7B-Instruct-v0.3",
    params: "7B",
    sizeGb: 14.5,
    vramGb: 10,
    description: "英文与代码表现优秀，适合国际化场景。",
    tags: ["英文", "代码"],
    color: "#8b5cf6",
  },
  {
    id: "Llama-3.1-8B-Instruct",
    name: "Llama 3.1 8B",
    repoId: "meta-llama/Meta-Llama-3.1-8B-Instruct",
    params: "8B",
    sizeGb: 16.1,
    vramGb: 12,
    description: "Meta 主流开源模型，多语言能力较强，需要 Hugging Face 权限。",
    tags: ["英文", "多语言"],
    color: "#10b981",
    requiresAuth: true,
  },
];

export function getModelHubDir(): string {
  return process.env.MODEL_HUB_DIR || path.join(os.homedir(), "Downloads", "vllm-hust-models");
}

export function idleDownloadState(): ModelHubDownloadState {
  return { status: "idle", pct: 0 };
}