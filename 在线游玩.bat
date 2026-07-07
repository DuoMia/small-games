@echo off
title Party Games Launcher

cd /d "%~dp0"

echo.
echo ========================================
echo   Party Games Launcher
echo ========================================
echo.
echo Starting service manager...
echo.
echo If no window pops up, run scripts\start-online.ps1 manually.
echo.

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\start-online.ps1"

echo.
echo ----------------------------------------
echo Script finished (exit code %errorlevel%)
echo ----------------------------------------
pause
