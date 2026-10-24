Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\axeln\OneDrive\Desktop\Proyectos\Remote PC IA\pc-agent\pc-agent.ps1""", 0, False
