# BitChord SpotiFLAC Qobuz Addon

This BitChord addon now embeds the Qobuz provider from the official SpotiFLAC Extension Store repository and hosts it through a small compatibility runtime.

Upstream provider:
https://github.com/spotiflacapp/SpotiFLAC-Extension/tree/main/sources/qobuz-web

The upstream Qobuz extension declares signed-session support and uses the SpotiFLAC runtime's `session.signedFetch()` API. This project implements the required signed-session protocol and exposes the provider through BitChord's HTTP addon contract.

## Architecture

```
BitChord
   |
   +--> GET /manifest.json
   +--> GET /search?q=...
   +--> GET /stream/{id}
            |
            v
   BitChord SpotiFLAC addon
            |
            v
   Embedded Qobuz SpotiFLAC provider
            |
            +--> Qobuz metadata/search
            |
            +--> Zarz signed session
            |
            +--> Qobuz download-ticket resolution
            |
            v
   Direct FLAC stream URL
```

## Run

### Docker Compose

```bash
mkdir -p data
docker compose up --build
```

The addon listens on port `8080`.

For LAN use, expose port 8080 from the host and use that host's address from BitChord.

## BitChord configuration

Use the addon server as the addon URL, not the raw GitHub `manifest.json` file.

Example:

```text
http://192.168.1.50:8080
```

For internet-facing use, put the service behind HTTPS.

## Signed-session authorization

The Qobuz provider requires the signed session declared by the upstream provider manifest. The embedded runtime does not bypass that authentication.

Start the flow:

```text
GET /auth/start
```

The response can contain:

```json
{
  "authenticated": false,
  "verificationRequired": true,
  "authUrl": "https://..."
}
```

Open the returned `authUrl` and complete the verification flow. The upstream mobile application receives a callback similar to:

```text
spotiflac://session-grant?grant=...&state=...
```

Submit the grant value to:

```text
GET /auth/complete?grant=YOUR_GRANT
```

Then verify:

```text
GET /auth/status
```

Once `authenticated` is true, BitChord search and stream resolution can use the Qobuz provider.

## API

```text
GET /manifest.json
GET /health
GET /auth/start
GET /auth/status
GET /auth/complete?grant=...
GET /search?q=...
GET /stream/{id}?quality=lossless
```

The BitChord layer returns accurate FLAC metadata and does not log the returned stream URL.

## Session security

`data/qobuz-session.json` contains the signed-session secret. Treat it as credential material:

- do not commit it;
- do not publish it;
- restrict filesystem permissions;
- use HTTPS when the addon is reachable outside your LAN;
- do not put the session JSON in a public Docker image.

The server never exposes the session secret through the BitChord API.

## Provider source

The embedded Qobuz provider is copied from the upstream Apache-2.0 project at the version currently present in this repository. See `UPSTREAM-LICENSE.md`.

## Test resolver

`src/fake-resolver.js` is retained as a synthetic development fixture. It is not used by the normal addon and does not contact Qobuz.

## Important limitation

This addon reuses the upstream provider and implements its required signed-session runtime. It does not remove, bypass, or replace the provider's authentication/verification mechanism. A valid signed session is required for Qobuz operations that depend on it.

