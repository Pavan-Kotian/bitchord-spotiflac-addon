import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.RESOLVER_PORT || 8090);
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

const TRACKS = [
  {
    id: 'demo-midnight-signal',
    title: 'Midnight Signal',
    artist: 'Zenith Test Artist',
    album: 'Night Drive',
    duration: 8,
    sampleRate: 44100,
    bitDepth: 16,
    artworkURL: 'https://dummyimage.com/600x600/111/fff.png&text=Midnight+Signal'
  },
  {
    id: 'demo-neon-rain',
    title: 'Neon Rain',
    artist: 'Zenith Test Artist',
    album: 'Night Drive',
    duration: 8,
    sampleRate: 48000,
    bitDepth: 24,
    artworkURL: 'https://dummyimage.com/600x600/222/fff.png&text=Neon+Rain'
  },
  {
    id: 'demo-silent-circuit',
    title: 'Silent Circuit',
    artist: 'Synthetic Waves',
    album: 'Lossless Lab',
    duration: 8,
    sampleRate: 96000,
    bitDepth: 24,
    artworkURL: 'https://dummyimage.com/600x600/333/fff.png&text=Silent+Circuit'
  }
];

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function wavBuffer(track) {
  const sampleRate = track.sampleRate;
  const bits = track.bitDepth;
  const channels = 2;
  const bytesPerSample = bits / 8;
  const frames = Math.floor(sampleRate * track.duration);
  const dataSize = frames * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  const frequency = 220 + (track.id.length * 11);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const max = bits === 24 ? 0x7fffff : 0x7fff;
  let offset = 44;

  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, i / (sampleRate * 0.05), (frames - i) / (sampleRate * 0.05));
    const sample = Math.round(Math.sin(2 * Math.PI * frequency * t) * max * 0.18 * Math.max(0, envelope));

    for (let c = 0; c < channels; c++) {
      if (bits === 24) {
        buffer.writeIntLE(sample, offset, 3);
        offset += 3;
      } else {
        buffer.writeInt16LE(sample, offset);
        offset += 2;
      }
    }
  }

  return buffer;
}

function publicUrl(path) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL + path;
  return path;
}

async function handle(req, res) {
  const u = new URL(req.url, 'http://localhost');

  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  if (u.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      resolver: 'fabricated-test-resolver',
      tracks: TRACKS.length,
      publicBaseUrlConfigured: Boolean(PUBLIC_BASE_URL)
    });
  }

  if (u.pathname === '/search') {
    const q = (u.searchParams.get('q') || '').trim().toLowerCase();
    const quality = (u.searchParams.get('quality') || 'lossless').toLowerCase();

    if (!q) return json(res, 200, { tracks: [] });

    const tracks = TRACKS
      .filter(t => [t.title, t.artist, t.album].join(' ').toLowerCase().includes(q))
      .map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        artworkURL: t.artworkURL,
        format: 'wav',
        audioQuality: 'LOSSLESS',
        qualityRequested: quality
      }));

    return json(res, 200, { tracks });
  }

  if (u.pathname === '/stream') {
    const id = u.searchParams.get('id') || '';
    const track = TRACKS.find(t => t.id === id);
    if (!track) return json(res, 404, { error: 'track_not_found' });

    return json(res, 200, {
      url: publicUrl('/media/' + encodeURIComponent(track.id) + '.wav'),
      format: 'wav',
      quality: 'Lossless · ' + track.bitDepth + '-bit / ' + (track.sampleRate / 1000) + ' kHz',
      codec: 'pcm_s' + track.bitDepth + 'le',
      container: 'wav',
      manifest: 'none',
      encrypted: false,
      sampleRate: track.sampleRate,
      bitDepth: track.bitDepth,
      bitrate: track.sampleRate * track.bitDepth * 2
    });
  }

  if (u.pathname.startsWith('/media/')) {
    const filename = decodeURIComponent(u.pathname.slice('/media/'.length));
    const id = filename.replace(/\.wav$/i, '');
    const track = TRACKS.find(t => t.id === id);
    if (!track) return res.writeHead(404).end();

    const audio = wavBuffer(track);
    res.writeHead(200, {
      'content-type': 'audio/wav',
      'content-length': audio.length,
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=300'
    });
    return res.end(audio);
  }

  return json(res, 404, { error: 'not_found' });
}

http.createServer(handle).listen(PORT, '0.0.0.0', () => {
  console.log('Fabricated resolver listening on :' + PORT);
});
