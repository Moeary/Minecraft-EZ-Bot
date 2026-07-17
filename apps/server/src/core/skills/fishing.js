/** Commands: fish, stop. Capabilities: equip a fishing rod and maintain a fishing loop. */
module.exports = {
  id: 'fishing', name: '自动钓鱼', description: '寻找鱼竿并进入持续钓鱼循环。', commands: ['fish', 'stop'],
  openaiTools: [{ name: 'start_fishing', description: 'Start or stop fishing.', parameters: { enabled: 'boolean' } }],
  handler: 'managed-bot.startFishing'
};
