import { readdirSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const IMG_DIR = join(PUBLIC, 'guangxiu_imgs')
const THUMB_DIR = join(IMG_DIR, '.thumbs')
const OUT = join(IMG_DIR, 'index.json')

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i
const THUMB_WIDTH = 300        // 网格缩略图最大宽度（足够清晰且省流量）

function isImageFile(p) {
  return IMAGE_EXT.test(p.name) && statSync(join(p.dir, p.name)).isFile()
}

// 生成网格缩略小图（同名 .webp，放进 .thumbs/），有缓存时跳过
async function buildThumb(srcName) {
  const srcPath = join(IMG_DIR, srcName)
  const thumbPath = join(THUMB_DIR, srcName + '.webp')
  try {
    const sStat = statSync(srcPath)
    if (
      (() => {
        try {
          return statSync(thumbPath).mtimeMs >= sStat.mtimeMs
        } catch {
          return false
        }
      })()
    ) {
      return                                  // 已存在且未过期，跳过
    }
    await sharp(srcPath)
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 78 })
      .toFile(thumbPath)
  } catch (err) {
    console.warn('[gen-system-thumb] 失败跳过:', srcName, err)
  }
}

export async function generateSystemImageIndex() {
  mkdirSync(THUMB_DIR, { recursive: true })
  const dirents = readdirSync(IMG_DIR, { withFileTypes: true })
  const files = dirents
    .filter((d) => d.isFile() && IMAGE_EXT.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))

  const CONCURRENCY = 8
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    await Promise.all(files.slice(i, i + CONCURRENCY).map(buildThumb))
  }
  writeFileSync(OUT, JSON.stringify(files), 'utf-8')
  return files
}

/**
 * Vite 构建/启动插件：每次构建自动把目录内图片生成缩略小图并写 index.json，
 * 前端只显示.原来缩略小图、需要高清时才走原图，因此不写死数量也不让网格掉进大图。
 */
export default function systemImageIndexPlugin() {
  return {
    name: 'guangxiu-system-image-index',
    async buildStart() {
      await generateSystemImageIndex()
    }
  }
}
