// Cloud AI services: 统一走阿里云百炼 DashScope（chat / qwen-vl / t2i / i2v）。
// Keys come from environment variables (see config.js).
import crypto from 'node:crypto';
import fs from 'node:fs';

import config from './config.js';
import { optimizeImageForApi } from './helpers.js';
import { log, elapsed } from './logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadTo(url, path) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download ${resp.status}`);
  fs.writeFileSync(path, Buffer.from(await resp.arrayBuffer()));
  return path;
}

// ---------- OpenAI-compatible chat（百炼兼容模式：LLM / qwen-vl）----------

async function chatCompletion(baseUrl, apiKey, model, messages) {
  if (!apiKey) throw new Error(`API key 未配置（请在 .env 中填写后重启服务），模型: ${model}`);
  const t0 = Date.now();
  log('cloud', `chat → ${model}`);
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!resp.ok) throw new Error(`chat api ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (content == null) throw new Error(`chat api 返回结构异常: ${JSON.stringify(data)}`);
  log('cloud', `chat ← ${model} ok ${elapsed(t0)}`);
  return content;
}

// 古诗词→提示词，用百炼上的 LLM（默认 deepseek-v3，也可换 qwen-plus 等）
export function deepseek(messages) {
  return chatCompletion(
    config.DASHSCOPE_BASE_URL, config.DASHSCOPE_API_KEY, config.DASHSCOPE_LLM_MODEL, messages
  );
}

export async function qwenVl(imagePath, style) {
  const base64vl = await optimizeImageForApi(imagePath);
  const messages = [
    { role: 'system', content: [{ type: 'text', text: 'You are a helpful assistant.' }] },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: base64vl } },
        {
          type: 'text',
          text: `请根据这张图，生成一些图转视频的提示词，符合${style}风格的中文提示词，注意稍微活动即可， 以json格式返回生成建议列表`,
        },
      ],
    },
  ];
  const content = await chatCompletion(
    config.DASHSCOPE_BASE_URL, config.DASHSCOPE_API_KEY, config.DASHSCOPE_VL_MODEL, messages
  );
  let data;
  try {
    data = JSON.parse(content.replace('```json', '').replace('```', ''));
  } catch {
    throw new Error(`qwen-vl 返回内容不是合法 JSON: ${String(content).slice(0, 200)}`);
  }
  // 不同 VL 模型返回结构不一：数组 / {prompt_suggestions:[...]} / 其它包裹形式，
  // 统一归一化为 [{prompt: ...}, ...]
  if (!Array.isArray(data)) {
    data = data?.prompt_suggestions ?? data?.suggestions
      ?? Object.values(data ?? {}).find(Array.isArray) ?? [];
  }
  return data.map((it) => (typeof it === 'string' ? { prompt: it } : it));
}

// ---------- DashScope async tasks (t2i / i2v) ----------

const DS_BASE = 'https://dashscope.aliyuncs.com/api/v1';

async function dsSubmit(path, payload) {
  if (!config.DASHSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_API_KEY 未配置（请在 .env 中填写后重启服务）');
  }
  log('cloud', `submit → ${payload.model}`);
  const resp = await fetch(`${DS_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  const taskId = data.output?.task_id;
  if (!resp.ok || !taskId) {
    throw new Error(`dashscope submit failed: ${JSON.stringify(data)}`);
  }
  log('cloud', `submit ← ${payload.model} task=${taskId}`);
  return taskId;
}

async function dsPoll(taskId, { intervalMs = 3000, timeoutMs = 10 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error('dashscope task timeout');
    await sleep(intervalMs);
    const resp = await fetch(`${DS_BASE}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${config.DASHSCOPE_API_KEY}` },
    });
    // 查询失败（如 401）必须直接抛出，否则会空转到超时
    if (!resp.ok) throw new Error(`dashscope poll ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const output = data.output ?? {};
    if (output.task_status === 'SUCCEEDED') {
      log('cloud', `poll ← task=${taskId} SUCCEEDED ${elapsed(t0)}`);
      return output;
    }
    if (output.task_status === 'FAILED' || output.task_status === 'CANCELED') {
      throw new Error(`dashscope task ${output.task_status}: ${JSON.stringify(data)}`);
    }
  }
}

// qwen-image-max supported sizes; snap to the closest aspect ratio.
const QWEN_IMAGE_SIZES = [
  [1664, 928], [1472, 1104], [1328, 1328], [1104, 1472], [928, 1664],
];

function snapSize(width, height) {
  const ratio = width / height;
  let best = QWEN_IMAGE_SIZES[0];
  let bestDiff = Infinity;
  for (const [w, h] of QWEN_IMAGE_SIZES) {
    const diff = Math.abs(w / h - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [w, h];
    }
  }
  return `${best[0]}*${best[1]}`;
}

// t2i (replaces the old local ComfyUI workflow, now qwen-image-max);
// qwen-image-max only supports the sync multimodal-generation endpoint.
// lora/steps are not supported by the cloud API, style comes from the prompt.
export async function dashscopeT2i(hint, width = 1024, height = 1024) {
  if (!config.DASHSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_API_KEY 未配置（请在 .env 中填写后重启服务）');
  }
  const size = snapSize(width, height);
  const t0 = Date.now();
  log('cloud', `t2i → ${config.DASHSCOPE_T2I_MODEL} size=${size}`);
  const resp = await fetch(`${DS_BASE}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.DASHSCOPE_T2I_MODEL,
      input: { messages: [{ role: 'user', content: [{ text: hint }] }] },
      parameters: {
        size,
        negative_prompt: '模糊，水印，文字，印章，题词，变形，低质量',
        watermark: false,
      },
    }),
  });
  const data = await resp.json();
  if (!resp.ok || data.code) {
    throw new Error(`dashscope t2i failed: ${JSON.stringify(data)}`);
  }
  const contents = data.output?.choices?.[0]?.message?.content ?? [];
  const url = contents.find((c) => c.image)?.image;
  if (!url) throw new Error(`dashscope t2i no result: ${JSON.stringify(data)}`);
  log('cloud', `t2i ← ok ${elapsed(t0)}`);
  return downloadTo(url, `tmp/${crypto.randomUUID()}.webp`);
}

// i2v: wan2.7 new protocol, first frame passed as base64 data uri
// (no public url required, works locally too).
export async function dashscopeI2v(imagePath, hint) {
  const t0 = Date.now();
  log('cloud', `i2v → ${config.DASHSCOPE_I2V_MODEL}`);
  const dataUri = await optimizeImageForApi(imagePath, {
    maxSizeKb: 4096, maxDimension: 1920, header: true,
  });
  const taskId = await dsSubmit('/services/aigc/video-generation/video-synthesis', {
    model: config.DASHSCOPE_I2V_MODEL,
    input: {
      prompt: '整体画面保持固定，不要移动镜头，' + hint,
      media: [{ type: 'first_frame', url: dataUri }],
    },
    parameters: { resolution: '1080P', duration: 5 },
  });
  const output = await dsPoll(taskId, { intervalMs: 15000 });
  const url = output.video_url ?? output.results?.[0]?.url;
  if (!url) throw new Error(`dashscope i2v no result: ${JSON.stringify(output)}`);
  log('cloud', `i2v ← ok ${elapsed(t0)}`);
  return downloadTo(url, `tmp/${crypto.randomUUID()}.mp4`);
}
