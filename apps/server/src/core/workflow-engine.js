const { normalizeWorkflows } = require('../config/workflow-config');

const MAX_STEPS = 256;

class WorkflowEngine {
  constructor(definitions = []) {
    this.definitions = normalizeWorkflows(definitions);
  }

  list() {
    return this.definitions.map((workflow) => ({
      ...workflow,
      nodes: workflow.nodes.map((node) => ({ ...node, params: { ...node.params } })),
      edges: workflow.edges.map((edge) => ({ ...edge }))
    }));
  }

  get(id) {
    return this.definitions.find((workflow) => workflow.id === id) || null;
  }

  async run(bot, id, input = {}) {
    const workflow = this.get(id);
    if (!workflow) throw new Error(`Unknown workflow: ${id}`);
    if (workflow.enabled === false) throw new Error(`Workflow ${id} is disabled.`);
    const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
    const outgoing = new Map();
    for (const edge of workflow.edges) {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      outgoing.get(edge.source).push(edge);
    }
    const start = workflow.nodes.find((node) => node.type === 'start') || workflow.nodes[0];
    let current = start;
    const context = { input: { ...input }, values: {}, trace: [] };
    for (let step = 0; current && step < MAX_STEPS; step += 1) {
      context.trace.push(current.id);
      let branch = 'next';
      try {
        const result = await this.executeNode(bot, current, context);
        context.values[current.id] = result;
        if (typeof result === 'boolean') branch = result ? 'true' : 'false';
      } catch (error) {
        context.values[current.id] = { ok: false, message: error.message };
        branch = 'error';
        const errorEdge = (outgoing.get(current.id) || []).find((edge) => edge.when === 'error');
        if (!errorEdge) throw error;
      }
      const edges = outgoing.get(current.id) || [];
      const edge = edges.find((candidate) => candidate.when === branch) || edges.find((candidate) => candidate.when === 'next');
      current = edge ? nodeMap.get(edge.target) : null;
    }
    if (current) throw new Error(`Workflow ${id} exceeded ${MAX_STEPS} steps; check for a loop without a stop condition.`);
    return { ok: true, workflowId: id, trace: context.trace, values: context.values };
  }

  async executeNode(bot, node, context) {
    const params = node.params || {};
    switch (node.type) {
      case 'start': return true;
      case 'ensure_mining_home':
        await bot.ensureRegionAnchor();
        return { ok: true, home: bot.regionPlan?.home || null };
      case 'has_usable_pickaxe': return bot.hasUsablePickaxe();
      case 'resupply': {
        const result = await bot.maybeResupply({
          requirePickaxe: params.requirePickaxe !== false,
          requireFood: params.requireFood === true,
          requireStorage: params.requireStorage === true
        });
        if (!result.ok) throw new Error(result.message);
        return result;
      }
      case 'goto_home': {
        const home = String(params.home || '').trim();
        if (!home) throw new Error('goto_home requires params.home');
        const result = bot.execute('home', [home], { source: 'workflow', sender: 'workflow' });
        if (!result.ok) throw new Error(result.message);
        return result;
      }
      case 'start_region_mining': {
        const result = bot.startRegionMining(false);
        if (result?.ok === false) throw new Error(result.message);
        return result;
      }
      case 'stop_region_mining': return bot.stopRegionMining();
      case 'equip': {
        const result = bot.equipRole(params.role || 'auto', false);
        if (!result.ok) throw new Error(result.message);
        return result;
      }
      case 'wait': {
        const milliseconds = Math.max(0, Math.min(60000, Number(params.milliseconds) || 0));
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
        return { milliseconds };
      }
      case 'log': {
        bot.log(String(params.message || node.label || 'workflow step'));
        return { message: String(params.message || node.label || 'workflow step') };
      }
      case 'end': return { done: true };
      default: throw new Error(`Unsupported workflow node type: ${node.type}`);
    }
  }
}

module.exports = { WorkflowEngine };
