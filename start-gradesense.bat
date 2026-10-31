@echo off
setlocal

cd /d "%~dp0"

echo Starting GradeSense AI...
echo.

start "GradeSense Backend - API" cmd /k "cd /d %~dp0backend && npm run start"
start "GradeSense Frontend - React" cmd /k "cd /d %~dp0client && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"

timeout /t 4 /nobreak >nul

start "" "http://127.0.0.1:5173/"

echo GradeSense AI is starting.
echo Frontend: http://127.0.0.1:5173/
echo Backend:  http://127.0.0.1:5000/
echo.
echo Keep the Backend and Frontend terminal windows open while using the app.
pause
