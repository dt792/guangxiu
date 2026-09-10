// Business data store: JSON persistence (port of flask_backend/DataDefine.py SysInfo).
// Data file: data/sys.json（所有本地数据统一放在 server/data/ 下）
import fs from 'node:fs';

import { saveImageFiles, saveVideoFiles, ensureDirs, dataPath, rmIfTempFile } from './helpers.js';

ensureDirs();

const SYS_PATH = dataPath('sys.json');
let counter = 0;

function genId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${(counter++) % 10}`;
}

const COLLECTIONS = [
  'uploads', 'generated_statics', 'temp_generated_statics',
  'generated_dynamics', 'temp_generated_dynamics',
  'segmentations', 'temp_segmentations',
];

function emptyUser(id) {
  return {
    id, name: '',
    uploads: [], generated_statics: [], generated_dynamics: [], segmentations: [],
    temp_generated_statics: [], temp_generated_dynamics: [], temp_segmentations: [],
  };
}

function imageInfoToDict(info) {
  return {
    id: info.id,
    name: info.name,
    update_time: info.update_time,
    is_star: info.is_star,
    rating: info.rating,
  };
}

function detectionToDict(d) {
  return {
    id: d.id, d_id: d.d_id, is_star: d.is_star, name: d.name,
    x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, top: d.top, left: d.left,
    confidence: d.confidence ?? null,
  };
}

class Store {
  constructor() {
    if (fs.existsSync(SYS_PATH)) {
      this.data = JSON.parse(fs.readFileSync(SYS_PATH, 'utf8'));
    } else {
      this.data = { publics: [], users: {}, image_infos: {}, detections: [], tasks: {} };
    }
  }

  save() {
    fs.mkdirSync(dataPath(), { recursive: true });
    fs.writeFileSync(SYS_PATH, JSON.stringify(this.data));
  }

  createUser() {
    const userId = genId().slice(0, 8); // same format as python: ddHHMMSS
    this.data.users[userId] = emptyUser(userId);
    this.save();
    return this.data.users[userId];
  }

  ensureUser(userId) {
    if (!this.data.users[userId]) {
      this.data.users[userId] = emptyUser(userId);
      this.save();
    }
    return this.data.users[userId];
  }

  getUserInfo(userId) {
    const user = this.ensureUser(userId);
    // 跳过 image_infos 中已不存在的 id，避免脏数据导致整接口 500
    const pick = (key) => user[key]
      .filter((id) => this.data.image_infos[id])
      .map((id) => imageInfoToDict(this.data.image_infos[id]));
    return {
      id: user.id,
      name: user.name,
      uploads: pick('uploads'),
      generated_statics: pick('generated_statics'),
      temp_generated_statics: pick('temp_generated_statics'),
      generated_dynamics: pick('generated_dynamics'),
      temp_generated_dynamics: pick('temp_generated_dynamics'),
      segmentations: pick('segmentations'),
      temp_segmentations: pick('temp_segmentations'),
    };
  }

  // img: Buffer or path accepted by sharp
  async createUserImageInfo(userId, imageClass, img) {
    const id = genId();
    const { src, thumbnail } = await saveImageFiles(id, img);
    rmIfTempFile(img); // 云端下载的 tmp 临时文件入库后即删
    const info = {
      id, src, thumbnail,
      name: id, is_star: true, rating: -1,
      update_time: new Date().toISOString(),
    };
    this.data.image_infos[id] = info;
    this.ensureUser(userId);
    if (COLLECTIONS.includes(imageClass)) this.data.users[userId][imageClass].push(id);
    this.save();
    return info;
  }

  async createUserVideoInfo(userId, imageClass, videoPath) {
    const id = genId();
    const { src, thumbnail } = await saveVideoFiles(id, videoPath);
    rmIfTempFile(videoPath); // 云端下载的 tmp 临时文件入库后即删
    const info = {
      id, src, thumbnail,
      name: id, is_star: true, rating: -1,
      update_time: new Date().toISOString(),
    };
    this.data.image_infos[id] = info;
    this.ensureUser(userId);
    if (['generated_dynamics', 'temp_generated_dynamics'].includes(imageClass)) {
      this.data.users[userId][imageClass].push(id);
    }
    this.save();
    return info;
  }

  deleteUserImageInfo(userId, imageClass, imageId) {
    const list = this.data.users[userId]?.[imageClass];
    if (list) {
      const idx = list.indexOf(imageId);
      if (idx >= 0) list.splice(idx, 1);
    }
    this.save();
  }

  clearUserImageInfo(userId, imageClass) {
    if (this.data.users[userId]?.[imageClass]) {
      this.data.users[userId][imageClass] = [];
    }
    this.save();
  }

  dectectionStar(dId) {
    for (const item of this.data.detections) {
      if (item.d_id === dId) item.is_star = !item.is_star;
    }
    this.save();
    return null;
  }

  detectionsSortByUserId(userId) {
    const accessible = new Set(this.data.users[userId]?.uploads ?? []);
    const grouped = {};
    for (const d of this.data.detections) {
      if (!accessible.has(d.id)) continue;
      (grouped[d.name] ??= []).push(detectionToDict(d));
    }
    return Object.entries(grouped).map(([name, data]) => ({ name, data }));
  }

  detectionsSortById(id) {
    const grouped = {};
    for (const d of this.data.detections) {
      if (d.id !== id) continue;
      (grouped[d.name] ??= []).push(detectionToDict(d));
    }
    return Object.entries(grouped).map(([name, data]) => ({ name, data }));
  }
}

export const sysInfo = new Store();
export { imageInfoToDict, detectionToDict };
