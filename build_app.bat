@echo off
rem Build frontend: install dependencies (if missing) + vite build -> dist/
rem Run this once after pulling code or changing src/, not on every start.
cd /d %~dp0

rem Do not just check whether node_modules exists: an interrupted install
rem leaves a broken half-installed tree. Check key dependencies instead:
rem express = backend runtime dep, vite = frontend build dep (devDependency).
set NEED_INSTALL=0
if not exist node_modules\express set NEED_INSTALL=1
if not exist node_modules\vite set NEED_INSTALL=1
if not exist node_modules\sharp set NEED_INSTALL=1
if not exist node_modules\.package-lock.json set NEED_INSTALL=1

if "%NEED_INSTALL%"=="1" (
    echo Installing dependencies...
    call npm install --prefer-offline --no-audit --no-fund
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
