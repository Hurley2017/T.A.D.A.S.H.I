import { checkLlamaHealth } from '../packages/brain/src';

const health = await checkLlamaHealth({
  modelPath: process.env.TADASHI_LLAMA_MODEL_PATH,
  modelName: process.env.TADASHI_BRAIN_MODEL,
  endpoint: process.env.TADASHI_BRAIN_BASE_URL,
});
console.log(health.message);
console.log(`Provider: ${health.provider}; model: ${health.model || 'not configured'}`);
process.exitCode = health.reachable ? 0 : 1;
