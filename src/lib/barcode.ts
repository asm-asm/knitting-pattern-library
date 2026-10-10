// 本の裏のバーコード（ISBN）をカメラで読み取る（iOS アプリのみ）
import { registerPlugin } from "@capacitor/core";
import { UserFacingError } from "../db/repo";
import { isNativeApp } from "./native";

interface BarcodeScannerPlugin {
  scan(): Promise<{ value?: string; cancelled?: boolean }>;
}

const BarcodeScanner = registerPlugin<BarcodeScannerPlugin>("BarcodeScanner");

export function canScanBarcode(): boolean {
  return isNativeApp();
}

/** 読み取った番号を返す。キャンセルしたときは undefined。 */
export async function scanIsbnBarcode(): Promise<string | undefined> {
  try {
    const r = await BarcodeScanner.scan();
    return r.value;
  } catch (e) {
    if ((e as { code?: string })?.code === "DENIED") {
      throw new UserFacingError("カメラの使用が許可されていません。iPhone の「設定」→「編み図ライブラリ」→「カメラ」をオンにしてください。ISBN を手入力することもできます。");
    }
    throw new UserFacingError("カメラを起動できませんでした。ISBN を手入力してください。");
  }
}
