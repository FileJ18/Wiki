@echo off
REM Find the process ID of node running ai.js and kill it

for /f "tokens=2" %%a in ('tasklist /fi "imagename eq node.exe" /v /fo csv ^| findstr /i "ai.js"') do (
    echo Stopping node process with PID %%a running ai.js
    taskkill /PID %%a /F
)

echo Done.
pause
