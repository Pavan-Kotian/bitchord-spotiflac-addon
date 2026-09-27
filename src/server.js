import http from 'node:http';
import { URL } from 'node:url';
import { SpotiFLACQobuzHost } from './spotiflac-qobuz-host.js';
import { amazonConfigured, amazonHealth, amazonResolveStream, amazonSearch } from './providers/http-amazon.js';
import { tidalConfigured, tidalHealth, tidalResolveStream, tidalSearch } from './providers/http-tidal.js';

const PORT = Number(process.env.PORT || 8080);
const NAME = process.env.ADDON_NAME || 'SpotiFLAC Multi-Source Lossless';
const VERSION = process.env.ADDON_VERSION || '0.6.0';
const ENABLE_TIDAL = String(process.env.ENABLE_TIDAL || 'true').toLowerCase() !== 'false';
const ENABLE_AMAZON = String(process.env.ENABLE_AMAZON || 'true').toLowerCase() !== 'false';

const MANIFEST = {
  id: 'com.pavan.bitchord.spotiflac.multisource',
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

let qobuzHost;
let qobuzStartupError = '';

try {
  qobuzHost = new SpotiFLACQobuzHost();
} catch (error) {
  qobuzStartupError = String(error?.message || error);
  console.error('[BitChord] Qobuz initialization failed:', qobuzStartupError);
}

const searchCache = new Map();

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': '*',
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
  if (q === 'low' || q === 'cd') return 'low';
  return 'lossless';
}

function qobuzAudioQuality(track) {
  const value = String(track.audio_quality || '').trim();
  if (value) return value.toUpperCase().replace(/\s+/g, '_');
  const depth = Number(track.maximum_bit_depth || 0);
  const rate = Number(track.maximum_sampling_rate || 0);
  return depth >= 24 || rate >= 88200 ? 'HI_RES_LOSSLESS' : 'LOSSLESS';
}

function normalizeQobuzTrack(track) {
  return {
    id: `qobuz:${String(track.id || '')}`,
    title: String(track.name || track.title || ''),
    artist: String(track.artists || track.artist || ''),
    album: String(track.album_name || track.album || ''),
    duration: Math.max(0, Number(track.duration_ms || 0) / 1000),
    artworkURL: track.cover_url || track.images || track.image_url || undefined,
    format: 'flac',
    audioQuality: qobuzAudioQuality(track)
  };
}

function authError(res) {
  const status = qobuzHost?.authStatus?.() || {};
  return json(res, 503, {
    error: 'verification_required',
    message: 'Qobuz signed-session verification is required.',
    authUrl: status.auth_url || undefined
  });
}

async function searchAll(q, quality) {
  const key = quality + ':' + q.toLowerCase().replace(/\s+/g, ' ');
  const cached = cacheGet(key);
  if (cached) return cached;

  const jobs = [];
  if (qobuzHost) {
    jobs.push(Promise.resolve().then(() => qobuzHost.search(q, 25))
      .then(rows => rows.map(normalizeQobuzTrack).filter(t => t.id && t.title))
      .catch(error => {
        const status = qobuzHost.authStatus?.() || {};
        if (status.verification_required || !status.authenticated || String(error?.message || error).includes('VERIFY_REQUIRED')) {
          return [];
        }
        console.error('[BitChord] Qobuz search error:', error?.message || error);
        return [];
      }));
  }
  if (ENABLE_TIDAL && tidalConfigured()) {
    jobs.push(tidalSearch(q, 25).catch(error => {
      console.error('[BitChord] Tidal search error:', error?.message || error);
      return [];
    }));
  }
  if (ENABLE_AMAZON && amazonConfigured()) {
    jobs.push(amazonSearch(q, 25).catch(error => {
      console.error('[BitChord] Amazon search error:', error?.message || error);
      return [];
    }));
  }

  const groups = await Promise.all(jobs);
  const rows = groups.flat();
  return cacheSet(key, rows);
}

async function handle(req, res) {
  const u = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': '*'
    });
    return res.end();
  }

  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  if (u.pathname === '/health') {
    const q = qobuzHost?.authStatus?.() || {};
    const [tidal, amazon] = await Promise.all([tidalHealth(), amazonHealth()]);
    return json(res, 200, {
      ok: Boolean(qobuzHost) || tidal.ok || amazon.ok,
      version: VERSION,
      providers: {
        qobuz: {
          enabled: Boolean(qobuzHost),
          provider: 'qobuz-web',
          providerVersion: '1.2.18',
          authenticated: Boolean(q.authenticated),
          verificationRequired: Boolean(q.verification_required),
          startupError: qobuzStartupError || undefined
        },
        tidal,
        amazon
      }
    });
  }

  if (u.pathname === '/manifest.json') return json(res, 200, MANIFEST);

  if (u.pathname === '/auth/status') {
    if (!qobuzHost) return json(res, 503, { error: 'provider_unavailable', detail: qobuzStartupError });
    const status = qobuzHost.authStatus();
    return json(res, 200, {
      authenticated: Boolean(status.authenticated),
      verificationRequired: Boolean(status.verification_required),
      authUrl: status.auth_url || undefined,
      expiresAt: status.expires_at || undefined
    });
  }

  if (u.pathname === '/auth/start') {
    if (!qobuzHost) return json(res, 503, { error: 'provider_unavailable', detail: qobuzStartupError });
    const result = qobuzHost.startAuth();
    if (result.needsVerification || result.auth_url) {
      return json(res, 200, {
        authenticated: false,
        verificationRequired: true,
        authUrl: result.auth_url || qobuzHost.authStatus().auth_url
      });
    }
    return json(res, 200, result);
  }

  if (u.pathname === '/auth/complete') {
    if (!qobuzHost) return json(res, 503, { error: 'provider_unavailable', detail: qobuzStartupError });
    const value = u.searchParams.get('grant') || u.searchParams.get('callback') || '';
    const result = qobuzHost.completeAuth(value);
    return json(res, result.success ? 200 : 400, result);
  }

  if (u.pathname === '/search') {
    const q = (u.searchParams.get('q') || '').trim();
    if (!q) return json(res, 200, { tracks: [] });

    const quality = normalizeQuality(u.searchParams.get('quality'));
    const tracks = await searchAll(q, quality);
    return json(res, 200, { tracks });
  }

  if (u.pathname.startsWith('/stream/')) {
    const encoded = u.pathname.slice('/stream/'.length);
    const id = decodeURIComponent(encoded);
    if (!id) return json(res, 404, { error: 'track_not_found' });

    const quality = normalizeQuality(u.searchParams.get('quality'));

    try {
      if (id.startsWith('qobuz:')) {
        if (!qobuzHost) return json(res, 503, { error: 'provider_unavailable' });
        const status = qobuzHost.authStatus();
        if (status.verification_required || !status.authenticated) return authError(res);
        return json(res, 200, qobuzHost.resolveStream(id.slice('qobuz:'.length), quality));
      }

      if (id.startsWith('tidal:')) {
        if (!ENABLE_TIDAL || !tidalConfigured()) return json(res, 503, { error: 'provider_unavailable' });
        return json(res, 200, await tidalResolveStream(id, quality));
      }

      if (id.startsWith('amazon:')) {
        if (!ENABLE_AMAZON || !amazonConfigured()) return json(res, 503, { error: 'provider_unavailable' });
        return json(res, 200, await amazonResolveStream(id, quality));
      }

      return json(res, 404, { error: 'track_not_found' });
    } catch (error) {
      const message = String(error?.message || error);
      if (id.startsWith('qobuz:') && (message.includes('VERIFY_REQUIRED') || qobuzHost?.authStatus?.().verification_required)) {
        return authError(res);
      }
      if (message.includes('not found') || message.includes('track_not_found')) {
        return json(res, 404, { error: 'track_not_found' });
      }
      console.error('[BitChord] Stream resolution error:', message);
      return json(res, 502, { error: 'provider_unavailable' });
    }
  }

  return json(res, 404, { error: 'not_found' });
}

http.createServer(handle).listen(PORT, '0.0.0.0', () => {
  console.log(`[BitChord] Multi-source addon v${VERSION} listening on :${PORT}`);
});
