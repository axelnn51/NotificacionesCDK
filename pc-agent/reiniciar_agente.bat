@echo off
title Reiniciar Agente PC - CDKeysPeru
chcp 65001 >nul
cd /d "%~dp0"

echo ====================================================================
echo Reiniciando Agente PC CDKeysPeru con la version mas reciente...
echo ====================================================================

set TASK_NAME=CDKeysPeru_PCAgent

:: 1. Detener la tarea programada activa
schtasks /End /TN "%TASK_NAME%" >nul 2>&1

:: 2. Cerrar cualquier proceso remanente de powershell ejecutando pc-agent.ps1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*pc-agent.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: 3. Iniciar la tarea programada actualizada
schtasks /Run /TN "%TASK_NAME%" >nul 2>&1

echo.
echo ====================================================================
echo [OK] Agente reiniciado exitosamente en segundo plano.
echo ====================================================================
echo.
ping 127.0.0.1 -n 3 >nul
