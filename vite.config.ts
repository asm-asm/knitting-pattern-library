import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Capacitor（iOS）でも file ベースで読み込めるよう相対パスで出力する
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Knitting Pattern Library",
        short_name: "編み図ライブラリ",
        description: "編み図PDFと作品情報を端末内で管理するアプリ",
        lang: "ja",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f7f3ee",
        theme_color: "#f7f3ee",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // アプリ本体と pdf.js の CMap/フォントをすべて事前キャッシュし、完全オフラインで動かす
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,ico,bcmap,pfb,ttf,wasm,json}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "index.html",
      },
    }),
  ],
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
  },
});
