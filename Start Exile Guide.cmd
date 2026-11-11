@echo off
rem Starts the Exile Guide overlay (tray icon: right-click for Build & Settings).
rem The folder lives in OneDrive, so the same overlay, build and progress are on every PC.
rem Per-PC settings (Client.txt path, window position) are kept in user\devices\<PC name>.json.
rem ELECTRON_RUN_AS_NODE is cleared because VS Code terminals set it, which stops Electron opening windows.
set ELECTRON_RUN_AS_NODE=
rem First start on a PC: keep the app downloaded locally (OneDrive "Always keep on this device").
if not exist "%~dp0user\devices\%COMPUTERNAME%.pinned" (
  attrib +P -U "%~dp0*" /S /D >nul 2>&1
  if not exist "%~dp0user\devices" mkdir "%~dp0user\devices"
  echo pinned> "%~dp0user\devices\%COMPUTERNAME%.pinned"
)
start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" .
