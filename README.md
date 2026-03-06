# sagellm-workstation

私有化 AI 工作站 — 基于 `sagellm-gateway` 的一键 Web 界面。

🛡️ 数据不出境 · 完全本地推理 · 零编程门槛

---

## ✨ 功能

- **实时流式对话** — 接入任意 sagellm-gateway（OpenAI 兼容接口）
- **实时监控面板** — TPS、首 Token 延迟、GPU 利用率、显存趋势图
- **白牌化** — 品牌名 / Logo / 主题色可通过 `config.ini` 配置，无需改代码
- **"数据不出境 · 国产算力" 徽章** — 一眼打动甲方客户
- **零前端构建** — 纯 Python + 单 HTML 文件，无 Docker / Node.js 依赖

---

## 🚀 快速开始

### 前提

- Python 3.10+（conda / 系统 Python 均可）
- 已运行的 `sagellm-gateway`（默认 `http://localhost:8080`）

### Windows 用户

双击 `start.bat` 即可，浏览器自动打开。

### Linux / macOS 用户

```bash
./start.sh
```

### 手动启动

```bash
pip install -r requirements.txt
python server.py
```

浏览器访问 `http://localhost:3000`

---

## ⚙️ 配置

编辑 `config.ini`（可用记事本打开）：

```ini
[server]
port = 3000          ; 工作站监听端口

[sagellm]
base_url      = http://localhost:8080   ; gateway 地址
api_key       = not-required
default_model = default
backend_type  = Ascend NPU              ; 徽章展示标签

[brand]
name         = SageLLM 工作站
accent_color = #6366f1                  ; 主题色（任意 Hex）
logo_path    =                          ; Logo 文件路径（留空用默认图标）
```

---

## 🔌 与 sagellm-gateway 对接

| 前端路由 | 上游接口 | 说明 |
|----------|----------|------|
| `POST /api/chat` | `POST /v1/chat/completions` | 流式对话（SSE 透传） |
| `GET  /api/models` | `GET  /v1/models` | 模型列表下拉 |
| `GET  /api/metrics` | `GET /v1/stats` + `GET /metrics` | 监控面板数据（可选） |

> **metrics 可选**：若 gateway 未暴露 `/metrics` 端点，工作站会优雅回退，监控面板显示"—"而不报错。

---

## 📁 文件结构

```
sagellm-workstation/
├── server.py        ← FastAPI 服务端（代理 + 静态文件）
├── index.html       ← 完整前端 UI（无外部依赖，全部内联）
├── config.ini       ← 用户配置（记事本可编辑）
├── requirements.txt ← Python 依赖（fastapi, uvicorn, httpx）
├── start.bat        ← Windows 双击启动
└── start.sh         ← Linux/macOS 启动
```

---

## 🎨 白牌定制示例

```ini
[brand]
name         = 数智政务助手
accent_color = #0ea5e9

[sagellm]
backend_type = 天数智芯 GPU
```

---

## 🐳 Docker 模式（进阶）

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

---

## License

MIT
