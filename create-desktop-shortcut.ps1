$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path -Path $DesktopPath -ChildPath "iRush.lnk"

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$VbsPath = Join-Path -Path $ScriptDir -ChildPath "iRush.vbs"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$VbsPath`""
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.Description = "iRush - High-Speed Pure USB Transfer to iPhone"
$Shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll, 146"
$Shortcut.Save()

Write-Host "iRush desktop shortcut created successfully: $ShortcutPath"
