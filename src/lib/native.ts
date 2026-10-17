// iOS アプリ（Capacitor）固有の処理。ブラウザ版では何もしない。
import { Capacitor, registerPlugin } from "@capacitor/core";

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

// ---- ファイルの書き出し（共有シート）：バックアップや PDF の共有に使う ----

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

/** Blob を端末の一時フォルダ（Caches）に書き出し、file:// の URI を返す */
async function writeCacheFile(blob: Blob, path: string): Promise<string> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  // 大きなバックアップでもメモリを使いすぎないよう、少しずつ書き込む（3の倍数で base64 の区切りを揃える）
  const CHUNK = 3 * 1024 * 1024;
  for (let offset = 0; offset < blob.size || offset === 0; offset += CHUNK) {
    const data = toBase64(new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer()));
    if (offset === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    if (blob.size === 0) break;
  }
  return (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
}

async function deleteCacheFiles(paths: string[]) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  for (const path of paths) await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
}

/** 一時ファイルに書き出して共有シートを開く（「"ファイル"に保存」などを選べる） */
export async function shareFileNative(blob: Blob, filename: string): Promise<"shared" | "cancelled"> {
  const { Share } = await import("@capacitor/share");
  // 共有用の一時ファイル（共有が終わったら削除する）
  const path = `share/${filename}`;
  const uri = await writeCacheFile(blob, path);
  try {
    await Share.share({ title: filename, files: [uri] });
    return "shared";
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return "cancelled";
    throw e;
  } finally {
    void deleteCacheFiles([path]);
  }
}

// ---- 印刷（iOS の印刷画面。AirPrint 対応プリンタや「PDFとして保存」を選べる） ----

interface PrinterPlugin {
  print(options: { urls: string[]; jobName: string }): Promise<{ completed: boolean }>;
}
const Printer = registerPlugin<PrinterPlugin>("Printer");

/** PDF や画像（1ページ1ファイル）を印刷画面に渡す。印刷したら true */
export async function printFilesNative(files: { blob: Blob; name: string }[], jobName: string): Promise<boolean> {
  const dir = `print/${Date.now()}`;
  const paths: string[] = [];
  try {
    const urls: string[] = [];
    for (const [i, f] of files.entries()) {
      const path = `${dir}/${String(i + 1).padStart(3, "0")}-${f.name}`;
      paths.push(path);
      urls.push(await writeCacheFile(f.blob, path));
    }
    const r = await Printer.print({ urls, jobName });
    return r.completed;
  } finally {
    void deleteCacheFiles(paths);
  }
}
