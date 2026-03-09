# sagellm-workstation

私有化 AI 工作站 — 基于 Next.js + `sagellm-gateway` 的统一 Web 工作台。

🛡️ 数据不出境 · 完全本地推理 · 零编程门槛

---

## ✨ 功能

- **实时流式对话** — 接入任意 `sagellm-gateway`（OpenAI 兼容接口）
- **实时监控面板** — TPS、延迟、GPU 利用率、显存趋势图
- **Prometheus 监控端点** — 内置 `/metrics`，可直接接入 Prometheus 抓取
- **白牌化** — 品牌名 / Logo / 主题色可通过 `.env` 配置
- **Node 单运行时** — 前后端统一收敛到 Next.js Route Handlers，避免 Python + Node 双依赖栈

---

## 🚀 快速开始

### 启动脚本说明

- `./quickstart.sh`：统一入口；支持 `auto` / `docker` / `dev`
- `start.bat`：Windows 下的本地 `dev` 快捷入口

### 前提

- Node.js 20+
- 本机已安装 `isagellm`，或当前 shell 已激活可运行 `sagellm` 的 Python 环境
- 本地 quickstart 默认会尝试自启动“完整栈（gateway + engine）”，无需再手动补 `SAGELLM_CP_ENGINE_*`

### Linux / macOS

```bash
./quickstart.sh
```

默认行为：

- 若 `SAGELLM_BASE_URL` 指向本机地址（如 `localhost:8080`），脚本会先检查本地服务是否真的可推理；若不可推理，则自动拉起 `sagellm serve` 完整栈
- 若在本地终端执行 `./quickstart.sh`，启动前会出现交互式模型菜单；脚本会优先按实际硬件自动识别后端（如 `nvidia-smi -> cuda`），并在 CUDA 场景下按 8GB / 12GB / 16GB / 24GB+ 显存档位给推荐模型，选择结果会同步写回 `.env` 的 `WORKSTATION_BOOTSTRAP_MODEL` / `DEFAULT_MODEL`
- 若本地已有 gateway 但未注册健康 engine，脚本可自动重建本地服务，避免“UI 已启动但 chat 一直报 No healthy LLM engine”
- 若 `SAGELLM_BASE_URL` 指向远端地址，脚本会 fail-fast，而不是假装启动成功
- 本地完整栈日志默认写入 `.logs/sagellm-serve.log`

### Windows

双击 `start.bat`

### 手动启动

```bash
cp .env.example .env
npm install
npm run dev
```

浏览器访问 `http://localhost:3000`

---

## ⚙️ 配置

复制 `.env.example` 为 `.env` 后编辑：

```dotenv
SAGELLM_BASE_URL=http://localhost:8080
SAGELLM_API_KEY=not-required
WORKSTATION_AUTO_START_GATEWAY=true
WORKSTATION_AUTO_HEAL_GATEWAY=true
WORKSTATION_BOOTSTRAP_MODEL=sshleifer/tiny-gpt2
WORKSTATION_INTERACTIVE_MODEL_MENU=true
WORKSTATION_BOOTSTRAP_BACKEND=auto
WORKSTATION_AUTO_DETECT_BACKEND=true
WORKSTATION_ENGINE_PORT=8902
DEFAULT_MODEL=default
BACKEND_TYPE=CPU

APP_PORT=3000
APP_BRAND_NAME=SageLLM 工作站
APP_BRAND_LOGO=
APP_ACCENT_COLOR=#6366f1
```

如不希望每次启动都弹出模型选择菜单，可在 `.env` 中设置：

```dotenv
WORKSTATION_INTERACTIVE_MODEL_MENU=false
```

如需强制指定后端而不是自动识别，可在 `.env` 中设置：

```dotenv
WORKSTATION_BOOTSTRAP_BACKEND=cuda
# 或 cpu / ascend / rocm
WORKSTATION_AUTO_DETECT_BACKEND=false
```

---

## 🔌 与 sagellm-gateway 对接

| 前端路由 | 上游接口 | 说明 |
| -------- | -------- | ---- |
| `POST /api/chat` | `POST /v1/chat/completions` | 流式对话（SSE 透传） |
| `GET  /api/models` | `GET /v1/models` | 模型列表下拉（上游离线时返回兜底模型并显式标记离线） |
| `GET  /api/metrics` | `GET /v1/stats` + `GET /metrics` | 监控面板 JSON 聚合 |
| `GET  /metrics` | Workstation internal registry | Prometheus 抓取端点 |

> `quickstart.sh` 会先做一次真实推理探测，而不是只看 `/health`。因此本地若只有空 gateway、没有健康 engine，也会被判定为“未就绪”并自动修复。

> 工作站会优先聚合 gateway 指标；当上游未暴露 `/metrics` 或 `/v1/stats` 时，才回退到 `.env` 中的展示字段。请把 `DEFAULT_MODEL` 和 `BACKEND_TYPE` 改成你机器上的真实值，不要保留示例值。

---

## 📈 Prometheus 接入

工作站原生暴露 Prometheus 文本格式端点：

- UI / API: `http://localhost:3000`
- Prometheus metrics: `http://localhost:3000/metrics`

内置指标包括：

- `sagellm_workstation_api_requests_total`
- `sagellm_workstation_api_request_duration_seconds`
- `sagellm_workstation_upstream_request_duration_seconds`
- `sagellm_workstation_active_chat_requests`
- `sagellm_workstation_chat_stream_duration_seconds`
- `sagellm_workstation_chat_approx_tokens_total`

---

## 📁 文件结构

```text
sagellm-workstation/
├── src/app/           # Next.js App Router + API Route Handlers
├── src/components/    # 聊天与监控 UI 组件
├── src/lib/metrics.ts # prom-client 指标注册与聚合
├── package.json       # Node 依赖与脚本
├── .env.example       # 运行时配置模板
├── start.bat          # Windows 开发启动
└── quickstart.sh      # Linux/macOS/WSL 统一启动入口
```

---

## 🏗️ 生产运行

```bash
npm run build
npm run start
```

或继续使用 Docker：

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

---

## License

MIT
