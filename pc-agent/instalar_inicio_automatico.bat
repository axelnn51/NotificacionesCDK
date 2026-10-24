@echo off
title Instalar Inicio Automatico - Agente PC CDKeysPeru
chcp 65001 >nul
cd /d "%~dp0"

echo ====================================================================
echo Configurando Agente de PC para iniciar silenciosamente con Windows
echo ====================================================================
echo.

wscript.exe "%~dp0iniciar_agente_silencioso.vbs"
copy /y "%~dp0CDKeysPeru_PCAgent.lnk" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\" >nul 2>&1

echo [OK] Agente configurado en Carpeta de Inicio de Windows.
echo Se ejecutara en segundo plano automaticamente en cada inicio de Windows.
echo.
pause
