# BitChord SpotiFLAC Multi-Source Addon

A single BitChord-compatible HTTP addon aggregating Qobuz, Tidal and Amazon Music metadata behind one search endpoint and routing streams to the correct provider.

## Provider status

| Provider | Search | Stream | Authentication |
|---|---|---|---|
| Qobuz | Yes | Yes | SpotiFLAC signed session |
| Tidal | Yes | Yes when the external API returns a playable non-DRM FLAC URL | Self-hosted hifi-api |
| Amazon Music | Yes | Only explicit non-DRM URLs | Self-hosted Amazon API |

Provider IDs are namespaced: qobuz:12345, tidal:12345, amazon:B0....

The addon does not implement DRM key extraction, Widevine decryption, or DRM bypass. Amazon responses requiring DRM processing are rejected rather than converted into a playable stream.

## Architecture

BitChord/Eclipse client -> /manifest.json, /search, /stream/{id} -> this addon -> Qobuz / Tidal HTTP / Amazon HTTP -> normalized BitChord response.

## Run

Use Docker Compose as before:

    docker compose up --build

The addon listens on port 8080.

Configure .env from .env.example. TIDAL_API_URL points to a separately hosted binimum/hifi-api instance. AMAZON_API_URL points to a separately hosted itsmeadarsh2008/amazon-music-api instance, and AMAZON_API_TOKEN is its bearer token.

The Python backends remain separate intentionally; the Node addon stays lightweight and does not copy their runtimes.

## BitChord

Point BitChord at the running addon server, not the raw GitHub manifest.

    https://your-addon.example.com

Endpoints:

    GET /manifest.json
    GET /health
    GET /auth/start
    GET /auth/status
    GET /auth/complete?grant=...
    GET /search?q=...
    GET /stream/{id}?quality=lossless

CORS and OPTIONS are supported.

## Qobuz

Qobuz keeps the existing signed-session flow. A valid signed session is required; provider authentication is not bypassed.

## Tidal

Run binimum/hifi-api separately with a valid Tidal account and set TIDAL_API_URL. The adapter uses its documented /search/ and /track/ endpoints and returns the explicit playback URL contained in the returned manifest.

The Tidal project documents one in-flight playback request per playback credential and queues requests when credentials are occupied.

## Amazon Music

Run itsmeadarsh2008/amazon-music-api separately and set AMAZON_API_URL plus AMAZON_API_TOKEN. The adapter uses /search and /stream_urls.

Only an explicit HTTPS stream URL with no DRM marker is passed through. The addon does not call /widevine_key, reconstruct DRM segments, decrypt protected media, or transcode protected content.

Therefore Amazon metadata/search can work even when its current backend cannot expose a direct non-DRM playback URL. That behavior is deliberate.

## Health

GET /health reports each provider independently so you can see what is configured and reachable before troubleshooting BitChord.

## Security

- Keep Qobuz session files private.
- Keep Amazon bearer tokens private.
- Prefer HTTPS for internet-facing deployments.
- Do not expose Tidal/Amazon credential files or backend administration publicly.
- Do not commit .env, tokens, cookies, session files, or captured provider responses.

## Upstream projects

- Qobuz: SpotiFLAC Extension qobuz-web provider.
- Tidal: binimum/hifi-api.
- Amazon Music: itsmeadarsh2008/amazon-music-api.

## Version 0.6.0

- Added external Tidal and Amazon provider adapters.
- Added namespaced provider IDs.
- Added merged multi-provider search.
- Added provider health reporting.
- Added CORS and OPTIONS handling.
- Kept the existing Qobuz signed-session implementation intact.
