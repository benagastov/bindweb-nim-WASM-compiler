@echo off
setlocal
cd /d "%~dp0"

where pwsh.exe >nul 2>nul
if not errorlevel 1 (
  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-no-docker.ps1" %*
  exit /b %errorlevel%
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-no-docker.ps1" %*
exit /b %errorlevel%
