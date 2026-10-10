import { Link } from "react-router-dom";
import { BACK_STATE } from "../hooks/navigation";
import type { Category, Pattern, PatternFile, PatternStatus } from "../db/types";
import { STATUS_LABELS } from "../db/types";
import { useBlobUrl } from "../hooks/hooks";
import { useFeedback } from "./Feedback";
import { toggleFavorite } from "../db/repo";

const PLACEHOLDER_TONES = ["#d9b8a6", "#b9c4ae", "#c6b7cf", "#e0c99a", "#a9bfc9", "#d4a5a5"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 表紙画像。未登録の場合はタイトルから色を決めた毛糸玉のプレースホルダーを表示する。 */
export function Cover({ pattern, className = "" }: { pattern: Pick<Pattern, "id" | "title" | "coverBlobId">; className?: string }) {
  const url = useBlobUrl(pattern.coverBlobId);
  if (url) return <img className={`cover ${className}`} src={url} alt="" loading="lazy" draggable={false} />;
  const tone = PLACEHOLDER_TONES[hash(pattern.id) % PLACEHOLDER_TONES.length];
  return (
    <div className={`cover cover-placeholder ${className}`} style={{ background: tone }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width="44%">
        <circle cx="50" cy="52" r="32" fill="rgba(255,255,255,.35)" />
        <g fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="3" strokeLinecap="round">
          <path d="M24 42c14 7 38 7 52 0" />
          <path d="M20 56c16 8 44 8 60 0" />
          <path d="M28 70c12 5 32 5 44 0" />
          <path d="M42 22c-8 15-8 45 0 60" />
          <path d="M60 22c7 16 7 44 0 60" />
        </g>
      </svg>
    </div>
  );
}

export function StatusBadge({ status }: { status: PatternStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function FavoriteButton({ pattern, size = "md" }: { pattern: Pattern; size?: "sm" | "md" }) {
  const { showError } = useFeedback();
  return (
    <button
      type="button"
      className={`fav-btn fav-${size} ${pattern.favorite ? "on" : ""}`}
      aria-pressed={pattern.favorite}
      aria-label={pattern.favorite ? "お気に入りから外す" : "お気に入りに追加"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(pattern.id).catch((err) => showError(err));
      }}
    >
      {pattern.favorite ? "♥" : "♡"}
    </button>
  );
}

function hasPdf(files: PatternFile[] | undefined) {
  return !!files?.some((f) => f.mimeType === "application/pdf");
}

export function PdfIndicator({ files }: { files: PatternFile[] | undefined }) {
  const n = files?.filter((f) => f.mimeType === "application/pdf").length ?? 0;
  return n > 0 ? (
    <span className="pdf-chip" title="PDF登録済み">PDF{n > 1 ? ` ×${n}` : ""}</span>
  ) : (
    <span className="pdf-chip pdf-none" title="PDF未登録">PDFなし</span>
  );
}

export function PatternCard({ pattern, files }: { pattern: Pattern; files?: PatternFile[] }) {
  return (
    <Link to={`/patterns/${pattern.id}`} state={BACK_STATE} className="card">
      <div className="card-cover">
        <Cover pattern={pattern} />
        <FavoriteButton pattern={pattern} size="sm" />
      </div>
      <div className="card-body">
        <div className="card-title">{pattern.title}</div>
        <div className="card-meta">
          <StatusBadge status={pattern.status} />
          {hasPdf(files) && <PdfIndicator files={files} />}
        </div>
      </div>
    </Link>
  );
}

export function PatternRow({
  pattern,
  files,
  categories,
}: {
  pattern: Pattern;
  files?: PatternFile[];
  categories: Map<string, Category>;
}) {
  const catNames = pattern.categoryIds.map((id) => categories.get(id)?.name).filter(Boolean);
  return (
    <Link to={`/patterns/${pattern.id}`} state={BACK_STATE} className="row">
      <Cover pattern={pattern} className="row-thumb" />
      <div className="row-body">
        <div className="row-title">{pattern.title}</div>
        <div className="row-sub">
          {catNames.length > 0 && <span>{catNames.join("・")}</span>}
          {pattern.shopName && <span>{pattern.shopName}</span>}
        </div>
        <div className="row-meta">
          <StatusBadge status={pattern.status} />
          <PdfIndicator files={files} />
        </div>
      </div>
      <FavoriteButton pattern={pattern} size="sm" />
    </Link>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}
