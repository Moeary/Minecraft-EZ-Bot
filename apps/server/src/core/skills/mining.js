/** Region mining is fail-closed by default: containers, fluids, protected blocks and bedrock are never targets. */
module.exports = {
  id: 'mining',
  name: '自动挖矿与资源采集',
  description: '在手动指定的长方体区域内按白名单或黑名单采集，遇到流体先封堵；容器、基岩和保护方块默认跳过。',
  commands: [
    'mine <方块> [数量]',
    'area set <x1> <y1> <z1> <x2> <y2> <z2>',
    'area mode blacklist|whitelist',
    'area allow|deny <方块...>',
    'area start|stop|status',
    'unseal'
  ],
  openaiTools: [{
    name: 'configure_region_mining',
    description: 'Configure and start bounded region mining with explicit filters; never target containers or fluids.',
    parameters: {
      x1: 'integer', y1: 'integer', z1: 'integer', x2: 'integer', y2: 'integer', z2: 'integer',
      mode: 'blacklist | whitelist', allow: 'string[]', deny: 'string[]', enabled: 'boolean'
    }
  }],
  handler: 'managed-bot.executeRegionCommand'
};
