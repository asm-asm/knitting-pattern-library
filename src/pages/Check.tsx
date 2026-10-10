import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../db/db";
import { ITEM_TYPE_LABELS, itemTypeOf, type Pattern } from "../db/types";
import { Cover, ItemBadge } from "../components/PatternParts";
import { useFeedback } from "../components/Feedback";
import { useGoBack, BACK_STATE } from "../hooks/navigation";
import { canScanBarcode, scanIsbnBarcode } from "../lib/barcode";
import { lookupBook, type BookInfo } from "../lib/bookLookup";
import { formatIsbn, normalizeIsbn } from "../lib/isbn";
import { findOwned } from "../lib/ownership";
import { DEFAULT_QUERY, searchPatterns } from "../lib/search";
import { setBookPrefill } from "../lib/bookHandoff";

type Result =
  | { kind: "isbn"; isbn: string; exact: Pattern[]; similar: Pattern[]; info?: BookInfo; looking: boolean; offline?: boolean }
  | { kind: "text"; text: string; matches: Pattern[] };

/** 「これ持ってる？」：本屋などで、バーコードや書名から持っているかをすぐ確かめる */
export default function Check() {
  const navigate = useNavigate();
  const goBack = useGoBack("/");
  const { showError } = useFeedback();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const checkIsbn = async (isbn: string) => {
    const items = await db.patterns.toArray();
    // ISBN の照合は端末内だけで、すぐに結果を出す
    const first = findOwned(items, { isbn });
    setResult({ kind: "isbn", isbn, exact: first.exact, similar: [], looking: navigator.onLine, offline: !navigator.onLine });
    if (!navigator.onLine) return;
    // 書名を調べて、ISBN を登録していない本とも照合する
    const info = await lookupBook(isbn).catch(() => undefined);
    const similar = info?.title ? findOwned(items, { isbn, title: info.title }).similar : [];
    setResult({ kind: "isbn", isbn, exact: first.exact, similar, info, looking: false });
  };

  const checkText = async (text: string) => {
    const [items, files, categories] = await Promise.all([db.patterns.toArray(), db.files.toArray(), db.categories.toArray()]);
    const hits = searchPatterns(items, files, categories, { ...DEFAULT_QUERY, text });
    const similar = findOwned(items, { title: text }).similar.filter((p) => !hits.includes(p));
    setResult({ kind: "text", text, matches: [...hits, ...similar] });
  };

  const submit = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    try {
      const isbn = normalizeIsbn(q);
      if (isbn) await checkIsbn(isbn);
      else await checkText(q);
    } catch (e) {
      showError(e);
    }
  };

  const scan = async () => {
    try {
      const code = await scanIsbnBarcode();
      if (!code) return;
      const isbn = normalizeIsbn(code);
      if (!isbn) {
        showError(new Error("isbn"), "本のバーコード（978から始まる番号）を読み取れませんでした。もう一度お試しください。");
        return;
      }
      setQuery(formatIsbn(isbn));
      await checkIsbn(isbn);
    } catch (e) {
      showError(e);
    }
  };

  const register = (itemType: "book" | "ebook") => {
    if (result?.kind !== "isbn") return;
    setBookPrefill({ itemType, isbn: result.isbn, ...result.info });
    navigate("/new", { state: BACK_STATE });
  };

  return (
    <div className="page check-page">
      <header className="page-header">
        <button type="button" className="btn btn-ghost" onClick={goBack}>
          ‹ 戻る
        </button>
        <h1>これ持ってる？</h1>
        <span style={{ width: 56 }} />
      </header>

      <section className="check-search">
        {canScanBarcode() && (
          <button type="button" className="btn btn-primary btn-block check-scan" onClick={scan}>
            バーコードで調べる
          </button>
        )}
        <form
          className="search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(query);
          }}
        >
          <input
            type="search"
            className="input"
            enterKeyHint="search"
            placeholder="ISBN・書名・作品名・著者"
            aria-label="調べたい本や作品"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!query.trim()}>
            調べる
          </button>
        </form>
        {!result && (
          <p className="hint">
            本屋さんや手芸店で「これ買ったっけ？」と思ったら、本の裏のバーコードを読み取るか、書名を入力してください。登録している本・電子書籍・作品の中から探します。
          </p>
        )}
      </section>

      {result?.kind === "isbn" && (
        <section className="section check-result">
          {result.exact.length > 0 ? (
            <div className="verdict owned">
              <strong>持っています</strong>
              <span>同じ ISBN の本が登録されています。</span>
            </div>
          ) : result.looking ? (
            <div className="verdict pending">調べています…</div>
          ) : result.similar.length > 0 ? (
            <div className="verdict maybe">
              <strong>似た名前の本があります</strong>
              <span>同じ本かどうか、表紙や書名で確かめてください。</span>
            </div>
          ) : (
            <div className="verdict not-owned">
              <strong>まだ持っていません</strong>
              <span>
                {result.offline ? "（オフラインのため、ISBN で登録した本だけを確かめました）" : "登録している本・作品の中には見つかりませんでした。"}
              </span>
            </div>
          )}

          <ItemList items={[...result.exact, ...result.similar]} />

          {result.exact.length === 0 && !result.looking && (
            <div className="check-book">
              {result.info?.coverUrl && <img className="check-book-cover" src={result.info.coverUrl} alt="" />}
              <div className="check-book-info">
                <p className="check-book-title">{result.info?.title ?? "書名が見つかりませんでした"}</p>
                {result.info?.author && <p className="muted small">{result.info.author}</p>}
                {result.info?.publisher && <p className="muted small">{result.info.publisher}</p>}
                <p className="muted small">ISBN {formatIsbn(result.isbn)}</p>
              </div>
              <div className="check-book-actions">
                <button type="button" className="btn btn-primary" onClick={() => register("book")}>
                  本として登録
                </button>
                <button type="button" className="btn" onClick={() => register("ebook")}>
                  電子書籍として登録
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {result?.kind === "text" && (
        <section className="section check-result">
          {result.matches.length > 0 ? (
            <div className="verdict owned">
              <strong>{result.matches.length}件 見つかりました</strong>
              <span>「{result.text}」に当てはまる本・作品です。</span>
            </div>
          ) : (
            <div className="verdict not-owned">
              <strong>見つかりませんでした</strong>
              <span>「{result.text}」に当てはまる本・作品は登録されていません。</span>
            </div>
          )}
          <ItemList items={result.matches} />
        </section>
      )}

      {result && (
        <button
          type="button"
          className="btn btn-block"
          onClick={() => {
            setResult(null);
            setQuery("");
          }}
        >
          ほかのものを調べる
        </button>
      )}
    </div>
  );
}

function ItemList({ items }: { items: Pattern[] }) {
  if (!items.length) return null;
  return (
    <ul className="check-items">
      {items.map((p) => (
        <li key={p.id}>
          <Link to={`/patterns/${p.id}`} state={BACK_STATE} className="row">
            <Cover pattern={p} className="row-thumb" />
            <div className="row-body">
              <div className="row-title">{p.title}</div>
              <div className="row-sub">
                <span>{ITEM_TYPE_LABELS[itemTypeOf(p)]}</span>
                {p.author && <span>{p.author}</span>}
                {p.isbn && <span>ISBN {formatIsbn(p.isbn)}</span>}
              </div>
              <div className="row-meta">
                <ItemBadge pattern={p} />
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
