import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { fetchWorkflows, runWorkflow, saveWorkflows, type BotStatus, type WorkflowDefinition, type WorkflowNode, type WorkflowNodeType } from './api';

type Props = { bots: BotStatus[]; selected?: BotStatus; run: (action: () => Promise<unknown>, refresh?: boolean) => Promise<void> };

const palette: Array<{ type: WorkflowNodeType; label: string }> = [
  { type: 'ensure_mining_home', label: '设置挖矿 Home' },
  { type: 'has_usable_pickaxe', label: '判断：有可用镐' },
  { type: 'resupply', label: '去补给点' },
  { type: 'goto_home', label: '传送到 Home' },
  { type: 'equip', label: '装备工具' },
  { type: 'start_region_mining', label: '开始区域挖矿' },
  { type: 'stop_region_mining', label: '停止区域挖矿' },
  { type: 'wait', label: '等待' },
  { type: 'log', label: '记录日志' },
  { type: 'end', label: '结束' }
];

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function nextNodeId(nodes: WorkflowNode[], type: WorkflowNodeType) { return `${type}-${nodes.length + 1}`; }

export function WorkflowPage({ bots, selected, run }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [connectSource, setConnectSource] = useState('');
  const [edgeWhen, setEdgeWhen] = useState<'next' | 'true' | 'false' | 'error'>('next');
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [botId, setBotId] = useState(selected?.id || bots[0]?.id || '');

  useEffect(() => { fetchWorkflows().then((items) => { setWorkflows(items); setSelectedId(items[0]?.id || ''); }).catch((reason) => setError(reason instanceof Error ? reason.message : '工作流加载失败')); }, []);
  const workflow = useMemo(() => workflows.find((item) => item.id === selectedId), [workflows, selectedId]);
  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId);

  useEffect(() => { if (workflow) setJson(JSON.stringify(workflow, null, 2)); }, [workflow]);
  useEffect(() => { if (workflow) setSelectedNodeId((current) => workflow.nodes.some((node) => node.id === current) ? current : workflow.nodes[0]?.id || ''); }, [workflow?.id]);
  useEffect(() => { if (!botId && (selected?.id || bots[0]?.id)) setBotId(selected?.id || bots[0]?.id || ''); }, [botId, bots, selected?.id]);

  function updateWorkflow(mutator: (next: WorkflowDefinition) => void) {
    if (!workflow) return;
    const next = clone(workflow); mutator(next);
    setWorkflows((current) => current.map((item) => item.id === next.id ? next : item));
  }
  function addWorkflow() {
    const id = `workflow-${workflows.length + 1}`;
    const item: WorkflowDefinition = { id, name: '新复合技能', description: '由可视化节点拼装的 Mineflayer 工作流', enabled: true, trigger: { type: 'manual' }, nodes: [{ id: 'start', type: 'start', label: '开始', x: 30, y: 80, params: {} }, { id: 'end', type: 'end', label: '结束', x: 300, y: 80, params: {} }], edges: [{ source: 'start', target: 'end', when: 'next' }] };
    setWorkflows((current) => [...current, item]); setSelectedId(id); setSelectedNodeId('start');
  }
  function addNode(type: WorkflowNodeType) {
    if (!workflow || type === 'start') return;
    const node: WorkflowNode = { id: nextNodeId(workflow.nodes, type), type, label: palette.find((item) => item.type === type)?.label || type, x: 100 + workflow.nodes.length * 24, y: 180 + (workflow.nodes.length % 3) * 90, params: {} };
    updateWorkflow((next) => next.nodes.push(node)); setSelectedNodeId(node.id);
  }
  function dropNode(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const type = event.dataTransfer.getData('workflow-node') as WorkflowNodeType;
    if (type) addNode(type);
  }
  function moveNode(id: string, event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    updateWorkflow((next) => { const node = next.nodes.find((item) => item.id === id); if (node) { node.x = Math.max(8, event.clientX - rect.left - 80); node.y = Math.max(8, event.clientY - rect.top - 30); } });
  }
  function clickNode(node: WorkflowNode) {
    if (connectSource && connectSource !== node.id) {
      updateWorkflow((next) => { if (!next.edges.some((edge) => edge.source === connectSource && edge.target === node.id && edge.when === edgeWhen)) next.edges.push({ source: connectSource, target: node.id, when: edgeWhen }); });
      setConnectSource(''); return;
    }
    setSelectedNodeId(node.id);
  }
  async function save() {
    setError(''); await run(() => saveWorkflows(workflows), false);
  }
  async function importJson() {
    try {
      const parsed = JSON.parse(json) as WorkflowDefinition;
      setWorkflows((current) => current.some((item) => item.id === parsed.id) ? current.map((item) => item.id === parsed.id ? parsed : item) : [...current, parsed]);
      setSelectedId(parsed.id); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'JSON 无法解析'); }
  }
  return <section className="workflow-page">
    <div className="page-heading compact"><div><span className="eyebrow">COMPOSITE SKILLS / NODE GRAPH</span><h1>复合技能工作流</h1><p>把寻路、Home、补给、装备和区域挖矿拼成可复用 JSON。分支节点使用 true / false / error 连线。</p></div><div className="heading-buttons"><button className="secondary" onClick={addWorkflow}>＋ 新建工作流</button><button className="primary" onClick={save}>保存 JSON</button></div></div>
    {error && <p className="form-error">{error}</p>}
    <div className="workflow-toolbar"><label>当前工作流<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>运行机器人<select value={botId} onChange={(event) => setBotId(event.target.value)} disabled={!bots.length}>{bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.displayName}</option>)}</select></label><button className="secondary" disabled={!workflow || !botId} onClick={() => workflow && botId && run(() => runWorkflow(botId, workflow.id), true)}>▶ 运行当前工作流</button></div>
    {workflow ? <div className="workflow-layout"><aside className="workflow-palette"><strong>节点积木</strong><small>拖到画布，或点击添加</small>{palette.map((item) => <button key={item.type} draggable onDragStart={(event) => event.dataTransfer.setData('workflow-node', item.type)} onClick={() => addNode(item.type)}>{item.label}<span>{item.type}</span></button>)}<div className="workflow-connect"><strong>连线</strong><small>{connectSource ? `已选起点：${connectSource}` : '先点击“设为起点”，再点击目标节点'}</small><select value={edgeWhen} onChange={(event) => setEdgeWhen(event.target.value as typeof edgeWhen)}><option value="next">next</option><option value="true">true</option><option value="false">false</option><option value="error">error</option></select></div></aside><div className="workflow-canvas" onDragOver={(event) => event.preventDefault()} onDrop={dropNode}>{workflow.edges.map((edge, index) => <div className="workflow-edge-label" key={`${edge.source}-${edge.target}-${index}`} style={{ left: (workflow.nodes.find((node) => node.id === edge.source)?.x || 0) + 80, top: (workflow.nodes.find((node) => node.id === edge.source)?.y || 0) + 58 }}>{edge.when} → {edge.target}</div>)}{workflow.nodes.map((node) => <div key={node.id} draggable className={`workflow-node ${selectedNodeId === node.id ? 'selected' : ''}`} style={{ left: node.x, top: node.y }} onDragEnd={(event) => moveNode(node.id, event)} onClick={() => clickNode(node)}><span className="workflow-node-type">{node.type}</span><strong>{node.label}</strong><small>{node.id}</small><button type="button" onClick={(event) => { event.stopPropagation(); setConnectSource(node.id); }}>{connectSource === node.id ? '起点已选' : '设为连线起点'}</button></div>)}</div><aside className="workflow-inspector"><strong>节点属性</strong>{selectedNode ? <><label>显示名称<input value={selectedNode.label} onChange={(event) => updateWorkflow((next) => { const node = next.nodes.find((item) => item.id === selectedNode.id); if (node) node.label = event.target.value; })} /></label><label>参数 JSON<textarea value={JSON.stringify(selectedNode.params, null, 2)} onChange={(event) => { try { const params = JSON.parse(event.target.value); updateWorkflow((next) => { const node = next.nodes.find((item) => item.id === selectedNode.id); if (node) node.params = params; }); } catch (_) {} }} /></label><button className="danger-button" onClick={() => updateWorkflow((next) => { next.nodes = next.nodes.filter((node) => node.id !== selectedNode.id); next.edges = next.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id); })}>删除节点</button></> : <small>选择一个节点查看参数。</small>}<strong>JSON 导入 / 导出</strong><textarea className="workflow-json" value={json} onChange={(event) => setJson(event.target.value)} /><button className="secondary" onClick={importJson}>从 JSON 导入当前图</button></aside></div> : <div className="empty-state"><h2>还没有工作流</h2><p>点击“新建工作流”，或复制 config/workflows.example.json 到本地配置后加载。</p></div>}
  </section>;
}
