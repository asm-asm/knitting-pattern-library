import { memo, useRef } from "react";
import type { RulerState } from "../db/types";
import { clampRuler } from "./ruler";

/**
 * 編み図の定規。帯の外側を少し暗くして、今の段を目立たせる。
 * 帯はドラッグで上下に動かせる（帯の外はそのままスクロールできる）。
 */
export const RulerOverlay = memo(function RulerOverlay({
  ruler,
  draggable,
  onMove,
  onMoveEnd,
}: {
  ruler: RulerState;
  /** 書き込み中は帯を動かさない（線を引けるようにする） */
  draggable: boolean;
  onMove: (r: RulerState) => void;
  onMoveEnd: (r: RulerState) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; offset: number } | null>(null);
  const top = ruler.y - ruler.height / 2;
  const bottom = ruler.y + ruler.height / 2;

  const yAt = (clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    return (clientY - rect.top) / rect.height;
  };

  return (
    <div ref={ref} className="ruler-layer" aria-hidden="true">
      <div className="ruler-dim" style={{ top: 0, height: `${top * 100}%` }} />
      <div
        className={`ruler-band ${draggable ? "draggable" : ""}`}
        style={{ top: `${top * 100}%`, height: `${ruler.height * 100}%` }}
        onPointerDown={(e) => {
          if (!draggable) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, offset: yAt(e.clientY) - ruler.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          onMove(clampRuler({ ...ruler, y: yAt(e.clientY) - d.offset }));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          onMoveEnd(clampRuler({ ...ruler, y: yAt(e.clientY) - d.offset }));
        }}
        onPointerCancel={() => {
          drag.current = null;
          onMoveEnd(ruler);
        }}
      >
        {draggable && <span className="ruler-grip" />}
      </div>
      <div className="ruler-dim" style={{ top: `${bottom * 100}%`, bottom: 0 }} />
    </div>
  );
});
