// Server config: all secrets/addresses come from environment variables.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

// Data dirs (tmp/, images/, ...) are relative to this server/ directory.
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
// .env 固定在项目根（server/ 上一级），显式指定路径，
// 避免从其它目录启动 node 时读不到 .env 导致 API key 为空
// quiet: 关掉 dotenv 自身的注入提示横幅，保持控制台干净
dotenv.config({ path: path.resolve(SERVER_DIR, '..', '.env'), quiet: true });
process.chdir(SERVER_DIR);

const env = (key, dft = '') => process.env[key] ?? dft;

export default {
  HOST: env('SERVER_HOST', '127.0.0.1'),
  PORT: parseInt(env('SERVER_PORT', '3005'), 10),

  // AI worker auth (must match ai_worker side)
  WORKER_TOKEN: env('WORKER_TOKEN', 'change-me-worker-token'),
  WORKER_TASK_TIMEOUT: parseFloat(env('WORKER_TASK_TIMEOUT', '300')) * 1000,

  // Cloud API keys（全部走阿里云百炼，一个 key）
  DASHSCOPE_API_KEY: env('DASHSCOPE_API_KEY'),
  DASHSCOPE_BASE_URL: env('DASHSCOPE_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
  DASHSCOPE_LLM_MODEL: env('DASHSCOPE_LLM_MODEL', 'deepseek-v3'),
  DASHSCOPE_VL_MODEL: env('DASHSCOPE_VL_MODEL', 'qwen3-vl-plus'),
  DASHSCOPE_T2I_MODEL: env('DASHSCOPE_T2I_MODEL', 'qwen-image-max'),
  DASHSCOPE_I2V_MODEL: env('DASHSCOPE_I2V_MODEL', 'wan2.7-i2v-2026-04-25'),
};
