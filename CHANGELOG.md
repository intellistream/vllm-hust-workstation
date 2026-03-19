# Changelog

All notable changes to vllm-hust-workstation will be documented in this file.

## [Unreleased]

### Changed

- **vllm-hust first bootstrap** — `quickstart.sh` 现在优先使用 `vllm-hust serve` / `python -m vllm_hust.cli serve` 拉起本地完整栈，并保留对 `sagellm` 的回退兼容；默认日志文件改为 `.logs/vllm-hust-serve.log`。
- **Naming migration defaults** — 文档、示例配置与默认模型目录已切换到 `vllm-hust` 命名（如 `~/Downloads/vllm-hust-models`），并补充了 vllm-hust PyPI 发布命令示例。

### Fixed
- Workstation `/config.json` now returns `modelsDir` and `hfEndpoint`, so the frontend model hub shows the configured download directory and mirror endpoint instead of falling back to hardcoded defaults.

### Added

- **Interactive startup model menu** — `quickstart.sh` 在本地终端启动时会先展示交互式模型菜单，可直接选择本次要拉起的模型；若本地已运行其他模型，也会按所选模型自动重建本地完整栈，并把选择结果同步写回 `.env` 的 `WORKSTATION_BOOTSTRAP_MODEL` / `DEFAULT_MODEL`

### Fixed

- **Real-time weather lookup for web search** — `/api/chat` 现在会优先识别天气类联网问题，并通过 Open-Meteo 拉取结构化实时天气数据后再注入给模型，避免“已经开启联网搜索却仍回答无法获取当前天气”的退化表现
- **Hardware-aware backend detection** — `quickstart.sh` 现在会优先按本机硬件自动识别启动后端（如 `nvidia-smi -> cuda`、`npu-smi -> ascend`），不再因为 `.env` 里的占位 `BACKEND_TYPE=CPU` 就把有 GPU 的机器误判成 CPU 模式
- **Stale `sagellm serve` cleanup** — `quickstart.sh` 现在在重建本地完整栈前会额外清理残留的 `sagellm serve` 父进程，避免旧的 8080/8081 启动链残留导致 gateway 只剩空壳、前端长期显示“离线”
- **VRAM-aware CUDA model menu** — 在 NVIDIA GPU 场景下，`quickstart.sh` 现在会读取显存容量并按 8GB / 12GB / 16GB / 24GB+ 四档推荐模型；例如 8GB 卡优先推荐 1.5B/3B，12GB 卡优先推荐 7B，24GB+ 卡再优先推荐 14B
- **Backend-aware startup recommendations** — 交互式模型菜单现在会根据后端给出不同推荐；CPU 模式默认优先展示更轻量模型，并在选择 7B/14B 等大模型时先给出明确确认，避免误选后长时间卡住
- **Quickstart full-stack readiness** — `quickstart.sh` 现在不再只检查 `/health`；它会做真实推理探测，并在本地 gateway 缺少健康 engine 时自动重建为 `sagellm serve` 完整栈，避免工作站启动后聊天仍报 `No healthy LLM engine`
- **Bootstrap engine defaults** — 新增 `WORKSTATION_AUTO_HEAL_GATEWAY`、`WORKSTATION_BOOTSTRAP_MODEL`、`WORKSTATION_BOOTSTRAP_BACKEND`、`WORKSTATION_ENGINE_PORT`，让本地 workstation 启动链路可显式配置且具备可用的小模型自举能力
- **Default chat max tokens** — `/api/chat` 在前端未显式传参时会补上 `WORKSTATION_DEFAULT_MAX_TOKENS`（默认 128），避免 bootstrap 小模型沿用上游过大默认值后出现 `index out of range` 聊天失败
- **Stable search source & metric merge** — 联网搜索改为优先 Bing RSS，再回退 HTML / DuckDuckGo；`/api/metrics` 不再让上游 `undefined` 字段覆盖本地真实统计，非流式聊天也会正确计入内部指标

### Removed

- **Redundant shell entrypoint** — removed `start.sh`; `quickstart.sh` is now the sole Linux/macOS startup entrypoint to reduce duplicate maintenance surface

- **Gateway startup contract** — `quickstart.sh` 现在会在 `SAGELLM_BASE_URL` 指向本机时自动检查并拉起 `sagellm-gateway`；远端地址则显式 fail-fast，不再出现工作站已启动但 gateway 实际未启动的假成功状态
- **真实在线状态** — `/api/models` 与 `/api/metrics` 现在会显式暴露上游可用性，前端“在线/离线”状态不再被本地兜底数据误判为在线

- **Workstation demo defaults** — 将示例环境变量从 `Qwen2.5-72B-Instruct` / `Ascend 910B` 改为保守兜底值；模型不再伪装成 72B，后端默认回退为 `CPU`

- **Node-native Prometheus metrics** — added `prom-client` registry, `/metrics` scrape endpoint, workstation request counters/histograms, and in-flight chat gauges without introducing a Python dependency chain
- **Next.js inference sidebar migration** — restored the left-side 推理过程 panel in the React app with 处理流程 / 搜索来源 / 思考过程 sections, inline `<think>` / `reasoning_content` streaming, and auto-open on each request
- **Right-side model selector card** — restored a visible model switching control inside the monitoring sidebar so model selection is available even when the header is crowded
- **DuckDuckGo-powered web search toggle** — React chat input now supports 🌐 toggle, `/api/chat` can inject search context and emit `search_results` SSE metadata for the new inference sidebar
- **Model hub modal migration** — restored the popup-style model library with curated mainstream models, one-click download, progress polling, cancel action, and “设为当前” activation in the Next.js workstation
- **Left inference panel** — collapsible 🔭 side panel (left of chat) shows ⚙️ 处理流程, 🌐 搜索来源, 💭 思考过程 in dedicated sections; auto-opens on each request, closeable via tab or ✕ button; keeps chat area clean
- **Pipeline status steps** — real-time animated steps in left panel showing "正在检索 → 找到N条 → 正在生成 → ✅ 完成" regardless of model CoT support
- **Search citations in left panel** — all search results (title, snippet, URL) shown in 🌐 section with no size limit; removed citations card from chat bubble area
- **Think block in left panel** — CoT models' `<think>` content streamed into 💭 section; no max-height truncation
- **Gateway watchdog** (`watchdog.sh`) — daemon that checks every 20 s whether gateway has a healthy engine; auto-reconnects from engine pool (8901–8904) if disconnected
- **Web search state persistence** — 🌐 toggle state saved to `localStorage`; restored on page refresh
- **Hardware backend selector** in header — calls `GET /api/backends`, switches via `PUT /api/backend` (effective on next Gateway restart)
- **System Prompt / Persona modal** with 6 presets (工作助手, 代码专家, 翻译助手, 数据分析师, 创意写作, 学术研究) plus custom textarea; shown as dismissable bar when active
- **Generation parameters** sidebar panel — temperature (0–2), max_tokens (256–8192), top_p (0.1–1.0) sliders with live value display; values passed directly to `POST /api/chat` (proxied natively to sagellm-gateway); reset-to-defaults button; persisted per session
- **Session history** (localStorage `sagellm_sessions`, max 20) — auto-create on first message, auto-title from first 28 chars of user message, restore/delete sessions from sidebar, params/sysPrompt saved per session
- **Enhanced Markdown renderer** — bold, italic, strikethrough, H1–H3 headers, unordered/ordered lists, blockquotes, horizontal rules, GitHub-style tables, fenced code blocks with language label and per-block copy button
- **File drag-and-drop** on chat area — supports `.txt .py .js .ts .json .yaml .yml .md .csv .sh .go .rs .cpp .c .java .rb .php .sql .xml .html .css .toml .ini .conf` (max 200 KB); content injected as code block into message; attach button (📎) also available
- **Export chat to Markdown** (⬇ button or `Ctrl+E`) — includes model, timestamp, system prompt, generation params, full conversation
- **Keyboard shortcuts**: `Ctrl+K` clear chat, `Ctrl+E` export, `Escape` close modals
- **Optional web search gateway** — 🌐 toggle button in input bar activates DuckDuckGo Lite search before LLM inference; search results injected as `<web_search_results>` system context; collapsible citations card rendered above AI response; `GET /api/search?q=...` explicit search endpoint; configurable via `[search]` section in `config.ini` (`enabled`, `max_results`, `timeout_sec`, `region`); no external packages required (uses stdlib `html.parser` + `httpx`)
- **Per-message copy button** and AI response TTFT (time-to-first-token) display in bubble meta
- **Token counter** during streaming (tokens · elapsed ms)
- **GPU memory bar** with `used / total GB` sub-label
- Total-requests-served and pending-queue dual stat cards

### Changed

- **Single-runtime workstation path** — aligned docs and launcher scripts to the Next.js runtime (`npm install` / `npm run dev`), removing `requirements.txt` from the primary setup path
- `quickstart.sh` 默认改为 `auto` 模式：有 Docker 用 Docker，无 Docker 时自动切换到本地 `dev` 模式，避免误报必须安装 Docker
- `start.sh` 已收敛为 `./quickstart.sh dev` 的快捷入口，README 与 Windows 启动说明同步对齐，避免把当前 Next.js 工作台误解为 Python 本地引擎启动器

- **Metrics fallback semantics** — `/api/metrics` now merges upstream gateway stats with workstation-native observations instead of pretending with simulated demo values
- Restored Next.js workstation entry page by removing accidentally merged legacy client code from `src/app/page.tsx`, allowing the UI and `/api/*` proxy routes to start normally again
- Gateway returning `{"detail":"No healthy LLM engine..."}` now properly wrapped as SSE `⚠️` message; frontend shows error text instead of blank 0-token response
- Weather forecast date alignment: loop over `forecast[]` to find actual today by `ymd` field instead of assuming `forecast[0]` is today
- 3-day forecast now shows 今天/明天/后天 with wind info per day
- SSE chunk split buffer (`sseBuf`) prevents JSON events dropped when split across TCP chunks
- `asyncio.wait_for(timeout=10)` hard cap on web search prevents 40 s UI freeze when all search providers are rate-limited
- `time.monotonic()` replaces deprecated `asyncio.get_event_loop().time()`
- `_dir_size()` excluded `.incomplete` files from size calculation, causing download progress to always show 0% — now only `.lock` files are excluded
- `_monitor()` now extracts current filename from `*.incomplete` rglob to show which file is downloading
- `snapshot_download` wrapped with `TypeError` fallback for huggingface_hub ≥ 0.23 (`local_dir_use_symlinks` parameter removed)
