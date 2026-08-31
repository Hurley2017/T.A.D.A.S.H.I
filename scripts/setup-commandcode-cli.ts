import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CLI = process.env.TADASHI_COMMAND_CODE_EXECUTABLE ?? 'C:\\Users\\tushe\\AppData\\Roaming\\npm\\cmdc.cmd';

function main(): void {
  if (!existsSync(CLI)) {
    console.log(`Command Code CLI not found at ${CLI}. Installing globally via npm...`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawnSync(npm, ['i', '-g', 'command-code'], { shell: false, windowsHide: true, timeout: 300_000, encoding: 'utf8' });
    if (install.status !== 0) {
      console.error(`npm install failed: ${String(install.stderr).slice(0, 240)}`);
      process.exitCode = 1;
      return;
    }
    console.log('Installed. Run: cmdc login to authenticate.');
    process.exit(0);
  }
  const check = spawnSync(CLI, ['--version'], { shell: false, windowsHide: true, timeout: 10_000 });
  if (check.status !== 0) {
    console.error(`Command Code CLI exists but did not respond: ${String(check.stderr).slice(0, 240)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Command Code CLI already installed: ${CLI} (${String(check.stdout ?? check.stderr).trim() || 'available'})`);
}

main();
