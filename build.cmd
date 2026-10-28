@echo off
setlocal DisableDelayedExpansion
where node >nul 2>nul
if errorlevel 1 (
  echo Environment Preparation Required: Node.js with npm is unavailable on PATH.
  echo Install compatible Node.js ^(^20.19.0 or ^>=22.12.0^) with npm, then reopen this build entry.
  exit /b 1
)
set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo Environment Preparation Required: Windows .NET Framework C# compiler is unavailable.
  exit /b 1
)
:allocate_console
set "CONSOLE_DIR=%~dp0tools\web_app_build_system\.local\console-%RANDOM%-%RANDOM%"
if exist "%CONSOLE_DIR%" goto allocate_console
mkdir "%CONSOLE_DIR%"
if errorlevel 1 exit /b 1
"%CSC%" /nologo /target:exe /out:"%CONSOLE_DIR%\console.exe" "%~dp0tools\web_app_build_system\src\windows-console.cs"
if errorlevel 1 (
  rmdir "%CONSOLE_DIR%"
  exit /b 1
)
"%CONSOLE_DIR%\console.exe" "%~dp0tools\web_app_build_system\src\entry.mjs" %*
set "BUILD_EXIT=%errorlevel%"
del /q "%CONSOLE_DIR%\console.exe"
rmdir "%CONSOLE_DIR%"
exit /b %BUILD_EXIT%
