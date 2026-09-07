import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { lstat, rm } from "node:fs/promises";

function assertDecodableIco(bytes) {
  if (bytes.length < 22) throw new Error("Favicon ICO is empty or truncated");
  if (bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) {
    throw new Error("Favicon does not have a valid ICO header");
  }
  const imageCount = bytes.readUInt16LE(4);
  if (imageCount < 1 || bytes.length < 6 + imageCount * 16) {
    throw new Error("Favicon ICO has no complete image directory");
  }
  for (let index = 0; index < imageCount; index++) {
    const entry = 6 + index * 16;
    const imageSize = bytes.readUInt32LE(entry + 8);
    const imageOffset = bytes.readUInt32LE(entry + 12);
    if (imageSize < 4 || imageOffset < 6 + imageCount * 16 || imageOffset + imageSize > bytes.length) {
      throw new Error("Favicon ICO image entry points outside the response body");
    }
    const isPng = bytes.subarray(imageOffset, imageOffset + 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    const dibHeaderSize = bytes.readUInt32LE(imageOffset);
    if (!isPng && dibHeaderSize < 40) {
      throw new Error("Favicon ICO image payload is neither PNG nor a supported DIB");
    }
  }
}

// Next copies dotenv files separately from tracing. Credentials belong to the
// trusted launcher, not the generated deployment bundle; remove only these copies.
const candidate = resolve(".next/standalone");
if (!(await lstat(candidate)).isDirectory() || !(await lstat(resolve(candidate, "server.js"))).isFile()) {
  throw new Error("Expected a generated standalone directory and server entrypoint");
}
if (!(await lstat(resolve(candidate, "scripts/mod_worker.py"))).isFile()) throw new Error("Standalone Mod worker is missing");
for (const file of ["mod_runtime_worker.py", "mod_artifact_io.py", "instance_control_client.py", "prepare_mod_image.py", "inspect_mod_runtime.py", "mod_launch_inventory.py", "mod_compatibility.py", "build_mod_observer.py", "runtime/workstation_mod_runtime/__init__.py", "runtime/workstation_mod_runtime/__main__.py"]) {
  if (!(await lstat(resolve(candidate, "scripts", file))).isFile()) throw new Error("Standalone runtime preparation helper is missing: " + file);
}
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  await rm(resolve(candidate, name), { force: true });
}
// Boot the candidate on loopback before replacing the active Web release.
// Probe only a read-only local catalog route; never contact inference or mutate it.
const listener = createServer();
await new Promise((ready, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", ready); });
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const child = spawn(process.execPath, ["server.js"], {
  cwd: candidate,
  env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let spawnError;
child.on("error", error => { spawnError = error; });
child.stdout.on("data", data => { output = (output + data).slice(-4000); });
child.stderr.on("data", data => { output = (output + data).slice(-4000); });
try {
  let passed = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (spawnError || child.exitCode !== null) throw new Error("Standalone failed to start: " + (spawnError?.message || output));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/hub/catalog`, { signal: AbortSignal.timeout(1000) });
      const data = await response.json();
      if (response.ok && Array.isArray(data.catalog)) { passed = true; break; }
    } catch { /* Candidate may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!passed) throw new Error("Standalone catalog probe timed out: " + output);
  const mods = await fetch(`http://127.0.0.1:${port}/api/mods`);
  const modCatalog = await mods.json();
  if (!mods.ok || !Array.isArray(modCatalog.catalog) || modCatalog.administrator) throw new Error("Standalone Mod catalog failed");
  if (modCatalog.catalog.some(mod => !["compatible", "incompatible", "unknown"].includes(mod.currentRuntimeCompatibility?.status) || !mod.currentRuntimeCompatibility.reason || !mod.currentRuntimeState || !mod.artifactQualification || !mod.effectivenessQualification)) throw new Error("Standalone Mod compatibility contract failed");
  const instance = await fetch(`http://127.0.0.1:${port}/api/mod-runtime`);
  const instanceData = await instance.json();
  if (!instance.ok || instanceData.administrator || instanceData.applicationAvailable !== false || instanceData.tasks.length || !instanceData.lifecycle || !Array.isArray(instanceData.mods)) throw new Error("Standalone runtime catalog failed");
  const favicon = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
  const faviconType = (favicon.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
  if (!favicon.ok || !["image/x-icon", "image/vnd.microsoft.icon"].includes(faviconType)) {
    throw new Error(`Standalone favicon route failed: ${favicon.status} ${faviconType || "missing content-type"}`);
  }
  assertDecodableIco(Buffer.from(await favicon.arrayBuffer()));
  console.log("Standalone startup, read-only catalog, and favicon probes passed");
} finally {
  if (child.exitCode === null && !spawnError) {
    await new Promise(resolve => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 2000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.kill("SIGTERM");
    });
  }
}
