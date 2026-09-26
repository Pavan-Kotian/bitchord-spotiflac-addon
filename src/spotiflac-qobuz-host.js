import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER = path.join(HERE, 'providers', 'qobuz-web', 'index.js');
const MANIFEST = path.join(HERE, 'providers', 'qobuz-web', 'manifest.json');
const HTTP_HELPER = path.join(HERE, 'http-sync.cjs');

function sleepMs(ms) {
  const end = Date.now() + Math.max(0, Number(ms || 0));
  while (Date.now() < end) {}
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function hmacSha256Base64Url(key, message) {
  return crypto.createHmac('sha256', Buffer.from(String(key), 'utf8'))
    .update(String(message), 'utf8')
    .digest('base64url');
}

function randomHex(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

function syncHttp(url, method = 'GET', body = '', headers = {}, timeoutMs = 30000) {
  const payload = JSON.stringify({ url, method, body: body || '', headers: headers || {}, timeoutMs });
  const result = spawnSync(process.execPath, [HTTP_HELPER, payload], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout || '').trim();
  if (!stdout) throw new Error(String(result.stderr || 'HTTP helper returned no output').trim());
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error('HTTP helper returned invalid JSON');
  }
  if (value.error) {
    const error = new Error(String(value.error));
    error.code = 'NETWORK_ERROR';
    throw error;
  }
  return value;
}

function queryUrl(base, values) {
  const u = new URL(base);
  for (const [key, value] of Object.entries(values || {})) {
    if (value !== undefined && value !== null && value !== '') {
      u.searchParams.set(key, String(value));
    }
  }
  return u.toString();
}

function nowIso() {
  const d = new Date();
  return d.toISOString().replace('Z', 'Z');
}

function responseObject(response) {
  return {
    statusCode: Number(response.statusCode || response.status || 0),
    status: Number(response.statusCode || response.status || 0),
    ok: Boolean(response.ok),
    url: String(response.url || ''),
    body: String(response.body || ''),
    headers: response.headers || {}
  };
}

class SignedSession {
  constructor(config) {
    this.config = config;
    this.file = process.env.QOBUZ_SESSION_FILE ||
      path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'qobuz-session.json');
    this.lastAuthUrl = '';
    this.installId = '';
    this.record = {};
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.record = raw && typeof raw === 'object' ? raw : {};
    } catch {
      this.record = {};
    }
    this.installId = String(this.record.install_id || process.env.QOBUZ_INSTALL_ID || randomHex(16));
    this.record.install_id = this.installId;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.record, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  clear() {
    const installId = this.installId;
    this.record = { install_id: installId };
    this.lastAuthUrl = '';
    this.save();
  }

  isUsable() {
    const id = String(this.record.session_id || '').trim();
    const secret = String(this.record.session_secret || '').trim();
    if (!id || !secret) return false;
    const expires = Date.parse(String(this.record.expires_at || ''));
    return !Number.isFinite(expires) || Date.now() < expires;
  }

  status() {
    return {
      authenticated: this.isUsable(),
      verification_required: Boolean(this.lastAuthUrl),
      auth_url: this.lastAuthUrl,
      expires_at: String(this.record.expires_at || ''),
      install_id: this.installId,
      session_id: String(this.record.session_id || '')
    };
  }

  endpoint(endpoint) {
    const base = String(this.config.baseUrl).replace(/\/$/, '');
    return endpoint.startsWith('http://') || endpoint.startsWith('https://')
      ? endpoint
      : base + '/' + String(endpoint).replace(/^\/+/, '');
  }

  bootstrap() {
    const url = queryUrl(this.endpoint(this.config.endpoints.bootstrap), {
      app_version: this.config.appVersion,
      install_id: this.installId
    });
    const response = responseObject(syncHttp(url, 'GET', '', {
      Accept: 'application/json',
      'User-Agent': 'SpotiFLAC-Mobile/' + this.config.appVersion
    }, 15000));

    if (response.statusCode >= 200 && response.statusCode < 300) {
      let payload = {};
      try { payload = JSON.parse(response.body || '{}'); } catch {}
      if (payload.session_id && payload.session_secret && payload.expires_at) {
        this.record.session_id = String(payload.session_id);
        this.record.session_secret = String(payload.session_secret);
        this.record.expires_at = String(payload.expires_at);
        this.record.namespace = this.config.namespace;
        this.record.base_url = this.config.baseUrl;
        this.record.app_version = this.config.appVersion;
        this.record.platform = this.config.platform;
        this.lastAuthUrl = '';
        this.save();
        return { success: true };
      }

      const authUrl = String(payload.auth_url || payload.challenge_url || '').trim();
      if (authUrl) {
        this.lastAuthUrl = authUrl;
        return { needsVerification: true, auth_url: authUrl, open_auth_url: authUrl };
      }
    }

    const error = new Error('signed-session bootstrap failed: HTTP ' + response.statusCode);
    error.response = response;
    throw error;
  }

  ensureAuthenticated() {
    if (this.isUsable()) return { success: true };
    this.clear();
    return this.bootstrap();
  }

  completeGrant(grant) {
    const value = String(grant || '').trim();
    if (!value) return { success: false, error: 'grant is required' };

    const url = this.endpoint(this.config.endpoints.exchange);
    const body = JSON.stringify({
      grant: value,
      install_id: this.installId,
      app_version: this.config.appVersion,
      platform: this.config.platform
    });
    const response = responseObject(syncHttp(url, 'POST', body, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'SpotiFLAC-Mobile/' + this.config.appVersion
    }, 30000));

    let payload = {};
    try { payload = JSON.parse(response.body || '{}'); } catch {}

    if (response.statusCode >= 200 && response.statusCode < 300 &&
        payload.session_id && payload.session_secret && payload.expires_at) {
      this.record.session_id = String(payload.session_id);
      this.record.session_secret = String(payload.session_secret);
      this.record.expires_at = String(payload.expires_at);
      this.record.namespace = this.config.namespace;
      this.record.base_url = this.config.baseUrl;
      this.record.app_version = this.config.appVersion;
      this.record.platform = this.config.platform;
      this.lastAuthUrl = '';
      this.save();
      return { success: true };
    }

    return {
      success: false,
      error: 'session exchange failed',
      statusCode: response.statusCode,
      detail: payload.error || payload.message || response.body.slice(0, 300)
    };
  }

  signedHeaders(method, url, body) {
    if (!this.isUsable()) {
      const error = new Error('signed session is not authenticated');
      error.needsVerification = true;
      throw error;
    }

    const now = Date.now();
    const timestamp = nowIso();
    const window = Math.floor(Math.floor(now / 1000) / Number(this.config.timeWindowSeconds || 300));
    const rolling = hmacSha256Base64Url(
      String(this.record.session_secret),
      String(window) + ':' + String(this.record.session_id)
    );
    const bodyHash = sha256(body || '');
    const parsed = new URL(url);
    const signing = [
      this.config.schemeLabel,
      String(method).toUpperCase(),
      parsed.pathname || '/',
      '',
      bodyHash,
      timestamp,
      randomHex(12),
      String(this.record.session_id),
      this.config.appVersion,
      this.config.platform
    ].join('\n');

    const nonce = signing.split('\n')[6];
    const signature = hmacSha256Base64Url(rolling, signing);

    const headers = {
      [this.config.headerPrefix + 'Session']: String(this.record.session_id),
      [this.config.headerPrefix + 'Timestamp']: timestamp,
      [this.config.headerPrefix + 'Nonce']: nonce,
      [this.config.headerPrefix + 'Body-SHA256']: bodyHash,
      [this.config.headerPrefix + 'Signature']: signature,
      [this.config.headerPrefix + 'App-Version']: this.config.appVersion,
      [this.config.headerPrefix + 'Platform']: this.config.platform,
      Accept: 'application/json',
      'User-Agent': 'SpotiFLAC-Mobile/' + this.config.appVersion
    };

    if (body) headers['Content-Type'] = 'application/json';
    return headers;
  }

  signedFetch(method, pathName, body = '', extraHeaders = {}) {
    try {
      const ensured = this.ensureAuthenticated();
      if (ensured && ensured.needsVerification) return ensured;
    } catch (error) {
      if (error && error.needsVerification) {
        return { needsVerification: true, error: 'VERIFY_REQUIRED', auth_url: this.lastAuthUrl };
      }
      throw error;
    }

    const bodyText = body === null || body === undefined
      ? ''
      : (typeof body === 'string' ? body : JSON.stringify(body));

    const url = this.endpoint(pathName);
    let headers = this.signedHeaders(method, url, bodyText);
    for (const [key, value] of Object.entries(extraHeaders || {})) {
      headers[key] = String(value);
    }

    let response = responseObject(syncHttp(url, String(method).toUpperCase(), bodyText, headers, 30000));

    if ((response.statusCode === 401 || response.statusCode === 428) &&
        /VERIFY_REQUIRED|SESSION_INVALID|verify/i.test(response.body || '')) {
      try {
        const boot = this.bootstrap();
        if (boot.needsVerification) return boot;
      } catch {}
    }

    let payload = {};
    try { payload = JSON.parse(response.body || '{}'); } catch {}

    const result = {
      statusCode: response.statusCode,
      status: response.statusCode,
      ok: response.statusCode >= 200 && response.statusCode < 300,
      url: response.url || url,
      body: response.body,
      headers: response.headers || {}
    };
    if (payload && typeof payload === 'object') {
      for (const key of ['error', 'code', 'origin', 'action', 'retryable', 'retryMode', 'retry_after_seconds']) {
        if (payload[key] !== undefined) result[key] = payload[key];
      }
      if (payload.retry_after_seconds !== undefined) result.retryAfterSeconds = payload.retry_after_seconds;
    }
    return result;
  }
}

export class SpotiFLACQobuzHost {
  constructor() {
    this.providerManifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const signed = this.providerManifest.signedSession;
    this.session = new SignedSession({
      namespace: signed.namespace,
      baseUrl: signed.baseUrl,
      appVersion: signed.appVersion,
      platform: signed.platform,
      callbackUrl: signed.callbackUrl,
      schemeLabel: signed.schemeLabel,
      headerPrefix: signed.headerPrefix,
      timeWindowSeconds: signed.timeWindowSeconds,
      endpoints: signed.endpoints
    });

    this.extension = null;
    const self = this;

    const contextObject = {
      console,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      Buffer,
      registerExtension(value) {
        self.extension = value;
        contextObject.extension = value;
      },
      log: {
        info: (...args) => console.log('[Qobuz]', ...args),
        debug: (...args) => {},
        warn: (...args) => console.warn('[Qobuz]', ...args),
        error: (...args) => console.error('[Qobuz]', ...args)
      },
      settings: {
        appId: process.env.QOBUZ_APP_ID || '798273057',
        countryCode: process.env.QOBUZ_COUNTRY_CODE || 'US'
      },
      utils: {
        appUserAgent: () => 'SpotiFLAC-Mobile',
        randomUserAgent: () => 'Mozilla/5.0',
        isDownloadCancelled: () => false,
        sha256,
        sleep: (ms) => { sleepMs(Math.min(Number(ms || 0), 5000)); return true; }
      },
      http: {
        get(url, headers = {}) {
          return syncHttp(String(url), 'GET', '', headers, 30000);
        },
        post(url, body, headers = {}) {
          return syncHttp(String(url), 'POST', typeof body === 'string' ? body : JSON.stringify(body ?? ''), headers, 30000);
        }
      },
      session: {
        status: () => self.session.status(),
        clear: () => { self.session.clear(); return { success: true }; },
        completeGrant: (grant) => self.session.completeGrant(grant),
        signedFetch: (method, pathName, body, headers) => self.session.signedFetch(method, pathName, body, headers)
      },
      file: {
        delete() { return { success: false, error: 'file API is not available in BitChord server mode' }; },
        download() { return { success: false, error: 'file API is not available in BitChord server mode' }; }
      },
      gobackend: {
        checkISRCExists() { return { exists: false }; },
        getAudioQuality() { return null; },
        getLyricsLRC() { return ''; }
      },
      crypto: {
        sha256
      }
    };

    this.context = vm.createContext(contextObject);
    const source = fs.readFileSync(PROVIDER, 'utf8');
    vm.runInContext(source, this.context, {
      filename: 'qobuz-web/index.js',
      timeout: 15000
    });

    if (!this.extension) throw new Error('Qobuz provider did not register an extension');

    if (typeof this.extension.initialize === 'function') {
      this.extension.initialize({
        appId: contextObject.settings.appId,
        countryCode: contextObject.settings.countryCode
      });
    }
  }

  authStatus() {
    return this.session.status();
  }

  startAuth() {
    try {
      const result = this.session.ensureAuthenticated();
      return {
        ...result,
        auth_url: result.auth_url || this.session.lastAuthUrl || ''
      };
    } catch (error) {
      return { success: false, error: String(error.message || error) };
    }
  }

  completeAuth(value) {
    let grant = String(value || '').trim();
    if (grant.includes('://')) {
      try {
        const u = new URL(grant);
        grant = u.searchParams.get('grant') || '';
      } catch {}
    }
    return this.session.completeGrant(grant);
  }

  clearAuth() {
    this.session.clear();
    return { success: true };
  }

  search(query, limit = 25) {
    return this.extension.customSearch(String(query || ''), {
      filter: 'track',
      limit: Math.min(Math.max(Number(limit || 25), 1), 25)
    }) || [];
  }

  resolveStream(trackId, quality) {
    const parsedId = typeof this.context.parseTrackID === 'function'
      ? this.context.parseTrackID(String(trackId || ''))
      : String(trackId || '').replace(/^qobuz:/i, '');

    if (!parsedId) throw Object.assign(new Error('invalid qobuz track id'), { code: 'NOT_FOUND' });

    const q = String(quality || 'lossless').toLowerCase();
    const qualityCode = q === 'high' ? 'HI_RES' : q === 'low' ? 'LOSSLESS' : 'HI_RES_LOSSLESS';
    const info = this.context.resolveDownloadInfo(parsedId, qualityCode, {});

    if (!info || !info.directURL) throw new Error('Qobuz did not return a playable stream URL');

    return {
      url: String(info.directURL),
      format: 'flac',
      quality: qualityCode === 'HI_RES_LOSSLESS' ? 'Hi-Res Lossless' :
        qualityCode === 'HI_RES' ? 'Hi-Res' : 'Lossless',
      codec: 'flac',
      container: 'flac',
      manifest: 'none',
      encrypted: false,
      ...(Number(info.sampleRate || 0) > 0 ? { sampleRate: Number(info.sampleRate) } : {}),
      ...(Number(info.bitDepth || 0) > 0 ? { bitDepth: Number(info.bitDepth) } : {})
    };
  }
}
