@echo off
rem Start server: hosts dist/ frontend + REST API + AI worker WebSocket (/ws/worker)
rem Requires build_app.bat to have been run first (deps installed, dist/ built).
cd /d %~dp0

if not exist .env (
    echo WARNING: .env not found, copy .env.example to .env and fill in your keys
)

if not exist node_modules\express (
    echo Dependencies missing. Run build_app.bat first.
    pause
    exit /b 1
)

if not exist dist\index.html (
    echo dist\ not found. Run build_app.bat first.
    pause
    exit /b 1
)

rem npm 是 .cmd 脚本，必须加 call，否则调用后不会返回，下面的 pause 永远不执行，
rem 服务一旦报错退出窗口就直接关闭（闪退），看不到任何错误信息
call npm run server
pause
