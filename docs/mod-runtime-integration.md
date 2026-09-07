# Instance-oriented Mod integration

Status: implementation in progress. This document is an acceptance contract, not
a claim that runtime application is delivered. The current plugin boundary audit
is [the BidKV guide alignment review](mod-plugin-guide-alignment.md); dated
preparation evidence below describes historical artifacts, not current acceptance.

## Product goal

An administrator selects an inference instance, prepares a compatible deployment,
reviews the exact restart impact, applies it, and can restore the preceding
deployment. The UI reports effective Mods from fresh process-specific evidence,
not package installation or saved enable intent.

## Ownership and supported scope

- The artifact library builds and hashes reviewed wheels. It is a staging area,
  not the environment that serves inference.
- The runtime owner enrolls a target explicitly with an immutable base image,
  model identity, device reservation, port, launch configuration and permitted
  lifecycle adapter. Discovery alone never grants mutation authority.
- Web clients select registered IDs; they cannot submit executable paths, shell
  commands, Docker flags, device lists, arbitrary image URLs or health evidence.
- The target's serving Python must load the prepared extension artifacts. Do not
  install into a live environment. Produce a new immutable deployment revision.
- Start with one reviewed Mod per instance. Multi-Mod composition requires a
  separate domain-conflict and merge policy; this is not an ecosystem limitation.
- External systems such as PegaFlow retain their own lifecycle owner.

## State and lifecycle

Maintain artifact state, desired deployment and observed runtime separately.

1. **Inspect target:** collect current immutable image, core/Ascend SHAs and
   installed versions. A compatibility-baseline label is not an installed version.
2. **Preflight:** check the pinned Mod manifest against actual versions, domain
   contracts, model, architecture, memory/resource admission and required options.
   Unknown evidence is not compatible. Host-range matching alone is not sufficient.
3. **Prepare:** build a candidate from the exact base image and verified wheel
   hashes; render host-provider activation into a revision-specific configuration.
   Do not execute a workload, restart a service or allocate devices in this phase.
4. **Review:** show target, current/candidate revisions, selected Mod and version,
   model, device/port impact, restart requirement and rollback revision. The server
   issues a short-lived, single-use approval bound to the complete plan hash and
   current target identity. Changing any input invalidates it.
5. **Apply:** lock the target, revalidate identity and reservation, persist recovery
   state, then invoke only the registered lifecycle adapter. Reject concurrent or
   replayed changes. Record the old revision before stopping anything.
6. **Verify:** inspect the newly launched process and workers, confirm the exact
   extension/component was materialized, and pass model health and bounded
   inference checks. Bind evidence to deployment ID, container ID, process start,
   source/artifact hashes and configuration hash. Installation, environment
   variables, package import and a healthy HTTP endpoint alone do not prove this.
7. **Rollback:** failed verification restores the previous revision and verifies
   its identity and health. Failed rollback is an actionable failure, never a
   successful apply. A Web restart must not lose the recovery journal.

Disable is an application of a revision without the Mod and has the same approval,
restart, verification and rollback requirements. Artifact removal is blocked while
any current, pending or retained rollback revision references it. Removing an
artifact does not deactivate a running process.

## UX

The primary context is the selected inference instance. Show compatible choices
and concise reasons for unavailable ones. Put artifact preparation in version
details, not a standalone misleading “enable” action. Main states are prepared,
pending application, verifying, effective, rolling back and failed. Unknown or
stale observation must never show effective. Detailed engineering diagnostics live
in expandable checks and task logs, not a persistent warning wall.

## Current evidence and first admission gate (2026-09-03)

The workstation currently points at the shared Sage Mate backend on loopback
port 18001. It is not an independent workstation-owned serving instance.
Identity-bound inspection at 05:27 UTC observed image ID:
`sha256:5e7f82c78a3b0bc786e0e994e71d012af2f667bff3dc3380c77353dd7493a1f9`.
Core package: `0.28.1rc1.dev319+g762f85b31.empty`; Ascend package:
`0.25.1rc1+hust.20260903.2`, commit
`164860f3095362efe5ccab9ed3486bd665c00baa`. The `v0.23.0` compatibility label must not substitute
for either package version.

The manifests reviewed on 2026-09-03 historically required:

| Mod | Host package range | Additional admission requirements |
| --- | --- | --- |
| BidKV | vllm >=0.23,<0.24 | scheduler-policy v1 and scheduler materialization evidence |
| DiffSpec | vllm-ascend >=0.23,<0.24 | draft model and acceptance of unversioned patch surfaces |
| LatchMoE | vllm ==0.21.0 | MoE offload seam v1, supported MoE model and documented launch limits |

Those historical ranges were outside the shared image. They are preserved as
dated evidence, not current declarations. The 2026-09-04 qualified candidates
target Core `0.28.1rc1.dev319` at `762f85b3` and Ascend `0.25.1rc1` at
`4e57439e`; DiffSpec additionally binds Qwen3.8-27B, TP4 FULL_DECODE_ONLY graph,
and the hashed `VirVen/Qwen3.5-27B-EAGLE3-v2` draft. These ranges
are reviewable declarations, not permanent prohibitions. The user selected the
existing workstation instance and authorized revisiting compatibility descriptions.
Requalify exact versions and update declarations with the adaptation code and
acceptance evidence; never widen ranges just to bypass validation or silently
downgrade the shared service. Restart approval is a separate gate.

### Updating compatibility declarations

The catalog presents the pinned manifest as a **historical declaration baseline**,
not as a negative verdict on a newer runtime. Current-instance qualification is
separate and remains pending. Detailed baseline dependencies are collapsed in the
UI; changing this presentation does not change the executable manifest or bypass
any admission check.

For an update, record the exact Mod source/wheel, Core and Ascend source/wheels,
immutable image, model/draft model, hardware topology and launch options. Review
the required interfaces and port the Mod or host integration when they changed.
Keep each level of evidence distinct:

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Manifest / AST inspection | Declared assumptions and candidate interfaces | Working registration or algorithm behavior |
| Same-image preparation / import | Reproducible artifacts and exercised import paths | Worker materialization or successful inference |
| Selected-instance acceptance | Actual load, bounded inference and tested rollback for the exact tuple | All intervening releases, models or device layouts |

Only the last level, together with interface/behavior regression checks, supports
a new qualified tuple. Update the source manifest and adaptation documentation
together with the relevant code and evidence. A single successful tuple does not
justify an open-ended version range. Preserve older evidence as historical and
keep runtime activation separate: a previously qualified Mod may not be active in
the current process.

The static inventory found no `vllm/plugins/contracts.py` for BidKV. Seven sampled
DiffSpec patch targets are present, which warrants further signature and behavior
review but is not proof of compatibility. Latest reviewed-source candidates:
BidKV `9f2428aaf45ae25c3ad44b199a6401f8d59f1f3d`, DiffSpec
`762959978514cdd01407b58f1015a75f2ae2c936`, LatchMoE
`3b9d8ba225794dbccb6fb3160401035e64ae6823`. Library pins remain unchanged until
the newer revisions have been qualified.

Reproduce the read-only inventory with:

```bash
python3 scripts/inspect_mod_runtime.py --sudo <selected-container-name>
```

Supply `--python-bin /absolute/serving/python` from the enrolled owner configuration
when the container's default Python is not its serving interpreter.

It reads installed metadata, the embedded artifact lock and selected source ASTs
without importing vLLM, Torch or device code. Collection uses immutable container
ID and rejects replacement/restart during inspection. It never reports a Mod
active or compatible from static observations alone.

### Preliminary DiffSpec software check

With the reviewed `vllm_diffspec-0.2.0` wheel on the same immutable image,
`diffspec.plugin.register()` returned successfully in a fresh diagnostic container.
The container had no accelerator devices, model mounts, published ports, network
or credentials. Its root filesystem and wheel/driver-library mounts were read-only;
only temporary storage was writable. Core patch registration succeeded despite the
old declared 0.23 range. Ascend runner hooks are lazy, so this result does not prove
their execution or any real inference. The first attempt omitted host driver
libraries and failed at Torch-NPU import; that was a diagnostic-environment issue,
not a negative Mod compatibility result.

Directly importing `vllm_ascend.worker.model_runner_v1` then failed with a
`DeviceOperator` circular import. The identical baseline import **without
DiffSpec** failed the same way. Therefore this probe does not establish a
DiffSpec regression; worker-path validation must reproduce the normal launcher
import order before drawing a compatibility conclusion.

## Acceptance checklist

- Unit tests: unknown/stale provenance, prereleases, mismatched SHAs, missing
  contracts, invalid configuration, plan changes, expired/replayed approvals,
  foreign target/device ownership and anonymous mutations all fail closed.
- Adapter integration: prepare never restarts; apply loads the artifact in the
  serving environment; crash recovery and verified rollback work. Fake adapters
  prove control logic only and are labelled as such.
- Real target: successful load plus bounded inference and an observed rollback,
  with resource ownership and immutable evidence captured before and after.
- Browser: public read-only and administrator flows, keyboard confirmation,
  mobile/light/dark, errors/loading, no false effective state.
- Delivery: separate reviewed commits, Web/control-plane-only release until a
  particular serving-instance transition has been explicitly approved.

## Implemented preparation and transaction primitives

### Instance control-plane preparation

`GET /api/mod-runtime` projects the explicitly enrolled current Workstation target:
verified container/image/source identity, live upstream model IDs, and an **unknown**
effective-Mod observation. Public callers see no task logs or private launcher
paths. A container provenance receipt does not become worker/inference proof.

The operator supplies `WORKSTATION_MOD_RUNTIME_CONFIG`, a private mode-0600 JSON
file with schema `workstation.mod-runtime-config/v1` and a `target` object:

```json
{
  "schema": "workstation.mod-runtime-config/v1",
  "target": {
    "id": "workstation-current",
    "label": "Current Workstation inference",
    "ownership": "shared",
    "containerName": "operator-selected-container",
    "pythonBin": "/absolute/serving/python",
    "upstreamUrl": "http://127.0.0.1:18001"
  }
}
```

The container and normalized upstream must match the existing deployment's
`WORKSTATION_RUNTIME_CONTAINER` and `VLLM_HUST_BASE_URL`. The registry is not
editable through the API. `WORKSTATION_MOD_RUNTIME_DIR` is a separate private,
operator-owned directory for task journals and derived image contexts. The
existing `WORKSTATION_MOD_DIR` remains the artifact library. This enrollment
permits observation/preparation only, **not serving lifecycle control**.

`WORKSTATION_DEPLOYMENT_RECEIPT_FILE` is optional and deliberately separate
from the exact-key v1 target registration, so an older service can safely ignore
it during an atomic release transition. When present, it must name a trusted
deployment-receipt index whose active model, Core/Ascend commits, graph mode and
TP/device topology match the live provenance. It supports candidate artifact
eligibility; it is not the complete dev-hub `DeploymentSpec`, rollback authority,
or proof that a Mod is currently effective.

Authenticated `POST /api/mod-runtime` accepts exactly
`{"action":"prepare","targetId":"...","modId":"...","riskAcknowledged":true}`.
The acknowledgement is required because every currently qualified candidate has
a negative measured performance cell; it authorizes preparation only. Source pins, interpreter,
container and paths come from reviewed server data, never browser launch fields.
The durable worker:

1. Rechecks immutable container identity and installed artifact lock in the exact
   registered serving Python.
2. Acquires a preparation lock and the same library lock used by installation and
   removal. Missing Mod artifacts are built from the catalog's fixed sources.
3. Prepares a derived immutable image without NPU/model/port access or serving
   transitions, then rechecks the target.
4. Records prepared-but-unapplied, or superseded if the target changed/cannot be
   reverified. Candidate evidence is retained in either case.

Confirmed abnormal executor exit is marked interrupted; it does not prove a
daemon-side build stopped. Unresolved queued/preparing/interrupted journals block
new submissions until examined. Neither age nor a UI polling timeout causes an
automatic retry. Application/disable/rollback API requests still fail closed:
the real owner adapter, generation fencing and serving qualification are not yet
implemented. The existing transaction coordinator alone is not that adapter.

The page makes the target and runtime preparation primary. Legacy library controls
are secondary disclosures; their saved enable intent is not runtime activation.

`scripts/prepare_mod_image.py` moves reviewed library wheels into a derived
runtime image, using the explicitly specified serving interpreter. It does not
use the library venv as the inference environment. It verifies wheel hashes and
distribution names before building, disables Docker build/probe network and pip dependency resolution,
checks base-layer ancestry and unchanged Core/Ascend wheel metadata afterwards,
and validates installed bundle registration in the same interpreter. Prepared
images default the Manager enable list to empty; activation belongs to the
approved launch configuration. No model/device/port is used by these checks.

```bash
python3 scripts/prepare_mod_image.py --sudo \
  --library /absolute/operator-owned/mod-library \
  --output-root /absolute/private/prepared-images \
  --mod diffspec --source-sha <reviewed-40-character-sha> \
  --manager-sha <reviewed-40-character-manager-sha> \
  --base-image-id sha256:<full-local-image-id> \
  --python-bin /absolute/serving/interpreter/python
```

Build contexts contain only the Dockerfile and reviewed wheel archives. A missing
Manager `platformdirs` dependency is downloaded separately from a fixed official
PyPI wheel URL and verified against its pinned SHA256 before entering the build.
Existing `packaging` and `platformdirs` packages are preserved when supported;
unsupported installed versions fail instead of being silently upgraded/downgraded.
Receipts
record source pins, image IDs, serving Python and verified package hashes, and
always retain `runtimeActivationVerified: false`. Failed preparation keeps a
failed receipt and its context. Tags are local preparation handles; deployments
must consume the resulting immutable image ID, never the tag.

The historical `scripts/mod_deployment.py` prototype has now been removed. The
single implementation lives in the pinned dev-hub dependency under
`scripts/instance_control/`; its strict complete `DeploymentSpec` intentionally
does not accept the prototype's `imageId/configurationHash`-only revisions.
`scripts/instance_control_client.py` is the Workstation thin transport client,
and `mod_artifact_io.py` retains only atomic preparation/task receipt writes.
Historical prototype behavior and tests informed the new dev-hub tests:

- Pure preparation issues an expiring, one-use approval for a complete plan hash.
- Apply rechecks target identity, baseline health and admission, then durably
  consumes approval before the first adapter mutation.
- Only fresh target-specific activation and inference observations produce an
  effective result. Historical transaction success is not a live status API.
- `ownerGeneration` must identify the actual supervisor/process launch generation,
  not a configuration file hash. A changed revision with an unchanged process
  identity is rejected, even when the adapter claims successful verification.
- Failure attempts restoration only while the adapter proves transition ownership.
  A foreign takeover never authorizes stopping or overwriting that target.
- Crash recovery is explicit rollback, not automatic retry/re-application.
- Disable and manual rollback are revision transitions with their own approvals;
  neither is a package-removal shortcut.

Adapters are supplied by trusted server code and must implement the real owner
launcher, exact transition ownership and bounded observation/verification. The
coordinator's fake-adapter tests prove transaction behavior, **not** a production
restart, rollback or Mod inference. Production adapter enrollment, HTTP/UI wiring,
integration of worker evidence into owner observations and selected-instance
acceptance remain unfinished.

### Default-off dev-hub extraction milestone

Initialize the reproducible dependency after cloning:

```bash
git submodule update --init deps/vllm-hust-dev-hub
```

The parent gitlink and `deploy/instance-control-source-lock.json` pin the producer.
The source lock verifies packaged producer files when Next standalone has no Git
metadata. This verifies code provenance, not deployment or administrator authority.
The client starts no process and reads no store while disabled. With the local
diagnostic gate enabled it can inspect the pinned producer, which currently reports
`authorityAvailable=false`; all mutating requests remain rejected. The Web runtime
API still has `applicationAvailable=false` and does not consume Web login as host
approval. No live config or service is changed by this extraction.

There is no automatic migration of old prototype approvals/journals, and existing
preparation receipts remain intact. Future enrollment requires capturing a complete
new baseline and newly approved plans; an old successful fake transaction must not
be converted into a production deployment. The dev-hub contract documents pending
production backend, owner OS permission/fencing, foreground supervision, Manager
render integration and UI approval wiring. Actual enablement remains separate.

### Worker witness integration

DiffSpec preparations now also contain a separate `workstation-mod-runtime` wheel,
built deterministically from `scripts/runtime/workstation_mod_runtime/`. The wheel
embeds the selected Mod source/wheel identity and the proposer file hash extracted
from that exact wheel. Both installed metadata and the component file must match.
The canonical Mod artifact is not rewritten. Other Mods do not yet have a witness
implementation and must not inherit a DiffSpec qualification result.

The approved owner launch must explicitly set all of the following (there is no
production owner adapter enrolled yet):

- Use canonical Manager/Provider admission and rendering. Preserve the baseline
  `VLLM_PLUGINS` allowlist and include both the canonical `diffspec` entrypoint and
  `workstation_mod_runtime` in the frozen, reviewed host configuration. The witness
  only attaches an observation hook; it never calls the Mod registration function.
  The host owns the canonical call. Allowlist/intent strings alone prove neither
  admission nor execution.
- Let Manager emit `VLLMHUST_EXT_ENABLED_BUNDLES`; do not fabricate this variable
  as a substitute for Manager admission. Configure the actual speculative
  `draft_context_policy=diffspec` through Provider `launch_options`.
- Provide `WORKSTATION_MOD_CONTEXT` as server-rendered JSON containing
  `deploymentId`, `targetId`, `configurationHash`, `workerCount`, `targetModel`,
  `draftModel` and `speculativeTokens`. These must derive from the reviewed target
  plan, not arbitrary browser environment variables. Both enable/context variables
  default to empty in the prepared image.

Successful `AscendDiffSpecEagleProposer.load_model()` must create a non-null
DiffSpec cache with matching actual model/policy/token configuration. Only then is
a model-loaded record emitted. A subsequent successful `_run_merged_draft()` emits
the first draft-executed record; later successful drafts do not write per-token
logs. A failed reload removes the previous record before calling the original
load method. Algorithm return values and original exceptions are preserved;
failure to emit a record after a successful call leaves observation unverified.
Failure to invalidate a prior record fails the reload rather than retaining a
stale success.

Records live inside the container at
`/tmp/workstation-mod-evidence/<deployment-id>/<pid>-<start-ticks>.json`, with
private directories and atomic mode-0600 files. The collector executes in the
selected container's PID namespace and serving Python:

```text
<serving-python> -m workstation_mod_runtime
# stdin: the exact server-owned context JSON
```

It imports no engine/device code, checks the complete rank set and live PID/start
ticks/boot identity, rejects mismatched or malformed records, and rechecks worker
liveness before returning. The adapter must additionally bracket collection with
immutable container/image/owner-generation checks. Missing or stale evidence
cannot authorize a transition.

This is **process-owned materialization evidence**, not a cryptographic attestation
against a malicious container or proof of all process-memory bytes. Source SHA is
build provenance; the component file hash is checked against the prepared wheel.
A successful draft can be startup/warmup activity. Collection therefore always
returns `inferenceVerified: false`; the owner adapter must perform the separate
bounded inference check and bind it to the same deployment before reporting an
effective Mod. Worker fixtures do not count as real serving acceptance.

#### Prepared witness image evidence, 2026-09-03

- Prepared image:
  `sha256:f5930232f4ffebcd666f4014da2685922c95d6e83039b862d50deb80bd00ddbb`.
- Same selected base image `sha256:5e7f82c78a3b0bc786e0e994e71d012af2f667bff3dc3380c77353dd7493a1f9`
  and serving Python `/usr/local/python3.12.13/bin/python`.
- Observer wheel SHA256:
  `ce40a6d9db4b09d064063ed0a65ec44f612f77e2749a66d613dc6c27bb1c201a`.
- Pinned DiffSpec proposer file SHA256:
  `1f06b7615f939470bf4b171962de1abe7bbde8d8d958fc08bbbdc483283895f2`.
- Receipt:
  `/data/vllm-hust-workstation-shuhao/mod-image-preparation.aXwQHQ/prepared/prepare-diffspec-riqd_dkm/receipt.json`.
- Real Docker preparation passed: unchanged Core/Ascend wheel metadata, canonical
  Manager validation, observer entrypoint and default-off/no-engine-import check.
  A separate fresh CPU-only, network-disabled, read-only container collected no
  workers and correctly returned materialization/execution/inference false.
- 79 Python tests (including 17 worker-witness fixture tests), 84 Vitest tests,
  zero-warning lint and diff checks passed. No NPU, model, serving port or
  production transition was used. The selected Sage Mate container remained
  `5f3cae57a2c5`, started 05:23:58Z.

This image is prepared, not applied or qualified for actual serving. No new
compatibility range or successful runtime rollback is claimed by these checks.

### Preparation evidence, 2026-09-03

The full real DiffSpec image preparation passed on the selected baseline:

- Base image: `sha256:5e7f82c78a3b0bc786e0e994e71d012af2f667bff3dc3380c77353dd7493a1f9`.
- Prepared image: `sha256:a8ba4d9270d52d3e0217ad734e8d7bdecceafe2e0ac49e7a2bf5d1e4f0a92bfd`.
- Serving interpreter: `/usr/local/python3.12.13/bin/python` (from owner launch configuration).
- DiffSpec wheel SHA256: `298509ae3376ba711e3ad2732a0595338702d3c2db2ff5ab2a56cce2c995178f`.
- Manager wheel SHA256: `ab5da81c7612045d459ad7cd29df5155efa622573fd0670dbfb6e4eabe4983d2`.
- Missing support dependency: `platformdirs==4.3.6`, wheel SHA256
  `73e575e1408ab8103900836b97580d5307456908a03e92031bab39e4554cc3fb`.
- Core/Ascend wheel metadata unchanged; existing `packaging==26.3` preserved;
  installed bundle validation passed without loading the engine or a model.
- Receipt and build context:
  `/data/vllm-hust-workstation-shuhao/mod-image-preparation.aXwQHQ/prepared/prepare-diffspec-s0o6g1dp/receipt.json`.

An earlier metadata-only preparation and the failed missing-dependency preparation
remain preserved under the same private output root. The prepared image was not
applied to the shared instance. No inference, accelerator access or actual service
rollback is claimed by this preparation evidence.

Verification: 82 Vitest tests, 62 Python tests and zero-warning ESLint passed.
The 25 deployment-transaction tests use a fake adapter; the image preparation
above is real Docker execution with no devices or published ports.

### Historical-baseline presentation acceptance, 2026-09-03

Web revision `919f086` was published without changing any inference launch
configuration. Historical declarations now live in a keyboard-operable disclosure,
with current-instance qualification explicitly pending. This release does not
claim new runtime compatibility or complete the instance integration above.

- 84 Vitest tests, zero-warning lint, production build and standalone startup
  passed. The build reported an outdated Browserslist dataset warning.
- Local candidate and real public `/mods` passed the browser audit at 1440 and
  390×844, light/dark: disclosure keyboard open/close, no horizontal overflow,
  search/empty, invalid login and read-only access. Ten administrator **fixture**
  actions were intercepted inside the browser, not sent to the real backend;
  error recovery and the disabled runtime gate were checked.
- Text contrast minimums: light 6.31:1, dark 6.92:1; no JavaScript page errors.
  A pre-existing favicon 404 is unrelated to the Mod UI.
- Before: `output/playwright/mod-qualification-before-desktop.png`.
  Public after: `output/playwright/mod-qualification/1440-light-public.png`,
  `1440-dark-public.png`, `390-light-public.png`, `390-dark-public.png`.
  Local candidate evidence is retained in `output/playwright/mod-qualification-local/`.
- Only `vllm-hust-workstation.service` was restarted. Sage Mate container
  `5f3cae57a2c5` (started 05:23:58Z) and statecentric `39bfdfa09ebb`
  (started 06:05:13Z) retained identical full identities and start times across
  publication. Prior Web runtime is recoverable at
  `/data/vllm-hust-workstation-shuhao/archive/pre-qualification-8d4ce87`.

### Instance preparation API and UI acceptance, 2026-09-03

Web revision `9d66437` adds the operator-enrolled current-instance panel and
administrator image preparation. The public view reports the actual upstream
model (`Qwen/Qwen3.8-27B` at acceptance), verified image/source identity and unknown
effective Mods. It does not infer activation from library flags. Image/source
details and historical compatibility declarations remain in disclosures.

The private target registration must match Workstation's configured container
and upstream. The authenticated API accepts only fixed catalog/target IDs, not
commands or arbitrary image/source paths. Preparation rechecks immutable target
identity before and after building; drift supersedes the candidate. Application
remains fail-closed pending the real owner adapter and separate restart approval.

The **real authenticated HTTP** preparation completed successfully:

- Task: `f32e2a62-67c2-469e-9ce2-bc4c70463646`, completed
  `2026-09-03T07:02:51.721539+00:00`.
- Base: `sha256:5e7f82c78a3b0bc786e0e994e71d012af2f667bff3dc3380c77353dd7493a1f9`.
- Candidate: `sha256:80071bd13353b1b11f6f0a3eef13de0ae8cf1dfc1b2a0c527eac1718f9876437`.
- Exact serving Python: `/usr/local/python3.12.13/bin/python`.
- DiffSpec source: `762959978514cdd01407b58f1015a75f2ae2c936`;
  wheel SHA256 `1714fd1d0e00b649bdd29e13193deee32c8a57ee4e2205178be8129e2e4f041d`.
- Manager source: `9fb467447e95d753f7002b28575d6802f4347181`;
  wheel SHA256 `ab5da81c7612045d459ad7cd29df5155efa622573fd0670dbfb6e4eabe4983d2`.
- Observer wheel SHA256:
  `79f4442d28474db25d06c5eab19eb6dfb65b8de4397c5d0fb668eb9ad2197bb1`.
- Core and Ascend installed wheel metadata hashes remain respectively
  `ac0c941e6c076198f9c97c45f878188030f7319cb3d5b1d20b60e8f7168eb51d` and
  `dded797dc0e1fcc967d20dcbb9cfa356827cffa35e48dd616bfac44223c049ba`.
- Private receipt:
  `/data/vllm-hust-workstation-shuhao/mod-runtime/images/prepare-diffspec-a4rtvl_l/receipt.json`.

This is a prepared image, **not applied, runtime-qualified or active**. The
receipt retains the historical manifest declaration and explicitly records
`runtimeActivationVerified: false`. Updating that declaration is permitted after
code adaptation and target-specific qualification; an old range is not a
permanent exclusion, and widening it alone is not acceptance.

Verification: 93 Vitest tests, 87 Python tests, 16 fallback assertions,
zero-warning lint, production build and standalone bundle startup passed.
Real public and local candidate browser audits passed at 1440 and 390×844 in
light/dark themes: read-only access, search/filter/empty states, invalid auth,
keyboard disclosures, no horizontal overflow, and error cleanup. Ten library
actions and two administrator preparation flows were **browser-only intercepted
fixtures**, distinct from the real HTTP task above. Text contrast minimums were
6.31:1 light and 6.92:1 dark; no JavaScript page errors. Visual inspection caught
and corrected a squeezed mobile Mod selector; the audit now asserts its width.

- Before: `output/playwright/mod-instance-before.png`.
- Public after: `output/playwright/mod-instance/1440-light-public.png`,
  `1440-dark-public.png`, `390-light-public.png`, `390-dark-public.png`.
- Administrator fixture: `output/playwright/mod-instance/390-light-admin-fixture.png`
  and `390-dark-admin-fixture.png`; local evidence is in `mod-instance-local/`.

Only the Web service was restarted, before preparation began. Sage Mate retained
container `5f3cae57a2c54e3645892b72a0cf91c0c86a1d1594d368bcab205fe88971f80f`
and start time `2026-09-03T05:23:58.405394962Z` at the post-task check. No Sage Mate
or statecentric control commands were issued. Previous Web runtime is recoverable
at `/data/vllm-hust-workstation-shuhao/archive/pre-mod-instance-919f086`.
Do not restart the Web service while a preparation worker is active: detached
workers still belong to its systemd cgroup. Unresolved tasks block retries rather
than being declared stopped solely from elapsed time.

Remaining integration: cooperative owner-generation fencing, source/model
qualification, owner-bound worker and inference observation, approved real
apply/disable/rollback, and their UI controls. This release is not completion of
the full runtime integration goal.

### Source-pinned launch preflight, 2026-09-03

`mod_compatibility.py` and the preparation worker now compare explicit live-process
launch options with the reviewed DiffSpec validator. The comparison is bound to
source `762959978514cdd01407b58f1015a75f2ae2c936` and `diffspec/runtime.py`
SHA256 `54dead6dc7acd16b3fe573dfefb31b82f654382b2624c73c0612d61bfe4dc0fc`
inside a hash-verified library wheel. A different source or validator requires
review; it cannot silently inherit these checks.

The inspector brackets collection with immutable container identity checks and
projects only selected options from one stable serving PID/start identity. It
never returns raw argv, API keys or model paths. Missing, repeated or ambiguous
options are unknown rather than inferred defaults. CLI evidence is not the
engine's resolved configuration or runtime qualification. Preparation additionally
rejects a changed serving PID/start/options across the build, even if the container
itself remains unchanged.

Read-only collection at `2026-09-03T07:15:51.001220+00:00` observed PID465,
start ticks744175286, in the previously recorded container5f3cae57:

| Explicit launch option | Observed | Fixed source requirement |
| --- | --- | --- |
| Tensor parallelism | 4 | 1 |
| max-num-seqs | 8 | 1 |
| Async scheduling | on | off |
| Prefix caching | off | off |
| dtype | bfloat16 | bfloat16 |

PP, eager mode and quantization remain unknown in this projection because their
flags were absent. The source also requires target/draft eager, single-layer
Eagle3 draft, BF16, padded drafter and non-M-RoPE/non-MLA models. Do not enable eager
or reduce the shared service's parallelism/concurrency to hide these gaps; port
and qualify the intended target configuration. None of these checks changes the
historical manifest range, and all reports keep `ready` and `runtimeQualified`
false. Preparation may still build the artifact and record adaptation requirements.

Receipt: `/data/vllm-hust-workstation-shuhao/mod-runtime/preflight-diffspec-20260903.json`.
Reproduction (no model execution or service transition):

```bash
python3 scripts/mod_compatibility.py \
  --library /operator/private/mod-library --mod diffspec \
  --source-sha 762959978514cdd01407b58f1015a75f2ae2c936 \
  --manager-sha 9fb467447e95d753f7002b28575d6802f4347181 \
  --container operator-enrolled-container \
  --python-bin /absolute/serving/python --sudo
```

The actual Sage Mate owner unit remains active without a cooperative generation
or mutation-lock interface. A default-off owner integration has been requested
from the user; no owner code, unit, launch configuration or running service has
been changed by this preflight work. That authorization and later transition
approval are distinct from image preparation.

Revision `180518c` was published as a Web/control-plane-only update after 102 Python
tests, 93 Vitest tests, lint, production build and standalone helper/startup checks
passed. The deployed CLI repeated the same real read-only preflight at07:19:08Z;
container and PID/start identities were unchanged. No new image build or inference
transition was performed. The preceding Web bundle is recoverable at
`/data/vllm-hust-workstation-shuhao/archive/pre-preflight-9d66437`.
