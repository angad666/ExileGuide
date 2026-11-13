@echo off
rem Builds the league-start loot filter into Documents\My Games\Path of Exile\SSS-Slayer-3.30.filter:
rem   filter\base.filter (NeverSink + Tytykiller's FilterBlade changes) + filter\sss-block.filter (build key bases)
rem   + 3.30 fixes. When NeverSink releases an update, run "Update Loot Filter.cmd" instead (it does both).
rem   Then reload the filter in game (Options > Game > Item Filter).
rem Runs the overlay's own Electron as Node, so no Node.js install is needed.
set ELECTRON_RUN_AS_NODE=1
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0tools\build-filter.js" %*
set ELECTRON_RUN_AS_NODE=
echo.
pause
