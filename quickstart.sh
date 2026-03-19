#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

WORKSTATION_BOOTSTRAP_MODEL_DEFAULT="sshleifer/tiny-gpt2"
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
echo -e "${BLUE}║     SageLLM Workstation  —  快速启动         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── 前置检查 ─────────────────────────────────────────────
check() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${YELLOW}✗ 需要 $1，请先安装后重试${NC}"
    exit 1
  fi
}

ensure_env_file() {
  if [[ ! -f .env ]]; then
    cp .env.example .env
    echo -e "${YELLOW}⚙  已生成 .env，请按需修改配置${NC}"
  fi
}

load_env_file() {
  ensure_env_file
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a
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

gateway_host() {
  local base_url="${SAGELLM_BASE_URL:-http://localhost:8080}"
  local authority="${base_url#*://}"
  authority="${authority%%/*}"
  printf '%s\n' "${authority%%:*}"
}

gateway_port() {
  local base_url="${SAGELLM_BASE_URL:-http://localhost:8080}"
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
      printf '%s\n' "${SAGELLM_BASE_URL:-http://localhost:8080}"
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

gateway_http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$(gateway_probe_url)/health" 2>/dev/null || true
}

gateway_is_running() {
  local code
  code="$(gateway_http_code)"
  [[ -n "$code" && "$code" != "000" ]]
}

build_workspace_pythonpath() {
  local parent_dir
  local repo
  local pythonpath=""
  parent_dir="$(cd "$SCRIPT_DIR/.." && pwd)"
  for repo in \
    vllm-hust \
    vllm-hust-protocol \
    vllm-hust-backend \
    vllm-hust-core \
    vllm-hust-control-plane \
    vllm-hust-gateway \
    vllm-hust-kv-cache \
    vllm-hust-comm \
    vllm-hust-compression \
    sagellm \
    sagellm-protocol \
    sagellm-backend \
    sagellm-core \
    sagellm-control-plane \
    sagellm-gateway \
    sagellm-kv-cache \
    sagellm-comm \
    sagellm-compression
  do
    if [[ -d "$parent_dir/$repo/src" ]]; then
      pythonpath="${pythonpath:+$pythonpath:}$parent_dir/$repo/src"
    fi
  done
  printf '%s\n' "$pythonpath"
}

bootstrap_model() {
  printf '%s\n' "${WORKSTATION_BOOTSTRAP_MODEL:-$WORKSTATION_BOOTSTRAP_MODEL_DEFAULT}"
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
  local code
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
      -H "Authorization: Bearer ${SAGELLM_API_KEY:-not-required}" \
      -X POST "$(gateway_probe_url)/v1/chat/completions" \
      -d "{\"model\":\"${model_id}\",\"messages\":[{\"role\":\"user\",\"content\":\"${WORKSTATION_HEALTHCHECK_PROMPT}\"}],\"max_tokens\":1,\"stream\":false}" \
      2>/dev/null || true
  )"

  if [[ "$code" == "200" ]] && grep -q '"choices"' "$body"; then
    rm -f "$body"
    return 0
  fi

  rm -f "$body"
  return 1
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

stop_local_processes_on_port() {
  local port
  local pids
  port="$1"
  pids="$(find_listening_pids_for_port "$port")"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo -e "${YELLOW}♻️ 端口 ${port} 上已有本地进程，正在停止以便重建可用栈…${NC}"
  printf '%s\n' "$pids" | xargs -r kill
  sleep 2
  pids="$(find_listening_pids_for_port "$port")"
  if [[ -n "$pids" ]]; then
    printf '%s\n' "$pids" | xargs -r kill -9
  fi
}

find_sagellm_serve_pids() {
  local port="$1"
  local engine_port="$2"
  pgrep -af 'vllm-hust serve|sagellm serve|vllm_hust\.cli serve|sagellm\.cli serve' 2>/dev/null \
    | awk -v port="$port" -v engine_port="$engine_port" '
        $0 ~ /(vllm-hust|sagellm|vllm_hust\.cli|sagellm\.cli) serve/ && $0 ~ ("--port " port) && $0 ~ ("--engine-port " engine_port) {
          print $1
        }
      ' \
    | sort -u || true
}

stop_local_sagellm_serve_processes() {
  local port="$1"
  local engine_port="$2"
  local pids

  pids="$(find_sagellm_serve_pids "$port" "$engine_port")"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo -e "${YELLOW}♻️ 检测到残留 vllm-hust/sagellm serve 进程，正在清理…${NC}"
  printf '%s\n' "$pids" | xargs -r kill
  sleep 2
  pids="$(find_sagellm_serve_pids "$port" "$engine_port")"
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
  update_env_value ".env" "WORKSTATION_BOOTSTRAP_MODEL" "$selected_model"
  update_env_value ".env" "DEFAULT_MODEL" "$selected_model"

  echo -e "${GREEN}✅ 本次启动模型已设为: ${selected_model}${NC}"
}

start_full_stack_if_needed() {
  local auto_start
  local auto_heal
  local port
  local engine_port
  local log_dir
  local log_file
  local model
  local backend
  local running_model
  local pythonpath
  auto_start="${WORKSTATION_AUTO_START_GATEWAY:-true}"
  auto_heal="${WORKSTATION_AUTO_HEAL_GATEWAY:-true}"
  port="$(gateway_port)"
  engine_port="${WORKSTATION_ENGINE_PORT:-$((port + 1))}"
  log_dir="$SCRIPT_DIR/.logs"
  log_file="$log_dir/vllm-hust-serve.log"
  model="$(bootstrap_model)"
  backend="$(bootstrap_backend)"

  if gateway_inference_ready; then
    running_model="$(gateway_current_model)"
    if gateway_is_local_target && [[ -n "$running_model" && "$running_model" != "$model" ]]; then
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
    echo -e "${YELLOW}✗ 当前 SAGELLM_BASE_URL=${SAGELLM_BASE_URL:-http://localhost:8080} 指向远端地址，脚本不会擅自拉起远端服务${NC}"
    exit 1
  fi

  if gateway_is_running && [[ "$auto_heal" != "true" ]]; then
    echo -e "${YELLOW}✗ 本地 gateway 已运行但不可推理，且 WORKSTATION_AUTO_HEAL_GATEWAY=false${NC}"
    echo -e "${YELLOW}  请先修复本地 gateway / engine，再重新执行脚本${NC}"
    exit 1
  fi

  mkdir -p "$log_dir"
  echo -e "${BLUE}🌐 未检测到可推理服务，正在自动启动完整栈…${NC}"
  echo -e "   模型: ${GREEN}${model}${NC}"
  echo -e "   后端: ${GREEN}${backend}${NC}"
  echo -e "   端口: ${GREEN}${port}${NC} (engine: ${engine_port})"

  stop_local_sagellm_serve_processes "$port" "$engine_port"
  stop_local_processes_on_port "$port"
  stop_local_processes_on_port "$engine_port"

  if command -v vllm-hust &>/dev/null; then
    nohup env \
      SAGELLM_PREFLIGHT_CANARY=0 \
      SAGELLM_STARTUP_CANARY=0 \
      SAGELLM_PERIODIC_CANARY=0 \
      vllm-hust serve --backend "$backend" --model "$model" --host 0.0.0.0 --port "$port" --engine-port "$engine_port" >"$log_file" 2>&1 &
  elif command -v sagellm &>/dev/null; then
    nohup env \
      SAGELLM_PREFLIGHT_CANARY=0 \
      SAGELLM_STARTUP_CANARY=0 \
      SAGELLM_PERIODIC_CANARY=0 \
      sagellm serve --backend "$backend" --model "$model" --host 0.0.0.0 --port "$port" --engine-port "$engine_port" >"$log_file" 2>&1 &
  else
    pythonpath="$(build_workspace_pythonpath)"
    if command -v python3 &>/dev/null && [[ -n "$pythonpath" ]]; then
      if PYTHONPATH="$pythonpath" python3 -c 'import vllm_hust.cli' >/dev/null 2>&1; then
        nohup env \
          PYTHONPATH="$pythonpath" \
          SAGELLM_PREFLIGHT_CANARY=0 \
          SAGELLM_STARTUP_CANARY=0 \
          SAGELLM_PERIODIC_CANARY=0 \
          python3 -m vllm_hust.cli serve --backend "$backend" --model "$model" --host 0.0.0.0 --port "$port" --engine-port "$engine_port" >"$log_file" 2>&1 &
      else
        nohup env \
          PYTHONPATH="$pythonpath" \
          SAGELLM_PREFLIGHT_CANARY=0 \
          SAGELLM_STARTUP_CANARY=0 \
          SAGELLM_PERIODIC_CANARY=0 \
          python3 -m sagellm.cli serve --backend "$backend" --model "$model" --host 0.0.0.0 --port "$port" --engine-port "$engine_port" >"$log_file" 2>&1 &
      fi
    elif command -v python &>/dev/null && [[ -n "$pythonpath" ]]; then
      if PYTHONPATH="$pythonpath" python -c 'import vllm_hust.cli' >/dev/null 2>&1; then
        nohup env \
          PYTHONPATH="$pythonpath" \
          SAGELLM_PREFLIGHT_CANARY=0 \
          SAGELLM_STARTUP_CANARY=0 \
          SAGELLM_PERIODIC_CANARY=0 \
          python -m vllm_hust.cli serve --backend "$backend" --model "$model" --host 0.0.0.0 --port "$port" --engine-port "$engine_port" >"$log_file" 2>&1 &
      else
        nohup env \
          PYTHONPATH="$pythonpath" \
          SAGELLM_PREFLIGHT_CANARY=0 \
          SAGELLM_STARTUP_CANARY=0 \
          SAGELLM_PERIODIC_CANARY=0 \
          python -m sagellm.cli serve --backend "$backend" --model "$model" --host 0.0.0.0 --port "$port" --engine-port "$engine_port" >"$log_file" 2>&1 &
      fi
    else
      echo -e "${YELLOW}✗ 无法自动启动完整栈：未找到 vllm-hust/sagellm CLI，也没有可用 Python + workspace 源码入口${NC}"
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

MODE="${1:-auto}"

if [[ "$MODE" == "auto" ]]; then
  if command -v docker &>/dev/null; then
    MODE="docker"
  elif command -v node &>/dev/null && command -v npm &>/dev/null; then
    MODE="dev"
    echo -e "${YELLOW}ℹ 未检测到 docker，自动切换到 dev 模式${NC}"
  else
    echo -e "${YELLOW}✗ 未检测到可用的 docker 或 node/npm 环境${NC}"
    exit 1
  fi
fi

if [[ "$MODE" == "docker" ]]; then
  check docker
  check curl

  load_env_file
  select_bootstrap_model_interactively
  start_full_stack_if_needed

  echo -e "${BLUE}🐳 构建镜像（首次约需 2~3 分钟，请耐心等待…）${NC}"
  docker compose build

  echo -e "${BLUE}🚀 启动容器…${NC}"
  docker compose up -d

  echo ""
  echo -e "${GREEN}✅ 启动成功！${NC}"
  echo -e "   浏览器访问: ${GREEN}http://localhost:${APP_PORT:-3000}${NC}"
  echo ""
  echo -e "   实时日志:   docker compose logs -f"
  echo -e "   停止服务:   docker compose down"

elif [[ "$MODE" == "dev" ]]; then
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
  echo "用法: $0 [auto|docker|dev]"
  echo "  auto    — 自动选择 docker 或 dev（默认）"
  echo "  docker  — Docker Compose 部署（推荐生产/演示）"
  echo "  dev     — 本地 npm 开发模式"
  echo ""
  echo "可通过 WORKSTATION_INTERACTIVE_MODEL_MENU=false 关闭启动时模型菜单"
  exit 1
fi
