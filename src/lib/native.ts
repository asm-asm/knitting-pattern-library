// iOS アプリ（Capacitor）固有の処理。ブラウザ版では何もしない。
import { Capacitor } from "@capacitor/core";

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

// ---- 共有メニュー・「ファイル」アプリから受け取ったファイル ----
// iOS は受け取ったファイルをアプリ内の Documents/Inbox にコピーし、file:// URL で知らせてくる。

let incoming: File[] = [];
const listeners = new Set<() => void>();

export function peekIncomingFiles(): File[] {
  return incoming;
}

export function clearIncomingFiles() {
  incoming = [];
  listeners.forEach((l) => l());
}

/** 受け取ったファイルを取り込み待ちに加える */
export function receiveFiles(files: File[]) {
  incoming = [...incoming, ...files];
  listeners.forEach((l) => l());
}

export function subscribeIncomingFiles(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

const EXT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function fileNameFromUrl(url: string): string {
  const last = url.split("?")[0].split("/").filter(Boolean).pop() ?? "file.pdf";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

async function readIncomingFile(url: string): Promise<File> {
  const name = fileNameFromUrl(url);
  const res = await fetch(Capacitor.convertFileSrc(url));
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  const blob = await res.blob();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return new File([blob], name, { type: EXT_TYPES[ext] ?? blob.type });
}

/** 受け取りの待ち受けを開始する。ファイルを受け取ったら onReceive を呼ぶ。 */
export async function startIncomingFileListener(onReceive: () => void, onError: () => void) {
  if (!isNativeApp()) return () => {};
  const { App } = await import("@capacitor/app");
  const handle = await App.addListener("appUrlOpen", async ({ url }) => {
    if (!url.startsWith("file:")) return;
    try {
      const file = await readIncomingFile(url);
      receiveFiles([file]);
      onReceive();
    } catch (e) {
      console.warn(e);
      onError();
    } finally {
      // Inbox のコピーは不要になったら削除する（データは IndexedDB に取り込む）
      import("@capacitor/filesystem")
        .then(({ Filesystem }) => Filesystem.deleteFile({ path: url }))
        .catch(() => undefined);
    }
  });
  return () => void handle.remove();
}

// ---- バックアップファイルの保存（共有シート） ----

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

/** 一時ファイルに書き出して共有シートを開く（「"ファイル"に保存」などを選べる） */
export async function shareFileNative(blob: Blob, filename: string): Promise<"shared" | "cancelled"> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  // 大きなバックアップでもメモリを使いすぎないよう、少しずつ書き込む（3の倍数で base64 の区切りを揃える）
  const CHUNK = 3 * 1024 * 1024;
  const path = `backup/${filename}`;
  for (let offset = 0; offset < blob.size || offset === 0; offset += CHUNK) {
    const data = toBase64(new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer()));
    if (offset === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    if (blob.size === 0) break;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: filename, files: [uri] });
    return "shared";
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return "cancelled";
    throw e;
  } finally {
    Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
  }
}
