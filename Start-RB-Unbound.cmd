@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-RB-Unbound.ps1"
if errorlevel 1 pause
