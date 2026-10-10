import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.sammy.knittinglibrary",
  appName: "編み図ライブラリ",
  webDir: "dist",
  ios: {
    // ノッチ・ホームバー部分の余白は CSS（safe-area-inset）で調整する
    contentInset: "never",
  },
};

export default config;
