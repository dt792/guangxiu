// Image/file helpers: replaces the PIL/cv2 based utilities from the Python backend.
// 所有本地数据统一存放在 server/data/ 下（见 config.js DATA_DIR，已加入 .gitignore）。
// sys.json 中存储的 src/thumbnail 仍为相对 data/ 的路径（如 images/src/xxx.webp），
// 读写文件时一律通过 dataPath() 解析成绝对路径。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';

import { DATA_DIR } from './config.js';

const execFileAsync = promisify(execFile);

export function dataPath(...segs) {
  return path.join(DATA_DIR, ...segs);
}

export function ensureDirs() {
  for (const d of ['tmp', 'images/src', 'images/thumbnail', 'images/boxes', 'images/segs', 'segment_maps']) {
    fs.mkdirSync(dataPath(d), { recursive: true });
  }
}

// 清理 tmp 目录里超过 maxAgeMs 的残留文件（云端下载的临时文件、视频抽帧等），
// 服务启动时调用一次，避免异常退出留下的垃圾越积越多
export function cleanTmpDir(maxAgeMs = 3600_000) {
  const dir = dataPath('tmp');
  if (!fs.existsSync(dir)) return;
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && now - st.mtimeMs > maxAgeMs) fs.rmSync(p, { force: true });
    } catch { /* 单个文件清理失败不影响启动 */ }
  }
}

// 云端生成结果先下载到 data/tmp/，入库复制完成后删除该临时文件
export function rmIfTempFile(p) {
  if (typeof p !== 'string') return;
  const abs = path.resolve(p);
  if (abs.startsWith(dataPath('tmp') + path.sep)) fs.rmSync(abs, { force: true });
}

// Save image buffer as webp src + thumbnail, returns data/-relative paths.
export async function saveImageFiles(id, input) {
  const src = `images/src/${id}.webp`;
  const thumbnail = `images/thumbnail/${id}.webp`;
  const img = sharp(input, { failOn: 'none' });
  await img.clone().webp({ quality: 80 }).toFile(dataPath(src));
  await img.clone().resize({
    width: 200, height: 200, fit: 'inside', withoutEnlargement: true,
  }).webp({ quality: 100 }).toFile(dataPath(thumbnail));
  return { src, thumbnail };
}

// Save video file + first-frame thumbnail (via bundled ffmpeg), returns data/-relative paths.
export async function saveVideoFiles(id, videoPath) {
  const filename = path.basename(videoPath);
  const src = `images/src/${filename}`;
  const thumbnail = `images/thumbnail/${id}.webp`;
  fs.copyFileSync(videoPath, dataPath(src));
  const framePath = dataPath('tmp', `${id}_frame.png`);
  await execFileAsync(ffmpegPath, ['-y', '-i', dataPath(src), '-frames:v', '1', framePath]);
  await sharp(framePath).webp().toFile(dataPath(thumbnail));
  fs.rmSync(framePath, { force: true });
  return { src, thumbnail };
}

// Crop box region with aspect-preserving downscale (used for detection box thumbnails).
export async function cropBoxImage(srcPath, box, outPath, maxDimension = 150) {
  const { x1, y1, x2, y2 } = box;
  const width = Math.max(1, x2 - x1);
  const height = Math.max(1, y2 - y1);
  let newWidth, newHeight;
  if (width > height) {
    newWidth = Math.min(maxDimension, width);
    newHeight = Math.min(Math.round(newWidth / (width / height)), maxDimension);
  } else {
    newHeight = Math.min(maxDimension, height);
    newWidth = Math.min(Math.round(newHeight * (width / height)), maxDimension);
  }
  await sharp(srcPath)
    .extract({ left: x1, top: y1, width, height })
    .resize(newWidth, newHeight)
    .toFile(outPath);
}

// Cut original image by mask (white = keep), returns RGBA buffer same size as mask.
export async function cropImageWithMask(originalPath, maskPath, left, top) {
  const maskImg = sharp(maskPath).greyscale();
  const { width: maskW, height: maskH } = await maskImg.metadata();
  const maskRaw = await maskImg.raw().toBuffer();
  const regionRaw = await sharp(originalPath)
    .extract({ left, top, width: maskW, height: maskH })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const out = Buffer.alloc(maskW * maskH * 4);
  for (let i = 0; i < maskW * maskH; i++) {
    if (maskRaw[i] >= 128) {
      out[i * 4] = regionRaw[i * 4];
      out[i * 4 + 1] = regionRaw[i * 4 + 1];
      out[i * 4 + 2] = regionRaw[i * 4 + 2];
      out[i * 4 + 3] = regionRaw[i * 4 + 3];
    }
  }
  return sharp(out, { raw: { width: maskW, height: maskH, channels: 4 } }).png().toBuffer();
}

// Downscale/compress image to <= maxSizeKb JPEG base64 (for cloud APIs).
export async function optimizeImageForApi(imagePath, { maxSizeKb = 512, maxDimension = 1024, header = true } = {}) {
  let img = sharp(imagePath).flatten().resize({
    width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true,
  });
  let quality = 85;
  let buf;
  for (;;) {
    buf = await img.clone().jpeg({ quality }).toBuffer();
    if (buf.length <= maxSizeKb * 1024 || quality <= 50) break;
    quality -= 5;
  }
  const encoded = buf.toString('base64');
  return header ? `data:image/jpeg;base64,${encoded}` : encoded;
}

export function fileToB64(p) {
  return fs.readFileSync(p).toString('base64');
}

export function b64ToFile(b64, p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}
