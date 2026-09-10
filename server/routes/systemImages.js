// 系统图库：server/data/system_images/ 下的图片，服务启动时自动扫描并生成缩略图。
// 该目录在 .gitignore 的 data/ 内，图片不进 git；往目录里放图后重启（或再次请求清单）即可生效。
import fs from 'node:fs';
import path from 'node:path';

import { Router } from 'express';
import sharp from 'sharp';

import { dataPath } from '../helpers.js';
import { log } from '../logger.js';

const router = Router();

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const THUMB_WIDTH = 300; // 网格缩略图最大宽度

const IMG_DIR = () => dataPath('system_images');
const THUMB_DIR = () => dataPath('system_images', '.thumbs');

function listImageFiles() {
  if (!fs.existsSync(IMG_DIR())) return [];
  return fs.readdirSync(IMG_DIR(), { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_EXT.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

// 生成缩略图（.thumbs/同名.webp），已存在且未过期的跳过
async function buildThumb(name) {
  const srcPath = path.join(IMG_DIR(), name);
  const thumbPath = path.join(THUMB_DIR(), `${name}.webp`);
  try {
    const sStat = fs.statSync(srcPath);
    try {
      if (fs.statSync(thumbPath).mtimeMs >= sStat.mtimeMs) return;
    } catch { /* 缩略图不存在，继续生成 */ }
    await sharp(srcPath)
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 78 })
      .toFile(thumbPath);
  } catch (err) {
    log('system-images', `缩略图生成失败跳过: ${name} (${err.message})`);
  }
}

// 扫描系统图目录：补齐目录、生成缺失/过期缩略图，返回有序文件名清单
export async function scanSystemImages() {
  fs.mkdirSync(THUMB_DIR(), { recursive: true });
  const files = listImageFiles();
  const CONCURRENCY = 8;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    await Promise.all(files.slice(i, i + CONCURRENCY).map(buildThumb));
  }
  return files;
}

// 文件名参数防目录穿越
const safeName = (req, res) => {
  const name = path.basename(req.params.name);
  if (!IMAGE_EXT.test(name) && !name.endsWith('.webp')) {
    res.status(400).json({ error: 'bad name' });
    return null;
  }
  return name;
};

// 清单：每次请求重新扫描（readdir 开销很小），新放入的图片无需重启即可出现
router.get('/system_images', async (req, res) => {
  res.json(await scanSystemImages());
});

router.get('/system_images/src/:name', (req, res) => {
  const name = safeName(req, res);
  if (!name) return;
  const p = path.join(IMG_DIR(), name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: '图片未找到' });
  res.sendFile(p);
});

router.get('/system_images/thumbnail/:name', async (req, res) => {
  const name = safeName(req, res);
  if (!name) return;
  const thumbPath = path.join(THUMB_DIR(), `${name}.webp`);
  if (!fs.existsSync(thumbPath)) {
    // 缩略图缺失（例如服务运行期间新放的图），现生成一张
    await buildThumb(name);
  }
  if (!fs.existsSync(thumbPath)) return res.status(404).json({ error: '缩略图未找到' });
  res.type('image/webp').sendFile(thumbPath);
});

export default router;
