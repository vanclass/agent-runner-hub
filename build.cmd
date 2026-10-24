@echo off
setlocal DisableDelayedExpansion
where node >nul 2>nul
if errorlevel 1 (
  echo Environment Preparation Required: Node.js with npm is unavailable on PATH.
  echo Install compatible Node.js ^(^20.19.0 or ^>=22.12.0^) with npm, then reopen this build entry.
  exit /b 1
)
node "%~dp0tools\web_app_build_system\src\entry.mjs" %*
exit /b %errorlevel%
