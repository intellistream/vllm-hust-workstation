export interface ModPreparationTask {
  id: string;
  targetId: string;
  modId: string;
  status: "queued" | "preparing" | "prepared" | "failed" | "superseded" | "interrupted";
  createdAt: string;
  updatedAt: string;
  baseImageId: string;
  imageId?: string;
  logs: string[];
}

export interface ModRuntimePayload {
  administrator: boolean;
  target: null | {
    id: string;
    label: string;
    ownership: "shared" | "dedicated";
    identityVerified: boolean;
    imageId?: string;
    coreSha?: string;
    pluginSha?: string;
    checkedAt?: string;
    models: string[];
    deploymentProfile?: {
      receiptId: string;
      receiptSha256: string;
      tensorParallelSize: number;
      pipelineParallelSize: number;
      executionMode: "graph";
      physicalDeviceCount: number;
    };
    observedMods: null | Array<{ id: string; runtimeEffective: boolean; evidenceId: string; observedAt: string }>;
  };
  preparationAvailable: boolean;
  applicationAvailable: boolean;
  lifecycle: {
    status: "unavailable" | "ready" | "running" | "stopped" | "recovery_required";
    brokerAvailable: boolean;
    instanceRegistered: boolean;
    identityLive: boolean;
    rollbackReady: boolean;
    oneUseAuthorization: boolean;
    reason: string;
  };
  mods: Array<{
    id: string;
    artifactQualification: { status: "passed" | "unverified" | "external"; label: string; scope: string; evidence?: string };
    targetArtifactCompatibility: import("./modCompatibility").TargetArtifactCompatibility;
    currentRuntimeCompatibility: "compatible" | "incompatible" | "unknown";
  }>;
  message: string;
  tasks: ModPreparationTask[];
}
