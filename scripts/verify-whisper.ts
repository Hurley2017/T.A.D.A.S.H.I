import { assertWhisperAvailable } from '../packages/voice/src';

const executable = process.env.TADASHI_WHISPER_EXECUTABLE;
if (!executable) {
  console.log('No TADASHI_WHISPER_EXECUTABLE configured. Whisper verification skipped.');
  process.exit(0);
}

try {
  await assertWhisperAvailable(executable);
  console.log(`Whisper executable is available: ${executable}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Whisper verification failed.');
  process.exitCode = 1;
}
