import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.sammy.knittinglibrary",
  appName: "編み図ライブラリ",
  webDir: "dist",
  ios: {
    // PDF の閲覧中にページ全体がバウンドしないようにする
    scrollEnabled: false,
    contentInset: "never",
  },
};

export default config;
