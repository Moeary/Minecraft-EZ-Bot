const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('./load-config');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.copyFileSync(temporary, filePath);
  fs.unlinkSync(temporary);
}

function saveBotsConfig(config, bots) {
  const existing = readJson(config.botsPath, {});
  writeJson(config.botsPath, {
    ...existing,
    web: config.web,
    defaults: config.defaults,
    bots
  });
}

function saveWhitelist(config, whitelist) {
  writeJson(config.whitelistPath, whitelist);
}

function saveWorkflows(config, workflows) {
  writeJson(config.workflowsPath, { workflows });
}

module.exports = { saveBotsConfig, saveWhitelist, saveWorkflows };
