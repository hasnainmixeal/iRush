$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# 1. Stop any old instance on port 54321
Get-NetTCPConnection -LocalPort 54321 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

# 2. Start Node server in completely hidden background process
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $ScriptDir -WindowStyle Hidden

# 3. Wait for server to bind port
for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 150
    if (Get-NetTCPConnection -LocalPort 54321 -ErrorAction SilentlyContinue) {
        break
    }
}

# 4. Launch Edge in standalone app window or default browser
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (Test-Path $edgePath) {
    Start-Process -FilePath $edgePath -ArgumentList "--app=`"http://127.0.0.1:54321`" --window-size=680,820"
} else {
    Start-Process "http://127.0.0.1:54321"
}
