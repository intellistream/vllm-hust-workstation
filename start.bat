@echo off
chcp 65001 >nul
title SageLLM 工作站
color 0B
echo.
echo  ╔══════════════════════════════════════╗
echo  ║    SageLLM 工作站  私有 AI 助手     ║
echo  ║    Next.js 单运行时开发启动         ║
echo  ╚══════════════════════════════════════╝
echo.

node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  [错误] 未检测到 Node.js，请先安装 Node.js 20+
    pause
    exit /b 1
)

npm --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo  [错误] 未检测到 npm，请重新安装 Node.js
    pause
    exit /b 1
)

IF NOT EXIST .env (
    copy .env.example .env >nul
    echo  [提示] 已生成 .env，请按需修改 SAGELLM_BASE_URL 等配置
)

echo  [1/2] 安装 Node 依赖...
npm install
IF %ERRORLEVEL% NEQ 0 (
    echo  [错误] npm install 失败，请检查网络或锁文件
    pause
    exit /b 1
)

echo  [2/2] 启动开发服务器...
echo       UI: http://localhost:3000
echo       Metrics: http://localhost:3000/metrics
echo.

npm run dev

pause
