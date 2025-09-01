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
  server: { host: true },
});
