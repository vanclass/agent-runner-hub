@echo off
setlocal DisableDelayedExpansion
"%~dp0.project-config\tools\buildweave\BuildWeave.exe" --native web-app %*
exit /b %errorlevel%
