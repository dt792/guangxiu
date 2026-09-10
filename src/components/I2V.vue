<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import { useImageStore, useUserStore, api, notyf, resolve_current_user } from '@/store'
import { download_image, generateImageWithText } from '@/tools'
import GenMask2 from '@/components/Toolbox/GenMask.vue'
import ImageNameEditor from "@/components/Toolbox/ImageNameEditor.vue";

const userStore = useUserStore()
const imageStore = useImageStore()
// 进入页面时重置“生成中”遮罩（该状态被持久化，上次失败会残留）
userStore.i2v_gen_mask = false

// 图库折叠状态
const galleryOpen = ref(true)

// 初始化
resolve_current_user().then(uid => {
  imageStore.update_image_infos(uid).then(imageStore.load_thumbnails)
})
imageStore.load_system_images()

// 参考图相关
const ref_src = ref(generateImageWithText(600, 600, '请从左侧图库\n单击选择参考图'))
const ref_id = ref("")

function selected_change(item) {
  // 无论上传图/文生图/系统广绣图库，先在下方绿色预览区立即显示所选图
  ref_src.value = item.thumbnail
  if (item.is_system) {
    // 系统图为前端静态图，无后端 id：需先上传到后端 uploads 获得真实 id 才能出图/生成提示词
    ref_id.value = ""
    notyf.info('正在上传系统图...')
    selectedChangeSystem(item).then(() => {
      notyf.success('系统图已就绪')
    })
    return
  }
  ref_id.value = item.id
}

// 系统图上传后端并选中（获取真实id）
async function selectedChangeSystem(item) {
  const res = await fetch(item.src)
  const blob = await res.blob()
  const file = new File([blob], item.name, { type: blob.type || 'image/jpeg' })
  const formData = new FormData()
  formData.append('image', file)
  const up = await api.post(`/image/${userStore.user_id}/uploads`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  const id = up.data.id
  await imageStore.update_image_infos(userStore.user_id)
  ref_id.value = id
}

// AI 提示词
function get_hint() {
  if (ref_id.value == "") {
    notyf.error('请先选择参考图');
    return
  }
  userStore.i2v_hint = '生成中。。。'
  api.get("qwen_vl/" + ref_id.value + "/" + userStore.i2v_style).then(res => {
    if (res.data && res.data.length > 0) {
      userStore.i2v_hint = res.data.map(item => item.prompt).join('，')
    } else {
      userStore.i2v_hint = ''
      notyf.error('生成提示词失败，请重试')
    }
  }).catch(() => {
    userStore.i2v_hint = ''
    notyf.error('生成提示词失败，请重试')
  })
}

// 视频生成
let progressInterval;
const gen_process = ref(0)
async function make() {
  if (ref_id.value == "") {
    notyf.error('请先选择参考图');
    return
  }
  userStore.i2v_gen_mask = true
  gen_process.value = 0
  notyf.success('开始生成，大约耗时三分钟');
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    if (gen_process.value >= 90) {
      clearInterval(progressInterval);
    } else {
      gen_process.value += 1.0 / 25 / 2;
    }
  }, 40);

  api.get(`i2v/${userStore.user_id}/${ref_id.value}/${encodeURIComponent(userStore.i2v_hint)}`).then(async (res) => {
    let item = res.data
    item.selected = ref(false);
    item.src = api.defaults.baseURL.replace(/\/$/, '') + "/video/src/" + item.id
    let src_thumbnail = await imageStore.get_thumbnail(item.id);
    selected_g.value = item.src
    item.thumbnail = src_thumbnail
    imageStore.temp_generated_dynamics.unshift(item)
    userStore.i2v_gen_mask = false
    selected_g_changed(item)
    gen_process.value = 100
  }).catch(() => {
    // 生成失败时关闭“生成中”遮罩，否则提示图会一直显示
    userStore.i2v_gen_mask = false
    clearInterval(progressInterval)
    gen_process.value = 0
    notyf.error('视频生成失败，请重试')
  });
}

// 右侧生成视频列表相关
var selected_g = ref(null)
const video_src = ref("")
let videoRef = null
onMounted(() => {
  videoRef = document.getElementById("videoRef")
})

async function selected_g_changed(item) {
  userStore.i2v_gen_mask = false
  selected_g.value = item
  try {
    selected_g.value.selected = false
  } catch (e) { }
  item.src = api.defaults.baseURL.replace(/\/$/, '') + "/video/src/" + item.id
  video_src.value = api.defaults.baseURL.replace(/\/$/, '') + "/video/src/" + item.id
  selected_g.value = item
  item.selected = ref(true)
  rating.value = selected_g.value.rating
  await nextTick()
  if (videoRef) {
    videoRef.load()
    videoRef.play().catch(e => console.log("播放失败:", e))
  }
}

async function to_user_g() {
  if (!selected_g.value) {
    notyf.error('请先从暂存区选择要保存的视频')
    return
  }
  const item = selected_g.value
  await api.post(`/image/${userStore.user_id}/generated_dynamics/${item.id}`)
  // 保存到图库后移出暂存区（本地列表 + 服务端同步）
  const index = imageStore.temp_generated_dynamics.indexOf(item)
  if (index > -1) imageStore.temp_generated_dynamics.splice(index, 1)
  api.delete(`/image/${userStore.user_id}/temp_generated_dynamics/${item.id}`)
  if (!imageStore.generated_dynamics.some(x => x.id === item.id)) {
    imageStore.generated_dynamics.unshift(item)
  }
  notyf.success('已保存到图库并移出暂存区！');
}
function download_g() {
  download_image(video_src.value, "download")
}
function delete_g() {
  const index = imageStore.temp_generated_dynamics.indexOf(selected_g.value);
  if (index > -1) {
    imageStore.temp_generated_dynamics.splice(index, 1);
  }
  api.delete(`/image/${userStore.user_id}/temp_generated_dynamics/${selected_g.value.id}`)
}
function clear_g() {
  // 暂存区不会自动清空，手动清空前二次确认防误触
  if (!window.confirm(`确定清空全部暂存生成视频吗？共 ${imageStore.temp_generated_dynamics.length} 个，此操作不可恢复`)) return
  imageStore.temp_generated_dynamics.length = 0
  api.delete(`/image_clear/${userStore.user_id}/temp_generated_dynamics`)
}

// 管理员（账号 Z）直传视频到暂存生成视频，访客可见
const isAdmin = computed(() => userStore.isLoggedIn && userStore.username === 'Z')
const adminFileInput = ref(null)
async function adminUpload(e) {
  const file = e.target.files[0]
  e.target.value = null
  if (!file) return
  if (!file.type.match('video.*')) {
    notyf.error('请选择视频文件')
    return
  }
  const formData = new FormData()
  formData.append('file', file)
  try {
    const res = await api.post('/upload_temp/temp_generated_dynamics', formData)
    let item = res.data
    item.selected = ref(false)
    item.src = api.defaults.baseURL.replace(/\/$/, '') + '/video/src/' + item.id
    item.thumbnail = await imageStore.get_thumbnail(item.id)
    imageStore.temp_generated_dynamics.unshift(item)
    notyf.success('已上传到暂存生成视频')
  } catch (err) {
    notyf.error(err.response?.data?.error || '上传失败')
  }
}

// 评分
const rating = ref(0)
function make_rating(i) {
  rating.value = i
  if (selected_g.value) {
    selected_g.value.rating = i
    api.put("image/" + selected_g.value.id, selected_g.value)
  }
}

// 图库选项卡
const galleryTab = ref('uploads')

// AI 风格下拉开关
const styleOpen = ref(false)
const styleWrap = ref(null)
function pickStyle(s) {
  userStore.i2v_style = s
  styleOpen.value = false
}
function onDocClick(e) {
  if (styleOpen.value && styleWrap.value && !styleWrap.value.contains(e.target)) {
    styleOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
// 图库图片列表（按选项卡分组）
const uploadGalleryImages = computed(() => imageStore.uploads)
const genStaticGalleryImages = computed(() => imageStore.generated_statics)

// 系统广绣图库（前端静态图）
const systemGalleryImages = computed(() => imageStore.systemImages)

// 当前选项卡对应的图片
const activeGalleryImages = computed(() => {
  switch (galleryTab.value) {
    case 'gen_statics': return genStaticGalleryImages.value
    case 'system': return systemGalleryImages.value
    default: return uploadGalleryImages.value
  }
})

import { nextTick } from 'vue'
</script>

<template>
  <div class="three-column-layout">
    <!-- 左侧面板 -->
    <div class="left-panel">
      <!-- 图库区域（可折叠） -->
      <div class="gallery-area">
        <div class="gallery-header" @click="galleryOpen = !galleryOpen">
          <span class="section-title">📁 图库（点击选择参考图）</span>
          <span class="toggle-icon">{{ galleryOpen ? '▾' : '▸' }}</span>
        </div>
        <div v-show="galleryOpen">
          <!-- 选项卡切换按钮 -->
          <div class="gallery-tabs">
            <button class="gallery-tab-btn" :class="{ active: galleryTab === 'uploads' }"
              @click="galleryTab = 'uploads'">上传图</button>
            <button class="gallery-tab-btn" :class="{ active: galleryTab === 'gen_statics' }"
              @click="galleryTab = 'gen_statics'">文生图</button>
            <button class="gallery-tab-btn" :class="{ active: galleryTab === 'system' }"
              @click="galleryTab = 'system'">系统广绣图库</button>
          </div>
          <!-- 滚动网格：固定高度，防止占据过大左侧高度 -->
          <div class="gallery-grid" data-guest-action>
            <div v-for="img in activeGalleryImages" :key="img.id" class="gallery-item" @click="selected_change(img)">
              <img :src="img.thumbnail" class="gallery-thumb" />
              <div class="gallery-name">{{ img.name }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 参考图（标题左对齐，图片居中） -->
      <div class="ref-image">
        <div class="section-title">参考图</div>
        <div class="ref-img-wrapper">
          <img :src="ref_src" class="ref-img" />
        </div>
      </div>

      <!-- AI 提示词生成 -->
      <div class="ai-section">
        <div class="section-title">AI 提示词生成</div>
        <div class="ai-header">
          <div class="style-wrap" ref="styleWrap">
            <button class="style-btn" @click="styleOpen = !styleOpen">
              风格：{{ userStore.i2v_style }} <span class="caret">▾</span>
            </button>
            <ul v-show="styleOpen" class="style-dropdown">
              <li v-for="s in ['默认', '优雅', '有趣']" :key="s" class="style-option"
                  :class="{ selected: userStore.i2v_style === s }"
                  @click="pickStyle(s)">
                <span class="opt-check">{{ userStore.i2v_style === s ? '✓' : '' }}</span>
                <span class="opt-label">{{ s }}</span>
              </li>
            </ul>
          </div>
          <button class="action-btn" data-guest-action @click="get_hint">生成提示词</button>
          <button class="action-btn" data-guest-action @click="get_hint">换一批</button>
        </div>
      </div>

      <!-- 提示词文本框 -->
      <div class="prompt-section">
        <div class="section-title">提示词</div>
        <textarea class="prompt-input" v-model="userStore.i2v_hint" rows="4" placeholder="请选择参考图后点击'生成提示词'，或手动输入"></textarea>
      </div>

      <button class="generate-btn" data-guest-action @click="make">开始生成</button>
    </div>

    <!-- 中间面板：视频 -->
    <div class="center-panel">
      <div class="video-container" style="position: relative;top: 0.1125rem;">
        <video ref="videoRef" :src="video_src" class="video-player" controls></video>
        <GenMask2 v-show="userStore.i2v_gen_mask" class="gen-mask" />
      </div>
      <progress class="progress-bar" :value="gen_process" max="100"></progress>
    </div>

    <!-- 右侧面板 -->
    <div class="right-panel">
      <div class="video-management">
        <div class="section-title">暂存生成视频</div>
        <div class="video-list">
          <div v-for="item in imageStore.temp_generated_dynamics" :key="item.id"
               :class="['video-item', { active: selected_g === item }]"
               @click="selected_g_changed(item)">
            <img :src="item.thumbnail" class="video-thumb" />
            <ImageNameEditor :info="item" class="video-name" />
          </div>
        </div>

        <div class="panel-footer">
          <div class="action-buttons">
            <button v-if="isAdmin" class="action-btn admin-upload" @click="adminFileInput.click()">上传视频</button>
            <button class="action-btn save" data-guest-action @click="to_user_g">保存</button>
            <button class="action-btn download" @click="download_g">下载</button>
            <button class="action-btn delete" @click="delete_g">删除</button>
            <button class="action-btn clear" @click="clear_g">全部清空</button>
          </div>
          <input type="file" ref="adminFileInput" style="display:none" accept="video/*" @change="adminUpload" />

          <!-- 评分置底 -->
          <div class="rating-area">
            <div class="rating-title">✨ 请为这份生成视频打个分吧~</div>
            <div class="rating-stars">
              <span v-for="i in 5" :key="i" class="star" :class="{ active: rating >= i }" @click="make_rating(i)">★</span>
            </div>
            <div class="rating-labels">
              <span :class="{ active: rating === 1 }">很差</span>
              <span :class="{ active: rating === 2 }">较差</span>
              <span :class="{ active: rating === 3 }">一般</span>
              <span :class="{ active: rating === 4 }">较好</span>
              <span :class="{ active: rating === 5 }">很好</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 整体布局 */
.three-column-layout {
  display: flex;
  gap: 20px;
  padding: 20px;
  height: 90dvh;
  box-sizing: border-box;
  background: #f5f7fa;
  overflow: hidden;
}

.left-panel {
  width: 380px;
  background: white;
  border-radius: 20px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.center-panel {
  flex: 1;
  background: white;
  border-radius: 20px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding-top: 16px;
}

.right-panel {
  width: 320px;
  background: white;
  border-radius: 20px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

/* 图库区域 */
.gallery-area {
  flex-shrink: 0;
  border-bottom: 2px solid #e8f5e9;
  padding-bottom: 12px;
}
.gallery-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}
.gallery-tab-btn {
  background: #eef7ee;
  border: none;
  border: 1px solid transparent;
  padding: 6px 14px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.85rem;
  color: #4a7c63;
  font-weight: 500;
  transition: all 0.25s ease;
  white-space: nowrap;
}
.gallery-tab-btn:hover {
  background: #d9eed9;
}
.gallery-tab-btn.active {
  background: #71ba94;
  color: #fff;
  box-shadow: 0 2px 8px rgba(113, 186, 148, 0.4);
}
.gallery-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}
.gallery-header .section-title {
  margin-bottom: 0;
}
.toggle-icon {
  font-size: 1.2rem;
  color: #71ba94;
  margin-right: 4px;
}
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px;
  margin-top: 8px;
  overflow-y: auto;
  max-height: 320px;
  padding-right: 4px;
}
.gallery-item {
  cursor: pointer;
  background: #f9f9f9;
  border-radius: 10px;
  padding: 4px;
  text-align: center;
  transition: 0.2s;
}
.gallery-item:hover {
  background: #e0f2e9;
  transform: scale(1.02);
}
.gallery-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 6px;
}
.gallery-name {
  font-size: 0.7rem;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 参考图：标题左对齐，图片居中 */
.ref-image {
  /* 保持默认左对齐，不设置 align-items */
}
.ref-img-wrapper {
  display: flex;
  justify-content: center;   /* 图片居中 */
  width: 100%;
}
.ref-img {
  width: 150px;
  height: 150px;
  object-fit: contain;
  background: #c7e9b8;  /* 与 TeachingHelper 预览区一致：浅绿背景 */
  border-radius: 12px;
  margin-top: 4px;
}

/* 通用标题 */
.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 6px;
  border-left: 4px solid #71ba94;
  padding-left: 10px;
}
.prompt-input {
  width: 100%;
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 10px;
  font-size: 0.9rem;
  resize: vertical;
}
.ai-header {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
/* 三者等高、同一行对齐的公共按钮体型 */
.style-btn,
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 16px;
  border: none;
  border-radius: 16px;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
  transition: all 0.2s ease;
}
/* 风格下拉触发钮 —— 浅绿底 + 浅色描边，观感近似“选择框”，弱于操作按钮 */
.style-wrap {
  position: relative;
}
.style-btn {
  position: relative;
  gap: 6px;
  background: #eef8ef;
  color: #2e7d32;
  font-weight: 600;
  border: 1px solid #b6dcc0;
}
.style-btn .caret {
  font-size: 0.62rem;
  color: #79b889;
}
.style-btn:hover {
  background: #e3f2e5;
  border-color: #9ed0ab;
}
/* 生成提示词 / 换一批 —— 一致且更高的浅绿实底，突出“按钮”；与下拉区分 */
.action-btn {
  background: #9ed8aa;
  color: #14532d;
}
.action-btn:hover {
  background: #85cc94;
  box-shadow: 0 2px 6px rgba(126, 194, 142, 0.25);
}
.action-btn:active {
  transform: translateY(1px);
}
/* 风格下拉：紧贴风格按钮正下方显示 */
.style-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  margin: 0;
  padding: 6px;
  min-width: 100%;
  background: #ffffff;
  border: 1px solid #e3ece3;
  border-radius: 12px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  overflow: hidden;
  box-sizing: border-box;
}
.style-dropdown .style-option {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  margin: 2px 0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  white-space: nowrap;
  transition: background 0.15s ease;
}
.style-dropdown .style-option:hover {
  background: #f1f8ef;
}
.style-dropdown .style-option.selected {
  background: #e3f2e7;
  color: #2e7d32;
  font-weight: 600;
}
.style-dropdown .opt-check {
  width: 16px;
  flex-shrink: 0;
  color: #4caf7a;
  font-weight: 700;
}
.hint-list {
  max-height: 180px;
  overflow-y: auto;
  border-top: 1px solid #eee;
}
.hint-item {
  padding: 6px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
}
.hint-item:hover {
  background: #f1f8e9;
}
.hint-prompt {
  font-weight: 500;
}
.hint-suggestion {
  font-size: 0.8rem;
  color: #666;
  white-space: pre-line;
}
.generate-btn {
  background: #71ba94;
  color: white;
  border: none;
  border-radius: 40px;
  padding: 12px;
  font-size: 1rem;
  font-weight: bold;
  cursor: pointer;
  margin-top: 8px;
}

/* 中间视频 */
.video-container {
  position: relative;
  width: 100%;
  max-width: 800px;
  aspect-ratio: 16 / 10;
  background: #000;
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}
.video-player {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.gen-mask {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 200px;
}
.progress-bar {
  width: 100%;
  max-width: 800px;
  height: 12px;
  border-radius: 6px;
}

/* 右侧视频管理 */
.video-management {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.video-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.panel-footer {
  flex-shrink: 0;
  margin-top: auto;
  border-top: 1px solid #e8f5e9;
  padding-top: 12px;
}
.video-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  cursor: pointer;
  background: #f5f5f5;
}
.video-item.active {
  background: #e0f2e9;
  border: 1px solid #71ba94;
}
.video-thumb {
  width: 50px;
  height: 50px;
  object-fit: cover;
  border-radius: 8px;
}
.video-name {
  flex: 1;
  font-size: 0.8rem;
}
.action-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.action-btn {
  padding: 8px;
  border: none;
  border-radius: 30px;
  font-weight: bold;
  cursor: pointer;
  background: #f0f0f0;
}
.action-btn.save { background: #85c0a0; color: white; }
.action-btn.download { background: #8bb8ad; color: white; }
.action-btn.delete { background: #e09a9a; color: white; }
.action-btn.clear { background: #d6b578; color: white; }
.action-btn.admin-upload { background: #9b8cc9; color: white; }

/* 评分置底 */
.rating-area {
  text-align: center;
  padding-top: 12px;
}
.rating-title {
  font-size: 0.9rem;
  color: #333;
  margin-bottom: 6px;
}
.rating-stars {
  font-size: 1.8rem;
  letter-spacing: 5px;
  cursor: pointer;
}
.star {
  color: #ccc;
  transition: 0.2s;
}
.star.active {
  color: #ffc107;
}
.rating-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  margin-top: 4px;
  color: #aaa;
}
.rating-labels span {
  flex: 1;
  text-align: center;
}
.rating-labels span.active {
  color: #ffc107;
  font-weight: bold;
}
</style>