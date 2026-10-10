import { lazy, Suspense, useEffect, useRef } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { FeedbackProvider, useFeedback } from "./components/Feedback";
import { EmptyState } from "./components/PatternParts";
import { useOnline } from "./hooks/hooks";
import { ensureDefaultCategories } from "./db/repo";
import Home from "./pages/Home";
import Library from "./pages/Library";
import NewPattern from "./pages/NewPattern";
import EditPattern from "./pages/EditPattern";
import PatternDetail from "./pages/PatternDetail";
import Settings from "./pages/Settings";
import Import from "./pages/Import";
import Premium from "./pages/Premium";
import { startIncomingFileListener } from "./lib/native";

// ビューアは pdf.js を含み大きいので遅延読み込み
const Viewer = lazy(() => import("./pages/Viewer"));

export default function App({ recovered }: { recovered?: { patterns: number; files: number } }) {
  useEffect(() => {
    void ensureDefaultCategories();
  }, []);
  return (
    // iOS アプリ（Capacitor）でもサーバー設定なしで動くよう HashRouter を使う
    <HashRouter>
      <FeedbackProvider>
        <Shell recovered={recovered} />
      </FeedbackProvider>
    </HashRouter>
  );
}

function Shell({ recovered }: { recovered?: { patterns: number; files: number } }) {
  const location = useLocation();
  const online = useOnline();
  const navigate = useNavigate();
  const { toast } = useFeedback();

  useEffect(() => {
    if (recovered) toast(`保存されていた控えから、作品${recovered.patterns}件のデータを復元しました`);
  }, [recovered, toast]);
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // iOS アプリ：共有メニュー・「ファイル」アプリから PDF を受け取る（ブラウザ版では何もしない）
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    startIncomingFileListener(
      () => navRef.current("/import"),
      () => toastRef.current("ファイルを受け取れませんでした。もう一度共有してください。", "error"),
    ).then((s) => (disposed ? s() : (stop = s)));
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  const inViewer = /^\/patterns\/[^/]+\/files\//.test(location.pathname);

  useEffect(() => {
    if (!inViewer) window.scrollTo(0, 0);
  }, [location.pathname, inViewer]);

  return (
    <div className={`app ${inViewer ? "app-viewer" : ""}`}>
      {!online && !inViewer && <div className="offline-bar">オフラインです。保存済みの作品はそのまま閲覧・編集できます。</div>}
      <main className="main">
        <Suspense fallback={<div className="page loading">読み込み中…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/new" element={<NewPattern />} />
            <Route path="/patterns/:id" element={<PatternDetail />} />
            <Route path="/patterns/:id/edit" element={<EditPattern />} />
            <Route path="/patterns/:id/files/:fileId" element={<Viewer />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/import" element={<Import />} />
            <Route path="/premium" element={<Premium />} />
            <Route path="*" element={<EmptyState title="ページが見つかりません" />} />
          </Routes>
        </Suspense>
      </main>
      {!inViewer && (
        <nav className="tabbar" aria-label="メインメニュー">
          <NavLink to="/" end>
            <span aria-hidden="true">⌂</span>ホーム
          </NavLink>
          <NavLink to="/library">
            <span aria-hidden="true">▦</span>ライブラリ
          </NavLink>
          <NavLink to="/new">
            <span aria-hidden="true">＋</span>登録
          </NavLink>
          <NavLink to="/settings">
            <span aria-hidden="true">⚙</span>設定
          </NavLink>
        </nav>
      )}
    </div>
  );
}
