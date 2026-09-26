import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8080);
const RESOLVER_URL = String(process.env.SPOTIFLAC_RESOLVER_URL || '').replace(/\/$/, '');
const API_KEY = process.env.SPOTIFLAC_RESOLVER_KEY || '';
const NAME = process.env.ADDON_NAME || 'SpotiFLAC Lossless Bridge';
const VERSION = process.env.ADDON_VERSION || '0.3.0';

const MANIFEST = {
  id: 'com.pavan.bitchord.spotiflac-lossless',
  name: NAME,
  version: VERSION,
  resources: ['search', 'stream'],
  settings: [
    { key: 'quality', type: 'select', default: 'lossless', options: [
      { label: 'Lossless', value: 'lossless' },
      { label: 'High', value: 'high' },
      { label: 'Low', value: 'low' }
    ]}
  ]
};

const cache = new Map();
function cached(key, ttl, producer) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  return Promise.resolve(producer()).then(value => {
    cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  });
}
function json(res, status, value, headers={}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers });
  res.end(body);
}
function resolverHeaders() {
  return API_KEY ? { 'authorization': `Bearer ${API_KEY}` } : {};
}
async function resolver(path, query={}) {
  if (!RESOLVER_URL) throw new Error('resolver_not_configured');
  const u = new URL(RESOLVER_URL + path);
  for (const [k,v] of Object.entries(query)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: resolverHeaders(), signal: AbortSignal.timeout(15000) });
  if (r.status === 404) { const e = new Error('resolver_not_found'); e.code = 'NOT_FOUND'; throw e; }
  if (r.status === 429) { const e = new Error('resolver_rate_limited'); e.code = 'RATE_LIMITED'; throw e; }
  if (!r.ok) { const e = new Error(`resolver_http_${r.status}`); e.code = 'UPSTREAM_ERROR'; throw e; }
  const type = r.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('json')) throw new Error('resolver_invalid_content_type');
  return r.json();
}
function normalizeTrack(t) {
  return {
    id: String(t.id ?? ''),
    title: String(t.title ?? t.name ?? ''),
    artist: String(t.artist ?? t.artists ?? ''),
    album: String(t.album ?? t.album_name ?? ''),
    duration: Number(t.duration ?? t.duration_sec ?? (Number(t.duration_ms || 0) / 1000)),
    artworkURL: t.artworkURL || t.artwork_url || t.cover_url || undefined,
    format: String(t.format || '').toLowerCase() || undefined,
    audioQuality: String(t.audioQuality || 'LOSSLESS').toUpperCase()
  };
}
function normalizeStream(s) {
  const codec = String(s.codec || s.format || '').toLowerCase();
  const lossless = ['flac','alac','wav','pcm'].includes(codec) || codec.startsWith('pcm_');
  if (!s.url || !/^https?:\/\//i.test(s.url)) throw new Error('resolver returned no absolute media URL');
  if (!lossless && String(s.quality||'').toUpperCase().includes('LOSSLESS')) throw new Error('resolver overstated lossless quality');
  return {
    url: s.url,
    format: String(s.format || codec || 'flac').toLowerCase(),
    quality: s.quality || (lossless ? 'Lossless' : 'High'),
    codec,
    container: String(s.container || codec || 'flac').toLowerCase(),
    manifest: s.manifest || 'none',
    encrypted: false,
    ...(Number(s.sampleRate||0) > 0 ? { sampleRate: Number(s.sampleRate) } : {}),
    ...(Number(s.bitDepth||0) > 0 ? { bitDepth: Number(s.bitDepth) } : {}),
    ...(Number(s.bitrate||0) > 0 ? { bitrate: Number(s.bitrate) } : {})
  };
}

async function handle(req,res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method !== 'GET') return json(res, 405, {error:'method_not_allowed'});
    if (u.pathname === '/health') return json(res, 200, {ok:true, version:VERSION, resolverConfigured:!!RESOLVER_URL});
    if (u.pathname === '/manifest.json') return json(res, 200, MANIFEST);
    if (u.pathname === '/search') {
      const q = u.searchParams.get('q') || '';
      const quality = u.searchParams.get('quality') || 'lossless';
      if (!q.trim()) return json(res,200,{tracks:[]});
      const data = await cached(`s:${quality}:${q.toLowerCase()}`, 60000, () => resolver('/search',{q,quality}));
      const rows = Array.isArray(data) ? data : (data.tracks || []);
      return json(res,200,{tracks:rows.map(normalizeTrack).filter(x=>x.id&&x.title).slice(0,25)});
    }
    if (u.pathname.startsWith('/stream/')) {
      const id = decodeURIComponent(u.pathname.slice('/stream/'.length));
      if (!id) return json(res,404,{error:'track_not_found'});
      const quality = u.searchParams.get('quality') || 'lossless';
      const data = await resolver('/stream',{id,quality});
      return json(res,200,normalizeStream(data.stream || data));
    }
    return json(res,404,{error:'not_found'});
  } catch (e) {
    if (e?.code === 'NOT_FOUND') return json(res,404,{error:'track_not_found'});
    if (e?.code === 'RATE_LIMITED') return json(res,429,{error:'provider_rate_limited','retryAfter':30},{'retry-after':'30'});
    if (e?.message === 'resolver_not_configured') return json(res,503,{error:'resolver_not_configured'});
    return json(res,502,{error:'provider_unavailable'});
  }
}

http.createServer(handle).listen(PORT, '0.0.0.0', () => console.log(`BitChord SpotiFLAC bridge listening on :${PORT}`));