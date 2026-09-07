import { expect, it } from "vitest";
import { assessModCompatibility, assessTargetArtifactCompatibility, currentCompatibility } from "./modCompatibility";
import type { RuntimeProvenance } from "./runtimeProvenance";

function runtime(coreVersion = "0.28.1rc1.dev319+g762f85b31", pluginVersion = "0.25.1rc1+hust.20260903"): RuntimeProvenance {
  return {
    available: true,
    source: "docker-inspect-receipt",
    vllmHust: "762f85b311fbab0bcf8921dd216f5093cd58b9b8",
    vllmAscendHust: "4e57439e58ed3d78e675f9fd7b4614fb183c5394",
    components: {
      core: { name: "vLLM-HUST", repository: "", commitUrl: "", commit: "762f85b311fbab0bcf8921dd216f5093cd58b9b8", version: coreVersion },
      plugin: { name: "vLLM-Ascend-HUST", repository: "", commitUrl: "", commit: "4e57439e58ed3d78e675f9fd7b4614fb183c5394", version: pluginVersion },
    },
    verification: { status: "verified", checkedAt: "2026-09-04T00:00:00Z", receiptAgeSeconds: 10, message: "fixture", processSource: "not-attested" },
  };
}

it("reports exact host artifacts independently from live runtime state", () => {
  const current = runtime();
  expect(assessModCompatibility("diffspec", current).status).toBe("compatible");
  expect(assessModCompatibility("latchmoe", current).status).toBe("unverified");
});

it("does not downgrade qualified BidKV because the live instance has not enabled it", () => {
  const result = assessModCompatibility("bidkv", runtime());
  expect(result.status).toBe("compatible");
  expect(result.reason).toMatch(/功能验收.*安装、配置、启用与运行生效/);
});

it("separates first-deployment eligibility from current worker evidence", () => {
  const current = runtime();
  const target = { models: ["Qwen/Qwen3.8-27B"], tensorParallelSize: 4, pipelineParallelSize: 1, executionMode: "graph" as const };
  expect(assessTargetArtifactCompatibility("bidkv", current, target).status).toBe("compatible");
  expect(currentCompatibility(assessModCompatibility("bidkv", current), null).status).toBe("unknown");
});

it("requires the exact DiffSpec draft identity without blocking the catalog", () => {
  const current = runtime();
  const base = { models: ["Qwen3.8-27B"], tensorParallelSize: 4, pipelineParallelSize: 1, executionMode: "graph" as const };
  expect(assessTargetArtifactCompatibility("diffspec", current, base).status).toBe("unknown");
  const configuration = { launch_options: { speculative_config: { model: "VirVen/Qwen3.5-27B-EAGLE3-v2", model_sha256: "a57cefc45874197a24dd2a092cfd0d0f7d6a2f2cca156d09f2d2f4a56dc4e5be" } } };
  expect(assessTargetArtifactCompatibility("diffspec", current, { ...base, configuration }).status).toBe("compatible");
  expect(assessTargetArtifactCompatibility("diffspec", current, { ...base, configuration: { launch_options: { speculative_config: { model: "VirVen/Qwen3.5-27B-EAGLE3-v2", model_sha256: "a57cefc4" + "0".repeat(56) } } } }).status).toBe("unknown");
});

it("keeps LatchMoE available while marking dense Qwen not applicable", () => {
  const current = runtime();
  const result = assessTargetArtifactCompatibility("latchmoe", current, { models: ["Qwen/Qwen3.8-27B"], tensorParallelSize: 4, pipelineParallelSize: 1, executionMode: "graph" });
  expect(result.status).toBe("not-applicable");
});

it("maps Pipeline Microbatch to its PP2 by TP2 qualification instead of an external fallback", () => {
  const current = runtime();
  const production = assessTargetArtifactCompatibility("pipeline-microbatch", current, {
    models: ["Qwen/Qwen3.8-27B"], tensorParallelSize: 4, pipelineParallelSize: 1, executionMode: "graph",
  });
  expect(production).toMatchObject({ status: "not-applicable", label: "当前模型不适用" });
  expect(production.reason).toMatch(/PP2 × TP2.*当前部署拓扑/);
  expect(production.reason).not.toMatch(/外部运维/);
  expect(assessTargetArtifactCompatibility("pipeline-microbatch", current, {
    models: ["Qwen/Qwen3.8-27B"], tensorParallelSize: 2, pipelineParallelSize: 2, executionMode: "graph",
  }).status).toBe("compatible");
});

it("keeps artifacts outside exact qualified lanes unverified absent negative evidence", () => {
  expect(assessModCompatibility("bidkv", runtime("0.23.9", "0.25.1")).status).toBe("unverified");
  expect(assessModCompatibility("diffspec", runtime("0.28.1", "0.23.8")).status).toBe("unverified");
});

it("reports missing or stale runtime evidence as unverified", () => {
  const missing = { ...runtime(), available: false };
  const stale = { ...runtime(), verification: { ...runtime().verification!, status: "stale" as const } };
  expect(assessModCompatibility("bidkv", missing).status).toBe("unverified");
  expect(assessModCompatibility("latchmoe", stale).status).toBe("unverified");
});

it("projects insufficient evidence as explicit API unknown", () => {
  const assessment = assessModCompatibility("bidkv", { ...runtime(), available: false });
  expect(currentCompatibility(assessment)).toMatchObject({
    status: "unknown",
    label: "未核验",
    reason: expect.stringContaining("尚未核验"),
  });
});

it("requires a runtime-effective witness before reporting current compatibility", () => {
  const assessment = assessModCompatibility("bidkv", runtime());
  expect(assessment.status).toBe("compatible");
  expect(currentCompatibility(assessment)).toMatchObject({
    status: "unknown",
    reason: expect.stringContaining("运行生效"),
  });
  expect(currentCompatibility(assessment, true).status).toBe("compatible");
});
