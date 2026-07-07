@echo off
title 派对小游戏 · 服务管理器

cd /d "%~dp0"

echo.
echo ========================================
echo   派对小游戏 · 服务管理器
echo ========================================
echo.
echo 正在启动服务管理器...
echo 公网链接和二维码会自动弹出.
echo.

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\start-online.ps1"

echo.
echo ----------------------------------------
echo 脚本已结束 (退出码 %errorlevel%)
echo ----------------------------------------
pause
