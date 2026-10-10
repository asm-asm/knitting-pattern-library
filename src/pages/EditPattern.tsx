import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { updatePattern } from "../db/repo";
import { useFeedback } from "../components/Feedback";
import { EmptyState } from "../components/PatternParts";
import { PatternFields, valuesFromPattern, valuesToInput, type FormValues } from "./PatternForm";

export default function EditPattern() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast, showError } = useFeedback();
  const pattern = useLiveQuery(() => db.patterns.get(id).then((p) => p ?? null), [id]);
  const [values, setValues] = useState<FormValues>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 初回読み込み時のみフォームに反映（編集中の入力を上書きしない）
    if (pattern && !values) setValues(valuesFromPattern(pattern));
  }, [pattern, values]);

  if (pattern === null) return <EmptyState title="作品が見つかりません。削除された可能性があります。" />;
  if (!values) return <div className="page loading">読み込み中…</div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updatePattern(id, valuesToInput(values));
      toast("保存しました");
      navigate(`/patterns/${id}`, { replace: true });
    } catch (err) {
      showError(err, "保存できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="page form" onSubmit={submit}>
      <header className="page-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          キャンセル
        </button>
        <h1>作品を編集</h1>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          保存
        </button>
      </header>
      <PatternFields values={values} onChange={setValues} />
      <div className="form-footer">
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          変更を保存する
        </button>
      </div>
    </form>
  );
}
