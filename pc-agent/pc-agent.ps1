# ==============================================================================
# CDKeysPeru - Agente Ligero para Windows (PowerShell Nativo)
# Monitoreo de Estado Encendido/Apagado y Receptor de Ordenes Remotas
# ==============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = Join-Path $ScriptDir "config.json"

if (Test-Path $ConfigFile) {
    try {
        $Config = Get-Content -Raw $ConfigFile | ConvertFrom-Json
        $ServerUrl = $Config.serverUrl.TrimEnd('/')
        $Token = $Config.token
        $Interval = if ($Config.heartbeatIntervalSeconds) { $Config.heartbeatIntervalSeconds } else { 5 }
    } catch {
        $ServerUrl = "http://localhost:3005"
        $Token = "cdkeys-pc-default-secret-token"
        $Interval = 5
    }
} else {
    $ServerUrl = "http://localhost:3005"
    $Token = "cdkeys-pc-default-secret-token"
    $Interval = 5
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "INICIANDO AGENTE DE PC - CDKEYSPERU" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Servidor:  $ServerUrl"
Write-Host "Intervalo: ${Interval}s"
Write-Host "Equipo:    $env:COMPUTERNAME"
Write-Host "============================================================" -ForegroundColor Cyan

function Get-LocalIp {
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi*","Ethernet*" -ErrorAction SilentlyContinue |
               Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -notlike "127.*" } |
               Select-Object -First 1).IPAddress
        if ($ip) { return $ip }
    } catch {}
    return "127.0.0.1"
}

function Get-UptimeSeconds {
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($os.LastBootUpTime) {
            $uptime = (Get-Date) - $os.LastBootUpTime
            return [int]$uptime.TotalSeconds
        }
    } catch {}
    return 0
}

$Headers = @{
    "x-pc-token" = $Token
    "Content-Type" = "application/json"
}

$ConsecutiveErrors = 0

while ($true) {
    try {
        $localIp = Get-LocalIp
        $uptime = Get-UptimeSeconds

        $bodyObj = @{
            hostname = $env:COMPUTERNAME
            platform = "win32"
            uptimeSeconds = $uptime
            localIp = $localIp
        }
        $body = $bodyObj | ConvertTo-Json
        $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

        # 1. Enviar Heartbeat al bot
        $heartbeatUrl = "$ServerUrl/api/pc/heartbeat"
        $hbRes = Invoke-RestMethod -Uri $heartbeatUrl -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $utf8Bytes -TimeoutSec 5 -ErrorAction Stop

        # 2. Consultar si hay ordenes de apagado
        $pollUrl = "$ServerUrl/api/pc/poll"
        $pollRes = Invoke-RestMethod -Uri $pollUrl -Method Get -Headers $Headers -TimeoutSec 5 -ErrorAction Stop

        if ($pollRes.command) {
            $cmd = $pollRes.command
            $cmdId = $pollRes.commandId
            Write-Host "[ORDEN RECIBIDA] Comando: $cmd (ID: $cmdId)" -ForegroundColor Yellow

            if ($cmd -eq "shutdown") {
                Write-Host "Ejecutando apagado del equipo..." -ForegroundColor Red

                # Confirmar recibo al servidor
                $ackObj = @{
                    commandId = $cmdId
                    status = "shutdown_initiated"
                    message = "Windows ejecutando shutdown /s /f /t 5"
                }
                $ackBody = $ackObj | ConvertTo-Json
                $ackBytes = [System.Text.Encoding]::UTF8.GetBytes($ackBody)
                try {
                    Invoke-RestMethod -Uri "$ServerUrl/api/pc/ack" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $ackBytes -TimeoutSec 5 -ErrorAction SilentlyContinue
                } catch {}

                # Ejecutar shutdown forzado en 5 segundos
                & shutdown.exe /s /f /t 5 /c "Apagado remoto solicitado desde Telegram Bot CDKeysPeru"
                break
            }
        }

        $ConsecutiveErrors = 0
    }
    catch {
        $ConsecutiveErrors++
        if ($ConsecutiveErrors -eq 1 -or $ConsecutiveErrors % 10 -eq 0) {
            $err = $_.Exception.Message
            Write-Host "Esperando conexion con el bot ($ServerUrl): $err" -ForegroundColor DarkGray
        }
    }

    Start-Sleep -Seconds $Interval
}
