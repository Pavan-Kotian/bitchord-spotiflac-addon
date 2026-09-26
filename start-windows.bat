@echo off
setlocal
cd /d "%~dp0"
if not exist "data" mkdir "data"
set QOBUZ_SESSION_FILE=%~dp0data\qobuz-session.json
set PORT=8080
set ADDON_VERSION=0.5.0
echo.
echo ==========================================
echo BitChord SpotiFLAC Qobuz Addon
echo ==========================================
echo.
echo Local addon: http://localhost:8080
echo Health:      http://localhost:8080/health
echo.
node src\server.js
pause
