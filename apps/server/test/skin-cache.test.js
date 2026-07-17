const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SkinCache } = require('../src/core/skin-cache');

test('keeps cached skin assets available after a process restart', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bot-skins-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const config = { dataDir };
  const first = new SkinCache(config);
  const directory = first.directory('Yukikaze');
  fs.writeFileSync(path.join(directory, 'avatar.png'), Buffer.from('avatar'));
  fs.writeFileSync(path.join(directory, 'body.png'), Buffer.from('body'));
  fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({ username: 'Yukikaze', cachedAt: '2026-07-17T00:00:00.000Z' }));

  const restarted = new SkinCache(config);
  assert.deepEqual(restarted.status('Yukikaze'), { username: 'Yukikaze', cached: true, cachedAt: '2026-07-17T00:00:00.000Z' });
  assert.equal(fs.readFileSync(restarted.file('Yukikaze', 'avatar'), 'utf8'), 'avatar');
  assert.equal(fs.readFileSync(restarted.file('Yukikaze', 'body'), 'utf8'), 'body');
});
