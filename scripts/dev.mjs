import { spawn } from 'node:child_process';

const server = spawn(process.execPath, ['apps/server/src/cli.js', 'web'], { stdio: 'inherit', shell: false });
const web = spawn('npm', ['run', 'web:dev'], { stdio: 'inherit', shell: true });

function shutdown() {
  server.kill();
  web.kill();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
