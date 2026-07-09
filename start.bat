@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo First run detected - installing dependencies...
    echo This needs an internet connection and only happens once.
    echo.
    call npm install
    echo.
)

echo Starting Dynamic Recruiting Pipeline Tool...
call npm start

echo.
echo App closed. Press any key to close this window.
pause >nul
