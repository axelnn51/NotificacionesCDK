@echo off
title Instalar Inicio Automatico - Agente PC CDKeysPeru
chcp 65001 >nul
cd /d "%~dp0"

echo ====================================================================
echo Configurando Agente de PC para iniciar silenciosamente con Windows
echo ====================================================================
echo.

set SCRIPT_PATH=%~dp0pc-agent.ps1
set TASK_NAME=CDKeysPeru_PCAgent

:: Crear una tarea programada que se ejecuta al iniciar sesion sin ventana emergente
schtasks /Create /TN "%TASK_NAME%" /TR "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File \"%SCRIPT_PATH%\"" /SC ONLOGON /RL HIGHEST /F

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ====================================================================
    echo [OK] Tarea programada creada con exito!
    echo Nombre de la tarea: %TASK_NAME%
    echo El agente se ejecutara en segundo plano cada vez que enciendas la PC.
    echo ====================================================================
    echo Iniciando tarea ahora mismo...
    schtasks /Run /TN "%TASK_NAME%"
) else (
    echo.
    echo [ERROR] No se pudo crear la tarea programada.
    echo Intenta ejecutar este archivo .bat haciendo clic derecho y "Ejecutar como Administrador".
)

echo.
pause
