import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { countPatternsInCategory, createCategory, deleteCategory, moveCategory, renameCategory } from "../db/repo";
import type { Category } from "../db/types";
import { useFeedback } from "../components/Feedback";
import { formatBytes } from "../lib/format";
import { requestPersistentStorage } from "../lib/importFiles";
import { KEEP_AWAKE_KEY } from "../lib/settings";
import { BackupSettings } from "../components/BackupSettings";
import { PremiumSettings } from "../components/PremiumSettings";
import { isNativeApp } from "../lib/native";
import { snapshotLastSavedAt } from "../storage/init";
import { formatDateTime } from "../lib/format";
import { ExternalLinkButton } from "../components/Inputs";

const RAVELRY_JA_SEARCH_URL = "https://ravely-one.vercel.app/";

export default function Settings() {
  return (
    <div className="page settings">
      <header className="page-header">
        <h1>設定</h1>
      </header>
      <PremiumSettings />
      <LinkSection />
      <CategorySettings />
      <ViewerSettings />
      <BackupSettings />
      <StorageSettings />
      <PrivacyInfo />
    </div>
  );
}

function LinkSection() {
  return (
    <section className="section">
      <h2 className="section-title">編みたい作品を探す</h2>
      <div className="link-card">
        <div>
          <p className="link-card-title">Ravelry 日本語検索</p>
          <p className="hint">日本語のキーワードやタグで Ravelry のパターンを探せる検索ページです。</p>
        </div>
        <ExternalLinkButton
          url={RAVELRY_JA_SEARCH_URL}
          label="開く"
          pageName="Ravelry 日本語検索"
          className="btn btn-accent"
        />
      </div>
    </section>
  );
}

function CategorySettings() {
  const categories = useLiveQuery(() => db.categories.orderBy("order").toArray(), []);
  const { showError } = useFeedback();
  const [name, setName] = useState("");

  return (
    <section className="section">
      <h2 className="section-title">カテゴリ</h2>
      <p className="hint">カテゴリは制作ステータスとは別に、作品の種類などを自由に分類するためのものです。</p>
      <ul className="settings-list">
        {categories?.map((c, i) => (
          <CategoryRow key={c.id} category={c} first={i === 0} last={i === categories.length - 1} />
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await createCategory(name);
            setName("");
          } catch (err) {
            showError(err);
          }
        }}
      >
        <input className="input" placeholder="新しいカテゴリ名" value={name} onChange={(e) => setName(e.target.value)} aria-label="新しいカテゴリ名" />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          追加
        </button>
      </form>
    </section>
  );
}

function CategoryRow({ category, first, last }: { category: Category; first: boolean; last: boolean }) {
  const { confirm, showError } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);

  if (editing) {
    return (
      <li>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await renameCategory(category.id, name);
              setEditing(false);
            } catch (err) {
              showError(err);
            }
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="カテゴリ名" />
          <button type="submit" className="btn btn-primary btn-small">
            保存
          </button>
          <button type="button" className="btn btn-small" onClick={() => (setEditing(false), setName(category.name))}>
            取消
          </button>
        </form>
      </li>
    );
  }
  return (
    <li>
      <span className="settings-name">{category.name}</span>
      <div className="row-actions">
        <button type="button" className="icon-btn" disabled={first} aria-label="上へ" onClick={() => moveCategory(category.id, -1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" disabled={last} aria-label="下へ" onClick={() => moveCategory(category.id, 1)}>
          ↓
        </button>
        <button type="button" className="btn btn-small" onClick={() => setEditing(true)}>
          名前変更
        </button>
        <button
          type="button"
          className="btn btn-small btn-danger-text"
          onClick={async () => {
            const n = await countPatternsInCategory(category.id);
            const ok = await confirm({
              title: `カテゴリ「${category.name}」を削除しますか？`,
              message: n ? `${n}件の作品からこのカテゴリの設定が外れます。作品自体は削除されません。` : "このカテゴリを使っている作品はありません。",
              confirmLabel: "削除",
              danger: true,
            });
            if (ok) deleteCategory(category.id).catch((e) => showError(e));
          }}
        >
          削除
        </button>
      </div>
    </li>
  );
}

function ViewerSettings() {
  const [keepAwake, setKeepAwake] = useState(() => {
    try {
      return localStorage.getItem(KEEP_AWAKE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  return (
    <section className="section">
      <h2 className="section-title">編み図の閲覧</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={keepAwake}
          onChange={(e) => {
            setKeepAwake(e.target.checked);
            try {
              localStorage.setItem(KEEP_AWAKE_KEY, e.target.checked ? "1" : "0");
            } catch {
              /* 保存できない環境では今回のみ反映 */
            }
          }}
        />
        編み図を表示している間は画面を消灯しない
      </label>
      <p className="hint">対応していない端末・ブラウザでは、この設定は効きません。</p>
    </section>
  );
}

function StorageSettings() {
  const [estimate, setEstimate] = useState<StorageEstimate>();
  const [persisted, setPersisted] = useState<boolean>();
  const counts = useLiveQuery(async () => ({ patterns: await db.patterns.count(), files: await db.files.count() }), []);
  // iOS アプリ：移行待ちのファイル（以前の保存場所に残っている件数）
  const pendingMigration = useLiveQuery(() => db.blobs.count(), []);
  const native = isNativeApp();
  const lastSnapshot = snapshotLastSavedAt();
  const fileBytes = useLiveQuery(async () => {
    let total = 0;
    await db.files.each((f) => (total += f.size));
    return total;
  }, []);

  useEffect(() => {
    navigator.storage?.estimate?.().then(setEstimate).catch(() => undefined);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => undefined);
  }, [counts]);

  return (
    <section className="section">
      <h2 className="section-title">端末内のデータ</h2>
      <dl className="info-list">
        <div>
          <dt>登録作品</dt>
          <dd>{counts?.patterns ?? "…"}件</dd>
        </div>
        <div>
          <dt>ファイル</dt>
          <dd>
            {counts?.files ?? "…"}件（{fileBytes !== undefined ? formatBytes(fileBytes) : "…"}）
          </dd>
        </div>
        {estimate?.usage !== undefined && (
          <div>
            <dt>使用容量（目安）</dt>
            <dd>
              {formatBytes(estimate.usage)}
              {estimate.quota ? ` / 上限 ${formatBytes(estimate.quota)}` : ""}
            </dd>
          </div>
        )}
        {native ? (
          <>
            <div>
              <dt>PDFの保存場所</dt>
              <dd>
                アプリ専用フォルダ（iCloud バックアップの対象）
                {pendingMigration ? `・移行中 残り${pendingMigration}件` : ""}
              </dd>
            </div>
            <div>
              <dt>自動の控え</dt>
              <dd>{lastSnapshot ? `${formatDateTime(lastSnapshot)} に保存` : "準備中"}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>保存の永続化</dt>
            <dd>{persisted === undefined ? "この環境では確認できません" : persisted ? "有効" : "未許可"}</dd>
          </div>
        )}
      </dl>
      {!native && persisted === false && (
        <>
          <p className="hint">
            ブラウザで利用している場合、空き容量が少なくなるとブラウザがデータを削除することがあります。永続化を有効にすると、その可能性を減らせます（ブラウザが許可しない場合もあります）。
          </p>
          <button type="button" className="btn" onClick={async () => setPersisted(await requestPersistentStorage())}>
            保存の永続化をリクエスト
          </button>
        </>
      )}
      <div className="note-box">
        <p>
          <strong>データの削除について：</strong>
          作品やファイルは、それぞれの詳細画面から削除できます。すべてのデータを削除する場合は「バックアップと復元」の一番下から操作できます。アプリ（またはブラウザのサイトデータ）を削除すると、端末内のすべての作品・PDF・メモが消えます。消える前に完全バックアップを作成しておくと、別の端末やアプリの再インストール後に復元できます。
        </p>
      </div>
    </section>
  );
}

function PrivacyInfo() {
  return (
    <section className="section">
      <h2 className="section-title">プライバシー</h2>
      <ul className="bullets">
        <li>アカウント登録・ログインはありません。</li>
        <li>氏名・メールアドレスなどの個人情報は収集しません。</li>
        <li>編み図PDF・購入情報・メモは、この端末の中だけに保存され、外部のサーバーへ送信されません。</li>
        <li>広告や、利用状況を追跡する解析ツールは使用していません。</li>
        <li>インターネットに接続するのは、購入先URLを開くとき、入力した購入先URLのページから作品情報や表紙画像を読み込むときなど、利用者が操作した場合のみです。読み込んだ情報は端末内にだけ保存されます。</li>
      </ul>
    </section>
  );
}
