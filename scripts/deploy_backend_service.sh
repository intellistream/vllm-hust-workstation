#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_HOME_DEFAULT="$REPO_DIR/.workstation-deploy"
SERVICE_NAME_DEFAULT="vllm-hust-backend"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SYSTEMD_TEMPLATE="$REPO_DIR/deploy/systemd/vllm-hust-backend.service.template"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/runtime_manager.sh"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_env_file() {
  if [[ ! -f "$REPO_DIR/.env" ]]; then
    cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
    echo "[deploy] created $REPO_DIR/.env from template; review it before exposing the service publicly" >&2
  fi
}

load_env_file() {
  ensure_env_file
  set -a
  # shellcheck disable=SC1091
  source "$REPO_DIR/.env" 2>/dev/null || true
  set +a
}

deploy_home() {
  printf '%s\n' "${WORKSTATION_DEPLOY_HOME:-$DEPLOY_HOME_DEFAULT}"
}

systemd_env_file() {
  printf '%s/backend-systemd.env\n' "$(deploy_home)"
}

service_name() {
  printf '%s\n' "${WORKSTATION_BACKEND_SYSTEMD_SERVICE_NAME:-$SERVICE_NAME_DEFAULT}"
}

service_unit_path() {
  printf '%s/%s.service\n' "$SYSTEMD_USER_DIR" "$(service_name)"
}

ensure_systemd_user() {
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "systemd --user is not available for the current user session" >&2
    exit 1
  fi
}

stop_port_listener() {
  local port="$1"
  local pids=""

  if command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp 2>/dev/null | grep -E ":${port}[[:space:]]" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)"
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
  fi

  if [[ -n "$pids" ]]; then
    printf '%s\n' "$pids" | xargs -r kill
    sleep 2
  fi
}

write_systemd_env() {
  local python_bin pythonpath vllm_bin library_path
  python_bin="$(active_python_command || true)"
  pythonpath="$(build_workspace_pythonpath)"
  vllm_bin="$(command -v vllm-hust || true)"
  library_path="$(python_library_path "$python_bin" || true)"

  if [[ -z "$python_bin" || ! -x "$python_bin" ]]; then
    echo "Unable to resolve python binary for backend service" >&2
    exit 1
  fi

  if [[ -n "$vllm_bin" ]]; then
    if ! env \
      PYTHONNOUSERSITE=1 \
      PYTHONPATH="$pythonpath" \
      LD_LIBRARY_PATH="${library_path}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
      "$vllm_bin" serve --help >/dev/null 2>&1; then
      vllm_bin=""
    fi
  fi

  if [[ -z "$vllm_bin" ]] && ! python_runtime_supports_vllm "$python_bin" "$pythonpath"; then
    repair_backend_runtime_if_possible "$python_bin" || true
    vllm_bin="$(command -v vllm-hust || true)"
  fi

  if [[ -z "$vllm_bin" ]] && ! python_runtime_supports_vllm "$python_bin" "$pythonpath"; then
    echo "Current Python runtime does not support vllm backend startup" >&2
    exit 1
  fi

  mkdir -p "$(deploy_home)"
  cat > "$(systemd_env_file)" <<EOF
WORKSTATION_DEPLOY_HOME=$(deploy_home)
WORKSTATION_VLLM_PYTHON_BIN=$python_bin
WORKSTATION_VLLM_PYTHONPATH=$pythonpath
WORKSTATION_VLLM_SERVE_BIN=$vllm_bin
WORKSTATION_VLLM_LIBRARY_PATH=$library_path
EOF
}

install_service_unit() {
  mkdir -p "$SYSTEMD_USER_DIR"
  sed "s|__REPO_DIR__|$REPO_DIR|g" "$SYSTEMD_TEMPLATE" > "$(service_unit_path)"
  systemctl --user daemon-reload
  systemctl --user enable "$(service_name).service" >/dev/null
}

restart_service() {
  systemctl --user restart "$(service_name).service"
}

status_service() {
  systemctl --user --no-pager --full status "$(service_name).service"
}

logs_service() {
  local lines="${1:-120}"
  journalctl --user -u "$(service_name).service" -n "$lines" --no-pager
}

backend_port() {
  local base_url="${VLLM_HUST_BASE_URL:-http://localhost:8080}"
  local authority="${base_url#*://}"
  authority="${authority%%/*}"
  if [[ "$authority" == *:* ]]; then
    printf '%s\n' "${authority##*:}"
  else
    printf '8080\n'
  fi
}

ci_deploy() {
  load_env_file
  require_command systemctl
  ensure_systemd_user
  write_systemd_env
  install_service_unit
  stop_port_listener "$(backend_port)"
  stop_port_listener "${WORKSTATION_ENGINE_PORT:-8902}"
  restart_service
  sleep 4

  if ! systemctl --user --quiet is-active "$(service_name).service"; then
    echo "systemd backend service failed to become active" >&2
    logs_service 160 || true
    exit 1
  fi

  echo "[deploy] backend service is active: $(service_name).service"
}

MODE="${1:-ci-deploy}"

case "$MODE" in
  install-service)
    load_env_file
    require_command systemctl
    ensure_systemd_user
    write_systemd_env
    install_service_unit
    ;;
  restart)
    load_env_file
    require_command systemctl
    ensure_systemd_user
    restart_service
    ;;
  status)
    load_env_file
    require_command systemctl
    ensure_systemd_user
    status_service
    ;;
  logs)
    load_env_file
    require_command systemctl
    ensure_systemd_user
    logs_service "${2:-120}"
    ;;
  deploy|ci-deploy)
    ci_deploy
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    exit 1
    ;;
esac