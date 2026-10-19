@echo off
title Agente PC - CDKeysPeru
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================================
echo Iniciando Agente de PC (CDKeysPerú)...
echo ========================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pc-agent.ps1"
pause
