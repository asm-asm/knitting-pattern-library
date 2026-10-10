import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { db } from "../db/db";
import {
  addAnnotation,
  deleteAnnotation,
  deletePageAnnotations,
  restoreAnnotation,
  saveViewState,
  updateNoteText,
} from "../db/repo";
import { FILE_KIND_LABELS, type Annotation, type InkAnnotation, type NoteAnnotation, type PatternFile, type ViewState } from "../db/types";
import { useFeedback } from "../components/Feedback";
import { CounterList, NotesEditor } from "../components/Counters";
import {
  anchorAt,
  clampZoom,
  computeLayout,
  pageIndexAt,
  renderRange,
  scrollForAnchor,
  TOP_PAD,
  type Anchor,
  type PageSize,
} from "./layout";
import { PdfPageCanvas } from "./PageView";
import { AnnotationLayer, type InkStyle, type Tool } from "./AnnotationLayer";
import { INK_COLORS, MARKER_STYLE, PEN_STYLE } from "./ink";
import { KEEP_AWAKE_KEY } from "../lib/settings";

export type ViewerSource =
  | { kind: "pdf"; doc: PDFDocumentProxy; sizes: PageSize[] }
  | { kind: "image"; url: string; sizes: PageSize[] };

type Panel = "counters" | "notes" | "annots" | null;
type UndoEntry = { kind: "add"; id: string } | { kind: "delete"; annotation: Annotation };
type NoteDialog = { mode: "new"; page: number; x: number; y: number } | { mode: "edit"; note: NoteAnnotation };

/** 現在ページの判定位置（画面上端からの割合） */
const FOCUS_RATIO = 0.35;

export function ViewerCore({ file, source, initialViewState }: { file: PatternFile; source: ViewerSource; initialViewState?: ViewState }) {
  const navigate = useNavigate();
  const { confirm, showError } = useFeedback();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(() => clampZoom(initialViewState?.zoom ?? 1));
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [tool, setTool] = useState<Tool>("move");
  const [editMode, setEditMode] = useState(false);
  const [showAnnots, setShowAnnots] = useState(true);
  const [markerColor, setMarkerColor] = useState(INK_COLORS[0].value);
  const [penColor, setPenColor] = useState(INK_COLORS[4].value);
  const [panel, setPanel] = useState<Panel>(null);
  const [noteDialog, setNoteDialog] = useState<NoteDialog | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const undoStack = useRef<UndoEntry[]>([]);
  const erased = useRef(new Set<string>());
  const gesturing = useRef(false);
  const pending = useRef<{ anchor: Anchor; vx: number; vy: number } | null>(null);
  const restored = useRef(false);

  const files = useLiveQuery(() => db.files.where("patternId").equals(file.patternId).sortBy("createdAt"), [file.patternId]);
  const annotations = useLiveQuery(() => db.annotations.where("fileId").equals(file.id).toArray(), [file.id]);
  const byPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annotations ?? []) m.set(a.page, [...(m.get(a.page) ?? []), a]);
    return m;
  }, [annotations]);

  const layout = useMemo(() => computeLayout(source.sizes, size.w || 1, zoom), [source.sizes, size.w, zoom]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // 画面サイズの監視（回転・分割表示などで変わっても表示位置を保つ）
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => {
      const prev = sizeRef.current;
      if (prev.w && !pending.current) {
        pending.current = { anchor: anchorAt(layoutRef.current, el.scrollLeft, el.scrollTop, 0, prev.h * FOCUS_RATIO), vx: 0, vy: el.clientHeight * FOCUS_RATIO };
      }
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 倍率・画面サイズ変更後に、同じ箇所が見えるようスクロール位置を補正する
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !size.w) return;
    if (!restored.current) {
      restored.current = true;
      if (initialViewState) {
        pending.current = {
          anchor: { page: Math.max(0, Math.min(source.sizes.length - 1, initialViewState.page - 1)), fx: initialViewState.scrollXRatio, fy: initialViewState.scrollYRatio },
          vx: 0,
          vy: size.h * FOCUS_RATIO,
        };
      }
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const s = scrollForAnchor(layout, p.anchor, p.vx, p.vy);
    el.scrollLeft = s.left;
    el.scrollTop = s.top;
    setScroll({ top: el.scrollTop, left: el.scrollLeft });
  }, [layout, size, initialViewState, source.sizes.length]);

  const zoomTo = useCallback((next: number, vx?: number, vy?: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const z = clampZoom(next);
    const x = vx ?? el.clientWidth / 2;
    const y = vy ?? el.clientHeight / 2;
    if (z === zoomRef.current) return;
    pending.current = { anchor: anchorAt(layoutRef.current, el.scrollLeft, el.scrollTop, x, y), vx: x, vy: y };
    setZoom(z);
  }, []);

  // ピンチ操作（2本指）での拡大縮小と移動。1本指のスクロールはブラウザ標準のまま。
  useEffect(() => {
    const el = scrollRef.current!;
    let pinch: { dist: number; zoom: number; anchor: Anchor } | null = null;
    const pts = (e: TouchEvent) => {
      const r = el.getBoundingClientRect();
      const [a, b] = [e.touches[0], e.touches[1]];
      return {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2 - r.left,
        y: (a.clientY + b.clientY) / 2 - r.top,
      };
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const p = pts(e);
      gesturing.current = true;
      pinch = { dist: p.dist || 1, zoom: zoomRef.current, anchor: anchorAt(layoutRef.current, el.scrollLeft, el.scrollTop, p.x, p.y) };
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const p = pts(e);
      const z = clampZoom((pinch.zoom * p.dist) / pinch.dist);
      if (z !== zoomRef.current) {
        pending.current = { anchor: pinch.anchor, vx: p.x, vy: p.y };
        setZoom(z);
      } else {
        const s = scrollForAnchor(layoutRef.current, pinch.anchor, p.x, p.y);
        el.scrollLeft = s.left;
        el.scrollTop = s.top;
      }
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinch = null;
        setTimeout(() => (gesturing.current = false), 50);
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // トラックパッドのピンチ / Ctrl+ホイール
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    const prevent = (e: Event) => e.preventDefault(); // Safari の画面全体ズームを抑止
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", prevent);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", prevent);
    };
  }, [zoomTo]);

  // スクロール位置の追跡
  useEffect(() => {
    const el = scrollRef.current!;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScroll({ top: el.scrollTop, left: el.scrollLeft }));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // 閲覧位置の保存（ファイルごと）
  const save = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !sizeRef.current.w || !restored.current) return;
    const a = anchorAt(layoutRef.current, el.scrollLeft, el.scrollTop, 0, el.clientHeight * FOCUS_RATIO);
    void saveViewState(file.id, { page: a.page + 1, zoom: zoomRef.current, scrollXRatio: a.fx, scrollYRatio: a.fy });
  }, [file.id]);
  useEffect(() => {
    const t = setTimeout(save, 400);
    return () => clearTimeout(t);
  }, [scroll, zoom, save]);
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [save]);

  useKeepAwake();

  const current = pageIndexAt(layout, scroll.top + size.h * FOCUS_RATIO);
  const [first, last] = renderRange(layout, scroll.top, size.h || 800);
  const pageCount = source.sizes.length;

  const goToPage = (i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(pageCount - 1, i));
    el.scrollTo({ top: layout.pages[idx].top - TOP_PAD / 2, left: el.scrollLeft });
  };

  // ---- 注釈 ----
  const pushUndo = (e: UndoEntry) => {
    undoStack.current.push(e);
    if (undoStack.current.length > 50) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  };
  const onInk = useCallback(
    (page: number, points: number[], style: InkStyle) => {
      addAnnotation({ type: "ink", fileId: file.id, page, points, ...style })
        .then((id) => pushUndo({ kind: "add", id }))
        .catch((e) => showError(e, "書き込みを保存できませんでした。"));
    },
    [file.id, showError],
  );
  const onErase = useCallback(
    (a: InkAnnotation) => {
      if (erased.current.has(a.id)) return;
      erased.current.add(a.id);
      deleteAnnotation(a.id)
        .then(() => pushUndo({ kind: "delete", annotation: a }))
        .catch((e) => showError(e));
    },
    [showError],
  );
  const onPlaceNote = useCallback((page: number, x: number, y: number) => setNoteDialog({ mode: "new", page, x, y }), []);
  const onOpenNote = useCallback((note: NoteAnnotation) => setNoteDialog({ mode: "edit", note }), []);
  const isGesturing = useCallback(() => gesturing.current, []);

  const undo = async () => {
    const e = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (!e) return;
    try {
      if (e.kind === "add") await deleteAnnotation(e.id);
      else {
        erased.current.delete(e.annotation.id);
        await restoreAnnotation(e.annotation);
      }
    } catch (err) {
      showError(err);
    }
  };

  const inkStyle: InkStyle =
    tool === "pen" ? { color: penColor, ...PEN_STYLE } : { color: markerColor, ...MARKER_STYLE };
  const effectiveTool: Tool = editMode ? tool : "move";

  const otherFiles = files ?? [file];

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <button type="button" className="icon-btn" aria-label="作品詳細に戻る" onClick={() => navigate(`/patterns/${file.patternId}`)}>
          ‹
        </button>
        {otherFiles.length > 1 ? (
          <select
            className="viewer-file-select"
            aria-label="表示するファイル"
            value={file.id}
            onChange={(e) => navigate(`/patterns/${file.patternId}/files/${e.target.value}`, { replace: true })}
          >
            {otherFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {FILE_KIND_LABELS[f.kind]}：{f.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="viewer-title">{file.name}</span>
        )}
        <button type="button" className={`bar-btn ${panel === "counters" ? "on" : ""}`} onClick={() => setPanel(panel === "counters" ? null : "counters")}>
          段数
        </button>
        <button type="button" className={`bar-btn ${panel === "notes" ? "on" : ""}`} onClick={() => setPanel(panel === "notes" ? null : "notes")}>
          メモ
        </button>
        <button
          type="button"
          className={`bar-btn ${editMode ? "on" : ""}`}
          aria-pressed={editMode}
          onClick={() => {
            setEditMode((m) => !m);
            if (!editMode && tool === "move") setTool("marker");
          }}
        >
          書込
        </button>
      </header>

      <div ref={scrollRef} className={`viewer-scroll ${editMode && tool !== "move" ? "drawing" : ""}`}>
        <div className="viewer-content" style={{ width: layout.contentWidth, height: layout.contentHeight }}>
          {layout.pages.map((box, i) => {
            const active = i >= first && i <= last;
            const s = source.sizes[i];
            return (
              <div key={i} className="page-box" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} data-page={i + 1}>
                {source.kind === "pdf" ? (
                  <PdfPageCanvas doc={source.doc} index={i} width={box.width} active={active} />
                ) : (
                  <img className="page-image" src={source.url} alt="" draggable={false} />
                )}
                {!active && <span className="page-placeholder">{i + 1}</span>}
                {active && (
                  <AnnotationLayer
                    page={i + 1}
                    aspect={s.h / s.w}
                    annotations={byPage.get(i + 1) ?? EMPTY}
                    tool={effectiveTool}
                    visible={showAnnots}
                    inkStyle={inkStyle}
                    onInk={onInk}
                    onErase={onErase}
                    onPlaceNote={onPlaceNote}
                    onOpenNote={onOpenNote}
                    isGesturing={isGesturing}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editMode && (
        <div className="annot-toolbar" role="toolbar" aria-label="書き込みツール">
          {(
            [
              ["move", "移動"],
              ["marker", "マーカー"],
              ["pen", "ペン"],
              ["note", "メモ"],
              ["eraser", "消しゴム"],
            ] as [Tool, string][]
          ).map(([t, label]) => (
            <button key={t} type="button" className={`tool-btn ${tool === t ? "on" : ""}`} aria-pressed={tool === t} onClick={() => setTool(t)}>
              {label}
            </button>
          ))}
          {(tool === "marker" || tool === "pen") && (
            <span className="swatches">
              {INK_COLORS.map((c) => {
                const on = (tool === "pen" ? penColor : markerColor) === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    className={`swatch ${on ? "on" : ""}`}
                    style={{ background: c.value }}
                    aria-label={c.label}
                    aria-pressed={on}
                    onClick={() => (tool === "pen" ? setPenColor(c.value) : setMarkerColor(c.value))}
                  />
                );
              })}
            </span>
          )}
          <span className="toolbar-spacer" />
          <button type="button" className="tool-btn" disabled={!undoCount} onClick={undo}>
            元に戻す
          </button>
          <button type="button" className={`tool-btn ${showAnnots ? "" : "on"}`} aria-pressed={!showAnnots} onClick={() => setShowAnnots((v) => !v)}>
            {showAnnots ? "隠す" : "表示"}
          </button>
          <button type="button" className={`tool-btn ${panel === "annots" ? "on" : ""}`} onClick={() => setPanel(panel === "annots" ? null : "annots")}>
            一覧
          </button>
        </div>
      )}
      {editMode && !showAnnots && <div className="viewer-hint">書き込みを非表示にしています</div>}

      {panel && (
        <div className="viewer-panel">
          <div className="viewer-panel-head">
            <strong>{panel === "counters" ? "段数カウンター" : panel === "notes" ? "制作メモ" : "書き込み一覧"}</strong>
            <button type="button" className="icon-btn" aria-label="閉じる" onClick={() => setPanel(null)}>
              ×
            </button>
          </div>
          <div className="viewer-panel-body">
            {panel === "counters" && <CounterList patternId={file.patternId} compact />}
            {panel === "notes" && <PatternNotes patternId={file.patternId} />}
            {panel === "annots" && (
              <AnnotationList
                byPage={byPage}
                onJump={(p) => goToPage(p - 1)}
                onDeletePage={async (p) => {
                  const ok = await confirm({
                    title: `${p}ページ目の書き込みを削除しますか？`,
                    message: "このページのマーカー・ペン・メモがすべて削除されます。元に戻せません。",
                    confirmLabel: "削除",
                    danger: true,
                  });
                  if (ok) deletePageAnnotations(file.id, p).catch((e) => showError(e));
                }}
              />
            )}
          </div>
        </div>
      )}

      <footer className="viewer-bottom">
        <button type="button" className="icon-btn" aria-label="前のページ" disabled={current === 0} onClick={() => goToPage(current - 1)}>
          ‹
        </button>
        <select className="page-select" aria-label="ページ移動" value={current} onChange={(e) => goToPage(Number(e.target.value))}>
          {source.sizes.map((_, i) => (
            <option key={i} value={i}>
              {i + 1} / {pageCount}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" aria-label="次のページ" disabled={current >= pageCount - 1} onClick={() => goToPage(current + 1)}>
          ›
        </button>
        <span className="toolbar-spacer" />
        <button type="button" className="icon-btn" aria-label="縮小" onClick={() => zoomTo(zoom / 1.25)}>
          −
        </button>
        <button type="button" className="zoom-label" aria-label="幅に合わせる" onClick={() => zoomTo(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="icon-btn" aria-label="拡大" onClick={() => zoomTo(zoom * 1.25)}>
          ＋
        </button>
      </footer>

      {noteDialog && (
        <NoteEditorDialog
          dialog={noteDialog}
          onClose={() => setNoteDialog(null)}
          onSave={async (text) => {
            try {
              if (noteDialog.mode === "new") {
                if (!text.trim()) return;
                const id = await addAnnotation({ type: "note", fileId: file.id, page: noteDialog.page, x: noteDialog.x, y: noteDialog.y, text });
                pushUndo({ kind: "add", id });
              } else {
                await updateNoteText(noteDialog.note.id, text);
              }
            } catch (e) {
              showError(e, "メモを保存できませんでした。");
            } finally {
              setNoteDialog(null);
            }
          }}
          onDelete={async () => {
            if (noteDialog.mode !== "edit") return;
            try {
              await deleteAnnotation(noteDialog.note.id);
              pushUndo({ kind: "delete", annotation: noteDialog.note });
            } catch (e) {
              showError(e);
            } finally {
              setNoteDialog(null);
            }
          }}
        />
      )}
    </div>
  );
}

const EMPTY: Annotation[] = [];

function PatternNotes({ patternId }: { patternId: string }) {
  const pattern = useLiveQuery(() => db.patterns.get(patternId), [patternId]);
  if (!pattern) return null;
  return <NotesEditor key={patternId} patternId={patternId} initial={pattern.notes} />;
}

function AnnotationList({
  byPage,
  onJump,
  onDeletePage,
}: {
  byPage: Map<number, Annotation[]>;
  onJump: (page: number) => void;
  onDeletePage: (page: number) => void;
}) {
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  if (!pages.length) return <p className="muted">このファイルにはまだ書き込みがありません。</p>;
  return (
    <ul className="annot-list">
      {pages.map((p) => {
        const list = byPage.get(p)!;
        const inks = list.filter((a) => a.type === "ink").length;
        const notes = list.filter((a): a is NoteAnnotation => a.type === "note");
        return (
          <li key={p}>
            <div className="annot-list-head">
              <button type="button" className="btn btn-small" onClick={() => onJump(p)}>
                {p}ページ目へ
              </button>
              <span className="muted small">
                {inks ? `線${inks}本` : ""}
                {inks && notes.length ? "・" : ""}
                {notes.length ? `メモ${notes.length}件` : ""}
              </span>
              <button type="button" className="btn btn-small btn-danger-text" onClick={() => onDeletePage(p)}>
                削除
              </button>
            </div>
            {notes.map((n) => (
              <p key={n.id} className="annot-note-text">
                {n.text}
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function NoteEditorDialog({
  dialog,
  onClose,
  onSave,
  onDelete,
}: {
  dialog: NoteDialog;
  onClose: () => void;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(dialog.mode === "edit" ? dialog.note.text : "");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="ページのメモ"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(text);
        }}
      >
        <h2>{dialog.mode === "new" ? "メモを追加" : "メモを編集"}</h2>
        <textarea className="input textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label="メモの内容" />
        <div className="modal-actions">
          {dialog.mode === "edit" && (
            <button type="button" className="btn btn-danger-text" onClick={onDelete}>
              削除
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className="btn btn-primary" disabled={dialog.mode === "new" && !text.trim()}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

/** 閲覧中は画面を消灯しない（設定で無効化できる。非対応の環境では何もしない） */
function useKeepAwake() {
  useEffect(() => {
    let enabled = true;
    try {
      enabled = localStorage.getItem(KEEP_AWAKE_KEY) !== "0";
    } catch {
      /* 既定は有効 */
    }
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!enabled || !wl) return;
    let sentinel: { release: () => Promise<void> } | undefined;
    let disposed = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen")
        .then((s) => {
          if (disposed) void s.release();
          else sentinel = s;
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
