/** Supply uses only inventory items and explicitly configured container points. */
module.exports = {
  id: 'supply',
  name: '自动补给与装备管理',
  description: '自动进食、装备合适工具，并在背包紧张时从配置的补给点存取物品。不会随机打开世界里的箱子。',
  commands: ['supply on', 'supply off', 'resupply on', 'resupply off', 'resupply point add <x> <y> <z>', 'equip auto|pickaxe|axe|weapon'],
  openaiTools: [{ name: 'manage_supply', description: 'Enable inventory-backed food and equipment management using configured supply points.', parameters: { enabled: 'boolean', role: 'string' } }],
  handler: 'managed-bot.setSupply'
};
