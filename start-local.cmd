@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 if exist "..\.tools\node-v22.23.4-win-x64\node.exe" set "PATH=%~dp0..\.tools\node-v22.23.4-win-x64;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\vite" (
  call npm.cmd install
  if errorlevel 1 exit /b 1
)
call npm.cmd run dev
