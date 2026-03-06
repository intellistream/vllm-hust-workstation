@echo off
chcp 65001 >nul
title SageLLM 工作站
color 0B
echo.
echo  ╔══════════════════════════════════════╗
echo  ║    SageLLM 工作站  私有 AI 助手     ║
echo  ║    数据不出境  ·  完全本地推理       ║
echo  ╚══════════════════════════════════════╝
echo.

:: 检查 Python
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  [错误] 未检测到 Python，请先安装 Python 3.10+
    echo         下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

python -c "import fastapi, uvicorn, httpx" >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    echo  [1/2] 依赖已就绪，跳过安装
) ELSE (
    echo  [1/2] 首次运行，安装依赖中（约 30-60 秒）...
    python -m pip install -r requirements.txt --no-warn-script-location --disable-pip-version-check
    IF %ERRORLEVEL% NEQ 0 (
        echo  [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
    echo  [1/2] 依赖安装完成
)

echo  [2/2] 启动中（浏览器即将自动打开）...
echo.
python server.py

pause
