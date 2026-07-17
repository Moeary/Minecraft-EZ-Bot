/** Commands: kill on, kill off, stop. Capabilities: target configured hostile mobs and stop safely. */
module.exports = {
  id: 'combat', name: '基础战斗', description: '自动装备武器并攻击附近目标。', commands: ['kill on', 'kill off', 'stop'],
  openaiTools: [{ name: 'set_combat', description: 'Toggle the bot combat loop.', parameters: { enabled: 'boolean' } }],
  handler: 'managed-bot.execute'
};
