// Assemble dist/release: the bundled server plus the built website, ready to ship as one folder.
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const out = 'dist/release';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/server`, { recursive: true });
if (!existsSync('apps/server/dist/index.js') || !existsSync('apps/web/dist/index.html')) {
  console.error('Build the server and web app first (npm run build).');
  process.exit(1);
}
cpSync('apps/server/dist/index.js', `${out}/server/index.js`);
writeFileSync(`${out}/server/package.json`, JSON.stringify({ type: 'module' }) + '\n');
cpSync('apps/web/dist', `${out}/web`, { recursive: true });
let version = process.env.GITHUB_SHA?.slice(0, 7);
if (!version) {
  try { version = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { version = 'local'; }
}
writeFileSync(`${out}/VERSION`, `${version}\n`);
console.log(`Packaged ${out} (${version})`);
