@echo off
title Dev Server Launcher

cd /d "%~dp0"

echo ========================================
echo   Game Dev Server
echo ========================================
echo.

REM Check node_modules
if not exist "node_modules" (
  echo [Init] First run, installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo [Error] Dependency install failed. Check Node.js setup.
    pause
    exit /b 1
  )
  echo.
)

echo [Start] Launching dev server...
echo [Tip] Browser will open http://localhost:5173 automatically
echo [Tip] Press Ctrl+C to stop the server
echo.

start /b cmd /c "timeout /t 5 >nul && start http://localhost:5173"

call npm run dev
pause
