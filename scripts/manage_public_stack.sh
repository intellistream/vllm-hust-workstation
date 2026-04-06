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

if [[ -f "$REPO_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_DIR/.env" 2>/dev/null || true
  set +a
fi

usage() {
  cat <<'EOF'
Usage: ./scripts/manage_public_stack.sh <command>

统一运维命令：
  menu                 打开交互式菜单
  status               查看 backend / workstation / website 状态
  logs                 查看 backend / workstation / website 日志

后端服务：
  deploy-backend       安装或更新 backend systemd 服务并重启
  restart-backend      重启 backend systemd 服务

UI 服务：
  deploy-workstation   安装或更新 workstation systemd 服务并重启
  restart-workstation  重启 workstation systemd 服务
  deploy-website       安装或更新 website systemd 服务并重启
  restart-website      重启 website systemd 服务
  deploy-ui            一次性安装或更新 workstation + website
  restart-ui           一次性重启 workstation + website

整栈操作：
  restart-all          先更新 backend，再重启 workstation + website
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
  shift 2
  if curl -fsS --max-time 10 "$@" "$url" >/dev/null 2>&1; then
    echo "[ok] $label -> $url"
  else
    echo "[fail] $label -> $url"
    return 1
  fi
}

backend_probe_args() {
  if [[ -n "${VLLM_HUST_API_KEY:-}" && "${VLLM_HUST_API_KEY}" != "not-required" ]]; then
    printf '%s\n' "-H" "Authorization: Bearer ${VLLM_HUST_API_KEY}"
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
  local -a backend_args
  mapfile -t backend_args < <(backend_probe_args)

  echo "=== local health ==="
  curl_status "backend" "$BACKEND_MODELS_URL" "${backend_args[@]}" || true
  curl_status "workstation" "$WORKSTATION_MODELS_URL" || true
  curl_status "website" "$WEBSITE_URL" || true
  echo
  echo "=== public health ==="
  curl_status "public workstation" "https://ws.sage.org.ai/api/models" || true
  curl_status "public backend" "https://api.sage.org.ai/v1/models" "${backend_args[@]}" || true
  echo
  show_service_status "backend" "$BACKEND_SERVICE"
  echo
  show_service_status "workstation" "$WORKSTATION_SERVICE"
  echo
  show_service_status "website" "$WEBSITE_SERVICE"
}

interactive_menu() {
  local choice=""
  local action=""

  while true; do
    cat <<'EOF'

========================================
  vLLM-HUST 统一运维菜单
========================================

[常用]
  1) 查看整栈状态
  2) 查看整栈日志
  3) 更新 backend
  4) 重启 backend

[UI 服务]
  5) 更新 workstation
  6) 重启 workstation
  7) 更新 website
  8) 重启 website
  9) 一次性更新 UI(workstation + website)
 10) 一次性重启 UI(workstation + website)

[整栈]
 11) 更新 backend + 重启 UI

[其他]
 12) 退出
EOF
    printf '请选择操作 [1-12]: '
    read -r choice

    action=""
    case "$choice" in
      1) action="show_status" ;;
      2) action="show_logs" ;;
      3) action="deploy_backend" ;;
      4) action="restart_backend" ;;
      5) action="deploy_workstation" ;;
      6) action="restart_workstation" ;;
      7) action="deploy_website" ;;
      8) action="restart_website" ;;
      9) action="deploy_ui" ;;
      10) action="restart_ui" ;;
      11) action="restart_all" ;;
      12|q|quit|exit) return 0 ;;
      *) echo "无效选择: $choice" >&2 ;;
    esac

    case "$action" in
      show_status)
        show_status
        ;;
      show_logs)
        show_logs
        ;;
      deploy_backend)
        deploy_backend
        ;;
      restart_backend)
        restart_backend
        ;;
      deploy_workstation)
        deploy_workstation
        ;;
      restart_workstation)
        restart_workstation
        ;;
      deploy_website)
        deploy_website
        ;;
      restart_website)
        restart_website
        ;;
      deploy_ui)
        deploy_ui
        ;;
      restart_ui)
        restart_ui
        ;;
      restart_all)
        deploy_backend
        restart_ui
        show_status
        ;;
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