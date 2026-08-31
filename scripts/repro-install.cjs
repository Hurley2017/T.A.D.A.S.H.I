const { existsSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { spawnSync } = require('node:child_process');

// Exact copy of resolveNpm + installCommandCodeCli from main.ts
const nodeCandidates = [
  'C:\\Program Files\\nodejs\\node.exe',
  join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
  'D:\\TadashiAI\\node\\node.exe',
];
let npmNode = 'node', npmCli = 'npm-cli.js';
for (const candidate of nodeCandidates) {
  try {
    if (existsSync(candidate)) {
      const cli = join(dirname(candidate), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (existsSync(cli)) { npmNode = candidate; npmCli = cli; console.log('npm resolved:', npmNode, npmCli); break; }
    }
  } catch {}
}

console.log('Running:', npmNode, [npmCli, 'i', '-g', 'command-code'].join(' '));
const install = spawnSync(npmNode, [npmCli, 'i', '-g', 'command-code'], { shell: false, windowsHide: true, timeout: 300_000, encoding: 'utf8' });
console.log('status:', install.status);
console.log('stdout tail:', JSON.stringify((install.stdout || '').slice(-500)));
console.log('stderr tail:', JSON.stringify((install.stderr || '').slice(-500)));
console.log('error:', install.error?.message);

// Verify what got installed
const cmdc = 'C:\\Users\\tushe\\AppData\\Roaming\\npm\\cmdc.cmd';
console.log('cmdc.cmd after install:', existsSync(cmdc));
const entry = join('C:\\Users\\tushe\\AppData\\Roaming\\npm', 'node_modules', 'command-code', 'dist', 'index.mjs');
console.log('index.mjs after install:', existsSync(entry));
