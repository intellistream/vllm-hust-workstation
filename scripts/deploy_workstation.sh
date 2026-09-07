#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_HOME_DEFAULT="$REPO_DIR/.workstation-deploy"
SERVICE_NAME_DEFAULT="vllm-hust-workstation"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SYSTEMD_TEMPLATE="$REPO_DIR/deploy/systemd/vllm-hust-workstation.service.template"
source "$SCRIPT_DIR/lib/runtime_secrets.sh"

resolve_conda_command() {
  if [[ -n "${CONDA_EXE:-}" && -x "${CONDA_EXE}" ]]; then
    printf '%s\n' "$CONDA_EXE"
    return 0
  fi
  if command -v conda >/dev/null 2>&1; then
    command -v conda
    return 0
  fi
  return 1
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

workstation_auto_install_node_enabled() {
  [[ "${WORKSTATION_AUTO_INSTALL_NODE_WITH_CONDA:-true}" == "true" ]]
}

ensure_node_runtime() {
  local conda_cmd
  local conda_env
  local node_version_spec

  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
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

  echo "[deploy] node/npm not found, installing ${node_version_spec} into conda env ${conda_env}" >&2
  # Use `command conda` to bypass the conda shell function wrapper installed
  # by `conda init`.  That wrapper uses $* expansion, which strips quoting
  # from arguments containing shell metacharacters (>=, <).  Without this,
  # a version spec like "nodejs>=20,<21" gets re-parsed by bash as:
  #   nodejs  >"=20,"  <21   (creating a garbage "=20," file)
  # shellcheck disable=SC2086
  command "$conda_cmd" install -y -n "$conda_env" -c conda-forge "$node_version_spec"

  if [[ -n "${CONDA_PREFIX:-}" && -d "${CONDA_PREFIX}/bin" ]]; then
    case ":$PATH:" in
      *":${CONDA_PREFIX}/bin:"*) ;;
      *) export PATH="${CONDA_PREFIX}/bin:$PATH" ;;
    esac
  fi

  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1
}

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
  source "$REPO_DIR/.env"
  set +a
  load_workstation_upstream_api_key
}

deploy_home() {
  printf '%s\n' "${WORKSTATION_DEPLOY_HOME:-$DEPLOY_HOME_DEFAULT}"
}

runtime_dir() {
  if [[ -n "${WORKSTATION_DEPLOY_RUNTIME_DIR:-}" ]]; then
    printf '%s\n' "$WORKSTATION_DEPLOY_RUNTIME_DIR"
    return 0
  fi
  printf '%s/current\n' "$(deploy_home)"
}

releases_dir() {
  printf '%s/releases\n' "$(deploy_home)"
}

legacy_runtime_dir() {
  printf '%s/runtime\n' "$(deploy_home)"
}

systemd_env_file() {
  printf '%s/systemd.env\n' "$(deploy_home)"
}

service_name() {
  printf '%s\n' "${WORKSTATION_SYSTEMD_SERVICE_NAME:-$SERVICE_NAME_DEFAULT}"
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

npm_install() {
  cd "$REPO_DIR"
  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund
  else
    npm install --prefer-offline --no-audit --no-fund
  fi
}

build_app() {
  cd "$REPO_DIR"
  rm -rf .next
  NEXT_TELEMETRY_DISABLED=1 npm run build

  if [[ ! -f "$REPO_DIR/.next/standalone/server.js" ]]; then
    echo "Next standalone build is missing .next/standalone/server.js" >&2
    exit 1
  fi
  node "$SCRIPT_DIR/check_standalone.mjs"
}

capture_runtime_provenance() {
  local receipt_file
  receipt_file="${WORKSTATION_RUNTIME_PROVENANCE_FILE:-$(deploy_home)/runtime-provenance.json}"

  if [[ -n "${WORKSTATION_RUNTIME_CONTAINER:-}" ]]; then
    echo "[deploy] capturing immutable runtime provenance from ${WORKSTATION_RUNTIME_CONTAINER}" >&2
    WORKSTATION_RUNTIME_PROVENANCE_FILE="$receipt_file" \
      "$SCRIPT_DIR/capture_runtime_provenance.sh" "$WORKSTATION_RUNTIME_CONTAINER" "$receipt_file"
    return 0
  fi

  if [[ ! -f "$receipt_file" ]]; then
    echo "[deploy] warning: no runtime provenance receipt; /api/versions will report unavailable" >&2
  fi
}

stage_runtime() {
  local release_id staging_dir target_dir
  release_id="$(git -C "$REPO_DIR" rev-parse --verify HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
  staging_dir="$(releases_dir)/.${release_id}.tmp"
  target_dir="$(releases_dir)/${release_id}"

  mkdir -p "$(releases_dir)"
  if [[ -e "$staging_dir" || -e "$target_dir" ]]; then
    echo "Refusing to overwrite an existing release: $release_id" >&2
    return 1
  fi
  mkdir -p "$staging_dir/.next"

  cp -R "$REPO_DIR/.next/standalone/." "$staging_dir/"
  cp -R "$REPO_DIR/.next/static" "$staging_dir/.next/static"
  if [[ -d "$REPO_DIR/public" ]]; then
    cp -R "$REPO_DIR/public" "$staging_dir/public"
  fi
  mv "$staging_dir" "$target_dir"
  printf '%s\n' "$target_dir"
}

activate_runtime() {
  local target_dir="$1"
  local active_link next_link
  active_link="$(runtime_dir)"
  next_link="${active_link}.next.$$"
  if [[ ! -f "$target_dir/server.js" || ! -d "$target_dir/.next/static" ]]; then
    echo "Refusing to activate incomplete release: $target_dir" >&2
    return 1
  fi
  if [[ -e "$active_link" && ! -L "$active_link" ]]; then
    echo "Atomic runtime path must be a symlink or absent: $active_link" >&2
    return 1
  fi
  ln -s "$target_dir" "$next_link"
  mv -Tf "$next_link" "$active_link"
}

service_healthy() {
  local base mods_count
  base="http://127.0.0.1:${APP_PORT:-3000}"
  curl -fsS --max-time 3 "$base/api/mod-runtime" >/dev/null || return 1
  mods_count="$(curl -fsS --max-time 3 "$base/api/mods" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s);process.stdout.write(String(Array.isArray(v.catalog)?v.catalog.length:-1))}catch{process.stdout.write("-1")}})')"
  [[ "$mods_count" == "19" ]]
}

wait_for_service_health() {
  local attempt
  for attempt in $(seq 1 20); do
    if systemctl --user --quiet is-active "$(service_name).service" && service_healthy; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

write_systemd_env() {
  local node_bin
  node_bin="${WORKSTATION_NODE_BIN:-$(command -v node || true)}"

  if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
    echo "Unable to resolve node binary for systemd service" >&2
    exit 1
  fi

  mkdir -p "$(deploy_home)"
  umask 077
  cat > "$(systemd_env_file)" <<EOF
WORKSTATION_NODE_BIN=$node_bin
WORKSTATION_DEPLOY_RUNTIME_DIR=$(runtime_dir)
WORKSTATION_DEPLOY_HOME=$(deploy_home)
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

build_runtime() {
  local staged_runtime
  load_env_file
  capture_runtime_provenance
  ensure_node_runtime || true
  require_command node
  require_command npm
  npm_install
  npm run lint
  build_app
  staged_runtime="$(stage_runtime)"
  write_systemd_env
  echo "[build] staged immutable release: $staged_runtime"
}

ci_deploy() {
  local staged_runtime previous_runtime active_link
  load_env_file
  capture_runtime_provenance
  ensure_node_runtime || true
  require_command node
  require_command npm
  require_command curl
  require_command systemctl
  ensure_systemd_user
  npm_install
  npm run lint
  build_app
  if [[ -n "${WORKSTATION_RUNTIME_CONTAINER:-}" ]]; then
    bash "$SCRIPT_DIR/install_runtime_provenance_timer.sh"
  fi
  staged_runtime="$(stage_runtime)"
  write_systemd_env
  install_service_unit
  active_link="$(runtime_dir)"
  previous_runtime="$(readlink -f "$active_link" 2>/dev/null || true)"
  if [[ -z "$previous_runtime" && -f "$(legacy_runtime_dir)/server.js" ]]; then
    previous_runtime="$(legacy_runtime_dir)"
  fi
  activate_runtime "$staged_runtime"
  restart_service

  if ! wait_for_service_health; then
    echo "workstation release failed health checks; rolling back" >&2
    if [[ -n "$previous_runtime" && -f "$previous_runtime/server.js" ]]; then
      activate_runtime "$previous_runtime"
      restart_service
      wait_for_service_health || true
    fi
    logs_service 120 || true
    exit 1
  fi

  echo "[deploy] workstation service is healthy: $(service_name).service"
  echo "[deploy] active immutable release: $staged_runtime"
}

MODE="${1:-ci-deploy}"

case "$MODE" in
  build)
    build_runtime
    ;;
  install-service)
    load_env_file
    ensure_node_runtime || true
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
    require_command journalctl
    logs_service "${2:-120}"
    ;;
  ci-deploy)
    ci_deploy
    ;;
  deploy)
    ci_deploy
    ;;
  *)
    echo "Usage: $0 {build|install-service|restart|status|logs|deploy|ci-deploy}" >&2
    exit 1
    ;;
esac
