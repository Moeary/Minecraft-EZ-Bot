const EventEmitter = require('node:events');
const { loadConfig } = require('../config/load-config');
const { ManagedBot } = require('./managed-bot');

class BotManager extends EventEmitter {
  constructor(config = loadConfig()) {
    super();
    this.config = config;
    this.bots = new Map();
    for (const definition of config.bots) {
      const runtime = new ManagedBot(config, definition);
      runtime.on('log', (entry) => this.emit('log', entry));
      runtime.on('state', (status) => this.emit('state', status));
      this.bots.set(definition.id, runtime);
    }
  }

  get(id) { return this.bots.get(id); }
  list() { return [...this.bots.values()].map((bot) => bot.publicStatus()); }

  start(id) {
    const bot = this.get(id);
    if (!bot) return { ok: false, message: `Unknown bot: ${id}` };
    bot.start();
    return { ok: true, message: `${bot.displayName} start requested.` };
  }

  stop(id) {
    const bot = this.get(id);
    if (!bot) return { ok: false, message: `Unknown bot: ${id}` };
    bot.stop();
    return { ok: true, message: `${bot.displayName} stopped.` };
  }

  execute(id, command, args = [], source = 'web') {
    const bot = this.get(id);
    if (!bot) return { ok: false, message: `Unknown bot: ${id}` };
    return bot.execute(command, args, { source, sender: source.toUpperCase() });
  }

  executeLine(id, line, source = 'web') {
    const tokens = String(line || '').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { ok: false, message: 'Command is empty.' };
    return this.execute(id, tokens.shift(), tokens, source);
  }

  startEnabled() {
    for (const bot of this.bots.values()) {
      if (bot.definition.enabled && this.config.web.autoStart.includes(bot.id)) bot.start();
    }
  }

  startAll() {
    for (const bot of this.bots.values()) {
      if (bot.definition.enabled) bot.start();
    }
  }

  stopAll() {
    for (const bot of this.bots.values()) bot.stop();
  }
}

module.exports = { BotManager };
