@echo off
echo Starting Shadow Survivors...

:: Start the Node.js server
echo Starting server on port 3002...
start "ShadowSurvivors-Server" cmd /c "cd /d %~dp0 && node server.js"

:: Give server a moment to start
timeout /t 2 /nobreak >nul

:: Start Caddy
echo Starting Caddy reverse proxy...
start "ShadowSurvivors-Caddy" cmd /c "cd /d %~dp0 && caddy run --config Caddyfile"

echo.
echo Shadow Survivors is running!
echo   Server:  http://localhost:3002
echo   Public:  https://roguelite.shadowdog.cat:4005
echo.
pause
