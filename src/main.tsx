import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ブラウザ版のみ Service Worker でアプリ本体をキャッシュし、オフラインで起動できるようにする。
// iOS アプリ（Capacitor）ではアプリ本体が端末内に同梱されるため不要。
const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
if (import.meta.env.PROD && !isNative && "serviceWorker" in navigator) {
  import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}
