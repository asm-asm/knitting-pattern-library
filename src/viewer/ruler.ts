// 編み図の定規（行マーカー）の位置計算。DOM に依存しない純粋関数。
import type { RulerState } from "../db/types";

export const RULER_DEFAULT_HEIGHT = 0.035;
export const RULER_MIN_HEIGHT = 0.01;
export const RULER_MAX_HEIGHT = 0.25;

/** 帯がページからはみ出さないようにする */
export function clampRuler(r: RulerState): RulerState {
  const height = Math.min(RULER_MAX_HEIGHT, Math.max(RULER_MIN_HEIGHT, r.height));
  const y = Math.min(1 - height / 2, Math.max(height / 2, r.y));
  return { ...r, height, y };
}

/**
 * 段を進める。編み図は下から上へ読むので、rows が正なら上へ動く。
 * 1段＝帯の太さ。
 */
export function stepRuler(r: RulerState, rows: number): RulerState {
  return clampRuler({ ...r, y: r.y - rows * r.height });
}

/** 太さを変える（中心は保つ） */
export function resizeRuler(r: RulerState, factor: number): RulerState {
  return clampRuler({ ...r, height: r.height * factor });
}

export function newRuler(page: number, y: number): RulerState {
  return clampRuler({ page, y, height: RULER_DEFAULT_HEIGHT, visible: true });
}
