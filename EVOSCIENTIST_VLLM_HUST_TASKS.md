# EvoScientist -> vllm-hust Task List

## Done Now

- Persist EvoScientist local defaults from workstation bridge when the user config is still untouched.
- Keep workstation runtime bridge behavior: each invocation still uses a temporary `custom-openai` config bound to local `vllm-hust`.
- Update workstation docs to reflect that manual EvoScientist provider/model setup is no longer required for the local stack.

## Pending Validation

- Verify that the first workstation-triggered EvoScientist run rewrites `~/.config/evoscientist/config.yaml` to `custom-openai` with the local `/v1` endpoint.
- Verify that standalone `EvoSci` launched after the bridge seeding now uses the local `vllm-hust` endpoint by default.
- Verify model alignment when the served model changes from the current `DEFAULT_MODEL`.

## Team Tasks

- Add an end-to-end smoke test for `workstation -> EvoScientist -> vllm-hust` covering `/api/evoscientist/chat` and a standalone `EvoSci -p` run after config seeding.
- Add a small admin action in workstation UI to explicitly "sync EvoScientist defaults to local vllm-hust" and show the current effective provider/base URL.
- Define a workload schema for multi-agent runs: request shape, tool count, TTFT, ITL, TPOT, completion tokens, error type, backend, and model ID.
- Build the first multi-agent scenario set using EvoScientist as workload object: literature survey, tool-heavy research, code patch, and long-context synthesis.
- Add pace-aware reporting for EvoScientist sessions based on TTFT, ITL, tool density, and reasoning length.
- Run a cross-backend comparison for the same EvoScientist task set on CUDA and domestic hardware targets.

## Deferred Work

- Build a generic agent scenario harness so EvoScientist is only one workload object among several multi-agent systems.
- Add rollout/trajectory export for future streaming RL data collection.
- Add synthetic task generation and failure replay pipelines for agent workload augmentation.