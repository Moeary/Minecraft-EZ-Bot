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

function normalizeBotDefinition(bot, defaults = {}, index = 0) {
  if (!bot || !bot.id || !bot.host || !bot.username) {
    throw new Error(`Bot at index ${index} needs id, host, and username.`);
  }

  const definition = {
    ...defaults,
    ...bot,
    id: String(bot.id).trim(),
    displayName: String(bot.displayName || bot.id).trim(),
    skinUsername: String(bot.skinUsername || '').trim() || null,
    enabled: bot.enabled !== false,
    port: Number(bot.port || 25565),
    viewer: {
      enabled: false,
      viewDistance: 6,
      firstPerson: false,
      ...(bot.viewer || {})
    },
    commandWhitelist: Array.isArray(bot.commandWhitelist) ? [...new Set(bot.commandWhitelist.map((name) => String(name).trim()).filter(Boolean))] : null,
    resupplyPoints: Array.isArray(bot.resupplyPoints) ? bot.resupplyPoints.map((point) => ({ x: Number(point.x), y: Number(point.y), z: Number(point.z) })).filter((point) => [point.x, point.y, point.z].every(Number.isFinite)) : []
  };

  if (!definition.id) throw new Error(`Bot at index ${index} needs a non-empty id.`);
  if (!Number.isInteger(definition.port) || definition.port < 1 || definition.port > 65535) {
    throw new Error(`Bot ${definition.id} needs a valid Minecraft server port.`);
  }
  if (definition.viewer.enabled && (!Number.isInteger(definition.viewer.port) || definition.viewer.port < 1 || definition.viewer.port > 65535)) {
    throw new Error(`Bot ${definition.id} needs a valid viewer port.`);
  }
  return definition;
}

function validateBotDefinitions(bots) {
  const ids = new Set();
  const viewerPorts = new Set();
  for (const bot of bots) {
    const idKey = bot.id.toLowerCase();
    if (ids.has(idKey)) throw new Error(`Duplicate bot id: ${bot.id}`);
    ids.add(idKey);
    if (bot.viewer.enabled) {
      if (viewerPorts.has(bot.viewer.port)) throw new Error(`Duplicate viewer port: ${bot.viewer.port}`);
      viewerPorts.add(bot.viewer.port);
    }
  }
  return bots;
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

  const bots = validateBotDefinitions(raw.bots.map((bot, index) => normalizeBotDefinition(bot, defaults, index)));
  const ids = new Set(bots.map((bot) => bot.id));
  const web = {
    host: '127.0.0.1',
    port: 3000,
    viewerPortStart: 3101,
    autoStart: [],
    allowRawCommands: false,
    ...(raw.web || {})
  };
  if (!Number.isInteger(web.port) || web.port < 1 || web.port > 65535) throw new Error('web.port must be a valid port.');
  if (!Number.isInteger(web.viewerPortStart) || web.viewerPortStart < 1 || web.viewerPortStart > 65535) throw new Error('web.viewerPortStart must be a valid port.');
  if (!Array.isArray(web.autoStart)) throw new Error('web.autoStart must be an array of bot ids.');
  const missingAutoStart = web.autoStart.filter((id) => !ids.has(id));
  if (missingAutoStart.length) throw new Error(`Unknown bot ids in web.autoStart: ${missingAutoStart.join(', ')}`);

  return {
    rootDir: ROOT_DIR,
    configDir: CONFIG_DIR,
    dataDir: DATA_DIR,
    botsPath,
    whitelistPath,
    defaults,
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

module.exports = {
  loadConfig,
  authCachePath,
  normalizeBotDefinition,
  validateBotDefinitions,
  readJson,
  ROOT_DIR
};

