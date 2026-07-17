/** Survival maintenance can be composed with combat, fishing, navigation and mining loops. */
module.exports = {
  id: 'survival',
  name: '夜间生存与续航',
  description: '在主世界夜间寻找附近床铺睡觉，并按配置的补给点存放掉落、领取稿子和食物。',
  commands: ['sleep on', 'sleep off', 'resupply on', 'resupply off', 'resupply point add <x> <y> <z>', 'resupply status'],
  openaiTools: [{ name: 'configure_survival_maintenance', description: 'Enable automatic sleeping and configured-point resupply.', parameters: { sleep: 'boolean', resupply: 'boolean' } }],
  handler: 'managed-bot.startMaintenanceLoop'
};
