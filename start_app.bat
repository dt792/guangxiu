@echo off
rem One-click start: build frontend (if needed) and run the node server.
rem The server hosts the frontend, the REST API and the AI worker WebSocket.
cd /d %~dp0

if not exist .env (
    echo WARNING: .env not found, copy .env.example to .env and fill in your keys
)

rem 不能只看 node_modules 目录是否存在：之前中断的安装会留下半成品，
rem 导致启动时 ERR_MODULE_NOT_FOUND 直接闪退。改为检查关键依赖。
if not exist node_modules\express (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed, server will NOT start.
        pause
        exit /b 1
    )
)

if not exist dist\index.html (
    echo Building frontend...
    call npm run build
)

npm run server
pause
