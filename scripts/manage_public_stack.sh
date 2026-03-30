#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
QUICKSTART="$REPO_DIR/quickstart.sh"
DEPLOY_WORKSTATION="$REPO_DIR/scripts/deploy_workstation.sh"
DEPLOY_BACKEND="$REPO_DIR/scripts/deploy_backend_service.sh"
WORKSTATION_SERVICE="${WORKSTATION_SYSTEMD_SERVICE_NAME:-vllm-hust-workstation}"
BACKEND_SERVICE="${WORKSTATION_BACKEND_SYSTEMD_SERVICE_NAME:-vllm-hust-backend}"
BACKEND_MODELS_URL="${BACKEND_MODELS_URL:-http://127.0.0.1:8080/v1/models}"
WORKSTATION_MODELS_URL="${WORKSTATION_MODELS_URL:-http://127.0.0.1:3001/api/models}"

usage() {
  cat <<'EOF'
Usage: ./scripts/manage_public_stack.sh <command>

Commands:
  status               Show backend, workstation, and public URL health
  restart-backend      Restart local vllm-hust backend systemd service
  deploy-backend       Install/update and restart the backend systemd service
  restart-workstation  Restart the workstation systemd service
  deploy-workstation   Rebuild and redeploy the workstation runtime via systemd
  restart-all          Restart backend first, then restart workstation
  logs                 Show backend and workstation journals
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_paths() {
  [[ -x "$QUICKSTART" ]] || { echo "Missing quickstart: $QUICKSTART" >&2; exit 1; }
  [[ -x "$DEPLOY_WORKSTATION" ]] || { echo "Missing deploy script: $DEPLOY_WORKSTATION" >&2; exit 1; }
  [[ -x "$DEPLOY_BACKEND" ]] || { echo "Missing backend deploy script: $DEPLOY_BACKEND" >&2; exit 1; }
}

curl_status() {
  local label="$1"
  local url="$2"
  if curl -fsS --max-time 10 "$url" >/dev/null 2>&1; then
    echo "[ok] $label -> $url"
  else
    echo "[fail] $label -> $url"
    return 1
  fi
}

restart_backend() {
  (cd "$REPO_DIR" && "$DEPLOY_BACKEND" restart)
}

deploy_backend() {
  (cd "$REPO_DIR" && "$DEPLOY_BACKEND" ci-deploy)
}

restart_workstation() {
  (cd "$REPO_DIR" && "$DEPLOY_WORKSTATION" restart)
}

deploy_workstation() {
  (cd "$REPO_DIR" && "$DEPLOY_WORKSTATION" ci-deploy)
}

show_logs() {
  echo "=== backend journal ==="
  systemctl --user --no-pager --full status "$BACKEND_SERVICE.service" || true
  echo
  echo "=== workstation journal ==="
  systemctl --user --no-pager --full status "$WORKSTATION_SERVICE.service" || true
}

show_status() {
  echo "=== local health ==="
  curl_status "backend" "$BACKEND_MODELS_URL" || true
  curl_status "workstation" "$WORKSTATION_MODELS_URL" || true
  echo
  echo "=== public health ==="
  curl_status "public workstation" "https://ws.sage.org.ai/api/models" || true
  curl_status "public backend" "https://api.sage.org.ai/v1/models" || true
  echo
  echo "=== backend service ==="
  systemctl --user --no-pager --full status "$BACKEND_SERVICE.service" || true
  echo
  echo "=== workstation service ==="
  systemctl --user --no-pager --full status "$WORKSTATION_SERVICE.service" || true
}

main() {
  local command="${1:-status}"

  require_command curl
  require_command systemctl
  ensure_paths

  case "$command" in
    status)
      show_status
      ;;
    restart-backend)
      restart_backend
      ;;
    deploy-backend)
      deploy_backend
      ;;
    restart-workstation)
      restart_workstation
      ;;
    deploy-workstation)
      deploy_workstation
      ;;
    restart-all)
      deploy_backend
      restart_workstation
      show_status
      ;;
    logs)
      show_logs
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      echo "Unknown command: $command" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"