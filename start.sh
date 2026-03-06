#!/usr/bin/env bash
# SageLLM 工作站 — 一键启动脚本
# 自动：探测硬件 → 装 torch → 启 sage-engine → 启 gateway → 开 Web UI

set -euo pipefail

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║    SageLLM 工作站  私有 AI 助手     ║"
echo "  ║    数据不出境  ·  完全本地推理       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 读取 config.ini 的小工具函数 ────────────────────────────────────────────
cfg() { (grep -E "^\s*$1\s*=" config.ini 2>/dev/null || true) | sed 's/.*=\s*//' | tr -d ' \r' | head -1; }
cfg_write() { sed -i "s|^\s*$1\s*=.*|$1 = $2|" config.ini; }

# ── 选择正确的 Python 解释器 ──────────────────────────────────────────────────
# 优先使用安装了 sagellm 的 conda 环境，避免选中空的新建 env
PYTHON=""
_pick_python() {
    # 1. sage-engine 可执行文件所在 conda env 的 python（最可靠）
    local engine_bin
    engine_bin=$(command -v sage-engine 2>/dev/null || true)
    if [[ -n "$engine_bin" ]]; then
        local env_bin
        env_bin=$(dirname "$engine_bin")
        if [[ -x "${env_bin}/python3" ]]; then
            echo "${env_bin}/python3"; return
        fi
    fi
    # 2. 已知 conda env 路径中有 torch 的 python
    local _base
    _base="${CONDA_BASE:-}"
    local bases=("/home/user/miniforge3" "/home/user/miniconda3" "/opt/conda" ${_base:+"$_base"})
    local envnames=("sage" "sagellm" "base")
    for base in "${bases[@]}"; do
        for env in "${envnames[@]}"; do
            local py="${base}/envs/${env}/bin/python3"
            if [[ -x "$py" ]] && "$py" -c "import torch" 2>/dev/null; then
                echo "$py"; return
            fi
        done
        # also check base env
        if [[ -x "${base}/bin/python3" ]] && "${base}/bin/python3" -c "import torch" 2>/dev/null; then
            echo "${base}/bin/python3"; return
        fi
    done
    # 3. 当前激活的 python3 若有 torch
    if python3 -c "import torch" 2>/dev/null; then
        echo "python3"; return
    fi
    # 4. 降级：用当前 python3，后续步骤会自动安装 torch
    echo "python3"
}
PYTHON=$(_pick_python)
echo "  Python: $PYTHON"
if ! "$PYTHON" --version &>/dev/null; then
    echo "  [错误] 未找到可用的 Python，请先激活 sage conda 环境: conda activate sage"
    exit 1
fi

# ── [1/5] 安装 Web UI 依赖 ──────────────────────────────────────────────────
if ! "$PYTHON" -c "import fastapi, uvicorn, httpx" 2>/dev/null; then
    echo "  [1/5] 首次运行，安装 Web UI 依赖..."
    "$PYTHON" -m pip install -r requirements.txt \
        --no-warn-script-location --disable-pip-version-check -q
    echo "  [1/5] Web UI 依赖就绪 ✓"
else
    echo "  [1/5] Web UI 依赖已就绪 ✓"
fi

# ── [2/5] 探测硬件，自动安装对应 torch ──────────────────────────────────────
if "$PYTHON" -c "import torch" 2>/dev/null; then
    TORCH_VER=$("$PYTHON" -c "import torch; print(torch.__version__)")
    echo "  [2/5] torch 已就绪: ${TORCH_VER} ✓"
else
    echo "  [2/5] 探测加速硬件，安装 torch..."

    # 昇腾 NPU
    if ls /dev/davinci* /dev/npu* 2>/dev/null | grep -q .; then
        echo "        → 昇腾 NPU，安装 torch_npu"
        "$PYTHON" -m pip install torch==2.1.0 torch_npu==2.1.0 \
            --extra-index-url https://download.pytorch.org/whl/cpu \
            --index-url https://mirrors.huaweicloud.com/pypi/simple/ -q

    # 寒武纪 MLU
    elif ls /dev/cambricon* 2>/dev/null | grep -q .; then
        echo "        → 寒武纪 MLU，安装 torch (cpu base)"
        "$PYTHON" -m pip install torch==2.3.0 \
            --index-url https://download.pytorch.org/whl/cpu -q
        echo "        ⚠ torch_mlu 请从寒武纪 SDK 手动安装: https://sdk.cambricon.com"

    # AMD ROCm / 海光 DCU
    elif command -v rocm-smi &>/dev/null || ls /dev/kfd 2>/dev/null | grep -q .; then
        ROCM_VER=$(rocm-smi --showversion 2>/dev/null | grep -oP 'ROCm.Version[:\s]+\K[\d.]+' | head -1 || echo "6.2")
        ROCM_TAG="rocm$(echo "$ROCM_VER" | tr -d '.')"
        echo "        → ROCm ${ROCM_VER}，安装 torch+${ROCM_TAG}"
        "$PYTHON" -m pip install torch \
            --index-url "https://download.pytorch.org/whl/${ROCM_TAG}" -q

    # NVIDIA CUDA
    elif command -v nvidia-smi &>/dev/null; then
        CUDA_VER=$(nvidia-smi 2>/dev/null | grep -oP 'CUDA Version:\s+\K[\d.]+' | head -1 || echo "12.8")
        MAJOR=$(echo "$CUDA_VER" | cut -d. -f1)
        MINOR=$(echo "$CUDA_VER" | cut -d. -f2)
        CUDA_TAG="cu${MAJOR}${MINOR}"
        echo "        → NVIDIA CUDA ${CUDA_VER}，安装 torch+${CUDA_TAG}"
        "$PYTHON" -m pip install torch \
            --index-url "https://download.pytorch.org/whl/${CUDA_TAG}" \
            --no-cache-dir

    # CPU fallback
    else
        echo "        → 无加速硬件，安装 CPU-only torch"
        "$PYTHON" -m pip install torch \
            --index-url "https://download.pytorch.org/whl/cpu" -q
    fi

    echo "  [2/5] torch 安装完成 ✓"
fi

# 确保 transformers 和 accelerate 已安装（sage-engine 的 LayerWiseModelLoader 依赖）
if ! "$PYTHON" -c "import transformers, accelerate" 2>/dev/null; then
    echo "        安装 transformers + accelerate..."
    "$PYTHON" -m pip install transformers accelerate -q
    echo "        transformers + accelerate 就绪 ✓"
fi

# ── 端口探测工具（纯 bash，不依赖 Python）──────────────────────────────────────
free_port() {
    local port=$1
    while true; do
        # 尝试连接：连上说明端口被占用，连不上说明空闲
        if ! (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then
            echo "$port"
            return
        fi
        exec 3>&- 2>/dev/null || true
        port=$((port + 1))
    done
}

# ── 进程清理（Ctrl+C 时自动停止所有子进程）────────────────────────────────────
PIDS=()
cleanup() {
    echo ""
    echo "  正在关闭..."
    for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
    echo "  已停止。"
    exit 0
}
trap cleanup INT TERM

# ── [3/5] 启动推理引擎 ────────────────────────────────────────────────────────
MODEL_PATH="$(cfg model_path)"
EXTERNAL_URL="$(cfg external_engine_url)"
EXTERNAL_MODEL="$(cfg external_engine_model)"
ENGINE_MODEL_ID=""

if [[ -n "$EXTERNAL_URL" ]]; then
    # 直接对接外部 OpenAI 兼容服务（Ollama / vLLM 等）
    ENGINE_ENDPOINT="$EXTERNAL_URL"
    ENGINE_MODEL_ID="${EXTERNAL_MODEL:-default}"
    echo "  [3/5] 使用外部推理服务: ${ENGINE_ENDPOINT} ✓"

elif command -v sage-engine &>/dev/null; then
    if [[ -z "$MODEL_PATH" || ! -d "$MODEL_PATH" ]]; then
        echo "  [错误] config.ini 中 model_path 未设置或目录不存在: '${MODEL_PATH}'"
        echo "         请编辑 config.ini，将 model_path 改为您的模型权重目录"
        exit 1
    fi

    ENGINE_MODEL_ID="$(basename "$MODEL_PATH")"
    ENGINE_PORT=$(free_port 8902)
    ENGINE_ENDPOINT="http://localhost:${ENGINE_PORT}"

    # 探测 GPU 数量，多卡用 tensor_parallel
    GPU_COUNT=0
    if command -v nvidia-smi &>/dev/null; then
        GPU_COUNT=$(nvidia-smi --list-gpus 2>/dev/null | wc -l | tr -d ' ')
    fi

    echo "  [3/5] 启动 sage-engine（端口 ${ENGINE_PORT}，GPU×${GPU_COUNT:-0}）..."
    echo "        模型: ${MODEL_PATH}"

    sage-engine \
        --model-path "$MODEL_PATH" \
        --port "$ENGINE_PORT" \
        --device auto \
        --log-level warning \
        > /tmp/sagellm_engine.log 2>&1 &
    PIDS+=($!)

    # 等待引擎就绪（最多 120 秒，大模型加载慢）
    echo -n "        加载中"
    READY=false
    for i in $(seq 1 120); do
        if curl -sf "${ENGINE_ENDPOINT}/health" &>/dev/null; then
            READY=true; break
        fi
        echo -n "."; sleep 1
    done
    echo ""
    if [[ "$READY" != "true" ]]; then
        echo "  [错误] sage-engine 启动超时，查看日志: /tmp/sagellm_engine.log"
        cat /tmp/sagellm_engine.log | tail -20
        cleanup; exit 1
    fi
    echo "  [3/5] sage-engine 就绪 ✓"

else
    echo "  [错误] sage-engine 未找到，请先运行: cd /home/user/sagellm-core && ./quickstart.sh"
    exit 1
fi

# ── [4/5] 启动 sagellm-gateway ────────────────────────────────────────────────
if ! command -v sagellm-gateway &>/dev/null; then
    echo "  [错误] sagellm-gateway 未找到，请先运行: cd /home/user/sagellm-core && ./quickstart.sh"
    cleanup; exit 1
fi

GW_PORT=$(free_port 8090)
echo "  [4/5] 启动 sagellm-gateway（端口 ${GW_PORT}）..."

# 通过环境变量把引擎注册进 gateway
SAGELLM_ENGINE_HOST=localhost \
SAGELLM_ENGINE_PORT="${ENGINE_ENDPOINT##*:}" \
SAGELLM_ENGINE_MODEL="$ENGINE_MODEL_ID" \
SAGELLM_ENGINE_ID="workstation-engine" \
    sagellm-gateway --port "$GW_PORT" --log-level warning \
    > /tmp/sagellm_gateway.log 2>&1 &
PIDS+=($!)

GW_READY=false
for i in $(seq 1 30); do
    STATUS=$(curl -sf "http://localhost:${GW_PORT}/health" 2>/dev/null \
        | "$PYTHON" -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
    if [[ "$STATUS" == "healthy" ]]; then GW_READY=true; break; fi
    sleep 0.5
done
if [[ "$GW_READY" != "true" ]]; then
    echo "  [错误] sagellm-gateway 启动失败，查看日志: /tmp/sagellm_gateway.log"
    cat /tmp/sagellm_gateway.log | tail -20
    cleanup; exit 1
fi
echo "  [4/5] sagellm-gateway 就绪 ✓"

# 把真实端口和模型名写回 config.ini
cfg_write "base_url" "http://localhost:${GW_PORT}"
cfg_write "default_model" "$ENGINE_MODEL_ID"
cfg_write "backend_type" "$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo 'Local')"

# ── [5/5] 启动 Web UI ────────────────────────────────────────────────────────
echo "  [5/5] 启动 Web UI..."
echo ""
"$PYTHON" server.py &
PIDS+=($!)
wait "${PIDS[-1]}"
cleanup
