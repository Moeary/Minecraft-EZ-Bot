const path = require('node:path');

const expectedRoot = path.resolve(process.cwd());
const pixiRoot = process.env.PIXI_PROJECT_ROOT ? path.resolve(process.env.PIXI_PROJECT_ROOT) : null;
if (!pixiRoot || pixiRoot !== expectedRoot) {
  console.error('This repository must be managed through Pixi. Run `pixi run install` instead of invoking system npm directly.');
  process.exit(1);
}
