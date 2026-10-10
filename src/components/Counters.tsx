import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { createCounter, deleteCounter, resetCounter, stepCounter, updateCounter, updatePatternNotes } from "../db/repo";
import type { Counter } from "../db/types";
import { useFeedback } from "./Feedback";

export function CounterList({ patternId, compact = false }: { patternId: string; compact?: boolean }) {
  const counters = useLiveQuery(() => db.counters.where("patternId").equals(patternId).sortBy("order"), [patternId]);
  const { showError } = useFeedback();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  if (!counters) return null;
  return (
    <div className={`counters ${compact ? "compact" : ""}`}>
      {counters.length === 0 && !adding && <p className="muted">段数カウンターはまだありません。</p>}
      {counters.map((c) => (
        <CounterCard key={c.id} counter={c} compact={compact} />
      ))}
      {adding ? (
        <form
          className="counter-add"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await createCounter(patternId, name, target ? Number(target.normalize("NFKC")) : undefined);
              setName("");
              setTarget("");
              setAdding(false);
            } catch (err) {
              showError(err);
            }
          }}
        >
          <input className="input" placeholder="名前（例：身頃、左袖）" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="カウンター名" />
          <input className="input" placeholder="目標段数（任意）" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="目標段数" />
          <div className="row-actions">
            <button type="button" className="btn btn-small" onClick={() => setAdding(false)}>
              キャンセル
            </button>
            <button type="submit" className="btn btn-small btn-primary">
              追加
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-dashed" onClick={() => setAdding(true)}>
          ＋ カウンターを追加
        </button>
      )}
    </div>
  );
}

function CounterCard({ counter, compact }: { counter: Counter; compact: boolean }) {
  const { confirm, showError } = useFeedback();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(counter.name);
  const [target, setTarget] = useState(counter.target ? String(counter.target) : "");
  const [value, setValue] = useState(String(counter.value));
  const step = (d: number) => stepCounter(counter.id, d).catch((e) => showError(e));
  const pct = counter.target ? Math.min(100, (counter.value / counter.target) * 100) : undefined;
  const reached = counter.target !== undefined && counter.value >= counter.target;

  if (editing) {
    return (
      <form
        className="counter-card editing"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await updateCounter(counter.id, {
              name,
              target: target.trim() ? Number(target.normalize("NFKC")) : null,
              value: Number(value.normalize("NFKC")),
            });
            setEditing(false);
          } catch (err) {
            showError(err);
          }
        }}
      >
        <label className="mini-field">
          名前
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid-2 tight">
          <label className="mini-field">
            現在の段数
            <input className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label className="mini-field">
            目標段数
            <input className="input" inputMode="numeric" placeholder="なし" value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-small btn-danger-text"
            onClick={async () => {
              if (await confirm({ title: `「${counter.name}」を削除しますか？`, message: `現在の段数（${counter.value}段）も削除されます。`, confirmLabel: "削除", danger: true })) {
                deleteCounter(counter.id).catch((e) => showError(e));
              }
            }}
          >
            削除
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setEditing(false);
              setName(counter.name);
              setTarget(counter.target ? String(counter.target) : "");
              setValue(String(counter.value));
            }}
          >
            キャンセル
          </button>
          <button type="submit" className="btn btn-small btn-primary">
            保存
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={`counter-card ${reached ? "reached" : ""}`}>
      <div className="counter-head">
        <span className="counter-name">{counter.name}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={`${counter.name} を編集`}
          onClick={() => {
            setValue(String(counter.value));
            setEditing(true);
          }}
        >
          ⋯
        </button>
      </div>
      <div className="counter-main">
        <button type="button" className="counter-step minus" aria-label={`${counter.name} を1段戻す`} onClick={() => step(-1)} disabled={counter.value === 0}>
          −
        </button>
        <div className="counter-value" aria-live="polite">
          <span className="counter-num">{counter.value}</span>
          <span className="counter-unit">段{counter.target ? ` / ${counter.target}` : ""}</span>
        </div>
        <button type="button" className="counter-step plus" aria-label={`${counter.name} を1段進める`} onClick={() => step(1)}>
          ＋
        </button>
      </div>
      {pct !== undefined && (
        <div className="progress" role="progressbar" aria-valuenow={counter.value} aria-valuemin={0} aria-valuemax={counter.target}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {!compact && (
        <div className="counter-foot">
          {reached && <span className="reached-label">目標段数に到達しました</span>}
          <button
            type="button"
            className="btn btn-small btn-ghost"
            disabled={counter.value === 0}
            onClick={async () => {
              const ok = await confirm({
                title: `「${counter.name}」をリセットしますか？`,
                message: `現在の ${counter.value}段 が 0段 に戻ります。`,
                confirmLabel: "リセット",
                danger: true,
              });
              if (ok) resetCounter(counter.id).catch((e) => showError(e));
            }}
          >
            リセット
          </button>
        </div>
      )}
    </div>
  );
}

/** 作品メモ。入力が止まったら自動保存する。 */
export function NotesEditor({
  patternId,
  initial,
  placeholder = "針の号数を変えた、ここで減目した、など",
}: {
  patternId: string;
  initial: string | undefined;
  placeholder?: string;
}) {
  const { showError } = useFeedback();
  const [text, setText] = useState(initial ?? "");
  const [state, setState] = useState<"idle" | "dirty" | "saved">("idle");
  const latest = useRef(text);
  latest.current = text;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef(false);

  const save = async () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await updatePatternNotes(patternId, latest.current);
      setState("saved");
    } catch (e) {
      showError(e, "メモを保存できませんでした。");
    }
  };

  // 画面を離れるときに未保存の入力を保存する
  useEffect(() => () => void save(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="notes-editor">
      <textarea
        className="input textarea"
        rows={5}
        placeholder={placeholder}
        value={text}
        aria-label="制作メモ"
        onChange={(e) => {
          setText(e.target.value);
          setState("dirty");
          dirty.current = true;
          clearTimeout(timer.current);
          timer.current = setTimeout(save, 800);
        }}
        onBlur={save}
      />
      <span className="hint" aria-live="polite">
        {state === "dirty" ? "入力中…" : state === "saved" ? "保存しました" : "入力内容は自動で保存されます"}
      </span>
    </div>
  );
}
