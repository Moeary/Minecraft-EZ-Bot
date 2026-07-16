const readline = require('node:readline');
const { loadConfig } = require('./config/load-config');
const { BotManager } = require('./core/bot-manager');
const { startWebServer } = require('./web/server');

function printHelp(mode = 'single') {
  console.log('Commands: fish | kill on/off | stop | status | home <name> | sethome <name> | come <player> | follow <player> | cmd /<command>');
  if (mode === 'all') console.log('Multi-bot console syntax: <botId> <command> or all <command>');
}

function attachConsole(manager, selectedId) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (line) => {
    const input = line.trim();
    if (!input) return;
    if (input === 'help') return printHelp(selectedId ? 'single' : 'all');
    if (input === 'list') return console.table(manager.list().map(({ id, displayName, state, username }) => ({ id, displayName, state, username })));

    if (selectedId) {
      const result = manager.executeLine(selectedId, input, 'console');
      return console.log(result.message || result);
    }

    const tokens = input.split(/\s+/);
    const target = tokens.shift();
    const command = tokens.join(' ');
    if (target === 'all') {
      for (const bot of manager.bots.values()) console.log(bot.id, manager.executeLine(bot.id, command, 'console').message);
      return;
    }
    const result = manager.executeLine(target, command, 'console');
    console.log(result.message || result);
  });
  return rl;
}

function main() {
  let config;
  try { config = loadConfig(); } catch (error) { console.error(error.message); process.exit(1); }
  const manager = new BotManager(config);
  manager.on('log', (entry) => { if (entry.message.startsWith('[CHAT]')) console.log(`[${entry.botId}] ${entry.message}`); });
  const [mode, requestedId] = process.argv.slice(2);

  if (mode === 'web') {
    const server = startWebServer(manager);
    manager.startEnabled();
    const shutdown = () => { manager.stopAll(); server.close(() => process.exit(0)); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  if (mode === 'run') {
    const id = requestedId || config.bots[0]?.id;
    if (!id || !manager.get(id)) {
      console.error(`Unknown bot: ${id || '(missing)'}`);
      console.error(`Available bots: ${[...manager.bots.keys()].join(', ')}`);
      process.exit(1);
    }
    manager.start(id);
    attachConsole(manager, id);
    return;
  }

  if (mode === 'run-all') {
    manager.startAll();
    attachConsole(manager, null);
    return;
  }

  console.log('Usage:');
  console.log('  node apps/server/src/cli.js run <botId>');
  console.log('  node apps/server/src/cli.js run-all');
  console.log('  node apps/server/src/cli.js web');
  printHelp('all');
}

main();
