export type BotState = 'stopped' | 'connecting' | 'online' | 'reconnecting' | 'error';

export type SkillKey = 'combat' | 'fishing' | 'pathfinder' | 'mining' | 'supply' | 'chat-command' | 'openai-tools';
export type SkillSettings = Record<SkillKey, { enabled: boolean; priority: number; autoStart: boolean }>;

export interface SupplyCoordinate { x: number; y: number; z: number }
export interface SupplyContainer extends SupplyCoordinate { role: 'storage' | 'pickup' | 'mixed' }
export type SupplyRole = 'food' | 'pickaxe' | 'sleep' | 'storage';
export interface SupplyPoint {
  id: string;
  name: string;
  home: string | null;
  roles: SupplyRole[];
  dimension: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  bed: SupplyCoordinate | null;
  containers: SupplyContainer[];
  scanRadius: number;
  autoDiscover: boolean;
  enabled: boolean;
  priority: number;
}

export interface ViewerConfig {
  enabled: boolean;
  port?: number;
  viewDistance: number;
  firstPerson: boolean;
}

export interface KnownHome {
  id: string;
  name: string;
  type: 'mining' | 'supply' | 'storage';
  label: string;
  dimension: string | null;
  position: SupplyCoordinate | null;
  initialized: boolean;
  active: boolean;
  phase?: string;
  roles?: SupplyRole[];
  scanRadius?: number;
}

export interface BotDefinition {
  id: string;
  displayName: string;
  skinUsername?: string;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  auth: string;
  version: string;
  viewer: ViewerConfig;
  commandWhitelist?: string[] | null;
  resupplyPoints?: SupplyPoint[];
  skills?: SkillSettings | null;
  miningRegion?: { bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }; dimension?: string | null; home?: string | null; anchor?: SupplyCoordinate | null; mode: 'blacklist' | 'whitelist'; allow: string[]; deny: string[] } | null;
}

export interface BotStatus {
  id: string;
  displayName: string;
  state: BotState;
  enabled: boolean;
  host: string;
  port: number;
  configuredUsername: string;
  username: string | null;
  version: string | null;
  auth: string | null;
  viewer: ViewerConfig;
  health: number | null;
  food: number | null;
  position: { x: number; y: number; z: number } | null;
  dimension: string | null;
  killAura: boolean;
  fishing: boolean;
  mining: boolean;
  regionMining?: boolean;
  supply: boolean;
  sleepEnabled?: boolean;
  resupplyEnabled?: boolean;
  region?: { bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }; volume: number; mode: string; allow: string[]; deny: string[]; customDeny?: string[]; cursor: number; scanned: number; mined: number; active: boolean; pausedReason: string | null; phase?: string; dimension?: string | null; home?: string | null; anchor?: SupplyCoordinate | null; lastBlock: { name: string; position: { x: number; y: number; z: number } } | null } | null;
  resupplyPoints?: SupplyPoint[];
  homes?: KnownHome[];
  homeActivity?: { home: string; type: 'mining' | 'supply'; state: string; message: string } | null;
  skills: SkillSettings;
  activeSkills: string[];
  scheduler?: { active: string | null; queued: string[]; priorities: Record<string, number> };
  skinIdentifier: string | null;
  skin: { avatarUrl: string; bodyUrl: string; username: string | null; cached: boolean; cachedAt: string | null } | null;
  resourceAlerts?: string[];
  inventory: Array<{ name: string; count: number }>;
  nearbyPlayers: string[];
  lastError: string | null;
  lastReason: string | null;
  viewerPort: number | null;
}

export interface LogEntry {
  at: string;
  level: string;
  botId: string;
  message: string;
}

export interface WebConfig {
  host: string;
  port: number;
  viewerPortStart: number;
  allowRawCommands: boolean;
}

interface Result {
  ok: boolean;
  message: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `Request failed: ${response.status}`);
  return body;
}

export async function fetchBots(): Promise<BotStatus[]> {
  return (await request<{ bots: BotStatus[] }>('/api/bots')).bots;
}

export async function fetchConfig(): Promise<{ bots: BotDefinition[]; web: WebConfig; defaults?: { skills: SkillSettings }; skills?: SkillOverview }> {
  return request('/api/config');
}

export interface SkillOverview {
  global: SkillSettings;
  bots: Array<{ id: string; displayName: string; skills: SkillSettings; activeSkills: string[] }>;
}

export async function fetchSkills(): Promise<SkillOverview> {
  return request('/api/skills');
}

export function updateSkills(scope: 'global' | 'bot', skills: SkillSettings, botId?: string) {
  return request<Result & { skills: SkillSettings }>('/api/skills', { method: 'PUT', body: JSON.stringify({ scope, botId, skills }) });
}

export function copySkills(sourceBotId: string, targetBotIds: string[]) {
  return request<Result>('/api/skills/copy', { method: 'POST', body: JSON.stringify({ sourceBotId, targetBotIds }) });
}

export async function fetchLogs(botId?: string): Promise<LogEntry[]> {
  const query = botId ? `?botId=${encodeURIComponent(botId)}&limit=100` : '?limit=100';
  return (await request<{ logs: LogEntry[] }>(`/api/logs${query}`)).logs;
}

export async function fetchWhitelist(botId?: string): Promise<string[]> {
  const query = botId ? `?botId=${encodeURIComponent(botId)}` : '';
  return (await request<{ whitelist: string[] }>(`/api/whitelist${query}`)).whitelist;
}

export function saveWhitelist(whitelist: string[], botId?: string) {
  return request<Result>('/api/whitelist', { method: 'PUT', body: JSON.stringify({ whitelist, botId }) });
}

export function botAction(id: string, action: 'start' | 'stop' | 'restart') {
  return request<Result>(`/api/bots/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
}

export function batchAction(action: 'start' | 'stop' | 'restart', ids: string[] = []) {
  return request<Result & { results: Array<Result & { id: string }> }>('/api/batch', {
    method: 'POST',
    body: JSON.stringify({ action, ids })
  });
}

export function setViewerPerspective(id: string, firstPerson: boolean) {
  return request<Result>(`/api/bots/${encodeURIComponent(id)}/perspective`, {
    method: 'POST',
    body: JSON.stringify({ firstPerson })
  });
}

export function sendCommand(id: string, command: string) {
  return request<Result>(`/api/bots/${encodeURIComponent(id)}/command`, {
    method: 'POST',
    body: JSON.stringify({ command })
  });
}

export function createBot(definition: Partial<BotDefinition>) {
  return request<Result>('/api/bots', { method: 'POST', body: JSON.stringify(definition) });
}

export function updateBot(id: string, definition: Partial<BotDefinition>) {
  return request<Result>(`/api/bots/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(definition) });
}

export function deleteBot(id: string) {
  return request<Result>(`/api/bots/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function configureRegion(id: string, region: { x1: number; y1: number; z1: number; z2: number; x2: number; y2: number; mode: 'blacklist' | 'whitelist'; allow: string[]; deny: string[] }) {
  return request<Result>(`/api/bots/${encodeURIComponent(id)}/region`, { method: 'PUT', body: JSON.stringify(region) });
}

export function configureSupply(id: string, points: SupplyPoint[]) {
  return request<Result & { points: SupplyPoint[] }>(`/api/bots/${encodeURIComponent(id)}/supply`, { method: 'PUT', body: JSON.stringify({ points }) });
}
