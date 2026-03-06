"""
SageLLM 工作站后端
- 读取 config.ini 配置
- 代理到 sagellm-gateway (OpenAI 兼容接口)
- 提供流式对话 / 模型列表 / 实时指标接口
- 启动后自动打开浏览器
"""

from __future__ import annotations

import asyncio
import configparser
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

# ── 读取配置 ─────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent
config = configparser.ConfigParser()
config_path = BASE_DIR / "config.ini"
if config_path.exists():
    config.read(config_path, encoding="utf-8")

def cfg(section: str, key: str, fallback: str = "") -> str:
    return config.get(section, key, fallback=fallback).strip()

PORT         = int(cfg("server", "port", "3000"))
BASE_URL     = cfg("sagellm", "base_url", "http://localhost:8080").rstrip("/")
API_KEY      = cfg("sagellm", "api_key", "not-required")
DEFAULT_MODEL = cfg("sagellm", "default_model", "default")
BACKEND_TYPE = cfg("sagellm", "backend_type", "Ascend NPU")
BRAND_NAME   = cfg("brand", "name", "SageLLM 私有工作站")
ACCENT_COLOR = cfg("brand", "accent_color", "#6366f1")
LOGO_PATH    = cfg("brand", "logo", "")

COMMON_HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="SageLLM Workstation", docs_url=None, redoc_url=None)


@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "index.html", media_type="text/html")


@app.get("/logo")
async def logo():
    if LOGO_PATH and Path(LOGO_PATH).is_file():
        return FileResponse(LOGO_PATH)
    return JSONResponse({"error": "no logo"}, status_code=404)


@app.get("/config.json")
async def app_config():
    """Front-end runtime config (no secrets)."""
    return {
        "brandName":   BRAND_NAME,
        "accentColor": ACCENT_COLOR,
        "hasLogo":     bool(LOGO_PATH and Path(LOGO_PATH).is_file()),
        "defaultModel": DEFAULT_MODEL,
        "backendType": BACKEND_TYPE,
    }


# ── Chat proxy (streaming SSE) ────────────────────────────────────────────────

@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    body.setdefault("stream", True)

    async def stream_generator():
        buf = b""
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{BASE_URL}/v1/chat/completions",
                    json=body,
                    headers=COMMON_HEADERS,
                ) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk
                        # Count tokens for TPS tracking
                        buf += chunk
                        *complete, buf = buf.split(b"\n")
                        for line in complete:
                            line = line.strip()
                            if line.startswith(b"data: ") and line != b"data: [DONE]":
                                try:
                                    payload = json.loads(line[6:])
                                    content = (payload.get("choices", [{}])[0]
                                               .get("delta", {}).get("content", ""))
                                    if content:
                                        _record_tokens(1)
                                except Exception:
                                    pass
            except httpx.ConnectError:
                msg = "推理引擎未启动，请先启动 sagellm-gateway ，然后刷新页面。"
                yield f"data: {{\"choices\":[{{\"delta\":{{\"content\":\"{msg}\"}},\"finish_reason\":\"stop\"}}]}}\n\n".encode()
                yield b"data: [DONE]\n\n"
            except Exception as e:
                yield f"data: {{\"choices\":[{{\"delta\":{{\"content\":\"错误：{e}\"}},\"finish_reason\":\"stop\"}}]}}\n\n".encode()
                yield b"data: [DONE]\n\n"

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Models proxy ──────────────────────────────────────────────────────────────

@app.get("/api/models")
async def models():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{BASE_URL}/v1/models", headers=COMMON_HEADERS)
            return resp.json()
    except Exception:
        return {"object": "list", "data": [{"id": DEFAULT_MODEL, "object": "model"}]}


# ── TPS tracker ──────────────────────────────────────────────────────────────

_start_time = time.time()
_tps_window: list[tuple[float, int]] = []   # (timestamp, token_count)
_tps_lock = threading.Lock()
_total_tokens_served: int = 0


def _record_tokens(count: int) -> None:
    global _total_tokens_served
    now = time.time()
    with _tps_lock:
        _tps_window.append((now, count))
        _total_tokens_served += count
        # keep only last 15 s
        cutoff = now - 15
        while _tps_window and _tps_window[0][0] < cutoff:
            _tps_window.pop(0)


def _compute_tps() -> float:
    with _tps_lock:
        if len(_tps_window) < 2:
            return 0.0
        now = time.time()
        recent = [(t, n) for t, n in _tps_window if t >= now - 10]
        if len(recent) < 2:
            return 0.0
        window = recent[-1][0] - recent[0][0]
        if window < 0.3:
            return 0.0
        return round(sum(n for _, n in recent) / window, 1)


def _detect_backends() -> list[dict]:
    """Auto-detect available hardware backends on this machine."""
    backends: list[dict] = []
    active = BACKEND_TYPE.lower()

    # ── NVIDIA CUDA ──
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "-L"], timeout=3, text=True, stderr=subprocess.DEVNULL
        )
        gpus = [l.strip() for l in out.strip().splitlines() if l.strip()]
        if gpus:
            names = []
            for g in gpus:
                m = re.search(r"GPU \d+:\s*(.+?)(?:\s*\(UUID|$)", g)
                if m:
                    names.append(m.group(1).strip())
            base = names[0] if names else "NVIDIA GPU"
            label = f"{base} ×{len(gpus)}" if len(gpus) > 1 else base
            backends.append({
                "id": "nvidia-cuda",
                "label": label,
                "available": True,
                "active": any(k in active for k in ("nvidia", "cuda", "a100", "h100", "rtx", "v100")),
                "tag": "CUDA",
            })
    except Exception:
        pass

    # ── Ascend NPU ──
    ascend_ok = any(
        Path(p).exists()
        for p in ("/usr/local/Ascend/ascend-toolkit", "/usr/local/Ascend/driver")
    )
    if not ascend_ok:
        try:
            subprocess.check_output(
                ["npu-smi", "info"], timeout=3, text=True,
                stderr=subprocess.DEVNULL,
            )
            ascend_ok = True
        except Exception:
            pass
    if ascend_ok:
        backends.append({
            "id": "ascend-npu",
            "label": "华为昇腾 NPU",
            "available": True,
            "active": any(k in active for k in ("ascend", "npu")),
            "tag": "NPU",
        })

    # ── ROCm (AMD) ──
    try:
        out = subprocess.check_output(
            ["rocm-smi", "--showproductname"], timeout=3, text=True,
            stderr=subprocess.DEVNULL,
        )
        if "GPU" in out or "Radeon" in out or "Instinct" in out:
            backends.append({
                "id": "amd-rocm",
                "label": "AMD ROCm GPU",
                "available": True,
                "active": any(k in active for k in ("rocm", "amd", "radeon")),
                "tag": "ROCm",
            })
    except Exception:
        pass

    # ── CPU (always available) ──
    import platform
    cpu_label = platform.processor() or platform.machine() or "CPU"
    cpu_label = cpu_label.split("\n")[0][:40]
    backends.append({
        "id": "cpu",
        "label": f"CPU ({cpu_label})",
        "available": True,
        "active": active == "cpu",
        "tag": "CPU",
    })

    # Ensure exactly one is marked active (fallback to first)
    if not any(b["active"] for b in backends) and backends:
        backends[0]["active"] = True

    return backends


@app.get("/api/backends")
async def backends():
    """Return detected hardware backends for the frontend dropdown."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _detect_backends)


_BACKEND_ID_TO_TYPE: dict[str, str] = {
    "nvidia-cuda": "NVIDIA CUDA",
    "ascend-npu":  "Ascend NPU",
    "amd-rocm":    "AMD ROCm",
    "cpu":         "CPU",
}


@app.put("/api/backend")
async def switch_backend(request: Request):
    """Persist the selected backend to config.ini so the next engine restart picks it up."""
    global BACKEND_TYPE
    body = await request.json()
    backend_id = body.get("id", "")
    label = _BACKEND_ID_TO_TYPE.get(backend_id)
    if not label:
        return JSONResponse({"ok": False, "error": f"unknown backend id: {backend_id}"}, status_code=400)

    BACKEND_TYPE = label
    # Persist to config.ini
    if not config.has_section("sagellm"):
        config.add_section("sagellm")
    config.set("sagellm", "backend_type", label)
    try:
        with open(config_path, "w", encoding="utf-8") as fh:
            config.write(fh)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)

    return {"ok": True, "backend_type": label}


def _get_gpu_stats() -> dict[str, float]:
    """Query nvidia-smi and aggregate across all GPUs."""
    try:
        out = subprocess.check_output(
            ["nvidia-smi",
             "--query-gpu=utilization.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            timeout=3, text=True,
        )
        rows = [l.strip() for l in out.strip().splitlines() if l.strip()]
        if not rows:
            return {}
        max_util, total_used, total_total = 0.0, 0.0, 0.0
        for row in rows:
            parts = [p.strip() for p in row.split(",")]
            if len(parts) >= 3:
                max_util = max(max_util, float(parts[0]))
                total_used  += float(parts[1])   # MiB
                total_total += float(parts[2])   # MiB
        return {
            "gpuUtilPct":   round(max_util, 1),
            "gpuMemUsedGb": round(total_used  / 1024, 1),
            "gpuMemTotalGb": round(total_total / 1024, 1),
        }
    except Exception:
        return {}


# ── Metrics proxy ─────────────────────────────────────────────────────────────

@app.get("/api/metrics")
async def metrics():
    result: dict = {
        "tokensPerSecond": _compute_tps(),
        "pendingRequests": 0,
        "gpuUtilPct": 0,
        "gpuMemUsedGb": 0,
        "gpuMemTotalGb": 0,
        "uptimeSeconds": int(time.time() - _start_time),
        "totalRequestsServed": 0,
        "avgLatencyMs": 0,
        "modelName": DEFAULT_MODEL,
        "backendType": BACKEND_TYPE,
    }

    # GPU stats (blocking subprocess → run in thread pool)
    loop = asyncio.get_event_loop()
    gpu = await loop.run_in_executor(None, _get_gpu_stats)
    result.update(gpu)

    # Router / engine stats from gateway
    async with httpx.AsyncClient(timeout=2.0) as client:
        try:
            r = await client.get(f"{BASE_URL}/v1/router/summary", headers=COMMON_HEADERS)
            if r.is_success:
                data = r.json()
                total_req, total_lat, eng_cnt = 0, 0.0, 0
                for model_data in data.get("by_model", {}).values():
                    for eng in model_data.get("engines", []):
                        total_req += eng.get("request_count", 0)
                        total_lat += eng.get("avg_latency_ms", 0.0)
                        eng_cnt   += 1
                result["totalRequestsServed"] = total_req
                if eng_cnt > 0 and total_lat > 0:
                    result["avgLatencyMs"] = round(total_lat / eng_cnt, 1)
        except Exception:
            pass

    return result


# ── Model Hub ────────────────────────────────────────────────────────────────

MODEL_CATALOG: list[dict[str, Any]] = [
    {"id": "Qwen2.5-7B-Instruct",     "name": "Qwen 2.5  7B",   "repo_id": "Qwen/Qwen2.5-7B-Instruct",
     "params": "7B",  "size_gb": 15.2, "vram_gb": 10,
     "description": "阿里通义千问 2.5 指令版，中英双语强，速度快，适合日常对话与代码",
     "tags": ["中文", "代码", "推荐"], "color": "#f59e0b"},
    {"id": "Qwen2.5-14B-Instruct",    "name": "Qwen 2.5 14B",   "repo_id": "Qwen/Qwen2.5-14B-Instruct",
     "params": "14B", "size_gb": 28.9, "vram_gb": 20,
     "description": "千问 2.5 14B，输出质量更高，适合需要高质量分析与写作的场景",
     "tags": ["中文", "多语言"], "color": "#f59e0b"},
    {"id": "Qwen2.5-32B-Instruct",    "name": "Qwen 2.5 32B",   "repo_id": "Qwen/Qwen2.5-32B-Instruct",
     "params": "32B", "size_gb": 65.1, "vram_gb": 48,
     "description": "千问 2.5 旗舰级，综合能力业界领先，适合专业级用途",
     "tags": ["中文", "旗舰"], "color": "#f59e0b"},
    {"id": "DeepSeek-R1-Distill-Qwen-7B",  "name": "DeepSeek-R1 7B",  "repo_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
     "params": "7B",  "size_gb": 15.3, "vram_gb": 10,
     "description": "DeepSeek R1 蒸馏版，推理/数学/代码能力突出，轻量高效",
     "tags": ["推理", "数学", "代码"], "color": "#3b82f6"},
    {"id": "DeepSeek-R1-Distill-Qwen-14B", "name": "DeepSeek-R1 14B", "repo_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
     "params": "14B", "size_gb": 28.9, "vram_gb": 20,
     "description": "DeepSeek R1 14B 蒸馏，强推理与自然对话兼顾",
     "tags": ["推理", "数学"], "color": "#3b82f6"},
    {"id": "DeepSeek-R1-Distill-Qwen-32B", "name": "DeepSeek-R1 32B", "repo_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
     "params": "32B", "size_gb": 65.0, "vram_gb": 48,
     "description": "DeepSeek R1 32B 旗舰蒸馏，接近 o1 级别推理能力",
     "tags": ["推理", "旗舰", "数学"], "color": "#3b82f6"},
    {"id": "Mistral-7B-Instruct-v0.3", "name": "Mistral 7B Instruct", "repo_id": "mistralai/Mistral-7B-Instruct-v0.3",
     "params": "7B",  "size_gb": 14.5, "vram_gb": 10,
     "description": "欧洲代表性模型，英文能力出色，代码与推理均衡",
     "tags": ["英文", "代码"], "color": "#8b5cf6"},
    {"id": "Llama-3.1-8B-Instruct",   "name": "Llama 3.1 8B",  "repo_id": "meta-llama/Meta-Llama-3.1-8B-Instruct",
     "params": "8B",  "size_gb": 16.1, "vram_gb": 12,
     "description": "Meta Llama 3.1，多语言指令跟随强（需 HuggingFace Token）",
     "tags": ["英文", "多语言"], "color": "#10b981", "requires_auth": True},
    {"id": "Llama-3.3-70B-Instruct",   "name": "Llama 3.3 70B",  "repo_id": "meta-llama/Llama-3.3-70B-Instruct",
     "params": "70B", "size_gb": 141.0, "vram_gb": 96,
     "description": "Meta 旗舰开源大模型，能力接近 GPT-4o（需 token + 大内存）",
     "tags": ["英文", "旗舰"], "color": "#10b981", "requires_auth": True},
]

MODELS_DIR = Path(cfg("hub", "models_dir", "~/Downloads/sagellm-models")).expanduser()
HF_ENDPOINT = cfg("hub", "hf_endpoint", "").strip()
HF_TOKEN    = cfg("hub", "hf_token", "").strip() or None

# Active downloads — model_id -> progress dict
_downloads: dict[str, dict[str, Any]] = {}
_download_stop: dict[str, bool] = {}


def _dir_size(path: Path) -> int:
    try:
        return sum(f.stat().st_size for f in path.rglob("*")
                   if f.is_file() and not f.name.endswith((".lock", ".incomplete")))
    except Exception:
        return 0


def _get_installed() -> set[str]:
    if not MODELS_DIR.exists():
        return set()
    return {
        d.name for d in MODELS_DIR.iterdir()
        if d.is_dir() and (any(d.rglob("*.safetensors")) or any(d.rglob("*.bin")))
    }


def _download_worker(model_id: str, repo_id: str, save_path: Path, total_bytes: int) -> None:
    _downloads[model_id] = {
        "status": "downloading", "pct": 0,
        "speed_mbps": 0.0, "current_file": "正在连接…",
        "downloaded_bytes": 0, "total_bytes": total_bytes, "error": None,
    }
    save_path.mkdir(parents=True, exist_ok=True)

    def _monitor() -> None:
        last_bytes, last_t = 0, time.time()
        while _downloads.get(model_id, {}).get("status") == "downloading":
            time.sleep(1)
            downloaded = _dir_size(save_path)
            now = time.time()
            speed = max((downloaded - last_bytes) / max(now - last_t, 0.001) / 1e6, 0.0)
            pct = min(int(downloaded / max(total_bytes, 1) * 100), 99) if total_bytes > 0 else 0
            _downloads[model_id].update({
                "downloaded_bytes": downloaded, "speed_mbps": round(speed, 1), "pct": pct,
            })
            last_bytes, last_t = downloaded, now

    threading.Thread(target=_monitor, daemon=True).start()

    try:
        try:
            from huggingface_hub import snapshot_download  # type: ignore
        except ImportError:
            raise RuntimeError("请先安装: pip install huggingface_hub")

        env_backup: dict[str, str | None] = {}
        overrides: dict[str, str] = {}
        if HF_ENDPOINT:
            overrides["HF_ENDPOINT"] = HF_ENDPOINT
        if HF_TOKEN:
            overrides["HUGGING_FACE_HUB_TOKEN"] = HF_TOKEN
        for k, v in overrides.items():
            env_backup[k] = os.environ.get(k)
            os.environ[k] = v

        try:
            snapshot_download(
                repo_id=repo_id,
                local_dir=str(save_path),
                local_dir_use_symlinks=False,
                token=HF_TOKEN or None,
            )
        finally:
            for k, v in env_backup.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

        _downloads[model_id]["status"] = "done"
        _downloads[model_id]["pct"] = 100
        _downloads[model_id]["current_file"] = "下载完成 ✓"

    except Exception as exc:
        if _download_stop.get(model_id):
            _downloads[model_id]["status"] = "cancelled"
        else:
            _downloads[model_id]["status"] = "error"
            _downloads[model_id]["error"] = str(exc)


@app.get("/api/hub/catalog")
async def hub_catalog():
    installed = _get_installed()
    default_model = cfg("sagellm", "default_model", DEFAULT_MODEL)
    result = []
    for m in MODEL_CATALOG:
        item = dict(m)
        item["installed"] = m["id"] in installed
        item["active"]    = m["id"] == default_model
        item["download"]  = _downloads.get(m["id"])
        if item["download"] is None and item["installed"]:
            item["download"] = {"status": "done", "pct": 100}
        result.append(item)
    return result


@app.post("/api/hub/download/{model_id}")
async def hub_start_download(model_id: str):
    model = next((m for m in MODEL_CATALOG if m["id"] == model_id), None)
    if not model:
        return JSONResponse({"error": "model not found"}, status_code=404)
    if _downloads.get(model_id, {}).get("status") == "downloading":
        return {"status": "already_downloading"}
    _download_stop.pop(model_id, None)
    t = threading.Thread(
        target=_download_worker,
        args=(model_id, model["repo_id"], MODELS_DIR / model_id, int(model["size_gb"] * 1e9)),
        daemon=True,
    )
    t.start()
    return {"status": "started"}


@app.get("/api/hub/progress/{model_id}")
async def hub_progress(model_id: str):
    import json as _json

    async def _stream():
        for _ in range(1800):  # max 30 min
            state = _downloads.get(model_id)
            yield f"data: {_json.dumps(state or {'status': 'not_started'}, ensure_ascii=False)}\n\n"
            if state and state["status"] in ("done", "error", "cancelled"):
                break
            await asyncio.sleep(1)

    return StreamingResponse(
        _stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.delete("/api/hub/download/{model_id}")
async def hub_cancel(model_id: str):
    _download_stop[model_id] = True
    if model_id in _downloads:
        _downloads[model_id]["status"] = "cancelled"
    return {"status": "cancelled"}


@app.post("/api/hub/activate/{model_id}")
async def hub_activate(model_id: str):
    global DEFAULT_MODEL
    model_path = MODELS_DIR / model_id
    if not model_path.exists():
        return JSONResponse({"error": "model not installed"}, status_code=404)
    text = config_path.read_text(encoding="utf-8")
    text = re.sub(r"^(\s*default_model\s*=).*$", rf"\1 {model_id}",  text, flags=re.MULTILINE)
    text = re.sub(r"^(\s*model_path\s*=).*$",    rf"\1 {model_path}", text, flags=re.MULTILINE)
    config_path.write_text(text, encoding="utf-8")
    DEFAULT_MODEL = model_id
    return {"status": "activated", "model": model_id}


# ── Startup ───────────────────────────────────────────────────────────────────

def _find_free_port(preferred: int) -> int:
    """Return preferred port if free, else find the next available one."""
    for p in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("", p))
                return p
            except OSError:
                continue
    return preferred  # give up, let uvicorn report the error

def _open_browser(port: int):
    time.sleep(1.2)
    webbrowser.open(f"http://localhost:{port}")

if __name__ == "__main__":
    import threading

    actual_port = _find_free_port(PORT)

    print("=" * 52)
    print(f"  {BRAND_NAME}")
    if actual_port != PORT:
        print(f"  ⚠ 端口 {PORT} 已被占用 → 自动切换到 {actual_port}")
        print(f"  提示：可编辑 config.ini 将 port = {actual_port} 固定")
    print(f"  手动访问: http://localhost:{actual_port}")
    print("=" * 52)

    threading.Thread(target=_open_browser, args=(actual_port,), daemon=True).start()

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=actual_port,
        log_level="warning",
        reload=False,
    )
