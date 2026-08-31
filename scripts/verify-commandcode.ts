import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function resolveCli(): string {
  const explicit = process.env.TADASHI_COMMAND_CODE_EXECUTABLE;
  if (explicit) return explicit;
  // Search the npm global bin dir directly (where cmdc.cmd lives on Windows).
  const candidates = [
    'C:\\Users\\tushe\\AppData\\Roaming\\npm\\cmdc.cmd',
    process.env.APPDATA ? `${process.env.APPDATA}\\npm\\cmdc.cmd` : '',
    '/usr/local/bin/cmdc',
    '/usr/bin/cmdc',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const lookup = process.platform === 'win32' ? spawnSync('where', ['cmdc'], { shell: false, windowsHide: true, timeout: 10_000 }) : spawnSync('which', ['cmdc'], { shell: false, timeout: 10_000 });
  if (lookup.status !== 0) return 'cmdc';
  return String(lookup.stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? 'cmdc';
}

function main(): void {
  const cli = resolveCli();
  const run = (args: string[], timeout: number) => cli.toLowerCase().endsWith('.cmd') || cli.toLowerCase().endsWith('.ps1')
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/c', cli, ...args], { shell: false, windowsHide: true, timeout })
    : spawnSync(cli, args, { shell: false, windowsHide: true, timeout });
  const version = run(['--version'], 10_000);
  if (version.status !== 0) {
    console.error(`Command Code CLI not found (tried ${cli}). Run npm run setup:cc first, or set TADASHI_COMMAND_CODE_EXECUTABLE.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Command Code CLI: ${String(version.stdout ?? version.stderr).trim() || 'available'} (${cli})`);
  const auth = run(['status'], 10_000);
  if (auth.status !== 0 || /not.*authenticated|not.*logged/i.test(String(auth.stderr) + String(auth.stdout))) {
    console.error('Command Code CLI is not authenticated. Run: cmdc login');
    process.exitCode = 1;
    return;
  }
  console.log('Command Code CLI: authenticated');
  const smoke = run(['-p', 'say ok', '--skip-onboarding', '--output-format', 'json'], 90_000);
  if (smoke.status !== 0) {
    console.error(`Smoke run failed (exit ${smoke.status}): ${String(smoke.stderr).slice(0, 240)}`);
    process.exitCode = 1;
    return;
  }
  if (!String(smoke.stdout).includes('"result"')) {
    console.error('Smoke run returned no result frame.');
    process.exitCode = 1;
    return;
  }
  console.log('Command Code delegation smoke run: OK');
}

main();
