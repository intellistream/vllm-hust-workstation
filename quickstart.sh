#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/runtime_manager.sh"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
WORKSTATION_BOOTSTRAP_POLICY_CONFIRMED="false"

WORKSTATION_BOOTSTRAP_MODEL_DEFAULT_CPU="Qwen/Qwen2.5-1.5B-Instruct"
WORKSTATION_BOOTSTRAP_MODEL_DEFAULT_ACCEL="Qwen/Qwen2.5-7B-Instruct"
WORKSTATION_HEALTHCHECK_PROMPT="ping"

DEFAULT_STARTUP_MODEL_MENU_VALUES=(
  "Qwen/Qwen2.5-7B-Instruct"
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
  "Qwen/Qwen2.5-14B-Instruct"
  "mistralai/Mistral-7B-Instruct-v0.3"
  "sshleifer/tiny-gpt2"
)

DEFAULT_STARTUP_MODEL_MENU_LABELS=(
  "Qwen 2.5 7B（推荐，中文 / 代码均衡）"
  "DeepSeek R1 Distill Qwen 7B（推理 / 数学 / 代码）"
  "Qwen 2.5 14B（更强综合能力，需要更多显存）"
  "Mistral 7B Instruct（偏英文 / 国际化）"
  "sshleifer/tiny-gpt2（极速烟测 / 最低资源）"
)

CPU_STARTUP_MODEL_MENU_VALUES=(
  "Qwen/Qwen2.5-1.5B-Instruct"
  "Qwen/Qwen2.5-7B-Instruct"
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
  "mistralai/Mistral-7B-Instruct-v0.3"
  "sshleifer/tiny-gpt2"
)

CPU_STARTUP_MODEL_MENU_LABELS=(
  "Qwen 2.5 1.5B（CPU 推荐，质量 / 资源更均衡）"
  "Qwen 2.5 7B（CPU 上较慢，内存压力较大）"
  "DeepSeek R1 Distill Qwen 7B（CPU 上较慢，适合推理场景）"
  "Mistral 7B Instruct（CPU 上较慢，偏英文）"
  "sshleifer/tiny-gpt2（极速烟测 / 最低资源）"
)

CUDA_12GB_STARTUP_MODEL_MENU_VALUES=(
  "Qwen/Qwen2.5-7B-Instruct"
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
  "mistralai/Mistral-7B-Instruct-v0.3"
  "Qwen/Qwen2.5-1.5B-Instruct"
  "sshleifer/tiny-gpt2"
)

CUDA_12GB_STARTUP_MODEL_MENU_LABELS=(
  "Qwen 2.5 7B（12GB CUDA 推荐，中文 / 代码均衡）"
  "DeepSeek R1 Distill Qwen 7B（12GB CUDA 推荐，推理更强）"
  "Mistral 7B Instruct（12GB CUDA 可用，偏英文）"
  "Qwen 2.5 1.5B（更轻更稳，适合快速启动）"
  "sshleifer/tiny-gpt2（极速烟测 / 最低资源）"
)

CUDA_8GB_STARTUP_MODEL_MENU_VALUES=(
  "Qwen/Qwen2.5-1.5B-Instruct"
  "Qwen/Qwen2.5-3B-Instruct"
  "microsoft/Phi-3-mini-4k-instruct"
  "Qwen/Qwen2.5-7B-Instruct"
  "sshleifer/tiny-gpt2"
)

CUDA_8GB_STARTUP_MODEL_MENU_LABELS=(
  "Qwen 2.5 1.5B（8GB CUDA 推荐，最稳妥）"
  "Qwen 2.5 3B（8GB CUDA 推荐，质量更高）"
  "Phi-3 mini 4k（8GB CUDA 推荐，英文 / 代码）"
  "Qwen 2.5 7B（8GB 上可能吃紧，谨慎尝试）"
  "sshleifer/tiny-gpt2（极速烟测 / 最低资源）"
)

CUDA_16GB_STARTUP_MODEL_MENU_VALUES=(
  "Qwen/Qwen2.5-7B-Instruct"
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
  "Qwen/Qwen2.5-14B-Instruct"
  "mistralai/Mistral-7B-Instruct-v0.3"
  "sshleifer/tiny-gpt2"
)

CUDA_16GB_STARTUP_MODEL_MENU_LABELS=(
  "Qwen 2.5 7B（16GB CUDA 推荐，稳妥首选）"
  "DeepSeek R1 Distill Qwen 7B（16GB CUDA 推荐，推理更强）"
  "Qwen 2.5 14B（16GB 上可尝试，视量化与上下文而定）"
  "Mistral 7B Instruct（16GB CUDA 可用，偏英文）"
  "sshleifer/tiny-gpt2（极速烟测 / 最低资源）"
)

CUDA_24GB_STARTUP_MODEL_MENU_VALUES=(
  "Qwen/Qwen2.5-14B-Instruct"
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B"
  "Qwen/Qwen2.5-7B-Instruct"
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
  "sshleifer/tiny-gpt2"
)

CUDA_24GB_STARTUP_MODEL_MENU_LABELS=(
  "Qwen 2.5 14B（24GB+ CUDA 推荐，更强综合能力）"
  "DeepSeek R1 Distill Qwen 14B（24GB+ CUDA 推荐，推理更强）"
  "Qwen 2.5 7B（更省显存的稳妥选择）"
  "DeepSeek R1 Distill Qwen 7B（推理 / 代码）"
  "sshleifer/tiny-gpt2（极速烟测 / 最低资源）"
)

echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     vLLM-HUST Workstation  —  快速启动       ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── 前置检查 ─────────────────────────────────────────────
check() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${YELLOW}✗ 需要 $1，请先安装后重试${NC}"
    exit 1
  fi
}

resolve_conda_command() {
  if [[ -n "${CONDA_EXE:-}" && -x "${CONDA_EXE}" ]]; then
    printf '%s\n' "$CONDA_EXE"
    return 0
  fi
  if command -v conda &>/dev/null; then
    command -v conda
    return 0
  fi
  return 1
}

workstation_auto_install_node_enabled() {
  [[ "${WORKSTATION_AUTO_INSTALL_NODE_WITH_CONDA:-true}" == "true" ]]
}

active_conda_env_name() {
  if [[ -n "${CONDA_DEFAULT_ENV:-}" ]]; then
    printf '%s\n' "$CONDA_DEFAULT_ENV"
    return 0
  fi

  if [[ -n "${CONDA_PREFIX:-}" ]]; then
    basename "$CONDA_PREFIX"
    return 0
  fi

  return 1
}

ensure_node_runtime() {
  local conda_cmd
  local conda_env
  local node_version_spec

  if command -v node &>/dev/null && command -v npm &>/dev/null; then
    return 0
  fi

  if ! workstation_auto_install_node_enabled; then
    return 1
  fi

  conda_cmd="$(resolve_conda_command || true)"
  conda_env="$(active_conda_env_name || true)"
  node_version_spec="${WORKSTATION_NODEJS_CONDA_SPEC:-nodejs>=20,<21}"

  if [[ -z "$conda_cmd" || -z "$conda_env" ]]; then
    return 1
  fi

  echo -e "${BLUE}🧰 未检测到 node/npm，正在尝试通过当前 conda 环境自动安装 Node.js…${NC}"
  echo -e "   conda env: ${GREEN}${conda_env}${NC}"
  echo -e "   package:   ${GREEN}${node_version_spec}${NC}"

  "$conda_cmd" install -y -n "$conda_env" -c conda-forge "$node_version_spec"

  if [[ -n "${CONDA_PREFIX:-}" && -d "${CONDA_PREFIX}/bin" ]]; then
    case ":$PATH:" in
      *":${CONDA_PREFIX}/bin:"*) ;;
      *) export PATH="${CONDA_PREFIX}/bin:$PATH" ;;
    esac
  fi

  if command -v node &>/dev/null && command -v npm &>/dev/null; then
    echo -e "${GREEN}✅ 已通过 conda 自动补齐 node/npm${NC}"
    return 0
  fi

  echo -e "${YELLOW}✗ 已尝试通过 conda 安装 Node.js，但当前 shell 仍未检测到 node/npm${NC}"
  return 1
}

resolve_compose_command() {
  if docker compose version &>/dev/null; then
    printf 'docker compose\n'
    return 0
  fi
  if command -v docker-compose &>/dev/null; then
    printf 'docker-compose\n'
    return 0
  fi
  printf '\n'
}

ensure_env_file() {
  if [[ ! -f .env ]]; then
    cp .env.example .env
    echo -e "${YELLOW}⚙  已生成 .env，请按需修改配置${NC}"
  fi
}

default_hf_endpoint() {
  printf '%s\n' "${WORKSTATION_DEFAULT_HF_ENDPOINT:-https://hf-mirror.com}"
}

workstation_should_enforce_bootstrap_model() {
  if [[ "${WORKSTATION_ENFORCE_BOOTSTRAP_MODEL_ON_START:-false}" == "true" ]]; then
    return 0
  fi
  [[ "$WORKSTATION_BOOTSTRAP_POLICY_CONFIRMED" == "true" ]]
}

load_env_file() {
  ensure_env_file
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a

  if [[ -z "${HF_ENDPOINT:-}" ]]; then
    HF_ENDPOINT="$(default_hf_endpoint)"
    export HF_ENDPOINT
  fi
  if [[ -z "${HF_TOKEN:-}" ]]; then
    unset HF_TOKEN
  fi
}

update_env_value() {
  local file_path="$1"
  local key="$2"
  local value="$3"
  local tmp_file

  tmp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^[[:space:]]*" key "=" {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$file_path" > "$tmp_file"
  mv "$tmp_file" "$file_path"
}

append_shell_words() {
  local output_var="$1"
  shift
  local current="${!output_var:-}"
  local word

  for word in "$@"; do
    if [[ -z "$current" ]]; then
      printf -v current '%q' "$word"
    else
      printf -v current '%s %q' "$current" "$word"
    fi
  done

  printf -v "$output_var" '%s' "$current"
}

workstation_ascend_compile_custom_kernels() {
  if [[ -n "${WORKSTATION_ASCEND_COMPILE_CUSTOM_KERNELS:-}" ]]; then
    printf '%s\n' "$WORKSTATION_ASCEND_COMPILE_CUSTOM_KERNELS"
    return 0
  fi

  if [[ -n "${COMPILE_CUSTOM_KERNELS:-}" ]]; then
    printf '%s\n' "$COMPILE_CUSTOM_KERNELS"
    return 0
  fi

  printf '0\n'
}

launch_local_workstation_backend() {
  local log_file="$1"
  local treat_as_ascend_runtime="$2"
  local compile_custom_kernels="$3"
  shift 3

  local env_assignments=()
  local command_words=()
  local launch_string=""
  local manager_env_cmd=""

  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then
      shift
      break
    fi
    env_assignments+=("$1")
    shift
  done
  command_words=("$@")

  if (( ${#command_words[@]} == 0 )); then
    echo -e "${YELLOW}✗ 工作站后端自启动命令为空${NC}"
    return 1
  fi

  append_shell_words launch_string env "${env_assignments[@]}" "${command_words[@]}"

  if [[ "$treat_as_ascend_runtime" == "true" && -n "$compile_custom_kernels" && -n "$(command -v hust-ascend-manager 2>/dev/null || true)" ]]; then
    append_shell_words manager_env_cmd "$(command -v hust-ascend-manager)" env --shell
    echo -e "${BLUE}🧭 Ascend 自启动将自动注入 hust-ascend-manager 环境，默认使用 COMPILE_CUSTOM_KERNELS=${compile_custom_kernels}${NC}"
    nohup bash -lc "set -euo pipefail; eval \"\$($manager_env_cmd)\"; if [[ -n \"\${HUST_ATB_SET_ENV:-}\" && -f \"\${HUST_ATB_SET_ENV}\" ]]; then set +u; source \"\${HUST_ATB_SET_ENV}\" --cxx_abi=1; set -u; fi; exec $launch_string" >"$log_file" 2>&1 &
    return 0
  fi

  nohup env "${env_assignments[@]}" "${command_words[@]}" >"$log_file" 2>&1 &
}

default_tool_call_parser_for_model() {
  local model="${1:-}"

  case "$model" in
    Qwen/Qwen2.5-*|Qwen/QwQ-*)
      printf 'hermes\n'
      ;;
    Qwen/Qwen3-Coder-*)
      printf 'qwen3_xml\n'
      ;;
    meta-llama/Llama-3.2-*)
      printf 'pythonic\n'
      ;;
    meta-llama/Llama-4-*)
      printf 'llama4_pythonic\n'
      ;;
    openai/gpt-oss-*)
      printf 'openai\n'
      ;;
    *)
      printf 'openai\n'
      ;;
  esac
}

gateway_host() {
  local base_url="${VLLM_HUST_BASE_URL:-http://localhost:8080}"
  local authority="${base_url#*://}"
  authority="${authority%%/*}"
  printf '%s\n' "${authority%%:*}"
}

gateway_port() {
  local base_url="${VLLM_HUST_BASE_URL:-http://localhost:8080}"
  local authority="${base_url#*://}"
  authority="${authority%%/*}"
  if [[ "$authority" == *:* ]]; then
    printf '%s\n' "${authority##*:}"
    return
  fi
  if [[ "$base_url" == https://* ]]; then
    printf '443\n'
  else
    printf '80\n'
  fi
}

gateway_probe_url() {
  local host
  local port
  host="$(gateway_host)"
  port="$(gateway_port)"
  case "$host" in
    localhost|127.0.0.1|0.0.0.0|host.docker.internal)
      printf 'http://127.0.0.1:%s\n' "$port"
      ;;
    *)
      printf '%s\n' "${VLLM_HUST_BASE_URL:-http://localhost:8080}"
      ;;
  esac
}

gateway_is_local_target() {
  case "$(gateway_host)" in
    localhost|127.0.0.1|0.0.0.0|host.docker.internal)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

interactive_launcher_enabled() {
  local enabled="${WORKSTATION_INTERACTIVE_LAUNCHER:-true}"
  [[ "$enabled" == "true" ]] && [[ -t 0 ]] && [[ -t 1 ]]
}

frontend_port() {
  printf '%s\n' "${APP_PORT:-3000}"
}

frontend_probe_url() {
  printf 'http://127.0.0.1:%s\n' "$(frontend_port)"
}

frontend_http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$(frontend_probe_url)" 2>/dev/null || true
}

frontend_is_healthy() {
  local code
  code="$(frontend_http_code)"
  [[ "$code" =~ ^[23][0-9][0-9]$ ]]
}

frontend_is_running() {
  local code
  code="$(frontend_http_code)"
  [[ -n "$code" && "$code" != "000" ]]
}

frontend_cached_project_root() {
  local next_dir="$SCRIPT_DIR/.next"
  local cached_path=""

  if [[ ! -d "$next_dir/server" ]]; then
    return 1
  fi

  cached_path="$(grep -RaoEm1 '/[^"[:space:]]+/src/app' "$next_dir/server" 2>/dev/null | head -n1 || true)"
  if [[ -z "$cached_path" ]]; then
    return 1
  fi

  printf '%s\n' "${cached_path%/src/app}"
}

frontend_clear_build_cache() {
  local next_dir="$SCRIPT_DIR/.next"

  if [[ -d "$next_dir" ]]; then
    rm -rf "$next_dir"
  fi
}

maybe_reset_stale_frontend_build_cache() {
  local cached_root=""
  local http_code="${1:-}"

  cached_root="$(frontend_cached_project_root || true)"
  if [[ -n "$cached_root" && "$cached_root" != "$SCRIPT_DIR" ]]; then
    echo -e "${YELLOW}ℹ 检测到 .next 缓存来自其他目录：${cached_root}；正在清理旧前端构建缓存${NC}"
    frontend_clear_build_cache
    return 0
  fi

  if [[ -n "$http_code" && "$http_code" =~ ^5[0-9][0-9]$ ]] && [[ -d "$SCRIPT_DIR/.next" ]]; then
    echo -e "${YELLOW}ℹ 当前前端返回 HTTP ${http_code}，正在清理 .next 缓存后重启${NC}"
    frontend_clear_build_cache
    return 0
  fi

  return 1
}

frontend_log_file() {
  printf '%s\n' "$SCRIPT_DIR/.logs/workstation-dev.log"
}

gateway_http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$(gateway_probe_url)/health" 2>/dev/null || true
}

gateway_is_running() {
  local code
  code="$(gateway_http_code)"
  [[ -n "$code" && "$code" != "000" ]]
}

print_backend_runtime_preflight_error() {
  local python_bin="${1:-}"
  local pythonpath="${2:-}"
  local details=""

  if [[ -n "$python_bin" ]]; then
    details="$(python_runtime_import_details "$python_bin" "$pythonpath" 2>&1 || true)"
  fi

  echo -e "${YELLOW}✗ 当前 Python / vllm-hust 运行时不完整，quickstart 已尝试通过 ascend-runtime-manager 自动修复，但当前环境仍不可用${NC}"
  if [[ -n "$details" ]]; then
    echo -e "${YELLOW}  失败原因：${NC}"
    printf '%s\n' "$details" | sed 's/^/   /'
  fi
  echo -e "${YELLOW}  可手动执行：hust-ascend-manager runtime repair --repo $(find_vllm_hust_repo_dir || printf '/path/to/vllm-hust')${NC}"
}

bootstrap_model() {
  if [[ -n "${WORKSTATION_BOOTSTRAP_MODEL:-}" ]]; then
    printf '%s\n' "$WORKSTATION_BOOTSTRAP_MODEL"
    return 0
  fi

  case "$(bootstrap_backend)" in
    cuda|ascend|rocm)
      printf '%s\n' "$WORKSTATION_BOOTSTRAP_MODEL_DEFAULT_ACCEL"
      ;;
    *)
      printf '%s\n' "$WORKSTATION_BOOTSTRAP_MODEL_DEFAULT_CPU"
      ;;
  esac
}

detect_backend_from_hardware() {
  if command -v npu-smi &>/dev/null; then
    printf 'ascend\n'
    return 0
  fi
  if command -v nvidia-smi &>/dev/null; then
    printf 'cuda\n'
    return 0
  fi
  if command -v rocminfo &>/dev/null; then
    printf 'rocm\n'
    return 0
  fi
  printf 'cpu\n'
}

backend_detection_source() {
  if command -v npu-smi &>/dev/null; then
    printf 'npu-smi'
    return 0
  fi
  if command -v nvidia-smi &>/dev/null; then
    printf 'nvidia-smi'
    return 0
  fi
  if command -v rocminfo &>/dev/null; then
    printf 'rocminfo'
    return 0
  fi
  printf 'fallback'
}

nvidia_primary_name() {
  if ! command -v nvidia-smi &>/dev/null; then
    return 1
  fi
  nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n1 | sed 's/[[:space:]]*$//'
}

nvidia_total_vram_mb() {
  if ! command -v nvidia-smi &>/dev/null; then
    return 1
  fi
  nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d '[:space:]'
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

  raw="${BACKEND_TYPE:-CPU}"
  printf '%s\n' "$raw" | tr '[:upper:]' '[:lower:]'
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
    echo -e "${YELLOW}⚠ 未找到 Ascend 环境脚本：$ascend_env_script${NC}"
    return 0
  fi

  toolkit_home="$(find_ascend_toolkit_home || true)"
  if [[ -z "$toolkit_home" ]]; then
    echo -e "${YELLOW}⚠ 未找到 Ascend Toolkit 目录，可能导致 libhccl.so 缺失${NC}"
    return 0
  fi

  # shellcheck disable=SC1090
  source "$ascend_env_script" "$toolkit_home"

  if [[ -d "$toolkit_home/python/site-packages" ]]; then
    if [[ -n "${PYTHONPATH:-}" ]]; then
      export PYTHONPATH="$toolkit_home/python/site-packages:$PYTHONPATH"
    else
      export PYTHONPATH="$toolkit_home/python/site-packages"
    fi
  fi
}

gateway_models_json() {
  curl -fsS --max-time 5 "$(gateway_probe_url)/v1/models" 2>/dev/null || true
}

gateway_current_model() {
  extract_first_model_id "$(gateway_models_json)"
}

extract_first_model_id() {
  local json="${1:-}"
  printf '%s' "$json" | grep -o '"id":"[^"]*"' | head -n1 | sed 's/.*"id":"\([^"]*\)"/\1/'
}

gateway_inference_ready() {
  local models_json
  local model_id
  local body
  local body_fallback
  local code
  local fallback_code
  local timeout_s

  if ! gateway_is_running; then
    return 1
  fi

  models_json="$(gateway_models_json)"
  model_id="$(extract_first_model_id "$models_json")"
  if [[ -z "$model_id" ]]; then
    return 1
  fi

  timeout_s="${WORKSTATION_GATEWAY_CANARY_TIMEOUT:-20}"
  body="$(mktemp)"
  code="$(
    curl -sS -o "$body" -w '%{http_code}' --max-time "$timeout_s" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${VLLM_HUST_API_KEY:-not-required}" \
      -X POST "$(gateway_probe_url)/v1/chat/completions" \
      -d "{\"model\":\"${model_id}\",\"messages\":[{\"role\":\"user\",\"content\":\"${WORKSTATION_HEALTHCHECK_PROMPT}\"}],\"max_tokens\":1,\"stream\":false}" \
      2>/dev/null || true
  )"

  if [[ "$code" == "200" ]] && grep -q '"choices"' "$body"; then
    rm -f "$body"
    return 0
  fi

  # Some base models (e.g. tiny-gpt2) do not define a chat template and return
  # 400 for chat-completions, while plain completions are healthy.
  if [[ "$code" == "400" ]] && grep -qi 'chat template' "$body"; then
    body_fallback="$(mktemp)"
    fallback_code="$(
      curl -sS -o "$body_fallback" -w '%{http_code}' --max-time "$timeout_s" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer ${VLLM_HUST_API_KEY:-not-required}" \
        -X POST "$(gateway_probe_url)/v1/completions" \
        -d "{\"model\":\"${model_id}\",\"prompt\":\"${WORKSTATION_HEALTHCHECK_PROMPT}\",\"max_tokens\":1,\"stream\":false}" \
        2>/dev/null || true
    )"

    if [[ "$fallback_code" == "200" ]] && grep -q '"choices"' "$body_fallback"; then
      rm -f "$body" "$body_fallback"
      return 0
    fi
    rm -f "$body_fallback"
  fi

  rm -f "$body"
  return 1
}

model_available_in_hf_cache() {
  local model="$1"
  local cache_dir

  if [[ -z "$model" ]]; then
    return 1
  fi

  # Local model path is considered available without hub checks.
  if [[ -d "$model" || -f "$model" ]]; then
    return 0
  fi

  cache_dir="$HOME/.cache/huggingface/hub/models--${model//\//--}"
  if [[ -d "$cache_dir/snapshots" ]] && find "$cache_dir/snapshots" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
    return 0
  fi

  return 1
}

cached_hf_model_ids() {
  local cache_root="${HF_HUB_CACHE:-${HF_HOME:-$HOME/.cache/huggingface}/hub}"
  local entry
  local snapshots
  local model_id

  if [[ ! -d "$cache_root" ]]; then
    return 0
  fi

  while IFS= read -r entry; do
    snapshots="$entry/snapshots"
    if [[ ! -d "$snapshots" ]]; then
      continue
    fi
    if ! find "$snapshots" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
      continue
    fi

    model_id="${entry##*/models--}"
    model_id="${model_id//--/\/}"
    printf '%s\n' "$model_id"
  done < <(find "$cache_root" -mindepth 1 -maxdepth 1 -type d -name 'models--*' | sort)
}

resolve_local_cached_fallback_model() {
  local requested_model="$1"
  local candidate
  local -a preferred_candidates

  preferred_candidates=(
    "$requested_model"
    "${WORKSTATION_BOOTSTRAP_MODEL:-}"
    "${DEFAULT_MODEL:-}"
    "Qwen/Qwen3-0.6B"
    "$WORKSTATION_BOOTSTRAP_MODEL_DEFAULT_ACCEL"
    "$WORKSTATION_BOOTSTRAP_MODEL_DEFAULT_CPU"
    "${DEFAULT_STARTUP_MODEL_MENU_VALUES[@]}"
    "${CPU_STARTUP_MODEL_MENU_VALUES[@]}"
    "${CUDA_12GB_STARTUP_MODEL_MENU_VALUES[@]}"
    "${CUDA_8GB_STARTUP_MODEL_MENU_VALUES[@]}"
    "${CUDA_16GB_STARTUP_MODEL_MENU_VALUES[@]}"
    "${CUDA_24GB_STARTUP_MODEL_MENU_VALUES[@]}"
  )

  for candidate in "${preferred_candidates[@]}"; do
    if [[ -z "$candidate" ]]; then
      continue
    fi
    if model_available_in_hf_cache "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  while IFS= read -r candidate; do
    if [[ -z "$candidate" ]]; then
      continue
    fi
    if model_available_in_hf_cache "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(cached_hf_model_ids)

  return 1
}

huggingface_endpoint_reachable() {
  curl -fsS -I --max-time 3 https://huggingface.co >/dev/null 2>&1
}

backend_target_device() {
  local backend="$1"
  case "$backend" in
    cpu)
      printf 'cpu\n'
      ;;
    cuda)
      printf 'cuda\n'
      ;;
    rocm)
      printf 'rocm\n'
      ;;
    ascend)
      printf 'npu\n'
      ;;
    *)
      printf '\n'
      ;;
  esac
}

find_listening_pids_for_port() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -ltnp 2>/dev/null | grep -E ":${port}[[:space:]]" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
    return 0
  fi
  if command -v lsof &>/dev/null; then
    lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
    return 0
  fi
  return 0
}

port_has_listener() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -ltnH 2>/dev/null | grep -E "(:|\])${port}[[:space:]]" >/dev/null 2>&1
    return $?
  fi
  if command -v lsof &>/dev/null; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

ensure_local_port_available() {
  local port="$1"
  local service_name="$2"
  local env_hint="$3"
  local pids=""
  local listeners=""

  if ! port_has_listener "$port"; then
    return 0
  fi

  echo -e "${YELLOW}✗ ${service_name} 所需端口 ${port} 仍被其他进程占用，无法继续本地自启动${NC}"

  if command -v ss &>/dev/null; then
    listeners="$(ss -ltnH 2>/dev/null | grep -E "(:|\\])${port}[[:space:]]" || true)"
    if [[ -n "$listeners" ]]; then
      echo -e "${YELLOW}  当前监听：${NC}"
      printf '%s\n' "$listeners" | sed 's/^/   /'
    fi
  fi

  pids="$(find_listening_pids_for_port "$port")"
  if [[ -n "$pids" ]]; then
    echo -e "${YELLOW}  可见 PID: $(printf '%s\n' "$pids" | tr '\n' ' ' | sed 's/[[:space:]]*$//')${NC}"
  else
    echo -e "${YELLOW}  当前用户无法看到该监听的 PID；通常说明它属于其他用户、容器或受限服务${NC}"
  fi

  echo -e "${YELLOW}  处理方式：先释放端口 ${port}，或修改 ${env_hint} 后重新执行 ./quickstart.sh${NC}"
  return 1
}

stop_local_processes_on_port() {
  local port
  local pids
  port="$1"
  if ! port_has_listener "$port"; then
    return 0
  fi

  pids="$(find_listening_pids_for_port "$port")"
  if [[ -z "$pids" ]]; then
    echo -e "${YELLOW}⚠️ 端口 ${port} 已被监听，但当前用户无法识别对应 PID；不会强制停止未知进程${NC}"
    return 0
  fi

  echo -e "${YELLOW}♻️ 端口 ${port} 上已有本地进程，正在停止以便重建可用栈…${NC}"
  printf '%s\n' "$pids" | xargs -r kill
  sleep 2
  if port_has_listener "$port"; then
    pids="$(find_listening_pids_for_port "$port")"
    if [[ -n "$pids" ]]; then
      printf '%s\n' "$pids" | xargs -r kill -9
      sleep 1
    fi
  fi

  if port_has_listener "$port"; then
    echo -e "${YELLOW}⚠️ 端口 ${port} 仍被占用，后续启动会直接失败${NC}"
  fi
}

find_vllm_hust_serve_pids() {
  local port="$1"
  local engine_port="$2"
  pgrep -af 'vllm-hust serve|vllm_hust\.cli serve' 2>/dev/null \
    | awk -v port="$port" -v engine_port="$engine_port" '
        $0 ~ /(vllm-hust|vllm_hust\.cli) serve/ && $0 ~ ("--port " port) && $0 ~ ("--engine-port " engine_port) {
          print $1
        }
      ' \
    | sort -u || true
}

stop_local_vllm_hust_serve_processes() {
  local port="$1"
  local engine_port="$2"
  local pids

  pids="$(find_vllm_hust_serve_pids "$port" "$engine_port")"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo -e "${YELLOW}♻️ 检测到残留 vllm-hust serve 进程，正在清理…${NC}"
  printf '%s\n' "$pids" | xargs -r kill
  sleep 2
  pids="$(find_vllm_hust_serve_pids "$port" "$engine_port")"
  if [[ -n "$pids" ]]; then
    printf '%s\n' "$pids" | xargs -r kill -9
  fi
}

interactive_model_menu_enabled() {
  local enabled="${WORKSTATION_INTERACTIVE_MODEL_MENU:-true}"
  [[ "$enabled" == "true" ]] && [[ -t 0 ]] && [[ -t 1 ]]
}

is_cpu_backend() {
  [[ "$(bootstrap_backend)" == "cpu" ]]
}

is_cuda_backend() {
  [[ "$(bootstrap_backend)" == "cuda" ]]
}

cuda_vram_tier_label() {
  local vram_mb="${1:-}"
  if [[ ! "$vram_mb" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if (( vram_mb < 10240 )); then
    printf '8GB 档'
  elif (( vram_mb < 14336 )); then
    printf '12GB 档'
  elif (( vram_mb < 20480 )); then
    printf '16GB 档'
  else
    printf '24GB+ 档'
  fi
}

selected_model_needs_confirm_on_cpu() {
  case "$1" in
    Qwen/Qwen2.5-7B-Instruct|Qwen/Qwen2.5-14B-Instruct|deepseek-ai/DeepSeek-R1-Distill-Qwen-7B|deepseek-ai/DeepSeek-R1-Distill-Qwen-14B|mistralai/Mistral-7B-Instruct-v0.3|meta-llama/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

select_bootstrap_model_interactively() {
  local current_model
  local current_backend
  local backend_source
  local gpu_name=""
  local gpu_vram_mb=""
  local gpu_vram_tier=""
  local -a menu_values
  local -a menu_labels
  local selected_model=""
  local custom_model
  local custom_option
  local confirm_choice
  local i

  if ! interactive_model_menu_enabled; then
    return 0
  fi

  if ! gateway_is_local_target; then
    return 0
  fi

  current_model="$(bootstrap_model)"
  current_backend="$(bootstrap_backend)"
  backend_source="$(backend_detection_source)"

  if is_cpu_backend; then
    menu_values=("${CPU_STARTUP_MODEL_MENU_VALUES[@]}")
    menu_labels=("${CPU_STARTUP_MODEL_MENU_LABELS[@]}")
  elif is_cuda_backend; then
    gpu_name="$(nvidia_primary_name || true)"
    gpu_vram_mb="$(nvidia_total_vram_mb || true)"
    gpu_vram_tier="$(cuda_vram_tier_label "$gpu_vram_mb" || true)"
    if [[ "$gpu_vram_mb" =~ ^[0-9]+$ ]] && (( gpu_vram_mb < 10240 )); then
      menu_values=("${CUDA_8GB_STARTUP_MODEL_MENU_VALUES[@]}")
      menu_labels=("${CUDA_8GB_STARTUP_MODEL_MENU_LABELS[@]}")
    elif [[ "$gpu_vram_mb" =~ ^[0-9]+$ ]] && (( gpu_vram_mb < 14336 )); then
      menu_values=("${CUDA_12GB_STARTUP_MODEL_MENU_VALUES[@]}")
      menu_labels=("${CUDA_12GB_STARTUP_MODEL_MENU_LABELS[@]}")
    elif [[ "$gpu_vram_mb" =~ ^[0-9]+$ ]] && (( gpu_vram_mb < 20000 )); then
      menu_values=("${CUDA_16GB_STARTUP_MODEL_MENU_VALUES[@]}")
      menu_labels=("${CUDA_16GB_STARTUP_MODEL_MENU_LABELS[@]}")
    elif [[ "$gpu_vram_mb" =~ ^[0-9]+$ ]] && (( gpu_vram_mb >= 20000 )); then
      menu_values=("${CUDA_24GB_STARTUP_MODEL_MENU_VALUES[@]}")
      menu_labels=("${CUDA_24GB_STARTUP_MODEL_MENU_LABELS[@]}")
    else
      menu_values=("${DEFAULT_STARTUP_MODEL_MENU_VALUES[@]}")
      menu_labels=("${DEFAULT_STARTUP_MODEL_MENU_LABELS[@]}")
    fi
  else
    menu_values=("${DEFAULT_STARTUP_MODEL_MENU_VALUES[@]}")
    menu_labels=("${DEFAULT_STARTUP_MODEL_MENU_LABELS[@]}")
  fi
  custom_option="$(( ${#menu_values[@]} + 1 ))"

  echo ""
  echo -e "${BLUE}🤖 请选择本次启动要拉起的模型${NC}"
  echo -e "   当前配置模型: ${GREEN}${current_model}${NC}"
  echo -e "   当前配置后端: ${GREEN}${current_backend}${NC}"
  if [[ "${WORKSTATION_AUTO_DETECT_BACKEND:-true}" == "true" && "${WORKSTATION_BOOTSTRAP_BACKEND:-}" != "cpu" && "$backend_source" != "fallback" ]]; then
    echo -e "   硬件探测来源: ${GREEN}${backend_source}${NC}"
  fi
  if is_cuda_backend && [[ -n "$gpu_name" ]]; then
    if [[ "$gpu_vram_mb" =~ ^[0-9]+$ ]]; then
      if [[ -n "$gpu_vram_tier" ]]; then
        echo -e "   GPU 信息: ${GREEN}${gpu_name} / $(( gpu_vram_mb / 1024 ))GB 显存（${gpu_vram_tier}）${NC}"
      else
        echo -e "   GPU 信息: ${GREEN}${gpu_name} / $(( gpu_vram_mb / 1024 ))GB 显存${NC}"
      fi
    else
      echo -e "   GPU 信息: ${GREEN}${gpu_name}${NC}"
    fi
  fi
  echo ""
  echo "  0) 保持当前配置"
  for i in "${!menu_values[@]}"; do
    printf '  %d) %s\n' "$((i + 1))" "${menu_labels[$i]}"
  done
  printf '  %d) 自定义 Hugging Face 模型 ID / 本地路径\n' "$custom_option"
  echo ""

  while true; do
    read -r -p "请输入编号 [0-${custom_option}]（默认 0）: " selected_model
    selected_model="${selected_model:-0}"
    case "$selected_model" in
      0)
        selected_model="$current_model"
        break
        ;;
      ''|*[!0-9]*)
        echo -e "${YELLOW}✗ 无效编号，请输入 0-${custom_option}${NC}"
        ;;
      *)
        if (( selected_model >= 1 && selected_model <= ${#menu_values[@]} )); then
          selected_model="${menu_values[$((selected_model - 1))]}"
          break
        fi
        if (( selected_model == custom_option )); then
        read -r -p "请输入模型 ID 或本地模型路径: " custom_model
        custom_model="${custom_model//[$'\t\r\n']/}"
        if [[ -n "$custom_model" ]]; then
          selected_model="$custom_model"
          break
        fi
        echo -e "${YELLOW}✗ 自定义模型不能为空，请重试${NC}"
          continue
        fi
        echo -e "${YELLOW}✗ 无效编号，请输入 0-${custom_option}${NC}"
        ;;
    esac
  done

  if is_cpu_backend && selected_model_needs_confirm_on_cpu "$selected_model"; then
    echo ""
    echo -e "${YELLOW}⚠ 当前后端为 CPU，所选模型 ${selected_model} 可能启动很慢，甚至因内存不足失败。${NC}"
    echo -e "${YELLOW}  若只是验证链路，建议优先使用 Qwen 2.5 1.5B 或 sshleifer/tiny-gpt2。${NC}"
    read -r -p "仍继续启动该模型？[y/N]: " confirm_choice
    confirm_choice="${confirm_choice:-N}"
    case "$confirm_choice" in
      y|Y|yes|YES)
        ;;
      *)
        echo -e "${YELLOW}ℹ 已取消本次大模型选择，请重新执行 quickstart 选择更合适的模型${NC}"
        exit 130
        ;;
    esac
  fi

  export WORKSTATION_BOOTSTRAP_MODEL="$selected_model"
  export DEFAULT_MODEL="$selected_model"
  WORKSTATION_BOOTSTRAP_POLICY_CONFIRMED="true"
  update_env_value ".env" "WORKSTATION_BOOTSTRAP_MODEL" "$selected_model"
  update_env_value ".env" "DEFAULT_MODEL" "$selected_model"

  echo -e "${GREEN}✅ 本次启动模型已设为: ${selected_model}${NC}"
}

start_full_stack_if_needed() {
  local force_restart="${1:-false}"
  local auto_start
  local auto_heal
  local tool_call_parser
  local enable_auto_tool_choice
  local disable_prefix_caching
  local disable_chunked_prefill
  local port
  local engine_port
  local log_dir
  local log_file
  local model
  local backend
  local running_model
  local pythonpath
  local hf_offline_auto
  local hf_offline_enabled
  local target_device
  local treat_as_ascend_runtime
  local gpu_memory_utilization
  local compile_custom_kernels=""
  local cached_fallback_model=""
  local enforce_bootstrap_model="false"
  local -a offline_env
  local -a backend_env
  auto_start="${WORKSTATION_AUTO_START_GATEWAY:-true}"
  auto_heal="${WORKSTATION_AUTO_HEAL_GATEWAY:-true}"
  enable_auto_tool_choice="${WORKSTATION_ENABLE_AUTO_TOOL_CHOICE:-true}"
  disable_prefix_caching="${WORKSTATION_DISABLE_PREFIX_CACHING:-false}"
  disable_chunked_prefill="${WORKSTATION_DISABLE_CHUNKED_PREFILL:-false}"
  port="$(gateway_port)"
  engine_port="${WORKSTATION_ENGINE_PORT:-$((port + 1))}"
  log_dir="$SCRIPT_DIR/.logs"
  log_file="$log_dir/vllm-hust-serve.log"
  model="$(bootstrap_model)"
  tool_call_parser="${WORKSTATION_TOOL_CALL_PARSER:-$(default_tool_call_parser_for_model "$model")}"
  backend="$(bootstrap_backend)"
  hf_offline_auto="${WORKSTATION_HF_OFFLINE_AUTO:-true}"
  hf_offline_enabled="false"
  target_device="$(backend_target_device "$backend")"
  treat_as_ascend_runtime="false"
  gpu_memory_utilization="${WORKSTATION_GPU_MEMORY_UTILIZATION:-}"
  if [[ "$backend" == "ascend" ]] || ([[ "$backend" == "cpu" ]] && command -v npu-smi &>/dev/null); then
    treat_as_ascend_runtime="true"
  fi
  if [[ "$treat_as_ascend_runtime" == "true" && -z "$gpu_memory_utilization" ]]; then
    gpu_memory_utilization="${WORKSTATION_ASCEND_GPU_MEMORY_UTILIZATION:-0.35}"
  fi
  offline_env=()
  backend_env=()
  if [[ -n "$target_device" ]]; then
    backend_env+=(VLLM_TARGET_DEVICE="$target_device")
  fi

  if [[ "$treat_as_ascend_runtime" == "true" ]]; then
    compile_custom_kernels="$(workstation_ascend_compile_custom_kernels)"
    backend_env+=(COMPILE_CUSTOM_KERNELS="$compile_custom_kernels")
  fi

  if workstation_should_enforce_bootstrap_model; then
    enforce_bootstrap_model="true"
  fi

  if gateway_inference_ready; then
    running_model="$(gateway_current_model)"
    if [[ "$force_restart" == "true" ]] && gateway_is_local_target; then
      echo -e "${YELLOW}♻️ 按要求重启本地 vllm-hust 服务…${NC}"
    elif gateway_is_local_target && [[ -n "$running_model" && "$running_model" != "$model" ]]; then
      if [[ "$enforce_bootstrap_model" != "true" ]]; then
        echo -e "${YELLOW}ℹ 检测到本地服务已在运行模型 ${running_model}；当前配置模型为 ${model}，本次未显式要求切换模型，将直接复用当前服务${NC}"
        echo -e "${YELLOW}  若要按配置模型重建，请执行 ./quickstart.sh restart-backend，或开启 WORKSTATION_INTERACTIVE_MODEL_MENU 后重新选择${NC}"
        return 0
      fi
      if [[ "$auto_heal" != "true" ]]; then
        echo -e "${YELLOW}✗ 当前本地服务正在运行模型 ${running_model}，但你选择了 ${model}；且 WORKSTATION_AUTO_HEAL_GATEWAY=false${NC}"
        exit 1
      fi
      echo -e "${YELLOW}♻️ 当前本地服务模型为 ${running_model}，将切换为你选择的 ${model}${NC}"
    else
      echo -e "${GREEN}✅ 已检测到可推理的 vllm-hust 服务：$(gateway_probe_url)${NC}"
      return 0
    fi
  fi

  if [[ "$auto_start" != "true" ]]; then
    echo -e "${YELLOW}✗ 未检测到可推理的 vllm-hust 服务，且 WORKSTATION_AUTO_START_GATEWAY=false${NC}"
    exit 1
  fi

  if ! gateway_is_local_target; then
    echo -e "${YELLOW}✗ 当前 VLLM_HUST_BASE_URL=${VLLM_HUST_BASE_URL:-http://localhost:8080} 指向远端地址，脚本不会擅自拉起远端服务${NC}"
    exit 1
  fi

  if gateway_is_running && [[ "$auto_heal" != "true" ]]; then
    echo -e "${YELLOW}✗ 本地 gateway 已运行但不可推理，且 WORKSTATION_AUTO_HEAL_GATEWAY=false${NC}"
    echo -e "${YELLOW}  请先修复本地 gateway / engine，再重新执行脚本${NC}"
    exit 1
  fi

  mkdir -p "$log_dir"

  if [[ "$hf_offline_auto" == "true" ]] && [[ -z "${HF_ENDPOINT:-}" ]]; then
    if ! huggingface_endpoint_reachable; then
      if model_available_in_hf_cache "$model"; then
        hf_offline_enabled="true"
        offline_env+=(HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1)
        echo -e "${YELLOW}ℹ 检测到 huggingface.co 不可达，且本地有缓存模型，自动启用离线模式${NC}"
      elif [[ "${WORKSTATION_AUTO_FALLBACK_TO_LOCAL_CACHE:-true}" == "true" ]]; then
        cached_fallback_model="$(resolve_local_cached_fallback_model "$model" || true)"
        if [[ -n "$cached_fallback_model" ]]; then
          echo -e "${YELLOW}ℹ 检测到 huggingface.co 不可达，且当前模型 ${model} 未缓存；自动回退到本地缓存模型 ${cached_fallback_model}${NC}"
          model="$cached_fallback_model"
          export WORKSTATION_BOOTSTRAP_MODEL="$model"
          export DEFAULT_MODEL="$model"
          hf_offline_enabled="true"
          offline_env+=(HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1)
        else
          echo -e "${YELLOW}✗ 检测到 huggingface.co 不可达，且本地未找到模型缓存：${model}${NC}"
          echo -e "${YELLOW}  请配置可达的 HF_ENDPOINT、准备本地模型路径，或先预下载模型后再启动${NC}"
          exit 1
        fi
      else
        echo -e "${YELLOW}✗ 检测到 huggingface.co 不可达，且本地未找到模型缓存：${model}${NC}"
        echo -e "${YELLOW}  请配置可达的 HF_ENDPOINT、准备本地模型路径，或先预下载模型后再启动${NC}"
        exit 1
      fi
    fi
  fi

  echo -e "${BLUE}🌐 未检测到可推理服务，正在自动启动完整栈…${NC}"
  echo -e "   模型: ${GREEN}${model}${NC}"
  echo -e "   后端: ${GREEN}${backend}${NC}"
  echo -e "   端口: ${GREEN}${port}${NC} (engine: ${engine_port})"
  if [[ "$hf_offline_enabled" == "true" ]]; then
    echo -e "   模式: ${GREEN}HF 离线缓存模式${NC}"
  fi
  if [[ -n "$gpu_memory_utilization" ]]; then
    echo -e "   显存利用率阈值: ${GREEN}${gpu_memory_utilization}${NC}"
  fi
  if [[ "$backend" == "cpu" && "$treat_as_ascend_runtime" == "true" ]]; then
    echo -e "${YELLOW}ℹ 检测到 Ascend 运行时，启用兼容稳定参数以避免旧 CANN 图模式崩溃${NC}"
  fi

  prepare_backend_runtime_env "$backend"

  # In mixed environments, vLLM may still activate the Ascend platform plugin
  # even when backend is set to cpu. Ensure acl python module is discoverable
  # to avoid startup failures caused by missing runtime paths.
  if [[ "$backend" == "cpu" ]] && command -v npu-smi &>/dev/null; then
    prepare_backend_runtime_env "ascend"
  fi

  stop_local_vllm_hust_serve_processes "$port" "$engine_port"
  stop_local_processes_on_port "$port"
  stop_local_processes_on_port "$engine_port"
  ensure_local_port_available "$port" "工作站本地 gateway" "VLLM_HUST_BASE_URL=http://localhost:<new-port>"
  ensure_local_port_available "$engine_port" "工作站本地 engine" "WORKSTATION_ENGINE_PORT=<new-port>"

  pythonpath="$(build_workspace_pythonpath)"
  local python_bin=""
  python_bin="$(active_python_command || true)"

  if command -v vllm-hust &>/dev/null && PYTHONNOUSERSITE=1 vllm-hust serve --help >/dev/null 2>&1; then
    local serve_help
    local -a serve_args
    serve_help="$(vllm-hust serve --help 2>&1 || true)"
    serve_args=(serve)

    if [[ "$serve_help" == *"--backend"* ]]; then
      serve_args+=(--backend "$backend")
    fi

    if [[ "$serve_help" == *"--model"* ]]; then
      serve_args+=(--model "$model")
    else
      # Newer vllm-hust/vllm CLI variants take model as positional argument.
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
      # Keep quickstart stable on mixed Ascend runtime versions by disabling graph paths.
      # Use explicit JSON configs supported by current CLI to avoid parser/version drift.
      serve_args+=(--enforce-eager)
      if [[ "$serve_help" == *"--compilation-config"* ]]; then
        serve_args+=(--compilation-config '{"mode":0,"cudagraph_mode":"NONE"}')
      fi
      if [[ "$serve_help" == *"--additional-config"* ]]; then
        serve_args+=(--additional-config '{"ascend_compilation_config":{"enable_npugraph_ex":false,"enable_static_kernel":false}}')
      fi

      # Prefer stability on older CANN builds where fused infer attention may crash
      # for some model head dimensions during chunked/prefix prefill.
      if [[ "${WORKSTATION_ASCEND_STABLE_MODE:-true}" == "true" ]]; then
        disable_prefix_caching="true"
        disable_chunked_prefill="true"
      fi
    fi

    if [[ "$disable_prefix_caching" == "true" && "$serve_help" == *"--enable-prefix-caching"* ]]; then
      serve_args+=(--no-enable-prefix-caching)
    fi

    if [[ "$disable_chunked_prefill" == "true" && "$serve_help" == *"--enable-chunked-prefill"* ]]; then
      serve_args+=(--no-enable-chunked-prefill)
    fi

    # Workstation-local stacks should keep tool calling enabled for agent flows
    # such as EvoScientist even when `serve --help` probing is unreliable.
    if [[ "$enable_auto_tool_choice" == "true" ]]; then
      serve_args+=(--enable-auto-tool-choice)
    fi
    if [[ -n "$tool_call_parser" ]]; then
      serve_args+=(--tool-call-parser "$tool_call_parser")
    fi

    launch_local_workstation_backend \
      "$log_file" \
      "$treat_as_ascend_runtime" \
      "$compile_custom_kernels" \
      "${offline_env[@]}" \
      "${backend_env[@]}" \
      VLLM_HUST_PREFLIGHT_CANARY=0 \
      VLLM_HUST_STARTUP_CANARY=0 \
      VLLM_HUST_PERIODIC_CANARY=0 \
      -- \
      vllm-hust "${serve_args[@]}"
  else
    local serve_help=""
    local -a serve_args
    serve_args=(serve)

    if command -v vllm-hust &>/dev/null; then
      serve_help="$(PYTHONNOUSERSITE=1 vllm-hust serve --help 2>&1 || true)"
    elif [[ -n "$python_bin" ]] && [[ -n "$pythonpath" ]] && ensure_backend_runtime_ready "$python_bin" "$pythonpath"; then
      serve_help="$(PYTHONNOUSERSITE=1 PYTHONPATH="$pythonpath" "$python_bin" -m vllm.entrypoints.cli.main serve --help 2>&1 || true)"
    fi

    if [[ -z "$serve_help" ]]; then
      print_backend_runtime_preflight_error "$python_bin" "$pythonpath"
      exit 1
    fi

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

    if [[ "$disable_prefix_caching" == "true" && "$serve_help" == *"--enable-prefix-caching"* ]]; then
      serve_args+=(--no-enable-prefix-caching)
    fi

    if [[ "$disable_chunked_prefill" == "true" && "$serve_help" == *"--enable-chunked-prefill"* ]]; then
      serve_args+=(--no-enable-chunked-prefill)
    fi

    if [[ "$enable_auto_tool_choice" == "true" ]]; then
      serve_args+=(--enable-auto-tool-choice)
    fi
    if [[ -n "$tool_call_parser" ]]; then
      serve_args+=(--tool-call-parser "$tool_call_parser")
    fi

    if [[ -n "$python_bin" ]] && [[ -n "$pythonpath" ]] && ensure_backend_runtime_ready "$python_bin" "$pythonpath"; then
      launch_local_workstation_backend \
        "$log_file" \
        "$treat_as_ascend_runtime" \
        "$compile_custom_kernels" \
        "${offline_env[@]}" \
        "${backend_env[@]}" \
        PYTHONNOUSERSITE=1 \
        PYTHONPATH="$pythonpath" \
        VLLM_HUST_PREFLIGHT_CANARY=0 \
        VLLM_HUST_STARTUP_CANARY=0 \
        VLLM_HUST_PERIODIC_CANARY=0 \
        -- \
        "$python_bin" -m vllm.entrypoints.cli.main "${serve_args[@]}"
    else
      print_backend_runtime_preflight_error "$python_bin" "$pythonpath"
      exit 1
    fi
  fi

  for _ in {1..90}; do
    sleep 2
    if gateway_inference_ready; then
      echo -e "${GREEN}✅ vllm-hust 完整栈已就绪：$(gateway_probe_url)${NC}"
      echo -e "   日志文件: ${GREEN}$log_file${NC}"
      if [[ "${DEFAULT_MODEL:-}" != "$model" ]]; then
        echo -e "${YELLOW}ℹ 当前自启动模型为 ${model}；若需与 UI 默认模型一致，请同步调整 DEFAULT_MODEL / WORKSTATION_BOOTSTRAP_MODEL${NC}"
      fi
      return 0
    fi
  done

  echo -e "${YELLOW}✗ vllm-hust 完整栈启动失败或 180s 内未达到可推理状态，请检查日志：$log_file${NC}"
  exit 1
}

ensure_frontend_dependencies() {
  if [[ -x node_modules/.bin/next ]]; then
    return 0
  fi

  echo -e "${BLUE}📦 安装工作站前端依赖…${NC}"
  npm install
}

ensure_frontend_dev_server() {
  local app_port
  local http_code
  local log_file

  app_port="$(frontend_port)"
  log_file="$(frontend_log_file)"

  ensure_node_runtime || true
  check node
  check npm
  check curl

  if frontend_is_running; then
    echo -e "${GREEN}✅ 工作站前端已可访问：$(frontend_probe_url)${NC}"
    return 0
  fi

  mkdir -p "$SCRIPT_DIR/.logs"
  stop_local_processes_on_port "$app_port"
  ensure_local_port_available "$app_port" "工作站前端" "APP_PORT=<new-port>"
  ensure_frontend_dependencies

  echo -e "${BLUE}🖥️ 正在后台启动工作站前端…${NC}"
  nohup env NEXT_TELEMETRY_DISABLED=1 npm run dev >"$log_file" 2>&1 &

  for _ in {1..60}; do
    sleep 2
    http_code="$(frontend_http_code)"
    if frontend_is_healthy; then
      echo -e "${GREEN}✅ 工作站前端已就绪：$(frontend_probe_url)${NC}"
      echo -e "   日志文件: ${GREEN}$log_file${NC}"
      return 0
    fi
  done
    if frontend_is_running; then
      echo -e "${YELLOW}♻️ 检测到现有工作站前端实例异常（HTTP ${http_code:-unknown}），将自动重启${NC}"
    fi
    maybe_reset_stale_frontend_build_cache "$http_code" || true

  echo -e "${YELLOW}✗ 工作站前端启动失败或 120s 内未就绪，请检查日志：$log_file${NC}"
  exit 1
}

stop_local_demo_stack() {
  local port
  local engine_port
  local app_port

  port="$(gateway_port)"
  engine_port="${WORKSTATION_ENGINE_PORT:-$((port + 1))}"
  app_port="$(frontend_port)"

  stop_local_processes_on_port "$app_port"
  stop_local_vllm_hust_serve_processes "$port" "$engine_port"
  stop_local_processes_on_port "$port"
  stop_local_processes_on_port "$engine_port"

  echo -e "${GREEN}✅ 本地演示栈已停止${NC}"
}

print_local_stack_status() {
  local running_model=""
  local code=""
  local frontend_code=""

  echo ""
  echo -e "${BLUE}📋 当前演示栈状态${NC}"
  echo -e "   Gateway 目标: ${GREEN}${VLLM_HUST_BASE_URL:-http://localhost:8080}${NC}"
  echo -e "   前端地址:    ${GREEN}$(frontend_probe_url)${NC}"

  if gateway_inference_ready; then
    running_model="$(gateway_current_model)"
    echo -e "   后端状态:    ${GREEN}可推理${NC}${running_model:+ / 模型 ${running_model}}"
  elif gateway_is_running; then
    code="$(gateway_http_code)"
    echo -e "   后端状态:    ${YELLOW}gateway 已响应，但 engine 未就绪${NC} (HTTP ${code:-unknown})"
  else
    echo -e "   后端状态:    ${YELLOW}未检测到本地可用推理服务${NC}"
  fi

  frontend_code="$(frontend_http_code)"
  if frontend_is_healthy; then
    echo -e "   前端状态:    ${GREEN}运行中${NC}"
  elif frontend_is_running; then
    echo -e "   前端状态:    ${YELLOW}进程存在但页面异常${NC} (HTTP ${frontend_code:-unknown})"
  else
    echo -e "   前端状态:    ${YELLOW}未启动${NC}"
  fi

  if gateway_is_local_target; then
    echo -e "   后端日志:    ${GREEN}$SCRIPT_DIR/.logs/vllm-hust-serve.log${NC}"
  else
    echo -e "   后端日志:    ${YELLOW}当前是远端目标，脚本不控制远端服务${NC}"
  fi
  echo -e "   前端日志:    ${GREEN}$(frontend_log_file)${NC}"
}

run_demo_mode() {
  load_env_file
  select_bootstrap_model_interactively
  start_full_stack_if_needed
  ensure_frontend_dev_server

  echo ""
  echo -e "${GREEN}✅ 演示模式已就绪${NC}"
  echo -e "   工作站界面: ${GREEN}$(frontend_probe_url)${NC}"
  echo -e "   OpenAI 接口: ${GREEN}$(gateway_probe_url)${NC}"
}

run_backend_mode() {
  local force_restart="${1:-false}"
  load_env_file
  select_bootstrap_model_interactively
  start_full_stack_if_needed "$force_restart"
}

run_ui_mode() {
  load_env_file
  ensure_frontend_dev_server
}

run_status_mode() {
  load_env_file
  print_local_stack_status
}

run_stop_mode() {
  load_env_file
  stop_local_demo_stack
}

run_interactive_launcher() {
  local choice

  load_env_file

  while true; do
    print_local_stack_status
    echo ""
    echo -e "${BLUE}🎬 演示启动菜单${NC}"
    echo "  1) 一键启动全部（后端 + 工作站 UI）"
    echo "  2) 仅启动 / 修复本地 vllm-hust 后端"
    echo "  3) 仅启动工作站前端"
    echo "  4) 查看当前状态"
    echo "  5) 重启本地后端"
    echo "  6) 停止本地演示栈"
    echo "  0) 退出"
    echo ""

    read -r -p "请选择 [1]: " choice
    choice="${choice:-1}"

    case "$choice" in
      1)
        select_bootstrap_model_interactively
        start_full_stack_if_needed
        ensure_frontend_dev_server
        return 0
        ;;
      2)
        select_bootstrap_model_interactively
        start_full_stack_if_needed
        return 0
        ;;
      3)
        ensure_frontend_dev_server
        return 0
        ;;
      4)
        ;;
      5)
        select_bootstrap_model_interactively
        start_full_stack_if_needed true
        return 0
        ;;
      6)
        stop_local_demo_stack
        ;;
      0)
        return 0
        ;;
      *)
        echo -e "${YELLOW}✗ 无效选项，请输入 0-6${NC}"
        ;;
    esac
  done
}

MODE="${1:-auto}"
COMPOSE_COMMAND=""

if [[ $# -eq 0 ]] && interactive_launcher_enabled; then
  MODE="menu"
fi

if [[ "$MODE" == "menu" ]]; then
  run_interactive_launcher
  exit 0
fi

if [[ "$MODE" == "demo" ]]; then
  run_demo_mode
  exit 0
fi

if [[ "$MODE" == "backend" ]]; then
  run_backend_mode
  exit 0
fi

if [[ "$MODE" == "restart-backend" ]]; then
  run_backend_mode true
  exit 0
fi

if [[ "$MODE" == "ui" ]]; then
  run_ui_mode
  exit 0
fi

if [[ "$MODE" == "status" ]]; then
  run_status_mode
  exit 0
fi

if [[ "$MODE" == "stop" ]]; then
  run_stop_mode
  exit 0
fi

if [[ "$MODE" == "auto" ]]; then
  if command -v docker &>/dev/null; then
    COMPOSE_COMMAND="$(resolve_compose_command)"
    if [[ -n "$COMPOSE_COMMAND" ]]; then
      MODE="docker"
    else
      ensure_node_runtime || true
      if command -v node &>/dev/null && command -v npm &>/dev/null; then
        MODE="dev"
        echo -e "${YELLOW}ℹ 检测到 docker 但缺少 Docker Compose（docker compose/docker-compose），自动切换到 dev 模式${NC}"
      else
        echo -e "${YELLOW}✗ 检测到 docker，但缺少 Docker Compose（docker compose/docker-compose），且无可用 node/npm 环境${NC}"
        echo -e "${YELLOW}  若当前 shell 已激活 conda，可保持 WORKSTATION_AUTO_INSTALL_NODE_WITH_CONDA=true 让脚本自动安装 Node.js${NC}"
        exit 1
      fi
    fi
  else
    ensure_node_runtime || true
    if command -v node &>/dev/null && command -v npm &>/dev/null; then
      MODE="dev"
      echo -e "${YELLOW}ℹ 未检测到 docker，自动切换到 dev 模式${NC}"
    else
      echo -e "${YELLOW}✗ 未检测到可用的 docker 或 node/npm 环境${NC}"
      echo -e "${YELLOW}  若当前 shell 已激活 conda，可保持 WORKSTATION_AUTO_INSTALL_NODE_WITH_CONDA=true 让脚本自动安装 Node.js${NC}"
      exit 1
    fi
  fi
fi

if [[ "$MODE" == "docker" ]]; then
  check docker
  check curl

  COMPOSE_COMMAND="${COMPOSE_COMMAND:-$(resolve_compose_command)}"
  if [[ -z "$COMPOSE_COMMAND" ]]; then
    echo -e "${YELLOW}✗ 未检测到 Docker Compose（docker compose/docker-compose），无法使用 docker 模式${NC}"
    echo -e "${YELLOW}  可安装 Docker Compose，或改用: ./quickstart.sh dev${NC}"
    exit 1
  fi

  local_compose_cmd=(docker compose)
  if [[ "$COMPOSE_COMMAND" == "docker-compose" ]]; then
    local_compose_cmd=(docker-compose)
  fi

  load_env_file
  select_bootstrap_model_interactively
  start_full_stack_if_needed

  echo -e "${BLUE}🐳 构建镜像（首次约需 2~3 分钟，请耐心等待…）${NC}"
  "${local_compose_cmd[@]}" build

  echo -e "${BLUE}🚀 启动容器…${NC}"
  "${local_compose_cmd[@]}" up -d

  compose_hint="$COMPOSE_COMMAND"

  echo ""
  echo -e "${GREEN}✅ 启动成功！${NC}"
  echo -e "   浏览器访问: ${GREEN}http://localhost:${APP_PORT:-3000}${NC}"
  echo ""
  echo -e "   实时日志:   ${compose_hint} logs -f"
  echo -e "   停止服务:   ${compose_hint} down"

elif [[ "$MODE" == "dev" ]]; then
  ensure_node_runtime || true
  check node
  check npm
  check curl

  load_env_file
  select_bootstrap_model_interactively
  start_full_stack_if_needed

  echo -e "${BLUE}📦 安装依赖…${NC}"
  npm install

  echo -e "${BLUE}🚀 启动开发服务器…${NC}"
  npm run dev

else
  echo "用法: $0 [menu|demo|backend|restart-backend|ui|status|stop|auto|docker|dev]"
  echo "  menu            — 交互式演示启动菜单（本地终端默认）"
  echo "  demo            — 后台一键拉起后端 + 工作站 UI"
  echo "  backend         — 仅启动 / 修复本地 vllm-hust 后端"
  echo "  restart-backend — 强制重启本地 vllm-hust 后端"
  echo "  ui              — 仅后台启动工作站前端"
  echo "  status          — 查看当前本地演示栈状态"
  echo "  stop            — 停止本地演示栈"
  echo "  auto    — 自动选择 docker 或 dev（默认）"
  echo "  docker  — Docker Compose 部署（推荐生产/演示）"
  echo "  dev     — 本地 npm 开发模式"
  echo ""
  echo "可通过 WORKSTATION_INTERACTIVE_LAUNCHER=false 关闭默认演示菜单"
  echo "可通过 WORKSTATION_INTERACTIVE_MODEL_MENU=false 关闭启动时模型菜单"
  echo "可通过 WORKSTATION_TOOL_CALL_PARSER=pythonic 切换工具解析器"
  exit 1
fi
