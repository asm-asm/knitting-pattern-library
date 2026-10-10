import { memo, useRef, useState } from "react";
import type { Annotation, InkAnnotation, NoteAnnotation } from "../db/types";
import { hitsInk, inkPath } from "./ink";

export type Tool = "move" | "marker" | "pen" | "note" | "eraser";

export interface InkStyle {
  color: string;
  width: number;
  opacity: number;
}

interface Props {
  /** 1始まりのページ番号 */
  page: number;
  aspect: number;
  annotations: Annotation[];
  tool: Tool;
  visible: boolean;
  inkStyle: InkStyle;
  onInk: (page: number, points: number[], style: InkStyle) => void;
  onErase: (a: InkAnnotation) => void;
  onPlaceNote: (page: number, x: number, y: number) => void;
  onOpenNote: (n: NoteAnnotation) => void;
  /** 2本指操作中は描画しない */
  isGesturing: () => boolean;
}

/** ページ上に重ねる注釈レイヤー。元の PDF は変更しない。 */
export const AnnotationLayer = memo(function AnnotationLayer({
  page,
  aspect,
  annotations,
  tool,
  visible,
  inkStyle,
  onInk,
  onErase,
  onPlaceNote,
  onOpenNote,
  isGesturing,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<number[] | null>(null);
  const draftRef = useRef<number[] | null>(null);
  const pointerId = useRef<number | null>(null);
  const H = 1000 * aspect;
  const drawing = tool === "marker" || tool === "pen";
  const interactive = visible && tool !== "move";

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const erase = (x: number, y: number) => {
    for (const a of annotations) if (a.type === "ink" && hitsInk(a, x, y, aspect)) onErase(a);
  };

  const cancel = () => {
    pointerId.current = null;
    draftRef.current = null;
    setDraft(null);
  };

  return (
    <div
      ref={ref}
      className={`annot-layer ${interactive ? "interactive" : ""} tool-${tool}`}
      hidden={!visible}
      onPointerDown={(e) => {
        if (!interactive || pointerId.current !== null || isGesturing()) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const [x, y] = pos(e);
        if (drawing) {
          pointerId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          draftRef.current = [x, y];
          setDraft([x, y]);
        } else if (tool === "eraser") {
          pointerId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          erase(x, y);
        }
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointerId.current) return;
        if (isGesturing()) return cancel();
        const [x, y] = pos(e);
        if (tool === "eraser") return erase(x, y);
        const pts = draftRef.current;
        if (!pts) return;
        const lx = pts[pts.length - 2];
        const ly = pts[pts.length - 1];
        if (Math.hypot(x - lx, (y - ly) * aspect) < 0.002) return;
        // マーカーは水平に引きやすいよう、ほぼ水平なら y を始点に揃える
        const next = tool === "marker" && Math.abs((y - pts[1]) * aspect) < 0.006 ? pts[1] : y;
        draftRef.current = [...pts, x, next];
        setDraft(draftRef.current);
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== pointerId.current) {
          if (tool === "note" && interactive && !isGesturing() && (e.target as HTMLElement).dataset.note === undefined) {
            const [x, y] = pos(e);
            onPlaceNote(page, x, y);
          }
          return;
        }
        const pts = draftRef.current;
        if (drawing && pts && pts.length >= 2) onInk(page, pts, inkStyle);
        cancel();
      }}
      onPointerCancel={cancel}
    >
      <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {annotations.map((a) =>
          a.type === "ink" ? (
            <path
              key={a.id}
              d={inkPath(a.points, aspect)}
              stroke={a.color}
              strokeOpacity={a.opacity}
              strokeWidth={a.width * 1000}
              fill="none"
              strokeLinecap={a.opacity < 1 ? "butt" : "round"}
              strokeLinejoin="round"
              style={a.opacity < 1 ? { mixBlendMode: "multiply" } : undefined}
            />
          ) : null,
        )}
        {draft && (
          <path
            d={inkPath(draft, aspect)}
            stroke={inkStyle.color}
            strokeOpacity={inkStyle.opacity}
            strokeWidth={inkStyle.width * 1000}
            fill="none"
            strokeLinecap={inkStyle.opacity < 1 ? "butt" : "round"}
            strokeLinejoin="round"
          />
        )}
      </svg>
      {annotations.map((a) =>
        a.type === "note" ? (
          <button
            key={a.id}
            type="button"
            data-note=""
            className="note-pin"
            style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
            aria-label={`メモ：${a.text}`}
            title={a.text}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote(a);
            }}
          >
            ✎
          </button>
        ) : null,
      )}
    </div>
  );
});
