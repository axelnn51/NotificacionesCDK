@echo off
title Desinstalar Inicio Automatico - Agente PC CDKeysPeru
chcp 65001 >nul

set TASK_NAME=CDKeysPeru_PCAgent

echo Desinstalando tarea programada: %TASK_NAME%...
schtasks /Delete /TN "%TASK_NAME%" /F

if %ERRORLEVEL% EQU 0 (
    echo [OK] Tarea programada eliminada correctamente.
) else (
    echo [AVISO] La tarea no existia o ya habia sido eliminada.
)

pause
