@echo off
echo Starting Word Mind Game...

:: Start the backend server
echo Starting backend on port 3010...
start "WordMind-Backend" cmd /c "cd /d %~dp0 && venv\Scripts\python -m uvicorn backend.game_server:app --host 0.0.0.0 --port 3010"

:: Give backend a moment to start
timeout /t 2 /nobreak >nul

:: Start Caddy
echo Starting Caddy reverse proxy...
start "WordMind-Caddy" cmd /c "cd /d %~dp0 && caddy run --config Caddyfile"

echo.
echo Word Mind Game is running!
echo   Backend: http://localhost:3010
echo   Public:  https://words.shadowdog.cat
echo.
pause
