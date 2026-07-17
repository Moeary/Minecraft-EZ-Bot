export type BotState = 'stopped' | 'connecting' | 'online' | 'reconnecting' | 'error';

export interface ViewerConfig {
  enabled: boolean;
  port?: number;
  viewDistance: number;
  firstPerson: boolean;
}

export interface BotDefinition {
  id: string;
  displayName: string;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  auth: string;
  version: string;
  viewer: ViewerConfig;
  commandWhitelist?: string[] | null;
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
  killAura: boolean;
  fishing: boolean;
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

export async function fetchConfig(): Promise<{ bots: BotDefinition[]; web: WebConfig }> {
  return request('/api/config');
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
