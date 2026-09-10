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

npm run server
pause
