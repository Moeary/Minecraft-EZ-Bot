/** Commands: status, info on/off. Capabilities: whitelist-gated in-game command parsing. */
module.exports = {
  id: 'chat-command', name: '聊天指令', description: '按每个 bot 的独立白名单接收安全指令。', commands: ['status', 'info on/off'],
  openaiTools: [{ name: 'read_bot_status', description: 'Read public runtime status.', parameters: {} }],
  handler: 'managed-bot.handleChat'
};
