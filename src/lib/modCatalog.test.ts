// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import rawCatalog from "../../config/mod-catalog.v1.json";
import managerFeed from "../../deps/vllm-hust-dev-hub/config/extension-catalog-v1.json";
import { MOD_CATALOG, MOD_CATALOG_FEED, MOD_MANAGER_SHA, validateModCatalog } from "./modCatalog";

describe("machine-readable Mod catalog", () => {
  it("loads the reviewed unique 19-entry set from schema v1", () => {
    expect(rawCatalog.schemaVersion).toBe(1);
    expect(MOD_CATALOG).toHaveLength(19);
    expect(new Set(MOD_CATALOG.map(mod => mod.id)).size).toBe(19);
    expect(MOD_MANAGER_SHA).toMatch(/^[a-f0-9]{40}$/);
    expect(MOD_CATALOG_FEED.sourceSha).toMatch(/^[a-f0-9]{40}$/);
  });

  it("uses exact qualified candidates for artifact preparation", () => {
    expect(MOD_CATALOG.find(mod => mod.id === "bidkv")?.sha).toBe("199e0bdc6fc38fc9b14b626515efdcbf81de0b62");
    expect(MOD_CATALOG.find(mod => mod.id === "diffspec")?.sha).toBe("c78f55c7e4923da342f2fc52c2cb509c150e5363");
    expect(MOD_CATALOG.find(mod => mod.id === "latchmoe")?.sha).toBe("63781f3dd0235f933735bfd8ce614d388093c0b5");
  });

  it("keeps performance verdicts separate from availability", () => {
    const degraded = MOD_CATALOG.filter(mod => mod.effectiveness.status === "not-beneficial-in-tested-cell");
    expect(degraded.map(mod => mod.id)).toEqual(["bidkv", "diffspec", "latchmoe", "pipeline-microbatch"]);
    expect(degraded.map(mod => mod.availability.status)).toEqual(["available", "available", "available", "available"]);
    expect(MOD_CATALOG.filter(mod => mod.availability.status === "available")).toHaveLength(4);
    expect(MOD_CATALOG.filter(mod => mod.availability.status === "qualified-unpublished")).toHaveLength(0);
    expect(MOD_CATALOG.find(mod => mod.id === "pipeline-microbatch")?.applicability.currentModelApplicable).toBe(false);
  });

  it("fails closed for previews and truthful external capabilities", () => {
    const previews = MOD_CATALOG.filter(mod => mod.availability.status === "preview");
    expect(previews).toHaveLength(14);
    expect(previews.every(mod => mod.sha === "" && Object.values(mod.actions).every(action => !action))).toBe(true);
    const external = MOD_CATALOG.find(mod => mod.id === "pegaflow")!;
    expect(external.availability.status).toBe("external");
    expect(external.actions).toEqual({ prepare: false, configure: false, externalHealth: false });
  });

  it("records manifest state and immutable canonical repository heads", () => {
    for (const mod of MOD_CATALOG) {
      expect(mod.source.repository).toMatch(/^https:\/\/github\.com\/vLLM-HUST\//);
      expect(mod.source.sourceSha).toMatch(/^[a-f0-9]{40}$/);
      expect(mod.managerManifest.status === "present" ? mod.managerManifest.path : null).toBe(mod.managerManifest.path);
      if (mod.functionalQualification.status === "passed") expect(mod.functionalQualification.evidence).toBeTruthy();
      if (mod.availability.status === "available") {
        expect(mod.kind).toBe("runtime");
        expect(mod.deployment).not.toBeNull();
        expect(mod.managerManifest.status).toBe("present");
        expect(mod.functionalQualification.status).toBe("passed");
        expect(mod.actions.prepare).toBe(true);
      }
    }
  });

  it("is a tested UI projection of the pinned Extension Manager feed", () => {
    const feedPath = resolve(process.cwd(), MOD_CATALOG_FEED.path.replace(/^config\//, "deps/vllm-hust-dev-hub/config/"));
    expect(createHash("sha256").update(readFileSync(feedPath)).digest("hex")).toBe(MOD_CATALOG_FEED.sha256);
    expect(managerFeed.schema).toBe("vllm-hust.extension-catalog/v1");
    expect(managerFeed.source.commit).toBe(MOD_MANAGER_SHA);
    expect(managerFeed.extensions).toHaveLength(19);
    expect([...managerFeed.extensions.map(item => item.id)].sort()).toEqual([...MOD_CATALOG.map(item => item.id)].sort());

    const feedById = new Map(managerFeed.extensions.map(item => [item.id, item]));
    for (const mod of MOD_CATALOG) {
      const upstream = feedById.get(mod.id);
      expect(upstream, `${mod.id} must exist in the organization feed`).toBeDefined();
      expect(mod.source.repository).toBe(upstream!.repository);
      expect(mod.source.defaultBranch).toBe(upstream!.source.ref);
      expect(mod.source.sourceSha).toBe(upstream!.source.commit);
      expect(mod.availability.status).toBe(upstream!.availability);
      expect(mod.actions.prepare).toBe(upstream!.enablement.allowed);
      if (upstream!.installation) {
        expect(mod.deployment?.sourceSha).toBe(upstream!.installation.commit);
        expect(mod.managerManifest).toEqual({ path: upstream!.installation.manifest_path, status: "present" });
      } else {
        expect(mod.deployment).toBeNull();
      }
    }
  });

  it("rejects unknown fields and executable preview actions", () => {
    const unknownField = structuredClone(rawCatalog) as typeof rawCatalog & { surprise?: boolean };
    unknownField.surprise = true;
    expect(() => validateModCatalog(unknownField)).toThrow(/unknown keys/);
    const unsafePreview = structuredClone(rawCatalog);
    unsafePreview.entries[5].actions.prepare = true;
    expect(() => validateModCatalog(unsafePreview)).toThrow(/unpublished actions must remain disabled/);
  });
});
