const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_NODE_TYPES = new Set([
  'start', 'ensure_mining_home', 'has_usable_pickaxe', 'resupply', 'goto_home',
  'start_region_mining', 'stop_region_mining', 'equip', 'wait', 'log', 'end'
]);

function normalizeWorkflowNode(node, index = 0) {
  if (!node || typeof node !== 'object') return null;
  const id = String(node.id || `node-${index + 1}`).trim();
  const type = String(node.type || '').trim().toLowerCase();
  if (!id || !WORKFLOW_NODE_TYPES.has(type)) return null;
  return {
    id,
    type,
    label: String(node.label || id).trim(),
    x: Number.isFinite(Number(node.x)) ? Number(node.x) : index * 220,
    y: Number.isFinite(Number(node.y)) ? Number(node.y) : 80,
    params: node.params && typeof node.params === 'object' ? { ...node.params } : {}
  };
}

function normalizeWorkflow(workflow, index = 0) {
  if (!workflow || typeof workflow !== 'object') return null;
  const id = String(workflow.id || `workflow-${index + 1}`).trim();
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes.map(normalizeWorkflowNode).filter(Boolean) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(workflow.edges) ? workflow.edges.map((edge) => ({
    source: String(edge.source || edge.from || '').trim(),
    target: String(edge.target || edge.to || '').trim(),
    when: String(edge.when || 'next').toLowerCase()
  })).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && ['next', 'true', 'false', 'error'].includes(edge.when)) : [];
  return {
    id,
    name: String(workflow.name || id).trim(),
    description: String(workflow.description || '').trim(),
    enabled: workflow.enabled !== false,
    trigger: workflow.trigger && typeof workflow.trigger === 'object' ? { ...workflow.trigger } : { type: 'manual' },
    nodes,
    edges
  };
}

function normalizeWorkflows(value = []) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.workflows) ? value.workflows : [];
  const seen = new Set();
  return list.map(normalizeWorkflow).filter((workflow) => {
    if (!workflow || seen.has(workflow.id)) return false;
    seen.add(workflow.id);
    return workflow.nodes.length > 0;
  });
}

module.exports = { normalizeWorkflow, normalizeWorkflows, normalizeWorkflowNode, WORKFLOW_NODE_TYPES };
