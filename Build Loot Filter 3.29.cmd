@echo off
rem Builds the filter for 3.29 (before the 3.30 launch): Documents\My Games\Path of Exile\SSS-Slayer-3.29.filter.
rem Same as "Build Loot Filter.cmd" but without the 3.30 clean-up, and 3.30-only items (Threads) left out.
call "%~dp0Build Loot Filter.cmd" --league 3.29
