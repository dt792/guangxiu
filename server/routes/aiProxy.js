// AI inference routes: forwarded to the AI worker over WebSocket.
// Endpoints stay identical for the frontend.
import fs from 'node:fs';

import { Router } from 'express';

import { sysInfo } from '../store.js';
import { cropBoxImage, b64ToFile, fileToB64, dataPath } from '../helpers.js';
import {
  submitTask, WorkerUnavailableError, WorkerTaskError,
} from '../workerManager.js';

const router = Router();

function workerError(res, e) {
  if (e instanceof WorkerUnavailableError) {
    return res.status(503).json({ error: e.message });
  }
  return res.status(500).json({ error: `AI task failed: ${e.message}` });
}

router.get('/detections/update/:id', async (req, res) => {
  const id = req.params.id;
  const info = sysInfo.data.image_infos[id];
  if (!info) return res.status(404).json({ error: 'image not found' });
  const srcPath = dataPath(info.src);
  let result;
  try {
    result = await submitTask('detect_update', { image_b64: fileToB64(srcPath) });
  } catch (e) {
    return workerError(res, e);
  }

  // clear old detections of this image
  sysInfo.data.detections = sysInfo.data.detections.filter((d) => d.id !== id);

  let i = 0;
  for (const item of result.detections ?? []) {
    const [x1, y1, x2, y2] = item.box;
    const dId = `${id}d${i}`;
    const dInfo = {
      d_id: dId, id, image_id: '', is_star: false, name: item.name,
      x1, y1, x2, y2, top: item.top, left: item.left,
    };
    b64ToFile(item.mask_b64, dataPath('images/segs', `${dId}.webp`));
    await cropBoxImage(srcPath, { x1, y1, x2, y2 }, dataPath('images/boxes', `${dId}.webp`));
    sysInfo.data.detections.push(dInfo);
    i += 1;
  }
  sysInfo.save();
  res.json(200);
});

router.post('/classify', async (req, res) => {
  const imageData = req.body?.image_data;
  if (!imageData) return res.status(400).json({ error: '无效的请求' });
  try {
    const result = await submitTask('classify', { image_b64: imageData });
    res.json(result.class_name);
  } catch (e) {
    workerError(res, e);
  }
});

router.post('/segment/:user_id/:id/:bboxes', async (req, res) => {
  const { user_id, id, bboxes } = req.params;
  const info = sysInfo.data.image_infos[id];
  if (!info) return res.status(404).json({ error: 'image not found' });
  let result;
  try {
    result = await submitTask('segment', { image_b64: fileToB64(dataPath(info.src)), bboxes });
  } catch (e) {
    return workerError(res, e);
  }
  const obj = result.objects?.[0];
  if (!obj) return res.status(500).json({ error: '未分割出对象' });
  const imgBuffer = Buffer.from(obj.object_b64, 'base64');
  const created = await sysInfo.createUserImageInfo(user_id, 'temp_segmentations', imgBuffer);
  res.json({
    id: created.id, name: created.name, update_time: created.update_time,
    is_star: created.is_star, rating: created.rating,
  });
});

router.post('/check_segment_map/:user_id/:d_id', async (req, res) => {
  const { d_id } = req.params;
  const imageData = req.body?.image_data;
  if (!imageData) return res.status(400).json({ error: '无效的请求' });

  const resultPath = dataPath('segment_maps', `${d_id}_result_map.webp`);
  if (fs.existsSync(resultPath)) {
    return res.json({
      exists: true, image_url: `/get_segment_map/${d_id}`, message: '针法地图已存在',
    });
  }
  let result;
  try {
    result = await submitTask('segment_map', { image_b64: imageData });
  } catch (e) {
    return workerError(res, e);
  }
  b64ToFile(result.map_b64, resultPath);
  res.json({
    exists: false,
    image_url: `/get_segment_map/${d_id}`,
    message: '针法地图生成成功',
    generated_path: resultPath,
  });
});

router.post('/complete_analysis/:user_id/:id', async (req, res) => {
  const { id } = req.params;
  const info = sysInfo.data.image_infos[id];
  if (!info) return res.status(404).json({ error: 'image not found' });
  try {
    const result = await submitTask('complete_analysis', { image_b64: fileToB64(dataPath(info.src)) });
    res.json(result);
  } catch (e) {
    if (e instanceof WorkerUnavailableError || e instanceof WorkerTaskError) {
      return workerError(res, e);
    }
    res.status(500).json({ error: `分析失败: ${e.message}` });
  }
});

export default router;
