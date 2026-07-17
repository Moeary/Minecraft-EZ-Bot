/** Commands: mine <block> [count], gather <block> [count]. Uses pathfinder + findBlocks + dig with bounded targets. */
module.exports = {
  id: 'mining', name: '自动挖矿与资源采集', description: '寻找附近目标方块、自动导航、装备最佳工具并持续采集。', commands: ['mine <方块> [数量]', 'gather <方块> [数量]', 'stop'],
  openaiTools: [{ name: 'start_mining', description: 'Mine a named block type with an optional bounded count.', parameters: { block: 'string', count: 'number' } }],
  handler: 'managed-bot.startMining'
};
