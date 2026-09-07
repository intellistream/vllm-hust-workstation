import type { RuntimeProvenance } from "./runtimeProvenance";

export type ModCompatibilityStatus = "compatible" | "incompatible" | "unverified";

export interface ModCompatibilityAssessment {
  status: ModCompatibilityStatus;
  label: "兼容" | "不兼容" | "未核验";
  reason: string;
  evaluatedAgainst: { coreVersion?: string; pluginVersion?: string; coreSha?: string; pluginSha?: string };
}

export interface CurrentRuntimeCompatibility {
  status: "compatible" | "incompatible" | "unknown";
  label: "兼容" | "不兼容" | "未核验";
  reason: string;
  evaluatedAgainst: ModCompatibilityAssessment["evaluatedAgainst"];
}

export interface TargetArtifactCompatibility {
  status: "compatible" | "incompatible" | "not-applicable" | "unknown";
  label: "可部署" | "不兼容" | "当前模型不适用" | "待核验";
  reason: string;
  evaluatedAgainst: ModCompatibilityAssessment["evaluatedAgainst"] & {
    models: string[];
    tensorParallelSize?: number;
    pipelineParallelSize?: number;
    executionMode?: "graph" | "eager";
  };
  requirements?: { draftModel?: string; draftSha256?: string };
}

export function currentCompatibility(
  assessment: ModCompatibilityAssessment,
  runtimeEffective: boolean | null = null,
): CurrentRuntimeCompatibility {
  if (runtimeEffective !== true) {
    return {
      status: "unknown",
      label: "未核验",
      reason: assessment.status === "compatible"
        ? "宿主制品属于已验收 lane，但当前实例尚无该候选已加载并运行生效的见证。"
        : assessment.reason,
      evaluatedAgainst: assessment.evaluatedAgainst,
    };
  }
  return {
    ...assessment,
    status: assessment.status === "unverified" ? "unknown" : assessment.status,
  };
}

function normalizedModel(models: string[], expected: string): boolean {
  const needle = expected.toLowerCase();
  return models.some(model => {
    const value = model.toLowerCase();
    return value === needle || value.endsWith("/" + needle);
  });
}

/**
 * Candidate admission before first deployment. This deliberately does not use
 * currentRuntimeCompatibility or runtimeEffective: neither can exist until the
 * candidate worker has started and emitted a verified witness.
 */
export function assessTargetArtifactCompatibility(
  modId: string,
  runtime: RuntimeProvenance,
  target: {
    models: string[];
    tensorParallelSize?: number;
    pipelineParallelSize?: number;
    executionMode?: "graph" | "eager";
    configuration?: unknown;
  },
): TargetArtifactCompatibility {
  const host = assessModCompatibility(modId, runtime);
  const evaluatedAgainst = { ...host.evaluatedAgainst, models: [...target.models],
    tensorParallelSize: target.tensorParallelSize, pipelineParallelSize: target.pipelineParallelSize,
    executionMode: target.executionMode };
  if (modId === "latchmoe" && normalizedModel(target.models, "Qwen3.8-27B")) {
    return { status: "not-applicable", label: "当前模型不适用", reason: "Qwen3.8-27B 是 dense 模型，没有 LatchMoE 所需的 routed experts。", evaluatedAgainst };
  }
  if (modId === "pipeline-microbatch") {
    if (host.status !== "compatible") return { status: "unknown", label: "待核验", reason: host.reason, evaluatedAgainst };
    if (!normalizedModel(target.models, "Qwen3.8-27B")) {
      return { status: "not-applicable", label: "当前模型不适用", reason: "该已验收 Pipeline Microbatch 部署单元绑定 Qwen3.8-27B。", evaluatedAgainst };
    }
    if (target.executionMode !== "graph" || target.tensorParallelSize !== 2 || target.pipelineParallelSize !== 2) {
      return { status: "not-applicable", label: "当前模型不适用", reason: "Pipeline Microbatch 的资格单元要求 Qwen3.8-27B、PP2 × TP2 和 graph；当前部署拓扑不能直接套用。", evaluatedAgainst };
    }
    return { status: "compatible", label: "可部署", reason: "Qwen3.8-27B PP2 × TP2 graph 功能部署单元已通过；已测性能退化只影响推荐等级。", evaluatedAgainst };
  }
  if (host.status !== "compatible") return { status: "unknown", label: "待核验", reason: host.reason, evaluatedAgainst };
  if (target.executionMode !== "graph" || target.tensorParallelSize !== 4 || target.pipelineParallelSize !== 1) {
    return { status: "incompatible", label: "不兼容", reason: "已验收部署单元要求 TP4、PP1 和 graph；不会通过降低 TP 或切换 eager 绕过门禁。", evaluatedAgainst };
  }
  if (modId === "latchmoe") {
    if (!normalizedModel(target.models, "Qwen3-30B-A3B")) return { status: "unknown", label: "待核验", reason: "请选择已完成功能验收的 Qwen3-30B-A3B 部署单元。", evaluatedAgainst };
    return { status: "compatible", label: "可部署", reason: "Qwen3-30B-A3B TP4 graph 功能部署单元已通过；已测性能退化只影响推荐等级。", evaluatedAgainst };
  }
  if (!normalizedModel(target.models, "Qwen3.8-27B")) {
    return { status: "not-applicable", label: "当前模型不适用", reason: "该已验收部署单元绑定 Qwen3.8-27B。", evaluatedAgainst };
  }
  if (modId === "diffspec") {
    const config = target.configuration as { launch_options?: { speculative_config?: { model?: unknown; model_sha256?: unknown } } } | undefined;
    const speculative = config?.launch_options?.speculative_config;
    const draftModel = "VirVen/Qwen3.5-27B-EAGLE3-v2";
    const draftSha256 = "a57cefc45874197a24dd2a092cfd0d0f7d6a2f2cca156d09f2d2f4a56dc4e5be";
    if (speculative?.model !== draftModel || speculative?.model_sha256 !== draftSha256) {
      return { status: "unknown", label: "待核验", reason: "DiffSpec 必须选择已验收 Eagle3 draft，并提交其完整文件树 SHA256；短哈希或模型名本身不能通过门禁。", evaluatedAgainst,
        requirements: { draftModel, draftSha256 } };
    }
  }
  return { status: "compatible", label: "可部署", reason: "目标基础制品、模型、TP4/PP1 与 graph 模式属于已验收候选部署单元；运行生效仍须由新 worker 见证。", evaluatedAgainst };
}

const TARGET_CORE_SHA = "762f85b311fbab0bcf8921dd216f5093cd58b9b8";
const TARGET_PLUGIN_SHA = "4e57439e58ed3d78e675f9fd7b4614fb183c5394";
const BIDKV_CURRENT_CORE_SHA = "a4d6aa022fb1885a25a802a6e29372c81eac6c9f";
const BIDKV_CURRENT_PLUGIN_SHA = "2c8c722107a54127999a64c4eb0ec86139df8c26";

function minor(version?: string): string | null {
  const match = version?.match(/^v?(\d+)\.(\d+)(?:\.|rc|$)/);
  return match ? `${match[1]}.${match[2]}` : null;
}

function result(
  status: ModCompatibilityStatus,
  reason: string,
  runtime: RuntimeProvenance,
): ModCompatibilityAssessment {
  return {
    status,
    label: status === "compatible" ? "兼容" : status === "incompatible" ? "不兼容" : "未核验",
    reason,
    evaluatedAgainst: {
      coreVersion: runtime.components?.core.version,
      pluginVersion: runtime.components?.plugin.version,
      coreSha: runtime.components?.core.commit,
      pluginSha: runtime.components?.plugin.commit,
    },
  };
}

/**
 * Compare immutable catalog declarations with the verified current runtime.
 * This assesses whether the verified host artifact belongs to a functionally
 * qualified lane. This host-lane assessment is not current Mod compatibility;
 * currentCompatibility also requires an observed runtime-effective witness.
 */
export function assessModCompatibility(modId: string, runtime: RuntimeProvenance): ModCompatibilityAssessment {
  if (!runtime.available || runtime.verification?.status !== "verified" || !runtime.components) {
    return result("unverified", "当前容器身份或安装制品尚未核验，不能判断兼容性。", runtime);
  }

  const exactTarget = runtime.components.core.commit === TARGET_CORE_SHA &&
    runtime.components.plugin.commit === TARGET_PLUGIN_SHA;

  if (modId === "bidkv") {
    const exactCurrentMain = runtime.components.core.commit === BIDKV_CURRENT_CORE_SHA &&
      runtime.components.plugin.commit === BIDKV_CURRENT_PLUGIN_SHA;
    if (minor(runtime.components.core.version) !== "0.28" ||
        minor(runtime.components.plugin.version) !== "0.25" ||
        (!exactCurrentMain && !exactTarget)) {
      return result("unverified", "当前 Core/Ascend 制品不在 BidKV 已完成实机功能验收的精确 lane；没有反证证明不兼容。", runtime);
    }
    return result("compatible", "该宿主制品属于 Qwen3.8-27B BidKV TP4 graph 已通过功能验收的精确 lane；安装、配置、启用与运行生效状态另行报告。", runtime);
  }

  if (modId === "diffspec") {
    if (!exactTarget || minor(runtime.components.plugin.version) !== "0.25") {
      return result("unverified", "当前 Core/Ascend 制品不在 DiffSpec 已完成实机功能验收的精确 lane；没有反证证明不兼容。", runtime);
    }
    return result("compatible", "该宿主制品属于 DiffSpec 已通过功能验收的精确 lane；仍须由配置和 live witness 核对 Qwen3.8、draft 哈希及当前运行状态。", runtime);
  }

  if (modId === "latchmoe") {
    if (!exactTarget) {
      return result("unverified", "当前 Core/Ascend 制品不在 LatchMoE 已完成实机功能验收的精确 lane；没有反证证明不兼容。", runtime);
    }
    return result("unverified", "Qwen3.8-27B 是 dense 模型，LatchMoE 不适用；Qwen3-30B-A3B 候选已通过 TP4 graph 功能门禁但性能退化。当前容器未证明候选 63781f3d、模型身份和 runtime-effective 见证，不能继承该结论。", runtime);
  }

  if (modId === "pipeline-microbatch") {
    if (!exactTarget) {
      return result("unverified", "当前 Core/Ascend 制品不在 Pipeline Microbatch 已完成功能验收的精确 lane；没有反证证明不兼容。", runtime);
    }
    return result("compatible", "该宿主制品属于 Pipeline Microbatch 已通过功能验收的精确 lane；候选部署仍须匹配 Qwen3.8-27B、PP2 × TP2 与 graph。", runtime);
  }

  return result("unverified", "该扩展尚无当前宿主制品的精确功能验收映射，不能推断生命周期兼容性。", runtime);
}
