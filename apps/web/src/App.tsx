import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { botAction, fetchBots, sendCommand, type BotStatus } from './api';

const quickCommands = [
  { label: '状态', command: 'status' },
  { label: '停止动作', command: 'stop' },
  { label: '攻击 ON', command: 'kill on' },
  { label: '攻击 OFF', command: 'kill off' },
  { label: '开始钓鱼', command: 'fish' }
];

function App() {
  const [bots, setBots] = useState<BotStatus[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setBots(await fetchBots());
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法连接控制服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selected = useMemo(() => bots.find((bot) => bot.id === selectedId) || bots[0], [bots, selectedId]);

  async function run(action: () => Promise<unknown>) {
    try {
      const result = await action() as { message?: string };
      setNotice(result.message || '操作完成');
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败');
    }
  }

  async function submitCommand(event: FormEvent) {
    event.preventDefault();
    if (!selected || !command.trim()) return;
    const text = command.trim();
    setCommand('');
    await run(() => sendCommand(selected.id, text));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SELF-HOSTED MINEFLAYER CONTROL</p>
          <h1>MC Bot Control</h1>
        </div>
        <div className="topbar-meta"><span className="pulse" />{loading ? '连接中…' : `${bots.length} 个机器人`}</div>
      </header>

      {notice && <div className="notice">{notice}</div>}
      <section className="layout">
        <aside className="bot-list panel">
          <div className="panel-heading"><h2>机器人</h2><button className="ghost" onClick={refresh}>刷新</button></div>
          {bots.map((bot) => (
            <button className={`bot-row ${selected?.id === bot.id ? 'selected' : ''}`} key={bot.id} onClick={() => setSelectedId(bot.id)}>
              <span className={`state-dot state-${bot.state}`} />
              <span className="bot-row-copy"><strong>{bot.displayName}</strong><small>{bot.username || bot.state}</small></span>
              <span className="state-label">{bot.state}</span>
            </button>
          ))}
          {!bots.length && <p className="muted">没有加载到机器人，请检查 config/bots.local.json。</p>}
        </aside>

        <section className="workspace">
          {selected ? <>
            <div className="panel hero">
              <div><p className="eyebrow">BOT PROFILE</p><h2>{selected.displayName}</h2><p className="muted">{selected.username || '尚未登录'} · {selected.state}</p></div>
              <div className="hero-actions">
                {selected.state === 'stopped' ? <button className="primary" onClick={() => run(() => botAction(selected.id, 'start'))}>启动</button> : <button className="danger" onClick={() => run(() => botAction(selected.id, 'stop'))}>停止</button>}
                {selected.state === 'online' && selected.viewerPort && <a className="secondary" href={`http://${window.location.hostname}:${selected.viewerPort}`} target="_blank" rel="noreferrer">打开第三方视角</a>}
              </div>
            </div>

            <div className="stats-grid">
              <div className="panel stat"><span>生命</span><strong>{selected.health ?? '—'}</strong></div>
              <div className="panel stat"><span>饥饿</span><strong>{selected.food ?? '—'}</strong></div>
              <div className="panel stat"><span>坐标</span><strong>{selected.position ? `${selected.position.x}, ${selected.position.y}, ${selected.position.z}` : '—'}</strong></div>
              <div className="panel stat"><span>状态</span><strong>{selected.killAura ? '攻击中' : selected.fishing ? '钓鱼中' : '待命'}</strong></div>
            </div>

            <div className="panel command-panel">
              <div className="panel-heading"><div><h2>控制台</h2><p className="muted">快捷操作或输入已有命令</p></div></div>
              <div className="quick-actions">{quickCommands.map((item) => <button className="secondary" key={item.command} onClick={() => run(() => sendCommand(selected.id, item.command))}>{item.label}</button>)}</div>
              <form className="command-form" onSubmit={submitCommand}><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="例如：home base / follow PlayerName / cmd /say hello" /><button className="primary">发送</button></form>
            </div>

            <div className="two-col">
              <div className="panel detail"><h3>背包摘要</h3>{selected.inventory.length ? <ul>{selected.inventory.map((item) => <li key={item.name}><span>{item.name}</span><strong>x{item.count}</strong></li>)}</ul> : <p className="muted">暂无数据</p>}</div>
              <div className="panel detail"><h3>附近玩家</h3>{selected.nearbyPlayers.length ? <p>{selected.nearbyPlayers.join('、')}</p> : <p className="muted">暂无可见玩家</p>}{selected.lastError && <p className="error-text">{selected.lastError}</p>}</div>
            </div>
          </> : <div className="panel empty"><h2>等待机器人配置</h2><p>复制 config/bots.example.json 为 config/bots.local.json 后再启动控制服务。</p></div>}
        </section>
      </section>
    </main>
  );
}

export default App;


