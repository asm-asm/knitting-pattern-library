// 選択されたファイルを読み込み、登録用データに変換する（端末内で完結）
import { UserFacingError, isPdfData, isPdfFile, type ImageInput, type NewFileInput } from "../db/repo";
import type { PendingFile } from "../components/Inputs";
import { inspectPdf } from "./pdf";

export interface PreparedFiles {
  inputs: NewFileInput[];
  /** 表紙用に生成した PDF 1ページ目の画像 */
  thumbnail?: ImageInput;
  warnings: string[];
}

export async function prepareFiles(pending: PendingFile[], opts: { thumbnail: boolean }): Promise<PreparedFiles> {
  const inputs: NewFileInput[] = [];
  const warnings: string[] = [];
  let thumbnail: ImageInput | undefined;

  for (const p of pending) {
    let data: ArrayBuffer;
    try {
      data = await p.file.arrayBuffer();
    } catch {
      throw new UserFacingError(`「${p.file.name}」を読み込めませんでした。ファイルの場所を確認して、もう一度選び直してください。`);
    }
    const mimeType = p.file.type || (p.file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    const input: NewFileInput = { name: p.file.name, kind: p.kind, mimeType, data };

    if (isPdfFile(input)) {
      if (!isPdfData(data)) {
        throw new UserFacingError(`「${p.file.name}」はPDFとして読み込めません。ファイルが壊れていないか確認してください。`);
      }
      const info = await inspectPdf(data, { thumbnail: opts.thumbnail && !thumbnail });
      input.pageCount = info.pageCount;
      if (info.encrypted) warnings.push(`「${p.file.name}」はパスワード付きPDFです。開くときにパスワードが必要です。`);
      if (info.thumbnail) thumbnail = { type: info.thumbnail.type, data: await info.thumbnail.arrayBuffer() };
    }
    inputs.push(input);
  }
  return { inputs, thumbnail, warnings };
}

export async function readImage(file: File): Promise<ImageInput> {
  if (!file.type.startsWith("image/")) throw new UserFacingError("表紙には画像ファイル（PNG・JPEG）を選んでください。");
  return { type: file.type, data: await file.arrayBuffer() };
}

/** 保存領域を「永続」にするよう依頼する（ブラウザによる自動削除を防ぐ。許可されない場合もある） */
export async function requestPersistentStorage(): Promise<boolean | undefined> {
  try {
    if (!navigator.storage?.persist) return undefined;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return undefined;
  }
}
