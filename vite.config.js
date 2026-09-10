import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import systemImageIndexPlugin from "./scripts/gen-system-image-index.mjs";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    vue(),
    systemImageIndexPlugin(),
  ],
  build: {
    reportCompressedSize: false, // 跳过 gzip 体积统计，大资源多时能省不少时间
    chunkSizeWarningLimit: 2000,
  },
  server:{
    hmr: false,
    host: "127.0.0.1",
    port: 3005,   // 固定端口
    allowedHosts: [
		"http://localhost:3005",
		"127.0.0.1:3005",
        "charint.sv6.tunnelfrp.com",
		"3595425ecte0.vicp.fun"  // 你的内网穿透域名
    ],
    strictPort: true // 如果 3005 被占用就报错，而不是自动换端口
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})