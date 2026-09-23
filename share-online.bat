@echo off
title Mitosis online link
cd /d "%~dp0"
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Installing Cloudflare's free tunnel tool, one time only...
  echo.
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
  echo   Done. Close this window and double-click share-online.bat again.
  echo.
  pause
  exit /b 0
)
echo.
echo   Starting a public link to your game (start.bat must be running too).
echo   Look below for a line with  https://SOMETHING.trycloudflare.com  and send that link.
echo   Close this window to turn the public link off.
echo.
cloudflared tunnel --url http://localhost:3000
pause
