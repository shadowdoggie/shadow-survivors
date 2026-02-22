@echo off
echo Restarting Shadow Survivors...
call "%~dp0stop.bat"
timeout /t 2 /nobreak >nul
call "%~dp0start.bat"
