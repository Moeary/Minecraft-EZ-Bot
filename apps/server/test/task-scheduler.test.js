const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskScheduler } = require('../src/core/task-scheduler');

test('scheduler reads per-skill priorities and runs queued work by priority', async () => {
  const scheduler = new TaskScheduler({
    mining: { enabled: true, priority: 40 },
    supply: { enabled: true, priority: 95 },
    fishing: { enabled: true, priority: 15 }
  });
  const releaseMining = await scheduler.acquire('mining');
  const order = [];
  const fishing = scheduler.acquire('fishing').then((release) => {
    order.push('fishing');
    return release;
  });
  const supply = scheduler.acquire('supply').then((release) => {
    order.push('supply');
    return release;
  });

  assert.equal(scheduler.status().active, 'mining');
  assert.equal(scheduler.priority('supply'), 95);
  releaseMining();
  const releaseSupply = await supply;
  assert.deepEqual(order, ['supply']);
  assert.equal(scheduler.status().active, 'supply');
  releaseSupply();
  const releaseFishing = await fishing;
  assert.deepEqual(order, ['supply', 'fishing']);
  releaseFishing();
  assert.equal(scheduler.status().active, null);
});

test('scheduler supports reentrant work without releasing the task early', async () => {
  const scheduler = new TaskScheduler();
  const firstRelease = await scheduler.acquire('mining');
  const nestedRelease = await scheduler.acquire('mining');
  const supply = scheduler.acquire('supply');

  firstRelease();
  assert.equal(scheduler.status().active, 'mining');
  nestedRelease();
  const releaseSupply = await supply;
  assert.equal(scheduler.status().active, 'supply');
  releaseSupply();
});