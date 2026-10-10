import { useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { ITEM_TYPE_LABELS, itemTypeOf, type ItemType, type Pattern, type PatternStatus } from "../db/types";
import { UserFacingError, type PatternInput } from "../db/repo";
import { lookupBook } from "../lib/bookLookup";
import { canScanBarcode, scanIsbnBarcode } from "../lib/barcode";
import { formatIsbn, normalizeIsbn } from "../lib/isbn";
import { CURRENCIES } from "../lib/format";
import { CategoryPicker, StatusPicker, TagInput } from "../components/Inputs";
import { useFeedback } from "../components/Feedback";
import { canFetchUrlInfo, fetchPageInfo } from "../lib/fetchUrl";
import type { PageInfo } from "../lib/urlInfo";

export interface FormValues {
  title: string;
  status: PatternStatus;
  favorite: boolean;
  categoryIds: string[];
  tags: string[];
  purchaseUrl: string;
  shopName: string;
  designer: string;
  purchaseDate: string;
  price: string;
  currency: string;
  yarn: string;
  needles: string;
  size: string;
  gauge: string;
  difficulty: string;
  notes: string;
  itemType: ItemType;
  author: string;
  publisher: string;
  isbn: string;
  ebookUrl: string;
  sourceBookId: string;
  sourcePage: string;
}

export function emptyValues(itemType: ItemType = "pattern"): FormValues {
  return {
    itemType,
    author: "",
    publisher: "",
    isbn: "",
    ebookUrl: "",
    sourceBookId: "",
    sourcePage: "",
    title: "",
    status: "want",
    favorite: false,
    categoryIds: [],
    tags: [],
    purchaseUrl: "",
    shopName: "",
    designer: "",
    purchaseDate: "",
    price: "",
    currency: "JPY",
    yarn: "",
    needles: "",
    size: "",
    gauge: "",
    difficulty: "",
    notes: "",
  };
}

export function valuesFromPattern(p: Pattern): FormValues {
  return {
    itemType: itemTypeOf(p),
    author: p.author ?? "",
    publisher: p.publisher ?? "",
    isbn: p.isbn ? formatIsbn(p.isbn) : "",
    ebookUrl: p.ebookUrl ?? "",
    sourceBookId: p.sourceBookId ?? "",
    sourcePage: p.sourcePage ?? "",
    title: p.title,
    status: p.status,
    favorite: p.favorite,
    categoryIds: p.categoryIds,
    tags: p.tags,
    purchaseUrl: p.purchaseUrl ?? "",
    shopName: p.shopName ?? "",
    designer: p.designer ?? "",
    purchaseDate: p.purchaseDate ?? "",
    price: p.price === undefined ? "" : String(p.price),
    currency: p.currency ?? "JPY",
    yarn: p.yarn ?? "",
    needles: p.needles ?? "",
    size: p.size ?? "",
    gauge: p.gauge ?? "",
    difficulty: p.difficulty ?? "",
    notes: p.notes ?? "",
  };
}

const opt = (s: string) => (s.trim() ? s.trim() : undefined);

export function valuesToInput(v: FormValues): PatternInput {
  const priceStr = v.price.replace(/[,，\s]/g, "").normalize("NFKC");
  return {
    title: v.title,
    status: v.status,
    favorite: v.favorite,
    categoryIds: v.categoryIds,
    tags: v.tags,
    purchaseUrl: opt(v.purchaseUrl),
    shopName: opt(v.shopName),
    designer: opt(v.designer),
    purchaseDate: opt(v.purchaseDate),
    price: priceStr ? Number(priceStr) : undefined,
    currency: priceStr ? v.currency : undefined,
    yarn: opt(v.yarn),
    needles: opt(v.needles),
    size: opt(v.size),
    gauge: opt(v.gauge),
    difficulty: opt(v.difficulty),
    notes: opt(v.notes),
    itemType: v.itemType === "pattern" ? undefined : v.itemType,
    author: opt(v.author),
    publisher: opt(v.publisher),
    isbn: opt(v.isbn),
    ebookUrl: v.itemType === "ebook" ? opt(v.ebookUrl) : undefined,
    sourceBookId: v.itemType === "pattern" ? opt(v.sourceBookId) : undefined,
    sourcePage: v.itemType === "pattern" && v.sourceBookId ? opt(v.sourcePage) : undefined,
  };
}

/** URL の末尾からタイトル候補を作る（通信は行わない） */
export function titleFromUrl(url: string): string | undefined {
  try {
    const u = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (!seg) return undefined;
    const t = decodeURIComponent(seg).replace(/\.[a-z0-9]+$/i, "").replace(/[-_+]+/g, " ").trim();
    return t && !/^\d+$/.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

function shopFromUrl(url: string): string | undefined {
  try {
    return new URL(/^https?:/i.test(url) ? url : `https://${url}`).host.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function PatternFields({
  values,
  onChange,
  extraBasic,
  onUrlInfo,
  autoFetch = false,
  replaceableTitle,
  onCoverUrl,
}: {
  values: FormValues;
  onChange: (v: FormValues) => void;
  /** 基本情報の下に差し込む（新規登録時のファイル選択など） */
  extraBasic?: ReactNode;
  /** URL から情報を読み込んだとき（表紙画像の取得などに使う） */
  onUrlInfo?: (info: PageInfo) => void;
  /** URL を入力したら自動で読み込む */
  autoFetch?: boolean;
  /** このタイトル（ファイル名から自動で入れたもの）なら URL の情報で置き換えてよい */
  replaceableTitle?: string;
  /** 本の情報から表紙画像の URL が見つかったとき */
  onCoverUrl?: (url: string) => void;
}) {
  const categories = useLiveQuery(() => db.categories.orderBy("order").toArray(), []) ?? [];
  const { toast, showError } = useFeedback();
  // 通信を待っている間に入力された内容を消さないよう、最新の値を参照する
  const latest = useRef(values);
  latest.current = values;
  const update = (v: FormValues) => {
    latest.current = v;
    onChange(v);
  };
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => update({ ...latest.current, [k]: v });
  const [openDetails, setOpenDetails] = useState(
    () => !!(values.designer || values.shopName || values.price || values.yarn || values.needles),
  );
  const [fetching, setFetching] = useState(false);
  const fetchedUrl = useRef<string | null>(null);
  const canFetch = canFetchUrlInfo();

  const loadFromUrl = async (silent = false) => {
    const url = latest.current.purchaseUrl.trim();
    if (!url || fetching) return;
    fetchedUrl.current = url;
    setFetching(true);
    try {
      const info = await fetchPageInfo(url);
      const v = { ...latest.current };
      const filled: string[] = [];
      // 入力済みの項目は上書きしない
      const fill = (k: "title" | "designer" | "shopName" | "yarn" | "needles" | "size" | "gauge", val: string | undefined, label: string) => {
        if (val && !v[k].trim()) {
          v[k] = val;
          filled.push(label);
        }
      };
      if (info.title && replaceableTitle && v.title === replaceableTitle) v.title = "";
      fill("title", info.title, "タイトル");
      fill("designer", info.designer, "デザイナー");
      fill("shopName", info.shopName, "ショップ名");
      if (info.price !== undefined && !v.price.trim()) {
        v.price = String(info.price);
        if (info.currency && CURRENCIES.includes(info.currency)) v.currency = info.currency;
        filled.push("価格");
      }
      fill("yarn", info.yarn, "糸");
      fill("needles", info.needles, "針");
      fill("gauge", info.gauge, "ゲージ");
      fill("size", info.size, "サイズ");
      if (!v.categoryIds.length) {
        const ids = categories.filter((c) => info.categoryHints.includes(c.name)).map((c) => c.id);
        if (ids.length) {
          v.categoryIds = ids;
          filled.push("カテゴリ");
        }
      }
      update(v);
      if (filled.some((x) => x !== "タイトル")) setOpenDetails(true);
      onUrlInfo?.(info);
      if (filled.length) toast(`URLから読み込みました：${filled.join("・")}${info.imageUrl ? "・画像" : ""}`);
      else if (!silent) toast(info.imageUrl ? "URLから画像を読み込みました" : "新しく入力できる情報は見つかりませんでした");
    } catch (e) {
      showError(e, "URLから情報を読み込めませんでした。手入力してください。");
    } finally {
      setFetching(false);
    }
  };
  const maybeAutoFetch = () => {
    const url = latest.current.purchaseUrl.trim();
    if (autoFetch && canFetch && /^(https?:\/\/)?[^\s/]+\.[^\s]+/.test(url) && fetchedUrl.current !== url) void loadFromUrl(true);
  };
  const suggestion = values.purchaseUrl && !values.title ? titleFromUrl(values.purchaseUrl) : undefined;
  const isBook = values.itemType !== "pattern";
  const books = useLiveQuery(() => db.patterns.filter((p) => p.itemType === "book" || p.itemType === "ebook").sortBy("title"), []) ?? [];

  // ---- 本：ISBN から書誌情報を読み込む ----
  const [looking, setLooking] = useState(false);
  const lookupIsbn = async (raw: string) => {
    const isbn = normalizeIsbn(raw);
    if (!isbn) {
      showError(new UserFacingError("ISBN の番号が正しくありません。本の裏にある「978」または「979」から始まる13桁の番号を確認してください。"));
      return;
    }
    setLooking(true);
    try {
      const info = await lookupBook(isbn);
      const v = { ...latest.current, isbn: formatIsbn(isbn) };
      if (!info) {
        update(v);
        toast("この ISBN の本の情報が見つかりませんでした。書名などを手入力してください。", "error");
        return;
      }
      const filled: string[] = [];
      if (info.title && (!v.title.trim() || v.title === replaceableTitle)) {
        v.title = info.title;
        filled.push("書名");
      }
      if (info.author && !v.author.trim()) {
        v.author = info.author;
        filled.push("著者");
      }
      if (info.publisher && !v.publisher.trim()) {
        v.publisher = info.publisher;
        filled.push("出版社");
      }
      update(v);
      if (info.coverUrl) onCoverUrl?.(info.coverUrl);
      toast(filled.length ? `本の情報を読み込みました：${filled.join("・")}${info.coverUrl ? "・表紙" : ""}` : "入力済みのため、新しく入れる項目はありませんでした");
    } catch (e) {
      showError(e, "本の情報を読み込めませんでした。手入力してください。");
    } finally {
      setLooking(false);
    }
  };
  // ---- 電子書籍：ストアのページ（Kindle・honto・BOOK☆WALKER など）から読み込む ----
  const [loadingEbook, setLoadingEbook] = useState(false);
  const ebookFetched = useRef<string | null>(null);
  const loadEbook = async (silent = false) => {
    const url = latest.current.ebookUrl.trim();
    if (!url || loadingEbook) return;
    ebookFetched.current = url;
    setLoadingEbook(true);
    try {
      const info = await fetchPageInfo(url);
      const v = { ...latest.current };
      const filled: string[] = [];
      const fill = (k: "title" | "author" | "publisher" | "shopName", val: string | undefined, label: string) => {
        if (val && !v[k].trim()) {
          v[k] = val;
          filled.push(label);
        }
      };
      if (info.title && replaceableTitle && v.title === replaceableTitle) v.title = "";
      fill("title", info.title, "書名");
      fill("author", info.author, "著者");
      fill("publisher", info.publisher, "出版社");
      fill("shopName", info.shopName, "ストア");
      if (info.price !== undefined && !v.price.trim()) {
        v.price = String(info.price);
        if (info.currency && CURRENCIES.includes(info.currency)) v.currency = info.currency;
        filled.push("価格");
      }
      if (info.isbn && !v.isbn.trim()) {
        v.isbn = formatIsbn(info.isbn);
        filled.push("ISBN");
      }
      let coverUrl = info.imageUrl;
      // ページに ISBN があれば、本のデータベースで著者などを補う
      if (info.isbn && (!v.author.trim() || !v.publisher.trim() || !coverUrl)) {
        const book = await lookupBook(info.isbn).catch(() => undefined);
        if (book) {
          fill("author", book.author, "著者");
          fill("publisher", book.publisher, "出版社");
          coverUrl ??= book.coverUrl;
        }
      }
      update(v);
      if (coverUrl) onCoverUrl?.(coverUrl);
      if (filled.some((x) => x === "ストア" || x === "価格")) setOpenDetails(true);
      if (filled.length || coverUrl) toast(`URLから読み込みました：${[...filled, ...(coverUrl ? ["表紙"] : [])].join("・")}`);
      else if (!silent) toast("このページからは情報を読み込めませんでした。書名などを手入力してください。", "error");
    } catch (e) {
      showError(e, "URLから情報を読み込めませんでした。書名などを手入力してください。");
    } finally {
      setLoadingEbook(false);
    }
  };
  const maybeLoadEbook = () => {
    const url = latest.current.ebookUrl.trim();
    if (canFetch && /^(https?:\/\/)?[^\s/]+\.[^\s]+/.test(url) && ebookFetched.current !== url) void loadEbook(true);
  };

  const scan = async () => {
    try {
      const code = await scanIsbnBarcode();
      if (code) {
        set("isbn", code);
        await lookupIsbn(code);
      }
    } catch (e) {
      showError(e);
    }
  };

  return (
    <>
      <section className="form-section">
        {values.itemType === "ebook" && (
          <Field
            label="電子書籍のURL"
            htmlFor="f-ebook"
            hint={
              canFetch
                ? "Kindle・honto・BOOK☆WALKER などの作品ページのURLを貼ると、書名・著者・表紙を読み込みます。登録後は、作品の画面からこのページをワンタップで開けます。"
                : "Kindle などの作品ページのURL。作品の画面からワンタップで開けます（ブラウザ版では情報の読み込みはできません）。"
            }
          >
            <input
              id="f-ebook"
              className="input"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="https://"
              value={values.ebookUrl}
              onChange={(e) => set("ebookUrl", e.target.value)}
              onPaste={() => setTimeout(maybeLoadEbook, 0)}
              onBlur={maybeLoadEbook}
            />
            {canFetch && values.ebookUrl.trim() && (
              <button type="button" className="btn btn-small btn-accent suggest" disabled={loadingEbook} onClick={() => loadEbook()}>
                {loadingEbook ? "読み込み中…" : "URLから情報を読み込む"}
              </button>
            )}
          </Field>
        )}
        {isBook && (
          <Field
            label={values.itemType === "ebook" ? "ISBN（任意）" : "ISBN（本の裏の13桁の番号）"}
            htmlFor="f-isbn"
            hint={
              canScanBarcode()
                ? "バーコードを読み取るか番号を入力すると、書名・著者・表紙を読み込みます。"
                : "番号を入力して「読み込む」を押すと、書名・著者を読み込みます。"
            }
          >
            <div className="price-row">
              <input id="f-isbn" className="input" inputMode="numeric" placeholder="978-" value={values.isbn} onChange={(e) => set("isbn", e.target.value)} />
              <button type="button" className="btn" disabled={looking || !values.isbn.trim()} onClick={() => lookupIsbn(values.isbn)}>
                {looking ? "読み込み中…" : "読み込む"}
              </button>
            </div>
            {canScanBarcode() && (
              <button type="button" className="btn btn-accent btn-block suggest" disabled={looking} onClick={scan}>
                バーコードを読み取る
              </button>
            )}
          </Field>
        )}
        <Field label={isBook ? "書名（必須）" : "作品タイトル（必須）"} htmlFor="f-title">
          <input id="f-title" className="input" value={values.title} onChange={(e) => set("title", e.target.value)} required />
        </Field>
        {isBook && (
          <div className="grid-2">
            <Field label="著者" htmlFor="f-author">
              <input id="f-author" className="input" value={values.author} onChange={(e) => set("author", e.target.value)} />
            </Field>
            <Field label="出版社" htmlFor="f-publisher">
              <input id="f-publisher" className="input" value={values.publisher} onChange={(e) => set("publisher", e.target.value)} />
            </Field>
          </div>
        )}
        {values.itemType !== "ebook" && (
        <Field
          label="購入先URL"
          htmlFor="f-url"
          hint={
            isBook
              ? undefined
              : canFetch
                ? "URLを入力すると、タイトル・画像・購入情報などを読み込みます（入力済みの項目は上書きしません）。"
                : "ブラウザ版ではURLから情報を読み込めません。必要な情報は手入力してください。"
          }
        >
          <input
            id="f-url"
            className="input"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://"
            value={values.purchaseUrl}
            onChange={(e) => set("purchaseUrl", e.target.value)}
            onPaste={() => {
              if (!isBook) setTimeout(maybeAutoFetch, 0);
            }}
            onBlur={() => {
              if ((isBook || !canFetch) && values.purchaseUrl && !values.shopName) {
                const shop = shopFromUrl(values.purchaseUrl);
                if (shop) set("shopName", shop);
              }
              if (!isBook) maybeAutoFetch();
            }}
          />
          {!isBook && canFetch && values.purchaseUrl.trim() && (
            <button type="button" className="btn btn-small btn-accent suggest" disabled={fetching} onClick={() => loadFromUrl()}>
              {fetching ? "読み込み中…" : "URLから情報を読み込む"}
            </button>
          )}
          {suggestion && !canFetch && !isBook && (
            <button type="button" className="btn btn-small suggest" onClick={() => set("title", suggestion)}>
              タイトルに「{suggestion}」を使う
            </button>
          )}
        </Field>
        )}
        {extraBasic}
        {!isBook && (
          <Field label="制作ステータス">
            <StatusPicker value={values.status} onChange={(s) => set("status", s)} />
          </Field>
        )}
        {!isBook && books.length > 0 && (
          <Field label="掲載している本（任意）" htmlFor="f-book" hint="本に載っている作品なら、本を選ぶと作品と本を結び付けられます。">
            <div className="price-row">
              <select id="f-book" className="select grow" value={values.sourceBookId} onChange={(e) => set("sourceBookId", e.target.value)}>
                <option value="">選ばない</option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {ITEM_TYPE_LABELS[itemTypeOf(b)]}：{b.title}
                  </option>
                ))}
              </select>
              {values.sourceBookId && (
                <input className="input page-input" placeholder="ページ" aria-label="掲載ページ" value={values.sourcePage} onChange={(e) => set("sourcePage", e.target.value)} />
              )}
            </div>
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={values.favorite} onChange={(e) => set("favorite", e.target.checked)} />
          お気に入りに追加
        </label>
        <Field label="カテゴリ">
          <CategoryPicker categories={categories} value={values.categoryIds} onChange={(v) => set("categoryIds", v)} />
        </Field>
        <Field label="タグ" hint="Enter または読点で区切って追加できます。">
          <TagInput value={values.tags} onChange={(v) => set("tags", v)} />
        </Field>
      </section>

      <details className="form-section" open={openDetails} onToggle={(e) => setOpenDetails(e.currentTarget.open)}>
        <summary>{isBook ? "購入情報" : "購入情報・編み物の詳細"}</summary>
        <div className="grid-2">
          {!isBook && (
            <Field label="デザイナー" htmlFor="f-designer">
              <input id="f-designer" className="input" value={values.designer} onChange={(e) => set("designer", e.target.value)} />
            </Field>
          )}
          <Field label="ショップ名" htmlFor="f-shop">
            <input id="f-shop" className="input" value={values.shopName} onChange={(e) => set("shopName", e.target.value)} />
          </Field>
          <Field label="購入日" htmlFor="f-date">
            <input id="f-date" className="input" type="date" value={values.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
          </Field>
          <Field label="購入価格" htmlFor="f-price">
            <div className="price-row">
              <input
                id="f-price"
                className="input"
                inputMode="decimal"
                value={values.price}
                onChange={(e) => set("price", e.target.value)}
              />
              <select className="select" aria-label="通貨" value={values.currency} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </Field>
          {!isBook && (
            <>
          <Field label="使用糸" htmlFor="f-yarn">
            <input id="f-yarn" className="input" value={values.yarn} onChange={(e) => set("yarn", e.target.value)} />
          </Field>
          <Field label="使用針" htmlFor="f-needles">
            <input id="f-needles" className="input" placeholder="例：4.0mm 輪針" value={values.needles} onChange={(e) => set("needles", e.target.value)} />
          </Field>
          <Field label="サイズ" htmlFor="f-size">
            <input id="f-size" className="input" value={values.size} onChange={(e) => set("size", e.target.value)} />
          </Field>
          <Field label="ゲージ" htmlFor="f-gauge">
            <input id="f-gauge" className="input" placeholder="例：22目×30段 / 10cm" value={values.gauge} onChange={(e) => set("gauge", e.target.value)} />
          </Field>
          <Field label="難易度" htmlFor="f-diff">
            <input id="f-diff" className="input" placeholder="例：中級" value={values.difficulty} onChange={(e) => set("difficulty", e.target.value)} />
          </Field>
            </>
          )}
        </div>
      </details>

      <section className="form-section">
        <Field label="メモ" htmlFor="f-notes">
          <textarea id="f-notes" className="input textarea" rows={4} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </section>
    </>
  );
}
