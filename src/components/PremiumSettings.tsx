import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { useFeedback } from "./Feedback";
import { usePremium } from "./Paywall";
import { FREE_PATTERN_LIMIT, manageSubscriptions, restorePurchases } from "../lib/premium";
import { formatDate } from "../lib/format";
import { BACK_STATE } from "../hooks/navigation";

/** 設定画面のプレミアム欄（iOS アプリのみ） */
export function PremiumSettings() {
  const premium = usePremium();
  const count = useLiveQuery(() => db.patterns.count(), []);
  const { toast, showError } = useFeedback();
  if (!premium.enforced) return null;
  return (
    <section className="section">
      <h2 className="section-title">プレミアム</h2>
      <dl className="info-list">
        <div>
          <dt>ご利用中のプラン</dt>
          <dd>{premium.active ? "プレミアム（登録数 無制限）" : `無料版（作品${FREE_PATTERN_LIMIT}件まで）`}</dd>
        </div>
        <div>
          <dt>登録作品</dt>
          <dd>{premium.active ? `${count ?? "…"}件` : `${count ?? "…"} / ${FREE_PATTERN_LIMIT}件`}</dd>
        </div>
        {premium.active && premium.expiresAt && (
          <div>
            <dt>次回の自動更新</dt>
            <dd>{formatDate(premium.expiresAt)}</dd>
          </div>
        )}
      </dl>
      <div className="backup-actions">
        {!premium.active && (
          <Link to="/premium" state={BACK_STATE} className="btn btn-primary">
            プレミアムについて
          </Link>
        )}
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              const ok = await restorePurchases();
              toast(ok ? "購入を復元しました" : "復元できる購入が見つかりませんでした", ok ? "info" : "error");
            } catch (e) {
              showError(e, "購入を復元できませんでした。時間をおいてもう一度お試しください。");
            }
          }}
        >
          購入を復元する
        </button>
        <button type="button" className="btn" onClick={() => manageSubscriptions().catch((e) => showError(e, "サブスクリプションの管理画面を開けませんでした。"))}>
          サブスクリプションを管理（解約など）
        </button>
      </div>
    </section>
  );
}
