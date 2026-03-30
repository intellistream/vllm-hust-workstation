#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_HOME="$(cd "$REPO_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/workspace_search.sh repos [--scope local|upstream|all]
  ./scripts/workspace_search.sh text [--scope local|upstream|all] [--hidden] [--ignored] <pattern>
  ./scripts/workspace_search.sh files [--scope local|upstream|all] [--hidden] [--ignored] <pattern>

Scopes:
  local     Search local working repos in this workspace
  upstream  Search reference repos under reference-repos/
  all       Search both local and upstream repos

Examples:
  ./scripts/workspace_search.sh repos
  ./scripts/workspace_search.sh text "deploy-backend"
  ./scripts/workspace_search.sh text --scope all "Qwen2.5-7B-Instruct"
  ./scripts/workspace_search.sh files "systemd|deploy"
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

append_if_dir() {
  local path="$1"
  if [[ -d "$path" ]]; then
    SEARCH_ROOTS+=("$path")
  fi
}

collect_roots() {
  local scope="$1"

  SEARCH_ROOTS=()

  if [[ "$scope" == "local" || "$scope" == "all" ]]; then
    append_if_dir "$WORKSPACE_HOME/vllm-hust"
    append_if_dir "$WORKSPACE_HOME/vllm-hust-workstation"
    append_if_dir "$WORKSPACE_HOME/vllm-hust-website"
    append_if_dir "$WORKSPACE_HOME/vllm-hust-docs"
    append_if_dir "$WORKSPACE_HOME/vllm-ascend-hust"
    append_if_dir "$WORKSPACE_HOME/vllm-hust-dev-hub"
    append_if_dir "$WORKSPACE_HOME/vllm-hust-benchmark"
    append_if_dir "$WORKSPACE_HOME/EvoScientist"
  fi

  if [[ "$scope" == "upstream" || "$scope" == "all" ]]; then
    append_if_dir "$WORKSPACE_HOME/reference-repos/vllm"
    append_if_dir "$WORKSPACE_HOME/reference-repos/vllm-ascend"
    append_if_dir "$WORKSPACE_HOME/reference-repos/sglang"
  fi

  if [[ ${#SEARCH_ROOTS[@]} -eq 0 ]]; then
    echo "No repositories found for scope: $scope" >&2
    exit 1
  fi
}

print_roots() {
  local root
  for root in "${SEARCH_ROOTS[@]}"; do
    printf '%s\n' "$root"
  done
}

main() {
  local command="${1:-}"
  local scope="local"
  local include_hidden="false"
  local include_ignored="false"
  local pattern=""
  local -a rg_args
  local -a SEARCH_ROOTS

  shift || true

  if [[ -z "$command" || "$command" == "-h" || "$command" == "--help" ]]; then
    usage
    return 0
  fi

  require_command rg

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --scope)
        scope="${2:-}"
        shift 2
        ;;
      --hidden)
        include_hidden="true"
        shift
        ;;
      --ignored)
        include_ignored="true"
        shift
        ;;
      -h|--help)
        usage
        return 0
        ;;
      *)
        if [[ -z "$pattern" ]]; then
          pattern="$1"
          shift
        else
          echo "Unexpected argument: $1" >&2
          usage >&2
          exit 1
        fi
        ;;
    esac
  done

  case "$scope" in
    local|upstream|all) ;;
    *)
      echo "Unsupported scope: $scope" >&2
      usage >&2
      exit 1
      ;;
  esac

  collect_roots "$scope"

  case "$command" in
    repos)
      print_roots
      ;;
    text)
      if [[ -z "$pattern" ]]; then
        echo "Missing text search pattern" >&2
        usage >&2
        exit 1
      fi
      rg_args=(-n --smart-case --color=never)
      if [[ "$include_hidden" == "true" ]]; then
        rg_args+=(--hidden)
      fi
      if [[ "$include_ignored" == "true" ]]; then
        rg_args+=(--no-ignore)
      fi
      rg "${rg_args[@]}" "$pattern" "${SEARCH_ROOTS[@]}"
      ;;
    files)
      if [[ -z "$pattern" ]]; then
        echo "Missing file search pattern" >&2
        usage >&2
        exit 1
      fi
      rg_args=(--files)
      if [[ "$include_hidden" == "true" ]]; then
        rg_args+=(--hidden)
      fi
      if [[ "$include_ignored" == "true" ]]; then
        rg_args+=(--no-ignore)
      fi
      rg "${rg_args[@]}" "${SEARCH_ROOTS[@]}" | rg --smart-case --color=never "$pattern"
      ;;
    *)
      echo "Unsupported command: $command" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"