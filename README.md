# BitChord SpotiFLAC Lossless Bridge

A BitChord addon implementing BitChord's `/manifest.json`, `/search`, and `/stream/{id}` contract while using a configurable SpotiFLAC-compatible resolver for provider resolution.

## Why a resolver?

SpotiFLAC providers are JavaScript extensions executed inside the SpotiFLAC runtime. They use runtime services such as signed sessions and provider-specific APIs. This project deliberately does not pretend that a provider source file can be dropped into a normal Node server unchanged.

The bridge therefore keeps BitChord protocol handling separate from provider resolution. A resolver can be implemented with the authorized SpotiFLAC provider/runtime and expose the two small JSON endpoints required here.

## Resolver contract

`GET /search?q=<query>&quality=lossless`

Returns either an array of tracks or `{ "tracks": [...] }`.

`GET /stream?id=<provider-id>&quality=lossless`

Returns a stream object containing an absolute `https://` URL and accurate codec/container/quality metadata.

## Lossless safety

The bridge only marks a rendition as lossless when its codec is FLAC, ALAC, WAV, or PCM. It always sets `encrypted:false`; protected renditions are not exposed.

## Run

```bash
cp .env.example .env
npm start
```

Then add the server root to BitChord.

BitChord will call:

- `/manifest.json`
- `/search?q=...&quality=LOSSLESS`
- `/stream/<encoded-id>?quality=LOSSLESS`


## BitChord compatibility

This bridge follows the current BitChord addon contract: `/manifest.json`, `/search`, and `/stream/{id}`. BitChord sends `quality` on search and stream requests and requires absolute playable URLs with accurate codec/transport metadata.

The bridge intentionally does **not** implement provider authentication bypasses or scrape protected provider sessions. Set `SPOTIFLAC_RESOLVER_URL` to a resolver you control or are authorized to use.

### Resolver contract

- `GET /search?q=<query>&quality=<tier>` → `{ "tracks": [...] }`
- `GET /stream?id=<id>&quality=<tier>` → stream object
- Stream URL must be absolute `https://`/ `http://` and directly playable or explicitly declared as HLS/DASH.
- For lossless, return FLAC, ALAC, WAV, or PCM and accurate sample rate/bit depth when known.
- Return HTTP 404 for a genuine miss; the bridge translates it to a BitChord miss.
- Return HTTP 429 with `Retry-After` when temporarily rate limited.


## Fabricated test resolver

This repository now includes `src/fake-resolver.js`. It is a synthetic provider used to validate the BitChord integration without contacting Qobuz, TIDAL, Deezer, Spotify, or another commercial catalogue.

It exposes:

- `GET /health`
- `GET /search?q=...`
- `GET /stream?id=...`
- `GET /media/<id>.wav`

The resolver generates short PCM/WAV tones at runtime and reports accurate sample rate and bit depth. These are test signals, not commercial music.

### Local test

Run both services with:

```bash
docker compose up --build
```

The addon listens on port 8080 and the fabricated resolver on port 8090.

For BitChord running on another device, change `PUBLIC_BASE_URL` from `http://localhost:8090` to an address reachable by that device, or deploy the resolver behind HTTPS. BitChord requires absolute playable media URLs. citeturn0search0

### Important

The fabricated resolver is intentionally not a real music-provider resolver. The current SpotiFLAC Qobuz provider uses runtime services, signed/verified requests, and provider-specific access, so its source cannot simply be converted into an unauthenticated standalone endpoint. The upstream repository also documents that provider packages are executed as SpotiFLAC extensions. citeturn0search1turn0search2

To connect a real catalogue, replace the fabricated resolver with a resolver backed by an account/API/provider that you are authorized to use.
