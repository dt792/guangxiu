// Cloud AI generation routes: 全部走阿里云百炼（LLM / qwen-vl / t2i / i2v），
// 一个 DASHSCOPE_API_KEY 即可；端点保持不变。
import { Router } from 'express';

import * as cloud from '../cloud.js';
import { sysInfo, imageInfoToDict } from '../store.js';
import { log, short } from '../logger.js';

const router = Router();

router.get('/poetry2hint/:poetry', async (req, res, next) => {
  try {
    const messages = [
      { role: 'system', content: '我很聪明，也很懂中华文化，是个有用的ai助手' },
      {
        role: 'user',
        content: `针对古诗词“​${req.params.poetry}​”给出其中文提示词，用于qwen-image图片生成` +
          ',可以适当删去一些内容，只需要描述场景、对象及其画面位置，不要天气，不要抒情，不涉及针法,不要光线，以及不要任何导致模糊、隐约之类的描述。注意用词不必过度优美，不要水印，不要印章，不要文字、题词。只要连贯的中文提示词输出即可不要额外说明',
      },
    ];
    res.json(await cloud.deepseek(messages));
  } catch (e) {
    next(e);
  }
});

router.post('/t2i/:user_id/:id', async (req, res, next) => {
  try {
    const { user_id, id } = req.params;
    sysInfo.data.tasks[id] = { id, img_id: '', process: 0, state: '队列中' };
    const hint = '广绣（广东刺绣、粤绣）风格的刺绣艺术品，' + req.body.hint +
      '，丝线绣制，针脚细密整齐，缎面底布，丝光质感，色彩浓艳饱满，构图丰满，' +
      '立体感强，刺绣纹理清晰可见，画面充满质感，极具传统广绣艺术特色。';
    log('api', `t2i user=${user_id} task=${id} hint="${short(hint, 60)}"`);
    // lora/cfg/steps belonged to the old ComfyUI workflow; kept for request compatibility
    const output = await cloud.dashscopeT2i(hint, req.body.width ?? 1024, req.body.height ?? 1024);
    sysInfo.data.tasks[id].state = '完成';
    sysInfo.data.tasks[id].process = 100;
    const info = await sysInfo.createUserImageInfo(user_id, 'temp_generated_statics', output);
    res.json(imageInfoToDict(info));
  } catch (e) {
    next(e);
  }
});

router.get('/qwen_vl/:id/:style', async (req, res, next) => {
  try {
    const info = sysInfo.data.image_infos[req.params.id];
    if (!info) return res.status(404).json({ error: 'image not found' });
    res.json(await cloud.qwenVl(info.src, req.params.style));
  } catch (e) {
    next(e);
  }
});

router.get('/i2v/:user_id/:id/:hint', async (req, res, next) => {
  try {
    const { user_id, id, hint } = req.params;
    const info = sysInfo.data.image_infos[id];
    if (!info) return res.status(404).json({ error: 'image not found' });
    // wan2.7 accepts base64 first frame, no public url required
    const videoPath = await cloud.dashscopeI2v(info.src, hint);
    const created = await sysInfo.createUserVideoInfo(user_id, 'temp_generated_dynamics', videoPath);
    res.json(imageInfoToDict(created));
  } catch (e) {
    next(e);
  }
});

export default router;
