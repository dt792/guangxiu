@echo off
rem Build frontend: install dependencies (if missing) + vite build -> dist/
rem Run this once after pulling code or changing src/, not on every start.
cd /d %~dp0

rem Do not just check whether node_modules exists: an interrupted install
rem leaves a broken half-installed tree. Check a key dependency instead.
if not exist node_modules\express (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

echo Building frontend...
call npm run build
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)

echo Build done: dist\
pause
