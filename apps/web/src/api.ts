export type BotState = 'stopped' | 'connecting' | 'online' | 'reconnecting' | 'error';

export interface BotStatus {
  id: string;
  displayName: string;
  state: BotState;
  username: string | null;
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
  const data = await request<{ bots: BotStatus[] }>('/api/bots');
  return data.bots;
}

export function botAction(id: string, action: 'start' | 'stop') {
  return request<{ ok: boolean; message: string }>(`/api/bots/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
}

export function sendCommand(id: string, command: string) {
  return request<{ ok: boolean; message: string }>(`/api/bots/${encodeURIComponent(id)}/command`, {
    method: 'POST',
    body: JSON.stringify({ command })
  });
}
