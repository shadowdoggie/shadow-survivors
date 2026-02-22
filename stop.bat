@echo off
echo Stopping Shadow Survivors...

:: Stop Caddy
echo Stopping Caddy...
tasklist /FI "WINDOWTITLE eq ShadowSurvivors-Caddy" 2>nul | find /I "cmd.exe" >nul
if %ERRORLEVEL%==0 (
    taskkill /FI "WINDOWTITLE eq ShadowSurvivors-Caddy" /T /F >nul 2>&1
)
:: Also kill caddy.exe directly if running
tasklist /FI "IMAGENAME eq caddy.exe" 2>nul | find /I "caddy.exe" >nul
if %ERRORLEVEL%==0 (
    taskkill /IM caddy.exe /F >nul 2>&1
)

:: Stop Node.js server
echo Stopping Server...
tasklist /FI "WINDOWTITLE eq ShadowSurvivors-Server" 2>nul | find /I "cmd.exe" >nul
if %ERRORLEVEL%==0 (
    taskkill /FI "WINDOWTITLE eq ShadowSurvivors-Server" /T /F >nul 2>&1
)

echo.
echo Shadow Survivors stopped.
pause
