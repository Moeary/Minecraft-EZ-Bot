const EventEmitter = require('node:events');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat').plugin;
const pvp = require('mineflayer-pvp').plugin;
const mineflayerViewer = require('prismarine-viewer').mineflayer;
const minecraftData = require('minecraft-data');
const { Vec3 } = require('vec3');
const { authCachePath } = require('../config/load-config');
const { saveBotsConfig } = require('../config/config-store');

const MAX_REGION_VOLUME = 32768;
const REGION_FLUIDS = new Set(['water', 'lava', 'flowing_water', 'flowing_lava']);
const REGION_CONTAINER_NAMES = new Set([
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'hopper', 'dispenser', 'dropper',
  'furnace', 'blast_furnace', 'smoker', 'brewing_stand', 'spawner', 'trial_spawner', 'vault', 'crafter', 'decorated_pot', 'chiseled_bookshelf', 'shulker_box'
]);
const REGION_PROTECTED_NAMES = new Set([
  'air', 'cave_air', 'void_air', 'bedrock', 'end_portal', 'end_portal_frame', 'nether_portal',
  'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block',
  'jigsaw', 'barrier', 'light', 'reinforced_deepslate', 'respawn_anchor', 'beacon', 'conduit',
  'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil', 'jukebox', 'note_block',
  'crafting_table', 'white_bed', 'orange_bed', 'magenta_bed', 'light_blue_bed', 'yellow_bed',
  'lime_bed', 'pink_bed', 'gray_bed', 'light_gray_bed', 'cyan_bed', 'purple_bed', 'blue_bed',
  'brown_bed', 'green_bed', 'red_bed', 'black_bed', 'bed'
]);
const REGION_ALIASES = {
  containers: [...REGION_CONTAINER_NAMES],
  fluids: [...REGION_FLUIDS],
  utility: [...REGION_CONTAINER_NAMES, 'crafting_table', 'enchanting_table', 'anvil', 'beacon'],
  beds: [...REGION_PROTECTED_NAMES].filter((name) => name.endsWith('_bed') || name === 'bed')
};
const PLUG_BLOCK_NAMES = ['cobblestone', 'stone', 'deepslate', 'dirt', 'netherrack'];

function cleanBlockName(name) {
  return String(name || '').toLowerCase().replace(/^minecraft:/, '').trim();
}

function isRegionContainerName(name) {
  const normalized = cleanBlockName(name);
  return REGION_CONTAINER_NAMES.has(normalized) || normalized.endsWith('_shulker_box');
}

function isRegionProtectedName(name) {
  const normalized = cleanBlockName(name);
  return REGION_PROTECTED_NAMES.has(normalized) || isRegionContainerName(normalized);
}

class ManagedBot extends EventEmitter {
  constructor(config, botConfig, skinCache = null) {
    super();
    this.config = config;
    this.definition = botConfig;
    this.skinCache = skinCache;
    this.bot = null;
    this.state = 'stopped';
    this.lastError = null;
    this.lastReason = null;
    this.reconnectTimer = null;
    this.attackTimer = null;
    this.fishingTimer = null;
    this.miningTimer = null;
    this.supplyTimer = null;
    this.resourceTimer = null;
    this.regionTimer = null;
    this.maintenanceTimer = null;
    this.killAuraEnabled = false;
    this.fishing = false;
    this.mining = false;
    this.supply = false;
    this.miningTarget = null;
    this.regionPlan = this.hydrateRegionPlan(botConfig.miningRegion);
    this.regionMining = false;
    this.regionSeals = [];
    this.sleepEnabled = false;
    this.resupplyEnabled = false;
    this.resupplyBusy = false;
    this.maintenanceBusy = false;
    this.digging = false;
    this.navigationLock = Promise.resolve();
    this.resupplyPoints = Array.isArray(botConfig.resupplyPoints) ? botConfig.resupplyPoints.map((point) => ({ x: Number(point.x), y: Number(point.y), z: Number(point.z) })).filter((point) => [point.x, point.y, point.z].every(Number.isFinite)) : [];
    this.supplyRole = 'auto';
    this.chatLogEnabled = false;
    this.viewerStarted = false;
    this.alertLastSent = new Map();
    this.activeAlerts = new Set();
  }

  log(message, level = 'info') {
    const entry = { at: new Date().toISOString(), level, botId: this.id, message };
    this.emit('log', entry);
    if (level === 'error') console.error(`[${this.displayName}] ${message}`);
    else console.log(`[${this.displayName}] ${message}`);
  }

  get id() { return this.definition.id; }
  get displayName() { return this.definition.displayName; }

  start() {
    if (this.state === 'connecting' || this.state === 'online' || this.state === 'reconnecting') return;
    this.clearReconnect();
    this.desiredRunning = true;
    this.createBot();
  }

  stop() {
    this.desiredRunning = false;
    this.clearReconnect();
    this.clearRuntimeLoops();
    this.closeViewer();
    const current = this.bot;
    this.bot = null;
    if (current) {
      current.removeAllListeners();
      try { current.quit('Stopped by operator'); } catch (_) {}
    }
    this.setState('stopped');
  }

  createBot() {
    this.setState('connecting');
    this.lastError = null;
    const options = {
      checkTimeoutInterval: this.definition.checkTimeoutInterval,
      viewDistance: this.definition.viewDistance,
      profilesFolder: authCachePath(this.config, this.id),
      ...this.definition
    };
    delete options.id;
    delete options.displayName;
    delete options.enabled;
    delete options.viewer;
    delete options.reconnectDelayMs;
    delete options.authReconnectDelayMs;
    delete options.targetMobs;
    delete options.skinUsername;
    delete options.commandWhitelist;
    delete options.resupplyPoints;
    delete options.miningRegion;
    if (options.auth === 'microsoft') {
      options.onMsaCode = (data) => {
        const verification = data.verification_uri || data.verificationUri || 'https://www.microsoft.com/link';
        const code = data.user_code || data.userCode || '(missing code)';
        this.log(`Microsoft sign-in required: open ${verification} and enter code ${code}.`, 'warn');
      };
    }

    let bot;
    try {
      bot = mineflayer.createBot(options);
      bot.loadPlugin(pathfinder);
      bot.loadPlugin(autoEat);
      bot.loadPlugin(pvp);
      this.bot = bot;
    } catch (error) {
      this.lastError = error.message;
      this.log(`Failed to create bot: ${error.message}`, 'error');
      this.scheduleReconnect('create_error');
      return;
    }

    bot.on('login', () => {
      this.log(`${bot.username || this.displayName} logged in.`);
      if (this.skinCache && bot.username) {
        this.skinCache.ensure(this.id, bot.username, true).then((status) => {
          if (status.cached) this.log(`Player skin cached for ${status.username}.`);
        }).catch((error) => this.log(`Player skin cache failed: ${error.message}`, 'warn'));
      }
    });

    bot.on('spawn', () => {
      if (this.bot !== bot) return;
      bot.autoEat.options = {
        priority: 'foodPoints',
        startAt: 14,
        bannedFood: ['rotten_flesh', 'spider_eye']
      };
      bot.autoEat.disable();
      this.setState('online');
      this.startViewer();
      this.startAttackLoop();
      this.startResourceMonitor();
      if (this.sleepEnabled || this.resupplyEnabled) this.startMaintenanceLoop();
      this.log('Ready for commands.');
    });

    bot.on('chat', (username, message) => this.handleChat(username, message));
    bot.on('health', () => this.checkResourceAlerts());

    bot.on('end', (reason) => {
      if (this.bot !== bot) return;
      this.closeViewer();
      this.clearRuntimeLoops();
      this.bot = null;
      this.lastReason = String(reason || 'connection closed');
      this.log(`Disconnected: ${this.lastReason}`, 'warn');
      if (this.desiredRunning) this.scheduleReconnect('end');
      else this.setState('stopped');
    });

    bot.on('error', (error) => {
      if (this.bot !== bot) return;
      this.lastError = error.message;
      this.log(error.message, 'error');
      const text = error.message.toLowerCase();
      if (text.includes('auth') || text.includes('obtain profile data')) this.scheduleReconnect('auth_error');
      else if (error.code === 'ECONNRESET') this.scheduleReconnect('network_error');
    });
  }

  scheduleReconnect(type) {
    if (!this.desiredRunning || this.reconnectTimer) return;
    const delay = type === 'auth_error' ? this.definition.authReconnectDelayMs : this.definition.reconnectDelayMs;
    this.setState('reconnecting');
    this.log(`Reconnect scheduled in ${Math.round(delay / 1000)}s (${type}).`, 'warn');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.desiredRunning) return;
      const stale = this.bot;
      if (stale) {
        this.closeViewer();
        this.clearRuntimeLoops();
        this.bot = null;
        stale.removeAllListeners();
        try { stale.quit('Reconnecting'); } catch (_) {}
      }
      this.createBot();
    }, delay);
  }

  clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  setState(state) {
    this.state = state;
    this.emit('state', this.publicStatus());
  }

  startViewer() {
    const viewer = this.definition.viewer;
    if (!viewer?.enabled || this.viewerStarted || !this.bot?.entity) return;
    try {
      mineflayerViewer(this.bot, {
        port: viewer.port,
        viewDistance: viewer.viewDistance,
        firstPerson: viewer.firstPerson
      });
      this.viewerStarted = true;
      this.log(`${viewer.firstPerson ? 'First' : 'Third'}-person viewer listening on port ${viewer.port}.`);
    } catch (error) {
      this.log(`Viewer failed to start: ${error.message}`, 'error');
    }
  }

  closeViewer() {
    if (this.bot?.viewer?.close) {
      try { this.bot.viewer.close(); } catch (_) {}
    }
    this.viewerStarted = false;
    this.alertLastSent = new Map();
    this.activeAlerts = new Set();
  }

  startAttackLoop() {
    if (this.attackTimer) return;
    this.attackTimer = setInterval(() => {
      if (this.killAuraEnabled) this.stationaryAttack();
    }, 650);
  }

  clearRuntimeLoops() {
    if (this.attackTimer) clearInterval(this.attackTimer);
    this.attackTimer = null;
    if (this.fishingTimer) clearTimeout(this.fishingTimer);
    this.fishingTimer = null;
    if (this.miningTimer) clearTimeout(this.miningTimer);
    this.miningTimer = null;
    if (this.supplyTimer) clearTimeout(this.supplyTimer);
    this.supplyTimer = null;
    if (this.resourceTimer) clearTimeout(this.resourceTimer);
    this.resourceTimer = null;
    if (this.regionTimer) clearTimeout(this.regionTimer);
    this.regionTimer = null;
    if (this.maintenanceTimer) clearTimeout(this.maintenanceTimer);
    this.maintenanceTimer = null;
    this.fishing = false;
    this.mining = false;
    this.supply = false;
    this.regionMining = false;
    this.digging = false;
    if (this.regionPlan) this.regionPlan.active = false;
    this.miningTarget = null;
    if (this.bot?.autoEat?.disable) this.bot.autoEat.disable();
  }

  handleChat(username, message) {
    if (!this.bot || String(username).toLowerCase() === String(this.bot.username).toLowerCase()) return;
    if (this.chatLogEnabled) this.log(`[CHAT] <${username}> ${message}`);
    const whitelist = Array.isArray(this.definition.commandWhitelist) ? this.definition.commandWhitelist : this.config.whitelist;
    const allowed = whitelist.some((name) => name.toLowerCase() === String(username).toLowerCase());
    if (!allowed) return;

    const parsed = this.parseChatCommand(message);
    if (!parsed) return;
    this.log(`Accepted chat command from ${username}: ${parsed.command} ${parsed.args.join(' ')}`.trim());
    this.execute(parsed.command, parsed.args, { source: 'chat', sender: username });
  }

  parseChatCommand(message) {
    const tokens = String(message || '').trim().replace(/^!/, '').split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;

    if (this.isTarget(tokens[0])) {
      return { command: tokens[1], args: tokens.slice(2) };
    }

    const knownCommands = new Set(['help', 'come', 'tpa', 'sethome', 'home', 'cmd', 'kill', 'attack', 'status', 'info', 'follow', 'stop', 'fish', 'mine', 'gather', 'supply', 'restock', 'equip', 'area', 'region', 'minearea', 'sleep', 'resupply', 'unseal', 'look']);
    if (knownCommands.has(tokens[0].toLowerCase()) && this.isTarget(tokens[tokens.length - 1])) {
      return { command: tokens[0], args: tokens.slice(1, -1) };
    }
    return null;
  }

  isTarget(target) {
    const normalized = String(target || '').toLowerCase();
    const aliases = [this.id, this.displayName, this.bot?.username].filter(Boolean).map((value) => String(value).toLowerCase());
    return normalized === 'all' || aliases.includes(normalized);
  }

  execute(command, args = [], context = { source: 'console', sender: 'CONSOLE' }) {
    const bot = this.bot;
    const normalized = String(command || '').toLowerCase();
    if (normalized === 'help') return { ok: true, message: this.helpText() };
    if (!bot || this.state !== 'online') return { ok: false, message: `${this.displayName} is not online.` };

    if (normalized === 'come' || normalized === 'tpa') {
      const recipient = context.source === 'chat' ? context.sender : args[0];
      if (!recipient) return { ok: false, message: 'Usage: come <PlayerName>' };
      return this.sendChat(`/tpa ${recipient}`);
    }
    if (normalized === 'sethome' || normalized === 'home') {
      const home = args[0] || '';
      return this.sendChat(`/${normalized} ${home}`.trim());
    }
    if (normalized === 'cmd') {
      if (context.source === 'web' && !this.config.web.allowRawCommands) {
        return { ok: false, message: 'Raw commands are disabled for Web UI. Enable web.allowRawCommands in local config.' };
      }
      const raw = args.join(' ');
      if (!raw) return { ok: false, message: 'Usage: cmd /<minecraft command>' };
      return this.sendChat(raw.startsWith('/') ? raw : `/${raw}`);
    }
    if (normalized === 'kill' || normalized === 'attack') {
      const state = String(args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(state)) return { ok: false, message: 'Usage: kill on|off' };
      this.killAuraEnabled = state === 'on';
      if (!this.killAuraEnabled) bot.pvp.stop();
      return this.respond(`[${bot.username}] Kill Aura: ${state.toUpperCase()}`);
    }
    if (normalized === 'status' || normalized === 'info') {
      if (args[0] === 'on') this.chatLogEnabled = true;
      if (args[0] === 'off') this.chatLogEnabled = false;
      if (args[0] === 'on' || args[0] === 'off') return this.respond(`Chat log ${args[0]}.`);
      const message = this.statusMessage();
      if (context.source === 'chat') this.sendChat(message);
      return { ok: true, message, status: this.publicStatus() };
    }
    if (normalized === 'follow') {
      const targetName = context.source === 'chat' ? context.sender : args[0];
      if (!targetName) return { ok: false, message: 'Usage: follow <PlayerName>' };
      const player = bot.players[targetName];
      if (!player?.entity) return this.respond(`[${bot.username}] I cannot see ${targetName}.`);
      const movements = new Movements(bot, minecraftData(bot.version));
      movements.canDig = false;
      bot.pathfinder.setMovements(movements);
      bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
      return this.respond(`[${bot.username}] Following ${targetName}.`);
    }
    if (normalized === 'stop') {
      bot.pathfinder.setGoal(null);
      bot.pvp.stop();
      this.clearRuntimeLoops();
      return this.respond(`[${bot.username}] Stopped all active skills.`);
    }
    if (normalized === 'fish') return this.startFishing();
    if (normalized === 'mine' || normalized === 'gather') return this.startMining(args);
    if (normalized === 'supply' || normalized === 'restock') return this.setSupply(args[0]);
    if (normalized === 'equip') return this.equipRole(args[0] || 'auto');
    if (normalized === 'area' || normalized === 'region' || normalized === 'minearea') return this.executeRegionCommand(args);
    if (normalized === 'sleep') return this.setSleepMode(args[0]);
    if (normalized === 'resupply') return this.executeResupplyCommand(args);
    if (normalized === 'unseal') return this.unsealFluids();
    if (normalized === 'look') return this.lookCommand(args);
    return { ok: false, message: `Unknown command: ${normalized}` };
  }

  sendChat(message) {
    this.bot.chat(message);
    return { ok: true, message };
  }

  respond(message) {
    this.bot.chat(message);
    return { ok: true, message };
  }

  statusMessage() {
    const status = this.publicStatus();
    const inventory = status.inventory.length ? status.inventory.map((item) => `${item.name} x${item.count}`).join(', ') : 'Empty';
    const nearby = status.nearbyPlayers.length ? ` | Nearby: ${status.nearbyPlayers.join(', ')}` : '';
    return `[${status.username || this.displayName}] HP:${status.health ?? '-'} Food:${status.food ?? '-'} Kill:${this.killAuraEnabled ? 'ON' : 'OFF'} | Inv: ${inventory}${nearby}`;
  }

  startFishing() {
    if (this.fishing) return this.respond("I'm already fishing!");
    const bot = this.bot;
    const rod = bot.inventory.items().find((item) => item.name.includes('fishing_rod'));
    if (!rod) return this.respond(`[${bot.username}] No fishing rod in inventory.`);
    const boat = bot.nearestEntity((entity) => entity.name?.toLowerCase().includes('boat') && entity.position.distanceTo(bot.entity.position) < 5);
    this.fishing = true;
    Promise.resolve()
      .then(async () => {
        if (boat && bot.vehicle !== boat) await bot.mount(boat);
        await bot.equip(rod, 'hand');
        this.respond('Started fishing...');
        this.fishingLoop();
      })
      .catch((error) => {
        this.fishing = false;
        this.respond(`Fishing setup error: ${error.message}`);
      });
    return { ok: true, message: 'Fishing started.' };
  }

  async fishingLoop() {
    if (!this.fishing || !this.bot) return;
    try {
      await this.bot.fish();
      if (this.fishing) this.fishingTimer = setTimeout(() => this.fishingLoop(), 500);
    } catch (error) {
      this.log(`Fishing loop: ${error.message}`, 'warn');
      if (this.fishing) this.fishingTimer = setTimeout(() => this.fishingLoop(), 2000);
    }
  }


  resolveMiningTarget(name) {
    const aliases = {
      ores: ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore'],
      stone: ['stone', 'deepslate'],
      logs: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'],
      wood: ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'],
      coal: ['coal_ore', 'deepslate_coal_ore'],
      iron: ['iron_ore', 'deepslate_iron_ore'],
      copper: ['copper_ore', 'deepslate_copper_ore'],
      diamond: ['diamond_ore', 'deepslate_diamond_ore']
    };
    const names = aliases[String(name || 'ores').toLowerCase()] || [String(name || 'ores').toLowerCase()];
    const data = minecraftData(this.bot.version);
    const ids = names.map((blockName) => data.blocksByName[blockName]?.id).filter(Boolean);
    return { names, ids };
  }

  startMining(args = []) {
    if (this.regionMining) return this.respond(`[${this.bot.username}] Region mining is active; stop it before starting targeted mining.`);
    if (this.mining) return this.respond(`[${this.bot.username}] Mining is already running.`);
    const target = this.resolveMiningTarget(args[0] || 'ores');
    if (!target.ids.length) return this.respond(`[${this.bot.username}] Unknown block target: ${args[0] || 'ores'}.`);
    const requested = Number.parseInt(args[1] || '0', 10);
    this.miningTarget = { names: target.names, ids: target.ids, remaining: Number.isFinite(requested) && requested > 0 ? Math.min(requested, 128) : null, mined: 0 };
    this.mining = true;
    this.log(`Mining started: ${target.names.join(', ')}${this.miningTarget.remaining ? ` ×${this.miningTarget.remaining}` : ' until stopped'}.`);
    this.respond(`[${this.bot.username}] Mining ${target.names[0]}${this.miningTarget.remaining ? ` ×${this.miningTarget.remaining}` : ''}.`);
    this.miningLoop();
    return { ok: true, message: 'Mining started.' };
  }

  async miningLoop() {
    if (!this.mining || !this.bot?.entity || !this.miningTarget) return;
    const bot = this.bot;
    try {
      if (this.miningTarget.remaining !== null && this.miningTarget.mined >= this.miningTarget.remaining) {
        this.mining = false;
        this.log(`Mining finished: ${this.miningTarget.mined} block(s).`);
        this.respond(`[${bot.username}] Mining finished: ${this.miningTarget.mined} block(s).`);
        return;
      }
      const positions = bot.findBlocks({ matching: this.miningTarget.ids, maxDistance: 32, count: 1 });
      if (!positions.length) {
        this.mining = false;
        this.log('Mining paused: no matching blocks within 32 blocks.', 'warn');
        this.respond(`[${bot.username}] No matching blocks nearby; mining paused.`);
        return;
      }
      const block = bot.blockAt(positions[0]);
      if (!block) throw new Error('Target block is not loaded.');
      await this.moveToBlock(block);
      const current = bot.blockAt(block.position);
      if (!current || !bot.canDigBlock(current)) throw new Error('Target block is not diggable from the current position.');
      const toolReady = await this.prepareHarvestTool(current, 'Targeted mining');
      if (!toolReady) {
        this.mining = false;
        return;
      }
      this.digging = true;
      await bot.lookAt(current.position.offset(0.5, 0.5, 0.5));
      await bot.dig(current, true, 'raycast');
      this.digging = false;
      if (!this.mining || !this.miningTarget) return;
      this.miningTarget.mined += 1;
      this.miningTimer = setTimeout(() => this.miningLoop(), 250);
    } catch (error) {
      this.digging = false;
      this.log(`Mining cycle failed: ${error.message}`, 'warn');
      if (this.mining) this.miningTimer = setTimeout(() => this.miningLoop(), 1800);
    }
  }

  expandRegionBlockNames(values = []) {
    const data = minecraftData(this.bot.version);
    const names = [];
    for (const value of values) {
      const key = cleanBlockName(value);
      const expanded = REGION_ALIASES[key] || [key];
      for (const name of expanded) {
        if (data.blocksByName[name] || isRegionProtectedName(name) || REGION_FLUIDS.has(name)) {
          names.push(name);
        }
      }
    }
    return [...new Set(names)];
  }

  defaultRegionDeny() {
    return [...new Set([...REGION_PROTECTED_NAMES, ...REGION_FLUIDS, ...REGION_CONTAINER_NAMES, 'shulker_box'])];
  }

  hydrateRegionPlan(input) {
    if (!input?.bounds) return null;
    const bounds = input.bounds;
    const values = [bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ].map(Number);
    if (values.some((value) => !Number.isInteger(value))) return null;
    const [minX, minY, minZ, maxX, maxY, maxZ] = values;
    const normalizedBounds = {
      minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX),
      minY: Math.min(minY, maxY), maxY: Math.max(minY, maxY),
      minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ)
    };
    const volume = (normalizedBounds.maxX - normalizedBounds.minX + 1) * (normalizedBounds.maxY - normalizedBounds.minY + 1) * (normalizedBounds.maxZ - normalizedBounds.minZ + 1);
    if (volume > MAX_REGION_VOLUME) return null;
    const mode = input.mode === 'whitelist' ? 'whitelist' : 'blacklist';
    const allow = Array.isArray(input.allow) ? [...new Set(input.allow.map(cleanBlockName).filter(Boolean))] : [];
    const customDeny = Array.isArray(input.deny) ? input.deny.map(cleanBlockName).filter(Boolean) : [];
    return {
      bounds: normalizedBounds,
      volume,
      mode,
      allow,
      customDeny: [...new Set(customDeny)],
      deny: [...new Set([...this.defaultRegionDeny(), ...customDeny])],
      cursor: 0,
      scanned: 0,
      mined: 0,
      active: false,
      pausedReason: null,
      lastBlock: null,
      pending: null,
      retryCount: 0
    };
  }

  serializedRegionPlan() {
    if (!this.regionPlan) return null;
    return {
      bounds: { ...this.regionPlan.bounds },
      mode: this.regionPlan.mode,
      allow: [...this.regionPlan.allow],
      deny: [...(this.regionPlan.customDeny || [])]
    };
  }

  configureRegion(input = {}) {
    if (this.regionMining) return { ok: false, message: 'Stop region mining before changing its configuration.' };
    const bounds = input.bounds || {};
    const parsed = this.regionBoundsFromArgs([
      bounds.minX ?? input.x1, bounds.minY ?? input.y1, bounds.minZ ?? input.z1,
      bounds.maxX ?? input.x2, bounds.maxY ?? input.y2, bounds.maxZ ?? input.z2
    ]);
    if (!parsed || parsed.error) return { ok: false, message: parsed?.error || 'Six integer coordinates are required.' };
    const mode = String(input.mode || 'blacklist').toLowerCase();
    if (!['blacklist', 'whitelist'].includes(mode)) return { ok: false, message: 'Mode must be blacklist or whitelist.' };
    const allow = Array.isArray(input.allow) ? [...new Set(input.allow.map(cleanBlockName).filter(Boolean))] : [];
    const deny = Array.isArray(input.deny) ? [...new Set(input.deny.map(cleanBlockName).filter(Boolean))] : [];
    if (mode === 'whitelist' && !allow.length) return { ok: false, message: 'Whitelist mode needs at least one allowed block.' };
    this.regionPlan = {
      bounds: parsed.bounds,
      volume: parsed.volume,
      mode,
      allow,
      customDeny: deny,
      deny: [...new Set([...this.defaultRegionDeny(), ...deny])],
      cursor: 0,
      scanned: 0,
      mined: 0,
      active: false,
      pausedReason: null,
      lastBlock: null,
      pending: null,
      retryCount: 0
    };
    this.log(`Region mining configuration saved (${mode}, ${parsed.volume} blocks).`);
    return { ok: true, message: `Mining region saved: ${parsed.volume} blocks in ${mode} mode.` };
  }

  regionBoundsFromArgs(args) {
    const numbers = args.slice(0, 6).map((value) => Number(value));
    if (numbers.length !== 6 || numbers.some((value) => !Number.isInteger(value))) return null;
    const [x1, y1, z1, x2, y2, z2] = numbers;
    const bounds = {
      minX: Math.min(x1, x2), maxX: Math.max(x1, x2),
      minY: Math.min(y1, y2), maxY: Math.max(y1, y2),
      minZ: Math.min(z1, z2), maxZ: Math.max(z1, z2)
    };
    const volume = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) * (bounds.maxZ - bounds.minZ + 1);
    if (volume > MAX_REGION_VOLUME) return { error: `Region is too large (${volume} blocks). Maximum is ${MAX_REGION_VOLUME}.` };
    return { bounds, volume };
  }

  executeRegionCommand(args = []) {
    const action = String(args[0] || 'status').toLowerCase();
    if (action === 'set') {
      const parsed = this.regionBoundsFromArgs(args.slice(1));
      if (!parsed || parsed.error) return this.respond(parsed?.error || 'Usage: area set <x1> <y1> <z1> <x2> <y2> <z2>');
      this.regionPlan = {
        bounds: parsed.bounds,
        volume: parsed.volume,
        mode: this.regionPlan?.mode || 'blacklist',
        allow: this.regionPlan?.allow || [],
        customDeny: this.regionPlan?.customDeny || [],
        deny: this.regionPlan?.deny || this.defaultRegionDeny(),
        cursor: 0,
        scanned: 0,
        mined: 0,
        active: false,
        pausedReason: null,
        lastBlock: null,
        pending: null,
        retryCount: 0,
      };
      return this.respond(`[${this.bot.username}] Region set: ${this.regionPlan.bounds.minX},${this.regionPlan.bounds.minY},${this.regionPlan.bounds.minZ} -> ${this.regionPlan.bounds.maxX},${this.regionPlan.bounds.maxY},${this.regionPlan.bounds.maxZ} (${parsed.volume} blocks).`);
    }
    if (!this.regionPlan) return this.respond(`[${this.bot.username}] Set a region first: area set <x1> <y1> <z1> <x2> <y2> <z2>`);
    if (action === 'mode') {
      const mode = String(args[1] || '').toLowerCase();
      if (!['blacklist', 'whitelist'].includes(mode)) return this.respond(`[${this.bot.username}] Usage: area mode blacklist|whitelist`);
      this.regionPlan.mode = mode;
      return this.respond(`[${this.bot.username}] Region mode: ${mode}.`);
    }
    if (action === 'allow' || action === 'whitelist') {
      const names = this.expandRegionBlockNames(args.slice(1));
      if (!names.length) return this.respond(`[${this.bot.username}] Usage: area allow <block...>`);
      this.regionPlan.allow = [...new Set([...this.regionPlan.allow, ...names])];
      return this.respond(`[${this.bot.username}] Region allow list updated: ${this.regionPlan.allow.join(', ')}.`);
    }
    if (action === 'deny' || action === 'blacklist') {
      const names = this.expandRegionBlockNames(args.slice(1));
      if (!names.length) return this.respond(`[${this.bot.username}] Usage: area deny <block...>`);
      this.regionPlan.customDeny = [...new Set([...(this.regionPlan.customDeny || []), ...names])];
      this.regionPlan.deny = [...new Set([...this.defaultRegionDeny(), ...this.regionPlan.customDeny])];
      return this.respond(`[${this.bot.username}] Region deny list updated: ${this.regionPlan.customDeny.join(', ')}.`);
    }
    if (action === 'reset') {
      this.regionPlan.mode = 'blacklist';
      this.regionPlan.allow = [];
      this.regionPlan.customDeny = [];
      this.regionPlan.deny = this.defaultRegionDeny();
      return this.respond(`[${this.bot.username}] Region filters reset to the safe blacklist.`);
    }
    if (action === 'start' || action === 'on') return this.startRegionMining();
    if (action === 'stop' || action === 'off') return this.stopRegionMining();
    if (action === 'status') return this.respond(this.regionStatusMessage());
    return this.respond(`[${this.bot.username}] Usage: area set|mode|allow|deny|start|stop|status ...`);
  }

  regionStatusMessage() {
    if (!this.regionPlan) return `[${this.bot.username}] No mining region configured.`;
    const { bounds, mode, volume, cursor, scanned, mined, active, pausedReason } = this.regionPlan;
    const progress = volume ? `${Math.min(100, Math.round((cursor / volume) * 100))}%` : '0%';
    return `[${this.bot.username}] Region ${active ? 'RUNNING' : 'PAUSED'} ${progress}; ${mined} mined, ${scanned}/${volume} scanned; mode=${mode}${pausedReason ? `; ${pausedReason}` : ''}. Bounds ${bounds.minX},${bounds.minY},${bounds.minZ} -> ${bounds.maxX},${bounds.maxY},${bounds.maxZ}.`;
  }

  startRegionMining() {
    if (this.mining) return this.respond(`[${this.bot.username}] Targeted mining is active; stop it before starting region mining.`);
    if (this.regionMining) return this.respond(`[${this.bot.username}] Region mining is already running.`);
    if (!this.regionPlan) return this.respond(`[${this.bot.username}] Set a region first with area set.`);
    if (this.regionPlan.mode === 'whitelist' && !this.regionPlan.allow.length) return this.respond(`[${this.bot.username}] Whitelist mode has no allowed blocks; refusing to start.`);
    this.regionMining = true;
    this.regionPlan.active = true;
    this.regionPlan.pausedReason = null;
    this.regionPlan.retryCount = 0;
    this.log(`Region mining started (${this.regionPlan.mode}, ${this.regionPlan.volume} blocks).`);
    this.respond(`[${this.bot.username}] Region mining started. Containers, fluids, bedrock and protected blocks remain untouched.`);
    this.regionMiningLoop();
    return { ok: true, message: 'Region mining started.' };
  }

  stopRegionMining() {
    this.regionMining = false;
    if (this.regionPlan) {
      this.regionPlan.active = false;
      this.regionPlan.pausedReason = 'stopped by operator';
    }
    if (this.regionTimer) clearTimeout(this.regionTimer);
    this.regionTimer = null;
    return this.respond(`[${this.bot.username}] Region mining stopped.`);
  }

  regionPositionAt(index) {
    const bounds = this.regionPlan.bounds;
    const width = bounds.maxX - bounds.minX + 1;
    const depth = bounds.maxZ - bounds.minZ + 1;
    const x = bounds.minX + (index % width);
    const z = bounds.minZ + (Math.floor(index / width) % depth);
    const y = bounds.minY + Math.floor(index / (width * depth));
    return new Vec3(x, y, z);
  }

  isInsideRegion(position) {
    const bounds = this.regionPlan?.bounds;
    return Boolean(bounds && position.x >= bounds.minX && position.x <= bounds.maxX && position.y >= bounds.minY && position.y <= bounds.maxY && position.z >= bounds.minZ && position.z <= bounds.maxZ);
  }

  isRegionTarget(block) {
    if (!block || !this.isInsideRegion(block.position)) return false;
    const name = cleanBlockName(block.name);
    if (!name || REGION_FLUIDS.has(name) || isRegionProtectedName(name)) return false;
    if (this.regionPlan.mode === 'whitelist') return this.regionPlan.allow.includes(name);
    return !this.regionPlan.deny.includes(name);
  }

  findRegionCandidate() {
    const bot = this.bot;
    const pendingPosition = this.regionPlan.pending ? new Vec3(this.regionPlan.pending.x, this.regionPlan.pending.y, this.regionPlan.pending.z) : null;
    if (pendingPosition) {
      const pendingBlock = bot.blockAt(pendingPosition);
      if (this.isRegionTarget(pendingBlock)) return pendingBlock;
      this.regionPlan.pending = null;
      this.regionPlan.retryCount = 0;
    }
    const positions = bot.findBlocks({
      matching: (block) => {
        const name = cleanBlockName(block?.name);
        if (!name || REGION_FLUIDS.has(name) || isRegionProtectedName(name)) return false;
        return this.regionPlan.mode === 'whitelist' ? this.regionPlan.allow.includes(name) : !this.regionPlan.deny.includes(name);
      },
      maxDistance: 48,
      count: 64
    });
    return positions.map((position) => bot.blockAt(position)).filter((block) => this.isRegionTarget(block)).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] || null;
  }

  scanRegionCursor() {
    if (this.regionPlan.pending) {
      const pendingPosition = new Vec3(this.regionPlan.pending.x, this.regionPlan.pending.y, this.regionPlan.pending.z);
      const pendingBlock = this.bot.blockAt(pendingPosition);
      if (!pendingBlock) return { unloaded: pendingPosition };
      if (this.isRegionTarget(pendingBlock)) return { block: pendingBlock };
      this.regionPlan.pending = null;
      this.regionPlan.retryCount = 0;
    }
    while (this.regionPlan.cursor < this.regionPlan.volume) {
      const position = this.regionPositionAt(this.regionPlan.cursor);
      const block = this.bot.blockAt(position);
      if (!block) return { unloaded: position };
      this.regionPlan.cursor += 1;
      this.regionPlan.scanned += 1;
      if (this.isRegionTarget(block)) {
        this.regionPlan.pending = { x: position.x, y: position.y, z: position.z };
        this.regionPlan.retryCount = 0;
        return { block };
      }
    }
    return { complete: true };
  }

  async moveToBlock(block) {
    let release;
    const previous = this.navigationLock;
    this.navigationLock = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const movements = new Movements(this.bot, minecraftData(this.bot.version));
      movements.canDig = false;
      this.bot.pathfinder.setMovements(movements);
      await this.bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
    } finally {
      release();
    }
  }

  getPlugItem() {
    return this.bot.inventory.items().find((item) => PLUG_BLOCK_NAMES.includes(cleanBlockName(item.name)));
  }

  async sealFluidsAround(block) {
    const directions = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0),
      new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ];
    const plug = this.getPlugItem();
    for (const direction of directions) {
      const fluidPosition = block.position.plus(direction);
      const fluid = this.bot.blockAt(fluidPosition);
      if (!fluid || !REGION_FLUIDS.has(cleanBlockName(fluid.name))) continue;
      if (this.regionSeals.some((seal) => seal.position.equals(fluidPosition))) continue;
      if (!plug) {
        this.regionPlan.pausedReason = `fluid at ${fluidPosition}; no plug blocks available`;
        return false;
      }
      let placed = false;
      for (const supportDirection of directions) {
        const support = this.bot.blockAt(fluidPosition.minus(supportDirection));
        if (!support || REGION_FLUIDS.has(cleanBlockName(support.name)) || ['air', 'cave_air', 'void_air'].includes(cleanBlockName(support.name))) continue;
        try {
          await this.bot.equip(plug, 'hand');
          await this.bot.placeBlock(support, supportDirection);
          this.regionSeals.push({ position: fluidPosition.clone(), blockName: plug.name, fluidName: fluid.name });
          placed = true;
          break;
        } catch (error) {
          this.log(`Could not seal ${fluid.name} at ${fluidPosition}: ${error.message}`, 'warn');
        }
      }
      if (!placed) {
        this.regionPlan.pausedReason = `could not safely seal fluid at ${fluidPosition}`;
        return false;
      }
    }
    return true;
  }

  async regionMiningLoop() {
    if (!this.regionMining || !this.bot?.entity || !this.regionPlan) return;
    try {
      let block = this.findRegionCandidate();
      if (!block) {
        const scan = this.scanRegionCursor();
        if (scan.complete) {
          this.regionMining = false;
          this.regionPlan.active = false;
          this.regionPlan.pausedReason = null;
          this.log(`Region mining finished: ${this.regionPlan.mined} blocks mined.`);
          this.respond(`[${this.bot.username}] Region mining finished: ${this.regionPlan.mined} blocks mined. Sealed fluids remain plugged for safety; use unseal only when ready.`);
          return;
        }
        if (scan.unloaded) {
          await this.moveToBlock({ position: scan.unloaded });
          if (this.regionMining) this.regionTimer = setTimeout(() => this.regionMiningLoop(), 250);
          return;
        }
        block = scan.block;
      }
      if (!block || !this.regionMining) return;
      await this.moveToBlock(block);
      if (!this.regionMining) return;
      const current = this.bot.blockAt(block.position);
      if (this.bot.inventory.emptySlotCount() === 0) {
        if (this.resupplyEnabled) await this.maybeResupply();
        if (this.bot.inventory.emptySlotCount() === 0) {
          this.regionMining = false;
          this.regionPlan.active = false;
          this.regionPlan.pausedReason = 'inventory is full; configure a supply point or empty the inventory';
          this.respond(`[${this.bot.username}] Region mining paused: ${this.regionPlan.pausedReason}.`);
          return;
        }
      }
      if (!this.isRegionTarget(current)) {
        this.regionPlan.pending = null;
        this.regionPlan.retryCount = 0;
        this.regionTimer = setTimeout(() => this.regionMiningLoop(), 100);
        return;
      }
      if (!this.bot.canDigBlock(current)) {
        this.regionPlan.retryCount += 1;
        if (this.regionPlan.retryCount >= 5) {
          this.regionMining = false;
          this.regionPlan.active = false;
          this.regionPlan.pausedReason = `cannot reach ${current.name} at ${current.position}`;
          this.respond(`[${this.bot.username}] Region mining paused: ${this.regionPlan.pausedReason}.`);
          return;
        }
        this.regionTimer = setTimeout(() => this.regionMiningLoop(), 1000);
        return;
      }
      if (!(await this.sealFluidsAround(current))) {
        this.regionMining = false;
        this.regionPlan.active = false;
        this.log(`Region mining paused: ${this.regionPlan.pausedReason}`, 'warn');
        this.respond(`[${this.bot.username}] Region mining paused: ${this.regionPlan.pausedReason}.`);
        return;
      }
      const toolReady = await this.prepareHarvestTool(current, 'Region mining');
      if (!toolReady) {
        this.regionMining = false;
        this.regionPlan.active = false;
        this.regionPlan.pausedReason = 'no usable tool was found';
        return;
      }
      this.digging = true;
      await this.bot.lookAt(current.position.offset(0.5, 0.5, 0.5));
      await this.bot.dig(current, true, 'raycast');
      this.digging = false;
      this.regionPlan.pending = null;
      this.regionPlan.retryCount = 0;
      this.regionPlan.mined += 1;
      this.regionPlan.lastBlock = { name: current.name, position: { x: current.position.x, y: current.position.y, z: current.position.z } };
      if (this.regionMining) this.regionTimer = setTimeout(() => this.regionMiningLoop(), 180);
    } catch (error) {
      this.digging = false;
      this.regionPlan.retryCount = (this.regionPlan.retryCount || 0) + 1;
      this.regionPlan.pausedReason = error.message;
      this.log(`Region mining cycle failed: ${error.message}`, 'warn');
      if (this.regionPlan.retryCount >= 5) {
        this.regionMining = false;
        this.regionPlan.active = false;
        this.respond(`[${this.bot.username}] Region mining paused after repeated failures: ${error.message}.`);
        return;
      }
      if (this.regionMining) this.regionTimer = setTimeout(() => this.regionMiningLoop(), 2500);
    }
  }

  async unsealFluids() {
    if (this.regionMining) return this.respond(`[${this.bot.username}] Stop region mining before removing fluid seals.`);
    if (!this.regionSeals.length) return this.respond(`[${this.bot.username}] No fluid seals created by this bot.`);
    const seals = [...this.regionSeals];
    let removed = 0;
    for (const seal of seals) {
      const block = this.bot.blockAt(seal.position);
      if (!block || cleanBlockName(block.name) !== cleanBlockName(seal.blockName)) continue;
      try {
        await this.moveToBlock(block);
        await this.bot.dig(block, true, 'raycast');
        removed += 1;
      } catch (error) {
        this.log(`Could not remove seal at ${seal.position}: ${error.message}`, 'warn');
      }
    }
    this.regionSeals = this.regionSeals.filter((seal) => this.bot.blockAt(seal.position)?.name === seal.blockName);
    return this.respond(`[${this.bot.username}] Removed ${removed} fluid seal(s). Water/lava may flow again.`);
  }

  lookCommand(args = []) {
    const targetName = args[0] && this.bot.players[args[0]]?.entity ? args[0] : null;
    if (targetName) {
      return this.bot.lookAt(this.bot.players[targetName].entity.position.offset(0, 1, 0)).then(() => ({ ok: true, message: `Looking at ${targetName}.` }));
    }
    const yaw = Number(args[0]);
    const pitch = Number(args[1]);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return { ok: false, message: 'Usage: look <yaw degrees> <pitch degrees> or look <player>' };
    return this.bot.look(yaw * Math.PI / 180, Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch * Math.PI / 180)), true)
      .then(() => ({ ok: true, message: `Looking at yaw ${yaw}°, pitch ${pitch}°.` }));
  }

  setSleepMode(mode = 'on') {
    const normalized = String(mode || 'on').toLowerCase();
    this.sleepEnabled = !['off', 'stop', 'disable'].includes(normalized);
    if (this.sleepEnabled) this.startMaintenanceLoop();
    else if (!this.resupplyEnabled && this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    return this.respond(`[${this.bot.username}] Automatic sleep ${this.sleepEnabled ? 'enabled' : 'disabled'}.`);
  }

  persistResupplyPoints() {
    try {
      const next = this.config.bots.map((bot) => bot.id === this.id ? { ...bot, resupplyPoints: this.resupplyPoints.map((point) => ({ ...point })) } : bot);
      saveBotsConfig(this.config, next);
      this.config.bots = next;
      this.definition = next.find((bot) => bot.id === this.id) || this.definition;
    } catch (error) {
      this.log(`Could not persist supply points: ${error.message}`, 'warn');
    }
  }

  executeResupplyCommand(args = []) {
    const action = String(args[0] || 'status').toLowerCase();
    if (action === 'on' || action === 'enable') {
      this.resupplyEnabled = true;
      this.startMaintenanceLoop();
      return this.respond(`[${this.bot.username}] Resupply enabled. Only configured supply points will be opened.`);
    }
    if (action === 'off' || action === 'disable') {
      this.resupplyEnabled = false;
      if (!this.sleepEnabled && this.maintenanceTimer) {
        clearTimeout(this.maintenanceTimer);
        this.maintenanceTimer = null;
      }
      return this.respond(`[${this.bot.username}] Resupply disabled.`);
    }
    const pointAction = String(args[1] || '').toLowerCase();
    if (action === 'point' && pointAction === 'add') {
      const values = args.slice(2, 5).map(Number);
      if (values.length !== 3 || values.some((value) => !Number.isInteger(value))) return this.respond(`[${this.bot.username}] Usage: resupply point add <x> <y> <z>`);
      this.resupplyPoints.push({ x: values[0], y: values[1], z: values[2] });
      this.persistResupplyPoints();
      return this.respond(`[${this.bot.username}] Supply point added at ${values.join(', ')}.`);
    }
    if (action === 'point' && pointAction === 'clear') {
      this.resupplyPoints = [];
      this.persistResupplyPoints();
      return this.respond(`[${this.bot.username}] Supply points cleared.`);
    }
    if (action === 'status') return this.respond(`[${this.bot.username}] Resupply ${this.resupplyEnabled ? 'ON' : 'OFF'}; points: ${this.resupplyPoints.length}.`);
    return this.respond(`[${this.bot.username}] Usage: resupply on|off|status|point add <x> <y> <z>|point clear`);
  }

  startMaintenanceLoop() {
    if (this.maintenanceTimer || this.maintenanceBusy) return;
    this.maintenanceLoop();
  }

  async maintenanceLoop() {
    if (!this.bot || (!this.sleepEnabled && !this.resupplyEnabled)) return;
    this.maintenanceBusy = true;
    try {
      if (this.sleepEnabled) await this.maybeSleep();
      if (this.resupplyEnabled) await this.maybeResupply();
    } catch (error) {
      this.log(`Maintenance check failed: ${error.message}`, 'warn');
    } finally {
      this.maintenanceBusy = false;
      if (this.bot && (this.sleepEnabled || this.resupplyEnabled)) this.maintenanceTimer = setTimeout(() => {
        this.maintenanceTimer = null;
        this.maintenanceLoop();
      }, 15000);
    }
  }

  async maybeSleep() {
    const bot = this.bot;
    if (!bot?.time || bot.isSleeping || !['overworld', 'minecraft:overworld'].includes(bot.game?.dimension)) return;
    const time = Number(bot.time.timeOfDay);
    if (!(time >= 12541 && time <= 23458)) return;
    const bedIds = Object.entries(minecraftData(bot.version).blocksByName)
      .filter(([name]) => name.endsWith('_bed') || name === 'bed').map(([, block]) => block.id);
    const positions = bot.findBlocks({ matching: bedIds, maxDistance: 32, count: 1 });
    if (!positions.length) {
      this.log('Night detected, but no bed is available within 32 blocks.', 'warn');
      return;
    }
    const bed = bot.blockAt(positions[0]);
    if (!bed || !bot.sleep) return;
    await this.moveToBlock(bed);
    if (!this.sleepEnabled || bot.isSleeping) return;
    await bot.sleep(bed);
    this.log('Sleeping through the night.');
  }

  isToolLow(item) {
    const isTool = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'].some((name) => item?.name?.includes(name));
    return Boolean(isTool && Number.isFinite(item.maxDurability) && Number.isFinite(item.durabilityUsed) && item.maxDurability - item.durabilityUsed <= 20);
  }

  isFoodItem(item) {
    return ['bread', 'carrot', 'potato', 'beetroot', 'beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon', 'apple', 'melon_slice', 'baked_potato', 'cooked_'].some((part) => item?.name?.includes(part));
  }

  hasUsablePickaxe() {
    return Boolean(this.bot?.inventory?.items().some((item) => item.name.includes('pickaxe') && !this.isToolLow(item)));
  }

  blockNeedsTool(block) {
    return Boolean(block?.harvestTools && Object.keys(block.harvestTools).length);
  }

  usableHarvestTool(block) {
    if (!this.bot || !block) return null;
    const preferred = this.bot.pathfinder.bestHarvestTool(block);
    if (preferred && !this.isToolLow(preferred)) return preferred;
    if (!block.harvestTools) return null;
    return this.bot.inventory.items().find((item) => block.harvestTools[item.type] && !this.isToolLow(item)) || null;
  }

  async prepareHarvestTool(block, taskName) {
    let tool = this.usableHarvestTool(block);
    if (!tool && this.blockNeedsTool(block) && this.resupplyEnabled) {
      await this.maybeResupply({ requirePickaxe: true, requireFood: false });
      tool = this.usableHarvestTool(block);
    }
    if (!tool && this.blockNeedsTool(block)) {
      const message = `${taskName} 已暂停：${block.name} 需要可用工具，但背包和已配置补给点中都没有找到。`;
      this.resourceAlert('missing-required-tool', true, message, 30000);
      return null;
    }
    this.resourceAlert('missing-required-tool', false, '');
    if (tool) await this.bot.equip(tool, 'hand');
    return tool || true;
  }

  isKeepItem(item) {
    if (item.name.includes('pickaxe') && this.isToolLow(item)) return false;
    return this.isFoodItem(item) || ['pickaxe', 'axe', 'shovel', 'sword', 'hoe', 'helmet', 'chestplate', 'leggings', 'boots', ...PLUG_BLOCK_NAMES].some((part) => item.name.includes(part));
  }

  clearResourceAlertPrefix(prefix) {
    for (const key of this.activeAlerts) {
      if (key.startsWith(prefix)) this.activeAlerts.delete(key);
    }
  }

  resourceAlert(key, active, message, cooldownMs = 120000) {
    if (!active) {
      this.activeAlerts.delete(key);
      return false;
    }
    const now = Date.now();
    const last = this.alertLastSent.get(key) || 0;
    const first = !this.activeAlerts.has(key);
    this.activeAlerts.add(key);
    if (!first && now - last < cooldownMs) return false;
    this.alertLastSent.set(key, now);
    this.log(message, 'warn');
    if (this.bot?.chat) this.bot.chat(`[${this.bot.username}] 警告：${message}`);
    return true;
  }

  startResourceMonitor() {
    if (this.resourceTimer) return;
    const tick = async () => {
      this.resourceTimer = null;
      if (!this.bot) return;
      try { await this.checkResourceAlerts(); } catch (error) { this.log(`Resource monitor failed: ${error.message}`, 'warn'); }
      if (this.bot) this.resourceTimer = setTimeout(tick, 10000);
    };
    tick();
  }

  async checkResourceAlerts() {
    const bot = this.bot;
    if (!bot?.inventory) return;
    const items = bot.inventory.items();
    const hasFood = items.some((item) => this.isFoodItem(item));
    const lowHealth = typeof bot.health === 'number' && bot.health <= 8;
    const hungryWithoutFood = typeof bot.food === 'number' && bot.food <= 14 && !hasFood;
    const miningNeedsPickaxe = (this.mining || this.regionMining) && !this.hasUsablePickaxe();
    this.resourceAlert('low-health', lowHealth, `生命值过低（${Math.round(bot.health)}/20），已关闭战斗，需要食物或治疗。`);
    if (lowHealth && this.killAuraEnabled) {
      this.killAuraEnabled = false;
      bot.pvp?.stop();
    }
    this.resourceAlert('no-food', hungryWithoutFood, `饱食度较低（${Math.round(bot.food)}/20），背包里没有找到可食用物品。`);
    this.resourceAlert('no-pickaxe', miningNeedsPickaxe, '挖矿需要可用镐，但背包里没有找到。');
    if (!hungryWithoutFood && !miningNeedsPickaxe) this.clearResourceAlertPrefix('resupply-');
    if ((hungryWithoutFood || miningNeedsPickaxe) && this.resupplyEnabled && !this.resupplyBusy) {
      const result = await this.maybeResupply({ requireFood: hungryWithoutFood, requirePickaxe: miningNeedsPickaxe });
      if (!result.ok) this.resourceAlert(`resupply-${result.reason}`, true, `自动补给失败：${result.message}`);
      else this.clearResourceAlertPrefix('resupply-');
    }
  }

  async maybeResupply(requirements = {}) {
    const bot = this.bot;
    if (this.resupplyBusy) return { ok: false, reason: 'busy', message: 'another resupply operation is already running' };
    if (!bot?.entity) return { ok: false, reason: 'offline', message: 'bot world data is unavailable' };
    const hasPickaxe = this.hasUsablePickaxe();
    const hasFood = bot.inventory.items().some((item) => this.isFoodItem(item));
    const needPickaxe = requirements.requirePickaxe ?? !hasPickaxe;
    const needFood = requirements.requireFood ?? !hasFood;
    const inventoryFull = bot.inventory.emptySlotCount() <= 2;
    if (!inventoryFull && (!needPickaxe || hasPickaxe) && (!needFood || hasFood)) return { ok: true, reason: 'ready', message: 'inventory already has the required supplies' };
    if (!this.resupplyPoints.length) return { ok: false, reason: 'no-point', message: 'no supply point is configured' };
    const point = this.resupplyPoints.map((candidate) => ({ ...candidate, distance: bot.entity.position.distanceTo(new Vec3(candidate.x, candidate.y, candidate.z)) })).sort((a, b) => a.distance - b.distance)[0];
    const block = bot.blockAt(new Vec3(point.x, point.y, point.z));
    if (!block || !isRegionContainerName(block.name)) {
      const message = `configured supply point ${point.x},${point.y},${point.z} is not a supported container`;
      this.log(message, 'warn');
      return { ok: false, reason: 'invalid-point', message };
    }
    this.resupplyBusy = true;
    let container = null;
    try {
      await this.moveToBlock(block);
      container = await bot.openContainer(block);
      for (const item of bot.inventory.items().filter((candidate) => !this.isKeepItem(candidate))) {
        try { await container.deposit(item.type, item.metadata, item.count, item.nbt); } catch (_) {}
      }
      const contents = typeof container.containerItems === 'function' ? container.containerItems() : container.slots.filter(Boolean);
      const pickaxe = contents.find((item) => item.name.includes('pickaxe') && !this.isToolLow(item));
      const food = contents.find((item) => this.isFoodItem(item));
      if (needPickaxe && !this.hasUsablePickaxe() && pickaxe && bot.inventory.emptySlotCount() > 0) await container.withdraw(pickaxe.type, pickaxe.metadata, 1);
      if (needFood && !bot.inventory.items().some((item) => this.isFoodItem(item)) && food && bot.inventory.emptySlotCount() > 0) await container.withdraw(food.type, food.metadata, Math.min(food.count, 32));
      const missing = [];
      if (needPickaxe && !this.hasUsablePickaxe()) missing.push('usable pickaxe');
      if (needFood && !bot.inventory.items().some((item) => this.isFoodItem(item))) missing.push('food');
      if (missing.length) return { ok: false, reason: 'stock-empty', message: `nearest supply container has no ${missing.join(' or ')}` };
      this.log('Resupply completed from configured point.');
      return { ok: true, reason: 'completed', message: 'resupply completed' };
    } catch (error) {
      this.log(`Resupply failed: ${error.message}`, 'warn');
      return { ok: false, reason: 'operation-failed', message: error.message };
    } finally {
      if (container) {
        try { await container.close(); } catch (_) {}
      }
      this.resupplyBusy = false;
    }
  }

  equipRole(role = 'auto', announce = true) {
    const bot = this.bot;
    if (!bot) return { ok: false, message: `${this.displayName} is not online.` };
    const normalized = String(role || 'auto').toLowerCase();
    const effective = normalized === 'auto' ? (this.mining ? 'pickaxe' : this.killAuraEnabled ? 'weapon' : 'tool') : normalized;
    const patterns = {
      pickaxe: ['pickaxe'], axe: ['axe'], shovel: ['shovel'], weapon: ['sword', 'axe'], food: ['bread', 'carrot', 'potato', 'beef', 'porkchop', 'chicken', 'mutton', 'cod', 'salmon'], tool: ['pickaxe', 'axe', 'shovel', 'hoe']
    };
    const item = bot.inventory.items().find((candidate) => (patterns[effective] || patterns.tool).some((part) => candidate.name.includes(part)));
    if (!item) {
      const message = `[${bot.username}] No ${effective} item found in inventory.`;
      if (announce) return this.respond(message);
      this.log(message, 'warn');
      return { ok: false, message };
    }
    this.supplyRole = effective;
    if (bot.heldItem?.name === item.name) {
      return { ok: true, message: `${item.name} is already equipped.` };
    }
    bot.equip(item, 'hand')
      .then(() => {
        this.log(`Equipped ${item.name} for ${effective}.`);
        if (announce) this.respond(`[${bot.username}] Equipped ${item.name}.`);
      })
      .catch((error) => this.log(`Equipment switch failed: ${error.message}`, 'warn'));
    return { ok: true, message: `Equipping ${item.name}.` };
  }

  setSupply(mode = 'on') {
    const normalized = String(mode || 'on').toLowerCase();
    if (['off', 'stop', 'disable'].includes(normalized)) {
      this.supply = false;
      if (this.supplyTimer) clearTimeout(this.supplyTimer);
      this.supplyTimer = null;
      if (this.bot?.autoEat?.disable) this.bot.autoEat.disable();
      return this.respond(`[${this.bot.username}] Supply management disabled.`);
    }
    const wasEnabled = this.supply;
    this.supply = true;
    if (this.bot?.autoEat?.enable) this.bot.autoEat.enable();
    this.log('Supply and equipment management enabled.');
    if (!wasEnabled) this.supplyLoop();
    return this.respond(`[${this.bot.username}] Supply management enabled.`);
  }

  async supplyLoop() {
    if (!this.supply || !this.bot) return;
    try {
      const bot = this.bot;
      if (bot.autoEat?.eat && typeof bot.food === 'number' && bot.food <= 14 && !bot.autoEat.isEating) await bot.autoEat.eat();
      await this.checkResourceAlerts();
      this.equipRole(this.supplyRole === 'auto' ? 'auto' : this.supplyRole, false);
    } catch (error) {
      this.log(`Supply check failed: ${error.message}`, 'warn');
    } finally {
      if (this.supply) this.supplyTimer = setTimeout(() => this.supplyLoop(), 12000);
    }
  }

  stationaryAttack() {
    const bot = this.bot;
    if (!bot?.entity || this.digging || this.resupplyBusy || bot.isSleeping) return;
    const entity = bot.nearestEntity((candidate) => this.definition.targetMobs.includes(candidate.name) && candidate.position.distanceTo(bot.entity.position) < 3.5);
    if (!entity) return;
    const sword = bot.inventory.items().find((item) => item.name.includes('sword'));
    if (sword) bot.equip(sword, 'hand').catch(() => {});
    bot.lookAt(entity.position.offset(0, entity.height * 0.7, 0)).catch(() => {});
    bot.attack(entity);
  }

  publicStatus() {
    const bot = this.bot;
    const inventory = bot?.inventory?.items?.() || [];
    const nearbyPlayers = bot?.entities && bot.entity?.position ? Object.values(bot.entities)
      .filter((entity) => entity.type === 'player' && entity.username !== bot.username && entity.position?.distanceTo(bot.entity.position) < 30)
      .map((entity) => entity.username).filter(Boolean) : [];
    return {
      id: this.id,
      displayName: this.displayName,
      state: this.state,
      username: bot?.username || null,
      health: typeof bot?.health === 'number' ? Math.round(bot.health) : null,
      food: typeof bot?.food === 'number' ? Math.round(bot.food) : null,
      position: bot?.entity?.position ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null,
      dimension: bot?.game?.dimension || bot?.game?.level?.name || null,
      killAura: this.killAuraEnabled,
      fishing: this.fishing,
      mining: this.mining,
      regionMining: this.regionMining,
      supply: this.supply,
      sleepEnabled: this.sleepEnabled,
      resupplyEnabled: this.resupplyEnabled,
      region: this.regionPlan ? {
        bounds: this.regionPlan.bounds,
        volume: this.regionPlan.volume,
        mode: this.regionPlan.mode,
        allow: this.regionPlan.allow,
        deny: this.regionPlan.deny,
        customDeny: this.regionPlan.customDeny || [],
        cursor: this.regionPlan.cursor,
        scanned: this.regionPlan.scanned,
        mined: this.regionPlan.mined,
        active: this.regionPlan.active,
        pausedReason: this.regionPlan.pausedReason,
        lastBlock: this.regionPlan.lastBlock
      } : null,
      resupplyPoints: this.resupplyPoints,
      skinIdentifier: this.bot?.username || this.definition.skinUsername || this.skinCache?.status(this.id).username || (!String(this.definition.username || '').includes('@') ? this.definition.username : this.definition.id),
      skin: this.skinCache ? {
        avatarUrl: `/api/skins/${encodeURIComponent(this.id)}/avatar`,
        bodyUrl: `/api/skins/${encodeURIComponent(this.id)}/body`,
        ...this.skinCache.status(this.id)
      } : null,
      resourceAlerts: [...this.activeAlerts],
      inventory: inventory.slice(0, 8).map((item) => ({ name: item.name, count: item.count })),
      nearbyPlayers,
      lastError: this.lastError,
      lastReason: this.lastReason,
      viewerPort: this.definition.viewer?.enabled ? this.definition.viewer.port : null
    };
  }

  helpText() {
    return 'fish | mine <block> [count] | 网页配置区域和黑/白名单后使用 area on/off/status | unseal | supply on/off | resupply on/off | resupply point add <x> <y> <z> | sleep on/off | equip <auto|pickaxe|axe|weapon> | kill on/off | stop | status | look <player> | look <yaw> <pitch> | home <name> | sethome <name> | come <player> | follow <player> | cmd /<command>';
  }
}

module.exports = { ManagedBot };
