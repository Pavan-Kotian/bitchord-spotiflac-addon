const DEFAULT_TIMEOUT = 12000;

function baseUrl() {
  return String(process.env.TIDAL_API_URL || '').trim().replace(/\\/$/, '');
}

async function request(path, params = {}) {
  const base = baseUrl();
  if (!base) throw new Error('TIDAL_API_URL is not configured');
  const url = new URL(path, base + '/');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) throw new Error(`Tidal API ${res.status}: ${data?.detail || text.slice(0, 200)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function coverUrl(id, size = 640) {
  if (!id) return undefined;
  const hex = String(id).split('-');
  if (hex.length !== 5) return undefined;
  return `https://resources.tidal.com/images/${hex[0]}/${hex[1]}/${hex[2]}/${hex[3]}/${hex[4]}/${size}x${size}.jpg`;
}

function mapTrack(t) {
  if (!t) return null;
  const artist = t.artist?.name || t.artists?.[0]?.name || '';
  const album = t.album?.title || '';
  return {
    id: `tidal:${t.id}`,
    title: t.title || '',
    artist,
    album,
    duration: Number(t.duration || 0),
    artworkURL: coverUrl(t.album?.cover || t.artist?.picture),
    format: 'flac',
    audioQuality: String(t.audioQuality || t.mediaMetadata?.tags?.[0] || 'LOSSLESS').toUpperCase(),
    isrc: t.isrc
  };
}

function qualityToTidal(value) {
  const q = String(value || 'lossless').toLowerCase();
  if (q === 'low') return 'LOSSLESS';
  if (q === 'high') return 'HI_RES_LOSSLESS';
  return 'HI_RES_LOSSLESS';
}

function decodeManifest(manifest) {
  if (!manifest) return null;
  try {
    return JSON.parse(Buffer.from(manifest, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function tidalConfigured() {
  return Boolean(baseUrl());
}

export async function tidalSearch(query, limit = 25) {
  const data = await request('/search/', { s: query, limit });
  const items = data?.data?.items || [];
  return items.map(mapTrack).filter(Boolean);
}

export async function tidalResolveStream(id, quality = 'lossless') {
  const rawId = String(id).replace(/^tidal:/, '');
  const data = await request('/track/', { id: rawId, quality: qualityToTidal(quality) });
  const track = data?.data;
  if (!track) throw new Error('Tidal track not found');

  let decoded = decodeManifest(track.manifest);
  let url = decoded?.urls?.[0];
  if (!url && typeof track.manifest === 'string' && /^https?:\\/\\//.test(track.manifest)) url = track.manifest;
  if (!url) throw new Error('Tidal response did not contain a playable URL');

  const codec = decoded?.codecs || decoded?.codec || (track.audioQuality === 'LOSSLESS' ? 'flac' : 'flac');
  return {
    url,
    format: 'flac',
    quality: String(track.audioQuality || quality).toLowerCase(),
    codec: String(codec).toLowerCase(),
    container: 'flac',
    manifest: track.manifestMimeType || undefined,
    encrypted: String(decoded?.encryptionType || 'NONE').toUpperCase() !== 'NONE',
    sampleRate: Number(track.sampleRate || 0) || undefined,
    bitDepth: Number(track.bitDepth || 0) || undefined,
    bitrate: Number(track.bitrate || 0) || undefined
  };
}

export async function tidalHealth() {
  if (!tidalConfigured()) return { enabled: false, configured: false };
  try {
    const data = await request('/');
    return { enabled: true, configured: true, ok: true, version: data?.version || undefined };
  } catch (error) {
    return { enabled: true, configured: true, ok: false, error: String(error.message || error) };
  }
}
