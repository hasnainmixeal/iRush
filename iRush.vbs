Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir

' 1. Start Node server completely hidden (0 = hide window)
WshShell.Run "cmd.exe /c node server.js >nul 2>&1", 0, False

' 2. Wait 1.5 seconds for port to bind
WScript.Sleep 1500

' 3. Launch Edge in standalone app window or default browser
WshShell.Run "cmd.exe /c start msedge --app=http://127.0.0.1:54321 --window-size=680,820 || start http://127.0.0.1:54321", 0, False
