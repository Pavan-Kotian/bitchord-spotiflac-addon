const DEFAULT_TIMEOUT = 12000;

function baseUrl() {
  return String(process.env.AMAZON_API_URL || '').trim().replace(/\\/$/, '');
}

function token() {
  return String(process.env.AMAZON_API_TOKEN || '').trim();
}

async function request(path, params = {}) {
  const base = baseUrl();
  if (!base) throw new Error('AMAZON_API_URL is not configured');
  const url = new URL(path, base + '/');
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const headers = { accept: 'application/json' };
    if (token()) headers.authorization = `Bearer ${token()}`;
    const res = await fetch(url, { signal: controller.signal, headers });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) throw new Error(`Amazon API ${res.status}: ${data?.detail || text.slice(0, 200)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function mapTrack(t) {
  if (!t) return null;
  return {
    id: `amazon:${t.id}`,
    title: t.title || '',
    artist: t.artist?.name || t.artistName || '',
    album: t.album?.title || t.albumName || '',
    duration: Number(t.duration || 0) > 60000 ? Number(t.duration) / 1000 : Number(t.duration || 0),
    artworkURL: t.image || t.artUrlMap?.FULL || t.artUrlMap?.LARGE,
    format: 'm4a',
    audioQuality: String(t.audioQuality || 'HIGH').toUpperCase(),
    isrc: t.isrc
  };
}

export function amazonConfigured() {
  return Boolean(baseUrl() && token());
}

export async function amazonSearch(query, limit = 25) {
  const data = await request('/search', { query, type: 'track', max_results: limit });
  const tracks = data?.data?.tracks || data?.tracks || [];
  return tracks.map(mapTrack).filter(Boolean);
}

export async function amazonResolveStream(id) {
  const rawId = String(id).replace(/^amazon:/, '');
  const data = await request('/stream_urls', { id: rawId });
  const streams = data?.data;
  if (!Array.isArray(streams) || streams.length === 0) throw new Error('Amazon track has no stream response');

  // Only pass through an explicit, non-DRM URL. Do not reconstruct segmented
  // media or handle PSSH/Widevine material in this addon.
  const candidate = streams.find(s => typeof s?.url === 'string' && /^https?:\\/\\//.test(s.url) && !s.pssh);
  if (!candidate) throw new Error('Amazon stream is not an explicit non-DRM playable URL');

  return {
    url: candidate.url,
    format: String(candidate.format || 'm4a').toLowerCase(),
    quality: String(candidate.quality || 'high').toLowerCase(),
    codec: String(candidate.codecs || 'aac').toLowerCase(),
    container: 'm4a',
    encrypted: false,
    bitrate: Number(candidate.bandwidth || 0) || undefined
  };
}

export async function amazonHealth() {
  if (!amazonConfigured()) return { enabled: false, configured: false };
  try {
    const data = await request('/');
    return { enabled: true, configured: true, ok: data?.status === 'ok' };
  } catch (error) {
    return { enabled: true, configured: true, ok: false, error: String(error.message || error) };
  }
}
