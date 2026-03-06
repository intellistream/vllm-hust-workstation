#!/usr/bin/env bash
set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

MODE="${1:-docker}"

if [[ "$MODE" == "docker" ]]; then
  check docker

  # 准备 .env
  if [[ ! -f .env ]]; then
    cp .env.example .env
    echo -e "${YELLOW}⚙  已生成 .env，请按需修改 SAGELLM_BASE_URL 等配置${NC}"
  fi

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

  if [[ ! -f .env ]]; then
    cp .env.example .env
    echo -e "${YELLOW}⚙  已生成 .env${NC}"
  fi

  # 导出 .env 变量到 shell
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a

  echo -e "${BLUE}📦 安装依赖…${NC}"
  npm install

  echo -e "${BLUE}🚀 启动开发服务器…${NC}"
  npm run dev

else
  echo "用法: $0 [docker|dev]"
  echo "  docker  — Docker Compose 部署（默认，推荐生产/演示）"
  echo "  dev     — 本地 npm 开发模式"
  exit 1
fi
