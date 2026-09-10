<script setup lang="ts">
import { useImageStore,useUserStore,api,resolve_current_user } from '@/store'
const userStore =useUserStore()
const imageStore =useImageStore()
resolve_current_user().then(uid => {
  imageStore.update_image_infos(uid).then(imageStore.load_thumbnails)
})
async function save() {
  // 发起请求，明确设置 responseType 为 'arraybuffer'
  const response = await api.get("save_backup", );
  alert(response.data)
}
async function load() {
  // 发起请求，明确设置 responseType 为 'arraybuffer'
  const response = await api.get("load_backup", );
  alert(response.data)
}
async function detect() {
  // 未选择图片时不发检测请求（t_selectedImageId 默认占位值 "1" 也视为未选择）
  const id = userStore.t_selectedImageId
  if (!id || id === "1") {
    alert('请先选择一张图片')
    return
  }
  const response = await api.get("detections/update/" + id, );
  alert(response.data)
}
</script>

<template>
<button class="btn" @click="save">保存备份</button>
<button class="btn" @click="load">加载备份</button>
<button class="btn" @click="detect">重新检测</button>
</template>

<style scoped>

</style>