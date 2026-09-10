# guangxiu（广绣 AI 教学平台 webapp）

Vue 3 + Vite 前端，Express 后端（REST + 静态托管 + AI worker WebSocket）。

- 本地启动：`build_app.bat`（装依赖 + 构建前端，改了前端代码才需要跑）→ `run_app.bat`（启动服务）
- 服务器部署：见 [DEPLOY.md](DEPLOY.md)

## 开发

```sh
npm install
npm run dev      # 前端热更新（注意 dev 端口与后端默认都是 3005，需错开）
npm run server   # 仅起后端（需先 npm run build 生成 dist）
npm start        # build + 起后端
```
