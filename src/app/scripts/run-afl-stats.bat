@echo off
echo Running AFL Stats Downloader
cd %~dp0
node download-afl-stats-standalone.js
pause
