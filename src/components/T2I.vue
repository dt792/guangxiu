<script setup lang="ts">
import { ref,reactive,toRaw ,computed, onMounted,  watch} from "vue";
import { useImageStore,useUserStore,api ,notyf,resolve_current_user} from '@/store'
const userStore =useUserStore()
const imageStore =useImageStore()
resolve_current_user().then(uid => {
  imageStore.update_image_infos(uid).then(imageStore.load_thumbnails)
})
import {example_poetrys, poetry_categories} from '@/store'
import GenMask from '@/components/Toolbox/GenMask.vue'
onMounted(()=>{
  ref_selector_modal=document.getElementById("ref_selector_modal")
})
//选择古诗词------------------------------------------------------------------
const recomand_poetrys=ref([])
function rerecomand_poetrys(){
 // 创建数组副本避免修改原数组
  const shuffled = [...example_poetrys];
  // Fisher-Yates 洗牌算法
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  recomand_poetrys.value=shuffled.slice(0, 3);
}
rerecomand_poetrys()
function set_poetry(item){
  userStore.t2i_poem=item.title+item.body
}
function randomGenerate(){
  rerecomand_poetrys()
  const pool = recomand_poetrys.value.length ? recomand_poetrys.value : example_poetrys
  set_poetry(pool[Math.floor(Math.random() * pool.length)])
}
// 使用示例：
let isGenerating = false;  // 控制变量（初始为true）
function startPoemHintAnimation() {
  isGenerating=true;
  let texts=['生成中.','生成中..','生成中...','生成中....','生成中.....','生成中......']
  let i=0
  // 假设 isGenerating 是一个外部变量，控制循环是否继续
  let intervalId = setInterval(() => {
    if (!isGenerating) {
      clearInterval(intervalId);  // 条件为false时停止循环
      return;
    }
    userStore.t2i_poem_hint=texts[i%6]
    i+=1
  }, 200);  // 每300毫秒执行一次
}
async function poetry2hint(){
  let p= `针对古诗词“${userStore.t2i_poem}”给出其中文提示词用于生成图片,用通俗的语言描述具体场景，物品以及所在的位置，适当留白`
  startPoemHintAnimation();
  const response =await api.get(`poetry2hint/${p}`)
  userStore.t2i_poem_hint=response.data
  isGenerating=false;
}
let progressInterval;
//控制参数---------------------------------------------------------------------------
import {generateImageWithText} from '@/tools.js'
var is_use_ref_img=false
const ref_img_src=ref(generateImageWithText(600,400,"参考图"))
var ref_selector_modal=undefined
var ref_id=""
var is_first=true
// function ref_selected_changed(item){
//   is_use_ref_img=true
//   ref_id=item.id
//   ref_img_src.value=item.thumbnail
//   ref_selector_modal.close()
//   userStore.t2i_gen_num=1
// }
// function ref_selected_cancel(){
//   is_use_ref_img=false
//   ref_img_src.value=generateImageWithText(600,400,"参考图")
//   ref_selector_modal.close()
// }
//生成---------------------------------------------------------------------------------------------
import {download_image} from '@/tools'
userStore.t2i_gen_mask=false
import ImageNameEditor from "@/components/Toolbox/ImageNameEditor.vue";
async function make(){
  if(is_first){
    notyf.success('首次加载，大约耗时两分钟');
    is_first=false
  }
  else {
    notyf.success('开始生成，大约耗时四十秒');
  }

  userStore.t2i_gen_mask=true
  g_src.value=generateImageWithText(600,600,"")
  gen_process.value=0
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    if (gen_process.value >= 90) {
      clearInterval(progressInterval);
    }
    else{
      gen_process.value += 0.03;
    }
  }, 40);


  // process_animate(30)
  let width=1024
  let height=1024
  if(userStore.t2i_pixel_index==1){
    width=768
    height=1280
  }
  else if(userStore.t2i_pixel_index==2){
    width=1280
    height=768
  }
  const data = {
    hint: userStore.t2i_poem_hint,
    lora: userStore.t2i_lora.toString(),
    cfg: userStore.t2i_cfg.toString(),
    steps:  userStore.t2i_steps.toString(),
    width: width,
    height: height
  };
  console.log(data);
  const dd="asdsadasfasdfsd"
  try {
    const response=await api.post(`t2i/${userStore.user_id}/${dd}`, data, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
    let item=response.data
    console.log("文生图返回值",item)
    item.selected=ref(false);
    let src_data= await imageStore.get_full(item.id);
    let src_thumbnail= await imageStore.get_thumbnail(item.id);
    item.src=src_data
    selected_g.value=src_data
    item.thumbnail=src_thumbnail
    imageStore.temp_generated_statics.unshift(item)
    selected_g_changed(item)
    gen_process.value=100
  } catch (e) {
    // 生成失败时关闭“生成中”遮罩，否则提示图会一直显示
    userStore.t2i_gen_mask=false
    clearInterval(progressInterval)
    gen_process.value=0
    notyf.error('图片生成失败，请重试')
  }
}
const  rating=ref(0)
function make_rating(i){
  console.log(selected_g.value);
  rating.value=i
  selected_g.value.rating=i
  api.put("image/"+selected_g.value.id,selected_g.value)
  console.log(i);
}
var selected_g=ref(null)
const g_src=ref(generateImageWithText(500,500,'请在左侧输入提示词\n点击开始生成',10))
async function selected_g_changed(item){
  userStore.t2i_gen_mask=false
  selected_g.value=item
  try{
    selected_g.value.selected=false
  }catch (e){}

  g_src.value=item.src
  item.selected=true
  rating.value=selected_g.value.rating
}
async function to_user_g(){
  if (!selected_g.value) {
    notyf.error('请先从暂存区选择要保存的图片')
    return
  }
  const item = selected_g.value
  await api.post(`/image/${userStore.user_id}/generated_statics/${item.id}`)
  // 保存到图库后移出暂存区（本地列表 + 服务端同步）
  const index = imageStore.temp_generated_statics.indexOf(item)
  if (index > -1) imageStore.temp_generated_statics.splice(index, 1)
  api.delete(`/image/${userStore.user_id}/temp_generated_statics/${item.id}`)
  if (!imageStore.generated_statics.some(x => x.id === item.id)) {
    imageStore.generated_statics.unshift(item)
  }
  notyf.success('已保存到图库并移出暂存区！');
}
function download_g(){
  download_image(g_src.value, "download")
}
function delete_g(){
  const index = imageStore.temp_generated_statics.indexOf(selected_g.value);
  if (index > -1) {
    imageStore.temp_generated_statics.splice(index, 1);
  }
  api.delete(`/image/${userStore.user_id}/temp_generated_statics/${selected_g.value.id}`)
}
function clear_g(){
  // 暂存区不会自动清空，手动清空前二次确认防误触
  if (!window.confirm(`确定清空全部暂存生成图片吗？共 ${imageStore.temp_generated_statics.length} 张，此操作不可恢复`)) return
  imageStore.temp_generated_statics.length=0
  api.delete(`/image_clear/${userStore.user_id}/temp_generated_statics`)
}

// 管理员（账号 Z）直传图片到暂存文生图，访客可见
const isAdmin = computed(() => userStore.isLoggedIn && userStore.username === 'Z')
const adminFileInput = ref(null)
async function adminUpload(e) {
  const file = e.target.files[0]
  e.target.value = null
  if (!file) return
  if (!file.type.match('image.*')) {
    notyf.error('请选择图片文件')
    return
  }
  const formData = new FormData()
  formData.append('file', file)
  try {
    const res = await api.post('/upload_temp/temp_generated_statics', formData)
    let item = res.data
    item.selected = ref(false)
    item.src = await imageStore.get_full(item.id)
    item.thumbnail = await imageStore.get_thumbnail(item.id)
    imageStore.temp_generated_statics.unshift(item)
    notyf.success('已上传到暂存文生图')
  } catch (err) {
    notyf.error(err.response?.data?.error || '上传失败')
  }
}
var gen_process=ref(0)

// 从词库中选择
import { ref, onMounted, onUnmounted } from 'vue';

// 控制弹窗显示的状态
const showPoemModal = ref(false);

// 当前选中的分类
const activeCategory = ref('recommend');

// 分类列表
const poemCategories = poetry_categories;

// 当前分类下展示的诗词
const currentPoems = ref([]);

// 切换分类
function switchCategory(tag) {
  activeCategory.value = tag;
  if (tag === 'recommend') {
    currentPoems.value = recomand_poetrys.value
  } else {
    const cat = poemCategories.find(c => c.tag === tag)
    currentPoems.value = cat ? cat.poems : []
  }
}

// 为某个分类随机推荐诗词（"换一批"或刷新）
function refreshRecommend() {
  rerecomand_poetrys()
  if (activeCategory.value === 'recommend') {
    currentPoems.value = recomand_poetrys.value
  }
}

// 选择诗词
function selectPoem(poem) {
  userStore.t2i_poem = poem.title + poem.body
}

// 打开弹窗的方法
const openPoetryLibModal = () => {
  showPoemModal.value = true;
  switchCategory('recommend')
};

// 关闭弹窗的方法
const closePoemModal = () => {
  showPoemModal.value = false;
};

// ESC键关闭弹窗
const handleEscKey = (e) => {
  if (e.key === 'Escape' && showPoemModal.value) {
    closePoemModal();
  }
};

// 点击外部关闭弹窗
const handleClickOutside = (e) => {
  if (showPoemModal.value && e.target.classList.contains('fixed')) {
    closePoemModal();
  }
};

// 在组件挂载时添加事件监听
onMounted(() => {
  document.addEventListener('keydown', handleEscKey);
});

// 在组件卸载时移除事件监听
onUnmounted(() => {
  document.removeEventListener('keydown', handleEscKey);
});

</script>


<template>
  <div class="three-column-layout">
    <!-- 左侧面板：古诗词 + 提示词 + 参数 -->
    <div class="left-panel">
      <!-- 古诗词场景理解 -->
      <div class="poem-section">
        <div class="section-title">古诗词场景理解</div>
        <div class="poem-header-line">
          <span class="lib-link" @click="openPoetryLibModal">从词库中选择</span>
        </div>
        <textarea
            :value="userStore.t2i_poem"
            class="prompt-input"
            placeholder="请在此输入诗词。。。"
            rows="5"></textarea>
        <div class="poem-actions">
          <button class="gen-btn small gradient-ai" @click="poetry2hint">AI理解</button>
          <button class="gen-btn small random-ai" @click="randomGenerate">随机生成</button>
        </div>
      </div>

      <!-- 提示词 -->
      <div class="prompt-section">
        <div class="section-title">提示词</div>
        <textarea
            v-model="userStore.t2i_poem_hint"
            class="prompt-input"
            placeholder="请在此输入古诗或由AI理解生成提示词。。。"
            rows="3"></textarea>
      </div>

      <!-- 参数设置 -->
      <div class="params-section">
        <div class="params">
          <label class="param-label">提示词强度(推荐4.0)</label>
          <input class="param-range" type="range" min="2.5" max="5.5" v-model="userStore.t2i_cfg" step="0.05" />
          <div class="range-labels"><span>2.5</span><span>3.5</span><span>4.5</span><span>5.5</span></div>
        </div>

        <div class="params">
          <label class="param-label">风格强度(推荐0.8)</label>
          <input class="param-range" type="range" min="0.6" max="1.2" v-model="userStore.t2i_lora" step="0.05" />
          <div class="range-labels"><span>0.6</span><span>0.8</span><span>1.0</span><span>1.2</span></div>
        </div>

        <div class="params">
          <label class="param-label">采样步数</label>
          <input class="param-range" type="range" min="18" max="27" v-model="userStore.t2i_steps" step="1" />
          <div class="range-labels"><span>18</span><span>21</span><span>24</span><span>27</span></div>
        </div>

        <div class="params">
          <label class="param-label">画面尺寸</label>
          <div class="pixel-options">
            <label :class="['pixel-option', { active: userStore.t2i_pixel_index == 0 }]">
              <input type="radio" class="pixel-radio" name="t2i_pixel"
                     :checked="userStore.t2i_pixel_index==0" @click="userStore.t2i_pixel_index=0" />1024*1024
            </label>
            <label :class="['pixel-option', { active: userStore.t2i_pixel_index == 1 }]">
              <input type="radio" class="pixel-radio" name="t2i_pixel"
                     :checked="userStore.t2i_pixel_index==1" @click="userStore.t2i_pixel_index=1" />768*1280
            </label>
            <label :class="['pixel-option', { active: userStore.t2i_pixel_index == 2 }]">
              <input type="radio" class="pixel-radio" name="t2i_pixel"
                     :checked="userStore.t2i_pixel_index==2" @click="userStore.t2i_pixel_index=2" />1280*768
            </label>
          </div>
        </div>
      </div>

      <button class="generate-btn" data-guest-action @click="make">开始生成</button>
    </div>

    <!-- 中间面板：图片 -->
    <div class="center-panel">
      <div class="image-container">
        <div class="image-frame">
          <img class="image-view" :src="g_src">
          <GenMask v-show="userStore.t2i_gen_mask" :gray="true" class="gen-mask" />
        </div>
      </div>
      <progress class="progress-bar" :value="gen_process" max="100"></progress>
    </div>

    <!-- 右侧面板：暂存文生图 -->
    <div class="right-panel">
      <div class="gallery-management">
        <div class="section-title">暂存文生图</div>
        <div class="gallery-list">
          <div v-for="item in imageStore.temp_generated_statics" :key="item.id"
               :class="['gallery-item', { active: item.selected }]"
               @click="selected_g_changed(item)">
            <img :src="item.thumbnail" class="gallery-thumb" />
            <image-name-editor :info="item" class="gallery-name" />
          </div>
        </div>

        <div class="panel-footer">
          <div class="action-buttons">
            <button v-if="isAdmin" class="action-btn admin-upload" @click="adminFileInput.click()">上传图片</button>
            <button class="action-btn save" data-guest-action @click="to_user_g">保存</button>
            <button class="action-btn download" @click="download_g">下载</button>
            <button class="action-btn delete" @click="delete_g">删除</button>
            <button class="action-btn clear" @click="clear_g">全部清空</button>
          </div>
          <input type="file" ref="adminFileInput" style="display:none" accept="image/*" @change="adminUpload" />

          <!-- 评分置底 -->
          <div class="rating-area">
            <div class="rating-title">✨ 请为这份生成图片打个分吧~</div>
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
  
  <!-- 诗词弹窗 -->
  <!-- 从词库中选择 -->
  <!-- 诗词弹窗 - 使用Vue的v-if或v-show -->
  <div v-if="showPoemModal" class="poem-modal-mask">
      <!-- 弹窗主体 -->
      <div class="poem-modal">
          <!-- 弹窗头部 -->
          <div class="poem-modal-header">
              <h2 class="poem-modal-title"><i class="fa fa-pagelines mr-2"></i>岭南诗词精选</h2>
              <button @click="closePoemModal" class="poem-modal-close">×</button>
          </div>

          <!-- 分类标签栏 -->
          <div class="poem-modal-tabs">
              <div class="poem-modal-tabgroup">
                  <button class="category-btn" :class="{ active: activeCategory === 'recommend' }"
                       @click="switchCategory('recommend')">为你推荐</button>
                  <button v-for="cat in poemCategories" :key="cat.tag"
                       class="category-btn" :class="{ active: activeCategory === cat.tag }"
                       @click="switchCategory(cat.tag)">{{ cat.category }}</button>
              </div>
              <div v-if="activeCategory === 'recommend' && currentPoems.length > 0" class="poem-modal-tool">
                  <button @click="refreshRecommend" class="refresh-poem-btn">
                      <i class="fa fa-refresh mr-1"></i>换一批
                  </button>
              </div>
          </div>

          <!-- 诗词内容区域 -->
          <div class="poem-modal-content">
              <div class="poem-modal-list">
                  <div v-for="(poem, idx) in currentPoems" :key="idx"
                       class="poem-card" @click="selectPoem(poem)">
                      <div class="poem-title">{{ poem.title.replace('——', ' · ') }}</div>
                      <pre class="poem-body">{{ poem.body }}</pre>
                      <div class="poem-select-hint"><i class="fa fa-hand-o-right mr-1"></i>点击选用此诗词</div>
                  </div>
                  <div v-if="currentPoems.length === 0" class="poem-empty">
                      该分类暂无诗词，请选择其他分类
                  </div>
              </div>
          </div>

          <!-- 弹窗底部 -->
          <div class="poem-modal-footer">
              <button @click="closePoemModal" class="poem-modal-confirm">
                  确定
              </button>
          </div>
      </div>
  </div>
  
</template>

<style scoped>
/* ===== 三栏布局（与 I2V 一致） ===== */
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
  flex-shrink: 0;
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
  padding-top: 12px;
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
  flex-shrink: 0;
}

/* 通用标题 */
.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 6px;
  border-left: 4px solid #71ba94;
  padding-left: 10px;
}

/* 左侧 - 古诗词 */
.poem-header-line {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}
.lib-link {
  font-size: 0.8rem;
  color: #71ba94;
  text-decoration: underline;
  cursor: pointer;
}
.lib-link:hover {
  color: #5cae85;
}
.poem-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.gen-btn {
  flex: 1;
  border: none;
  padding: 8px;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: bold;
  cursor: pointer;
  color: white;
}
.gradient-ai { background: #71ba94; }
.gradient-ai:hover { background: #5cae85; }
.random-ai { background: #89c9e6; }
.random-ai:hover { background: #69b7c3; }

/* 左侧 - 提示词与参数 */
.prompt-input {
  width: 100%;
  border: 1px solid #ddd;
  border-radius: 12px;
  padding: 10px;
  font-size: 0.9rem;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
}
.prompt-input:focus {
  outline: none;
  border-color: #71ba94;
}
.params-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.param-label {
  font-size: 0.85rem;
  color: #333;
  margin-bottom: 2px;
}
.param-range {
  width: 100%;
  accent-color: #71ba94;
}
.range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #aaa;
}
.pixel-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pixel-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 4px;
  border: 1px solid #ddd;
  border-radius: 10px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: 0.2s;
}
.pixel-option.active {
  background: #e0f2e9;
  border-color: #71ba94;
  color: #2d5a3f;
  font-weight: 600;
}
.pixel-radio {
  display: none;
}

/* 左侧 - 开始生成按钮 */
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
.generate-btn:hover {
  background: #5cae85;
}

/* 中间 - 图片 */
.image-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}
.image-frame {
  position: relative;
  width: 100%;
  height: 100%;
  background: #eaf7ee;
  border: 12px solid #a8d5ba;
  border-radius: 16px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.image-view {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 4%;
}
.gen-mask {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  max-width: 78%;
  width: 78%;
}
.progress-bar {
  width: 100%;
  height: 12px;
  border-radius: 6px;
  box-sizing: border-box;
}

/* 右侧 - 暂存文生图 */
.gallery-management {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.gallery-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.gallery-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  cursor: pointer;
  background: #f5f5f5;
}
.gallery-item.active {
  background: #e0f2e9;
  border: 1px solid #71ba94;
}
.gallery-thumb {
  width: 55px;
  height: 55px;
  object-fit: cover;
  border-radius: 8px;
}
.gallery-name {
  flex: 1;
  font-size: 0.8rem;
}
.panel-footer {
  flex-shrink: 0;
  margin-top: auto;
  border-top: 1px solid #e8f5e9;
  padding-top: 12px;
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
/* ===== 诗词弹窗样式 ===== */
.poem-modal-mask {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.5);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 50;
}
.poem-modal {
	width: 100%;
	max-width: 900px;
	max-height: 80vh;
	background: #ffffff;
	border-radius: 16px;
	box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
	display: flex;
	flex-direction: column;
	overflow: hidden;
	border: 1px solid #e2e8e4;
}
.poem-modal-header {
	background: linear-gradient(135deg, #71ba94 0%, #5cae85 100%);
	color: #fff;
	padding: 16px 24px;
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-shrink: 0;
}
.poem-modal-title {
	font-size: 1.35rem;
	font-weight: 700;
	margin: 0;
}
.poem-modal-close {
	background: transparent;
	border: none;
	color: #fff;
	font-size: 1.8rem;
	line-height: 1;
	width: 32px;
	height: 32px;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	border-radius: 6px;
	transition: background 0.25s ease;
}
.poem-modal-close:hover {
	background: rgba(255, 255, 255, 0.2);
}
.poem-modal-tabs {
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
	padding: 14px 24px;
	background: #ffffff;
	border-bottom: 1px solid #eef3ef;
	flex-shrink: 0;
}
.poem-modal-tabgroup {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
}
.poem-modal-tool {
	display: flex;
	align-items: center;
	margin-left: auto;
}
.poem-modal-content {
	flex: 1;
	overflow-y: auto;
	padding: 16px 24px;
	background: #ffffff;
}
.poem-modal-list {
	display: flex;
	flex-direction: column;
	gap: 14px;
}
.poem-modal-footer {
	background: #ffffff;
	padding: 14px 24px;
	border-top: 1px solid #eef3ef;
	display: flex;
	justify-content: center;
	flex-shrink: 0;
}
.poem-modal-confirm {
	background: #71ba94;
	color: #fff;
	border: none;
	padding: 9px 32px;
	border-radius: 24px;
	font-size: 0.95rem;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.25s ease;
}
.poem-modal-confirm:hover {
	background: #5cae85;
	box-shadow: 0 3px 10px rgba(113, 186, 148, 0.4);
}
.category-btn {
	background: #eef7ee;
	border: none;
	padding: 6px 16px;
	border-radius: 20px;
	cursor: pointer;
	font-size: 0.9rem;
	color: #4a7c63;
	font-weight: 500;
	transition: all 0.25s ease;
	white-space: nowrap;
	border: 1px solid transparent;
}
.category-btn:hover {
	background: #d9eed9;
}
.category-btn.active {
	background: #71ba94;
	color: #fff;
	box-shadow: 0 2px 8px rgba(113, 186, 148, 0.4);
}

.refresh-poem-btn {
	background: #71ba94;
	color: #fff;
	border: none;
	padding: 6px 14px;
	border-radius: 20px;
	cursor: pointer;
	font-size: 0.85rem;
	transition: all 0.25s ease;
}
.refresh-poem-btn:hover {
	background: #5cae85;
	box-shadow: 0 2px 8px rgba(113, 186, 148, 0.4);
}

.poem-card {
	background: #fff;
	border-radius: 12px;
	padding: 16px 18px;
	border: 1px solid #e8f5e9;
	border-left: 4px solid #71ba94;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
	cursor: pointer;
	transition: all 0.25s ease;
}
.poem-card:hover {
	background: #f0f8f0;
	border-left-color: #5cae85;
	box-shadow: 0 4px 12px rgba(113, 186, 148, 0.15);
	transform: translateY(-2px);
}
.poem-title {
	font-size: 1.05rem;
	font-weight: 700;
	color: #2d5a3f;
	margin-bottom: 8px;
}
.poem-body {
	font-family: 'Kaiti', 'KaiTi', 'STKaiti', serif;
	font-size: 1rem;
	line-height: 1.7;
	color: #3b3b3b;
	white-space: pre-wrap;
	margin: 0;
}
.poem-select-hint {
	margin-top: 10px;
	font-size: 0.78rem;
	color: #9bbfa9;
	text-align: right;
	opacity: 0;
	transition: opacity 0.25s ease;
}
.poem-card:hover .poem-select-hint {
	opacity: 1;
}
.poem-empty {
	text-align: center;
	color: #999;
	padding: 40px 0;
	font-size: 0.95rem;
}

</style>