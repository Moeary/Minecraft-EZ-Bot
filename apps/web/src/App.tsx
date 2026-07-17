import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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

type View = 'overview' | 'bots' | 'skills' | 'detail';
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

const quickCommands = [
  { label: '状态', command: 'status' },
  { label: '停止动作', command: 'stop' },
  { label: '攻击 ON', command: 'kill on' },
  { label: '攻击 OFF', command: 'kill off' },
  { label: '开始钓鱼', command: 'fish' },
  { label: '回主家', command: 'home' }
];

const skills = [
  { icon: '⚔', name: '基础战斗', key: 'combat', description: '自动装备武器、锁定附近敌对生物并进行定点攻击。', commands: ['kill on', 'kill off', 'stop'], status: '已启用' },
  { icon: '⌁', name: '自动钓鱼', key: 'fishing', description: '寻找鱼竿并进入持续钓鱼循环，适合挂机收集食物与经验。', commands: ['fish', 'stop'], status: '已启用' },
  { icon: '◎', name: '跟随与导航', key: 'pathfinder', description: '跟随指定玩家、前往家的坐标，并避开不可行走区域。', commands: ['follow <玩家>', 'come <玩家>', 'home <名称>'], status: '已启用' },
  { icon: '▣', name: '聊天指令', key: 'chat-command', description: '按机器人独立白名单接收游戏内指令，默认拒绝陌生玩家。', commands: ['status', 'info on/off'], status: '安全策略' },
  { icon: '✦', name: 'OpenAI 工具链（预留）', key: 'openai-tools', description: '为未来的自然语言对话准备工具声明与执行边界，当前不会调用模型。', commands: ['tool schema', 'approval gate'], status: '规划中' }
];

const emptyForm: BotForm = {
  id: '', displayName: '', enabled: true, host: '', port: '25565', username: '', auth: 'microsoft', version: '',
  viewerEnabled: true, viewerPort: '', viewerDistance: '6', firstPerson: false
};

function definitionToForm(bot: BotDefinition): BotForm {
  return {
    id: bot.id, displayName: bot.displayName, enabled: bot.enabled, host: bot.host, port: String(bot.port),
    username: bot.username, auth: bot.auth || 'microsoft', version: bot.version || '', viewerEnabled: bot.viewer.enabled,
    viewerPort: bot.viewer.port ? String(bot.viewer.port) : '', viewerDistance: String(bot.viewer.viewDistance || 6), firstPerson: bot.viewer.firstPerson
  };
}

function Icon({ children }: { children: ReactNode }) {
  return <span className="nav-icon" aria-hidden="true">{children}</span>;
}

function stateLabel(state: BotStatus['state']) {
  return ({ online: '在线', connecting: '连接中', reconnecting: '重连中', error: '异常', stopped: '已停止' })[state];
}

function App() {
  const [view, setView] = useState<View>('overview');
  const [bots, setBots] = useState<BotStatus[]>([]);
  const [definitions, setDefinitions] = useState<BotDefinition[]>([]);
  const [webConfig, setWebConfig] = useState<WebConfig | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [editorMode, setEditorMode] = useState<'add' | 'edit' | null>(null);
  const [form, setForm] = useState<BotForm>(emptyForm);
  const [previewMode, setPreviewMode] = useState<'status' | 'viewer'>('status');

  const selected = useMemo(() => bots.find((bot) => bot.id === selectedId) || bots[0], [bots, selectedId]);
  const selectedDefinition = useMemo(() => definitions.find((bot) => bot.id === selected?.id), [definitions, selected?.id]);
  const onlineCount = bots.filter((bot) => bot.state === 'online').length;
  const activeCount = bots.filter((bot) => bot.state === 'online' || bot.state === 'connecting' || bot.state === 'reconnecting').length;

  const refreshRuntime = useCallback(async () => {
    try {
      const [nextBots, nextLogs] = await Promise.all([fetchBots(), fetchLogs(selectedId || undefined)]);
      setBots(nextBots);
      setLogs(nextLogs);
      if (!selectedId && nextBots[0]) setSelectedId(nextBots[0].id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法连接控制服务');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const refreshConfig = useCallback(async () => {
    const [config, nextWhitelist] = await Promise.all([fetchConfig(), fetchWhitelist(selectedId || undefined)]);
    setDefinitions(config.bots);
    setWebConfig(config.web);
    setWhitelist(nextWhitelist);
  }, [selectedId]);

  useEffect(() => {
    refreshRuntime();
    refreshConfig().catch((error) => setNotice(error instanceof Error ? error.message : '配置加载失败'));
    const timer = window.setInterval(refreshRuntime, 2500);
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

  function selectBot(id: string) {
    setSelectedId(id);
    setView('detail');
  }

  function openAdd() { setForm(emptyForm); setEditorMode('add'); setView('bots'); }
  function openEdit() { if (selectedDefinition) { setForm(definitionToForm(selectedDefinition)); setEditorMode('edit'); setView('bots'); } }
  function updateForm<K extends keyof BotForm>(key: K, value: BotForm[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function submitBot(event: FormEvent) {
    event.preventDefault();
    const payload = {
      id: form.id.trim(), displayName: form.displayName.trim() || form.id.trim(), enabled: form.enabled,
      host: form.host.trim(), port: Number(form.port), username: form.username.trim(), auth: form.auth,
      version: form.version.trim() || undefined,
      viewer: { enabled: form.viewerEnabled, port: form.viewerPort ? Number(form.viewerPort) : undefined, viewDistance: Number(form.viewerDistance) || 6, firstPerson: form.firstPerson }
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

  async function saveSelectedWhitelist() {
    if (!selected) return;
    await run(() => saveWhitelist(whitelist, selected.id), true);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const viewerUrl = selected?.viewerPort ? `http://${window.location.hostname}:${selected.viewerPort}` : '';

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">✦</div><div><strong>MC BOT</strong><span>CONTROL CENTER</span></div></div>
        <div className="workspace-switch"><span className="server-orb" /><div><small>当前工作区</small><strong>自托管服务器</strong></div><span className="chevron">⌄</span></div>
        <nav className="sidebar-nav">
          <p className="nav-caption">工作台</p>
          <button className={view === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => setView('overview')}><Icon>⌂</Icon>总览<span className="nav-shortcut">01</span></button>
          <button className={view === 'bots' ? 'nav-item active' : 'nav-item'} onClick={() => setView('bots')}><Icon>♟</Icon>机器人管理<span className="nav-count">{bots.length}</span></button>
          <button className={view === 'skills' ? 'nav-item active' : 'nav-item'} onClick={() => setView('skills')}><Icon>✦</Icon>技能中心<span className="nav-shortcut">03</span></button>
          <button className={view === 'detail' ? 'nav-item active' : 'nav-item'} onClick={() => setView('detail')} disabled={!selected}><Icon>▣</Icon>详情预览<span className="nav-shortcut">04</span></button>
          <p className="nav-caption second">系统</p>
          <button className="nav-item" onClick={() => setView('bots')}><Icon>⚙</Icon>连接与认证</button>
          <button className="nav-item" onClick={() => setView('skills')}><Icon>?</Icon>帮助与规范</button>
        </nav>
        <div className="sidebar-bots"><div className="sidebar-bots-title"><span>运行中的机器人</span><button onClick={() => setView('bots')}>全部</button></div>{bots.slice(0, 4).map((bot) => <button className="mini-bot" key={bot.id} onClick={() => selectBot(bot.id)}><span className={`state-dot state-${bot.state}`} /><span><strong>{bot.displayName}</strong><small>{bot.state === 'online' ? (bot.killAura ? '战斗中' : bot.fishing ? '钓鱼中' : '待命') : stateLabel(bot.state)}</small></span><b>›</b></button>)}</div>
        <div className="sidebar-footer"><div className="user-avatar">A</div><div><strong>管理员</strong><small>本地控制台</small></div><span className="more">•••</span></div>
      </aside>

      <section className="content-shell">
        <header className="topbar"><div className="breadcrumbs"><span>MC BOT</span><b>/</b><strong>{view === 'overview' ? '总览' : view === 'bots' ? '机器人管理' : view === 'skills' ? '技能中心' : '详情预览'}</strong></div><div className="topbar-tools"><div className="connection-indicator"><span className="pulse" />{loading ? '连接中…' : '控制服务正常'}</div><button className="icon-button" title="刷新" onClick={refreshRuntime}>↻</button><button className="primary top-action" onClick={openAdd}>＋ 添加机器人</button></div></header>
        {notice && <button className="notice" onClick={() => setNotice('')}><span>✓</span>{notice}<b>×</b></button>}
        <div className="page-content">
          {view === 'overview' && <Overview bots={bots} onlineCount={onlineCount} activeCount={activeCount} selected={selected} selectBot={selectBot} setView={setView} logs={logs} webConfig={webConfig} />}
          {view === 'bots' && <BotManagement bots={bots} selectedIds={selectedIds} toggleSelection={toggleSelection} selectAll={() => setSelectedIds(selectedIds.length === bots.length ? [] : bots.map((bot) => bot.id))} setSelectedIds={setSelectedIds} run={run} openAdd={openAdd} openEdit={openEdit} selected={selected} editorMode={editorMode} setEditorMode={setEditorMode} form={form} updateForm={updateForm} submitBot={submitBot} deleteBot={deleteBot} setSelectedId={setSelectedId} />}
          {view === 'skills' && <SkillsPage />}
          {view === 'detail' && selected && <DetailPage selected={selected} selectedDefinition={selectedDefinition} logs={logs} whitelist={whitelist} setWhitelist={setWhitelist} saveSelectedWhitelist={saveSelectedWhitelist} command={command} setCommand={setCommand} submitCommand={submitCommand} run={run} previewMode={previewMode} setPreviewMode={setPreviewMode} viewerUrl={viewerUrl} openEdit={openEdit} />}
          {view === 'detail' && !selected && <EmptyState openAdd={openAdd} />}
        </div>
      </section>
    </main>
  );
}

function Overview({ bots, onlineCount, activeCount, selected, selectBot, setView, logs, webConfig }: { bots: BotStatus[]; onlineCount: number; activeCount: number; selected?: BotStatus; selectBot: (id: string) => void; setView: (view: View) => void; logs: LogEntry[]; webConfig: WebConfig | null }) {
  return <><div className="page-heading"><div><span className="eyebrow">服务器控制台 / OVERVIEW</span><h1>早上好，管理员 <span className="heading-spark">✦</span></h1><p>从这里掌握所有 Mineflayer 机器人的运行状态与任务进度。</p></div><div className="heading-meta"><span className="live-dot" />实时同步 <b>·</b> 每 2.5 秒</div></div>
    <div className="overview-grid"><MetricCard label="机器人总数" value={bots.length} hint={`${activeCount} 个已启用`} icon="♟" tone="green" /><MetricCard label="在线机器人" value={onlineCount} hint={bots.length ? `${Math.round((onlineCount / bots.length) * 100)}% 在线率` : '等待添加机器人'} icon="⌁" tone="mint" /><MetricCard label="正在执行" value={bots.filter((bot) => bot.killAura || bot.fishing).length} hint="战斗 / 钓鱼任务" icon="⚡" tone="yellow" /><MetricCard label="控制服务" value={webConfig?.port || '—'} hint={`Viewer 起始端口 ${webConfig?.viewerPortStart || '—'}`} icon="◈" tone="blue" /></div>
    <div className="section-heading"><div><span className="eyebrow">RUNTIME BOARD</span><h2>机器人状态</h2></div><button className="text-button" onClick={() => setView('bots')}>管理全部 →</button></div>
    <div className="bot-cards">{bots.length ? bots.map((bot) => <BotOverviewCard key={bot.id} bot={bot} onClick={() => selectBot(bot.id)} />) : <EmptyState openAdd={() => setView('bots')} />}</div>
    <div className="overview-bottom"><div className="card activity-card"><div className="card-header"><div><span className="eyebrow">ACTIVITY STREAM</span><h3>最近活动</h3></div><span className="soft-badge">实时</span></div>{logs.length ? logs.slice(-5).reverse().map((log, index) => <div className="activity-row" key={`${log.at}-${index}`}><span className={`activity-icon ${log.level}`}>{log.level === 'error' ? '!' : '✓'}</span><div><strong>{log.message}</strong><small>{log.botId} · {new Date(log.at).toLocaleTimeString()}</small></div></div>) : <p className="muted">连接机器人后，运行日志会显示在这里。</p>}</div><div className="card insight-card"><div className="insight-art">✦</div><span className="eyebrow">OPERATIONS TIP</span><h3>为每个机器人设置独立白名单</h3><p>将管理权限按机器人拆分，避免一个玩家意外控制所有实例。</p><button className="secondary" onClick={() => selected && selectBot(selected.id)}>查看当前机器人</button></div></div>
  </>;
}

function MetricCard({ label, value, hint, icon, tone }: { label: string; value: string | number; hint: string; icon: string; tone: string }) { return <div className={`metric-card tone-${tone}`}><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
function BotOverviewCard({ bot, onClick }: { bot: BotStatus; onClick: () => void }) { const task = bot.killAura ? '战斗模式' : bot.fishing ? '自动钓鱼' : bot.state === 'online' ? '空闲待命' : stateLabel(bot.state); return <button className="bot-overview-card" onClick={onClick}><div className="bot-card-top"><span className={`state-pill ${bot.state}`}><i />{stateLabel(bot.state)}</span><span className="card-arrow">↗</span></div><div className="bot-identity"><div className="bot-avatar">{bot.displayName.slice(0, 1).toUpperCase()}</div><div><h3>{bot.displayName}</h3><p>{bot.host}:{bot.port}</p></div></div><div className="task-line"><span className="task-icon">{bot.killAura ? '⚔' : bot.fishing ? '⌁' : '◌'}</span><span>{task}</span><b>{bot.username || bot.configuredUsername}</b></div><div className="health-bars"><span><i style={{ width: `${Math.min(100, (bot.health || 0) / 20 * 100)}%` }} /></span><small>生命 {bot.health ?? '—'}</small><span><i style={{ width: `${Math.min(100, (bot.food || 0) / 20 * 100)}%` }} /></span><small>饱食 {bot.food ?? '—'}</small></div></button>; }

function BotManagement(props: { bots: BotStatus[]; selectedIds: string[]; toggleSelection: (id: string) => void; selectAll: () => void; setSelectedIds: (ids: string[]) => void; run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>; openAdd: () => void; openEdit: () => void; selected?: BotStatus; editorMode: 'add' | 'edit' | null; setEditorMode: (mode: 'add' | 'edit' | null) => void; form: BotForm; updateForm: <K extends keyof BotForm>(key: K, value: BotForm[K]) => void; submitBot: (event: FormEvent) => Promise<void>; deleteBot: (id: string) => Promise<unknown>; setSelectedId: (id: string) => void }) {
  const { bots, selectedIds, toggleSelection, selectAll, setSelectedIds, run, openAdd, openEdit, selected, editorMode, setEditorMode, form, updateForm, submitBot, deleteBot, setSelectedId } = props;
  return <><div className="page-heading compact"><div><span className="eyebrow">CONFIGURATION / BOTS</span><h1>机器人管理</h1><p>创建、配置和批量控制你的 Minecraft bot 集群。</p></div><button className="primary" onClick={openAdd}>＋ 新建机器人</button></div><div className="management-toolbar"><div className="search-box">⌕<input placeholder="搜索机器人名称、地址或账号…" /></div><div className="toolbar-actions"><button className="secondary" disabled={!selectedIds.length} onClick={() => run(() => batchAction('start', selectedIds))}>▶ 批量启动</button><button className="secondary" disabled={!selectedIds.length} onClick={() => run(() => batchAction('stop', selectedIds))}>■ 批量停止</button><button className="icon-button">☷</button></div></div>{selectedIds.length > 0 && <div className="selection-bar"><span>已选择 <b>{selectedIds.length}</b> 个机器人</span><button onClick={() => setSelectedIds([])}>清除选择</button></div>}<div className="table-card"><div className="table-head"><label className="check-wrap"><input type="checkbox" checked={bots.length > 0 && selectedIds.length === bots.length} onChange={selectAll} /><span /></label><span>机器人</span><span>连接服务器</span><span>认证账号</span><span>状态 / 任务</span><span>操作</span></div>{bots.map((bot) => <div className={`bot-table-row ${selected?.id === bot.id ? 'selected-row' : ''}`} key={bot.id}><label className="check-wrap"><input type="checkbox" checked={selectedIds.includes(bot.id)} onChange={() => toggleSelection(bot.id)} /><span /></label><button className="table-bot" onClick={() => setSelectedId(bot.id)}><div className="bot-avatar small">{bot.displayName.slice(0, 1).toUpperCase()}</div><div><strong>{bot.displayName}</strong><small>ID: {bot.id}</small></div></button><div><strong>{bot.host}</strong><small>端口 {bot.port} · {bot.version || '自动版本'}</small></div><div><strong>{bot.configuredUsername || '未设置'}</strong><small><span className="auth-tag">{bot.auth || 'microsoft'}</span> {bot.viewerPort ? `· Viewer :${bot.viewerPort}` : ''}</small></div><div><span className={`state-pill ${bot.state}`}><i />{stateLabel(bot.state)}</span><small>{bot.killAura ? '战斗中' : bot.fishing ? '钓鱼中' : '待命'}</small></div><div className="row-actions"><button className="icon-button" title="详情" onClick={() => setSelectedId(bot.id)}>↗</button><button className="icon-button" title="启动/停止" onClick={() => run(() => botAction(bot.id, bot.state === 'stopped' ? 'start' : 'stop'))}>{bot.state === 'stopped' ? '▶' : '■'}</button></div></div>)}{!bots.length && <EmptyState openAdd={openAdd} />}</div>{editorMode && <BotEditor editorMode={editorMode} setEditorMode={setEditorMode} form={form} updateForm={updateForm} submitBot={submitBot} />}{selected && !editorMode && <div className="management-footer"><div><span className="eyebrow">SELECTED BOT</span><strong>{selected.displayName}</strong><small>上次选择的机器人 · {stateLabel(selected.state)}</small></div><button className="secondary" onClick={openEdit}>编辑配置</button><button className="danger-button" disabled={selected.state !== 'stopped'} onClick={() => { if (window.confirm(`删除 ${selected.displayName}？认证缓存会保留。`)) run(() => deleteBot(selected.id), true); }}>删除</button></div>}</>;
}

function BotEditor({ editorMode, setEditorMode, form, updateForm, submitBot }: { editorMode: 'add' | 'edit'; setEditorMode: (mode: 'add' | 'edit' | null) => void; form: BotForm; updateForm: <K extends keyof BotForm>(key: K, value: BotForm[K]) => void; submitBot: (event: FormEvent) => Promise<void> }) { return <form className="editor-drawer" onSubmit={submitBot}><div className="drawer-head"><div><span className="eyebrow">BOT PROFILE / {editorMode.toUpperCase()}</span><h2>{editorMode === 'add' ? '创建一个新机器人' : '编辑机器人配置'}</h2></div><button type="button" className="icon-button" onClick={() => setEditorMode(null)}>×</button></div><div className="editor-section"><h3>基础信息</h3><div className="form-grid"><label>机器人 ID<input value={form.id} disabled={editorMode === 'edit'} onChange={(event) => updateForm('id', event.target.value)} required placeholder="yukikaze" /></label><label>显示名称<input value={form.displayName} onChange={(event) => updateForm('displayName', event.target.value)} placeholder="Yukikaze" /></label><label className="wide">服务器地址<input value={form.host} onChange={(event) => updateForm('host', event.target.value)} required placeholder="mc.example.com" /></label><label>游戏端口<input type="number" min="1" max="65535" value={form.port} onChange={(event) => updateForm('port', event.target.value)} required /></label><label>游戏版本<input value={form.version} onChange={(event) => updateForm('version', event.target.value)} placeholder="自动检测" /></label></div></div><div className="editor-section"><h3>登录与认证</h3><div className="form-grid"><label className="wide">账号 / 用户名<input value={form.username} onChange={(event) => updateForm('username', event.target.value)} required placeholder="Microsoft 邮箱或离线用户名" /><small className="field-hint">Microsoft 登录缓存会按 bot ID 独立保存在 data/auth/ 下。</small></label><label>认证方式<select value={form.auth} onChange={(event) => updateForm('auth', event.target.value)}><option value="microsoft">Microsoft OAuth</option><option value="offline">离线 / Cracked</option><option value="mojang">Mojang（兼容）</option></select></label><label>第三方验证<select defaultValue="auto"><option value="auto">自动处理（推荐）</option><option value="manual">手动确认</option><option value="none">不启用</option></select></label></div><div className="security-note">▣ 认证状态由 Mineflayer authflow 管理。首次登录请在终端完成设备码验证，不要把 token 提交到 Git。</div></div><div className="editor-section"><h3>Viewer 预览</h3><div className="form-grid"><label>Viewer 端口<input type="number" min="1" max="65535" value={form.viewerPort} onChange={(event) => updateForm('viewerPort', event.target.value)} placeholder="自动分配" disabled={!form.viewerEnabled} /></label><label>视距<input type="number" min="2" max="32" value={form.viewerDistance} onChange={(event) => updateForm('viewerDistance', event.target.value)} disabled={!form.viewerEnabled} /></label><label className="toggle-row"><input type="checkbox" checked={form.enabled} onChange={(event) => updateForm('enabled', event.target.checked)} /><span />允许自动启动</label><label className="toggle-row"><input type="checkbox" checked={form.viewerEnabled} onChange={(event) => updateForm('viewerEnabled', event.target.checked)} /><span />启用内嵌 Viewer</label><label className="toggle-row"><input type="checkbox" checked={form.firstPerson} onChange={(event) => updateForm('firstPerson', event.target.checked)} disabled={!form.viewerEnabled} /><span />默认第一人称</label></div></div><div className="drawer-actions"><button type="button" className="secondary" onClick={() => setEditorMode(null)}>取消</button><button className="primary">保存到本地配置</button></div></form>; }

function SkillsPage() { return <><div className="page-heading compact"><div><span className="eyebrow">AUTOMATION / SKILLS</span><h1>技能中心</h1><p>每项技能都是独立模块，声明指令、能力边界与未来的 OpenAI 工具链。</p></div><span className="soft-badge large">5 个技能模块</span></div><div className="skills-notice"><div className="notice-icon">✦</div><div><strong>模块化设计已就绪</strong><p>后续新增技能只需在 <code>apps/server/src/core/skills/</code> 添加独立 JS 文件，再注册到技能目录。</p></div><span className="status-chip">对话功能暂未启用</span></div><div className="skills-grid">{skills.map((skill) => <article className="skill-card" key={skill.key}><div className="skill-card-top"><span className="skill-icon">{skill.icon}</span><span className="status-chip">{skill.status}</span></div><h3>{skill.name}</h3><p>{skill.description}</p><div className="skill-commands">{skill.commands.map((command) => <code key={command}>{command}</code>)}</div><div className="skill-card-foot"><span>模块文件</span><strong>{skill.key}.js</strong><button className="icon-button">↗</button></div></article>)}</div></>; }

function DetailPage({ selected, selectedDefinition, logs, whitelist, setWhitelist, saveSelectedWhitelist, command, setCommand, submitCommand, run, previewMode, setPreviewMode, viewerUrl, openEdit }: { selected: BotStatus; selectedDefinition?: BotDefinition; logs: LogEntry[]; whitelist: string[]; setWhitelist: (names: string[]) => void; saveSelectedWhitelist: () => Promise<void>; command: string; setCommand: (value: string) => void; submitCommand: (event: FormEvent) => Promise<void>; run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void>; previewMode: 'status' | 'viewer'; setPreviewMode: (mode: 'status' | 'viewer') => void; viewerUrl: string; openEdit: () => void }) { const inventory = selected.inventory || []; const switchPerspective = (firstPerson: boolean) => { if (!selectedDefinition || selected.state !== 'stopped') return; run(() => updateBot(selected.id, { viewer: { ...selectedDefinition.viewer, firstPerson } }), true); }; return <><div className="page-heading compact"><div><span className="eyebrow">BOT DETAIL / LIVE MONITOR</span><h1>{selected.displayName} <span className={`state-pill inline ${selected.state}`}><i />{stateLabel(selected.state)}</span></h1><p>{selected.host}:{selected.port} · {selected.username || selected.configuredUsername} · {selected.auth || 'microsoft'}</p></div><div className="heading-buttons"><button className="secondary" onClick={openEdit}>编辑配置</button><button className={selected.state === 'stopped' ? 'primary' : 'danger-button'} onClick={() => run(() => botAction(selected.id, selected.state === 'stopped' ? 'start' : 'stop'))}>{selected.state === 'stopped' ? '▶ 启动' : '■ 停止'}</button></div></div><div className="detail-layout"><div className="detail-main"><div className="card preview-card"><div className="card-header"><div><span className="eyebrow">LIVE PREVIEW</span><h2>实时预览</h2></div><div className="preview-controls"><div className="segmented"><button className={previewMode === 'status' ? 'active' : ''} onClick={() => setPreviewMode('status')}>状态面板</button><button className={previewMode === 'viewer' ? 'active' : ''} onClick={() => setPreviewMode('viewer')} disabled={!viewerUrl}>3D Viewer</button></div>{previewMode === 'viewer' && <div className="perspective-toggle"><button className={!selectedDefinition?.viewer.firstPerson ? 'active' : ''} disabled={selected.state !== 'stopped'} onClick={() => switchPerspective(false)}>第三人称</button><button className={selectedDefinition?.viewer.firstPerson ? 'active' : ''} disabled={selected.state !== 'stopped'} onClick={() => switchPerspective(true)}>第一人称</button></div>}</div></div>{previewMode === 'viewer' && viewerUrl ? <iframe className="viewer-frame" title={`${selected.displayName} viewer`} src={viewerUrl} /> : <div className="status-preview"><div className="scene-grid"><div className="scene-sun">☀</div><div className="pixel-bot"><div className="pixel-head">{selected.displayName.slice(0, 1)}</div><div className="pixel-body" /></div><div className="scene-label"><strong>{selected.killAura ? '正在战斗' : selected.fishing ? '正在钓鱼' : '待命中'}</strong><span>{selected.position ? `坐标 ${selected.position.x}, ${selected.position.y}, ${selected.position.z}` : '等待世界数据'}</span></div></div><div className="vitals-row"><Vital label="生命值" value={selected.health ?? 0} max={20} color="red" /><Vital label="饱食度" value={selected.food ?? 0} max={20} color="gold" /><div className="position-box"><small>附近玩家</small><strong>{selected.nearbyPlayers.length ? selected.nearbyPlayers.join('、') : '暂无'}</strong></div></div></div>}</div><div className="command-card card"><div className="card-header"><div><span className="eyebrow">COMMAND DECK</span><h3>命令栏</h3></div><span className="soft-badge">游戏内白名单同步</span></div><div className="quick-actions">{quickCommands.map((item) => <button className="secondary" key={item.command} onClick={() => run(() => sendCommand(selected.id, item.command))}>{item.label}</button>)}</div><form className="command-form" onSubmit={submitCommand}><span>›</span><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="输入命令，例如 follow PlayerName" /><button className="primary">发送</button></form></div><div className="detail-two-col"><div className="card"><div className="card-header"><div><span className="eyebrow">INVENTORY</span><h3>背包物品</h3></div><span className="soft-badge">{inventory.length} 类</span></div>{inventory.length ? <div className="inventory-grid">{inventory.map((item) => <div className="inventory-item" key={item.name}><span className="item-pixel">▦</span><div><strong>{item.name.replaceAll('_', ' ')}</strong><small>数量 ×{item.count}</small></div></div>)}</div> : <p className="muted">机器人上线后会显示背包内容。</p>}</div><div className="card"><div className="card-header"><div><span className="eyebrow">ACCESS CONTROL</span><h3>独立白名单</h3></div><span className="soft-badge">{whitelist.length} 人</span></div><p className="muted">只有这里的玩家可以在游戏内对 {selected.displayName} 下指令。</p><textarea className="whitelist-editor" value={whitelist.join('\n')} onChange={(event) => setWhitelist(event.target.value.split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean))} placeholder="每行一个玩家名" /><button className="primary full-button" disabled={selected.state !== 'stopped'} onClick={saveSelectedWhitelist}>保存白名单</button>{selected.state !== 'stopped' && <small className="field-hint">请先停止机器人再修改运行时配置。</small>}</div></div></div><aside className="detail-side"><div className="card side-card"><span className="eyebrow">CONNECTION</span><h3>连接状态</h3><div className="connection-row"><span className={`state-dot state-${selected.state}`} /><strong>{stateLabel(selected.state)}</strong><small>{selected.lastReason || '连接稳定'}</small></div><div className="side-list"><div><span>认证账号</span><strong>{selected.configuredUsername}</strong></div><div><span>认证方式</span><strong>{selected.auth || 'microsoft'}</strong></div><div><span>游戏版本</span><strong>{selected.version || selectedDefinition?.version || '自动'}</strong></div><div><span>Viewer</span><strong>{selected.viewerPort ? `端口 ${selected.viewerPort}` : '未启用'}</strong></div></div></div><div className="card side-card"><span className="eyebrow">RECENT LOGS</span><h3>运行日志</h3><div className="mini-logs">{logs.length ? logs.slice(-6).reverse().map((log, index) => <div key={`${log.at}-${index}`}><span className={`log-dot ${log.level}`} /><p>{log.message}<small>{new Date(log.at).toLocaleTimeString()}</small></p></div>) : <p className="muted">暂无日志</p>}</div></div></aside></div></>; }

function Vital({ label, value, max, color }: { label: string; value: number; max: number; color: string }) { return <div className="vital"><div><span>{label}</span><strong>{value}<small>/{max}</small></strong></div><span className="vital-track"><i className={color} style={{ width: `${Math.min(100, Math.max(0, value / max * 100))}%` }} /></span></div>; }
function EmptyState({ openAdd }: { openAdd: () => void }) { return <div className="empty-state"><div className="empty-art">♟</div><h2>还没有机器人</h2><p>创建第一个机器人，开始管理你的 Minecraft 自动化工作台。</p><button className="primary" onClick={openAdd}>＋ 添加第一个机器人</button></div>; }

export default App;

