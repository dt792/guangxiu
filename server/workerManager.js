// AI worker WebSocket manager: workers dial out to this server, tasks are
// dispatched over the socket and resolved on reply (same protocol as the
// Python FastAPI version, ai_worker stays unchanged).
import crypto from 'node:crypto';

import config from './config.js';
import { log, logErr, elapsed, short } from './logger.js';

export class WorkerUnavailableError extends Error {}
export class WorkerTaskError extends Error {}

const workers = new Set();
const pending = new Map(); // taskId -> { resolve, reject, timer }
let rr = 0;

export function registerWorker(ws) {
  workers.add(ws);
  console.log(`[ws] worker connected, total ${workers.size}`);
}

export function unregisterWorker(ws) {
  workers.delete(ws);
  console.log(`[ws] worker disconnected, total ${workers.size}`);
  if (workers.size === 0) {
    for (const [taskId, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new WorkerUnavailableError('AI worker disconnected'));
      pending.delete(taskId);
    }
  }
}

export function resolveTask(taskId, ok, data, error) {
  const p = pending.get(taskId);
  if (!p) return;
  pending.delete(taskId);
  clearTimeout(p.timer);
  if (ok) p.resolve(data);
  else p.reject(new WorkerTaskError(error || 'worker task failed'));
}

export function workerCount() {
  return workers.size;
}

export function submitTask(action, params, timeout = config.WORKER_TASK_TIMEOUT) {
  const list = [...workers];
  if (list.length === 0) {
    logErr('worker', `← ${action} failed: worker offline`);
    return Promise.reject(new WorkerUnavailableError('AI service not connected (worker offline)'));
  }
  const ws = list[(rr++) % list.length];
  const taskId = crypto.randomUUID().replaceAll('-', '');
  const t0 = Date.now();
  log('worker', `→ ${action} task=${taskId.slice(0, 8)}`);

  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(taskId);
      reject(new WorkerTaskError('AI task timeout'));
    }, timeout);
    pending.set(taskId, { resolve, reject, timer });
    ws.send(JSON.stringify({ type: 'task', task_id: taskId, action, params }), (err) => {
      if (err) {
        pending.delete(taskId);
        clearTimeout(timer);
        reject(new WorkerUnavailableError(`worker send failed: ${err.message}`));
      }
    });
  });
  result.then(
    () => log('worker', `← ${action} ok ${elapsed(t0)}`),
    (e) => logErr('worker', `← ${action} failed: ${short(e.message ?? e)}`),
  );
  return result;
}
