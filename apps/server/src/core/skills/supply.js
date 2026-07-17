/** Commands: supply on/off, equip <role>. Auto-eat is kept inventory-backed and never creates items. */
module.exports = {
  id: 'supply', name: '自动补给与装备管理', description: '按饥饿值自动进食，并根据当前任务切换背包中的工具或武器。', commands: ['supply on', 'supply off', 'equip auto|pickaxe|axe|weapon'],
  openaiTools: [{ name: 'manage_supply', description: 'Enable inventory-backed food and equipment management.', parameters: { enabled: 'boolean', role: 'string' } }],
  handler: 'managed-bot.setSupply'
};
