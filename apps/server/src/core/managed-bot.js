const EventEmitter = require('node:events');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat').plugin;
const pvp = require('mineflayer-pvp').plugin;
const mineflayerViewer = require('prismarine-viewer').mineflayer;
const minecraftData = require('minecraft-data');
const { authCachePath } = require('../config/load-config');

class ManagedBot extends EventEmitter {
  constructor(config, botConfig) {
    super();
    this.config = config;
    this.definition = botConfig;
    this.bot = null;
    this.state = 'stopped';
    this.lastError = null;
    this.lastReason = null;
    this.reconnectTimer = null;
    this.attackTimer = null;
    this.fishingTimer = null;
    this.killAuraEnabled = false;
    this.fishing = false;
    this.chatLogEnabled = false;
    this.viewerStarted = false;
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
    });

    bot.on('spawn', () => {
      if (this.bot !== bot) return;
      bot.autoEat.options = {
        priority: 'foodPoints',
        startAt: 14,
        bannedFood: ['rotten_flesh', 'spider_eye']
      };
      this.setState('online');
      this.startViewer();
      this.startAttackLoop();
      this.log('Ready for commands.');
    });

    bot.on('chat', (username, message) => this.handleChat(username, message));

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
    this.fishing = false;
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

    const knownCommands = new Set(['help', 'come', 'tpa', 'sethome', 'home', 'cmd', 'kill', 'attack', 'status', 'info', 'follow', 'stop', 'fish']);
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
      this.fishing = false;
      return this.respond(`[${bot.username}] Stopped.`);
    }
    if (normalized === 'fish') return this.startFishing();
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

  stationaryAttack() {
    const bot = this.bot;
    if (!bot?.entity) return;
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
      inventory: inventory.slice(0, 8).map((item) => ({ name: item.name, count: item.count })),
      nearbyPlayers,
      lastError: this.lastError,
      lastReason: this.lastReason,
      viewerPort: this.definition.viewer?.enabled ? this.definition.viewer.port : null
    };
  }

  helpText() {
    return 'fish | kill on/off | stop | status | home <name> | sethome <name> | come <player> | follow <player> | cmd /<command>';
  }
}

module.exports = { ManagedBot };
