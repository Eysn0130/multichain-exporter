import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const isGhPages = process.env.GH_PAGES === "true";

export default defineConfig({
  plugins: [react()],
  base: isGhPages ? "/multichain-exporter/" : "/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: true,
    // 🔽 新增：OKLink 代理，解决浏览器直连的 CORS 问题
    proxy: {
      "/oklink": {
        target: "https://www.oklink.com",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/oklink/, ""),
        headers: {
          // 一些站点会校验 UA/来源，加上更稳
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          Referer: "https://www.oklink.com/",
          Origin: "https://www.oklink.com",
        },
      },
    },
  },
});
