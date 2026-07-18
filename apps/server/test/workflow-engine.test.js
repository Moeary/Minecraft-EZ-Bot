const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkflowEngine } = require('../src/core/workflow-engine');

const definition = {
  id: 'safe-mine',
  name: 'Safe mine',
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'home', type: 'ensure_mining_home' },
    { id: 'pickaxe', type: 'has_usable_pickaxe' },
    { id: 'supply', type: 'resupply', params: { requirePickaxe: true } },
    { id: 'equip', type: 'equip', params: { role: 'pickaxe' } },
    { id: 'mine', type: 'start_region_mining' },
    { id: 'failed', type: 'end' },
    { id: 'end', type: 'end' }
  ],
  edges: [
    { source: 'start', target: 'home' },
    { source: 'home', target: 'pickaxe' },
    { source: 'pickaxe', target: 'equip', when: 'true' },
    { source: 'pickaxe', target: 'supply', when: 'false' },
    { source: 'supply', target: 'equip' },
    { source: 'supply', target: 'failed', when: 'error' },
    { source: 'equip', target: 'mine' },
    { source: 'mine', target: 'end' }
  ]
};

test('workflow branches through resupply when no usable pickaxe is carried', async () => {
  const calls = [];
  let hasPickaxe = false;
  const bot = {
    regionPlan: { home: '_mine' },
    ensureRegionAnchor: async () => calls.push('home'),
    hasUsablePickaxe: () => hasPickaxe,
    maybeResupply: async () => { calls.push('supply'); hasPickaxe = true; return { ok: true, message: 'ready' }; },
    equipRole: () => { calls.push('equip'); return { ok: true }; },
    startRegionMining: () => { calls.push('mine'); return { ok: true }; },
    log: () => {}
  };
  const result = await new WorkflowEngine([definition]).run(bot, 'safe-mine');
  assert.deepEqual(calls, ['home', 'supply', 'equip', 'mine']);
  assert.deepEqual(result.trace, ['start', 'home', 'pickaxe', 'supply', 'equip', 'mine', 'end']);
});

test('workflow uses error edge when resupply fails', async () => {
  const bot = {
    regionPlan: { home: '_mine' },
    ensureRegionAnchor: async () => {},
    hasUsablePickaxe: () => false,
    maybeResupply: async () => ({ ok: false, message: 'empty stock' }),
    equipRole: () => ({ ok: true }),
    startRegionMining: () => ({ ok: true }),
    log: () => {}
  };
  const result = await new WorkflowEngine([definition]).run(bot, 'safe-mine');
  assert.equal(result.trace.at(-1), 'failed');
  assert.equal(result.values.supply.message, 'empty stock');
});
