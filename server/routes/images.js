// Image/video resources & user data routes (endpoints unchanged).
import fs from 'node:fs';

import { Router } from 'express';
import multer from 'multer';

import { sysInfo, imageInfoToDict } from '../store.js';
import { cropImageWithMask, dataPath } from '../helpers.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------- image CRUD ----------

router.post('/image/:user_id/:collection', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未找到文件部分' });
  if (req.file.originalname === '') return res.status(400).json({ error: '未选择文件' });
  const info = await sysInfo.createUserImageInfo(
    req.params.user_id, req.params.collection, req.file.buffer
  );
  res.json(imageInfoToDict(info));
});

router.post('/image/:user_id/:collection/:id', (req, res) => {
  const { user_id, collection, id } = req.params;
  const userInfo = sysInfo.ensureUser(user_id);
  if (['generated_statics', 'generated_dynamics', 'segmentations'].includes(collection)) {
    // 防重复入册：重复保存同一 id 不会在图库里产生重复项
    if (!userInfo[collection].includes(id)) userInfo[collection].push(id);
  }
  sysInfo.save();
  res.json(200);
});

router.put('/image/:id', (req, res) => {
  const info = sysInfo.data.image_infos[req.params.id];
  info.name = req.body.name;
  info.is_star = req.body.is_star;
  info.rating = req.body.rating;
  info.update_time = new Date().toISOString();
  sysInfo.save();
  res.json(200);
});

router.delete('/image/:user_id/:collection/:image_id', (req, res) => {
  sysInfo.deleteUserImageInfo(req.params.user_id, req.params.collection, req.params.image_id);
  res.json(200);
});

router.delete('/image_clear/:user_id/:collection', (req, res) => {
  sysInfo.clearUserImageInfo(req.params.user_id, req.params.collection);
  res.json(200);
});

// ---------- detection resources ----------

router.get('/detections/star/:d_id', (req, res) => {
  res.json(sysInfo.dectectionStar(req.params.d_id));
});

router.get('/detections/box/:d_id', (req, res) => {
  const d = sysInfo.data.detections.find((x) => x.d_id === req.params.d_id);
  if (d) return res.type('image/webp').sendFile(dataPath('images/boxes', `${d.d_id}.webp`));
  res.send('None');
});

router.get('/detections_by_user_id/:user_id', (req, res) => {
  res.json(sysInfo.detectionsSortByUserId(req.params.user_id));
});

router.get('/detections/:id', (req, res) => {
  res.json(sysInfo.detectionsSortById(req.params.id));
});

router.get('/segmentations/:d_id', (req, res) => {
  const d = sysInfo.data.detections.find((x) => x.d_id === req.params.d_id);
  if (d) return res.type('image/webp').sendFile(dataPath('images/segs', `${d.d_id}.webp`));
  res.send('None');
});

router.get('/seg_to_temp/:user_id/:d_id', async (req, res) => {
  const d = sysInfo.data.detections.find((x) => x.d_id === req.params.d_id);
  if (!d) return res.status(404).json({ error: 'detection not found' });
  const src = sysInfo.data.image_infos[d.id].src;
  const imgBuffer = await cropImageWithMask(dataPath(src), dataPath('images/segs', `${d.d_id}.webp`), d.left, d.top);
  const info = await sysInfo.createUserImageInfo(req.params.user_id, 'temp_segmentations', imgBuffer);
  res.json(imageInfoToDict(info));
});

router.get('/get_segment_map/:d_id', (req, res) => {
  const mapPath = dataPath('segment_maps', `${req.params.d_id}_result_map.webp`);
  if (!fs.existsSync(dataPath('segment_maps'))) {
    return res.status(404).json({ error: '图片目录不存在' });
  }
  if (fs.existsSync(mapPath)) return res.type('image/webp').sendFile(mapPath);
  res.status(404).json({ error: '图片未找到' });
});

// ---------- queries ----------

router.get('/user/:user_id', (req, res) => {
  res.json(sysInfo.getUserInfo(req.params.user_id));
});

router.get('/image/src/:id', (req, res) => {
  const info = sysInfo.data.image_infos[req.params.id];
  if (!info) return res.status(404).json({ error: 'image not found' });
  res.type('image/webp').sendFile(dataPath(info.src));
});

router.get('/video/src/:id', (req, res) => {
  const info = sysInfo.data.image_infos[req.params.id];
  if (!info) return res.status(404).json({ error: 'video not found' });
  res.type('video/mp4').sendFile(dataPath(info.src));
});

router.get('/image/thumbnail/:id', (req, res) => {
  const info = sysInfo.data.image_infos[req.params.id];
  if (!info) return res.status(404).json({ error: 'image not found' });
  res.type('image/webp').sendFile(dataPath(info.thumbnail));
});

router.get('/image/:id', (req, res) => {
  const info = sysInfo.data.image_infos[req.params.id];
  if (!info) return res.status(404).json({ error: 'image not found' });
  res.json(info);
});

router.get('/task/:task_id', (req, res) => {
  const t = sysInfo.data.tasks[req.params.task_id];
  if (!t) return res.status(404).json({ error: 'task not found' });
  res.json({ id: t.id, process: t.process, state: t.state, img_id: t.img_id });
});

export default router;
