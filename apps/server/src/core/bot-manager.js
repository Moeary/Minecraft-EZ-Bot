const EventEmitter = require('node:events');
const { ManagedBot } = require('./managed-bot');
const { loadConfig, normalizeBotDefinition, validateBotDefinitions } = require('../config/load-config');
const { saveBotsConfig, saveWhitelist } = require('../config/config-store');

class BotManager extends EventEmitter {
  constructor(config = loadConfig()) {
    super();
    this.config = config;
    this.bots = new Map();
    this.logs = [];
    for (const definition of config.bots) this.attachRuntime(definition);
  }

  attachRuntime(definition) {
    const runtime = new ManagedBot(this.config, definition);
    runtime.on('log', (entry) => {
      this.logs.push(entry);
      if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
      this.emit('log', entry);
    });
    runtime.on('state', (status) => this.emit('state', status));
    this.bots.set(definition.id, runtime);
    return runtime;
  }

  get(id) {
    if (this.bots.has(id)) return this.bots.get(id);
    const normalized = String(id || '').toLowerCase();
    return [...this.bots.values()].find((bot) => bot.id.toLowerCase() === normalized);
  }

  list() {
    return [...this.bots.values()].map((bot) => ({
      ...bot.publicStatus(),
      enabled: bot.definition.enabled,
      host: bot.definition.host,
      port: bot.definition.port,
      configuredUsername: bot.definition.username,
      version: bot.definition.version || null,
      auth: bot.definition.auth || null,
      viewer: { ...bot.definition.viewer },
      commandWhitelist: bot.definition.commandWhitelist ? [...bot.definition.commandWhitelist] : null
    }));
  }

  definitions() {
    return this.config.bots.map((bot) => ({
      id: bot.id,
      displayName: bot.displayName,
      skinUsername: bot.skinUsername || '',
      enabled: bot.enabled,
      host: bot.host,
      port: bot.port,
      username: bot.username,
      auth: bot.auth || 'microsoft',
      version: bot.version || '',
      viewer: { ...bot.viewer },
      commandWhitelist: bot.commandWhitelist ? [...bot.commandWhitelist] : null
    }));
  }

  allocateViewerPort(excludeId = null) {
    const used = new Set(this.config.bots
      .filter((bot) => bot.id !== excludeId && bot.viewer?.enabled)
      .map((bot) => bot.viewer.port));
    for (let port = this.config.web.viewerPortStart; port <= 65535; port += 1) {
      if (!used.has(port)) return port;
    }
    throw new Error('No free viewer port is available in the configured range.');
  }

  prepareDefinition(input, index = this.config.bots.length, excludeId = null) {
    const draft = {
      ...input,
      viewer: { ...(input.viewer || {}) }
    };
    if (draft.viewer.enabled && (draft.viewer.port === undefined || draft.viewer.port === '' || !Number.isInteger(Number(draft.viewer.port)))) {
      draft.viewer.port = this.allocateViewerPort(excludeId);
    } else if (draft.viewer.port !== undefined && draft.viewer.port !== '') {
      draft.viewer.port = Number(draft.viewer.port);
    }
    if (draft.port !== undefined) draft.port = Number(draft.port);
    return normalizeBotDefinition(draft, this.config.defaults, index);
  }

  add(input) {
    try {
      const definition = this.prepareDefinition(input);
      const next = [...this.config.bots, definition];
      validateBotDefinitions(next);
      saveBotsConfig(this.config, next);
      this.config.bots = next;
      this.attachRuntime(definition);
      return { ok: true, message: `${definition.displayName} added.`, bot: this.get(definition.id).publicStatus(), definition: this.definition(definition.id) };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  update(id, patch) {
    const runtime = this.get(id);
    if (!runtime) return { ok: false, message: `Unknown bot: ${id}` };
    if (runtime.state !== 'stopped') return { ok: false, message: 'Stop the bot before editing its configuration.' };
    if (patch.id && String(patch.id) !== runtime.id) return { ok: false, message: 'Bot id cannot be changed. Create a new bot instead.' };

    try {
      const current = runtime.definition;
      const definition = this.prepareDefinition({
        ...current,
        ...patch,
        id: current.id,
        viewer: { ...current.viewer, ...(patch.viewer || {}) }
      }, this.config.bots.indexOf(current), current.id);
      const next = this.config.bots.map((bot) => bot.id === current.id ? definition : bot);
      validateBotDefinitions(next);
      saveBotsConfig(this.config, next);
      runtime.removeAllListeners();
      this.bots.delete(current.id);
      this.config.bots = next;
      this.attachRuntime(definition);
      return { ok: true, message: `${definition.displayName} updated.`, definition: this.definition(definition.id) };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  remove(id) {
    const runtime = this.get(id);
    if (!runtime) return { ok: false, message: `Unknown bot: ${id}` };
    if (runtime.state !== 'stopped') return { ok: false, message: 'Stop the bot before deleting it.' };
    try {
      const next = this.config.bots.filter((bot) => bot.id !== runtime.id);
      this.config.web.autoStart = this.config.web.autoStart.filter((botId) => botId !== runtime.id);
      saveBotsConfig(this.config, next);
      runtime.removeAllListeners();
      this.bots.delete(runtime.id);
      this.config.bots = next;
      return { ok: true, message: `${runtime.displayName} removed. Authentication cache was kept.` };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  definition(id) {
    const runtime = this.get(id);
    if (!runtime) return null;
    return this.definitions().find((definition) => definition.id === runtime.id) || null;
  }

  start(id) {
    const bot = this.get(id);
    if (!bot) return { ok: false, message: `Unknown bot: ${id}` };
    if (!bot.definition.enabled) return { ok: false, message: `${bot.displayName} is disabled in its configuration.` };
    bot.start();
    return { ok: true, message: `${bot.displayName} start requested.` };
  }

  stop(id) {
    const bot = this.get(id);
    if (!bot) return { ok: false, message: `Unknown bot: ${id}` };
    bot.stop();
    return { ok: true, message: `${bot.displayName} stopped.` };
  }

  restart(id) {
    const stopped = this.stop(id);
    if (!stopped.ok) return stopped;
    return this.start(id);
  }

  setViewerPerspective(id, firstPerson) {
    const runtime = this.get(id);
    if (!runtime) return { ok: false, message: `Unknown bot: ${id}` };
    if (!runtime.definition.viewer?.enabled) return { ok: false, message: `${runtime.displayName} viewer is disabled.` };
    try {
      const next = this.config.bots.map((bot) => bot.id === runtime.id ? {
        ...bot,
        viewer: { ...bot.viewer, firstPerson: Boolean(firstPerson) }
      } : bot);
      saveBotsConfig(this.config, next);
      this.config.bots = next;
      runtime.definition = next.find((bot) => bot.id === runtime.id);
      if (runtime.state === 'online') {
        runtime.closeViewer();
        setTimeout(() => runtime.startViewer(), 300);
      }
      const label = firstPerson ? 'first-person' : 'third-person';
      return { ok: true, message: `${runtime.displayName} viewer switched to ${label}.`, firstPerson: Boolean(firstPerson) };
    } catch (error) {
      return { ok: false, message: error.message };
    }
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

  batch(action, ids = []) {
    const targets = ids.length ? ids : [...this.bots.keys()];
    const results = targets.map((id) => {
      if (action === 'start') return { id, ...this.start(id) };
      if (action === 'stop') return { id, ...this.stop(id) };
      if (action === 'restart') return { id, ...this.restart(id) };
      return { id, ok: false, message: `Unknown batch action: ${action}` };
    });
    const failed = results.filter((result) => !result.ok).length;
    return { ok: failed === 0, message: failed ? `${results.length - failed} succeeded, ${failed} failed.` : `${results.length} bot operation(s) completed.`, results };
  }

  recentLogs(botId = null, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    return this.logs.filter((entry) => !botId || entry.botId === botId).slice(-safeLimit);
  }

  setWhitelist(names, botId = null) {
    if (!Array.isArray(names)) return { ok: false, message: 'Whitelist must be an array of player names.' };
    const seen = new Set();
    const whitelist = [];
    for (const value of names) {
      const name = String(value).trim();
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        whitelist.push(name);
      }
    }
    try {
      if (botId) {
        const runtime = this.get(botId);
        if (!runtime) return { ok: false, message: `Unknown bot: ${botId}` };
        if (runtime.state !== 'stopped') return { ok: false, message: 'Stop the bot before changing its whitelist.' };
        const next = this.config.bots.map((bot) => bot.id === runtime.id ? { ...bot, commandWhitelist: whitelist } : bot);
        saveBotsConfig(this.config, next);
        this.config.bots = next;
        runtime.definition = next.find((bot) => bot.id === runtime.id);
        return { ok: true, message: `${runtime.displayName} whitelist saved.`, whitelist };
      }
      saveWhitelist(this.config, whitelist);
      this.config.whitelist = whitelist;
      return { ok: true, message: 'Global whitelist saved.', whitelist };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  startEnabled() {
    for (const bot of this.bots.values()) {
      if (bot.definition.enabled && this.config.web.autoStart.includes(bot.id)) bot.start();
    }
  }

  startAll() {
    return this.batch('start');
  }

  stopAll() {
    return this.batch('stop');
  }
}

module.exports = { BotManager };

