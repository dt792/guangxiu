<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useImageStore, useUserStore, api, resolve_current_user } from '@/store'
import { download_image } from "@/tools.js";
import ImageNameEditor from "@/components/Toolbox/ImageNameEditor.vue";

const userStore = useUserStore()
const imageStore = useImageStore()

// 当前激活的分类
const activeCategory = ref('uploads')

// 分页相关：每页容量由右侧可视区域自适应(列数×行数铺满)
const currentPage = ref(1)
const cols = ref(8)       // 网格列数
const cellSize = ref(150) // 单元格边长(px)
const pageSize = computed(() => cols.value * rowsForHeight())

// 分类映射
const categoryMap = {
  uploads: { name: '上传图', icon: '🖼️', key: 'uploads' },
  generated_statics: { name: '文生图', icon: '✨', key: 'generated_statics' },
  generated_dynamics: { name: '图生视频', icon: '🎬', key: 'generated_dynamics' },
  segmentations: { name: '分割图', icon: '✂️', key: 'segmentations' },
  system_library: { name: '系统图库', icon: '🏛️', key: 'system_library' }
}

// 当前分类标题信息
const activeInfo = computed(() => categoryMap[activeCategory.value] || categoryMap.uploads)

// 获取当前分类的完整图片数组
const currentImages = computed(() => {
  switch (activeCategory.value) {
    case 'uploads': return imageStore.uploads
    case 'generated_statics': return imageStore.generated_statics
    case 'generated_dynamics': return imageStore.generated_dynamics
    case 'segmentations': return imageStore.segmentations
    case 'system_library': return imageStore.systemImages
    default: return []
  }
})

// 总图片数
const totalCount = computed(() => currentImages.value.length)

// 当前页显示的图片（切片）
const paginatedImages = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return currentImages.value.slice(start, end)
})

// 根据可视高计算可容纳的行数（单元格为正方形）
function rowsForHeight() {
  const viewH = window.innerHeight
  // 占用：面板上下padding(20*2) + 内容头(~64) + 分页区(~64)
  const availableH = viewH * 0.9 - 40 - 72 - 64
  return Math.max(2, Math.floor(availableH / (cellSize.value + 8)))
}

// 计算网格列数与单元格尺寸，使右侧铺满
function layoutGrid() {
  const viewW = window.innerWidth
  // 右面板可用宽 ≈ 屏宽 - 左栏(260) - 外距(40) - 右内距(32)
  const availableW = viewW - 260 - 72
  const minCell = 170
  const gap = 8
  cols.value = Math.max(3, Math.floor(availableW / (minCell + gap)))
  // 单元格宽度(铺满) = (可用宽 - 间隙) / 列数
  const w = (availableW - gap * (cols.value - 1)) / cols.value
  cellSize.value = Math.max(120, w)
}

// 布局挂在/卸载
onMounted(() => {
  layoutGrid()
  window.addEventListener('resize', layoutGrid)
})
onUnmounted(() => {
  window.removeEventListener('resize', layoutGrid)
})

// 刷新数据（删除或上传后调用）
const refreshData = async () => {
  await imageStore.update_image_infos(userStore.user_id)
  await imageStore.load_thumbnails()
}

// 收藏切换
async function toggleStar(item) {
  item.is_star = !item.is_star
  await api.put("image/" + item.id, item)
  await refreshData() // 刷新星标状态
}

// 删除图片
async function delete_img(item, cate) {
  await api.delete("image/" + userStore.user_id + "/" + cate + "/" + item.id)
  await refreshData()
  // 如果当前页没有数据了，跳转到上一页
  const newTotal = currentImages.value.length
  const maxPage = Math.ceil(newTotal / pageSize.value)
  if (currentPage.value > maxPage && maxPage > 0) {
    currentPage.value = maxPage
  } else if (newTotal === 0) {
    currentPage.value = 1
  }
}

// 下载图片/视频
async function download_img(item) {
  if (activeCategory.value === 'generated_dynamics') {
    // 视频走 /video/src/ 地址（图片的 /image/src/ 对视频不适用）
    const baseURL = api.defaults.baseURL.replace(/\/$/, '')
    download_image(`${baseURL}/video/src/${item.id}`, item.name)
    return
  }
  await imageStore.load_full(item)
  download_image(item.src, item.name)
}

// 预览图片：静态图弹窗，视频弹窗
async function previewImage(item) {
  if (activeCategory.value === 'generated_dynamics') {
    await on_show_video_modal(item)
  } else {
    await on_show_modal(item)
  }
}

// 静态图弹窗（复用原来的Fancybox）
async function on_show_modal(item) {
  await imageStore.load_full(item)
  Fancybox.show([{
    src: item.src
  }]);
}

// 视频弹窗：直接把流式地址交给播放器，点击即播；
// 旧做法先整段下载成 Blob 再播放，大视频要等很久。
// 注意 Fancybox 5 的 HTML5 视频类型是 'html5video'（'video' 不是有效类型，
// 会只弹遮罩不渲染内容）；地址无 .mp4 后缀，需显式给 videoFormat
async function on_show_video_modal(item) {
  const baseURL = api.defaults.baseURL.replace(/\/$/, '')
  try {
    Fancybox.show([{
      src: `${baseURL}/video/src/${item.id}`,
      type: 'html5video',
      videoFormat: 'video/mp4',
    }]);
  } catch (e) {
    console.log(e)
  }
}

// 分类切换时重置页码
watch(activeCategory, () => {
  currentPage.value = 1
})

// 初始加载数据
resolve_current_user().then(uid => {
  imageStore.update_image_infos(uid).then(imageStore.load_thumbnails)
})
imageStore.load_system_images()

// 分页事件
function handlePageChange(page) {
  currentPage.value = page
}

// ===== 上传图片控件（与 TeachingHelper 一致）=====
const fileInput = ref(null)

const triggerUpload = () => {
  fileInput.value?.click()
}

const handleFileUpload = (event) => {
  const file = event.target.files[0]
  if (file) {
    processFile(file)
  }
  event.target.value = null
}

const handleDrop = (event) => {
  const file = event.dataTransfer.files[0]
  if (file) {
    processFile(file)
  }
}

async function processFile(file) {
  if (!file.type.match('image.*')) {
    alert('请选择图片文件（JPG、PNG、WEBP格式）')
    return
  }
  const formData = new FormData()
  formData.append('image', file)
  try {
    const res = await api.post(`/image/${userStore.user_id}/uploads`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    try {
      await api.get('/detections/update/' + res.data.id)
    } catch (e) {}
    // 跳回第一页并切到"上传图"分类，使新图立即显示
    currentPage.value = 1
    activeCategory.value = 'uploads'
    await refreshData()
  } catch (e) {
    console.error('上传失败:', e)
    alert('上传失败')
  }
}
</script>

<template>
  <div class="two-col-layout">
    <!-- 左侧导航面板 -->
    <div class="left-panel">
      <!-- 面板标题 -->
      <div class="panel-heading">
        <span class="panel-logo">🧮</span>
        <span class="panel-title">素材管理</span>
      </div>

      <!-- 上传图片控件（样式与 TeachingHelper 一致） -->
      <div class="container-upload">
        <div class="upload-area" data-guest-action @click="triggerUpload" @drop.prevent="handleDrop" @dragover.prevent>
          <div class="upload-icon">
            <span class="icon-unicode">📁</span>
          </div>
          <p>点击上传图片或拖放文件到此处</p>
          <p class="hint-text">支持 JPG、PNG、WEBP格式</p>
          <input type="file" ref="fileInput" @change="handleFileUpload" style="display: none;" accept="image/*" />
        </div>
      </div>

      <!-- 分类导航 -->
      <nav class="side-nav">
        <button
          v-for="(info, key) in categoryMap"
          :key="key"
          :class="['nav-item', { active: activeCategory === key }]"
          @click="activeCategory = key"
        >
          <span class="nav-icon">{{ info.icon }}</span>
          <span class="nav-text">{{ info.name }}</span>
        </button>
      </nav>
    </div>

    <!-- 中间区域（网格 + 分页） -->
    <div class="middle-area">
      <!-- 可滚动内容区 -->
      <div class="content-scroll">
        <!-- 分类标题栏 -->
        <div class="content-header">
          <h2 class="content-title">
            <span class="title-icon">{{ activeInfo.icon }}</span>
            {{ activeInfo.name }}
          </h2>
          <span class="content-count">共 {{ totalCount }} 张</span>
        </div>

        <div class="grid-container" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: `${cellSize}px` }">
          <div v-for="img in paginatedImages" :key="img.id" class="grid-cell">
            <template v-if="img">
              <!-- 系统图为前端静态图，无后端id，不提供收藏/删除/改名 -->
              <div v-if="!img.is_system" class="card-actions">
                <button class="act star" :class="{ starred: img.is_star }" title="收藏" @click.stop="toggleStar(img)">
                  <img v-if="img.is_star" class="act-img" src="/collected2.svg" alt="取消收藏" />
                  <img v-else class="act-img" src="/not_collected.svg" alt="收藏" />
                </button>
                <button class="act download" title="下载" @click.stop="download_img(img)">
                  <img class="act-img" src="/download.svg" alt="下载" />
                </button>
                <button class="act delete" title="删除" @click.stop="delete_img(img, activeCategory)">
                  <img class="act-img" src="/delete.svg" alt="删除" />
                </button>
              </div>
              <div v-else class="card-actions">
                <button class="act download" title="下载" @click.stop="download_img(img)">
                  <img class="act-img" src="/download.svg" alt="下载" />
                </button>
              </div>
              <!-- 图片 -->
              <img :src="img.thumbnail" @click="previewImage(img)" loading="lazy" decoding="async" class="grid-img" />
              <!-- 底部名称编辑 -->
              <div class="img-name">
                <ImageNameEditor v-if="!img.is_system" :info="img" />
                <span v-else class="sys-img-name">{{ img.name }}</span>
              </div>
            </template>
          </div>
        </div>
        <div v-if="totalCount === 0" class="empty-tip">暂无图片</div>
      </div>

      <!-- 固定底部分页 -->
      <div class="pagination-wrapper">
        <el-pagination
          small
          background
          layout="prev, pager, next"
          :total="totalCount"
          :page-size="pageSize"
          :current-page="currentPage"
          @current-change="handlePageChange"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.two-col-layout {
  display: flex;
  gap: 20px;
  padding: 20px;
  height: 90dvh;
  box-sizing: border-box;
  overflow: hidden;
  background: #f0f7f1;
}

/* 左侧面板 */
.left-panel {
  width: 260px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: white;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

/* 面板标题 */
.panel-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  color: #2e7d32;
  padding: 4px 6px 10px;
  border-bottom: 1px solid #eef4ee;
}
.panel-logo {
  font-size: 20px;
}

/* 上传图片控件（与 TeachingHelper 一致，适当缩小适配左栏） */
.container-upload {
  --primary-light: #e8f5e9;
  --primary-main: #66bb6a;
  --primary-dark: #2e7d32;
  --text-secondary: #757575;

  width: 100%;
  padding: 14px;
  background: #F3FEEA;
  border-radius: 10px;
  box-shadow: 0 6px 10px rgba(0, 0, 0, 0.1);
  font-family: 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #212121;
  line-height: 1.6;
  box-sizing: border-box;
}
.container-upload .upload-area {
  border: 2px dashed var(--primary-main);
  border-radius: 8px;
  padding: 16px 14px;
  text-align: center;
  margin-bottom: 0;
  cursor: pointer;
  transition: all 0.3s;
  background: var(--primary-light);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}
.container-upload .upload-area:hover {
  background: #dcf0dd;
}
.container-upload .upload-icon {
  font-size: 1.6rem;
  color: var(--primary-dark);
  margin-bottom: 2px;
}
.container-upload p {
  font-size: 12px;
}
.container-upload .hint-text {
  color: var(--text-secondary);
  font-style: italic;
  margin-top: 10px;
  text-align: center;
}

/* 分类导航 */
.side-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: transparent;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  color: #4a5568;
  text-align: left;
  cursor: pointer;
  transition: all 0.25s ease;
  position: relative;
}
.nav-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
}
.nav-text {
  flex: 1;
  font-weight: 500;
}
/* 激活态：左侧指示条 + 渐变浅绿背景 */
.nav-item.active {
  background: linear-gradient(90deg, #dff3e2, #eff9f0);
  color: #1b6e31;
  font-weight: 600;
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 60%;
  border-radius: 0 3px 3px 0;
  background: #2e7d32;
}
.nav-item:hover {
  background: #f0faf2;
}

/* 中间区域 */
.middle-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #ffffff;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
/* 可滚动内容区（高度自适应屏幕，超出时仅此区滚动） */
.content-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* 主区域标题栏 */
.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  margin-bottom: 16px;
  border-bottom: 1px solid #eef4ee;
}
.content-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #2e7d32;
  display: flex;
  align-items: center;
  gap: 8px;
}
.title-icon {
  font-size: 22px;
}
.content-count {
  font-size: 13px;
  color: #8a94a6;
  background: #eff6f0;
  padding: 4px 12px;
  border-radius: 20px;
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
  margin-bottom: 8px;
}
.grid-cell {
  display: flex;
  align-items: stretch;
  background: #fff9e8;
  border-radius: 8px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}
.grid-cell.empty {
  background: #fef7e0;
}
/* 卡片操作按钮（右上角竖排，简洁半透明） */
.card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 2;
}
.act {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.75);
  color: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  transition: all 0.2s ease;
}
.act .act-img {
  width: 16px;
  height: 16px;
  object-fit: contain;
  pointer-events: none;
}
/* 收藏：悬停淡金色，已收藏态金黄圆底高亮（collected.svg自带黄圆） */
.act.star.starred {
  background: #fff7d6;
}
.act.star:hover {
  background: #fff3cd;
  transform: scale(1.1);
}
/* 下载：悬停化蓝 */
.act.download:hover {
  background: #e4f0ff;
  transform: scale(1.1);
}
/* 删除：悬停化红 */
.act.delete:hover {
  background: #ffe3e3;
  transform: scale(1.1);
}
.grid-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: pointer;
  transition: transform 0.2s;
}
.grid-img:hover {
  transform: scale(1.05);
}
.img-name {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.6);
  color: white;
  font-size: 11px;
  padding: 2px 4px;
  text-align: center;
}
.empty-placeholder {
  width: 100%;
  height: 100%;
  background: #fef7e0;
}

/* 分页样式（固定底部，始终可见） */
.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}
.empty-tip {
  text-align: center;
  padding: 40px;
  color: #6c757d;
}

/* 响应式：屏幕越窄，每行列数越少，自适应分辨率 */
@media (max-width: 1600px) {
  .grid-container { grid-template-columns: repeat(7, 1fr); }
}
@media (max-width: 1300px) {
  .grid-container { grid-template-columns: repeat(6, 1fr); }
}
@media (max-width: 1000px) {
  .grid-container { grid-template-columns: repeat(5, 1fr); }
}
@media (max-width: 768px) {
  .grid-container { grid-template-columns: repeat(4, 1fr); }
  .two-col-layout {
    flex-direction: column;
  }
  .left-panel {
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .side-nav {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>