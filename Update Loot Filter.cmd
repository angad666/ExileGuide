@echo off
rem Moves filter\base.filter to NeverSink's newest release (keeping Tytykiller's changes) and rebuilds
rem SSS-Slayer-3.30.filter. No FilterBlade needed. Then reload the filter in game (Options > Game > Item Filter).
rem Runs the overlay's own Electron as Node, so no Node.js install is needed.
set ELECTRON_RUN_AS_NODE=1
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0tools\update-base-filter.js" %*
if not errorlevel 1 "%~dp0node_modules\electron\dist\electron.exe" "%~dp0tools\build-filter.js"
set ELECTRON_RUN_AS_NODE=
echo.
pause
