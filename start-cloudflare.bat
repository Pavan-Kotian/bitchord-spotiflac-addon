@echo off
setlocal
cd /d "%~dp0"
echo.
echo ==========================================
echo BitChord SpotiFLAC - Cloudflare Tunnel
echo ==========================================
echo.
echo This window starts a temporary HTTPS tunnel.
echo Keep it open while BitChord is using the addon.
echo.
cloudflared tunnel --url http://localhost:8080
pause
