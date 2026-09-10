// stores/userStore.ts
import { defineStore } from 'pinia'
import {computed, reactive, ref} from "vue";
import axios from "axios";

// 基础配置：API 地址通过环境变量 VITE_API_BASE_URL 配置（见 webapp/.env），
// 未配置时默认同源（生产部署时前后端同端口）
export const api = axios.create({
	// baseURL: 'http://127.0.0.1:5000/',
    baseURL: import.meta.env.VITE_API_BASE_URL || '/',
});

// 请求拦截：自动携带登录 token。
// 优先读当前 store 的内存态（登录写入后立即生效）；若请求恰好发生在模块极早期
// （pinia 尚未安装/持久化尚未还原），则回退读取 localStorage，保证不漏带旧会话 token。
// 这让后端始终以“真实 token”判断身份，避免被当成访客 → 不会再出现登录态一闪即回访客。
export function readStoredToken() {
    try {
        const token = useUserStore().token || ''
        if (token) return token
    } catch (e) {}
    try {
        const raw = localStorage.getItem('user-store')
        if (raw) {
            // pinia-plugin-persistedstate 返回直接对象，或嵌套在 _ 下（旧格式兼容）
            const state = JSON.parse(raw)
            return (state && (state.token || (state._ && state._.token))) || ''
        }
    } catch (e) {}
    return ''
}
api.interceptors.request.use((config) => {
    try {
        const token = readStoredToken()
        if (token) {
            config.headers = config.headers || {}
            config.headers['Authorization'] = 'Bearer ' + token
        }
    } catch (e) {}
    return config
}, (error) => Promise.reject(error))

let uid='';

export const notyf = new Notyf({
    position: { x: 'right', y: 'top' },
    duration: 2000, // 2秒后消失
    dismissible: false
});
export const useUserStore = defineStore('user', () => {
    const user_id=ref("id")
    const token=ref("")
    const username=ref("")
    const isLoggedIn=ref(false)
    //图片
    const upload_s=ref(true)
    const seg_s=ref(true)
    const gen_static_s=ref(true)
    const gen_dynamic_s=ref(true)

    const t_selector_index=ref(0)
    const t_upload_s=ref(true)
    const t_gens_s=ref(true)
    const t_selectedImageId = ref("1")
    const t_auto_classify=ref(false)
    const t_auto_segment=ref(true)
    const t_mask_s = ref(false)

    const t2i_gen_process=ref(0)
    const t2i_gen_mask=ref(true)
    const t2i_poem=ref("《题破山寺后禅院》\n清晨入古寺，初日照高林。\n曲径通幽处，禅房花木深。\n山光悦鸟性，潭影空人心。\n万籁此都寂，但余钟磬音。")
    const t2i_poem_hint=ref("")
    const t2i_ref_id=ref("")
    const t2i_gen_num=ref(1)
    const t2i_lora=ref(0.80)
    const t2i_cfg=ref(4.0)
    const t2i_steps=ref(20)
    const t2i_pixel_index=ref(0)

    const i2v_gen_process=ref(0)
    const i2v_gen_mask=ref(true)
    const i2v_public_s=ref(true)
    const i2v_upload_s=ref(true)
    const i2v_gen_static_s=ref(true)
    const i2v_ref_id=ref("")
    const i2v_hint=ref("")
    const i2v_style=ref("默认")


    return {user_id, token, username, isLoggedIn,
        upload_s,seg_s,gen_static_s,gen_dynamic_s,
        t_selector_index,t_selectedImageId, t_gens_s,t_upload_s,t_auto_classify,t_auto_segment,t_mask_s,
        t2i_poem,t2i_poem_hint,t2i_pixel_index,t2i_ref_id,t2i_gen_num,t2i_lora,t2i_cfg,t2i_steps,t2i_gen_mask,t2i_gen_process,
        i2v_public_s,i2v_upload_s,i2v_gen_static_s, i2v_ref_id,i2v_hint,i2v_style,i2v_gen_mask,i2v_gen_process}
}, {
    // 启用持久化配置
    persist: {
        key: 'user-store',    // 自定义存储键名（可选）
        storage: localStorage, // 指定存储方式（可选）
        paths: ['user_id', 'token', 'username', 'isLoggedIn']      // 持久化登录态，刷新不丢失
    }
})

// 解析当前操作所属的用户数据 id：
//  1) 真实的登录会话 —— userId 以登录回包写入 store 的为准，直接返回本人 id。
//     这里【不再】向后端二次推导，也【不会】据此清除登录态。原因：
//     当页面在组件 setup 阶段（非 pinia 活跃上下文）发起 /first_user_id 时，
//     请求可能因取不到 token 而拿回“访客 id”，旧的逻辑据此误判为 token 失效，
//     清空登录（引起右上角用户名一闪即回访客），并把游客公开数据灌进 imageStore
//     （引起从图库管理切到 TeachingHelper/T2I/I2V 后变成访客数据）。这违背了
//     “登录后只访问本人账号的数据”的隔离要求。
//  2) 未登录 —— 取系统“访客（首用户）”公用账号 id 并把数据挂在访客名下公开可见。
//     仅未登录时才需要向后端询问访客 id。
export async function resolve_current_user() {
    const userStore = useUserStore()
    // 已登录：以登录回包写入的本人 id 为准，返回后不落库（已是正确值）。
    if (userStore.token && userStore.isLoggedIn && userStore.user_id) {
        return userStore.user_id
    }
    // 未登录（访客）：向后端取公用访客账号 id，并写回 store，
    // 确保后续直接读取 userStore.user_id 的 CRUD（上传/保存等）挂在访客名下。
    const res = await api.get('/first_user_id')
    userStore.user_id = res.data
    return userStore.user_id
}

// 核心排序函数
function sortByStarAndDate(a, b) {
    // 优先按 is_star 排序（true 在前）
    if (b.is_star !== a.is_star) {
        return b.is_star ? 1 : -1;
    }
    // 其次按 update_time 降序（新日期在前）
    return new Date(b.update_time) - new Date(a.update_time);
}


// 系统广绣图库：放置于服务端 server/data/system_images/ 下的图片。
// 服务启动时自动扫描目录并生成缩略图，前端通过 /system_images 接口获取清单，
// 不写死数量；选中后才上传至后端 uploads 获得真实 id

// 模块级“加载中”标志，供 load_system_images 去重
let _sysLoading = null

export const useImageStore = defineStore('image', () => {

    const uploads=ref([])	//用户上传图片
    const temp_segmentations=ref([])	//分割处理后的图像
    const segmentations=ref([])			

    const temp_generated_dynamics =ref([])	//生成的动态图像
    const generated_dynamics=ref([])

    const temp_generated_statics=ref([])	//生成的静态图像
    const generated_statics=ref([])

    const systemImages=ref([])	//系统广绣图（服务端 data/system_images，启动时自动扫描）

    // 加载系统广绣图库：从服务端接口读取目录清单，不硬编码数量
    // 服务端启动时自动扫描 data/system_images 并生成缩略图
    async function load_system_images() {
        if (_sysLoading) return _sysLoading           // 防止并发重复请求
        if (systemImages.value.length > 0) return     // 已加载则不重复
        _sysLoading = (async () => {
            try {
                const res = await api.get('/system_images')
                const files = res.data
                const baseURL = api.defaults.baseURL.replace(/\/$/, '')
                systemImages.value = files.map((name) => ({
                    id: 'sys_' + name,               // 前端临时 id，无后端对应
                    name,
                    // 网格显示缩略小图（服务端 .thumbs 预生成，几十 KB），
                    // 原高清大图仅在真正需要(上传/查看)时经 src 才加载
                    src: baseURL + '/system_images/src/' + encodeURIComponent(name),
                    thumbnail: baseURL + '/system_images/thumbnail/' + encodeURIComponent(name),
                    is_system: true
                }))
            } catch (e) {
                console.error('系统图库清单加载失败:', e)
            } finally {
                _sysLoading = null
            }
        })()
        return _sysLoading
    }

    // function find(id){
    //     const merged =  generated_ImageUploaddynamics.value.concat(
    //         generated_statics.value,
    //         segmentations.value,
    //         temp_segmentations.value,
    //         temp_generated_dynamics.value,
    //         temp_generated_statics.value,
    //         uploads.value);
    //     for (const i of merged){
    //         if(i.id===id)
    //             return i;
    //     }
    //     console.log("没有找到")
	
	//调试
	function find(id){
	    console.log('查找ID:', id, '类型:', typeof id);
	    
	    const allArrays = {
	        generated_dynamics: generated_dynamics.value,
	        generated_statics: generated_statics.value,
	        segmentations: segmentations.value,
	        temp_segmentations: temp_segmentations.value,
	        temp_generated_dynamics: temp_generated_dynamics.value,
	        temp_generated_statics: temp_generated_statics.value,
	        uploads: uploads.value
	    };
	    
	    // 检查每个数组的内容
	    for (const [name, array] of Object.entries(allArrays)) {
	        console.log(`${name}:`, array.map(item => ({id: item.id, type: typeof item.id})));
	        const found = array.find(item => item.id == id); // 宽松比较
	        if (found) {
	            console.log(`在 ${name} 中找到`);
	            return found;
	        }
	    }
	    
	    console.log("没有找到");
	    return null;
	}
	
    // function pushd(from,to){
    //     from.forEach((item)=>{
    //         item.src=api.defaults.baseURL+"/image/src/"+item.id;
    //         item.thumbnail=api.defaults.baseURL+"/image/thumbnail/"+item.id;
    //         to.push(item);
    //     })
    //     to.sort((a, b) => new Date(b.update_time) - new Date(a.update_time));
    // }
	
	function pushd(from,to){
	    from.forEach((item)=>{
	        // 修复URL拼接，避免双斜杠
	        const baseURL = api.defaults.baseURL.endsWith('/') 
	            ? api.defaults.baseURL.slice(0, -1) 
	            : api.defaults.baseURL;
	        item.src = baseURL + "/image/src/" + item.id;
	        item.thumbnail = baseURL + "/image/thumbnail/" + item.id;
	        to.push(item);
	    })
	    to.sort((a, b) => new Date(b.update_time) - new Date(a.update_time));
	}
	
    async function update_image_infos (user_id) {
        await api.get("user/"+user_id).then(res=>{
            this.generated_dynamics=[]
            this.generated_statics=[]
            this.temp_segmentations=[]
            this.segmentations=[]
            this.temp_generated_dynamics=[]
            this.temp_generated_statics=[]
            this.uploads=[]
            // 处理所有数组的排序
            for (const key in res.data) {
                if (Array.isArray(res.data[key])) {
                    res.data[key].sort(sortByStarAndDate);
                }
            }
            console.log(res.data)
            console.log(res.data.temp_generated_dynamics)
            console.log(res.data["temp_generated_dynamics"])
            pushd( res.data.temp_generated_dynamics,this.temp_generated_dynamics)
            pushd( res.data.generated_dynamics,this.generated_dynamics)

            pushd( res.data.temp_generated_statics,this.temp_generated_statics)
            pushd( res.data.generated_statics,this.generated_statics)

            pushd( res.data.temp_segmentations,this.temp_segmentations)
            pushd( res.data.segmentations,this.segmentations)
            pushd(res.data. uploads,this.uploads)
            console.log(res.data)
        })
    }
    async function load_thumbnails(){

    }

    async function load_full(item){
        if(item===undefined) return;
        // console.log("load_full")
        // console.log(item)
        // if(!item.is_src_loaded){
        //     item.src=await get_full(item.id)
        //     item.is_src_loaded=true
        // }
    }
    async function load_video_full(item){
        if(!item.is_src_loaded){
            item.src=await get_video_full(item.id)
            item.is_src_loaded=true
        }
    }

    async function load_full_by_id(id){
        const item= find(id)
        if(!item.is_src_loaded){
            console.log("加载全图"+id)
            item.src=await get_full(id)
            item.is_src_loaded=true
            console.log("加载完毕"+id)
        }
    }
    async function get_full(id){
        // 发起请求，明确设置 responseType 为 'arraybuffer'
        const response =await api.get("image/src/"+id, {
            responseType: 'arraybuffer',
            headers: {'Accept': 'image/webp'}
        });
        try {
            const data=response.data
            let blob = new Blob([data], {type: 'image/webp'});
            return URL.createObjectURL(blob);
        }
        catch (e){
            return "https://placehold.co/600x400/2563eb/white?text=Hello"
        }
    }
    async function get_video_full(id){
        // 发起请求，明确设置 responseType 为 'arraybuffer'
        const response =await api.get("video/src/"+id, {
            responseType: 'arraybuffer',
            headers: {'Accept': 'video/mp4'}
        });
        try {
            const data=response.data
            let blob = new Blob([data], {type: 'video/mp4'});
            return URL.createObjectURL(blob);
        }
        catch (e){
            return "https://placehold.co/600x400/2563eb/white?text=Hello"
        }
    }
    async function get_thumbnail(id){
        // 发起请求，明确设置 responseType 为 'arraybuffer'
        const response =await api.get("image/thumbnail/"+id, {
            responseType: 'arraybuffer',
            headers: {'Accept': 'image/webp'}
        });
        try {
            const data=response.data
            let blob = new Blob([data], {type: 'image/webp'});
            return URL.createObjectURL(blob);
        }
        catch (e){
            return "https://placehold.co/600x400/2563eb/white?text=Hello"
        }
    }
    return {
         generated_dynamics, generated_statics,segmentations,temp_segmentations, temp_generated_dynamics,temp_generated_statics,uploads,systemImages,
        find,
        update_image_infos ,load_thumbnails,
        load_full,load_full_by_id,get_full,load_video_full,get_thumbnail,get_video_full,load_system_images
    }
})

export const example_poetrys=[
    {title:"《春晓》孟浩然\n",body:"夜来风雨声，\n花落知多少。"},
    {title:"《春晓》孟浩然\n",body:"春眠不觉晓，\n处处闻啼鸟。"},
    {title:"《食荔枝》苏轼\n",body:"罗浮山下四时春，\n卢橘杨梅次第新。\n日啖荔枝三百颗，\n不辞长作岭南人。"},
    {title:"《和方同知木棉花》\n",body:"南州有嘉树，绛萼压枝低。\n小草难为伍，甘棠可与齐。\n丹心承雨露，黄叶净尘泥。\n节操宜坚守，群乌得所栖。" },
    {title:"《小池》杨万里\n",body:"泉眼无声惜细流，\n树阴照水爱晴柔。\n小荷才露尖尖角，\n早有蜻蜓立上头。"},
    {title:"《黄鹤楼送孟浩然之广陵》李白\n",body:"故人西辞黄鹤楼，\n烟花三月下扬州。\n孤帆远影碧空尽，\n唯见长江天际流。"},
    {title:"《绝句》杜甫\n",body:"两个黄鹂鸣翠柳，\n一行白鹭上青天."},
    {title:"《绝句》杜甫\n",body:"窗含西岭千秋雪，\n门泊东吴万里船。"},
    {title:"《山行》杜牧\n",body:"远上寒山石径斜，\n白云深处有人家。\n停车坐爱枫林晚，\n霜叶红于二月花。"},
    {title:"《江雪》柳宗元\n",body:"千山鸟飞绝，\n万径人踪灭。\n孤舟蓑笠翁，\n独钓寒江雪。"},
    {title:"《村居》高鼎\n",body:"草长莺飞二月天，\n拂堤杨柳醉春烟。\n儿童散学归来早，\n忙趁东风放纸鸢。"},
    {title:"《江南春》杜牧\n",body:"千里莺啼绿映红，\n水村山郭酒旗风。\n南朝四百八十寺，\n多少楼台烟雨中。"},
]
// 按题材分类的岭南古诗词词库
export const poetry_categories=[
  {
    category:'荔枝',
    tag:'litchi',
    poems:[
      {title:"《惠州一绝》——苏轼\n",body:"罗浮山下四时春，\n卢橘杨梅次第新。\n日啖荔枝三百颗，\n不辞长作岭南人。"},
      {title:"《咏荔枝》——丘浚\n",body:"世间珍果更无加，玉雪肌肤罩绛纱。\n一种天然好滋味，可怜生处是天涯。"},
      {title:"《荔枝四首·其一》——丘浚\n",body:"世间珍果更无加，玉雪肌肤罩绛纱。\n一种天然好滋味，可怜生处是天涯。"},
      {title:"《广州荔枝词·其四》——屈大均\n",body:"六月增城火齐红，家家买得荔枝同。\n玉人纤手徐开合，争嚼冰浆满口风。"},
      {title:"《荔枝》——张九龄\n",body:"红颗真珠诚可爱，白须太守亦何痴。\n十年结子知谁在，自向中庭种荔枝。"},
      {title:"《四月八日尝新荔枝①》——杨万里\n",body:"一点胭脂染蒂旁，忽然红遍绿衣裳。\n紫琼骨骼丁香瘦，白雪肌肤午暑凉。"},
    ],
  },
  {
    category:'花卉',
    tag:'flower',
    poems:[
      {title:"《木棉花》——屈大均\n",body:"十丈珊瑚是木棉，花开红比朝霞鲜。\n天南树树皆烽火，不及攀枝花可怜。"},
      {title:"《红茉莉》——屈大均\n",body:"春深绝不见妍华，极目黄茆际白沙。\n几树半天红似染，居人云是木棉花。"},
      {title:"《九里香》——范端昂\n",body:"香闻九里最氤氲，满架轻阴雪作云。\n开到炎天花事了，枝头犹挂月中芬。"},
      {title:"《和方同知木棉花》\n",body:"南州有嘉树，绛萼压枝低。\n小草难为伍，甘棠可与齐。\n丹心承雨露，黄叶净尘泥。\n节操宜坚守，群乌得所栖。"},
      {title:"《素馨花》——屈大均\n",body:"六月初明素雪开，枝枝如雪复如梅。\n内园解作诗人意，齐向春寒解物情。"},
      {title:"《百合雨》——杨万里\n",body:"春宜半夏夏宜莲，大暑初临著手鲜。\n香远更宜清昼永，一山红锦正婵娟。"},
    ],
  },
  {
    category:'禽鸟',
    tag:'bird',
    poems:[
      {title:"《鹧鸪》——郑谷\n",body:"暖戏烟芜锦翼齐，品流应得近山鸡。\n雨昏青草湖边过，花落黄陵庙里啼。\n游子乍闻征袖湿，佳人才唱翠眉低。\n相呼相应湘江阔，苦竹丛深日向西。"},
      {title:"《越鸟》——郑谷\n",body:"背霜南雁不到处，倚棹北人初听时。\n梅雨满江春草歇，一声声在荔枝枝。"},
      {title:"《白鹇》——李白\n",body:"请以双白璧，买君双白鹇。\n白鹇白如锦，白雪耻容颜。"},
      {title:"《画眉鸟》——欧阳修\n",body:"百啭千声随意移，山花红紫树高低。\n始知锁向金笼听，不及林间自在啼。"},
    ],
  },
  {
    category:'风景',
    tag:'scenery',
    poems:[
      {title:"《送桂州严大夫》——韩愈\n",body:"苍苍森八桂，兹地在湘南。\n江作青罗带，山如碧玉簪。\n户多输翠羽，家自种黄甘。\n远胜登仙去，飞鸾不假骖。"},
      {title:"《岭南江行》——柳宗元\n",body:"瘴江南去入云烟，望尽黄茆是海边。\n山腹雨晴添象迹，潭心日暖长蛟涎。"},
      {title:"《岭南大雪》——区仕衡\n",body:"海冻珊瑚万里沙，炎方六出尽成花。\n洛阳纵有行春令，谁问袁安处士家。"},
      {title:"《题庾岭三亭诗·叱驭楼》——余靖\n",body:"山巅层构与云平，贤者新题叱驭名。\n为要澄清归治道，不辞艰险表忠诚。\n南枝初见梅林秀，九折遥思剑栈横。\n若使当时嫌远宦，海隅何得有欢声。"},
      {title:"《珠江春泛》——屈大均\n",body:"珠水烟波接海长，春潮微带落霞光。\n黄鱼日作三江雨，白鹭天留一片霜。"},
      {title:"《夜泊珠江》——朱彝尊\n",body:"潮涌牛栏外，舟停蜑户旁。\n月高人不寐，隔浦是歌堂。"},
      {title:"《南海》——文天祥\n",body:"朅来南海上，人死乱如麻。\n腥浪拍心碎，飙风吹鬓华。\n一山还一水，无国又无家。\n男子千年志，吾生未有涯。"},
      {title:"《广州蒲涧寺》——苏轼\n",body:"不用山僧导我前，自寻云外出山泉。\n千章古木临无地，百尺飞涛泻漏天。"},
      {title:"《登粤王台》——宋之问\n",body:"江上粤王台，登高望几回。\n南溟天外合，北户日边开。\n地湿烟尝起，山晴雨半来。\n冬花采卢橘，夏果摘杨梅。"},
    ],
  },
  {
    category:'民俗风物',
    tag:'folk',
    poems:[
      {title:"《潮州寒食》——郑刚中\n",body:"一春行乐万花边，寒食风光在眼前。\n刺史不须吹皷角，海棠梨叶自初眠。"},
      {title:"《广州竹枝词》——屈大均\n",body:"洋船争出是官商，十字门开向二洋。\n五丝八丝广缎好，银钱堆满十三行。"},
      {title:"《岭南杂咏·其五》——汪广洋\n",body:"海滨朝夕易炎凉，湿气蒸人沁薄裳。\n昨日崖州有船到，满城争买白槟榔。"},
      {title:"《送人游岭南》——司空曙\n",body:"万里南游客，交州见柳条。\n逢迎人易合，时日酒能消。\n浪晓浮青雀，风温解黑貂。\n囊金如未足，莫恨故乡遥。"},
      {title:"《酒家》——文同\n",body:"素莲花聚锦如堆，销尽南洲百越杯。\n莫怪临歧频劝饮，岭头犹带雪痕来。"},
    ],
  },
  {
    category:'羁旅与谪居',
    tag:'exile',
    poems:[
      {title:"《谪岭南道中作》——李德裕\n",body:"岭水争分路转迷，桄榔椰叶暗蛮溪。\n愁冲毒雾逢蛇草，畏落沙虫避燕泥。\n五月畲田收火米，三更津吏报潮鸡。\n不堪肠断思乡处，红槿花中越乌啼。"},
      {title:"《度大庾岭》——宋之问\n",body:"度岭方辞国，停轺一望家。\n魂随南翥鸟，泪尽北枝花。\n山雨初含霁，江云欲变霞。\n但令归有日，不敢恨长沙。"},
      {title:"《岭南郊行》——刘克庄\n",body:"瘴雾驱除更不疑，岭梅花发已多时。\n客行忽到三江口，卧看春风上桂枝。"},
      {title:"《南海旅次》——曹松\n",body:"忆归休上越王台，归思临高不易裁。\n为客正当无雁处，故园谁道有书来。\n城头早角吹霜尽，郭里残潮荡月回。\n心似百花开未得，年年争发被春催。"},
      {title:"《送王昌龄之岭南》——孟浩然\n",body:"洞庭去远近，枫叶早惊秋。\n岘首羊公爱，长沙贾谊愁。\n土毛无缟纻，乡味有槎头。\n已抱沈痼疾，更贻魑魅忧。"},
      {title:"《谪居》——刘长卿\n",body:"孤根何处托，徙倚定林端。\n瘴海去人远，秋霜照客寒。\n一封朝奏九重天，夕贬潮阳路八千。\n欲为圣明除弊事，肯将衰朽惜残年。"},
    ],
  },
]
export const little_knowledges=[
    "广绣指广州府及周边地区的传统民间刺绣工艺。",
    "广绣与苏绣、湘绣、蜀绣并称中国四大名绣。",
    "2006年，广绣被正式列入国家级非物质文化遗产保护名录。",
    "广绣主要包含丝绒刺绣、盘金刺绣和珠绣。",
    "广绣历史悠久，起源于唐代，明清时期发展至鼎盛阶段。",
    "广绣题材丰富多样，涵盖花鸟、山水、人物等多种艺术表现形式。",
    "广绣构图饱满、色彩绚丽，展现浓郁的岭南艺术风格。",
    "广绣针程讲究、针法多变、层次分明、善留水路、立体感强。",
    "广绣用线多样，以丝绒线为主，也采用马缠绒、孔雀毛绒及金丝银丝线。",
    "广绣针法繁多，常用平针、续针、咬针、插针等多样针法。",
    "广绣针法多达几十种，工艺繁杂精细。",
    "平针是广绣最早出现且使用最频繁的针法。",
    "续针常用于延长针程及填充色块，是广绣常见的针法。",
    "咬针指针迹相互咬接，呈现立体面上不同渐变效果。",
    "插针工艺精湛，早期广绣品中应用广泛。",
    "广绣留水路技法清晰分明，层次丰富，体现高超刺绣技艺。",
]