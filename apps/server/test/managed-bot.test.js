const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { ManagedBot } = require('../src/core/managed-bot');

function createConfig() {
  return {
    botsPath: '',
    bots: [],
    defaults: { skills: {} }
  };
}

function createManagedBot() {
  return new ManagedBot(createConfig(), {
    id: 'miner',
    displayName: 'Miner',
    host: 'localhost',
    username: 'Miner',
    auth: 'offline',
    miningRegion: {
      bounds: { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 2 },
      mode: 'blacklist',
      allow: [],
      deny: []
    },
    resupplyPoints: [{ id: 'supply', name: '补给站', home: 'supply', roles: ['food', 'pickaxe'], containers: [] }]
  });
}

test('hydrates a stable mining Home and exposes all configured Homes', () => {
  const managedBot = createManagedBot();
  assert.equal(managedBot.regionPlan.home, '_mcbot_miner_mine');
  assert.equal(managedBot.regionPlan.anchor, null);
  assert.deepEqual(managedBot.knownHomes().map((home) => home.name), ['_mcbot_miner_mine', 'supply']);
  assert.equal(managedBot.knownHomes()[0].initialized, false);
  assert.equal(managedBot.knownHomes()[1].initialized, false);
});

test('region mining only selects blocks with a real exposed approach', () => {
  const managedBot = createManagedBot();
  const targetPosition = new Vec3(1, 1, 1);
  managedBot.bot = {
    blockAt(position) {
      const name = position.equals(targetPosition.plus(new Vec3(1, 0, 0))) ? 'air' : 'stone';
      return { name, position: position.clone(), boundingBox: name === 'air' ? 'empty' : 'block' };
    }
  };
  assert.equal(managedBot.isRegionCandidate({ name: 'stone', position: targetPosition }), true);

  managedBot.bot = {
    blockAt(position) {
      return { name: 'stone', position: position.clone(), boundingBox: 'block' };
    }
  };
  assert.equal(managedBot.isRegionCandidate({ name: 'stone', position: targetPosition }), false);
});
