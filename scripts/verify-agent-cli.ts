import { spawn } from 'node:child_process';

const executable = process.env.TADASHI_CLI_EXECUTABLE;
if (!executable) {
  console.log('No TADASHI_CLI_EXECUTABLE configured. CLI verification skipped.');
  process.exit(0);
}

const child = spawn(executable, ['--version'], { shell: false, windowsHide: true, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(`Unable to start ${executable}: ${error.message}`);
  process.exitCode = 1;
});
child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
