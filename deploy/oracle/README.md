# Oracle Cloud Always Free deployment

This deployment runs the BitChord addon, the self-hosted Tidal backend, and Caddy on one Oracle Cloud VM.

Use an OCI Ampere A1 Flex VM with 2 OCPUs and 12 GB RAM. Allow inbound TCP 80 and 443, keep provider ports private, configure a DNS name pointing to the VM, then run:

docker compose --env-file .env up -d --build

The public endpoints are:

- https://YOUR_DOMAIN/manifest.json
- https://YOUR_DOMAIN/health

Use the HTTPS root URL as the BitChord addon URL.

Tidal authentication is handled by the upstream hifi-api token.json flow. Put the resulting token.json into the tidal_data volume as /data/token.json. Do not publish port 8000.

Qobuz session data is persisted in qobuz_data.

Amazon is disabled in this deployment because the supplied Amazon backend includes a Widevine-key extraction endpoint. A separate legitimate backend that only returns already-authorized non-DRM playback URLs can be configured later.

Oracle's current Always Free A1 allowance is 2 OCPUs and 12 GB RAM for an Always Free tenancy.
