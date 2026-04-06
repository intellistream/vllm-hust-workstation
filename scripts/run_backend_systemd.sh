#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_HOME="${WORKSTATION_DEPLOY_HOME:-$REPO_DIR/.workstation-deploy}"
SYSTEMD_ENV_FILE="${WORKSTATION_BACKEND_SYSTEMD_ENV_FILE:-$DEPLOY_HOME/backend-systemd.env}"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/runtime_manager.sh"

if [[ -f "$SYSTEMD_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SYSTEMD_ENV_FILE"
  set +a
fi

if [[ -f "$REPO_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_DIR/.env" 2>/dev/null || true
  set +a
fi

default_tool_call_parser_for_model() {
  local model="${1:-}"
  case "$model" in
    Qwen/Qwen2.5-*|Qwen/QwQ-*) printf 'hermes\n' ;;
    Qwen/Qwen3-Coder-*) printf 'qwen3_xml\n' ;;
    meta-llama/Llama-3.2-*) printf 'pythonic\n' ;;
    meta-llama/Llama-4-*) printf 'llama4_pythonic\n' ;;
    *) printf 'openai\n' ;;
  esac
}

detect_backend_from_hardware() {
  if command -v npu-smi >/dev/null 2>&1; then
    printf 'ascend\n'
    return 0
  fi
  if command -v nvidia-smi >/dev/null 2>&1; then
    printf 'cuda\n'
    return 0
  fi
  if command -v rocminfo >/dev/null 2>&1; then
    printf 'rocm\n'
    return 0
  fi
  printf 'cpu\n'
}

bootstrap_backend() {
  local raw="${WORKSTATION_BOOTSTRAP_BACKEND:-}"
  local auto_detect="${WORKSTATION_AUTO_DETECT_BACKEND:-true}"

  if [[ -n "$raw" && "$raw" != "auto" ]]; then
    printf '%s\n' "$raw" | tr '[:upper:]' '[:lower:]'
    return 0
  fi

  if [[ "$auto_detect" == "true" ]]; then
    detect_backend_from_hardware
    return 0
  fi

  printf '%s\n' "${BACKEND_TYPE:-cpu}" | tr '[:upper:]' '[:lower:]'
}

bootstrap_model() {
  if [[ -n "${WORKSTATION_BOOTSTRAP_MODEL:-}" ]]; then
    printf '%s\n' "$WORKSTATION_BOOTSTRAP_MODEL"
    return 0
  fi

  case "$(bootstrap_backend)" in
    cuda|ascend|rocm)
      printf 'Qwen/Qwen2.5-7B-Instruct\n'
      ;;
    *)
      printf 'Qwen/Qwen2.5-1.5B-Instruct\n'
      ;;
  esac
}

backend_target_device() {
  case "$1" in
    cpu) printf 'cpu\n' ;;
    cuda) printf 'cuda\n' ;;
    rocm) printf 'rocm\n' ;;
    ascend) printf 'npu\n' ;;
    *) printf '\n' ;;
  esac
}

find_ascend_toolkit_home() {
  local candidate
  for candidate in \
    "${ASCEND_TOOLKIT_HOME:-}" \
    /usr/local/Ascend/ascend-toolkit/latest \
    /usr/local/Ascend/ascend-toolkit.bak.8.1/latest
  do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

prepare_backend_runtime_env() {
  local backend="$1"
  local parent_dir
  local ascend_env_script=""
  local toolkit_home

  if [[ "$backend" != "ascend" ]]; then
    return 0
  fi

  parent_dir="$(cd "$SCRIPT_DIR/.." && pwd)"
  if [[ -f "$parent_dir/vllm-ascend-hust/scripts/use_single_ascend_env.sh" ]]; then
    ascend_env_script="$parent_dir/vllm-ascend-hust/scripts/use_single_ascend_env.sh"
  elif [[ -f "$parent_dir/vllm-hust/scripts/use_single_ascend_env.sh" ]]; then
    ascend_env_script="$parent_dir/vllm-hust/scripts/use_single_ascend_env.sh"
  fi

  if [[ -z "$ascend_env_script" ]]; then
    return 0
  fi

  toolkit_home="$(find_ascend_toolkit_home || true)"
  if [[ -z "$toolkit_home" ]]; then
    return 0
  fi

  # shellcheck disable=SC1090
  source "$ascend_env_script" "$toolkit_home"

  if [[ -d "$toolkit_home/python/site-packages" ]]; then
    export PYTHONPATH="$toolkit_home/python/site-packages${PYTHONPATH:+:$PYTHONPATH}"
  fi
}

gateway_port() {
  local base_url="${VLLM_HUST_BASE_URL:-http://localhost:8080}"
  local authority="${base_url#*://}"
  authority="${authority%%/*}"
  if [[ "$authority" == *:* ]]; then
    printf '%s\n' "${authority##*:}"
    return 0
  fi
  if [[ "$base_url" == https://* ]]; then
    printf '443\n'
  else
    printf '80\n'
  fi
}

gateway_host() {
  local base_url="${VLLM_HUST_BASE_URL:-http://localhost:8080}"
  local authority="${base_url#*://}"
  authority="${authority%%/*}"
  printf '%s\n' "${authority%%:*}"
}

ensure_local_gateway_target() {
  case "$(gateway_host)" in
    localhost|127.0.0.1|0.0.0.0|host.docker.internal)
      return 0
      ;;
    *)
      echo "VLLM_HUST_BASE_URL must target a local backend for systemd management: ${VLLM_HUST_BASE_URL:-http://localhost:8080}" >&2
      exit 1
      ;;
  esac
}

main() {
  local backend model port engine_port python_bin pythonpath serve_help target_device
  local gpu_memory_utilization tool_call_parser compile_custom_kernels treat_as_ascend_runtime
  local library_path effective_library_path hf_endpoint backend_api_key
  local disable_prefix_caching="false"
  local disable_chunked_prefill="false"
  local -a serve_args env_assignments command_words

  ensure_local_gateway_target

  backend="$(bootstrap_backend)"
  model="$(bootstrap_model)"
  port="$(gateway_port)"
  engine_port="${WORKSTATION_ENGINE_PORT:-$((port + 1))}"
  pythonpath="${WORKSTATION_VLLM_PYTHONPATH:-$(build_workspace_pythonpath)}"
  python_bin="${WORKSTATION_VLLM_PYTHON_BIN:-}"
  library_path="${WORKSTATION_VLLM_LIBRARY_PATH:-}"
  hf_endpoint="${HF_ENDPOINT:-https://hf-mirror.com}"
  backend_api_key="${WORKSTATION_VLLM_API_KEY:-${VLLM_HUST_API_KEY:-}}"
  target_device="$(backend_target_device "$backend")"
  gpu_memory_utilization="${WORKSTATION_GPU_MEMORY_UTILIZATION:-}"
  tool_call_parser="${WORKSTATION_TOOL_CALL_PARSER:-$(default_tool_call_parser_for_model "$model")}"
  compile_custom_kernels="${WORKSTATION_ASCEND_COMPILE_CUSTOM_KERNELS:-0}"
  treat_as_ascend_runtime="false"

  if [[ -z "$python_bin" ]]; then
    if command -v python3 >/dev/null 2>&1; then
      python_bin="$(command -v python3)"
    elif command -v python >/dev/null 2>&1; then
      python_bin="$(command -v python)"
    fi
  fi

  if [[ "$backend" == "ascend" ]]; then
    treat_as_ascend_runtime="true"
    if [[ -z "$gpu_memory_utilization" ]]; then
      gpu_memory_utilization="${WORKSTATION_ASCEND_GPU_MEMORY_UTILIZATION:-0.35}"
    fi
    disable_prefix_caching="true"
    disable_chunked_prefill="true"
  fi

  prepare_backend_runtime_env "$backend"
  if [[ "$backend" == "cpu" ]] && command -v npu-smi >/dev/null 2>&1; then
    prepare_backend_runtime_env "ascend"
  fi

  if [[ -n "$target_device" ]]; then
    env_assignments+=(VLLM_TARGET_DEVICE="$target_device")
  fi
  effective_library_path="${library_path:-${LD_LIBRARY_PATH:-}}"
  if [[ -n "$effective_library_path" ]]; then
    env_assignments+=(LD_LIBRARY_PATH="$effective_library_path")
  fi
  if [[ -n "$backend_api_key" && "$backend_api_key" != "not-required" ]]; then
    env_assignments+=(VLLM_API_KEY="$backend_api_key")
  fi
  env_assignments+=(
    PYTHONNOUSERSITE=1
  )
  unset VLLM_HUST_BASE_URL
  unset VLLM_HUST_API_KEY
  unset VLLM_HUST_PREFLIGHT_CANARY
  unset VLLM_HUST_STARTUP_CANARY
  unset VLLM_HUST_PERIODIC_CANARY
  if [[ -n "$pythonpath" ]]; then
    env_assignments+=(PYTHONPATH="$pythonpath")
  fi
  if [[ -n "$hf_endpoint" ]]; then
    env_assignments+=(HF_ENDPOINT="$hf_endpoint")
  fi
  if [[ -n "${HF_TOKEN:-}" ]]; then
    env_assignments+=(HF_TOKEN="$HF_TOKEN")
  fi

  serve_help=""
  if [[ -n "${WORKSTATION_VLLM_SERVE_BIN:-}" && -x "${WORKSTATION_VLLM_SERVE_BIN}" ]]; then
    serve_help="$(env "${env_assignments[@]}" "${WORKSTATION_VLLM_SERVE_BIN}" serve --help 2>&1 || true)"
    command_words=("${WORKSTATION_VLLM_SERVE_BIN}")
  elif command -v vllm-hust >/dev/null 2>&1 && env "${env_assignments[@]}" vllm-hust serve --help >/dev/null 2>&1; then
    serve_help="$(env "${env_assignments[@]}" vllm-hust serve --help 2>&1 || true)"
    command_words=("$(command -v vllm-hust)")
  else
    if [[ -z "$python_bin" ]]; then
      echo "Unable to resolve Python runtime for backend service" >&2
      exit 1
    fi
    serve_help="$(env "${env_assignments[@]}" "$python_bin" -m vllm.entrypoints.cli.main serve --help 2>&1 || true)"
    command_words=("$python_bin" -m vllm.entrypoints.cli.main)
  fi

  if [[ -z "$serve_help" ]]; then
    echo "Unable to resolve vllm-hust serve runtime for backend service" >&2
    exit 1
  fi

  serve_args=(serve)
  if [[ "$serve_help" == *"--backend"* ]]; then
    serve_args+=(--backend "$backend")
  fi
  if [[ "$serve_help" == *"--model"* ]]; then
    serve_args+=(--model "$model")
  else
    serve_args+=("$model")
  fi
  serve_args+=(--host 0.0.0.0 --port "$port")
  if [[ -n "$target_device" && "$serve_help" == *"--device"* ]]; then
    serve_args+=(--device "$target_device")
  fi
  if [[ -n "$gpu_memory_utilization" && "$serve_help" == *"--gpu-memory-utilization"* ]]; then
    serve_args+=(--gpu-memory-utilization "$gpu_memory_utilization")
  fi
  if [[ "$serve_help" == *"--engine-port"* ]]; then
    serve_args+=(--engine-port "$engine_port")
  fi
  if [[ "$treat_as_ascend_runtime" == "true" ]]; then
    serve_args+=(--enforce-eager)
    if [[ "$serve_help" == *"--compilation-config"* ]]; then
      serve_args+=(--compilation-config '{"mode":0,"cudagraph_mode":"NONE"}')
    fi
    if [[ "$serve_help" == *"--additional-config"* ]]; then
      serve_args+=(--additional-config '{"ascend_compilation_config":{"enable_npugraph_ex":false,"enable_static_kernel":false}}')
    fi
  fi
  if [[ "$disable_prefix_caching" == "true" && "$serve_help" == *"--enable-prefix-caching"* ]]; then
    serve_args+=(--no-enable-prefix-caching)
  fi
  if [[ "$disable_chunked_prefill" == "true" && "$serve_help" == *"--enable-chunked-prefill"* ]]; then
    serve_args+=(--no-enable-chunked-prefill)
  fi
  serve_args+=(--enable-auto-tool-choice)
  if [[ -n "$tool_call_parser" ]]; then
    serve_args+=(--tool-call-parser "$tool_call_parser")
  fi

  exec env "${env_assignments[@]}" "${command_words[@]}" "${serve_args[@]}"
}

main "$@"