import http from 'node:http';
import { URL } from 'node:url';
import { SpotiFLACQobuzHost } from './spotiflac-qobuz-host.js';

const PORT = Number(process.env.PORT || 8080);
const NAME = process.env.ADDON_NAME || 'SpotiFLAC Qobuz Lossless';
const VERSION = process.env.ADDON_VERSION || '0.4.0';

const MANIFEST = {
  id: 'com.pavan.bitchord.spotiflac.qobuz',
  name: NAME,
  version: VERSION,
  resources: ['search', 'stream'],
  settings: [
    {
      key: 'quality',
      type: 'select',
      default: 'lossless',
      options: [
        { label: 'Hi-Res Lossless', value: 'lossless' },
        { label: 'Hi-Res', value: 'high' },
        { label: 'Lossless', value: 'low' }
      ]
    }
  ]
};

let host;
let startupError = '';

try {
  host = new SpotiFLACQobuzHost();
} catch (error) {
  startupError = String(error && error.message || error);
  console.error('[BitChord] Failed to initialize SpotiFLAC Qobuz host:', startupError);
}

const searchCache = new Map();

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
}

function cacheGet(key) {
  const entry = searchCache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    if (entry) searchCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttl = 60000) {
  searchCache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

function normalizeQuality(value) {
  const q = String(value || 'lossless').trim().toLowerCase();
  if (q === 'hi_res' || q === 'hi-res' || q === 'high') return 'high';
  if (q === 'lossless' || q === 'hi_res_lossless' || q === 'hi-res-lossless') return 'lossless';
  if (q === 'low' || q === 'cd') return 'low';
  return 'lossless';
}

function normalizeAudioQuality(track) {
  const value = String(track.audio_quality || '').trim();
  if (value) return value.toUpperCase().replace(/\s+/g, '_');
  const depth = Number(track.maximum_bit_depth || 0);
  const rate = Number(track.maximum_sampling_rate || 0);
  if (depth >= 24 || rate >= 88200) return 'HI_RES_LOSSLESS';
  return 'LOSSLESS';
}

function normalizeTrack(track) {
  return {
    id: String(track.id || ''),
    title: String(track.name || track.title || ''),
    artist: String(track.artists || track.artist || ''),
    album: String(track.album_name || track.album || ''),
    duration: Math.max(0, Number(track.duration_ms || 0) / 1000),
    artworkURL: track.cover_url || track.images || track.image_url || undefined,
    format: 'flac',
    audioQuality: normalizeAudioQuality(track)
  };
}

function authError(res) {
  const status = host?.authStatus?.() || {};
  return json(res, 503, {
    error: 'verification_required',
    message: 'SpotiFLAC signed-session verification is required.',
    authUrl: status.auth_url || undefined
  });
}

async function handle(req, res) {
  const u = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));

  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  if (u.pathname === '/health') {
    const status = host?.authStatus?.() || {};
    return json(res, 200, {
      ok: Boolean(host),
      version: VERSION,
      provider: 'qobuz-web',
      providerVersion: '1.2.18',
      authenticated: Boolean(status.authenticated),
      verificationRequired: Boolean(status.verification_required),
      startupError: startupError || undefined
    });
  }

  if (u.pathname === '/manifest.json') {
    return json(res, 200, MANIFEST);
  }

  if (u.pathname === '/auth/status') {
    if (!host) return json(res, 503, { error: 'provider_unavailable', detail: startupError });
    const status = host.authStatus();
    return json(res, 200, {
      authenticated: Boolean(status.authenticated),
      verificationRequired: Boolean(status.verification_required),
      authUrl: status.auth_url || undefined,
      expiresAt: status.expires_at || undefined
    });
  }

  if (u.pathname === '/auth/start') {
    if (!host) return json(res, 503, { error: 'provider_unavailable', detail: startupError });
    const result = host.startAuth();
    if (result.needsVerification || result.auth_url) {
      return json(res, 200, {
        authenticated: false,
        verificationRequired: true,
        authUrl: result.auth_url || host.authStatus().auth_url
      });
    }
    return json(res, 200, result);
  }

  if (u.pathname === '/auth/complete') {
    if (!host) return json(res, 503, { error: 'provider_unavailable', detail: startupError });
    const value = u.searchParams.get('grant') || u.searchParams.get('callback') || '';
    const result = host.completeAuth(value);
    return json(res, result.success ? 200 : 400, result);
  }

  if (!host) {
    return json(res, 503, { error: 'provider_unavailable', detail: startupError });
  }

  if (u.pathname === '/search') {
    const q = (u.searchParams.get('q') || '').trim();
    if (!q) return json(res, 200, { tracks: [] });

    const quality = normalizeQuality(u.searchParams.get('quality'));
    const key = quality + ':' + q.toLowerCase().replace(/\s+/g, ' ');
    let rows = cacheGet(key);

    try {
      if (!rows) {
        rows = host.search(q, 25);
        cacheSet(key, rows);
      }
      return json(res, 200, {
        tracks: rows.map(normalizeTrack).filter(track => track.id && track.title)
      });
    } catch (error) {
      const status = host.authStatus();
      if (String(error && error.message || error).includes('VERIFY_REQUIRED') ||
          status.verification_required ||
          !status.authenticated) {
        return authError(res);
      }
      console.error('[BitChord] Qobuz search error:', String(error && error.message || error));
      return json(res, 502, { error: 'provider_unavailable' });
    }
  }

  if (u.pathname.startsWith('/stream/')) {
    const id = decodeURIComponent(u.pathname.slice('/stream/'.length));
    if (!id) return json(res, 404, { error: 'track_not_found' });

    const quality = normalizeQuality(u.searchParams.get('quality'));

    try {
      const stream = host.resolveStream(id, quality);
      return json(res, 200, stream);
    } catch (error) {
      const message = String(error && error.message || error);
      const status = host.authStatus();

      if (message.includes('VERIFY_REQUIRED') || status.verification_required || !status.authenticated) {
        return authError(res);
      }

      if (message.includes('invalid qobuz track id') ||
          message.includes('No Qobuz') ||
          message.includes('track not found')) {
        return json(res, 404, { error: 'track_not_found' });
      }

      console.error('[BitChord] Qobuz stream resolution error:', message);
      return json(res, 502, { error: 'provider_unavailable' });
    }
  }

  return json(res, 404, { error: 'not_found' });
}

http.createServer(handle).listen(PORT, '0.0.0.0', () => {
  console.log('[BitChord] SpotiFLAC Qobuz addon listening on :' + PORT);
});
