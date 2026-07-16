// Compatibility entry point. Prefer `pixi run bot <id>`.
const modes = new Set(['run', 'run-all', 'web']);
if (!modes.has(process.argv[2])) process.argv.splice(2, 0, 'run');
require('./apps/server/src/cli');
