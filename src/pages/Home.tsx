import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import type { Pattern, PatternFile } from "../db/types";
import { Cover, EmptyState, PatternCard, StatusBadge } from "../components/PatternParts";
import { BACK_STATE } from "../hooks/navigation";
import { usePremium } from "../components/Paywall";
import { FREE_PATTERN_LIMIT } from "../lib/premium";

export default function Home() {
  const premium = usePremium();
  const patterns = useLiveQuery(() => db.patterns.toArray(), []);
  const files = useLiveQuery(() => db.files.toArray(), []);

  const filesByPattern = useMemo(() => {
    const m = new Map<string, PatternFile[]>();
    for (const f of files ?? []) m.set(f.patternId, [...(m.get(f.patternId) ?? []), f]);
    return m;
  }, [files]);

  if (!patterns) return <div className="page loading">読み込み中…</div>;
  const freeLimit = premium.enforced && !premium.active;

  const byUpdated = [...patterns].sort((a, b) => b.updatedAt - a.updatedAt);
  const inProgress = patterns
    .filter((p) => p.status === "in_progress")
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt));
  const recent = patterns
    .filter((p) => p.lastOpenedAt)
    .sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!)
    .slice(0, 8);
  const want = byUpdated.filter((p) => p.status === "want");
  const favorites = byUpdated.filter((p) => p.favorite);
  const done = byUpdated.filter((p) => p.status === "done");

  return (
    <div className="page home">
      <header className="page-header">
        <h1>ホーム</h1>
        <Link to="/new" className="btn btn-primary">
          ＋ 登録
        </Link>
      </header>

      {patterns.length === 0 ? (
        <EmptyState title="編み図ライブラリへようこそ">
          <p>購入した編み図のPDF、日本語に訳したPDF、編みたい作品のURLを、ひとつの作品としてまとめて管理できます。</p>
          <p className="muted">データはこの端末の中だけに保存されます。アカウント登録は不要です。</p>
          <Link to="/new" className="btn btn-primary">
            最初の作品を登録する
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-num">{patterns.length}</span>
              <span className="stat-label">{freeLimit ? `登録作品（無料は${FREE_PATTERN_LIMIT}件まで）` : "登録作品"}</span>
            </div>
            <div className="stat">
              <span className="stat-num">{inProgress.length}</span>
              <span className="stat-label">制作中</span>
            </div>
            <div className="stat">
              <span className="stat-num">{done.length}</span>
              <span className="stat-label">完成</span>
            </div>
          </div>

          <section className="section">
            <h2 className="section-title">制作中</h2>
            {inProgress.length === 0 ? (
              <p className="muted">制作中の作品はありません。作品の詳細画面で「制作を始める」を押すとここに表示されます。</p>
            ) : (
              <div className="wip-list">
                {inProgress.map((p) => (
                  <WipCard key={p.id} pattern={p} />
                ))}
              </div>
            )}
          </section>

          <Shelf title="最近開いた作品" items={recent} filesByPattern={filesByPattern} />
          <Shelf title="編みたい" items={want} filesByPattern={filesByPattern} more="/library?status=want" />
          <Shelf title="お気に入り" items={favorites} filesByPattern={filesByPattern} more="/library?fav=1" />
          <Shelf title="完成した作品" items={done} filesByPattern={filesByPattern} more="/library?status=done" />
        </>
      )}
    </div>
  );
}

function WipCard({ pattern }: { pattern: Pattern }) {
  return (
    <Link to={`/patterns/${pattern.id}`} state={BACK_STATE} className="wip-card">
      <Cover pattern={pattern} className="wip-cover" />
      <div className="wip-body">
        <StatusBadge status={pattern.status} />
        <div className="wip-title">{pattern.title}</div>
        <span className="wip-cta">続きから編む ›</span>
      </div>
    </Link>
  );
}

function Shelf({
  title,
  items,
  filesByPattern,
  more,
}: {
  title: string;
  items: Pattern[];
  filesByPattern: Map<string, PatternFile[]>;
  more?: string;
}) {
  if (!items.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {more && items.length > 8 && (
          <Link to={more} className="link">
            すべて見る
          </Link>
        )}
      </div>
      <div className="shelf">
        {items.slice(0, 8).map((p) => (
          <PatternCard key={p.id} pattern={p} files={filesByPattern.get(p.id)} />
        ))}
      </div>
    </section>
  );
}
