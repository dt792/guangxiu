// Server entry: Express (REST) + WebSocket (AI worker) + static hosting of the
// frontend build. Start with: npm run server  (working dir = webapp/)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { WebSocketServer } from 'ws';

import config from './config.js';
import { log, logErr, short } from './logger.js';
import { registerWorker, unregisterWorker, resolveTask, workerCount } from './workerManager.js';
import authRouter from './routes/auth.js';
import imagesRouter from './routes/images.js';
import aiProxyRouter from './routes/aiProxy.js';
import cloudAiRouter from './routes/cloudAi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const app = express();

// CORS (same behavior as the old flask_cors: allow all)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '64mb' }));

// health check (keep / for the frontend)
app.get('/api', (req, res) => res.send('这是后端'));

app.use(authRouter);
app.use(imagesRouter);
app.use(aiProxyRouter);
app.use(cloudAiRouter);

app.get('/worker_status', (req, res) => res.json({ workers: workerCount() }));

// static hosting of the frontend build + SPA fallback
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logErr('http', `${req.method} ${req.originalUrl} → ${short(err.message ?? err)}`);
  res.status(500).json({ error: String(err.message ?? err) });
});

const server = http.createServer(app);
// 云端 t2i/i2v 为长轮询请求（i2v 最长约 10 分钟），必须关闭 Node 默认 5 分钟
// requestTimeout，否则连接被静默掐断，浏览器侧表现为“缺少 CORS 头”的跨域报错
server.requestTimeout = 0;

// ---------- AI worker WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws/worker') {
    socket.destroy();
    return;
  }
  if (url.searchParams.get('token') !== config.WORKER_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  registerWorker(ws);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'task_result') {
      resolveTask(msg.task_id ?? '', msg.ok ?? false, msg.data, msg.error ?? '');
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });
  ws.on('close', () => unregisterWorker(ws));
  ws.on('error', () => unregisterWorker(ws));
});

server.listen(config.PORT, config.HOST, () => {
  log('server', `listening on http://${config.HOST}:${config.PORT}`);
});
