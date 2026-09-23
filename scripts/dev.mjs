// Run the game server and the Vite dev server together. Open http://localhost:5173
import { spawn } from 'node:child_process';

const run = (cmd, args, env = {}) => spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
const server = run('npx', ['tsx', 'watch', 'apps/server/src/index.ts'], { PORT: '3000', DATA_DIR: '.data' });
const web = run('npx', ['vite', '--config', 'apps/web/vite.config.ts', 'apps/web']);
const stop = () => { server.kill(); web.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
