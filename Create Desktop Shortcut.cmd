@echo off
rem Run once on each PC: puts an "Exile Guide" shortcut on this PC's desktop.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Exile Guide.lnk');" ^
  "$s.TargetPath='%~dp0Start Exile Guide.cmd'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7;" ^
  "$s.IconLocation='%~dp0node_modules\electron\dist\electron.exe,0'; $s.Save()"
echo Shortcut created on the desktop.
timeout /t 3 >nul
