// 手書き線の処理（座標はページ幅・高さに対する 0〜1 の割合）
import type { InkAnnotation } from "../db/types";

/** 線分 (ax,ay)-(bx,by) と点 (px,py) の距離。aspect = 高さ/幅 で縦方向の縮尺を補正する */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number, aspect: number) {
  const [Py, Ay, By] = [py * aspect, ay * aspect, by * aspect];
  const dx = bx - ax;
  const dy = By - Ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (Py - Ay) * dy) / len2)) : 0;
  const cx = ax + t * dx - px;
  const cy = Ay + t * dy - Py;
  return Math.sqrt(cx * cx + cy * cy);
}

/** 点 (x, y) に触れている線か（消しゴム用） */
export function hitsInk(a: Pick<InkAnnotation, "points" | "width">, x: number, y: number, aspect: number, tolerance = 0.015) {
  const p = a.points;
  const r = a.width / 2 + tolerance;
  if (p.length === 2) return segDist(x, y, p[0], p[1], p[0], p[1], aspect) <= r;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3], aspect) <= r) return true;
  }
  return false;
}

/** SVG path（viewBox は 幅1000 × 高さ1000*aspect） */
export function inkPath(points: number[], aspect: number): string {
  if (points.length < 2) return "";
  const H = 1000 * aspect;
  let d = `M${(points[0] * 1000).toFixed(1)} ${(points[1] * H).toFixed(1)}`;
  if (points.length === 2) return d + "l0.01 0";
  for (let i = 2; i + 1 < points.length; i += 2) d += `L${(points[i] * 1000).toFixed(1)} ${(points[i + 1] * H).toFixed(1)}`;
  return d;
}

export const INK_COLORS = [
  { value: "#f5d000", label: "黄" },
  { value: "#ff6f9c", label: "ピンク" },
  { value: "#34c47c", label: "緑" },
  { value: "#3d8bff", label: "青" },
  { value: "#e53935", label: "赤" },
  { value: "#222222", label: "黒" },
];

export const MARKER_STYLE = { width: 0.028, opacity: 0.35 };
export const PEN_STYLE = { width: 0.004, opacity: 1 };
