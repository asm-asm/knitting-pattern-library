import { Paywall } from "../components/Paywall";
import { useGoBack } from "../hooks/navigation";

/** 設定から開くプレミアムの案内 */
export default function Premium() {
  const goBack = useGoBack("/settings");
  return (
    <div className="page form">
      <header className="page-header">
        <button type="button" className="btn btn-ghost" onClick={goBack}>
          ‹ 戻る
        </button>
        <h1>プレミアム</h1>
        <span style={{ width: 56 }} />
      </header>
      <Paywall reason="info" onClose={goBack} />
    </div>
  );
}
