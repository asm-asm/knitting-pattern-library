import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { isNativeApp } from "./lib/native";
import { initStorage } from "./storage/init";

const root = createRoot(document.getElementById("root")!);
const render = (recovered?: { patterns: number; files: number }) =>
  root.render(
    <StrictMode>
      <App recovered={recovered} />
    </StrictMode>,
  );

// iOS アプリでは、保存先の準備（必要なら控えからの自動復元）が終わってから画面を出す
initStorage()
  .then((r) => render(r.recovered))
  .catch((e) => {
    console.warn("storage init failed", e);
    render();
  });

// ブラウザ版のみ Service Worker でアプリ本体をキャッシュし、オフラインで起動できるようにする。
// iOS アプリ（Capacitor）ではアプリ本体が端末内に同梱されるため不要。
if (import.meta.env.PROD && !isNativeApp() && "serviceWorker" in navigator) {
  import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}
