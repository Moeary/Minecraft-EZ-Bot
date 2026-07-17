/** Reserved OpenAI tool declarations. Runtime model calls stay disabled until an approval layer is implemented. */
module.exports = {
  id: 'openai-tools',
  name: 'OpenAI 工具链（预留）',
  description: '只声明未来可用的工具和审批边界，不自动调用模型，也不会执行未确认的游戏操作。',
  commands: ['网页配置工具声明', '审批后执行（规划中）'],
  openaiTools: [{
    name: 'plan_bot_operation',
    description: 'Create a proposed bot operation for explicit human approval; execution is disabled for now.',
    parameters: { botId: 'string', operation: 'string', requireApproval: 'boolean' }
  }],
  handler: null
};