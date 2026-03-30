#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
QUICKSTART="$REPO_DIR/quickstart.sh"
DEPLOY_WORKSTATION="$REPO_DIR/scripts/deploy_workstation.sh"
DEPLOY_BACKEND="$REPO_DIR/scripts/deploy_backend_service.sh"
WEBSITE_REPO_DIR_DEFAULT="$(cd "$REPO_DIR/.." && pwd)/vllm-hust-website"
WEBSITE_REPO_DIR="${WORKSTATION_WEBSITE_REPO_DIR:-$WEBSITE_REPO_DIR_DEFAULT}"
DEPLOY_WEBSITE="$WEBSITE_REPO_DIR/scripts/deploy_website_service.sh"
WORKSTATION_SERVICE="${WORKSTATION_SYSTEMD_SERVICE_NAME:-vllm-hust-workstation}"
BACKEND_SERVICE="${WORKSTATION_BACKEND_SYSTEMD_SERVICE_NAME:-vllm-hust-backend}"
WEBSITE_SERVICE="${WEBSITE_SYSTEMD_SERVICE_NAME:-vllm-hust-website}"
BACKEND_MODELS_URL="${BACKEND_MODELS_URL:-http://127.0.0.1:8080/v1/models}"
WORKSTATION_MODELS_URL="${WORKSTATION_MODELS_URL:-http://127.0.0.1:3001/api/models}"
WEBSITE_URL="${WEBSITE_URL:-http://127.0.0.1:8000}"

usage() {
  cat <<'EOF'
Usage: ./scripts/manage_public_stack.sh <command>

Commands:
  menu                 Interactive menu for backend, workstation, and website services
  status               Show backend, workstation, and public URL health
  restart-backend      Restart local vllm-hust backend systemd service
  deploy-backend       Install/update and restart the backend systemd service
  restart-workstation  Restart the workstation systemd service
  deploy-workstation   Rebuild and redeploy the workstation runtime via systemd
  restart-website      Restart the website systemd service
  deploy-website       Install/update and restart the website systemd service
  restart-ui           Restart workstation and website systemd services
  deploy-ui            Install/update and restart workstation and website services
  restart-all          Restart backend first, then restart workstation and website
  logs                 Show backend, workstation, and website journals
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
  [[ -x "$DEPLOY_WEBSITE" ]] || { echo "Missing website deploy script: $DEPLOY_WEBSITE" >&2; exit 1; }
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

show_service_status() {
  local label="$1"
  local service_name="$2"

  echo "=== ${label} service ==="
  if systemctl --user cat "$service_name.service" >/dev/null 2>/dev/null; then
    systemctl --user --no-pager --full status "$service_name.service" || true
  else
    echo "[missing] $service_name.service is not installed yet"
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

restart_website() {
  (cd "$WEBSITE_REPO_DIR" && "$DEPLOY_WEBSITE" restart)
}

deploy_website() {
  (cd "$WEBSITE_REPO_DIR" && "$DEPLOY_WEBSITE" ci-deploy)
}

restart_ui() {
  restart_workstation
  restart_website
}

deploy_ui() {
  deploy_workstation
  deploy_website
}

show_logs() {
  show_service_status "backend journal" "$BACKEND_SERVICE"
  echo
  show_service_status "workstation journal" "$WORKSTATION_SERVICE"
  echo
  show_service_status "website journal" "$WEBSITE_SERVICE"
}

show_status() {
  echo "=== local health ==="
  curl_status "backend" "$BACKEND_MODELS_URL" || true
  curl_status "workstation" "$WORKSTATION_MODELS_URL" || true
  curl_status "website" "$WEBSITE_URL" || true
  echo
  echo "=== public health ==="
  curl_status "public workstation" "https://ws.sage.org.ai/api/models" || true
  curl_status "public backend" "https://api.sage.org.ai/v1/models" || true
  echo
  show_service_status "backend" "$BACKEND_SERVICE"
  echo
  show_service_status "workstation" "$WORKSTATION_SERVICE"
  echo
  show_service_status "website" "$WEBSITE_SERVICE"
}

interactive_menu() {
  local choice=""

  while true; do
    cat <<'EOF'

== Public Stack Menu ==
1) status
2) deploy-backend
3) restart-backend
4) deploy-workstation
5) restart-workstation
6) deploy-website
7) restart-website
8) deploy-ui
9) restart-ui
10) restart-all
11) logs
12) quit
EOF
    printf 'Select action: '
    read -r choice
    case "$choice" in
      1) show_status ;;
      2) deploy_backend ;;
      3) restart_backend ;;
      4) deploy_workstation ;;
      5) restart_workstation ;;
      6) deploy_website ;;
      7) restart_website ;;
      8) deploy_ui ;;
      9) restart_ui ;;
      10)
        deploy_backend
        restart_ui
        show_status
        ;;
      11) show_logs ;;
      12|q|quit|exit) return 0 ;;
      *) echo "Unknown selection: $choice" >&2 ;;
    esac
  done
}

main() {
  local command="${1:-status}"

  require_command curl
  require_command systemctl
  ensure_paths

  case "$command" in
    menu)
      interactive_menu
      ;;
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
    restart-website)
      restart_website
      ;;
    deploy-website)
      deploy_website
      ;;
    restart-ui)
      restart_ui
      ;;
    deploy-ui)
      deploy_ui
      ;;
    restart-all)
      deploy_backend
      restart_ui
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