@echo off
title Online Game Launcher

cd /d "%~dp0"

echo.
echo ========================================
echo   Online Game Launcher (Cloudflare Tunnel)
echo ========================================
echo.
echo Starting Cloudflare Tunnel...
echo Public URL + QR code will open automatically.
echo.

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\start-online.ps1"

echo.
echo ----------------------------------------
echo Script finished (exit code %errorlevel%)
echo ----------------------------------------
pause
