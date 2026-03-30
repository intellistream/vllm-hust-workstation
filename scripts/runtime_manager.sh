#!/usr/bin/env bash

runtime_manager_helper_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

runtime_manager_workstation_repo_dir() {
  cd "$(runtime_manager_helper_dir)/.." && pwd
}

build_workspace_pythonpath() {
  local parent_dir
  local repo
  local pythonpath=""
  local candidate

  parent_dir="$(cd "$(runtime_manager_workstation_repo_dir)/.." && pwd)"
  for repo in \
    vllm-hust \
    vllm-hust-protocol \
    vllm-hust-backend \
    vllm-hust-core \
    vllm-hust-control-plane \
    vllm-hust-gateway \
    vllm-hust-kv-cache \
    vllm-hust-comm \
    vllm-hust-compression
  do
    for candidate in "$parent_dir/$repo" "$parent_dir/$repo/src"; do
      if [[ -d "$candidate" ]]; then
        case "$candidate" in
          */src)
            pythonpath="${pythonpath:+$pythonpath:}$candidate"
            ;;
          *)
            if [[ -d "$candidate/vllm" || -d "$candidate/vllm_hust" ]]; then
              pythonpath="${pythonpath:+$pythonpath:}$candidate"
            fi
            ;;
        esac
      fi
    done
  done
  printf '%s\n' "$pythonpath"
}

active_python_command() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  if command -v python >/dev/null 2>&1; then
    command -v python
    return 0
  fi
  return 1
}

python_prefix_from_bin() {
  local python_bin="$1"
  local prefix=""

  if [[ -z "$python_bin" ]]; then
    return 1
  fi

  prefix="$(cd "$(dirname "$python_bin")/.." && pwd)"
  if [[ -d "$prefix/lib" ]]; then
    printf '%s\n' "$prefix"
    return 0
  fi

  return 1
}

python_library_path() {
  local python_bin="$1"
  local prefix=""

  prefix="$(python_prefix_from_bin "$python_bin" || true)"
  if [[ -n "$prefix" && -d "$prefix/lib" ]]; then
    printf '%s\n' "$prefix/lib"
    return 0
  fi

  return 1
}

python_runtime_import_details() {
  local python_bin="$1"
  local pythonpath="${2:-}"
  local import_expr='import torch, transformers, tokenizers, huggingface_hub; import vllm.entrypoints.cli.main'

  if [[ -n "$pythonpath" ]]; then
    PYTHONNOUSERSITE=1 PYTHONPATH="$pythonpath" "$python_bin" -c "$import_expr"
    return $?
  fi

  PYTHONNOUSERSITE=1 "$python_bin" -c "$import_expr"
}

python_runtime_supports_vllm() {
  local python_bin="$1"
  local pythonpath="${2:-}"

  python_runtime_import_details "$python_bin" "$pythonpath" >/dev/null 2>&1
}

find_vllm_hust_repo_dir() {
  local workstation_repo
  local workspace_root
  local candidate

  workstation_repo="$(runtime_manager_workstation_repo_dir)"
  workspace_root="$(cd "$workstation_repo/.." && pwd)"

  for candidate in \
    "$workspace_root/vllm-hust" \
    "$workstation_repo/../vllm-hust"
  do
    if [[ -f "$candidate/pyproject.toml" && -f "$candidate/requirements/common.txt" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

find_ascend_manager_repo_dir() {
  local workstation_repo
  local workspace_root
  local candidate

  workstation_repo="$(runtime_manager_workstation_repo_dir)"
  workspace_root="$(cd "$workstation_repo/.." && pwd)"

  for candidate in \
    "$workspace_root/ascend-runtime-manager" \
    "$workspace_root/vllm-hust-dev-hub/ascend-runtime-manager"
  do
    if [[ -f "$candidate/pyproject.toml" && -d "$candidate/src/hust_ascend_manager" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

workstation_auto_repair_backend_runtime_enabled() {
  [[ "${WORKSTATION_AUTO_REPAIR_BACKEND_RUNTIME:-true}" == "true" ]]
}

run_ascend_manager_runtime() {
  local action="$1"
  local repo_dir="$2"
  local python_bin="$3"
  local manager_repo=""

  if command -v hust-ascend-manager >/dev/null 2>&1; then
    hust-ascend-manager runtime "$action" --repo "$repo_dir" --python "$python_bin"
    return $?
  fi

  manager_repo="$(find_ascend_manager_repo_dir || true)"
  if [[ -n "$manager_repo" && -n "$python_bin" && -x "$python_bin" ]]; then
    PYTHONPATH="$manager_repo/src${PYTHONPATH:+:$PYTHONPATH}" "$python_bin" -m hust_ascend_manager.cli runtime "$action" --repo "$repo_dir" --python "$python_bin"
    return $?
  fi

  return 1
}

repair_backend_runtime_if_possible() {
  local python_bin="$1"
  local repo_dir=""

  if ! workstation_auto_repair_backend_runtime_enabled; then
    return 1
  fi

  repo_dir="$(find_vllm_hust_repo_dir || true)"
  if [[ -z "$repo_dir" || -z "$python_bin" ]]; then
    return 1
  fi

  if [[ -n "${BLUE:-}" && -n "${GREEN:-}" && -n "${NC:-}" ]]; then
    echo -e "${BLUE}🩺 检测到 vllm-hust Python 运行时不完整，正在通过 ascend-runtime-manager 自动修复…${NC}"
    echo -e "   repo:   ${GREEN}${repo_dir}${NC}"
    echo -e "   python: ${GREEN}${python_bin}${NC}"
  else
    echo "[runtime] detected incomplete vllm-hust runtime; repairing via ascend-runtime-manager" >&2
    echo "[runtime] repo: $repo_dir" >&2
    echo "[runtime] python: $python_bin" >&2
  fi

  run_ascend_manager_runtime repair "$repo_dir" "$python_bin"
}

ensure_backend_runtime_ready() {
  local python_bin="$1"
  local pythonpath="${2:-}"

  if python_runtime_supports_vllm "$python_bin" "$pythonpath"; then
    return 0
  fi

  if repair_backend_runtime_if_possible "$python_bin" && python_runtime_supports_vllm "$python_bin" "$pythonpath"; then
    return 0
  fi

  return 1
}