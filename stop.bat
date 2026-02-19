@echo off
echo Stopping Word Mind Game...

:: Stop Caddy
echo Stopping Caddy...
tasklist /FI "WINDOWTITLE eq WordMind-Caddy" 2>nul | find /I "cmd.exe" >nul
if %ERRORLEVEL%==0 (
    taskkill /FI "WINDOWTITLE eq WordMind-Caddy" /T /F >nul 2>&1
)
:: Also kill caddy.exe directly if running
tasklist /FI "IMAGENAME eq caddy.exe" 2>nul | find /I "caddy.exe" >nul
if %ERRORLEVEL%==0 (
    taskkill /IM caddy.exe /F >nul 2>&1
)

:: Stop Backend (uvicorn/python)
echo Stopping Backend...
tasklist /FI "WINDOWTITLE eq WordMind-Backend" 2>nul | find /I "cmd.exe" >nul
if %ERRORLEVEL%==0 (
    taskkill /FI "WINDOWTITLE eq WordMind-Backend" /T /F >nul 2>&1
)

echo.
echo Word Mind Game stopped.
pause
