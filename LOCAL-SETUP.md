# Local BitChord setup — no Render

This addon can run entirely on your Windows PC. No Render account or paid hosting is required.

## 1. Install Node.js

Install Node.js 20 or newer.

Verify:

```powershell
node --version
```

No `npm install` is required because this project currently has no npm dependencies.

## 2. Start the addon

Double-click:

```
start-windows.bat
```

The server listens on:

```
http://localhost:8080
```

The Qobuz signed-session file is stored locally at:

```
data\qobuz-session.json
```

## 3. Get HTTPS for BitChord

The current BitChord release disables Android cleartext HTTP traffic, so `http://192.168.x.x:8080` is not suitable for the normal release APK.

Install Cloudflare `cloudflared`, then:

1. Start `start-windows.bat`.
2. Double-click `start-cloudflare.bat`.
3. Cloudflare prints a URL similar to:

```
https://random-name.trycloudflare.com
```

4. Add that HTTPS URL to BitChord under Settings → Sources → Add addon.

Cloudflare documents Quick Tunnels as free, temporary development tunnels created with:

```
cloudflared tunnel --url http://localhost:8080
```

The generated hostname changes when the tunnel process is restarted.

## 4. Authorize Qobuz

Open:

```
https://YOUR-TUNNEL.trycloudflare.com/auth/start
```

Complete the verification flow, then check:

```
https://YOUR-TUNNEL.trycloudflare.com/auth/status
```

The local addon stores the resulting signed session in `data\qobuz-session.json`.

## Important

Keep both Windows command windows running:

- `start-windows.bat`
- `start-cloudflare.bat`

Stopping either one stops the addon path.

The Cloudflare tunnel only proxies the addon API. BitChord receives the Qobuz media URL from the addon and plays the media directly, so the actual audio stream is not being relayed through the tunnel.
