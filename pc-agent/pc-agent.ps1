# ==============================================================================
# AxelRemote - Agente de Control Remoto y Automatizacion para Antigravity IDE
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
Write-Host "INICIANDO AGENTE AXELREMOTE - ANTIGRAVITY CONTROL" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Servidor:  $ServerUrl"
Write-Host "Intervalo: ${Interval}s"
Write-Host "Equipo:    $env:COMPUTERNAME"
Write-Host "============================================================" -ForegroundColor Cyan

# Cargar librerias graficas de Windows
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

# Definicion User32 para detectar ventana activa
try {
    Add-Type -TypeDefinition @"
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public class User32Api {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    }
"@ -ErrorAction SilentlyContinue
} catch {}

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

function Get-SystemMetrics {
    $cpu = 0
    $usedMb = 0
    $totalMb = 0
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($os) {
            $totalMb = [Math]::Round($os.TotalVisibleMemorySize / 1KB)
            $freeMb = [Math]::Round($os.FreePhysicalMemory / 1KB)
            $usedMb = [Math]::Max(0, $totalMb - $freeMb)
        }
    } catch {}
    try {
        $cpuVal = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Measure-Object -Property LoadPercentage -Average).Average
        if ($null -ne $cpuVal) { $cpu = [int]$cpuVal }
    } catch {}
    return @{
        cpuPercent = $cpu
        ramUsedMb = $usedMb
        ramTotalMb = $totalMb
    }
}

function Get-ActiveWindowTitle {
    try {
        $hwnd = [User32Api]::GetForegroundWindow()
        if ($hwnd -and $hwnd -ne [IntPtr]::Zero) {
            $sb = New-Object System.Text.StringBuilder 256
            [User32Api]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
            $txt = $sb.ToString().Trim()
            if ($txt) { return $txt }
        }
    } catch {}
    return "Escritorio de Windows"
}

function Capture-ScreenBase64 {
    try {
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        
        $ms = New-Object System.IO.MemoryStream
        # Guardar en JPEG comprimido
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
        $bytes = $ms.ToArray()
        $ms.Close()
        $gfx.Dispose()
        $bmp.Dispose()
        
        return [Convert]::ToBase64String($bytes)
    } catch {
        Write-Host "[ERROR CAPTURA] $_" -ForegroundColor Red
        return $null
    }
}

function Send-AntigravityPrompt([string]$promptText) {
    try {
        $wshell = New-Object -ComObject WScript.Shell
        # Activar ventana de Antigravity IDE
        $focused = $wshell.AppActivate("Antigravity")
        Start-Sleep -Milliseconds 350
        
        # Copiar texto al portapapeles
        [System.Windows.Forms.Clipboard]::SetText($promptText)
        Start-Sleep -Milliseconds 150
        
        # Enviar Ctrl+V y Enter
        $wshell.SendKeys("^v")
        Start-Sleep -Milliseconds 250
        $wshell.SendKeys("{ENTER}")
        return $true
    } catch {
        Write-Host "[ERROR PROMPT] $_" -ForegroundColor Red
        return $false
    }
}

function Send-AntigravityKey([string]$keyName) {
    try {
        $wshell = New-Object -ComObject WScript.Shell
        $wshell.AppActivate("Antigravity")
        Start-Sleep -Milliseconds 200
        if ($keyName -eq "esc") {
            $wshell.SendKeys("{ESC}")
        } elseif ($keyName -eq "enter") {
            $wshell.SendKeys("{ENTER}")
        }
        return $true
    } catch {
        return $false
    }
}

function Execute-WindowsCommand([string]$commandLine) {
    try {
        $out = powershell.exe -NoProfile -Command $commandLine 2>&1 | Out-String
        return $out.Trim()
    } catch {
        return "Error ejecutando comando: $_"
    }
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
        $metrics = Get-SystemMetrics
        $activeWindow = Get-ActiveWindowTitle

        $bodyObj = @{
            hostname = $env:COMPUTERNAME
            platform = "win32"
            uptimeSeconds = $uptime
            localIp = $localIp
            cpuPercent = $metrics.cpuPercent
            ramUsedMb = $metrics.ramUsedMb
            ramTotalMb = $metrics.ramTotalMb
            activeWindow = $activeWindow
        }
        $body = $bodyObj | ConvertTo-Json
        $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($body)

        # 1. Enviar Heartbeat enriquecido al bot
        $heartbeatUrl = "$ServerUrl/api/pc/heartbeat"
        $hbRes = Invoke-RestMethod -Uri $heartbeatUrl -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $utf8Bytes -TimeoutSec 5 -ErrorAction Stop

        # 2. Consultar si hay ordenes remotas pendientes
        $pollUrl = "$ServerUrl/api/pc/poll"
        $pollRes = Invoke-RestMethod -Uri $pollUrl -Method Get -Headers $Headers -TimeoutSec 5 -ErrorAction Stop

        if ($pollRes.command) {
            $cmd = $pollRes.command
            $cmdId = $pollRes.commandId
            $payload = $pollRes.payload
            Write-Host "[ORDEN RECIBIDA] Comando: $cmd (ID: $cmdId)" -ForegroundColor Yellow

            # A) CAPTURA DE PANTALLA
            if ($cmd -eq "screenshot") {
                Write-Host "Tomando captura de pantalla..." -ForegroundColor Cyan
                $base64Img = Capture-ScreenBase64
                if ($base64Img) {
                    $shotObj = @{
                        imageBase64 = $base64Img
                        windowTitle = $activeWindow
                    }
                    $shotBody = $shotObj | ConvertTo-Json
                    $shotBytes = [System.Text.Encoding]::UTF8.GetBytes($shotBody)
                    try {
                        Invoke-RestMethod -Uri "$ServerUrl/api/pc/screenshot" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $shotBytes -TimeoutSec 10 -ErrorAction SilentlyContinue
                    } catch {
                        Write-Host "Error enviando screenshot al servidor: $_" -ForegroundColor Red
                    }
                }

                # Ack
                $ackObj = @{ commandId = $cmdId; status = "screenshot_sent"; message = "Captura enviada" }
                $ackBytes = [System.Text.Encoding]::UTF8.GetBytes(($ackObj | ConvertTo-Json))
                try { Invoke-RestMethod -Uri "$ServerUrl/api/pc/ack" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $ackBytes -TimeoutSec 5 -ErrorAction SilentlyContinue } catch {}
            }

            # B) PROMPT A ANTIGRAVITY IDE
            elseif ($cmd -eq "prompt") {
                $promptText = if ($payload.text) { $payload.text } else { "" }
                Write-Host "Inyectando prompt a Antigravity: $promptText" -ForegroundColor Magenta
                $ok = Send-AntigravityPrompt $promptText

                $ackObj = @{ commandId = $cmdId; status = "prompt_sent"; message = if ($ok) { "Prompt inyectado" } else { "Error inyectando" } }
                $ackBytes = [System.Text.Encoding]::UTF8.GetBytes(($ackObj | ConvertTo-Json))
                try { Invoke-RestMethod -Uri "$ServerUrl/api/pc/ack" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $ackBytes -TimeoutSec 5 -ErrorAction SilentlyContinue } catch {}
            }

            # C) TECLA ESCAPE (STOP)
            elseif ($cmd -eq "esc") {
                Write-Host "Enviando Escape a Antigravity..." -ForegroundColor Yellow
                Send-AntigravityKey "esc"
                $ackObj = @{ commandId = $cmdId; status = "key_sent"; message = "Escape (Pausar agente)" }
                $ackBytes = [System.Text.Encoding]::UTF8.GetBytes(($ackObj | ConvertTo-Json))
                try { Invoke-RestMethod -Uri "$ServerUrl/api/pc/ack" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $ackBytes -TimeoutSec 5 -ErrorAction SilentlyContinue } catch {}
            }

            # D) TECLA ENTER (ACEPTAR)
            elseif ($cmd -eq "enter") {
                Write-Host "Enviando Enter a Antigravity..." -ForegroundColor Yellow
                Send-AntigravityKey "enter"
                $ackObj = @{ commandId = $cmdId; status = "key_sent"; message = "Enter (Aceptar/Continuar)" }
                $ackBytes = [System.Text.Encoding]::UTF8.GetBytes(($ackObj | ConvertTo-Json))
                try { Invoke-RestMethod -Uri "$ServerUrl/api/pc/ack" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $ackBytes -TimeoutSec 5 -ErrorAction SilentlyContinue } catch {}
            }

            # E) EJECUTAR COMANDO DE POWERSHELL
            elseif ($cmd -eq "cmd") {
                $cli = if ($payload.commandLine) { $payload.commandLine } else { "" }
                Write-Host "Ejecutando comando: $cli" -ForegroundColor Green
                $out = Execute-WindowsCommand $cli

                $ackObj = @{ commandId = $cmdId; status = "cmd_executed"; output = $out }
                $ackBytes = [System.Text.Encoding]::UTF8.GetBytes(($ackObj | ConvertTo-Json))
                try { Invoke-RestMethod -Uri "$ServerUrl/api/pc/ack" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $ackBytes -TimeoutSec 5 -ErrorAction SilentlyContinue } catch {}
            }

            # F) APAGADO REMOTO
            elseif ($cmd -eq "shutdown") {
                Write-Host "Ejecutando apagado del equipo..." -ForegroundColor Red

                # Confirmar recibo al servidor
                $ackObj = @{
                    commandId = $cmdId
                    status = "shutdown_initiated"
                    message = "Windows ejecutando shutdown /s /f /t 5"
                }
                $ackBytes = [System.Text.Encoding]::UTF8.GetBytes(($ackObj | ConvertTo-Json))
                try {
                    Invoke-RestMethod -Uri "$ServerUrl/api/pc/ack" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $ackBytes -TimeoutSec 5 -ErrorAction SilentlyContinue
                } catch {}

                # Ejecutar shutdown forzado en 5 segundos
                & shutdown.exe /s /f /t 5 /c "Apagado remoto solicitado desde Telegram AxelRemotebot"
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
