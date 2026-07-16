import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  batchAction,
  botAction,
  createBot,
  deleteBot,
  fetchBots,
  fetchConfig,
  fetchLogs,
  fetchWhitelist,
  saveWhitelist,
  sendCommand,
  updateBot,
  type BotDefinition,
  type BotStatus,
  type LogEntry,
  type WebConfig
} from './api';

const quickCommands = [
  { label: '状态', command: 'status' },
  { label: '停止动作', command: 'stop' },
  { label: '攻击 ON', command: 'kill on' },
  { label: '攻击 OFF', command: 'kill off' },
  { label: '开始钓鱼', command: 'fish' },
  { label: '回主家', command: 'home' }
];

type BotForm = {
  id: string;
  displayName: string;
  enabled: boolean;
  host: string;
  port: string;
  username: string;
  auth: string;
  version: string;
  viewerEnabled: boolean;
  viewerPort: string;
  viewerDistance: string;
  firstPerson: boolean;
};

const emptyForm: BotForm = {
  id: '', displayName: '', enabled: true, host: '', port: '25565', username: '', auth: 'microsoft', version: '',
  viewerEnabled: true, viewerPort: '', viewerDistance: '6', firstPerson: false
};

function definitionToForm(bot: BotDefinition): BotForm {
  return {
    id: bot.id,
    displayName: bot.displayName,
    enabled: bot.enabled,
    host: bot.host,
    port: String(bot.port),
    username: bot.username,
    auth: bot.auth || 'microsoft',
    version: bot.version || '',
    viewerEnabled: bot.viewer.enabled,
    viewerPort: bot.viewer.port ? String(bot.viewer.port) : '',
    viewerDistance: String(bot.viewer.viewDistance || 6),
    firstPerson: bot.viewer.firstPerson
  };
}

function App() {
  const [bots, setBots] = useState<BotStatus[]>([]);
  const [definitions, setDefinitions] = useState<BotDefinition[]>([]);
  const [webConfig, setWebConfig] = useState<WebConfig | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [whitelistText, setWhitelistText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [editorMode, setEditorMode] = useState<'add' | 'edit' | null>(null);
  const [form, setForm] = useState<BotForm>(emptyForm);

  const selected = useMemo(() => bots.find((bot) => bot.id === selectedId) || bots[0], [bots, selectedId]);
  const selectedDefinition = useMemo(() => definitions.find((bot) => bot.id === selected?.id), [definitions, selected?.id]);

  const refreshRuntime = useCallback(async () => {
    try {
      const [nextBots, nextLogs] = await Promise.all([fetchBots(), fetchLogs(selectedId || undefined)]);
      setBots(nextBots);
      setLogs(nextLogs);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法连接控制服务');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const refreshConfig = useCallback(async () => {
    const [config, whitelist] = await Promise.all([fetchConfig(), fetchWhitelist()]);
    setDefinitions(config.bots);
    setWebConfig(config.web);
    setWhitelistText(whitelist.join('\n'));
  }, []);

  useEffect(() => {
    refreshRuntime();
    refreshConfig().catch((error) => setNotice(error instanceof Error ? error.message : '配置加载失败'));
    const timer = window.setInterval(refreshRuntime, 2000);
    return () => window.clearInterval(timer);
  }, [refreshRuntime, refreshConfig]);

  async function run(action: () => Promise<unknown>, refreshDefinitions = false) {
    try {
      const result = await action() as { message?: string; results?: Array<{ ok: boolean }> };
      const failed = result.results?.filter((entry) => !entry.ok).length || 0;
      setNotice(failed ? `操作完成，但有 ${failed} 个机器人失败` : result.message || '操作完成');
      await refreshRuntime();
      if (refreshDefinitions) await refreshConfig();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败');
    }
  }

  function openAdd() {
    setForm(emptyForm);
    setEditorMode('add');
  }

  function openEdit() {
    if (!selectedDefinition) return;
    setForm(definitionToForm(selectedDefinition));
    setEditorMode('edit');
  }

  async function submitBot(event: FormEvent) {
    event.preventDefault();
    const payload = {
      id: form.id.trim(),
      displayName: form.displayName.trim() || form.id.trim(),
      enabled: form.enabled,
      host: form.host.trim(),
      port: Number(form.port),
      username: form.username.trim(),
      auth: form.auth,
      version: form.version.trim() || undefined,
      viewer: {
        enabled: form.viewerEnabled,
        port: form.viewerPort ? Number(form.viewerPort) : undefined,
        viewDistance: Number(form.viewerDistance) || 6,
        firstPerson: form.firstPerson
      }
    };
    await run(() => editorMode === 'edit' && selected ? updateBot(selected.id, payload) : createBot(payload), true);
    setEditorMode(null);
    if (editorMode === 'add') setSelectedId(payload.id);
  }

  async function submitCommand(event: FormEvent) {
    event.preventDefault();
    if (!selected || !command.trim()) return;
    const text = command.trim();
    setCommand('');
    await run(() => sendCommand(selected.id, text));
  }

  function updateForm<K extends keyof BotForm>(key: K, value: BotForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">SELF-HOSTED MINEFLAYER CONTROL</p><h1>MC Bot Control</h1></div>
        <div className="topbar-actions">
          <span className="topbar-meta"><span className="pulse" />{loading ? '连接中…' : `${bots.length} 个机器人`}</span>
          <button className="secondary" onClick={() => run(() => batchAction('start'))}>全部启动</button>
          <button className="secondary" onClick={() => run(() => batchAction('stop'))}>全部停止</button>
          <button className="primary" onClick={openAdd}>添加机器人</button>
        </div>
      </header>

      {notice && <button className="notice" onClick={() => setNotice('')}>{notice}<span>×</span></button>}
      <div className="port-note">控制面板只使用端口 <strong>{webConfig?.port || 3000}</strong>；每个启用第三方视角的机器人会从 <strong>{webConfig?.viewerPortStart || 3101}</strong> 起自动分配独立 Viewer 端口。</div>

      <section className="layout">
        <aside className="bot-list panel">
          <div className="panel-heading"><h2>机器人</h2><button className="ghost" onClick={refreshRuntime}>刷新</button></div>
          {bots.map((bot) => (
            <button className={`bot-row ${selected?.id === bot.id ? 'selected' : ''}`} key={bot.id} onClick={() => setSelectedId(bot.id)}>
              <span className={`state-dot state-${bot.state}`} />
              <span className="bot-row-copy"><strong>{bot.displayName}</strong><small>{bot.username || bot.configuredUsername}</small></span>
              <span className="state-label">{bot.enabled ? bot.state : 'disabled'}</span>
            </button>
          ))}
          {!bots.length && <p className="muted list-empty">可以直接点击“添加机器人”创建本地配置。</p>}
        </aside>

        <section className="workspace">
          {editorMode && <form className="panel editor" onSubmit={submitBot}>
            <div className="panel-heading"><div><p className="eyebrow">BOT CONFIGURATION</p><h2>{editorMode === 'add' ? '添加机器人' : `编辑 ${form.displayName}`}</h2></div><button type="button" className="ghost" onClick={() => setEditorMode(null)}>关闭</button></div>
            <div className="form-grid">
              <label>ID<input value={form.id} disabled={editorMode === 'edit'} onChange={(event) => updateForm('id', event.target.value)} required placeholder="musashi" /></label>
              <label>显示名<input value={form.displayName} onChange={(event) => updateForm('displayName', event.target.value)} placeholder="Musashi" /></label>
              <label className="wide">服务器地址<input value={form.host} onChange={(event) => updateForm('host', event.target.value)} required placeholder="mc.example.com" /></label>
              <label>游戏端口<input type="number" min="1" max="65535" value={form.port} onChange={(event) => updateForm('port', event.target.value)} required /></label>
              <label>游戏版本<input value={form.version} onChange={(event) => updateForm('version', event.target.value)} placeholder="留空自动检测" /></label>
              <label className="wide">账号 / 用户名<input value={form.username} onChange={(event) => updateForm('username', event.target.value)} required placeholder="Microsoft 邮箱或离线用户名" /></label>
              <label>认证方式<select value={form.auth} onChange={(event) => updateForm('auth', event.target.value)}><option value="microsoft">microsoft</option><option value="offline">offline</option><option value="mojang">mojang</option></select></label>
              <label>Viewer 端口<input type="number" min="1" max="65535" value={form.viewerPort} onChange={(event) => updateForm('viewerPort', event.target.value)} placeholder="留空自动分配" disabled={!form.viewerEnabled} /></label>
              <label>Viewer 距离<input type="number" min="2" max="32" value={form.viewerDistance} onChange={(event) => updateForm('viewerDistance', event.target.value)} disabled={!form.viewerEnabled} /></label>
              <label className="check"><input type="checkbox" checked={form.enabled} onChange={(event) => updateForm('enabled', event.target.checked)} />允许启动</label>
              <label className="check"><input type="checkbox" checked={form.viewerEnabled} onChange={(event) => updateForm('viewerEnabled', event.target.checked)} />启用第三方视角</label>
              <label className="check"><input type="checkbox" checked={form.firstPerson} onChange={(event) => updateForm('firstPerson', event.target.checked)} disabled={!form.viewerEnabled} />第一人称 Viewer</label>
            </div>
            <div className="form-actions"><button type="button" className="secondary" onClick={() => setEditorMode(null)}>取消</button><button className="primary">保存到本地配置</button></div>
          </form>}

          {selected ? <>
            <div className="panel hero">
              <div><p className="eyebrow">BOT PROFILE</p><h2>{selected.displayName}</h2><p className="muted">{selected.host}:{selected.port} · {selected.username || '尚未登录'} · {selected.state}</p></div>
              <div className="hero-actions">
                {selected.state === 'stopped' ? <button className="primary" onClick={() => run(() => botAction(selected.id, 'start'))}>启动</button> : <button className="danger" onClick={() => run(() => botAction(selected.id, 'stop'))}>停止</button>}
                <button className="secondary" onClick={() => run(() => botAction(selected.id, 'restart'))}>重启</button>
                <button className="secondary" disabled={selected.state !== 'stopped'} onClick={openEdit}>编辑</button>
                <button className="danger subtle" disabled={selected.state !== 'stopped'} onClick={() => { if (window.confirm(`删除 ${selected.displayName}？认证缓存不会删除。`)) run(() => deleteBot(selected.id), true); }}>删除</button>
                {selected.state === 'online' && selected.viewerPort && <a className="secondary" href={`http://${window.location.hostname}:${selected.viewerPort}`} target="_blank" rel="noreferrer">第三方视角 :{selected.viewerPort}</a>}
              </div>
            </div>

            <div className="stats-grid">
              <div className="panel stat"><span>生命</span><strong>{selected.health ?? '—'}</strong></div>
              <div className="panel stat"><span>饥饿</span><strong>{selected.food ?? '—'}</strong></div>
              <div className="panel stat"><span>坐标</span><strong>{selected.position ? `${selected.position.x}, ${selected.position.y}, ${selected.position.z}` : '—'}</strong></div>
              <div className="panel stat"><span>任务</span><strong>{selected.killAura ? '攻击中' : selected.fishing ? '钓鱼中' : '待命'}</strong></div>
            </div>

            <div className="panel command-panel">
              <div className="panel-heading"><div><h2>统一命令控制台</h2><p className="muted">这里和游戏内聊天调用同一套机器人命令</p></div></div>
              <div className="quick-actions">{quickCommands.map((item) => <button className="secondary" key={item.command} onClick={() => run(() => sendCommand(selected.id, item.command))}>{item.label}</button>)}</div>
              <form className="command-form" onSubmit={submitCommand}><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="例如：home base / follow PlayerName / cmd /say hello" /><button className="primary">发送</button></form>
              <p className="command-help">游戏内可用：<code>Musashi_Chan come</code> 或 <code>come Musashi_Chan</code>；<code>all</code> 可广播给全部机器人。</p>
            </div>

            <div className="two-col">
              <div className="panel detail"><h3>背包摘要</h3>{selected.inventory.length ? <ul>{selected.inventory.map((item) => <li key={item.name}><span>{item.name}</span><strong>x{item.count}</strong></li>)}</ul> : <p className="muted">暂无数据</p>}</div>
              <div className="panel detail"><h3>附近玩家</h3>{selected.nearbyPlayers.length ? <p>{selected.nearbyPlayers.join('、')}</p> : <p className="muted">暂无可见玩家</p>}{selected.lastError && <p className="error-text">{selected.lastError}</p>}{selected.lastReason && <p className="muted reason">上次断开：{selected.lastReason}</p>}</div>
            </div>

            <div className="two-col admin-grid">
              <div className="panel detail whitelist-panel">
                <h3>游戏内命令白名单</h3><p className="muted">每行一个玩家名，不区分大小写。</p>
                <textarea value={whitelistText} onChange={(event) => setWhitelistText(event.target.value)} placeholder="PlayerName" />
                <button className="primary" onClick={() => run(() => saveWhitelist(whitelistText.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean)), true)}>保存白名单</button>
              </div>
              <div className="panel detail log-panel"><div className="log-heading"><h3>最近日志</h3><button className="ghost" onClick={refreshRuntime}>刷新</button></div><div className="logs">{logs.length ? logs.map((entry, index) => <div className={`log log-${entry.level}`} key={`${entry.at}-${index}`}><time>{new Date(entry.at).toLocaleTimeString()}</time><span>{entry.message}</span></div>) : <p className="muted">暂无日志</p>}</div></div>
            </div>
          </> : <div className="panel empty"><h2>还没有机器人</h2><p>点击“添加机器人”，Web 会写入被 Git 忽略的本地配置文件。</p><button className="primary" onClick={openAdd}>添加第一个机器人</button></div>}
        </section>
      </section>
    </main>
  );
}

export default App;
