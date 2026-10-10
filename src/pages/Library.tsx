import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { FILE_KIND_LABELS, FILE_KIND_ORDER, STATUS_LABELS, STATUS_ORDER, type FileKind, type PatternFile, type PatternStatus, ITEM_TYPE_LABELS, type ItemType } from "../db/types";
import { DEFAULT_QUERY, SORT_LABELS, searchPatterns, type LibraryQuery, type SortKey } from "../lib/search";
import { usePersistentState } from "../hooks/hooks";
import { EmptyState, PatternCard, PatternRow } from "../components/PatternParts";

type ViewMode = "grid" | "list";

export default function Library() {
  const patterns = useLiveQuery(() => db.patterns.toArray(), []);
  // ファイルはメタデータのみ取得（PDF本体は読み込まない）
  const files = useLiveQuery(() => db.files.toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy("order").toArray(), []);
  const [view, setView] = usePersistentState<ViewMode>("kpl.libraryView", "grid");
  const [query, setQuery] = usePersistentState<LibraryQuery>("kpl.libraryQuery", DEFAULT_QUERY, "session");
  const [showFilters, setShowFilters] = useState(false);
  const [params, setParams] = useSearchParams();

  // ホームの「すべて見る」から来た場合は、その条件で絞り込む
  useEffect(() => {
    const status = params.get("status") as PatternStatus | null;
    const fav = params.get("fav") === "1";
    const type = params.get("type");
    if (!status && !fav && !type) return;
    setQuery({
      ...DEFAULT_QUERY,
      statuses: status && STATUS_ORDER.includes(status) ? [status] : [],
      favoriteOnly: fav,
      itemType: type === "pattern" || type === "book" || type === "ebook" ? type : status || fav ? "pattern" : undefined,
    });
    setParams({}, { replace: true });
  }, [params, setParams, setQuery]);

  const filesByPattern = useMemo(() => {
    const m = new Map<string, PatternFile[]>();
    for (const f of files ?? []) m.set(f.patternId, [...(m.get(f.patternId) ?? []), f]);
    return m;
  }, [files]);
  const catMap = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);
  const results = useMemo(
    () => (patterns && files && categories ? searchPatterns(patterns, files, categories, query) : undefined),
    [patterns, files, categories, query],
  );

  const set = <K extends keyof LibraryQuery>(k: K, v: LibraryQuery[K]) => setQuery((q) => ({ ...q, [k]: v }));
  const activeFilters =
    query.statuses.length + (query.favoriteOnly ? 1 : 0) + (query.hasPdf !== undefined ? 1 : 0) + (query.categoryId ? 1 : 0) + (query.fileKind ? 1 : 0);

  return (
    <div className="page library">
      <header className="page-header">
        <h1>ライブラリ</h1>
        <div className="view-toggle" role="group" aria-label="表示形式">
          <button type="button" aria-pressed={view === "grid"} className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}>
            グリッド
          </button>
          <button type="button" aria-pressed={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
            リスト
          </button>
        </div>
      </header>

      <div className="type-tabs" role="tablist" aria-label="種類">
        {([undefined, "pattern", "book", "ebook"] as (ItemType | undefined)[]).map((t) => (
          <button
            key={t ?? "all"}
            type="button"
            role="tab"
            aria-selected={query.itemType === t}
            className={query.itemType === t ? "on" : ""}
            onClick={() => set("itemType", t)}
          >
            {t ? ITEM_TYPE_LABELS[t] : "すべて"}
          </button>
        ))}
      </div>

      <div className="search-bar">
        <input
          type="search"
          className="input"
          placeholder="タイトル・デザイナー・ショップ・タグ・メモ"
          aria-label="作品を検索"
          value={query.text}
          onChange={(e) => set("text", e.target.value)}
        />
        <button
          type="button"
          className={`btn ${activeFilters ? "btn-accent" : ""}`}
          aria-expanded={showFilters}
          onClick={() => setShowFilters((s) => !s)}
        >
          絞り込み{activeFilters ? `（${activeFilters}）` : ""}
        </button>
      </div>

      {showFilters && (
        <div className="filters">
          <div className="filter-group">
            <span className="filter-label">ステータス</span>
            <div className="chips">
              {STATUS_ORDER.map((s) => {
                const on = query.statuses.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    className={`chip ${on ? "on" : ""}`}
                    onClick={() => set("statuses", on ? query.statuses.filter((x) => x !== s) : [...query.statuses, s])}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={query.favoriteOnly}
                className={`chip ${query.favoriteOnly ? "on" : ""}`}
                onClick={() => set("favoriteOnly", !query.favoriteOnly)}
              >
                ♥ お気に入り
              </button>
            </div>
          </div>
          <div className="filter-grid">
            <label>
              <span className="filter-label">PDF</span>
              <select
                className="select"
                value={query.hasPdf === undefined ? "" : query.hasPdf ? "yes" : "no"}
                onChange={(e) => set("hasPdf", e.target.value === "" ? undefined : e.target.value === "yes")}
              >
                <option value="">すべて</option>
                <option value="yes">PDF登録済み</option>
                <option value="no">PDF未登録</option>
              </select>
            </label>
            <label>
              <span className="filter-label">カテゴリ</span>
              <select className="select" value={query.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || undefined)}>
                <option value="">すべて</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="filter-label">ファイル種別</span>
              <select
                className="select"
                value={query.fileKind ?? ""}
                onChange={(e) => set("fileKind", (e.target.value || undefined) as FileKind | undefined)}
              >
                <option value="">すべて</option>
                {FILE_KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {FILE_KIND_LABELS[k]}あり
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="filter-label">並べ替え</span>
              <div className="price-row">
                <select className="select" value={query.sort} onChange={(e) => set("sort", e.target.value as SortKey)}>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => set("desc", !query.desc)} aria-label="並び順を切り替え">
                  {query.sort === "title" ? (query.desc ? "Z→A" : "A→Z") : query.desc ? "新しい順" : "古い順"}
                </button>
              </div>
            </label>
          </div>
          {activeFilters > 0 && (
            <button type="button" className="btn btn-small" onClick={() => setQuery({ ...DEFAULT_QUERY, text: query.text, sort: query.sort, desc: query.desc })}>
              絞り込みを解除
            </button>
          )}
        </div>
      )}

      {!results ? (
        <div className="loading">読み込み中…</div>
      ) : patterns!.length === 0 ? (
        <EmptyState title="まだ作品が登録されていません">
          <p>購入した編み図のPDFや、編みたい作品のURL、持っている本を登録してみましょう。</p>
          <Link to="/new" className="btn btn-primary">
            作品を登録する
          </Link>
        </EmptyState>
      ) : results.length === 0 ? (
        <EmptyState title="条件に合う作品がありません">
          <p>検索語や絞り込み条件を変えてみてください。</p>
        </EmptyState>
      ) : (
        <>
          <p className="result-count">{results.length}件</p>
          {view === "grid" ? (
            <div className="grid">
              {results.map((p) => (
                <PatternCard key={p.id} pattern={p} files={filesByPattern.get(p.id)} />
              ))}
            </div>
          ) : (
            <div className="list">
              {results.map((p) => (
                <PatternRow key={p.id} pattern={p} files={filesByPattern.get(p.id)} categories={catMap} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
