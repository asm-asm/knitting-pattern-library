// 「戻る」の扱いを統一する。
// 親画面から開いたとき（state.back）だけ履歴を1つ戻り、それ以外は親画面に「置き換え」で移動する。
// 親画面を履歴に積み増さないので、作品詳細とPDFを行き来しても戻るがループしない。
import { useLocation, useNavigate } from "react-router-dom";

/** 子画面へ移動するときに付ける state（戻るで履歴を戻ってよい印） */
export const BACK_STATE = { back: true } as const;

export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = (location.state as { back?: boolean } | null)?.back === true;
  return () => (canGoBack ? navigate(-1) : navigate(fallback, { replace: true }));
}
