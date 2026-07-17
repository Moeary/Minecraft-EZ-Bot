/** Commands: follow <player>, come <player>, home <name>. Capabilities: pathfinder navigation. */
module.exports = {
  id: 'pathfinder', name: '跟随与导航', description: '跟随玩家或前往预设家的坐标。', commands: ['follow <player>', 'come <player>', 'home <name>'],
  openaiTools: [{ name: 'navigate_to_player', description: 'Navigate to a visible player.', parameters: { player: 'string' } }],
  handler: 'managed-bot.execute'
};
