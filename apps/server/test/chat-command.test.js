const test = require('node:test');
const assert = require('node:assert/strict');
const { ManagedBot } = require('../src/core/managed-bot');

function createRuntime(whitelist = ['PlayerOne']) {
  const runtime = new ManagedBot({ whitelist, web: { allowRawCommands: false } }, {
    id: 'musashi',
    displayName: 'Musashi',
    username: 'account@example.invalid',
    host: 'localhost',
    viewer: { enabled: false }
  });
  runtime.bot = { username: 'Musashi_Chan' };
  runtime.state = 'online';
  runtime.log = () => {};
  return runtime;
}

test('accepts command-first chat syntax with the bot name last', () => {
  const runtime = createRuntime();
  let received;
  runtime.execute = (command, args, context) => { received = { command, args, context }; };

  runtime.handleChat('PlayerOne', 'come Musashi_Chan');

  assert.deepEqual(received, {
    command: 'come',
    args: [],
    context: { source: 'chat', sender: 'PlayerOne' }
  });
});

test('keeps target-first syntax and command arguments', () => {
  const runtime = createRuntime();
  let received;
  runtime.execute = (command, args, context) => { received = { command, args, context }; };

  runtime.handleChat('PlayerOne', 'Musashi_Chan kill on');

  assert.equal(received.command, 'kill');
  assert.deepEqual(received.args, ['on']);
});

test('supports all, optional bang prefix, and case-insensitive names', () => {
  const runtime = createRuntime(['playerone']);
  let received;
  runtime.execute = (command, args) => { received = { command, args }; };

  runtime.handleChat('PlayerOne', '!status ALL');

  assert.deepEqual(received, { command: 'status', args: [] });
});

test('ignores players outside the whitelist', () => {
  const runtime = createRuntime();
  let called = false;
  runtime.execute = () => { called = true; };

  runtime.handleChat('NotAllowed', 'come Musashi_Chan');

  assert.equal(called, false);
});
