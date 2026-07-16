const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const DATA_DIR = path.join(ROOT_DIR, 'data');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function loadConfig() {
  const botsPath = process.env.MCBOT_BOTS_CONFIG || path.join(CONFIG_DIR, 'bots.local.json');
  const whitelistPath = process.env.MCBOT_WHITELIST_CONFIG || path.join(CONFIG_DIR, 'whitelist.local.json');
  const raw = readJson(botsPath, readJson(path.join(CONFIG_DIR, 'bots.example.json'), { bots: [] }));
  const whitelist = readJson(whitelistPath, readJson(path.join(CONFIG_DIR, 'whitelist.example.json'), []));

  if (!Array.isArray(raw.bots)) throw new Error('Config must contain a bots array.');
  if (!Array.isArray(whitelist)) throw new Error('Whitelist config must be a JSON array.');

  const defaults = {
    checkTimeoutInterval: 60000,
    viewDistance: 'tiny',
    reconnectDelayMs: 30000,
    authReconnectDelayMs: 60000,
    targetMobs: ['zombified_piglin', 'wither_skeleton', 'zombie', 'skeleton', 'spider', 'creeper'],
    ...(raw.defaults || {})
  };

  const bots = raw.bots.map((bot, index) => {
    if (!bot.id || !bot.host || !bot.username) throw new Error(`Bot at index ${index} needs id, host, and username.`);
    const definition = {
      ...defaults,
      ...bot,
      id: String(bot.id),
      displayName: String(bot.displayName || bot.id),
      enabled: bot.enabled !== false,
      viewer: {
        enabled: false,
        viewDistance: 6,
        firstPerson: false,
        ...(bot.viewer || {})
      }
    };
    if (definition.viewer.enabled && (!Number.isInteger(definition.viewer.port) || definition.viewer.port < 1 || definition.viewer.port > 65535)) {
      throw new Error(`Bot ${definition.id} needs a valid viewer port.`);
    }
    return definition;
  });

  const ids = new Set();
  const viewerPorts = new Set();
  for (const bot of bots) {
    if (ids.has(bot.id)) throw new Error(`Duplicate bot id: ${bot.id}`);
    ids.add(bot.id);
    if (bot.viewer.enabled) {
      if (viewerPorts.has(bot.viewer.port)) throw new Error(`Duplicate viewer port: ${bot.viewer.port}`);
      viewerPorts.add(bot.viewer.port);
    }
  }

  const web = {
    host: '127.0.0.1',
    port: 3000,
    autoStart: [],
    allowRawCommands: false,
    ...(raw.web || {})
  };
  if (!Array.isArray(web.autoStart)) throw new Error('web.autoStart must be an array of bot ids.');
  const missingAutoStart = web.autoStart.filter((id) => !ids.has(id));
  if (missingAutoStart.length) throw new Error(`Unknown bot ids in web.autoStart: ${missingAutoStart.join(', ')}`);

  return {
    rootDir: ROOT_DIR,
    configDir: CONFIG_DIR,
    dataDir: DATA_DIR,
    botsPath,
    whitelistPath,
    web,
    bots,
    whitelist: whitelist.map(String)
  };
}

function authCachePath(config, botId) {
  const target = path.join(config.dataDir, 'auth', botId);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

module.exports = { loadConfig, authCachePath, ROOT_DIR };
