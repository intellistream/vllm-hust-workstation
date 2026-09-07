import rawCatalog from "../../config/mod-catalog.v1.json";

export type ModAvailabilityStatus = "available" | "qualified-unpublished" | "preview" | "external";
export type ModApplicabilityStatus = "applicable" | "not-applicable" | "requires-configuration" | "unknown" | "external";
export type FunctionalQualificationStatus = "passed" | "unverified" | "external";
export type EffectivenessStatus = "not-beneficial-in-tested-cell" | "inconclusive" | "beneficial" | "not-applicable" | "unverified";
export type RecommendationStatus = "recommended" | "scenario-dependent" | "not-recommended-tested-cell" | "experimental";
export type ModCategory = "capacity" | "latency" | "throughput" | "observability";
export type ManagerManifestStatus = "present" | "missing";

export interface CatalogAxis<T extends string> { status: T; label: string }
export interface ModCatalogEntry {
  id: string; name: string; kind: "runtime" | "external"; description: string;
  source: { repository: string; defaultBranch: string; sourceSha: string };
  deployment: { sourceSha: string; bundle: string; package: string } | null;
  managerManifest: { path: string | null; status: ManagerManifestStatus };
  availability: CatalogAxis<ModAvailabilityStatus> & { reason: string };
  applicability: CatalogAxis<ModApplicabilityStatus> & { scope: string; currentModelApplicable: boolean | null };
  functionalQualification: CatalogAxis<FunctionalQualificationStatus> & { scope: string; evidence?: string };
  effectiveness: CatalogAxis<EffectivenessStatus> & { scope: string; detail: string };
  recommendation: CatalogAxis<RecommendationStatus> & { reason: string };
  categories: ModCategory[]; scenarios: string[];
  actions: { prepare: boolean; configure: boolean; externalHealth: boolean };
  // Backward-compatible store fields. `sha` is the qualified deployment pin,
  // never the moving branch-head revision used for source presentation.
  repository: string; sha: string; candidateSha?: string; bundle: string; package: string;
  artifactQualification: { status: "passed" | "unverified" | "external"; label: string; scope: string; evidence?: string };
  effectivenessQualification: { status: EffectivenessStatus; label: string; scope: string };
  compatibility: string; requirements: string;
}
interface CatalogSourceLock { repository: string; defaultBranch: string; sourceSha: string }
interface CatalogFeedLock extends CatalogSourceLock { path: string; sha256: string }
interface CatalogDocument { schemaVersion: 1; source: string; manager: CatalogSourceLock; feed: CatalogFeedLock; entries: ModCatalogEntry[] }

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  const missing = allowed.filter(key => !(key in value));
  if (extra.length) throw new Error(`${path} has unknown keys: ${extra.join(", ")}`);
  if (missing.length) throw new Error(`${path} is missing keys: ${missing.join(", ")}`);
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}
function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${path} has an unsupported value`);
  return value as T;
}
function sha(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error(`${path} must be a full Git SHA`);
  return result;
}
function sha256(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${path} must be a SHA256 digest`);
  return result;
}
function githubRepository(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^https:\/\/github\.com\/vLLM-HUST\/[A-Za-z0-9._-]+$/.test(result)) throw new Error(`${path} must be a canonical vLLM-HUST repository`);
  return result;
}
function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must be a non-empty array`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}
function parseAxis<T extends string>(value: unknown, statuses: readonly T[], extra: readonly string[], path: string): Record<string, unknown> & CatalogAxis<T> {
  const result = record(value, path);
  keys(result, ["status", "label", ...extra], path);
  oneOf(result.status, statuses, `${path}.status`); text(result.label, `${path}.label`);
  for (const key of extra) {
    if (key === "currentModelApplicable") {
      if (result[key] !== null && typeof result[key] !== "boolean") throw new Error(`${path}.${key} must be boolean or null`);
    } else text(result[key], `${path}.${key}`);
  }
  return result as Record<string, unknown> & CatalogAxis<T>;
}

function parseCatalog(value: unknown): CatalogDocument {
  const root = record(value, "catalog"); keys(root, ["schemaVersion", "source", "manager", "feed", "entries"], "catalog");
  if (root.schemaVersion !== 1) throw new Error("Unsupported Mod catalog schemaVersion");
  const manager = record(root.manager, "catalog.manager"); keys(manager, ["repository", "defaultBranch", "sourceSha"], "catalog.manager");
  const parsedManager = { repository: githubRepository(manager.repository, "catalog.manager.repository"), defaultBranch: text(manager.defaultBranch, "catalog.manager.defaultBranch"), sourceSha: sha(manager.sourceSha, "catalog.manager.sourceSha") };
  const feed = record(root.feed, "catalog.feed"); keys(feed, ["repository", "defaultBranch", "sourceSha", "path", "sha256"], "catalog.feed");
  const parsedFeed = {
    repository: githubRepository(feed.repository, "catalog.feed.repository"),
    defaultBranch: text(feed.defaultBranch, "catalog.feed.defaultBranch"),
    sourceSha: sha(feed.sourceSha, "catalog.feed.sourceSha"),
    path: text(feed.path, "catalog.feed.path"),
    sha256: sha256(feed.sha256, "catalog.feed.sha256"),
  };
  if (!Array.isArray(root.entries) || root.entries.length !== 19) throw new Error("catalog.entries must contain the reviewed 19-entry set");
  const seen = new Set<string>();
  const entries = root.entries.map((raw, index): ModCatalogEntry => {
    const path = `catalog.entries[${index}]`; const item = record(raw, path);
    keys(item, ["id", "name", "kind", "description", "source", "deployment", "managerManifest", "availability", "applicability", "functionalQualification", "effectiveness", "recommendation", "categories", "scenarios", "actions"], path);
    const id = text(item.id, `${path}.id`);
    if (!/^[a-z0-9-]+$/.test(id) || seen.has(id)) throw new Error(`${path}.id must be unique kebab-case`);
    seen.add(id);
    const kind = oneOf(item.kind, ["runtime", "external"] as const, `${path}.kind`);
    const sourceRecord = record(item.source, `${path}.source`); keys(sourceRecord, ["repository", "defaultBranch", "sourceSha"], `${path}.source`);
    const parsedSource = { repository: githubRepository(sourceRecord.repository, `${path}.source.repository`), defaultBranch: text(sourceRecord.defaultBranch, `${path}.source.defaultBranch`), sourceSha: sha(sourceRecord.sourceSha, `${path}.source.sourceSha`) };
    let deployment: ModCatalogEntry["deployment"] = null;
    if (item.deployment !== null) {
      const deploymentRecord = record(item.deployment, `${path}.deployment`); keys(deploymentRecord, ["sourceSha", "bundle", "package"], `${path}.deployment`);
      deployment = { sourceSha: sha(deploymentRecord.sourceSha, `${path}.deployment.sourceSha`), bundle: text(deploymentRecord.bundle, `${path}.deployment.bundle`), package: text(deploymentRecord.package, `${path}.deployment.package`) };
    }
    const manifest = record(item.managerManifest, `${path}.managerManifest`); keys(manifest, ["path", "status"], `${path}.managerManifest`);
    const manifestStatus = oneOf(manifest.status, ["present", "missing"] as const, `${path}.managerManifest.status`);
    if (manifestStatus === "present" && (typeof manifest.path !== "string" || !manifest.path)) throw new Error(`${path}.managerManifest.path is required when present`);
    if (manifestStatus === "missing" && manifest.path !== null) throw new Error(`${path}.managerManifest.path must be null when missing`);
    const availability = parseAxis(item.availability, ["available", "qualified-unpublished", "preview", "external"] as const, ["reason"], `${path}.availability`) as unknown as ModCatalogEntry["availability"];
    const applicability = parseAxis(item.applicability, ["applicable", "not-applicable", "requires-configuration", "unknown", "external"] as const, ["scope", "currentModelApplicable"], `${path}.applicability`) as unknown as ModCatalogEntry["applicability"];
    const fqRecord = record(item.functionalQualification, `${path}.functionalQualification`);
    const fqExtras = "evidence" in fqRecord ? ["scope", "evidence"] : ["scope"];
    const functionalQualification = parseAxis(item.functionalQualification, ["passed", "unverified", "external"] as const, fqExtras, `${path}.functionalQualification`) as unknown as ModCatalogEntry["functionalQualification"];
    if (functionalQualification.status === "passed" && !functionalQualification.evidence) throw new Error(`${path}.functionalQualification.evidence is required when passed`);
    const effectiveness = parseAxis(item.effectiveness, ["not-beneficial-in-tested-cell", "inconclusive", "beneficial", "not-applicable", "unverified"] as const, ["scope", "detail"], `${path}.effectiveness`) as unknown as ModCatalogEntry["effectiveness"];
    const recommendation = parseAxis(item.recommendation, ["recommended", "scenario-dependent", "not-recommended-tested-cell", "experimental"] as const, ["reason"], `${path}.recommendation`) as unknown as ModCatalogEntry["recommendation"];
    if (kind === "external" && (deployment !== null || availability.status !== "external")) throw new Error(`${path} external entries cannot declare a deployment`);
    if (availability.status === "preview" && deployment !== null) throw new Error(`${path} preview entries cannot declare a deployment`);
    const categories = stringList(item.categories, `${path}.categories`).map((category, categoryIndex) => oneOf(category, ["capacity", "latency", "throughput", "observability"] as const, `${path}.categories[${categoryIndex}]`));
    const actionsRecord = record(item.actions, `${path}.actions`); keys(actionsRecord, ["prepare", "configure", "externalHealth"], `${path}.actions`);
    const actions = { prepare: actionsRecord.prepare, configure: actionsRecord.configure, externalHealth: actionsRecord.externalHealth };
    if (Object.values(actions).some(action => typeof action !== "boolean")) throw new Error(`${path}.actions values must be boolean`);
    if (["preview", "qualified-unpublished"].includes(availability.status) && Object.values(actions).some(Boolean)) throw new Error(`${path} unpublished actions must remain disabled`);
    if (kind === "external" && (actions.prepare || actions.configure)) throw new Error(`${path} external entries cannot expose artifact actions`);
    if (availability.status === "available" && (kind !== "runtime" || !deployment || manifestStatus !== "present" || functionalQualification.status !== "passed" || !actions.prepare)) {
      throw new Error(`${path} available entries require a qualified executable deployment`);
    }
    const artifactQualification = { status: functionalQualification.status, label: functionalQualification.label, scope: functionalQualification.scope, ...(functionalQualification.evidence ? { evidence: functionalQualification.evidence } : {}) } as ModCatalogEntry["artifactQualification"];
    return {
      id, name: text(item.name, `${path}.name`), kind, description: text(item.description, `${path}.description`),
      source: parsedSource, deployment, managerManifest: { path: manifest.path as string | null, status: manifestStatus },
      availability, applicability, functionalQualification, effectiveness, recommendation, categories, scenarios: stringList(item.scenarios, `${path}.scenarios`), actions: actions as ModCatalogEntry["actions"],
      repository: parsedSource.repository, sha: actions.prepare && deployment ? deployment.sourceSha : "", ...(deployment ? { candidateSha: deployment.sourceSha } : {}), bundle: deployment?.bundle ?? "", package: deployment?.package ?? "",
      artifactQualification, effectivenessQualification: { status: effectiveness.status, label: effectiveness.label, scope: effectiveness.scope }, compatibility: applicability.scope, requirements: `${availability.reason} ${recommendation.reason}`,
    };
  });
  return { schemaVersion: 1, source: text(root.source, "catalog.source"), manager: parsedManager, feed: parsedFeed, entries };
}

export function validateModCatalog(value: unknown): readonly ModCatalogEntry[] {
  return Object.freeze(parseCatalog(value).entries);
}

const CATALOG = parseCatalog(rawCatalog);
export const MOD_CATALOG_SOURCE = CATALOG.source;
export const MOD_MANAGER_SHA = CATALOG.manager.sourceSha;
export const MOD_MANAGER_CANDIDATE_SHA = CATALOG.manager.sourceSha;
export const MOD_CATALOG_FEED = Object.freeze(CATALOG.feed);
export const MOD_CATALOG: readonly ModCatalogEntry[] = Object.freeze(CATALOG.entries);
export type ModId = string;
export type ModAction = "install" | "configure" | "enable" | "disable" | "uninstall" | "run";
export interface ModState { installed: boolean; enabled: boolean; configured: boolean; runtimeEffective: boolean | null; version?: string; sha?: string; installedAt?: string }
export interface ModTask { id: string; modId: string; action: string; status: "queued" | "running" | "succeeded" | "failed" | "interrupted"; createdAt: string; updatedAt: string; logs: string[] }
export interface ModCatalogPayload {
  catalog: Array<ModCatalogEntry & { currentRuntimeState: ModState; stateError?: string; currentRuntimeCompatibility: import("./modCompatibility").CurrentRuntimeCompatibility }>;
  administrator: boolean; storageReady: boolean; tasks: ModTask[]; runtime: { status: "unverified"; message: string };
}
