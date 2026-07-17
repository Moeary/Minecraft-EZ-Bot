const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BotManager } = require('../src/core/bot-manager');

function createConfig() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bot-manager-'));
  return {
    rootDir,
    configDir: rootDir,
    dataDir: path.join(rootDir, 'data'),
    botsPath: path.join(rootDir, 'bots.local.json'),
    whitelistPath: path.join(rootDir, 'whitelist.local.json'),
    defaults: {
      checkTimeoutInterval: 60000,
      viewDistance: 'tiny',
      reconnectDelayMs: 30000,
      authReconnectDelayMs: 60000,
      targetMobs: []
    },
    web: { host: '127.0.0.1', port: 3000, viewerPortStart: 4100, autoStart: [], allowRawCommands: false },
    bots: [],
    whitelist: []
  };
}

test('adds bots, allocates viewer ports, and persists ignored local configuration', (t) => {
  const config = createConfig();
  t.after(() => fs.rmSync(config.rootDir, { recursive: true, force: true }));
  const manager = new BotManager(config);

  const first = manager.add({
    id: 'alpha', host: 'localhost', port: 25565, username: 'Alpha', auth: 'offline',
    viewer: { enabled: true, viewDistance: 6, firstPerson: false }
  });
  const second = manager.add({
    id: 'beta', host: 'localhost', port: 25565, username: 'Beta', auth: 'offline',
    viewer: { enabled: true, viewDistance: 6, firstPerson: false }
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(manager.definition('alpha').viewer.port, 4100);
  assert.equal(manager.definition('beta').viewer.port, 4101);
  const saved = JSON.parse(fs.readFileSync(config.botsPath, 'utf8'));
  assert.equal(saved.bots.length, 2);
  assert.equal(saved.bots[1].viewer.port, 4101);
});

test('updates whitelist immediately for all managed bots', (t) => {
  const config = createConfig();
  t.after(() => fs.rmSync(config.rootDir, { recursive: true, force: true }));
  const manager = new BotManager(config);

  const result = manager.setWhitelist(['PlayerOne', 'playerone', ' PlayerTwo ']);

  assert.equal(result.ok, true);
  assert.deepEqual(config.whitelist, ['PlayerOne', 'PlayerTwo']);
  assert.deepEqual(JSON.parse(fs.readFileSync(config.whitelistPath, 'utf8')), ['PlayerOne', 'PlayerTwo']);
});


test('persists Web-configured region mining filters across manager restarts', (t) => {
  const config = createConfig();
  t.after(() => fs.rmSync(config.rootDir, { recursive: true, force: true }));
  const manager = new BotManager(config);
  manager.add({ id: 'miner', host: 'localhost', username: 'Miner', auth: 'offline', viewer: { enabled: false } });

  const result = manager.configureRegion('miner', {
    x1: 10, y1: 20, z1: 30, x2: 12, y2: 21, z2: 31,
    mode: 'blacklist', allow: [], deny: ['diamond_ore', 'ancient_debris']
  });

  assert.equal(result.ok, true);
  assert.equal(result.region.volume, 12);
  assert.deepEqual(result.region.customDeny, ['diamond_ore', 'ancient_debris']);
  const saved = JSON.parse(fs.readFileSync(config.botsPath, 'utf8'));
  assert.deepEqual(saved.bots[0].miningRegion.deny, ['diamond_ore', 'ancient_debris']);

  const restarted = new BotManager({ ...config, bots: saved.bots });
  assert.equal(restarted.list()[0].region.mode, 'blacklist');
  assert.deepEqual(restarted.list()[0].region.customDeny, ['diamond_ore', 'ancient_debris']);
});

test('persists global and per-bot skill policies and copies them between bots', (t) => {
  const config = createConfig();
  t.after(() => fs.rmSync(config.rootDir, { recursive: true, force: true }));
  const manager = new BotManager(config);
  manager.add({ id: 'alpha', host: 'localhost', username: 'Alpha', auth: 'offline', viewer: { enabled: false } });
  manager.add({ id: 'beta', host: 'localhost', username: 'Beta', auth: 'offline', viewer: { enabled: false } });

  const globalResult = manager.updateSkills('global', null, {
    mining: { enabled: true, priority: 68 },
    'chat-command': { enabled: true, priority: 10 }
  });
  assert.equal(globalResult.ok, true);
  assert.equal(manager.skillSettings().global.mining.priority, 68);

  const alphaResult = manager.updateSkills('bot', 'alpha', {
    ...manager.skillSettings().global,
    combat: { enabled: true, priority: 92 },
    supply: { enabled: true, priority: 88 }
  });
  assert.equal(alphaResult.ok, true);
  const copyResult = manager.copySkills('alpha', ['beta']);
  assert.equal(copyResult.ok, true);
  assert.equal(manager.get('beta').effectiveSkillConfig().combat.priority, 92);
  assert.equal(manager.get('beta').effectiveSkillConfig().supply.enabled, true);

  const saved = JSON.parse(fs.readFileSync(config.botsPath, 'utf8'));
  assert.equal(saved.defaults.skills.mining.priority, 68);
  assert.equal(saved.bots.find((bot) => bot.id === 'alpha').skills.combat.enabled, true);
  assert.equal(saved.bots.find((bot) => bot.id === 'beta').skills.supply.priority, 88);
});

test('normalizes and persists fixed supply stations with beds and multiple container roles', (t) => {
  const config = createConfig();
  t.after(() => fs.rmSync(config.rootDir, { recursive: true, force: true }));
  const manager = new BotManager(config);
  manager.add({ id: 'miner', host: 'localhost', username: 'Miner', auth: 'offline', viewer: { enabled: false } });

  const result = manager.configureSupply('miner', [{
    id: 'main-base',
    name: '主补给站',
    dimension: 'minecraft:overworld',
    x: 10,
    y: 64,
    z: -5,
    bed: { x: 12, y: 64, z: -5 },
    priority: 20,
    containers: [
      { x: 9, y: 64, z: -5, role: 'storage' },
      { x: 8, y: 64, z: -5, role: 'pickup' }
    ]
  }]);

  assert.equal(result.ok, true);
  assert.equal(result.points[0].dimension, 'overworld');
  assert.deepEqual(result.points[0].bed, { x: 12, y: 64, z: -5 });
  assert.deepEqual(result.points[0].containers.map((container) => container.role), ['storage', 'pickup']);
  const saved = JSON.parse(fs.readFileSync(config.botsPath, 'utf8'));
  assert.equal(saved.bots[0].resupplyPoints[0].name, '主补给站');
  assert.equal(saved.bots[0].resupplyPoints[0].containers.length, 2);
});