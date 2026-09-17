@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pet-launcher.ps1" -Action start
set "MEOW_EXIT=%ERRORLEVEL%"
pause
exit /b %MEOW_EXIT%
