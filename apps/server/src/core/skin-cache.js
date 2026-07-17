const fs = require('node:fs');
const path = require('node:path');

const SKIN_KINDS = {
  avatar: { size: 64 },
  body: { size: 260 }
};

function safePart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'unknown';
}

class SkinCache {
  constructor(config) {
    this.root = path.join(config.dataDir, 'skins');
    this.pending = new Map();
    fs.mkdirSync(this.root, { recursive: true });
  }

  directory(botId) {
    const directory = path.join(this.root, safePart(botId));
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  metadataPath(botId) {
    return path.join(this.directory(botId), 'metadata.json');
  }

  readMetadata(botId) {
    try {
      return JSON.parse(fs.readFileSync(this.metadataPath(botId), 'utf8'));
    } catch (_) {
      return null;
    }
  }

  assetPath(botId, kind) {
    if (!SKIN_KINDS[kind]) throw new Error(`Unsupported skin asset: ${kind}`);
    return path.join(this.directory(botId), `${kind}.png`);
  }

  status(botId) {
    const metadata = this.readMetadata(botId);
    const cached = Object.fromEntries(Object.keys(SKIN_KINDS).map((kind) => [kind, fs.existsSync(this.assetPath(botId, kind))]));
    return {
      username: metadata?.username || null,
      cached: cached.avatar && cached.body,
      cachedAt: metadata?.cachedAt || null
    };
  }

  async ensure(botId, username, force = false) {
    const normalized = String(username || '').trim();
    if (!normalized || normalized.includes('@')) return this.status(botId);
    const current = this.status(botId);
    if (!force && current.cached && current.username?.toLowerCase() === normalized.toLowerCase()) return current;
    const key = `${botId}:${normalized.toLowerCase()}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const task = this.download(botId, normalized).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  async download(botId, username) {
    const directory = this.directory(botId);
    try {
      for (const [kind, options] of Object.entries(SKIN_KINDS)) {
        const response = await fetch(`https://mc-heads.net/${kind}/${encodeURIComponent(username)}/${options.size}`, {
          signal: AbortSignal.timeout(10000),
          headers: { 'user-agent': 'mc-bot-self/2.0' }
        });
        if (!response.ok) throw new Error(`skin provider returned ${response.status}`);
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('image')) throw new Error(`skin provider returned ${contentType || 'non-image data'}`);
        const body = Buffer.from(await response.arrayBuffer());
        if (!body.length || body.length > 8 * 1024 * 1024) throw new Error('skin image has an invalid size');
        const temporary = path.join(directory, `.${kind}.${process.pid}.${Date.now()}.tmp`);
        fs.writeFileSync(temporary, body);
        fs.renameSync(temporary, this.assetPath(botId, kind));
      }
      const metadata = { username, cachedAt: new Date().toISOString(), source: 'mc-heads.net' };
      const metadataTemporary = path.join(directory, `.metadata.${process.pid}.${Date.now()}.tmp`);
      fs.writeFileSync(metadataTemporary, JSON.stringify(metadata, null, 2));
      fs.renameSync(metadataTemporary, this.metadataPath(botId));
      return this.status(botId);
    } catch (error) {
      return this.status(botId);
    }
  }

  file(botId, kind) {
    const filePath = this.assetPath(botId, kind);
    return fs.existsSync(filePath) ? filePath : null;
  }
}

module.exports = { SkinCache };