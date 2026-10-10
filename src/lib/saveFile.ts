// ファイルを端末の外へ出す（「ファイル」に保存・ほかのアプリで開く・送る）
import { isNativeApp, shareFileNative } from "./native";

/**
 * 作成したファイルを端末に保存する。
 * iOS などでは共有シート（「"ファイル"に保存」など）、それ以外はダウンロード。
 * 共有シートはタップ直後でないと開けないため、作成とは別のボタン操作から呼ぶ。
 */
export async function saveOrShareFile(blob: Blob, filename: string): Promise<"shared" | "downloaded" | "cancelled"> {
  // iOS アプリ：WebView ではダウンロードできないため、ネイティブの共有シートを使う
  if (isNativeApp()) return shareFileNative(blob, filename);
  const file = new File([blob], filename, { type: blob.type });
  const touch = navigator.maxTouchPoints > 0;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // 共有できない場合はダウンロードにフォールバック
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}
