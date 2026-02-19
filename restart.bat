@echo off
echo Restarting Word Mind Game...
call "%~dp0stop.bat"
timeout /t 2 /nobreak >nul
call "%~dp0start.bat"
