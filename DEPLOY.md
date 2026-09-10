# 部署指南

## 架构

```
浏览器
   │  HTTP / WebSocket（端口 3005）
   ▼
webapp 服务器（Node ≥ 22：前端静态 + REST API + /ws/worker）
   │  ▲
   │  │ worker 主动连出（WebSocket，无需公网 IP）
   ▼  │
阿里云百炼 API          ai_worker（Python：YOLO / SAM2 / ResNet 本地推理）
（LLM / qwen-vl / t2i / i2v）
```

t2i / i2v / qwen-vl / LLM 走云端，检测 / 分割 / 分类走本地 worker。

## 一、webapp 服务器

```bash
cp .env.example .env   # 填入 DASHSCOPE_API_KEY（百炼 API-KEY），SERVER_HOST=0.0.0.0，改 WORKER_TOKEN
npm install
npm run build
npm run server
```

验证：浏览器访问 `http://服务器IP:3005`。

## 二、ai_worker（本地推理机）

```bash
pip install -r requirements.txt   # Python 3.10+，需 CUDA 则装对应版 torch
cp .env.example .env              # SERVER_WS_URL=ws://服务器IP:3005/ws/worker，WORKER_TOKEN 与服务器一致
python main.py
```

确认 `models/` 下有 `impro-yolov8.pt`、`sam2.1_l.pt`、`resnet18_embroidery.pth` 三个模型文件。看到 `[ws] 已连接服务器` 即成功。
