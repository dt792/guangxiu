<script setup lang="ts" xmlns="http://www.w3.org/1999/html">
	import {
		ref,
		reactive,
		toRaw,
		computed,
		onMounted,
		onUnmounted,
		watch,
		nextTick
	} from "vue";
	import {
		useImageStore,
		useUserStore,
		api,
		notyf,
		resolve_current_user
	} from '@/store'
	import { ElMessage } from 'element-plus'
	const userStore = useUserStore()
	const imageStore = useImageStore()
	resolve_current_user().then(uid => {
		imageStore.update_image_infos(uid).then(imageStore.load_thumbnails)
		console.log("teachingreflash")
		console.log(userStore.user_id)
		console.log(imageStore.uploads)
	})

	var image = undefined
	var canvas = undefined
	var scrollable_Div = undefined
	var ctx = undefined
	onMounted(() => {
		selected_change(userStore.t_selectedImageId)
		image = document.getElementById("image")
		canvas = document.getElementById("canvas")
		scrollable_Div = document.getElementById('scrollable_Div');
		ctx = canvas.getContext('2d');
		scrollable_Div.addEventListener('contextmenu', function(e) {
			e.preventDefault();
		});
		canvas.addEventListener('contextmenu', function(e) {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			e.preventDefault();
		});
		window.addEventListener('resize', updateCanvasGeometry);
		
		// 添加图片加载监听，确保上传图片时画布能正确初始化
		if (image) {
			// 设置跨域属性
			image.crossOrigin = "anonymous";
			image.onload = () => {
			    if (canvas && image.naturalWidth > 0) {
			        canvas.width = image.naturalWidth;
			        canvas.height = image.naturalHeight;
			        display_mask_scale.value = image.height / image.naturalHeight * display_scale.value
			        updateCanvasGeometry();
			    }
			}
		}
	})
	onUnmounted(() => {
		clearTimeout(segToastTimer)
	})
	//图片位置选择---------------------------------------------------------------
	//获取位置检测数据
	const user_detections = reactive([])
	const image_detections = reactive([])
	// 分类下拉中当前选中的分割图（用于高亮）
	const activeUserBox = ref(null)
	const activeImageBox = ref(null)
	function pickBox(panel, ii) {
		if (panel === 'user') activeUserBox.value = ii && ii.d_id
		else activeImageBox.value = ii && ii.d_id
	}
	function isBoxActive(panel, ii) {
		const cur = panel === 'user' ? activeUserBox.value : activeImageBox.value
		return ii && cur != null && cur === ii.d_id
	}

	function sortByStar(a, b) { // 优先按 is_star 排序（true 在前）
		if (b.is_star !== a.is_star) {
			return b.is_star ? 1 : -1;
		}
	}
	function load_user_detections() {
		return api.get("detections_by_user_id/" + userStore.user_id)
			.then(res => {
				console.log("detections_by_id", res)
				user_detections.length = 0;
				for (let cls of res.data) {
					user_detections.push({
						name: cls['name'],
						pos: cls['data'].sort(sortByStar),
						expanded: ref(false)
					})
				}
				for (let cls of user_detections) {
					for (let item of cls.pos) {
						api.get('/detections/box/' + item['d_id'], {
							responseType: 'arraybuffer',
							headers: {
								'Accept': 'image/webp'
							}
						}).then((response) => {
							const data = response.data
							let blob = new Blob([data], {
								type: 'image/webp'
							});
							let src = URL.createObjectURL(blob);
							item.src = src
						})
					}
				}
			})
	}
	load_user_detections()

	function get_image_detections(id) {
		return api.get("detections/" + id)
			.then(res => {
				image_detections.length = 0;
				for (let cls of res.data) {
					image_detections.push({
						name: cls['name'],
						pos: cls['data'],
						expanded: ref(true)
					})
				}
			for (let cls of image_detections) {
				for (let item of cls.pos) {
					console.log('[mask-item]', item.name, 'd=', item.d_id, 'left=', item.left, 'top=', item.top, 'w=', item.w, 'h=', item.h)
					api.get('detections/box/' + item['d_id'], {
							responseType: 'arraybuffer',
							headers: {
								'Accept': 'image/webp'
							}
						}).then((response) => {
							const data = response.data
							let blob = new Blob([data], {
								type: 'image/webp'
							});
							let src = URL.createObjectURL(blob);
							item.src = src
						})
						api.get('segmentations/' + item['d_id'], {
							responseType: 'arraybuffer',
							headers: {
								'Accept': 'image/webp'
							}
						}).then((response) => {
							const data = response.data
							let blob = new Blob([data], {
								type: 'image/webp'
							});
							let src = URL.createObjectURL(blob);
							item.s_src = src
							// 读取掩膜图自然尺寸，用于按原图比例精准显示
							const probe = new Image()
							probe.onload = () => {
								item.w = probe.naturalWidth
								item.h = probe.naturalHeight
								console.log('[mask-size]', item.d_id, 'w=', item.w, 'h=', item.h)
							}
							probe.src = src
						})
					}
				}
				console.log(image_detections)
			})
	}
	//改变选择
	async function selected_change(id, x1 = -1, y1 = -1, x2 = -1, y2 = -1) {
		userStore.t_selectedImageId = id

		// 添加数据加载检查
		const image_info = imageStore.find(id)
		if (image_info === undefined || image_info === null) {
			console.warn(`图像 ID: ${id} 未找到，等待数据加载`);
			return;
		}

		// 确保 image_info 有必要的属性
		if (!image_info.src) {
			console.warn(`图像 ID: ${id} 的 src 属性不存在`, image_info);
			return;
		}

		await imageStore.load_full(image_info)
		canvasHasImage.value = true

		if (display_src.value == image_info.src) {
			if (x1 == -1) {
				display_scale.value = 1
			} else {
				display_scale.value = 2;
				toPosition(x1, y1, x2, y2)
			}
			display_mask_scale.value = image.height / image.naturalHeight * display_scale.value
		} else {
			try {
				get_image_detections(id)
			} catch (e) {
				console.error('获取图像检测信息失败:', e);
			}

			display_src.value = image_info.src

			// 添加 image 对象检查
			if (!image) {
				console.error('image 对象未定义');
				return;
			}

			image.onload = () => {
				// 添加 canvas 对象检查
				if (!canvas) {
				    console.error('canvas 对象未定义');
				    return;
				  }
				
				  canvas.width = image.naturalWidth;  // 确保使用原始尺寸
				  canvas.height = image.naturalHeight;
				  // 关键修改：统一初始化笔触设置
				  initializeBrush();
				  if (x1 == -1) {
				      display_scale.value = 1;
				    } else {
				      display_scale.value = 2;
				      toPosition(x1, y1, x2, y2);
				    }
					display_mask_scale.value = image.height / image.naturalHeight * display_scale.value;
				  console.log('图片加载完成 - 画布尺寸:', {
				    canvas: { width: canvas.width, height: canvas.height },
				    image: { 
				      natural: { width: image.naturalWidth, height: image.naturalHeight },
				      display: { width: image.width, height: image.height }
				    },
				    scale: display_scale.value
				  });
				  updateCanvasGeometry();
				  resetMaskPreview();
			}
		}
	}
	// 主动切换图片/加载到画布后，把唯一预览区清回占位提示，避免上一张图的掩膜残留误判
	function resetMaskPreview() {
		mask_src.value = generateImageWithText(w, h, '按下鼠标左键\n拖动绘制掩膜\n右键取消掩膜', 7)
		mask_class.value = ""
	}
	// 统一的笔触初始化函数
	function initializeBrush() {
	  if (!ctx || !canvas) return;
	  
	  ctx.strokeStyle = 'white';
	  ctx.lineJoin = 'round';
	  ctx.lineCap = 'round';
	  
	  // 关键修改：使用固定的显示笔触大小
	  const displayBrushSize = 40; // 在屏幕上显示为20像素的笔触
	  
	  // 计算画布实际需要的笔触大小
	  const rect = canvas.getBoundingClientRect();
	  if (rect.width > 0) {
	    const scaleToCanvas = canvas.width / rect.width;
	    ctx.lineWidth = displayBrushSize * scaleToCanvas;
	  } else {
	    // 备用方案：基于图片尺寸的合理笔触大小
	    ctx.lineWidth = Math.max(canvas.width, canvas.height) * 0.02; // 图片尺寸的2%
	  }
	  
	  console.log('笔触初始化:', {
	    canvasSize: { width: canvas.width, height: canvas.height },
	    displaySize: { width: rect.width, height: rect.height },
	    brushSize: ctx.lineWidth
	  });
	}
	// async function selected_change(id,x1=-1,y1=-1,x2=-1,y2=-1){
	//   userStore.t_selectedImageId=id
	//   const image_info=imageStore.find(id)
	//   if(image_info===undefined){return}
	//   await imageStore.load_full(image_info)
	//   if(display_src.value==image_info.src){
	//     if(x1==-1){ display_scale.value=1}
	//     else{display_scale.value=2; toPosition(x1,y1,x2,y2)}
	//     display_mask_scale.value=image.height/image.naturalHeight* display_scale.value
	//   }
	//   else {
	//     try{
	//       get_image_detections(id)
	//     }catch (e){}
	//     display_src.value=image_info.src
	//     image.onload=()=>{
	//       canvas.height=image.height;
	//       canvas.width=image.width;
	//       if(x1==-1){ display_scale.value=1}
	//       else{display_scale.value=2;toPosition(x1,y1,x2,y2)}
	//       display_mask_scale.value=image.height/image.naturalHeight* display_scale.value
	//     }
	//   }
	// }

	function toPosition(x1, y1, x2, y2) {
		const rect = image.getBoundingClientRect();
		const factor = rect.height / image.naturalHeight
		const top = x1 * factor
		const w = (x2 - x1) * factor
		const left = y1 * factor
		const h = (y2 - y1) * factor
		smoothScroll(scrollable_Div, left - (500 - w) / 2, // 垂直目标位置（修正了原代码的混淆命名）
			top - (500 - h) / 2, 1000);
	}

	function smoothScroll(element, targetTop, targetLeft, duration = 1000) {
		// 获取起始位置
		const startTop = element.scrollTop;
		const startLeft = element.scrollLeft;

		const startTime = performance.now();

		function animateScroll(currentTime) {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);

			// 使用easeOutCubic缓动函数
			const ease = 1 - Math.pow(1 - progress, 3);

			// 计算当前应该滚动到的位置
			const currentTop = startTop + (targetTop - startTop) * ease;
			const currentLeft = startLeft + (targetLeft - startLeft) * ease;

			element.scrollTo({
				top: currentTop,
				left: currentLeft
			});

			// 继续动画直到完成
			if (progress < 1) {
				requestAnimationFrame(animateScroll);
			}
		}

		requestAnimationFrame(animateScroll);
	}

	function toggleStar(item) {
		item.is_star = !item.is_star
		console.log(item.is_star)
		api.get("detections/star/" + item.d_id)
	}

	//掩膜---------------------------------------------------------------------------
	import {
		generateImageWithText
	} from '@/tools.js'

	const w = 1 * window.innerHeight
	const h = 1 * window.innerHeight
	const display_src = ref(generateImageWithText(w, h, '请从左侧上传\n或选择图片\n滚轮放大缩小\n右键拖动图片', 8))
	const display_scale = ref(1)
	const display_mask_scale = ref(1)
	// 画布是否已真实展示过一帧图片（本地上传 data: 或图库 http）。默认见上面“请先…上传”占位，故非开图。
	const canvasHasImage = ref(false)
	// 掩膜覆盖层定位几何：与 canvas 完全一致（mask-wrap 坐标系内）
	const maskImgRefs = ref([])
	const mask_geom_left = ref(0)
	const mask_geom_top = ref(0)
	const mask_geom_scale = ref(1)
	// 掩膜 img 加载完成时，直接用与 canvas 相同的几何精确设置每张掩膜的位置与尺寸。
	// 这样掩膜绝对对齐到图片内容，不受 img 固有尺寸/响应式渲染时机/Vue 缓存影响。
	function onMaskLoad(e, item) {
		const el = e && e.target
		if (!el) return
		el._item = item
		applyMaskPos(el)
	}
	// 用当前 canvas 几何定位单个掩膜 img
	function applyMaskPos(el) {
		const it = el._item
		if (!el || !el.naturalWidth || !it) return
		const s = mask_geom_scale.value
		el.style.left = (mask_geom_left.value + (parseFloat(it.left) || 0) * s) + 'px'
		el.style.top = (mask_geom_top.value + (parseFloat(it.top) || 0) * s) + 'px'
		el.style.width = (el.naturalWidth * s) + 'px'
		el.style.height = (el.naturalHeight * s) + 'px'
		el.style.visibility = 'visible'
		console.log('[mask-render]', it.d_id, 'rawLeft=', it.left, 'rawTop=', it.top, 'w=', el.naturalWidth, 'h=', el.naturalHeight,
			'left=', el.style.left, 'top=', el.style.top, 'width=', el.style.width, 'height=', el.style.height)
	}
	// 几何变化时重新定位所有已加载掩膜
	function positionMasks() {
		if (maskImgRefs.value) {
			maskImgRefs.value.forEach(el => el && applyMaskPos(el))
		}
	}
	const showUploadHistory = ref(false)

	function div_wheel(e) {
		if (e.deltaY < 0) {
			display_scale.value = display_scale.value + 0.05;
			display_mask_scale.value = image.height / image.naturalHeight * display_scale.value
		} else {
			display_scale.value = display_scale.value - 0.05;
			display_mask_scale.value = image.height / image.naturalHeight * display_scale.value
		}
	}

	// 将 canvas 元素精确定位到图片内容（object-fit:contain）在 mask-wrap 内的显示矩形，
	// 使 canvas buffer（=原图像素）与看到的图片逐像素对齐，绘制/分割/显示完全一致。
	// 位置/尺寸用 JS 计算（不再用 transform:scale），与 img 的 contain-center 显示保持一致。
	function updateCanvasGeometry() {
		const wrap = document.getElementById('mask-wrap');
		if (!canvas || !image || !wrap) return;
		const cw = wrap.clientWidth;
		const ch = wrap.clientHeight;
		const natW = image.naturalWidth;
		const natH = image.naturalHeight;
		if (!cw || !ch || !natW || !natH) return;
		const s = display_scale.value;
		const contentW = natW * s * Math.min(cw / natW, ch / natH);
		const contentH = natH * s * Math.min(cw / natW, ch / natH);
		const contentLeft = (cw * s - contentW) / 2;
		const contentTop = (ch * s - contentH) / 2;
		canvas.style.left = contentLeft + 'px';
		canvas.style.top = contentTop + 'px';
		canvas.style.width = contentW + 'px';
		canvas.style.height = contentH + 'px';
		// 掩膜覆盖层复用同一套几何（原图像素 -> mask-wrap 显示像素），保证与原图精确对齐
		mask_geom_left.value = contentLeft;
		mask_geom_top.value = contentTop;
		mask_geom_scale.value = contentW / natW;
		console.log('[mask-geom] cw=', cw, 'ch=', ch, 'natW=', natW, 'natH=', natH, 's=', s, 'contentW=', contentW, 'contentH=', contentH, 'contentLeft=', contentLeft, 'contentTop=', contentTop, 'scale=', contentW / natW);
		// 几何更新后，立即对所有掩膜重新定位，保证与画布/图片一致
		positionMasks();
	}

	// 缩放或画布容器尺寸变化时重算 canvas 显示几何
	watch(display_scale, () => updateCanvasGeometry());
	// 显示自动分割：打勾时先对该图执行检测+分割，再刷新覆盖层显示
	// 自动处理进度提示（右上角一个小白框：loading 转圈 / done 自动消失，文案按阶段变化）
	const segToast = ref(false)  // 是否显示提示
	const segDone = ref(false)   // true=完成, false=进行中
	const segText = ref('')      // 当前阶段文案
	let segToastTimer = null
	function segLoading(text = '正在处理中，请耐心等待…') {
		segDone.value = false
		segText.value = text
		segToast.value = true
		clearTimeout(segToastTimer)
	}
	function segFinish(text = '分割完成') {
		segDone.value = true
		segText.value = text
		segToast.value = true
		clearTimeout(segToastTimer)
		segToastTimer = setTimeout(() => { segToast.value = false }, 2500)
	}
	function segClear() {
		clearTimeout(segToastTimer)
		segToast.value = false
	}
	// 画布当前是否已打开真实图片：由 canvasHasImage 显式标记（图库 http 与本地上传 data: 均覆盖）
	function imageOpenOnCanvas() {
		return canvasHasImage.value
	}
	// 显示自动分割开关 change：未打开图片则拦截并回弹；允许开启后才置 true 交给 watch 走分割流程
	function onSegToggleChange(e) {
		const target = e && e.target
		const isOn = !!(target && target.checked)
		if (!isOn) {
			userStore.t_mask_s = false
			segClear()
			return
		}
		if (!imageOpenOnCanvas()) {
			if (target) target.checked = false
			segClear()
			ElMessage.warning({ message: '请先打开一张图片', duration: 2600, showClose: true })
			return
		}
		userStore.t_mask_s = true
	}
	// 后端是否已存在该图的检测/分割掩膜缓存（缓存在服务器侧,非浏览器）
	async function hasCachedDetections(id) {
		try {
			const res = await api.get('detections/' + id)
			const arr = res && Array.isArray(res.data) ? res.data : []
			return arr.reduce((total, g) => total + (g.data ? g.data.length : 0), 0) > 0
		} catch (e) {
			return false
		}
	}
	// 执行一次“识别+分割”并分阶段提示：开始自动处理 → 识别完成 → 分割完成。
	// 已有缓存的图只是刷新显示（如开关“显示自动分割”），静默处理，不弹任何提示
	async function autoSegment(id) {
		try {
			const cached = await hasCachedDetections(id)
			if (cached) {
				await get_image_detections(id)
				await load_user_detections()
				return
			}
			// 无缓存：触发后端 YOLO 识别 + SAM2 分割，分阶段提示
			segLoading('开始自动处理，正在识别…')
			await api.get('detections/update/' + id)
			await get_image_detections(id)
			const count = image_detections.reduce((n, g) => n + (g.pos ? g.pos.length : 0), 0)
			segLoading(`识别完成（检出 ${count} 个对象），正在加载分割…`)
			await load_user_detections()
			segFinish('分割完成')
		} catch (e) {
			console.error('目标检测与分割失败:', e)
			segClear()
		}
	}
		// t_mask_s 被置 true：显示该图的分割结果（有缓存则即时展示，无缓存则触发一次分割）
	watch(() => userStore.t_mask_s, (val) => {
		if (!val) {
			segClear()
			return
		}
		const id = userStore.t_selectedImageId
		if (!id) return
		if (!canvasHasImage.value) return   // 未真实开图、开关将自动弹回，不请求
		if (!id.startsWith('uploaded_') || uploadBackendResolved) {
			// 图库图片或后端已返回真实 ID：直接跑分割
			autoSegment(id)
		}
		// 本地上传刚显示、后台还在同步真实 ID：无需等待，
		// 上传完成时会自动对该图跑 autoSegment（见 uploadImageToBackend）
	})

	//后端上传是否已返回真实图片ID（避免本地临时ID覆盖真实ID）
	let uploadBackendResolved = false;
	//右键拖动
	let isDragging = false;
	let isDrawing = false;
	let startX, startY;
	let inittop, initleft;
	let lastX = 0;
	let lastY = 0;

	function on_mouse_down(e) {
		if (e.button === 0) {
			const [x, y] = getCoordinates(e);
			// 点击在图片内容区域之外时不开始绘制
			if (x < 0 || y < 0) return;
			isDrawing = true;
			[lastX, lastY] = [x, y];
		} else if (e.button === 2) {
			isDragging = true
			inittop = scrollable_Div.scrollTop;
			initleft = scrollable_Div.scrollLeft;
			startX = e.clientX;
			startY = e.clientY;
			document.body.style.cursor = 'grab';
		}
	}

	function on_mouse_move(e) {
	  if (isDrawing) {
	    const [currentX, currentY] = getCoordinates(e);
	    
	    // 当前鼠标在图片内容区域之外，只更新起点，不绘制
	    if (currentX < 0 || currentY < 0) {
	      [lastX, lastY] = [currentX, currentY];
	      return;
	    }
	    // 起点若在图片区域之外被拖出时，先移动到当前有效点再继续
	    if (lastX < 0 || lastY < 0) {
	      [lastX, lastY] = [currentX, currentY];
	      return;
	    }
	    
	    ctx.strokeStyle = 'white';
	    ctx.lineJoin = 'round';
	    ctx.lineCap = 'round';
	    
	    // 关键修改：使用基于显示尺寸的固定笔触大小
	    const displayBrushSize = 40; // 在显示层面的笔触大小（像素）
	    
	    // 将显示笔触大小转换为画布笔触大小
	    const rect = canvas.getBoundingClientRect();
	    const scaleToCanvas = canvas.width / rect.width;
	    ctx.lineWidth = displayBrushSize * scaleToCanvas;
	    
	    ctx.beginPath();
	    ctx.moveTo(lastX, lastY);
	    ctx.lineTo(currentX, currentY);
	    ctx.stroke();
	    [lastX, lastY] = [currentX, currentY];
	  } else if (isDragging) {
	    const dx = e.clientX - startX;
	    const dy = e.clientY - startY;
	    scrollable_Div.scroll({
	      top: inittop - dy,
	      left: initleft - dx,
	    })
	  }
	}
	
	async function on_mouse_up(e) {
		if (e.button === 0) {
			if (isDrawing)
				mask_action()
			isDrawing = false
		} else if (e.button === 2) {
			isDragging = false
			document.body.style.cursor = 'default';
		}
	}
	async function on_mouse_out(e) {
		if (e.button === 0) {
			if (isDrawing)
				mask_action()
			isDrawing = false
		} else if (e.button === 2) {
			isDragging = false
			document.body.style.cursor = 'default';
		}
	}

	// function getCoordinates(e) {
	// 	const rect = canvas.getBoundingClientRect();
	// 	return [
	// 		e.clientX - rect.left,
	// 		e.clientY - rect.top
	// 	];
	// }
	function getCoordinates(e) {
		// canvas 元素由 updateCanvasGeometry 精确定位到图片内容（object-fit:contain）的显示矩形，
		// 且其 buffer 即原图像素，因此直接按元素框反算即为原始图像素坐标，绘制与所见完全一致。
		const rect = canvas.getBoundingClientRect();
		const x = (e.clientX - rect.left) / rect.width * canvas.width;
		const y = (e.clientY - rect.top) / rect.height * canvas.height;
		return [x, y];
	}
	//功能区------------------------------------------------------------------------------
	import {
		download_image
	} from '@/tools'
	const mask_src = ref(generateImageWithText(w, h, '按下鼠标左键\n拖动绘制掩膜\n右键取消掩膜', 7))
	const mask_class = ref("")

	let box = []
// 	async function mask_action() {
// 	console.log('开始掩膜处理', {
// 	    canvasSize: { width: canvas.width, height: canvas.height },
// 	    imageSize: { 
// 	      natural: { width: image.naturalWidth, height: image.naturalHeight },
// 	      display: { width: image.width, height: image.height }
// 	    },
// 	    displayScale: display_scale.value
// 	  });
// 	try {
// 		const m = await get_mask()
// 		console.log('掩膜生成完成', m ? '有数据' : '无数据');
// 		const c_m = await cropTransparentBorders(m)
// 		console.log('裁剪完成', c_m ? '有数据' : '无数据');
// 		// 确保掩膜正确设置到预览区
// 		if (c_m && c_m[0]) {
// 			mask_src.value = c_m[0]
// 			box = c_m[1]
// 			console.log('掩膜预览已更新', { box: box });
// 		} else {
// 			console.warn('掩膜生成失败')
// 			// 如果掩膜生成失败，显示提示
// 			mask_src.value = generateImageWithText(w, h, '掩膜生成失败\n请重新涂抹', 2.3)
// 		}
		
// 		if (userStore.t_auto_classify) {
// 			classify()
// 		}
// 		// if(userStore.t_auto_segment){
// 		//   segment_box()
// 		// }
// 	} catch (error) {
// 		console.error('掩膜处理错误:', error)
// 		// 出错时显示错误提示
// 		mask_src.value = generateImageWithText(w, h, '掩膜处理错误\n请重新尝试', 2.3)
// 	}
// }
	async function mask_action() {
	    console.log('开始掩膜处理', {
	        canvasSize: { width: canvas.width, height: canvas.height },
	        imageSize: { 
	            natural: { width: image.naturalWidth, height: image.naturalHeight },
	            display: { width: image.width, height: image.height }
	        },
	        displayScale: display_scale.value
	    });
	    
	    try {
	        const m = await get_mask()
	        console.log('掩膜生成完成', m ? '有数据' : '无数据');
	        
	        // 关键修改：直接使用画布计算边界框，而不是裁剪后的图像
	        const originalBox = await calculateMaskBoundingBoxFromCanvas();
	        console.log('掩膜边界框:', originalBox);
	        
	        const c_m = await cropTransparentBorders(m)
	        console.log('裁剪完成', c_m ? '有数据' : '无数据');
	        
	        // 确保掩膜正确设置到预览区
	        if (c_m && c_m[0]) {
	            mask_src.value = c_m[0]
	            // 关键修改：使用从画布计算的边界框，而不是裁剪函数的返回值
	            box = originalBox || c_m[1]
	            console.log('掩膜预览已更新', { box: box });
	        } else {
	            console.warn('掩膜生成失败')
	            mask_src.value = generateImageWithText(w, h, '掩膜生成失败\n请重新涂抹', 8)
	        }
	        
	        if (userStore.t_auto_classify) {
	            classify()
	        }
	    } catch (error) {
	        console.error('掩膜处理错误:', error)
	        mask_src.value = generateImageWithText(w, h, '掩膜处理错误\n请重新尝试', 8)
	    }
	}
	async function get_mask() {
	  return new Promise((resolve) => {
	    // 关键修改：创建与画布相同尺寸的结果canvas
	    const resultCanvas = document.createElement('canvas');
	    resultCanvas.width = canvas.width;
	    resultCanvas.height = canvas.height;
	    const resultCtx = resultCanvas.getContext('2d');
	    
	    // 第一步：绘制原始图像
	    resultCtx.drawImage(
	      image,
	      0, 0, image.naturalWidth, image.naturalHeight,
	      0, 0, resultCanvas.width, resultCanvas.height
	    );
	    
	    // 第二步：应用掩膜（只保留涂抹区域）
	    resultCtx.globalCompositeOperation = 'destination-in';
	    resultCtx.drawImage(canvas, 0, 0);
	    
	    // 第三步：重置合成模式
	    resultCtx.globalCompositeOperation = 'source-over';
	    
	    // 转换为DataURL
	    try {
	        resultCanvas.toBlob((blob) => {
	            if (blob) {
	                const reader = new FileReader();
	                reader.onload = () => {
	                    resolve(reader.result);
	                };
	                reader.readAsDataURL(blob);
	            } else {
	                console.error('生成blob失败');
	                resolve(null);
	            }
	        }, 'image/png');
	    } catch (error) {
	        console.error('toBlob错误:', error);
	        resolve(null);
	    }
	  });
	}

	function cropTransparentBorders(base64) {
	    return new Promise((resolve, reject) => {
	        const img = new Image();
	        img.onload = function() {
	            const canvas = document.createElement('canvas');
	            const ctx = canvas.getContext('2d');
	            canvas.width = img.width;
	            canvas.height = img.height;
	            
	            // 绘制原始图片
	            ctx.drawImage(img, 0, 0);
	            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	            const data = imageData.data;
	
	            // 检查像素透明度的辅助函数
	            const isPixelTransparent = (x, y) => {
	                const idx = (y * canvas.width + x) * 4;
	                return data[idx + 3] === 0; // 检查Alpha通道
	            };
	
	            // 检查行/列是否完全透明
	            const isRowTransparent = (y) => {
	                for (let x = 0; x < canvas.width; x++) {
	                    if (!isPixelTransparent(x, y)) return false;
	                }
	                return true;
	            };
	
	            const isColTransparent = (x) => {
	                for (let y = 0; y < canvas.height; y++) {
	                    if (!isPixelTransparent(x, y)) return false;
	                }
	                return true;
	            };
	
	            // 计算边界
	            let top = 0;
	            let bottom = canvas.height - 1;
	            let left = 0;
	            let right = canvas.width - 1;
	
	            // 上边界
	            while (top <= bottom && isRowTransparent(top)) top++;
	            // 下边界
	            while (bottom >= top && isRowTransparent(bottom)) bottom--;
	            // 左边界
	            while (left <= right && isColTransparent(left)) left++;
	            // 右边界
	            while (right >= left && isColTransparent(right)) right--;
	            
	            let box = []
	            
	            // 当图片完全透明时的处理
	            if (top > bottom || left > right) {
	                // 创建1x1透明像素
	                canvas.width = 1;
	                canvas.height = 1;
	                ctx.clearRect(0, 0, 1, 1);
	                box = [0, 0, 0, 0];
	            } else {
	                // 计算裁剪尺寸
	                const width = right - left + 1;
	                const height = bottom - top + 1;
	
	                // 创建新canvas存储裁剪后图像
	                const croppedCanvas = document.createElement('canvas');
	                const croppedCtx = croppedCanvas.getContext('2d');
	                croppedCanvas.width = width;
	                croppedCanvas.height = height;
	
	                // 绘制裁剪区域
	                croppedCtx.drawImage(
	                    canvas,
	                    left, top, width, height, // 源区域
	                    0, 0, width, height // 目标区域
	                );
	
	                // 替换原始canvas
	                canvas.width = width;
	                canvas.height = height;
	                ctx.drawImage(croppedCanvas, 0, 0);
	
	                // 关键修改：正确计算原始图像坐标
	                if (image && image.naturalWidth > 0) {
	                    // 获取掩膜图像与原始图像的比例
	                    const maskToOriginalX = image.naturalWidth / img.width;
	                    const maskToOriginalY = image.naturalHeight / img.height;
	                    
	                    console.log('坐标转换:', {
	                        maskBounds: { left, top, right, bottom, width, height },
	                        maskSize: { width: img.width, height: img.height },
	                        originalSize: { width: image.naturalWidth, height: image.naturalHeight },
	                        scaleFactors: { x: maskToOriginalX, y: maskToOriginalY }
	                    });
	                    
	                    // 将掩膜坐标转换为原始图像坐标
	                    box = [
	                        Math.round(left * maskToOriginalX),
	                        Math.round(top * maskToOriginalY),
	                        Math.round(right * maskToOriginalX),
	                        Math.round(bottom * maskToOriginalY)
	                    ];
	                    
	                    console.log('转换后的边界框:', box);
	                } else {
	                    console.warn('无法获取原始图像尺寸，使用掩膜坐标');
	                    box = [left, top, right, bottom];
	                }
	            }
	            
	            // 返回处理后的Base64和边界框
	            resolve([canvas.toDataURL(), box]);
	        };
	
	        img.onerror = reject;
	        img.src = base64;
	    });
	}

	function classify() {
		mask_class.value = "识别中"
		const payload = {
			image_data: mask_src.value.split(',')[1], // 移除Base64前缀
		};
		api.post('classify', payload)
			.then(response => {
				mask_class.value = response.data;
			})
			.catch(error => {
				console.error('Error:', error);
			});
	}

	async function segment_box() {
	    try {
	        console.log('开始目标分割，使用绘制的掩膜区域')
	        
	        if (!ctx) {
	            notyf.error('画布未初始化')
	            return
	        }
	        
	        // 关键修改：先获取掩膜图像，然后从掩膜图像计算边界框
	        const maskDataUrl = await get_mask();
	        console.log('掩膜生成完成', maskDataUrl ? '有数据' : '无数据');
	        
	        if (!maskDataUrl) {
	            notyf.error('掩膜生成失败，请重新涂抹')
	            return
	        }
	        
	        // 从掩膜图像计算精确边界框
	        const maskBox = await calculatePreciseBoundingBox(maskDataUrl);
	        console.log('掩膜图像边界框:', maskBox)
	        
	        if (!maskBox || maskBox.length !== 4) {
	            notyf.error('无法计算掩膜区域，请重新涂抹')
	            return
	        }
	        
	        // 将掩膜坐标转换为原始图像坐标
	        const originalBox = convertMaskCoordsToOriginal(maskBox);
	        console.log('转换后的原始图像边界框:', originalBox)
	        
	        if (!originalBox || originalBox.length !== 4) {
	            notyf.error('坐标转换失败')
	            return
	        }
	        
	        // 添加边界检查
	        if (originalBox[2] - originalBox[0] < 10 || originalBox[3] - originalBox[1] < 10) {
	            notyf.error('掩膜区域太小，请涂抹更大的区域')
	            return
	        }
	        
	        // 确保坐标是整数且在有效范围内
	        const finalBox = [
	            Math.max(0, Math.floor(originalBox[0])),
	            Math.max(0, Math.floor(originalBox[1])),
	            Math.min(image.naturalWidth, Math.ceil(originalBox[2])),
	            Math.min(image.naturalHeight, Math.ceil(originalBox[3]))
	        ];
	        
	        const bboxString = finalBox.join(',');
	        console.log('发送给API的边界框:', bboxString);
	        // 坐标换算诊断日志：打印图像/画布/边界框三者尺寸关系
	        console.log('分割坐标诊断:', {
	            image: { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight },
	            canvas: { width: canvas.width, height: canvas.height },
	            maskBox,
	            displayScale: display_scale.value,
	            finalBox,
	            bboxString
	        });
	        
	        // 调用现有的分割API
	        let response = await api.post(`segment/${userStore.user_id}/${userStore.t_selectedImageId}/${bboxString}`, {});
	        let item = response.data
	        console.log('分割返回的数据:', item)
	        
	        item.selected = false;
	        
	        // 获取完整图像数据
	        let src_data = await imageStore.get_full(item.id);
	        let src_thumbnail = await imageStore.get_full(item.id);
	        
	        item.src = src_data
	        item.thumbnail = src_thumbnail
	        
	        // 分割结果在唯一预览区展示
	        mask_src.value = src_data

	        // 添加到暂存区
	        const existingIndex = imageStore.temp_segmentations.findIndex(seg => seg.id === item.id)
	        if (existingIndex === -1) {
	            imageStore.temp_segmentations.push(item)
	            console.log('分割结果已添加到暂存区')
	            notyf.success('分割完成并已添加到暂存区')
	        } else {
	            notyf.info('该分割已存在于暂存区')
	        }
	        
	    } catch (error) {
	        console.error('分割失败:', error)
	        if (error.response && error.response.data && error.response.data.error) {
	            notyf.error('分割失败: ' + error.response.data.error)
	        } else {
	            notyf.error('分割失败，请重试')
	        }
	    }
	}

// 新增函数：直接从画布计算掩膜边界框
function calculateMaskBoundingBoxFromCanvas() {
    return new Promise((resolve) => {
        if (!canvas || !ctx) {
            console.error('canvas 或 ctx 未初始化');
            resolve(null);
            return;
        }
        
        // 获取画布的图像数据
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = 0;
        let maxY = 0;
        let foundPixel = false;
        
        // 找到画布上非透明像素的边界
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const alpha = data[(y * canvas.width + x) * 4 + 3];
                if (alpha > 10) { // 非透明像素（有涂抹）
                    foundPixel = true;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        
        if (!foundPixel) {
            console.warn('在画布上未找到掩膜像素');
            resolve(null);
            return;
        }
        
        // 添加一些边距（基于区域大小的百分比）
        const width = maxX - minX;
        const height = maxY - minY;
        const marginX = Math.max(5, Math.floor(width * 0.05)); // 5% 边距，至少5像素
        const marginY = Math.max(5, Math.floor(height * 0.05));
        
        minX = Math.max(0, minX - marginX);
        minY = Math.max(0, minY - marginY);
        maxX = Math.min(canvas.width, maxX + marginX);
        maxY = Math.min(canvas.height, maxY + marginY);
        
        const resultBox = [minX, minY, maxX, maxY];
        
        console.log('画布掩膜边界框计算:', {
            canvasSize: { width: canvas.width, height: canvas.height },
            bbox: resultBox,
            bboxSize: { width: maxX - minX, height: maxY - minY },
            margins: { x: marginX, y: marginY }
        });
        
        resolve(resultBox);
    });
}
	
	// 关键函数：将掩膜坐标转换为原始图像坐标
	function convertMaskCoordsToOriginal(maskBox) {
	    if (!image || !canvas) {
	        console.error('image 或 canvas 未初始化')
	        return maskBox;
	    }
	    
	    const [maskX1, maskY1, maskX2, maskY2] = maskBox;
	    
	    // 获取显示尺寸和原始尺寸
	    const displayRect = image.getBoundingClientRect();
	    const naturalWidth = image.naturalWidth;
	    const naturalHeight = image.naturalHeight;
	    
	    console.log('坐标转换参数:', {
	        maskBox,
	        displaySize: { width: displayRect.width, height: displayRect.height },
	        naturalSize: { width: naturalWidth, height: naturalHeight },
	        displayScale: display_scale.value
	    });
	    
	    // 关键修改：正确的坐标转换逻辑
	    // 掩膜图像是基于画布尺寸生成的，需要转换到原始图像坐标
	    const maskCanvasWidth = canvas.width;
	    const maskCanvasHeight = canvas.height;
	    
	    // 计算掩膜图像与原始图像的比例
	    const scaleX = naturalWidth / maskCanvasWidth;
	    const scaleY = naturalHeight / maskCanvasHeight;
	    
	    // 转换坐标
	    const originalX1 = Math.round(maskX1 * scaleX);
	    const originalY1 = Math.round(maskY1 * scaleY);
	    const originalX2 = Math.round(maskX2 * scaleX);
	    const originalY2 = Math.round(maskY2 * scaleY);
	    
	    // 确保坐标在有效范围内
	    const finalX1 = Math.max(0, Math.min(originalX1, naturalWidth - 1));
	    const finalY1 = Math.max(0, Math.min(originalY1, naturalHeight - 1));
	    const finalX2 = Math.max(finalX1 + 1, Math.min(originalX2, naturalWidth));
	    const finalY2 = Math.max(finalY1 + 1, Math.min(originalY2, naturalHeight));
	    
	    console.log('转换后的坐标:', {
	        original: [finalX1, finalY1, finalX2, finalY2],
	        scaleFactors: { scaleX, scaleY },
	        maskCanvasSize: { width: maskCanvasWidth, height: maskCanvasHeight }
	    });
	    
	    return [finalX1, finalY1, finalX2, finalY2];
	}
	
	// 从掩膜图像计算精确边界框的函数
	function calculatePreciseBoundingBox(maskDataUrl) {
	    return new Promise((resolve) => {
	        const img = new Image();
	        img.onload = function() {
	            const canvas = document.createElement('canvas');
	            const ctx = canvas.getContext('2d');
	            canvas.width = img.width;
	            canvas.height = img.height;
	            
	            ctx.drawImage(img, 0, 0);
	            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	            const data = imageData.data;
	            
	            let minX = canvas.width;
	            let minY = canvas.height;
	            let maxX = 0;
	            let maxY = 0;
	            let foundPixel = false;
	            
	            // 找到掩膜的非透明像素边界
	            for (let y = 0; y < canvas.height; y++) {
	                for (let x = 0; x < canvas.width; x++) {
	                    const alpha = data[(y * canvas.width + x) * 4 + 3];
	                    if (alpha > 10) { // 非透明像素
	                        foundPixel = true;
	                        minX = Math.min(minX, x);
	                        minY = Math.min(minY, y);
	                        maxX = Math.max(maxX, x);
	                        maxY = Math.max(maxY, y);
	                    }
	                }
	            }
	            
	            if (!foundPixel) {
	                resolve(null);
	                return;
	            }
	            
	            // 添加一些边距
	            const margin = 2;
	            minX = Math.max(0, minX - margin);
	            minY = Math.max(0, minY - margin);
	            maxX = Math.min(canvas.width, maxX + margin);
	            maxY = Math.min(canvas.height, maxY + margin);
	            
	            console.log('掩膜图像边界框计算:', {
	                canvasSize: { width: canvas.width, height: canvas.height },
	                bbox: [minX, minY, maxX, maxY],
	                bboxSize: { width: maxX - minX, height: maxY - minY }
	            });
	            
	            resolve([minX, minY, maxX, maxY]);
	        };
	        img.src = maskDataUrl;
	    });
	}
	
	var selected_segment = ref(null)
	async function selected_segmentation_changed(item) {
		try {
			selected_segment.value.selected = false
		} catch (e) {}

		selected_segment.value = item
		await imageStore.load_full(item)
		mask_src.value = item.src
		item.selected = true
	}

	function to_user_segments() {
		api.post(`/image/${userStore.user_id}/segmentations/${selected_segment.value.id}`)
		notyf.success('已成功保存！');
	}

	function download_segment() {
		download_image(mask_src.value, "download")
	}

	function delete_segmentation() {
		const index = imageStore.temp_segmentations.indexOf(selected_segment.value);
		if (index > -1) {
			imageStore.temp_segmentations.splice(index, 1);
		}
		api.delete(`/image/${userStore.user_id}/temp_segmentations/${selected_segment.value.id}`)
	}

	function clear_segmentations() {
		imageStore.temp_segmentations.length = 0
		api.delete(`/image_clear/${userStore.user_id}/temp_segmentations`)
	}
	// async function pre_to_temp(dect) {
	// 	console.log(dect)
	// 	let response = await api.get(`/seg_to_temp/${userStore.user_id}/${dect.d_id}`)
	// 	let item = response.data
	// 	item.selected = ref(false);
	// 	let src_data = await imageStore.get_full(item.id);
	// 	let src_thumbnail = await imageStore.get_full(item.id);
	// 	item.src = src_data
	// 	segment_src.value = src_data
	// 	item.thumbnail = src_thumbnail

	// 	imageStore.temp_segmentations.push(item)
	// }
	async function pre_to_temp(dect) {
	    console.log('点击掩膜:', dect)
	    try {
	        let response = await api.get(`/seg_to_temp/${userStore.user_id}/${dect.d_id}`)
	        let item = response.data
	        item.selected = ref(false);
	        
	        // 获取完整图像数据
	        let src_data = await imageStore.get_full(item.id);
	        let src_thumbnail = src_data;
	        
	        item.src = src_data
	        item.thumbnail = src_thumbnail
	        
	        // 更新功能区预览(唯一预览区)
	        mask_src.value = src_data
	        
	        // 关键修改：检查是否已存在，避免重复添加
	        const existingIndex = imageStore.temp_segmentations.findIndex(seg => seg.id === item.id)
	        if (existingIndex === -1) {
	            imageStore.temp_segmentations.push(item)
	            console.log('已添加到暂存区:', item)
				notyf.success('已将分割图像添加到暂存区')
	        } else {
	            console.log('该分割已存在于暂存区')
	        }
	        
	    } catch (error) {
	        console.error('添加到暂存区失败:', error)
	        notyf.error('添加到暂存区失败')
	    }
	}
	
	//上传图片文件
	const fileInput = ref(null)
	const fileInfo = ref({
	  show: false,
	  name: '',
	  size: '',
	  type: ''
	})
	const previewImage = ref('')
	
	const triggerUpload = () => {
	  fileInput.value?.click()
	}
	
	const handleFileUpload = (event) => {
	  const file = event.target.files[0]
	  if (file) {
	    processFile(file)
	  }
	}
	
	const handleDrop = (event) => {
	  const file = event.dataTransfer.files[0]
	  if (file) {
	    processFile(file)
	  }
	}
	
	const processFile = (file) => {
	  // 检查文件类型
	  if (!file.type.match('image.*')) {
	    alert('请选择图片文件（JPG、PNG、WEBP格式）')
	    return
	  }
	  if (file.size > 10 * 1024 * 1024) {
	    alert('文件大小不能超过10MB')
	    return
	  }
	  
	  // 同时将图片上传到后端/服务器（不影响本地画布显示）
	  uploadImageToBackend(file)
	  
	
	  function selectUploadHistory(item) {
	    selected_change(item.id)
	    showUploadHistory.value = false
	  }
	  
	  // 预览图片
	  const reader = new FileReader()
	  reader.onload = (e) => {
	    previewImage.value = e.target.result
	    
	    // 关键修改：创建新的Image对象并设置跨域属性
	    const img = new Image()
	    img.crossOrigin = "anonymous"  // 添加这行
	    img.onload = () => {
	      // 将处理好的图片设置到显示区域
	      display_src.value = e.target.result
	      canvasHasImage.value = true
	      // 主动替换为本地新图片时，清空唯一预览区避免上一张残留
	      resetMaskPreview()
	      
	      // 重置画布和显示参数
	      display_scale.value = 1
	      display_mask_scale.value = 1
	      
	      // 清空检测数据
	      image_detections.length = 0
	      
	      // 若后端尚未同步真实ID，则先用本地临时ID占位（后端上传成功后会被真实ID覆盖）
	      if (!uploadBackendResolved) {
	        userStore.t_selectedImageId = 'uploaded_' + Date.now()
	      }
	      
	      // 等待图片加载完成后初始化画布
	      if (canvas && ctx) {
	        // 设置画布尺寸为图片的原始尺寸
	        canvas.width = img.naturalWidth;
	        canvas.height = img.naturalHeight;
	        
	        initializeBrush();
	        
	        ctx.clearRect(0, 0, canvas.width, canvas.height);
	        display_mask_scale.value = 1;
	        
	        console.log('上传图片笔触设置:', {
	          naturalSize: { width: img.naturalWidth, height: img.naturalHeight },
	          brushSize: ctx.lineWidth
	        });
	        
	        // 初始化画笔设置
	        ctx.strokeStyle = 'white';
	        ctx.lineJoin = 'round';
	        ctx.lineCap = 'round';
	        ctx.lineWidth = 40; // 使用基础大小，会在绘制时根据scale调整
	        
	        // 清空画布
	        ctx.clearRect(0, 0, canvas.width, canvas.height);
	        
	        // 更新显示比例
	        display_mask_scale.value = 1; // 重置为1
	        
	        console.log('上传图片画布初始化完成', {
	          canvas: { width: canvas.width, height: canvas.height },
	          image: { natural: { width: img.naturalWidth, height: img.naturalHeight } }
	        });
	      }
	    }
	    img.src = e.target.result
	  }
	  reader.readAsDataURL(file)
	}

	// 将图片上传到后端/服务器，成功后刷新图库；返回后端真实图片ID
	const uploadImageToBackend = async (file) => {
	  const formData = new FormData()
	  formData.append('image', file)
	  try {
	    const res = await api.post(`/image/${userStore.user_id}/uploads`, formData, {
	      headers: { 'Content-Type': 'multipart/form-data' }
	    })
	    // 用后端真实ID替换本地临时ID，确保自动分割/检测使用正确的图
	    userStore.t_selectedImageId = res.data.id
	    uploadBackendResolved = true
	    // 上传成功立即开始自动分割并显示进度提示（正在分割 → 分割完成），
	    // 不再依赖“显示自动分割”开关；开关只控制掩膜覆盖层显隐，
	    // 分割结果在服务端有缓存，之后打开开关可即时展示
	    autoSegment(res.data.id)
	    await imageStore.update_image_infos(userStore.user_id)
	    return res.data.id
	  } catch (e) {
	    console.error('上传到服务器失败:', e)
	    if (userStore.t_mask_s) {
	      userStore.t_mask_s = false
	      segClear()
	    }
	    notyf.error('上传到服务器失败')
	    return null
	  }
	}
	
	const formatFileSize = (bytes) => {
	  if (bytes === 0) return '0 Bytes'
	  const k = 1024
	  const sizes = ['Bytes', 'KB', 'MB', 'GB']
	  const i = Math.floor(Math.log(bytes) / Math.log(k))
	  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
	}
	
	import { ref } from 'vue'
	import ImageSelector from '@/components/Toolbox/ImageSelector.vue'
	
	const imageSelector = ref(null)
	
	import ImageUploader from '@/components/Toolbox/ImageUploader.vue'
	const imageUpload = ref(null)
	
	// 针法地图状态
	const stitchMapExpanded = ref(false)
	const stitchMapLoading = ref(false)
	const stitchMapMessage = ref('')
	
	// 辅助函数：将blob URL转换为Base64
	function blobToBase64(blobUrl) {
	  return new Promise((resolve, reject) => {
	    fetch(blobUrl)
	      .then(response => response.blob())
	      .then(blob => {
	        const reader = new FileReader()
	        reader.onloadend = () => {
	          const base64 = reader.result.split(',')[1]
	          resolve(base64)
	        }
	        reader.onerror = reject
	        reader.readAsDataURL(blob)
	      })
	      .catch(reject)
	  })
	}
	
	// 辅助函数：将普通URL转换为Base64
	function urlToBase64(url) {
	  return new Promise((resolve, reject) => {
	    fetch(url)
	      .then(response => response.blob())
	      .then(blob => {
	        const reader = new FileReader()
	        reader.onloadend = () => {
	          const base64 = reader.result.split(',')[1]
	          resolve(base64)
	        }
	        reader.onerror = reject
	        reader.readAsDataURL(blob)
	      })
	      .catch(reject)
	  })
	}
	
	// 重置画布用于显示针法地图
	function resetCanvasForStitchMap() {
	  // 清空画布上的涂抹
	  if (ctx) {
	    ctx.clearRect(0, 0, canvas.width, canvas.height)
	  }
	  
	  // 重置缩放比例
	  display_scale.value = 1
	  display_mask_scale.value = 1
	  
	  // 重置到初始位置
	  if (scrollable_Div) {
	    scrollable_Div.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
	  }
	  
	  console.log('画布已重置用于显示针法地图')
	}
	
	// 重置显示原始图片
	async function resetToOriginalImage() {
	  const currentImageInfo = imageStore.find(userStore.t_selectedImageId)
	  if (currentImageInfo && currentImageInfo.src) {
	    display_src.value = currentImageInfo.src
	    console.log('已恢复原始图片:', currentImageInfo.name)
	    
	    // 等待图片加载
	    if (image) {
	      await new Promise((resolve) => {
	        const checkLoad = () => {
	          if (image.complete) {
	            resolve()
	          } else {
	            image.onload = resolve
	            image.onerror = resolve
	            // 超时保护
	            setTimeout(resolve, 1000)
	          }
	        }
	        checkLoad()
	      })
	    }
	  }
	  stitchMapExpanded.value = false
	  stitchMapMessage.value = ''
	  stitchMapLoading.value = false
	}
	
	async function checkAndDisplayStitchMap(imageId) {
	  console.log('开始检查针法地图，图片ID:', imageId)
	  
	  try {
	    // 获取当前显示的图片的Base64数据
	    let imageBase64 = null
	    
	    // 方法1: 从当前显示的图片获取Base64
	    if (display_src.value && display_src.value.startsWith('data:')) {
	      imageBase64 = display_src.value.split(',')[1]
	    } 
	    // 方法2: 从imageStore获取原始图片数据
	    else {
	      const currentImageInfo = imageStore.find(imageId)
	      if (currentImageInfo && currentImageInfo.src) {
	        if (currentImageInfo.src.startsWith('data:')) {
	          imageBase64 = currentImageInfo.src.split(',')[1]
	        } else if (currentImageInfo.src.startsWith('blob:')) {
	          // 如果是blob URL，需要转换为Base64
	          imageBase64 = await blobToBase64(currentImageInfo.src)
	        } else {
	          // 如果是普通URL，通过fetch获取
	          imageBase64 = await urlToBase64(currentImageInfo.src)
	        }
	      }
	    }
	    
	    if (!imageBase64) {
	      stitchMapMessage.value = '无法获取图片数据'
	      console.error('无法获取图片的Base64数据')
	      return false
	    }
	    
	    // ⭐⭐⭐ 关键修改：确保正确获取 user_id ⭐⭐⭐
	    // 方法1：在函数开头获取并保存到变量
	    const currentUserId = userStore.user_id
	    console.log('当前用户ID:', currentUserId)
	    
	    if (!currentUserId) {
	      stitchMapMessage.value = '用户ID不存在'
	      console.error('用户ID不存在')
	      return false
	    }
	    
	    const payload = {
	      image_data: imageBase64
	    }
	    
	    // 使用保存的变量
	    const response = await api.post(`/check_segment_map/${currentUserId}/${imageId}`, payload)
	    
	    console.log('API响应:', response.data)
	    
	    // 处理响应
	    if (response.data.image_url) {
	      // 显示针法地图
	      const fullImageUrl = `${api.defaults.baseURL.replace(/\/$/, '')}${response.data.image_url}?t=${Date.now()}`
	      console.log('加载针法地图URL:', fullImageUrl)
	      
	      display_src.value = fullImageUrl
	      stitchMapMessage.value = response.data.message || 
	        (response.data.exists ? '针法地图已存在' : '针法地图生成成功')
	      
	      // 重置画布状态和缩放
	      resetCanvasForStitchMap()
	      
	      return true
	    } else {
	      // 没有返回图片URL，说明失败
	      stitchMapMessage.value = response.data.message || '无法生成针法地图'
	      console.error('针法地图处理失败: 未返回图片URL')
	      return false
	    }
	    
	  } catch (error) {
	    console.error('检查针法地图API调用失败:', error)
	    if (error.response && error.response.data) {
	      stitchMapMessage.value = error.response.data.message || '服务器返回错误'
	    } else {
	      stitchMapMessage.value = '连接服务器失败'
	    }
	    return false
	  }
	}
	
	async function toggleStitchMap() {
	  if (stitchMapExpanded.value) {
	    // 收起针法地图
	    await resetToOriginalImage()
	    console.log('已收起针法地图，恢复原始图片')
	  } else {
	    // 展开针法地图
	    stitchMapExpanded.value = true
	    stitchMapLoading.value = true
	    stitchMapMessage.value = '正在检查针法地图...'
	    
	    try {
	      const imageId = userStore.t_selectedImageId
	      const userId = userStore.user_id
	      
	      if (!imageId || !userId) {
	        stitchMapMessage.value = !imageId ? '未找到图片ID' : '未找到用户ID'
	        stitchMapLoading.value = false
	        stitchMapExpanded.value = false
	        return
	      }
	      
	      console.log('当前用户ID:', userId)
	      console.log('当前图片ID:', imageId)
	      
	      // 第一步：先尝试直接加载已存在的针法地图
	      const stitchMapUrl = `${api.defaults.baseURL.replace(/\/$/, '')}/get_segment_map/${imageId}?t=${Date.now()}`
	      console.log('尝试加载针法地图URL:', stitchMapUrl)
	      
	      // 使用Image对象预加载测试图片是否存在
	      const imageExists = await checkImageExists(stitchMapUrl)
	      
	      if (imageExists) {
	        // 针法地图已存在，直接显示
	        console.log('针法地图已存在，直接加载')
			setTimeout(() => {
			                display_src.value = stitchMapUrl;
			}, 2000);      
	        stitchMapMessage.value = '针法地图加载成功'
	        resetCanvasForStitchMap()
	      } else {
	        // 针法地图不存在，需要生成
	        console.log('针法地图不存在，开始生成...')
	        stitchMapMessage.value = '正在生成针法地图...'
	        
	        const stitchMapFound = await checkAndDisplayStitchMap(imageId, userId)
	        
	        if (!stitchMapFound) {
	          stitchMapExpanded.value = false
	          await resetToOriginalImage()
	        }
	      }
	      
	    } catch (error) {
	      console.error('展开针法地图时出错:', error)
	      stitchMapMessage.value = '加载针法地图时出错'
	      stitchMapExpanded.value = false
	      await resetToOriginalImage()
	    } finally {
	      stitchMapLoading.value = false
	    }
	  }
	}
	
	// 检查图片是否存在的函数 
	function checkImageExists(url) {
	  return new Promise((resolve) => {
	    const img = new Image()
	    img.onload = () => resolve(true)
	    img.onerror = () => resolve(false)
	    img.src = url
	  })
	}

	
//这是结束标记	
</script>

<template>
	<!-- 三栏布局 -->
	<div class="three-column-layout">
		<!-- 自动处理进度提示（右上角小白框：阶段文案由 segText 驱动，done 自动消失） -->
		<div v-if="segToast" class="seg-toast">
			<img class="seg-toast-icon" :class="!segDone ? 'spin' : ''"
				:src="segDone ? '/finish.svg' : '/loading.svg'" alt="" />
			<span>{{ segText }}</span>
		</div>
		<!--  左侧	-->
		<div class="left-panel left-column">
			
			<div class="panel-tabs">
				<a class="panel-tab" :class="{ active: userStore.t_selector_index==0 }"
					@click="userStore.t_selector_index=0">上传图片</a>
				<a class="panel-tab" :class="{ active: userStore.t_selector_index==1 }"
					@click="userStore.t_selector_index=1">图片对象选择</a>
				<a class="panel-tab" :class="{ active: userStore.t_selector_index==2 }"
					@click="userStore.t_selector_index=2">所有对象选择</a>
			</div>
			<div class="glass" style="overflow-y: auto; flex: 1; display: flex; flex-direction: column;">

				<div v-show="userStore.t_selector_index==0">
					<!-- 上传图片文件控件 -->
					<div class="container-upload">
					    <div class="upload-area" data-guest-action @click="triggerUpload" @drop.prevent="handleDrop" @dragover.prevent>
					      <div class="upload-icon">
					        <span class="icon-unicode">📁</span>
					      </div>
					      <p>点击上传刺绣图片或拖放文件到此处</p>
					      <p class="hint-text">支持 JPG、PNG、WEBP格式</p>
					      <input type="file" ref="fileInput" @change="handleFileUpload" style="display: none;" accept="image/*">
						</div>
					    
					    <div class="file-info" v-if="fileInfo.show">
					      <p><strong>文件信息：</strong></p>
					      <p>文件名：{{ fileInfo.name }}</p>
					      <p>文件大小：{{ fileInfo.size }}</p>
					      <p>文件类型：{{ fileInfo.type }}</p>
					    </div>
						
						<!-- 选择图片控件 -->
						<div class="flex justify-center items-center" style="">
						    <button class="gradient-btn btn text-white" data-guest-action @click="imageSelector.openModal()">
								从图库中选择
						    </button>
						</div>
					  </div>
				<div class="flex flex-1/6 flex-col m6" style="margin: 5px; margin-top: 10px; min-width: 0;">
					<div class="func-panel">
						<div class="func-title">功能区</div>
						<ul class="right_ui preview-full">
							<li class="right_ui_first_li"><img class="max-h-30" :src="mask_src" /></li>
						</ul>
						<ul class="tight">
							<li><input type="checkbox" v-model="userStore.t_auto_classify" class="toggle">
							自动针法识别</li>
							<li><input type="checkbox" :checked="userStore.t_mask_s" class="toggle" @change="onSegToggleChange">显示自动分割</li>
						</ul>
						<ul class="tight pair">
							<li><div class="action-btn save" data-guest-action @click="classify">针法识别</div></li>
							<li><div class="action-btn download" data-guest-action @click="segment_box()">目标分割</div></li>
						</ul>
						
						<!-- 针法识别结果 -->
						<ul class="right_res_ui">
							<li style="font-weight: bold;">针法识别结果</li>
							<li><span>检测到针法：</span><input type="text" class="input" v-model="mask_class" placeholder=" " /></li>
							<!-- <li><span>置信度：</span></li> -->
						</ul>
					</div>
				</div>
			</div>
				

				<div v-show="userStore.t_selector_index==1" class="overflow-auto h-full">
					<div v-for="item in image_detections">
						<div class="collapse collapse-arrow border border-base-300 bg-base-100 rounded-box">
							<input type="checkbox" v-model="item.expanded" />
							<div class="collapse-title text-xl font-medium">
								<p style="transform: translateY(-2px) translateX(20px)">{{ item.name }}</p>
							</div>
							<div class="collapse-content">
								<div class="flex flex-col gap-2 px-1 pt-1" style="min-height: 0;">
									<div v-show="item.expanded" v-for="(ii,index) in item.pos"
										class="gallery-item"
										:class="{ active: isBoxActive('image', ii) }"
										@click="pickBox('image', ii); selected_change(ii['id'],ii['x1'],ii['y1'],ii['x2'],ii['y2'])">
										<img :src="ii.src" class="gallery-thumb" />
										<span class="gallery-name">{{ ii.name }}{{ index + 1 }}</span>
										<button class="btn-show star"
											:class="{ starred: ii.is_star }"
											:title="ii.is_star ? '取消收藏' : '收藏'"
											@click.stop="toggleStar(ii)">
											<img v-if="ii.is_star" class="star-icon" src="/collected2.svg" alt="已收藏" />
											<img v-else class="star-icon" src="/not_collected2.svg" alt="未收藏" />
										</button>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div v-show="userStore.t_selector_index==2">
					<div class="overflow-auto h-full">


						<div v-for="item in user_detections">
							<div class="collapse collapse-arrow border border-base-300 bg-base-100 rounded-box">
								<input type="checkbox" v-model="item.expanded" /> <!-- 关键修改: 使用复选框 -->
								<div class="collapse-title text-xl font-medium">
									<p style="transform: translateY(-2px) translateX(20px)">{{ item.name }}</p>
								</div>
								<div class="collapse-content">
									<div class="flex flex-col gap-2 px-1 pt-1" style="min-height: 0;">
										<div v-show="item.expanded" v-for="(ii,index) in item.pos"
											class="gallery-item"
											:class="{ active: isBoxActive('user', ii) }"
											@click="pickBox('user', ii); selected_change(ii['id'],ii['x1'],ii['y1'],ii['x2'],ii['y2'])">
											<img :src="ii.src" class="gallery-thumb" />
											<span class="gallery-name">{{ ii.name }}{{ index + 1 }}</span>
											<button class="btn-show star"
												:class="{ starred: ii.is_star }"
												:title="ii.is_star ? '取消收藏' : '收藏'"
												@click.stop="toggleStar(ii)">
												<img v-if="ii.is_star" class="star-icon" src="/collected2.svg" alt="已收藏" />
												<img v-else class="star-icon" src="/not_collected2.svg" alt="未收藏" />
											</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
		<!--    图片掩膜-->
		<div class="middle-column">
			<!-- 外层容器，背景设置为绿色边框图，且尺寸适配 -->
			<div id="scrollable_Div" style="flex: 1; position: relative; width: 100%; overflow: auto; scrollbar-gutter: stable;
				max-width: 100%; margin: 0 auto; min-height: 400px;">
						<!-- 图片容器，控制边距 -->
						<div id="mask-wrap" style="position: absolute; top: 3%; left: 3%; right: 3%; bottom: 3%;">
							<img id="image" style="position: absolute; cursor: grab; 
		                 width: 100%; height: 100%; /* 使用百分比适应容器 */
		                 object-fit: contain; /* 保持比例，适应容器 */" alt="Vue logo" :src="display_src"
								:style="{ transform: `scale(${display_scale})`, transformOrigin:'0 0' }" />
							<canvas id="canvas" style="position: absolute; z-index: 1; opacity: 0.5;
		                            width: 100%; height: 100%;"
								@wheel.prevent="div_wheel" @mousedown.prevent="on_mouse_down" @mouseup.prevent="on_mouse_up"
								@mousemove.prevent="on_mouse_move" @mouseout.prevent="on_mouse_out"></canvas>
							<div v-if="userStore.t_mask_s" v-for="cla in image_detections">
								<div v-for="item in cla.pos">
									<img v-if="item.s_src" ref="maskImgRefs" style="position: absolute;z-index: 10;opacity: 0.5;visibility: hidden;" @click="pre_to_temp(item)" class="hover-red"
										@load="e => onMaskLoad(e, item)"
										:src="item.s_src" />
								</div>
							</div>
						</div>
					</div>
					<div style="flex-shrink: 0; margin-top: 10px; text-align: center;">
						<button 
						      class="gradient-btn btn text-white" 
						      @click="toggleStitchMap"
						      :class="{
						        'btn-active': stitchMapExpanded, 
						        'loading': stitchMapLoading,
						        'btn-success': stitchMapExpanded && !stitchMapLoading
						      }"
						      :disabled="stitchMapLoading">
						      <span v-if="stitchMapLoading" class="loading loading-spinner loading-sm"></span>
						      {{ stitchMapLoading ? '处理中...' : (stitchMapExpanded ? '收起针法地图' : '展开针法地图') }}
						</button>
					</div>
				</div>
		<!-- 右侧卡片 -->
		<div class="right-panel right-column">
			<div class="gallery-management">
				<div class="section-title">暂存分割图片</div>
				<div class="gallery-list">
					<div v-for="item in imageStore.temp_segmentations" :key="item.id"
					     class="gallery-item" :class="{ active: item.selected }"
					     @click="selected_segmentation_changed(item)">
						<img :src="item.thumbnail" class="gallery-thumb" />
						<p class="gallery-name">{{ item.name }}</p>
					</div>
				</div>

				<div class="panel-footer">
					<div class="action-buttons">
						<button class="action-btn save" data-guest-action @click="to_user_segments">保存</button>
						<button class="action-btn download" @click="download_segment">下载</button>
						<button class="action-btn delete" @click="delete_segmentation">删除</button>
						<div class="action-btn clear" @click="clear_segmentations">全部清空</div>
					</div>
				</div>
			</div>
		</div>
	</div>
	
	<!-- 上传历史模态框 -->
	<div v-if="showUploadHistory" class="modal modal-open">
	  <div class="modal-box max-w-4xl" style="max-height: 80vh;">
	    <h3 class="font-bold text-lg mb-4">上传历史图片</h3>
	    <div class="overflow-auto" style="max-height: 60vh;">
	      <div class="grid grid-cols-3 gap-4">
	        <div v-for="item in imageStore.uploads" :key="item.id" 
	             class="bg-base-200 rounded-lg p-2 cursor-pointer hover:bg-base-300 transition-colors"
	             @click="selectUploadHistory(item)">
	          <img :src="item.thumbnail" class="w-full h-24 object-cover rounded">
	          <p class="text-sm text-center mt-2 truncate">{{ item.name }}</p>
	        </div>
	      </div>
	    </div>
	    <div class="modal-action">
	      <button class="btn" @click="showUploadHistory = false">关闭</button>
	    </div>
	  </div>
	</div>
	
	<!-- 图片选择器模态窗口，传递selected_change函数 -->
	  <ImageSelector 
	    ref="imageSelector" 
	    :on-selected-change="selected_change" 
	  />
</template>

<style scoped>
	/* 自动分割进度提示框 */
	.seg-toast {
		position: fixed;
		top: 74px;
		right: 24px;
		z-index: 300;
		display: flex;
		align-items: center;
		gap: 8px;
		background: #ffffff;
		color: #333333;
		font-size: 14px;
		font-weight: 600;
		padding: 10px 16px;
		border-radius: 10px;
		white-space: nowrap;
		border: 1px solid #e0e0e0;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
	}
	.seg-toast.done {
		color: #1e7e34;
		border-color: #bfe6c6;
	}
	.seg-toast-icon {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}
	/* 分割中：loading.svg 原色持续旋转，与右侧文字同屏 */
	.seg-toast-icon.spin {
		animation: segToastSpin 1s linear infinite;
	}
	@keyframes segToastSpin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
	.hover-red:hover {
		filter: brightness(0.5) sepia(1) hue-rotate(-50deg) saturate(5);
	}

	/* 盒子阴影 */
	.card-shadow {
		overflow: hidden;
		background: #ffffff;
		margin-top: 4px;
		margin-bottom: 7px;
		border-radius: 10px;
		transition: border-radius 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
		box-shadow: inset 0 -3em 3em rgba(0, 0, 0, 0.1),
			0 0 0 2px rgb(190, 190, 190),
			0.3em 0.3em 1em rgba(0, 0, 0, 0.3);
	}

	/* 上传图片文件 */
	.container-upload {
	  --primary-light: #e8f5e9;
	  --primary-main: #66bb6a;
	  --primary-dark: #2e7d32;
	  --text-secondary: #757575;
	  
	  max-width: 800px;
	  width: 100%;
	  padding: 18px;
	  background: #F3FEEA;
	  border-radius: 10px;
	  box-shadow: 0 6px 10px rgba(0, 0, 0, 0.1);
	  font-family: 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
	  color: #212121;
	  line-height: 1.6;
	  margin: 0 auto;
	}
	
.container-upload .upload-area {
  border: 2px dashed var(--primary-main);
  border-radius: 8px;
  padding: 22px 18px;
  text-align: center;
  margin-bottom: 14px;
  cursor: pointer;
  transition: all 0.3s;
  background: var(--primary-light);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  min-height: 165px;
}
	
	.container-upload .upload-area:hover {
	  background: #dcf0dd;
	}
	
.container-upload .upload-icon {
  font-size: 1.8rem;
  color: var(--primary-dark);
  margin-bottom: 2px;
}
	
	.container-upload p{
		font-size:12px;
	}
	
	.container-upload .hint-text {
	  color: var(--text-secondary);
	  font-style: italic;
	  margin-top: 10px;
	  text-align: center;
	}
	
	.container-upload .file-info {
	  margin-top: 10px;
	  padding: 15px;
	  background: #f5f5f5;
	  border-radius: 5px;
	}
	
	.container-upload .preview-container {
	  margin-top: 10px;
	  text-align: center;
	}
	
	.container-upload .preview-image {
	  max-width: 100%;
	  max-height: 300px;
	  border-radius: 5px;
	  box-shadow: 0 3px 10px rgba(0,0,0,0.2);
	}
	
	/* 上传历史 */
	.modal {
	  position: fixed;
	  top: 0;
	  left: 0;
	  width: 100%;
	  height: 100%;
	  background: rgba(0, 0, 0, 0.5);
	  display: flex;
	  justify-content: center;
	  align-items: center;
	  z-index: 1000;
	}
	
	.modal-box {
	  background: white;
	  border-radius: 10px;
	  padding: 20px;
	  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
	}
	
	.right_ui{
		width: 100%;
		
	}
	.right_ui li{
		width:48%;
		float: left;
		margin-right: 1%;
	}
	/* 功能区面板：风格与右侧「暂存分割图片」一致（无外框，标题带绿竖线） */
	.func-panel{
		display: block;
		border-radius: 6px;
		background: #ffffff;
		padding: 3px 0 8px;
		margin: 0;
		box-sizing: border-box;
	}
	.func-panel .func-title{
		/* 与 .section-title 一致：标题前一条绿色竖线 */
		font-size: 0.95rem;
		font-weight: 600;
		color: inherit;
		border-left: 4px solid #71ba94;
		padding-left: 10px;
		line-height: 1.4;
		margin-bottom: 6px;
	}
	/* 唯一预览格：整行 92% 且左右 4%，两端与开关/按钮行对齐 */
	.func-panel .right_ui.preview-full{
		width: 100%;
		margin: 0;
	}
	.func-panel .right_ui.preview-full li{
		width: 92%;
		margin: 0 4% 6px;
		float: none;
	}
	/* 两个开关、两个按钮行：同一 92%+4% 基准，横向与预览图左右对齐 */
	.func-panel ul.tight{
		display: flex;
		width: 92%;
		margin: 2px 4%;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 8px;
		padding: 0;
	}
	.func-panel ul.tight > li{
		flex: 1 1 auto;
		width: auto;
		float: none;
		margin: 0;
		white-space: nowrap;
	}
	/* 操作按钮行 */
	.func-panel ul.tight.pair > li{
		width: 46%;
	}
	.func-panel ul.tight.pair > li{
		flex: 1 1 44%;
	}
	.func-panel ul.tight .action-btn{
		width: 100%;
		margin: 0;
	}
	/* 「针法识别结果」与操作按钮留出约 10px 间隙，横向与按钮行同基准对齐 */
	.func-panel .right_res_ui{
		margin-left: 4%;
		margin-right: auto;
		margin-top: 10px;
		width: 92%;
		box-sizing: border-box;
	}
	.func-panel ul.tight.pair{
		margin-bottom: 0;
	}
	/* 两个开关（非按钮行）底部到操作按钮约留 5px */
	.func-panel ul.tight:not(.pair){
		margin-bottom: 5px;
	}

	.right_ui_first_li{
		background-color: #c7e9b8;
		border:1px #2e7d32 solid;
		border-radius: 5px;
		aspect-ratio: 3 / 2;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
	}
	.right_ui_first_li img{
		width: 100%;
		height: 100%;
		object-fit: contain;
		background-color: #c7e9b8;
	}

	.right_res_ui{
		width: 98%;
		background-color: #bce9b1;
		font-size: 16px;
		border: 1px #2e7d32 solid;
		border-radius: 5px;
		padding: 8px;
	}
	.right_res_ui li:first-child{
		border-bottom:1px #000000 solid ;
		padding-bottom: 5px;
	}
	
	.right_res_ui li {
	  display: inline-flex;
	  align-items: center;
	  margin-bottom: 5px;
	  font-size: 16px;
	  width: 100%;
	}
	.right_res_ui input{
		max-width: 100px;
		background:none;
		border: none;
		font-size: 16px;
	}
	
	/* 三栏布局（与 T2I 一致） */
	.three-column-layout {
		display: flex;
		gap: 20px;
		padding: 20px;
		height: 90dvh;
		box-sizing: border-box;
		background: #f5f7fa;
		overflow: hidden;
	}

	.left-column {
		flex-shrink: 0;
	}

	.right-column {
		flex-shrink: 0;
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

	.middle-column {
		flex: 1;
		min-width: 0; /* 允许中间栏收缩 */
		background: white;
		border-radius: 20px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		box-shadow: 0 2px 8px rgba(0,0,0,0.1);
		overflow-y: auto;
	}

	/* 中间画布外框：用 CSS 绘制浅绿色厚框取代 green-bg2.png */
	#scrollable_Div {
		background: #eaf7ee;
		border: 12px solid #a8d5ba;
		border-radius: 12px;
		box-sizing: border-box;
	}


	
	/* 通用标题（与 T2I 一致） */
	.section-title {
		font-size: 0.95rem;
		font-weight: 600;
		margin-bottom: 6px;
		border-left: 4px solid #71ba94;
		padding-left: 10px;
	}

	/* 左侧面板 tab（与 T2I 一致） */
	.panel-tabs {
		display: flex;
		background: #f5f5f5;
		border-radius: 30px;
		padding: 4px;
	}
	.panel-tab {
		flex: 1;
		text-align: center;
		padding: 8px;
		border-radius: 30px;
		font-weight: 600;
		font-size: 0.85rem;
		color: #666;
		cursor: pointer;
		white-space: nowrap;
	}
	.panel-tab.active {
		background: #fff;
		color: #71ba94;
		border: 1px solid #71ba94;
		box-shadow: 0 1px 3px rgba(0,0,0,0.08);
	}

	.fieldset legend.fieldset-legend {
		font-size: 0.95rem;
		font-weight: 600;
		line-height: 1.4;
		border-left: 4px solid #71ba94;
		padding-left: 10px;
		padding-right: 0;
		padding-top: 0;
		padding-bottom: 0;
	}

	/* 右侧暂存管理（与 T2I 一致） */
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
		object-fit: contain; /* 完整显示分割图全貌，外容器尺寸保持一致 */
		object-position: center;
		background: #eef3ee;
		border-radius: 8px;
		flex-shrink: 0;
	}
	.gallery-name {
		flex: 1;
		font-size: 0.8rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
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
		text-align: center;
	}
	.action-btn.save { background: #85c0a0; color: white; }
	.action-btn.download { background: #8bb8ad; color: white; }
	.action-btn.delete { background: #e09a9a; color: white; }
	.action-btn.clear { background: #d6b578; color: white; }

	/* 响应式适配 */
	@media (max-width: 1200px) {
		.three-column-layout {
			gap: 10px;
		}
		
		.left-column, .right-column {
			min-width: 180px;
			max-width: 350px;
		}
	}
	
	@media (max-width: 992px) {
		.three-column-layout {
			flex-wrap: wrap;
			height: auto;
		}
		
		.left-column {
			flex: 1 1 100%;
			max-width: 100%;
			min-width: 100%;
			order: 1;
			margin-bottom: 10px;
			height: auto;
		}
		
		.middle-column {
			flex: 2 1 60%;
			min-width: 300px;
			order: 2;
			height: auto;
		}
		
		.right-column {
			flex: 1 1 40%;
			min-width: 200px;
			max-width: 100%;
			order: 3;
			height: auto;
		}
		
		.middle-column {
			display: flex;
			flex-direction: column;
			justify-content: space-between;
			padding: 10px;
		}
		
		#scrollable_Div {
			flex: 1;
			min-height: 300px;
		}
	}
	
	@media (max-width: 768px) {
		.three-column-layout {
			flex-direction: column;
			gap: 10px;
			height: auto;
		}
		
		.left-column, .middle-column, .right-column {
			flex: 1 1 100%;
			min-width: 100%;
			max-width: 100%;
			width: 100%;
			height: auto;
		}
		
		.left-column {
			order: 1;
		}
		
		.middle-column {
			order: 2;
			display: flex;
			flex-direction: column;
			justify-content: space-between;
			padding: 10px;
		}
		
		.right-column {
			order: 3;
		}
		
		#scrollable_Div {
			flex: 1;
			min-height: 250px;
		}
	}
	
	/* 选择图片按钮样式 */
	.gradient-btn {
	  width: 100%;
	  background: linear-gradient(135deg, #a5d6a7 0%, #90c591 50%, #81c784 100%);
	  color: white;
	  border: none;
	  font-size: 16px;
	  font-weight: 500;
	  border-radius: 5px;
	  cursor: pointer;
	  box-shadow: 0 4px 15px rgba(139, 195, 74, 0.3);
	  transition: all 0.3s ease;
	  position: relative;
	  overflow: hidden;
	  letter-spacing: 0.5px;
	}
	
	.gradient-btn:hover {
	  transform: translateY(-3px);
	  box-shadow: 0 7px 20px rgba(139, 195, 74, 0.4);
	  background: linear-gradient(135deg, #9ccc65 0%, #8bc34a 50%, #7cb342 100%);
	}
	
	.gradient-btn:active {
	  transform: translateY(1px);
	  box-shadow: 0 2px 10px rgba(139, 195, 74, 0.4);
	}
	
	.gradient-btn::after {
	  content: '';
	  position: absolute;
	  top: 0;
	  left: -100%;
	  width: 100%;
	  height: 100%;
	  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
	  transition: left 0.5s;
	}
	
	.gradient-btn:hover::after {
	  left: 100%;
	}

	/* ---- 收藏按钮：外部圆形容器 + 浅灰/浅黄底，内含纯星 svg（not_collected2/collected2） ---- */
	.btn-show.star {
	  width: 26px;
	  height: 26px;
	  padding: 0;
	  border: none;
	  border-radius: 50%;
	  background: #e8e8e8; /* 浅灰：未收藏 */
	  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
	  display: inline-flex;
	  align-items: center;
	  justify-content: center;
	  cursor: pointer;
	  transition: transform 0.15s ease, background 0.2s ease;
	}
	.btn-show.star .star-icon {
	  width: 17px;
	  height: 17px;
	  display: block;
	  object-fit: contain;
	  pointer-events: none;
	  transition: transform 0.15s ease;
	}
	.btn-show.star.starred {
	  background: #fff7d6; /* 浅黄：已收藏（与 PicManage 收藏态一致） */
	}
	.btn-show.star:hover .star-icon {
	  transform: scale(1.12);
	}
	/* 分类下拉内的分割图行（复用右侧 gallery-item 观感） */
	.gallery-item:hover {
	  background: #ececec;
	}
	.gallery-item .gallery-name {
	  font-size: 0.8rem;
	}
</style>