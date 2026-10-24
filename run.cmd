@echo off
setlocal DisableDelayedExpansion
where node >nul 2>nul
if errorlevel 1 (
  echo [Web App] Runtime failed: Node.js with npm is required.
  echo Install Node.js 20.19+ or 22.12+ and reopen this launcher.
  pause
  exit /b 1
)
node "%~dp0.runner\web-app-launch\entry.mjs" %*
set "launcher_exit=%errorlevel%"
if not "%launcher_exit%"=="0" if not "%launcher_exit%"=="130" pause
exit /b %launcher_exit%
