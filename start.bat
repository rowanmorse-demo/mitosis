@echo off
title Mitosis server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js isn't installed. Install the LTS version from https://nodejs.org
  echo   then double-click start.bat again.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause
