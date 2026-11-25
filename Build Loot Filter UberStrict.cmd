@echo off
rem Writes Documents\My Games\Path of Exile\NeverSink-UberStrict-3.30.filter:
rem   1. NeverSink's online 5-UBER-STRICT filter from pathofexile.com, which FilterBlade keeps re-tiered from the
rem      economy (tools\fetch-online-filter.js -> filter\base-uberstrict.filter). Needs your login: the first time,
rem      or when the session has expired, run it from a terminal as
rem         "Build Loot Filter UberStrict.cmd" --sessid <POESESSID cookie>
rem      (saved in user\poesessid.txt, which is not in git).
rem   2. bases: NeverSink's Tier 1 bases (crafting + exotic) shown where poe.ninja prices them at 10c+ for that
rem      item level, i86 copies worth 1.5x+ their lower copies in a premium style, every other base hidden
rem      (filter\base-uberstrict-final.filter, list in filter\bases-report.txt).
rem   3. uniques one level stricter: NeverSink's unique rules from his online 6-UBER-PLUS-STRICT filter
rem      (filter\base-uberplus.filter, tools\stricter-rules.js), except boss-only uniques, which keep Uber Strict.
rem   Run it again for NeverSink's latest economy tiering; then reload the filter in game.
rem Uses the overlay's own Electron as Node if it is installed (npm install), else Node.js.
set "RUN=node"
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  set ELECTRON_RUN_AS_NODE=1
  set "RUN=%~dp0node_modules\electron\dist\electron.exe"
)
"%RUN%" "%~dp0tools\fetch-online-filter.js" %*
if errorlevel 1 goto done
"%RUN%" "%~dp0tools\fetch-online-filter.js" --id Gg4zsE --out "%~dp0filter\base-uberplus.filter"
if errorlevel 1 goto done
"%RUN%" "%~dp0tools\stricter-rules.js" --in "%~dp0filter\base-uberstrict.filter" --stricter "%~dp0filter\base-uberplus.filter" --type "^uniques" --except "uniques t3boss"
if errorlevel 1 goto done
"%RUN%" "%~dp0tools\base-rules.js" --in "%~dp0filter\base-uberstrict.filter" --out "%~dp0filter\base-uberstrict-final.filter" --report "%~dp0filter\bases-report.txt"
if errorlevel 1 goto done
"%RUN%" "%~dp0tools\build-filter.js" --base "%~dp0filter\base-uberstrict-final.filter" --block none --name NeverSink-UberStrict-3.30
:done
set ELECTRON_RUN_AS_NODE=
echo.
pause
