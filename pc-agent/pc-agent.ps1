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

# Definicion de ScreenCapturer para soporte multi-pantalla y conexion segura a Desktop
if (-not ([System.Management.Automation.PSTypeName]'ScreenCapturer').Type) {
    try {
        Add-Type -TypeDefinition @"
        using System;
        using System.IO;
        using System.Collections.Generic;
        using System.Threading;
        using System.Runtime.InteropServices;
        using System.Drawing;
        using System.Drawing.Imaging;
        using System.Windows.Forms;

        public class ScreenInfo {
            public int Index;
            public string DeviceName;
            public string Name;
            public int X;
            public int Y;
            public int Width;
            public int Height;
            public bool IsPrimary;
            public string ImageBase64;
        }

        public class MultiScreenResult {
            public List<ScreenInfo> Screens = new List<ScreenInfo>();
            public string PanoramicBase64 = null;
            public string PanoramicResolution = null;
            public string PrimaryBase64 = null;
            public string Error = null;
        }

        public class ScreenCapturer {
            [DllImport("user32.dll", SetLastError = true)]
            public static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);

            [DllImport("user32.dll", SetLastError = true)]
            public static extern bool SetProcessWindowStation(IntPtr hWinSta);

            [DllImport("user32.dll", SetLastError = true)]
            public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

            [DllImport("user32.dll", SetLastError = true)]
            public static extern bool SetThreadDesktop(IntPtr hDesktop);

            [DllImport("user32.dll", SetLastError = true)]
            public static extern bool CloseDesktop(IntPtr hDesktop);

            private static ImageCodecInfo GetEncoder(ImageFormat format) {
                ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
                foreach (ImageCodecInfo codec in codecs) {
                    if (codec.FormatID == format.Guid) {
                        return codec;
                    }
                }
                return null;
            }

            public static string ToJpegBase64(Bitmap bmp, long quality = 75L) {
                using (MemoryStream ms = new MemoryStream()) {
                    ImageCodecInfo encoder = GetEncoder(ImageFormat.Jpeg);
                    EncoderParameters encoderParams = new EncoderParameters(1);
                    encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                    bmp.Save(ms, encoder, encoderParams);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }

            public static MultiScreenResult CaptureAll(string target = "all") {
                MultiScreenResult result = new MultiScreenResult();

                Thread t = new Thread(() => {
                    IntPtr hDesk = IntPtr.Zero;
                    try {
                        IntPtr hwinsta = OpenWindowStation("winsta0", false, 0x10000000);
                        if (hwinsta != IntPtr.Zero) SetProcessWindowStation(hwinsta);
                        hDesk = OpenInputDesktop(0, false, 0x10000000);
                        if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);

                        Screen[] allScreens = Screen.AllScreens;
                        Array.Sort(allScreens, (a, b) => a.Bounds.X.CompareTo(b.Bounds.X));

                        if (target == "panoramic" || target == "all") {
                            Rectangle vs = SystemInformation.VirtualScreen;
                            using (Bitmap fullBmp = new Bitmap(vs.Width, vs.Height)) {
                                using (Graphics g = Graphics.FromImage(fullBmp)) {
                                    g.CopyFromScreen(vs.Left, vs.Top, 0, 0, vs.Size, CopyPixelOperation.SourceCopy);
                                }
                                result.PanoramicBase64 = ToJpegBase64(fullBmp, 70L);
                                result.PanoramicResolution = vs.Width + "x" + vs.Height;
                            }
                        }

                        for (int i = 0; i < allScreens.Length; i++) {
                            Screen s = allScreens[i];
                            int screenNum = i + 1;

                            if (target != "all" && target != "panoramic" && target != screenNum.ToString()) {
                                continue;
                            }

                            Rectangle b = s.Bounds;
                            using (Bitmap sBmp = new Bitmap(b.Width, b.Height)) {
                                using (Graphics g = Graphics.FromImage(sBmp)) {
                                    g.CopyFromScreen(b.Location, Point.Empty, b.Size, CopyPixelOperation.SourceCopy);
                                }
                                string b64 = ToJpegBase64(sBmp, 75L);

                                string posLabel = "";
                                if (allScreens.Length == 3) {
                                    if (i == 0) posLabel = " (Izquierda)";
                                    else if (i == 1) posLabel = " (Centro)";
                                    else if (i == 2) posLabel = " (Derecha)";
                                } else if (allScreens.Length == 2) {
                                    if (i == 0) posLabel = " (Izquierda)";
                                    else if (i == 1) posLabel = " (Derecha)";
                                }

                                string name = "Pantalla " + screenNum + posLabel + (s.Primary ? " [Principal]" : "");

                                ScreenInfo si = new ScreenInfo {
                                    Index = screenNum,
                                    DeviceName = s.DeviceName,
                                    Name = name,
                                    X = b.X,
                                    Y = b.Y,
                                    Width = b.Width,
                                    Height = b.Height,
                                    IsPrimary = s.Primary,
                                    ImageBase64 = b64
                                };

                                result.Screens.Add(si);

                                if (s.Primary) {
                                    result.PrimaryBase64 = b64;
                                }
                            }
                        }

                        if (result.PrimaryBase64 == null && result.Screens.Count > 0) {
                            result.PrimaryBase64 = result.Screens[0].ImageBase64;
                        }
                    } catch (Exception ex) {
                        result.Error = ex.Message;
                    } finally {
                        if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
                    }
                });

                t.SetApartmentState(ApartmentState.STA);
                t.Start();
                t.Join();

                return result;
            }
        }
"@ -ReferencedAssemblies System.Drawing, System.Windows.Forms -ErrorAction SilentlyContinue
    } catch {}
}

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

function Capture-ScreenMulti {
    param(
        [string]$target = "all"
    )
    try {
        if (([System.Management.Automation.PSTypeName]'ScreenCapturer').Type) {
            return [ScreenCapturer]::CaptureAll($target)
        }
    } catch {
        Write-Host "[ERROR CAPTURA MULTI] $_" -ForegroundColor Red
    }
    return $null
}

function Capture-ScreenBase64 {
    $res = Capture-ScreenMulti -target "all"
    if ($res -and $res.PrimaryBase64) {
        return $res.PrimaryBase64
    }
    return $null
}

function Send-AntigravityPrompt([string]$promptText) {
    try {
        # 1. Intentar inyeccion nativa ultra-precisa por CDP (puerto 9000 de Antigravity)
        $nodeScript = Join-Path $ScriptDir "inject-prompt.js"
        if (Test-Path $nodeScript) {
            $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($promptText))
            $res = & node $nodeScript "b64:$b64" 2>&1 | Out-String
            if ($res -match "SENT_OK") {
                Write-Host "[PROMPT] Inyectado nativamente via CDP en Antigravity" -ForegroundColor Green
                return $true
            }
            Write-Host "[PROMPT CDP] Resultado: $res - Probando fallback con teclado..." -ForegroundColor DarkYellow
        }

        # 2. Fallback con teclado: activa Antigravity, enfoca chat con Ctrl+L y envia Enter
        $wshell = New-Object -ComObject WScript.Shell
        $focused = $wshell.AppActivate("Antigravity")
        Start-Sleep -Milliseconds 350

        # Ctrl+L enfoca directamente la barra de chat en Antigravity IDE
        $wshell.SendKeys("^l")
        Start-Sleep -Milliseconds 250

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
        # 1. Intentar accion nativa via CDP (puerto 9000)
        $nodeAction = Join-Path $ScriptDir "inject-action.js"
        if (Test-Path $nodeAction) {
            $res = & node $nodeAction $keyName 2>&1 | Out-String
            if ($res -match "CLICKED") {
                Write-Host "[KEY] Accion '$keyName' ejecutada via CDP" -ForegroundColor Green
                return $true
            }
        }

        # 2. Fallback por teclado
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

            # A) CAPTURA DE PANTALLA (Multi-pantalla: hasta 3 monitores + panoramica)
            if ($cmd -eq "screenshot") {
                $target = if ($payload.target) { $payload.target } else { "all" }
                Write-Host "Tomando captura de pantalla (Target: $target)..." -ForegroundColor Cyan
                
                $result = Capture-ScreenMulti -target $target
                if ($result -and -not $result.Error) {
                    $shotObj = @{
                        target = $target
                        windowTitle = $activeWindow
                        imageBase64 = $result.PrimaryBase64
                        screens = @()
                    }

                    if ($result.PanoramicBase64) {
                        $shotObj.panoramic = @{
                            resolution = $result.PanoramicResolution
                            imageBase64 = $result.PanoramicBase64
                        }
                    }

                    foreach ($s in $result.Screens) {
                        $shotObj.screens += @{
                            index = $s.Index
                            name = $s.Name
                            deviceName = $s.DeviceName
                            resolution = "$($s.Width)x$($s.Height)"
                            isPrimary = $s.IsPrimary
                            imageBase64 = $s.ImageBase64
                        }
                    }

                    $shotBody = $shotObj | ConvertTo-Json -Depth 5
                    $shotBytes = [System.Text.Encoding]::UTF8.GetBytes($shotBody)
                    try {
                        Invoke-RestMethod -Uri "$ServerUrl/api/pc/screenshot" -Method Post -Headers $Headers -ContentType "application/json; charset=utf-8" -Body $shotBytes -TimeoutSec 15 -ErrorAction SilentlyContinue
                        Write-Host "Captura enviada con exito ($($shotObj.screens.Count) pantallas enviadas)." -ForegroundColor Green
                    } catch {
                        Write-Host "Error enviando screenshot al servidor: $_" -ForegroundColor Red
                    }
                } else {
                    $errMsg = if ($result -and $result.Error) { $result.Error } else { "Fallo en captura grafica" }
                    Write-Host "No se pudo realizar la captura: $errMsg" -ForegroundColor Red
                }

                # Ack
                $ackObj = @{ commandId = $cmdId; status = "screenshot_sent"; message = "Captura ($target) procesada" }
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
