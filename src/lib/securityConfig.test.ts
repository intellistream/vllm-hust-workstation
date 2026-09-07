import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isLocalBackendControlEnabled } from "./config";

const ORIGINAL_MODE = process.env.WORKSTATION_BACKEND_MODE;
const ORIGINAL_CONTROL = process.env.WORKSTATION_LOCAL_BACKEND_CONTROL_ENABLED;

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.WORKSTATION_BACKEND_MODE;
  else process.env.WORKSTATION_BACKEND_MODE = ORIGINAL_MODE;
  if (ORIGINAL_CONTROL === undefined) delete process.env.WORKSTATION_LOCAL_BACKEND_CONTROL_ENABLED;
  else process.env.WORKSTATION_LOCAL_BACKEND_CONTROL_ENABLED = ORIGINAL_CONTROL;
});

describe("shared backend safety", () => {
  it("disables local process control in external mode", () => {
    delete process.env.WORKSTATION_LOCAL_BACKEND_CONTROL_ENABLED;
    process.env.WORKSTATION_BACKEND_MODE = "external";
    expect(isLocalBackendControlEnabled()).toBe(false);
  });

  it("allows an explicit local-control override", () => {
    process.env.WORKSTATION_BACKEND_MODE = "external";
    process.env.WORKSTATION_LOCAL_BACKEND_CONTROL_ENABLED = "true";
    expect(isLocalBackendControlEnabled()).toBe(true);
  });

  it("does not expose the upstream URL or API key through next config env", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "next.config.mjs"), "utf8");
    const envBlock = config.match(/env:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    expect(envBlock).not.toContain("VLLM_HUST_API_KEY");
    expect(envBlock).not.toContain("VLLM_HUST_BASE_URL");
  });

  it("loads shared env credentials only in the server runtime launcher", () => {
    const resolver = fs.readFileSync(
      path.join(process.cwd(), "scripts/lib/runtime_secrets.sh"),
      "utf8"
    );
    expect(resolver).toContain("VLLM_HUST_API_KEY_ENV_FILE");
    expect(resolver).toContain("VLLM_HUST_API_KEY_ENV_NAME");
    expect(resolver).toContain("WORKSTATION_ADMIN_TOKEN_ENV_FILE");
    expect(resolver).toContain('source "$secret_env_file"');

    const deploy = fs.readFileSync(
      path.join(process.cwd(), "scripts/deploy_workstation.sh"),
      "utf8"
    );
    const runtime = fs.readFileSync(
      path.join(process.cwd(), "scripts/run_workstation_systemd.sh"),
      "utf8"
    );
    expect(deploy).toContain("load_workstation_upstream_api_key");
    expect(runtime).toContain("validate_workstation_upstream_api_key_source");
    expect(runtime).toContain("unset VLLM_HUST_API_KEY");
    expect(runtime).toContain("load_workstation_admin_token");
  });

  it("publishes immutable Workstation releases through an atomic link with health rollback", () => {
    const deploy = fs.readFileSync(path.join(process.cwd(), "scripts/deploy_workstation.sh"), "utf8");
    expect(deploy).toContain("releases_dir()");
    expect(deploy).toContain("activate_runtime()");
    expect(deploy).toContain('mv -Tf "$next_link" "$active_link"');
    expect(deploy).toContain("workstation release failed health checks; rolling back");
    expect(deploy).toContain('curl -fsS --max-time 3 "$base/api/mod-runtime"');
    expect(deploy).not.toContain('rm -rf "$target_dir"');
  });

  it("never caches live model or upstream availability state", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/models/route.ts"),
      "utf8"
    );
    const upstream = fs.readFileSync(
      path.join(process.cwd(), "src/lib/upstream.ts"),
      "utf8"
    );

    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).toContain("export const revalidate = 0");
    expect(route).toContain('"Cache-Control": "no-store, max-age=0"');
    expect(route).not.toContain("export const revalidate = 30");
    expect(upstream.match(/cache: "no-store"/g)).toHaveLength(4);
  });

  it("prevents unified operations from mutating an external backend", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "scripts/manage_public_stack.sh"),
      "utf8"
    );
    expect(content).toContain("ensure_managed_backend");
    expect(content).toContain("WORKSTATION_BACKEND_MODE:-local");
    expect(content).toContain("load_workstation_upstream_api_key");
    expect(content).toContain("curl_authenticated_status");
    expect(content).toContain("--config -");
    expect(content).not.toContain('"Authorization: Bearer ${VLLM_HUST_API_KEY}"');
    expect(content).not.toContain('source "$REPO_DIR/.env" 2>/dev/null || true');
  });

  it("requires an administrator token for managed external restarts", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/local-service/route.ts"),
      "utf8"
    );
    expect(route).toContain("hasValidAdminToken(request)");
    const auth = fs.readFileSync(path.join(process.cwd(), "src/lib/adminAuth.ts"), "utf8");
    expect(auth).toContain("timingSafeEqual");
    expect(auth).toContain("x-workstation-admin-token");
    expect(route).toContain("WORKSTATION_EXTERNAL_BACKEND_SYSTEMD_SERVICE");
  });
});
