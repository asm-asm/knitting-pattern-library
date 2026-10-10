// iOS アプリ用：ファイル実体をアプリ専用フォルダ（Library/knitting-library/blobs）に保存する。
// Library フォルダは iOS が容量不足時に削除する対象ではなく、iCloud バックアップにも含まれる。
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import type { BlobStore } from "./blobStore";
import { sniffType } from "./blobStore";

export const NATIVE_ROOT = "knitting-library";
const DIR = Directory.Library;
const path = (id: string) => `${NATIVE_ROOT}/blobs/${id}`;
// base64 の区切りを揃えるため 3 の倍数
const CHUNK = 3 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class NativeBlobStore implements BlobStore {
  async put(id: string, data: ArrayBuffer) {
    const bytes = new Uint8Array(data);
    const tmp = path(id) + ".part";
    // 大きな PDF でもメモリを使いすぎないよう、少しずつ書き込む
    for (let offset = 0; offset < bytes.length || offset === 0; offset += CHUNK) {
      const chunk = toBase64(bytes.subarray(offset, offset + CHUNK));
      if (offset === 0) await Filesystem.writeFile({ path: tmp, data: chunk, directory: DIR, recursive: true });
      else await Filesystem.appendFile({ path: tmp, data: chunk, directory: DIR });
      if (bytes.length === 0) break;
    }
    // 書き込みが終わってから正式な名前にする（途中で止まっても壊れたファイルを読まない）
    await Filesystem.deleteFile({ path: path(id), directory: DIR }).catch(() => undefined);
    await Filesystem.rename({ from: tmp, to: path(id), directory: DIR, toDirectory: DIR });
  }

  async get(id: string) {
    try {
      const { uri } = await Filesystem.getUri({ path: path(id), directory: DIR });
      const res = await fetch(Capacitor.convertFileSrc(uri));
      if (!res.ok) return undefined;
      const buf = await res.arrayBuffer();
      return new Blob([buf], { type: sniffType(new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024))) });
    } catch {
      return undefined;
    }
  }

  async has(id: string) {
    try {
      await Filesystem.stat({ path: path(id), directory: DIR });
      return true;
    } catch {
      return false;
    }
  }

  async delete(ids: string[]) {
    for (const id of ids) await Filesystem.deleteFile({ path: path(id), directory: DIR }).catch(() => undefined);
  }

  async clear() {
    await Filesystem.rmdir({ path: `${NATIVE_ROOT}/blobs`, directory: DIR, recursive: true }).catch(() => undefined);
  }
}
